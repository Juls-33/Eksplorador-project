//! Desktop-only routing and ephemeral encoder telemetry. No database writes.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const RESTART_SILENCE: Duration = Duration::from_secs(3);
const UI_INTERVAL: Duration = Duration::from_millis(100);
const JS_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

// Temporary troubleshooting output is opt-in: normal reception does not pay
// for formatting or synchronous per-packet console output.
pub fn trace(stage: &str, details: impl FnOnce() -> String) {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    if *ENABLED.get_or_init(|| std::env::var("EKSPLORADOR_TELEMETRY_DEBUG").as_deref() == Ok("1")) {
        eprintln!("[telemetry:{stage}] {}", details());
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderPacket {
    #[serde(rename = "type")]
    kind: String,
    pub encoder_seq: u32,
    left_ticks: i64,
    right_ticks: i64,
    #[serde(rename = "leftRPM")]
    left_rpm: f64,
    #[serde(rename = "rightRPM")]
    right_rpm: f64,
    invalid_l: u32,
    invalid_r: u32,
    age_at_transmit_ms: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderEvent {
    #[serde(flatten)]
    packet: EncoderPacket,
    received_at_ms: u64,
}

pub enum Message {
    MissionStatus(crate::mission_status::MissionStatus),
    Encoder(EncoderPacket),
    Fusion(Value),
    Navigation(Value),
    Sensor(Value),
    Ignore,
}

pub fn classify(line: &str) -> Message {
    trace("raw", || line.trim_end().to_string());
    let trimmed = line.trim();
    // Only anchored transport prefixes are data. A [RAW RX] echo containing
    // JSON remains a diagnostic, never a second measurement.
    let (transport, payload) = ["DATA:", "ENC:", "FUS:"]
        .iter()
        .find_map(|prefix| {
            trimmed
                .strip_prefix(prefix)
                .map(|json| (Some(*prefix), json.trim_start()))
        })
        .unwrap_or((None, trimmed));
    if !payload.starts_with('{') {
        trace("rejected", || "non_json_diagnostic_or_non_object".into());
        return Message::Ignore;
    }
    let json = match serde_json::from_str::<Value>(payload) {
        Ok(json) => json,
        Err(error) => {
            trace("rejected", || format!("invalid_json: {error}"));
            return Message::Ignore;
        }
    };
    let kind = json.get("type").and_then(Value::as_str);
    trace("json_parsed", || {
        format!(
            "transport={transport:?} type={kind:?} seq={} encoderSeq={}",
            json["seq"], json["encoderSeq"]
        )
    });
    let matches_transport = match transport {
        Some("ENC:") => kind == Some("encoder"),
        Some("FUS:") => kind == Some("fusion"),
        Some("DATA:") => json.get("type").is_none() || kind == Some("sensor"),
        _ => true,
    };
    if !matches_transport {
        trace("rejected", || {
            format!("transport_type_mismatch: transport={transport:?} type={kind:?}")
        });
        return Message::Ignore;
    }
    if kind == Some("missionStatus") {
        return crate::mission_status::MissionStatus::parse(json)
            .map(Message::MissionStatus)
            .unwrap_or(Message::Ignore);
    }
    if matches!(kind, Some("navigation") | Some("navigationCalibration")) {
        return if transport.is_none() && navigation_json_valid(&json) {
            Message::Navigation(json)
        } else {
            Message::Ignore
        };
    }
    if kind == Some("encoder") {
        trace("classified", || "encoder".into());
        return match serde_json::from_value::<EncoderPacket>(json) {
            Ok(packet)
                if packet.left_rpm.is_finite()
                    && packet.right_rpm.is_finite()
                    && (-JS_SAFE_INTEGER..=JS_SAFE_INTEGER).contains(&packet.left_ticks)
                    && (-JS_SAFE_INTEGER..=JS_SAFE_INTEGER).contains(&packet.right_ticks) =>
            {
                Message::Encoder(packet)
            }
            Ok(_) => {
                trace("rejected", || {
                    "invalid_encoder: non_finite_rpm_or_unsafe_tick_integer".into()
                });
                Message::Ignore
            }
            Err(error) => {
                trace("rejected", || format!("invalid_encoder: {error}"));
                Message::Ignore
            }
        };
    }
    if kind == Some("fusion") {
        trace("classified", || {
            "fusion (isolated from encoder and sensor state)".into()
        });
        return Message::Fusion(json);
    }
    // Keep the legacy untyped sensor/error pipeline. Unknown typed packets and
    // unrelated JSON must not overwrite GPS, probe state, or live sensor cards.
    if json.is_object()
        && (json.get("type").is_none() || kind == Some("sensor"))
        && (json.get("seq").and_then(Value::as_u64).is_some() || json.get("error").is_some())
    {
        trace("classified", || "sensor".into());
        Message::Sensor(json)
    } else {
        trace("rejected", || {
            "unknown_type_or_missing_sensor_sequence".into()
        });
        Message::Ignore
    }
}

pub fn navigation_json_valid(json: &Value) -> bool {
    let number = |key: &str, min: f64, max: f64| {
        json.get(key)
            .and_then(Value::as_f64)
            .is_some_and(|n| n.is_finite() && n >= min && n <= max)
    };
    let flag = |key: &str| json.get(key).and_then(Value::as_bool).is_some();
    let uint = |key: &str| {
        json.get(key)
            .and_then(Value::as_u64)
            .is_some_and(|n| n <= u32::MAX as u64)
    };
    if json["protocol"] != "N1" {
        return false;
    }
    if json["type"] == "navigationCalibration" {
        return uint("revision")
            && flag("valid")
            && number("leftMetersPerRev", 0.0, 2.0)
            && number("rightMetersPerRev", 0.0, 2.0)
            && number("trackWidthM", 0.0, 3.0)
            && number("gyroBiasDps", -10.0, 10.0)
            && number("gyroScale", 0.0, 2.0)
            && [-1, 0, 1]
                .iter()
                .any(|n| json["gyroClockwiseSign"].as_i64() == Some(*n))
            && (json["valid"] != true
                || (json["revision"].as_u64().unwrap_or(0) > 0
                    && number("leftMetersPerRev", 0.02, 2.0)
                    && number("rightMetersPerRev", 0.02, 2.0)
                    && number("trackWidthM", 0.1, 3.0)
                    && number("gyroScale", 0.5, 2.0)
                    && json["gyroClockwiseSign"] != 0));
    }
    let word = |key: &str, max: usize| {
        json[key].as_str().is_some_and(|s| {
            !s.is_empty()
                && s.len() <= max
                && s.bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
        })
    };
    json["type"] == "navigation"
        && ["megaVersion", "roverVersion", "receiverVersion"]
            .iter()
            .all(|k| {
                json[*k]
                    .as_u64()
                    .is_some_and(|n| (30100..40000).contains(&n))
            })
        && json["missionId"].as_str().is_some_and(|s| {
            s.len() == 16
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'A'..=b'F').contains(&b))
        })
        && uint("navSeq")
        && uint("bootId")
        && word("state", 21)
        && word("reason", 33)
        && number("targetPin", 0.0, 10.0)
        && json["targetPin"].as_u64().is_some()
        && [
            "calibrated",
            "poseValid",
            "headingValid",
            "gpsValid",
            "imuValid",
            "rcAuthorized",
            "staged",
            "active",
            "ready",
        ]
        .iter()
        .all(|k| flag(k))
        && number("gpsLat", -90.0, 90.0)
        && number("gpsLng", -180.0, 180.0)
        && number("estimatedLat", -90.0, 90.0)
        && number("estimatedLng", -180.0, 180.0)
        && number("positionUncertaintyM", 0.0, 1000.0)
        && number("headingDeg", 0.0, 359.99)
        && number("headingUncertaintyDeg", 0.0, 180.0)
        && number("distanceRemainingM", 0.0, 10000.0)
        && number("encoderTravelM", 0.0, 10000.0)
        && uint("calibrationRevision")
        && number("corrections", 0.0, 1000.0)
        && json["corrections"].as_u64().is_some()
        && number("gyroBiasDps", -100.0, 100.0)
        && (json["ready"] != true
            || (json["bootId"].as_u64().unwrap_or(0) > 0
                && [
                    "calibrated",
                    "headingValid",
                    "gpsValid",
                    "imuValid",
                    "staged",
                ]
                .iter()
                .all(|k| json[*k] == true)))
}

#[cfg(test)]
mod mission_routing_tests {
    use super::*;
    #[test]
    fn n1_receiver_json_is_isolated_and_validated_without_touching_sensor_or_encoder_streams() {
        let lines: Vec<_> = include_str!("../../tests/fixtures/n1-navigation.jsonl")
            .lines()
            .collect();
        for line in &lines {
            assert!(matches!(classify(line), Message::Navigation(_)));
        }
        let original: Value = serde_json::from_str(lines[0]).unwrap();
        for (key, value) in [
            ("gpsLat", serde_json::json!(91)),
            ("headingDeg", serde_json::json!(360)),
            ("calibrated", serde_json::json!(false)),
            ("megaVersion", serde_json::json!(20009)),
            ("positionUncertaintyM", serde_json::json!(-1)),
            ("bootId", serde_json::json!(0)),
        ] {
            let mut json = original.clone();
            json[key] = value;
            assert!(
                matches!(classify(&json.to_string()), Message::Ignore),
                "accepted {key}"
            );
        }
        for prefix in ["DATA:", "ENC:", "FUS:", "[RAW RX]: "] {
            assert!(matches!(
                classify(&format!("{prefix}{}", lines[0])),
                Message::Ignore
            ));
        }
    }
    #[test]
    fn mission_reports_never_route_to_sensor_fusion_or_encoder_data() {
        let json = r#"{"type":"missionStatus","missionId":"0123456789ABCDEF","statusSeq":1,"state":"STAGED","step":0,"reason":"NAV_NOT_CALIBRATED","rssi":-42,"snr":8.6}"#;
        assert!(matches!(classify(json), Message::MissionStatus(_)));
        for prefix in ["DATA:", "ENC:", "FUS:", "[RAW RX]: "] {
            assert!(matches!(
                classify(&format!("{prefix}{json}")),
                Message::Ignore
            ));
        }
        let mut soil_lookalike: Value = serde_json::from_str(json).unwrap();
        soil_lookalike["seq"] = 1.into();
        soil_lookalike["soilValid"] = 1.into();
        soil_lookalike["lat"] = 14.into();
        soil_lookalike["lng"] = 120.into();
        assert!(matches!(
            classify(&soil_lookalike.to_string()),
            Message::Ignore
        ));
        assert!(matches!(
            classify(&json.replace("\"step\":0", "\"step\":-1")),
            Message::Ignore
        ));
    }
}

fn is_newer(sequence: u32, previous: u32) -> bool {
    let delta = sequence.wrapping_sub(previous);
    delta != 0 && delta < (1 << 31)
}

#[derive(Default)]
struct SequenceFilter {
    last: Option<(u32, Instant)>,
    restart_candidate: Option<(u32, Instant)>,
}

impl SequenceFilter {
    fn accept(&mut self, sequence: u32, now: Instant, source: &str) -> bool {
        if let Some((previous, received)) = self.last {
            if sequence == previous {
                trace("rejected", || {
                    format!("duplicate_{source}_sequence: sequence={sequence}; freshness unchanged")
                });
                return false;
            }
            if !is_newer(sequence, previous) {
                // A sequence alone cannot prove a reboot. Require silence plus
                // two progressing backward packets before opening a new epoch.
                let progressing = self.restart_candidate.is_some_and(|(candidate, seen)| {
                    is_newer(sequence, candidate) && now.duration_since(seen) <= RESTART_SILENCE
                });
                self.restart_candidate = Some((sequence, now));
                if now.duration_since(received) < RESTART_SILENCE || !progressing {
                    trace("rejected", || {
                        format!("out_of_order_{source}: sequence={sequence} previous={previous} waiting_for_restart_evidence={}", !progressing)
                    });
                    return false;
                }
                trace("sequence_reset", || {
                    format!("source={source} sequence={sequence} after silence and progressing restart candidates")
                });
            }
        }
        self.restart_candidate = None;
        self.last = Some((sequence, now));
        true
    }
}

#[derive(Default)]
pub struct EncoderStream {
    sequence: SequenceFilter,
    pending: Option<EncoderEvent>,
    last_emit: Option<Instant>,
}

impl EncoderStream {
    pub fn receive(&mut self, packet: EncoderPacket, now: Instant, received_at_ms: u64) -> bool {
        if !self.sequence.accept(packet.encoder_seq, now, "encoder") {
            return false;
        }
        trace("encoder_updated", || {
            format!("encoderSeq={} leftRPM={} rightRPM={} ageAtTransmitMs={} receivedAtMs={received_at_ms}", packet.encoder_seq, packet.left_rpm, packet.right_rpm, packet.age_at_transmit_ms)
        });
        self.pending = Some(EncoderEvent {
            packet,
            received_at_ms,
        });
        true
    }

    // Coalesce to the newest accepted packet at most 10 times/sec. The serial
    // owner calls this even during timeouts, so a trailing packet is delivered.
    pub fn take_due(&mut self, now: Instant) -> Option<EncoderEvent> {
        if self
            .last_emit
            .is_some_and(|last| now.duration_since(last) < UI_INTERVAL)
        {
            return None;
        }
        let event = self.pending.take()?;
        self.last_emit = Some(now);
        Some(event)
    }
}

// Each source owns its own sequence epoch. Fusion sequences are never compared
// with encoderSeq and fusion never changes the standalone encoder stream.
#[derive(Default)]
pub struct FusionStream {
    sequence: SequenceFilter,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FusionRpm {
    fusion_seq: u32,
    encoder_valid: u8,
    #[serde(rename = "leftRPM")]
    left_rpm: Option<f64>,
    #[serde(rename = "rightRPM")]
    right_rpm: Option<f64>,
    encoder_age_ms: Option<u32>,
}

impl FusionStream {
    pub fn receive(&mut self, mut json: Value, now: Instant, received_at_ms: u64) -> Option<Value> {
        let fields = match serde_json::from_value::<FusionRpm>(json.clone()) {
            Ok(fields) if fields.encoder_valid <= 1 => fields,
            result => {
                trace("rejected", || {
                    format!(
                        "invalid_fusion_header: {}",
                        result
                            .err()
                            .map(|e| e.to_string())
                            .unwrap_or_else(|| "encoderValid must be 0 or 1".into())
                    )
                });
                return None;
            }
        };
        if fields.encoder_valid == 1
            && !(fields.left_rpm.is_some_and(f64::is_finite)
                && fields.right_rpm.is_some_and(f64::is_finite)
                && fields.encoder_age_ms.is_some())
        {
            trace("rejected", || {
                "invalid_fusion_rpm: encoderValid=1 requires finite RPM and nonnegative encoderAgeMs".into()
            });
            return None;
        }
        if !self.sequence.accept(fields.fusion_seq, now, "fusion") {
            return None;
        }
        json["receivedAtMs"] = received_at_ms.into();
        trace("fusion_updated", || {
            format!(
                "fusionSeq={} encoderValid={} encoderAgeMs={:?}; standalone counters unchanged",
                fields.fusion_seq, fields.encoder_valid, fields.encoder_age_ms
            )
        });
        Some(json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/encoder-stream.jsonl");

    fn packet(sequence: u32) -> EncoderPacket {
        let Message::Encoder(mut packet) = classify(FIXTURE.lines().nth(6).unwrap()) else {
            panic!("invalid mock encoder packet");
        };
        packet.encoder_seq = sequence;
        packet
    }

    #[test]
    fn interleaved_messages_keep_encoder_and_legacy_sensor_payloads_separate() {
        let mut encoders = 0;
        let mut sensors = 0;
        for line in FIXTURE.lines() {
            match classify(line) {
                Message::Encoder(packet) => {
                    encoders += 1;
                    let mut expected = serde_json::from_str::<Value>(line).unwrap();
                    // RPM is decoded as f64 even when the sender writes `0`.
                    for key in ["leftRPM", "rightRPM"] {
                        expected[key] = Value::from(expected[key].as_f64().unwrap());
                    }
                    assert_eq!(serde_json::to_value(packet).unwrap(), expected);
                }
                Message::Sensor(json) => {
                    sensors += 1;
                    assert_eq!(json, serde_json::from_str::<Value>(line).unwrap());
                    assert_eq!(json.as_object().unwrap().len(), 19);
                }
                Message::Ignore => {}
                Message::Navigation(_) | Message::Fusion(_) | Message::MissionStatus(_) => {
                    panic!("legacy fixture unexpectedly contained a different stream")
                }
            }
        }
        assert_eq!((encoders, sensors), (5, 1));
        // Even an encoder with sensor-looking extras cannot enter soil/GPS flow.
        let mut mixed = serde_json::to_value(packet(1)).unwrap();
        mixed["seq"] = 12.into();
        mixed["lat"] = 14.into();
        mixed["lng"] = 120.into();
        mixed["soilValid"] = 1.into();
        assert!(matches!(classify(&mixed.to_string()), Message::Encoder(_)));
    }

    #[test]
    fn missing_malformed_and_unsafe_values_never_fall_through_to_sensor_data() {
        let valid = serde_json::to_value(packet(1)).unwrap();
        for key in [
            "encoderSeq",
            "leftTicks",
            "rightTicks",
            "leftRPM",
            "rightRPM",
            "invalidL",
            "invalidR",
            "ageAtTransmitMs",
        ] {
            let mut missing = valid.clone();
            missing.as_object_mut().unwrap().remove(key);
            assert!(
                matches!(classify(&missing.to_string()), Message::Ignore),
                "{key}"
            );
            for bad in [Value::Null, Value::Bool(true), Value::String("12".into())] {
                let mut malformed = valid.clone();
                malformed[key] = bad;
                assert!(
                    matches!(classify(&malformed.to_string()), Message::Ignore),
                    "{key}"
                );
            }
        }
        for (key, bad) in [
            ("encoderSeq", -1_i64),
            ("invalidL", -1),
            ("invalidR", 4_294_967_296),
            ("ageAtTransmitMs", -1),
            ("leftTicks", JS_SAFE_INTEGER + 1),
        ] {
            let mut malformed = valid.clone();
            malformed[key] = bad.into();
            assert!(matches!(classify(&malformed.to_string()), Message::Ignore));
        }
        for line in [
            "[]",
            "null",
            "42",
            "{}",
            "{bad}",
            "{\"type\":\"encoder\",\"leftRPM\":1e999}",
            "[RAW RX] ENC",
            "[ACK]",
            "[MODE] RX",
        ] {
            assert!(matches!(classify(line), Message::Ignore));
        }
        assert!(matches!(
            classify(r#"{"error":"probe unavailable"}"#),
            Message::Sensor(_)
        ));
    }

    #[test]
    fn duplicates_and_reordered_packets_do_not_replace_or_refresh_the_last_packet() {
        let start = Instant::now();
        let mut stream = EncoderStream::default();
        assert!(stream.receive(packet(100), start, 1000));
        assert!(!stream.receive(packet(100), start + Duration::from_secs(2), 3000));
        assert!(!stream.receive(packet(99), start + Duration::from_secs(2), 3000));
        let event = stream.take_due(start + Duration::from_secs(2)).unwrap();
        assert_eq!(
            (event.packet.encoder_seq, event.received_at_ms),
            (100, 1000)
        );
        assert!(stream.receive(packet(101), start + Duration::from_secs(2), 3001));
    }

    #[test]
    fn reboot_requires_silence_and_progress_while_reconnection_starts_a_new_epoch() {
        let start = Instant::now();
        let mut stream = EncoderStream::default();
        assert!(stream.receive(packet(100), start, 1000));
        assert!(!stream.receive(packet(0), start + Duration::from_secs(1), 2000));
        assert!(!stream.receive(packet(1), start + Duration::from_secs(2), 3000));
        assert!(stream.receive(packet(2), start + Duration::from_secs(3), 4000));
        assert!(stream.receive(packet(3), start + Duration::from_secs(4), 5000));
        let mut reconnected = EncoderStream::default();
        assert!(reconnected.receive(packet(0), start, 6000));
    }

    #[test]
    fn uint32_wrap_is_accepted_and_single_late_packet_is_ignored() {
        let start = Instant::now();
        let mut stream = EncoderStream::default();
        assert!(stream.receive(packet(u32::MAX), start, 1000));
        assert!(stream.receive(packet(0), start, 1001));
        assert!(!stream.receive(packet(u32::MAX), start + Duration::from_secs(5), 6000));
        assert!(stream.receive(packet(1), start + Duration::from_secs(5), 6001));
    }

    #[test]
    fn bursts_coalesce_and_the_trailing_packet_keeps_its_original_receipt_time() {
        let start = Instant::now();
        let mut stream = EncoderStream::default();
        stream.receive(packet(0), start, 1000);
        assert_eq!(stream.take_due(start).unwrap().packet.encoder_seq, 0);
        for n in 1..100 {
            stream.receive(
                packet(n),
                start + Duration::from_millis(n as u64),
                1000 + n as u64,
            );
            assert!(stream
                .take_due(start + Duration::from_millis(n as u64))
                .is_none());
        }
        let trailing = stream.take_due(start + Duration::from_millis(100)).unwrap();
        assert_eq!(
            (trailing.packet.encoder_seq, trailing.received_at_ms),
            (99, 1099)
        );
        assert!(stream.take_due(start + Duration::from_secs(1)).is_none());
    }

    #[test]
    fn mixed_a27_serial_lines_keep_encoder_sequences_and_rpm_advancing() {
        let fixture = include_str!("../../tests/fixtures/mixed-fusion-stream.jsonl");
        let start = Instant::now();
        let mut stream = EncoderStream::default();
        let mut sequences = Vec::new();
        let mut speeds = Vec::new();
        for (index, line) in fixture.lines().enumerate() {
            let elapsed = index as u64 * 250;
            let now = start + Duration::from_millis(elapsed);
            if let Message::Encoder(packet) = classify(line) {
                assert!(stream.receive(packet, now, 10000 + elapsed));
                let event = stream.take_due(now).unwrap();
                sequences.push(event.packet.encoder_seq);
                speeds.push(event.packet.left_rpm);
            }
        }
        assert_eq!(sequences, vec![170, 171, 172, 173, 174, 175, 176]);
        assert_eq!(speeds, vec![0.0, 20.0, -44.97, -30.0, 35.0, 45.0, 50.0]);
    }

    #[test]
    fn actual_receiver_log_has_fusion_rpm_but_no_standalone_encoder_packets() {
        let fixture = include_str!("../../tests/fixtures/actual-a27-receiver.log");
        let mut counts = (0, 0, 0);
        let mut fusion = FusionStream::default();
        for line in fixture.lines() {
            match classify(line) {
                Message::Encoder(_) => counts.0 += 1,
                Message::Sensor(_) => counts.1 += 1,
                Message::Fusion(json) => {
                    counts.2 += 1;
                    let event = fusion.receive(json, Instant::now(), 10000).unwrap();
                    assert_eq!(event["fusionSeq"], 912);
                    assert_eq!(event["encoderAgeMs"], 237);
                    assert!(event.get("encoderSeq").is_none());
                    assert!(event.get("leftTicks").is_none());
                }
                Message::Navigation(_) | Message::Ignore | Message::MissionStatus(_) => {}
            }
        }
        assert_eq!(counts, (0, 2, 1));
    }

    #[test]
    fn fusion_sequences_and_rejections_are_independent_of_encoder_sequences() {
        let start = Instant::now();
        let mut encoders = EncoderStream::default();
        let mut fusion = FusionStream::default();
        let json = serde_json::json!({"type":"fusion", "fusionSeq":100, "encoderValid":1,
            "leftRPM":12, "rightRPM":13, "encoderAgeMs":237, "encoderSeq":9999});
        assert!(encoders.receive(packet(100), start, 10000));
        assert!(fusion.receive(json.clone(), start, 10000).is_some());
        assert!(fusion.receive(json.clone(), start, 10001).is_none());
        assert!(encoders.receive(packet(101), start, 10001));
        let mut bad = json.clone();
        bad["fusionSeq"] = 101.into();
        bad["leftRPM"] = "bad".into();
        assert!(fusion.receive(bad, start, 10002).is_none());
        let mut next = json;
        next["fusionSeq"] = 101.into();
        assert!(fusion.receive(next.clone(), start, 10003).is_some());
        next["fusionSeq"] = 102.into();
        next["encoderValid"] = 0.into();
        assert!(fusion.receive(next, start, 10004).is_some());
        assert!(encoders.receive(packet(102), start, 10005));
        assert_eq!(encoders.take_due(start).unwrap().packet.encoder_seq, 102);
    }

    #[test]
    fn diagnostic_echoes_unknown_types_and_mismatched_transport_prefixes_are_not_measurements() {
        for line in [
            r#"[RAW RX]: ENC: {"type":"encoder","encoderSeq":999}"#,
            r#"FUS: {"type":"encoder","encoderSeq":999}"#,
            r#"ENC: {"type":"fusion","fusionSeq":999}"#,
            r#"DATA: {"type":"fusion","seq":999,"soilValid":1,"lat":1,"lng":1}"#,
            r#"{"type":"unknown","seq":999,"soilValid":1,"lat":1,"lng":1}"#,
        ] {
            assert!(matches!(classify(line), Message::Ignore));
        }
    }
}
