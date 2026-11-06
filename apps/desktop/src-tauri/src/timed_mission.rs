//! A3.1 sequence validation before the unchanged Mission V2 deployment path.
//! This module never writes to serial, authorizes RC, or interprets execution.

use crate::mission_protocol::{HEADER_BYTES, MAX_PACKET_BYTES};

pub fn prepare(
    radio: &mut crate::mission_deployment::Radio,
    sequence: String,
) -> Result<crate::mission_deployment::Deployment, String> {
    validate_leg(&sequence)?;
    radio.begin(sequence)
}

// Compare an already syntax-checked ASCII decimal without floating-point
// rounding at the hard boundaries (e.g. 2.0000000000000001 is out of range).
fn compare_decimal(value: &str, limit: &str) -> std::cmp::Ordering {
    let parts = |text: &str| {
        let (whole, fraction) = text.split_once('.').unwrap_or((text, ""));
        let whole = whole.trim_start_matches('0');
        (
            if whole.is_empty() { "0" } else { whole }.to_owned(),
            fraction.to_owned(),
        )
    };
    let (whole, fraction) = parts(value);
    let (max_whole, max_fraction) = parts(limit);
    let integer_order = whole
        .len()
        .cmp(&max_whole.len())
        .then_with(|| whole.cmp(&max_whole));
    if integer_order != std::cmp::Ordering::Equal {
        return integer_order;
    }
    let precision = fraction.len().max(max_fraction.len());
    fraction
        .bytes()
        .chain(std::iter::repeat(b'0'))
        .take(precision)
        .cmp(
            max_fraction
                .bytes()
                .chain(std::iter::repeat(b'0'))
                .take(precision),
        )
}

pub fn validate_leg(sequence: &str) -> Result<(), String> {
    if sequence.is_empty() || sequence.len() + HEADER_BYTES > MAX_PACKET_BYTES {
        return Err("Timed leg must fit the 226-byte Mission V2 sequence limit.".into());
    }
    let tokens: Vec<_> = sequence.split(',').collect();
    if !(1..=2).contains(&tokens.len()) {
        return Err("Upload exactly one or two timed movement tokens.".into());
    }
    let mut total = 0.0;
    for token in tokens {
        let bytes = token.as_bytes();
        if bytes.len() < 3 || bytes[0] != b'T' || !matches!(bytes[1], b'F' | b'L' | b'R') {
            return Err(
                "Only TF/TL/TR ASCII-second tokens are accepted in the timed pathway.".into(),
            );
        }
        let number = &token[2..];
        let mut decimal = number.split('.');
        let whole = decimal.next().unwrap_or("");
        let fraction = decimal.next();
        if whole.is_empty()
            || !whole.bytes().all(|byte| byte.is_ascii_digit())
            || fraction.is_some_and(|part| {
                part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit())
            })
            || decimal.next().is_some()
        {
            return Err(
                "Timed seconds cannot contain whitespace, signs or other characters.".into(),
            );
        }
        if compare_decimal(number, "0.100").is_lt()
            || compare_decimal(number, "2.000").is_gt()
            || (bytes[1] != b'F' && compare_decimal(number, "1.500").is_gt())
        {
            return Err(
                "Each timed step must be 0.100–2.000 s; turns must be at most 1.500 s.".into(),
            );
        }
        total += number
            .parse::<f64>()
            .map_err(|_| "Invalid timed decimal.".to_string())?;
    }
    // Two individually bounded steps already imply this bound; keep it explicit.
    if !total.is_finite() || total > 4.0 {
        return Err("Timed leg exceeds 4.000 seconds.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{mission_deployment::Radio, mission_protocol};

    #[test]
    fn inclusive_limits_and_four_second_leg() {
        for text in [
            "TF0.100",
            "TF2.000",
            "TL0.100",
            "TR1.500",
            "TL1.500,TF2.000",
            "TF2.000,TF2.000",
        ] {
            assert!(validate_leg(text).is_ok(), "{text}");
        }
        for text in [
            "TF0.099",
            "TF2.001",
            "TL1.501",
            "TR2.000",
            "TF2.0000000000000001",
            "TR1.5000000000000001",
            "TF0.09999999999999999",
            "TF2.000,TF2.001",
        ] {
            assert!(validate_leg(text).is_err(), "{text}");
        }
    }

    #[test]
    fn invalid_legacy_reverse_actuator_and_malformed_tokens_never_enter_radio() {
        let mut radio = Radio::default();
        for text in [
            "",
            "F5",
            "L90",
            "R90",
            "B1",
            "TB0.100",
            "TA0.500",
            "EXTEND",
            "RETRACT",
            "TIME:TF0.250",
            " TF0.100",
            "TF0.100 ",
            "TF0.100\n",
            "TF0.100\r\n",
            "TF0.100, TL0.100",
            "TF+0.100",
            "TF-0.100",
            "TF.100",
            "TF1.",
            "TF1e0",
            "TFNaN",
            "TFInfinity",
            "TF０.１００",
            ",TF0.100",
            "TF0.100,",
            "TF0.100,,TR0.100",
            "TF0.100,TR0.100,TF0.100",
            "TF107.000",
        ] {
            assert!(prepare(&mut radio, text.into()).is_err(), "{text}");
            assert!(radio.deployment.is_none());
        }
    }

    #[test]
    fn payload_byte_limit_rejects_whole_without_trimming() {
        let exact = format!("TF{}0.100", "0".repeat(219));
        assert_eq!(exact.len(), 226);
        assert!(validate_leg(&exact).is_ok());
        let oversized = format!("TF{}0.100", "0".repeat(220));
        assert!(validate_leg(&oversized).unwrap_err().contains("226-byte"));
    }

    #[test]
    fn golden_m2_frames_preserve_seconds_bytes_and_crc32() {
        for (sequence, crc) in [
            ("TF0.250", "D13C58C4"),
            ("TR0.800,TF1.500", "9090BB2F"),
            ("TF2.000,TF2.000", "747AE46D"),
        ] {
            validate_leg(sequence).unwrap();
            let expected = format!("M2:0000000000000001:{crc}:{sequence}");
            let frame = mission_protocol::frame(1, sequence);
            assert_eq!(frame.as_bytes(), expected.as_bytes());
            assert_eq!(frame.len(), HEADER_BYTES + sequence.len());
            assert!(!frame.contains("TIME:"));
        }
    }

    #[test]
    fn timed_prepare_enters_the_existing_deployment_without_authorizing_transmission() {
        let mut radio = Radio::default();
        radio.connection(Some("mock-only".into()));
        let deployment = prepare(&mut radio, "TR0.800,TF1.500".into()).unwrap();
        assert_eq!(deployment.sequence, "TR0.800,TF1.500");
        assert_eq!(
            deployment.mission_key,
            mission_protocol::key(deployment.id, 0x9090BB2F)
        );
        assert!(!deployment.packet_submitted);
        assert!(!deployment.acknowledged);
        assert_eq!(deployment.attempt, 0);
    }

    #[test]
    fn timed_retry_keeps_the_original_m2_identity_and_only_restores_telemetry_after_ack() {
        use crate::mission_deployment::{Phase, ACK_TIMEOUT_MS};
        use std::time::{Duration, Instant};

        // In-memory callbacks only: no serial port, RC action, or physical rover.
        fn tick(radio: &mut Radio, now: Instant, writes: &mut Vec<String>) {
            let mut pending = Vec::new();
            radio
                .drive(now, |command| {
                    pending.push(command.to_owned());
                    Ok(())
                })
                .unwrap();
            for command in pending {
                if command == "TX" {
                    radio.line("[MISSION PROTOCOL] V2", now);
                    radio.line("[MODE] TX MODE", now);
                } else if command == "RX" {
                    radio.line("[MODE] RX MODE", now);
                }
                writes.push(command);
            }
        }

        let mut radio = Radio::default();
        radio.connection(Some("mock-only".into()));
        let deployment = prepare(&mut radio, "TR0.800,TF1.500".into()).unwrap();
        let mut writes = Vec::new();
        let mut now = Instant::now();
        tick(&mut radio, now, &mut writes);
        assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Ready);
        assert!(!writes.iter().any(|command| command.starts_with("MISSION:")));
        radio.confirm(deployment.id).unwrap();
        tick(&mut radio, now, &mut writes);
        tick(&mut radio, now, &mut writes);
        let frame = mission_protocol::frame(deployment.id, "TR0.800,TF1.500");
        assert_eq!(writes.last().unwrap(), &format!("MISSION:{frame}|1"));
        radio.line(
            &format!("[MISSION TX_DONE] {}:1:1500", deployment.mission_key),
            now,
        );
        now += Duration::from_millis(ACK_TIMEOUT_MS + 1);
        tick(&mut radio, now, &mut writes);
        now += Duration::from_millis(201);
        tick(&mut radio, now, &mut writes);
        assert_eq!(writes.last().unwrap(), &format!("MISSION:{frame}|2"));
        radio.line(
            &format!("[MISSION TX_DONE] {}:2:1500", deployment.mission_key),
            now,
        );
        radio.line(&format!("[RAW RX]: ACK2:{}", deployment.mission_key), now);
        assert_eq!(
            radio.deployment.as_ref().unwrap().phase,
            Phase::Acknowledged
        );
        tick(&mut radio, now, &mut writes);
        assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Restore);
        radio.telemetry();
        assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Complete);
        assert!(writes.iter().all(|command| command == "TX"
            || command == "RX"
            || command.starts_with("MISSION:M2:")));
    }
}
