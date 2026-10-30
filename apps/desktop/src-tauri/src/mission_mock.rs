//! Test-only serial/LoRa transport. This module is compiled only under cfg(test)
//! and never emits Tauri events or supplies application telemetry.
use super::*;

const PAYLOAD: &str = "R90,F12.3,L45,F2";

#[derive(Default)]
struct MockRover {
    rx: bool,
    drop_acks: usize,
    latest: Option<(u64, String)>,
    mega_lines: Vec<String>,
}

impl MockRover {
    fn receive(&mut self, packet: &str) -> Option<String> {
        if !self.rx {
            return None;
        }
        let fields: Vec<_> = packet.splitn(4, ':').collect();
        assert_eq!(fields[0], "M2");
        let id = u64::from_str_radix(fields[1], 16).unwrap();
        let checksum = u32::from_str_radix(fields[2], 16).unwrap();
        assert_eq!(mission_protocol::checksum(fields[3]), checksum);
        let key = mission_protocol::key(id, checksum);
        match &self.latest {
            Some((old_id, _)) if *old_id > id => {
                return Some(format!("NACK2:{key}:STALE_MISSION_ID"))
            }
            Some((old_id, old_packet)) if *old_id == id => assert_eq!(old_packet, packet),
            _ => {
                self.latest = Some((id, packet.into()));
                self.mega_lines.push(format!("RCV:{}", fields[3]));
            }
        }
        if self.drop_acks > 0 {
            self.drop_acks -= 1;
            None
        } else {
            Some(format!("ACK2:{key}"))
        }
    }
}

#[derive(Default)]
struct MockTransport {
    commands: Vec<String>,
    packets: Vec<String>,
    in_flight: Option<(String, u32)>,
    rover: MockRover,
    ack_window: u64,
}

impl MockTransport {
    fn tick(&mut self, radio: &mut Radio, now: Instant) {
        let mut written = Vec::new();
        radio
            .drive(now, |command| {
                written.push(command.to_string());
                Ok(())
            })
            .unwrap();
        for command in written {
            self.commands.push(command.clone());
            match command.as_str() {
                "TX" | "RX" | "STATUS" => {
                    radio.line("[MISSION PROTOCOL] V2", now);
                    if command == "TX" {
                        radio.line("[MODE] TX MODE", now);
                    } else {
                        self.in_flight = None;
                        radio.line("[MODE] RX MODE", now);
                    }
                }
                _ => {
                    assert!(self.in_flight.is_none(), "Overlapping radio transmission");
                    let (packet, attempt) = command
                        .strip_prefix("MISSION:")
                        .unwrap()
                        .rsplit_once('|')
                        .unwrap();
                    let attempt: u32 = attempt.parse().unwrap();
                    self.packets.push(packet.to_string());
                    self.in_flight = Some((packet.to_string(), attempt));
                    radio.line(
                        &format!(
                            "[MISSION SUBMITTED] {}:{attempt}",
                            radio.deployment.as_ref().unwrap().mission_key
                        ),
                        now,
                    );
                }
            }
        }
    }

    fn complete_tx(&mut self, radio: &mut Radio, now: Instant) {
        let (packet, attempt) = self.in_flight.take().expect("No transmission to complete");
        let key = radio.deployment.as_ref().unwrap().mission_key.clone();
        let timeout = self.ack_window.max(ACK_TIMEOUT_MS);
        radio.line(&format!("[MISSION TX_DONE] {key}:{attempt}:{timeout}"), now);
        if let Some(ack) = self.rover.receive(&packet) {
            radio.line(&format!("[RAW RX]: {ack}"), now);
        }
    }

    fn next_attempt(&mut self, radio: &mut Radio, now: &mut Instant) {
        let timeout = radio.deployment.as_ref().unwrap().ack_timeout_ms;
        *now += Duration::from_millis(timeout + 1);
        self.tick(radio, *now);
        assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Retrying);
        *now += RETRY_PAUSE + Duration::from_millis(1);
        self.tick(radio, *now);
    }
}

fn prepared(now: Instant) -> (Radio, u64, MockTransport) {
    let mut radio = Radio::default();
    radio.connection(Some("mock-detected-port".into()));
    let id = radio.begin(PAYLOAD.into()).unwrap().id;
    let mut transport = MockTransport::default();
    transport.tick(&mut radio, now);
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Ready);
    (radio, id, transport)
}

fn start(now: Instant) -> (Radio, u64, MockTransport) {
    let (mut radio, id, mut transport) = prepared(now);
    radio.confirm(id).unwrap();
    transport.tick(&mut radio, now); // A fresh TX confirmation.
    transport.tick(&mut radio, now); // Submit attempt 1, not its completion.
    (radio, id, transport)
}

#[test]
fn first_attempt_success_restores_rx_then_requires_fresh_telemetry() {
    let now = Instant::now();
    let (mut radio, _, mut transport) = start(now);
    transport.rover.rx = true;
    radio.telemetry();
    assert!(!radio.deployment.as_ref().unwrap().telemetry_seen);
    transport.complete_tx(&mut radio, now);
    assert_eq!(
        radio.deployment.as_ref().unwrap().phase,
        Phase::Acknowledged
    );
    radio.telemetry();
    assert!(!radio.deployment.as_ref().unwrap().telemetry_seen);
    transport.tick(&mut radio, now);
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Restore);
    radio.telemetry();
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Complete);
    assert_eq!(transport.rover.mega_lines, [format!("RCV:{PAYLOAD}")]);
    assert_eq!(transport.packets.len(), 1);
}

#[test]
fn fourth_attempt_ack_after_three_lost_acks_forwards_to_mega_once() {
    let mut now = Instant::now();
    let (mut radio, _, mut transport) = start(now);
    transport.rover.rx = true;
    transport.rover.drop_acks = 3;
    for attempt in 1..=4 {
        assert_eq!(radio.deployment.as_ref().unwrap().attempt, attempt);
        transport.complete_tx(&mut radio, now);
        if attempt < 4 {
            transport.next_attempt(&mut radio, &mut now);
        }
    }
    assert!(radio.deployment.as_ref().unwrap().acknowledged);
    assert_eq!(transport.rover.mega_lines.len(), 1);
    assert!(transport
        .packets
        .iter()
        .all(|packet| packet == &transport.packets[0]));
    assert_eq!(transport.commands.iter().filter(|c| *c == "TX").count(), 2);
    assert!(!transport.commands.iter().any(|c| c == "RX"));
}

#[test]
fn eight_attempts_without_ack_recover_rx_and_never_run_a_ninth_in_background() {
    let mut now = Instant::now();
    let (mut radio, id, mut transport) = start(now);
    for attempt in 1..=8 {
        transport.complete_tx(&mut radio, now);
        if attempt < 8 {
            transport.next_attempt(&mut radio, &mut now);
        }
    }
    now += Duration::from_millis(1501);
    transport.tick(&mut radio, now);
    let d = radio.deployment.as_ref().unwrap();
    assert_eq!(d.phase, Phase::Failed);
    assert!(d.retry_exhausted && d.rx_restored);
    assert_eq!(d.failure_code, Some("ACK_EXHAUSTED"));
    transport.tick(&mut radio, now + Duration::from_secs(100));
    assert_eq!(transport.packets.len(), 8);
    assert!(
        radio.begin(PAYLOAD.into()).is_err(),
        "Unresolved delivery must not be replaced"
    );
    radio.cancel(id);
    assert!(radio.begin(PAYLOAD.into()).is_ok());
}

#[test]
fn correcting_rover_mode_during_retries_recovers_without_restarting_the_deployment() {
    let mut now = Instant::now();
    let (mut radio, id, mut transport) = start(now);
    for _ in 0..2 {
        transport.complete_tx(&mut radio, now);
        transport.next_attempt(&mut radio, &mut now);
    }
    transport.rover.rx = true;
    transport.complete_tx(&mut radio, now);
    let d = radio.deployment.as_ref().unwrap();
    assert_eq!(d.id, id);
    assert_eq!(d.attempt, 3);
    assert!(d.acknowledged);
    assert_eq!(transport.rover.mega_lines.len(), 1);
}

#[test]
fn lost_ack_after_receipt_retries_the_same_id_without_a_second_mega_delivery() {
    let mut now = Instant::now();
    let (mut radio, _, mut transport) = start(now);
    transport.rover.rx = true;
    transport.rover.drop_acks = 1;
    transport.complete_tx(&mut radio, now);
    assert_eq!(transport.rover.mega_lines.len(), 1);
    assert!(!radio.deployment.as_ref().unwrap().acknowledged);
    transport.next_attempt(&mut radio, &mut now);
    transport.complete_tx(&mut radio, now);
    assert!(radio.deployment.as_ref().unwrap().acknowledged);
    assert_eq!(transport.rover.mega_lines.len(), 1);
}

#[test]
fn duplicate_late_and_wrong_acks_cannot_start_extra_transmissions() {
    let mut now = Instant::now();
    let (mut radio, _, mut transport) = start(now);
    let key = radio.deployment.as_ref().unwrap().mission_key.clone();
    radio.line(&format!("[RAW RX]: ACK2:{key}"), now); // No packet completion yet.
    assert!(!radio.deployment.as_ref().unwrap().acknowledged);
    transport.complete_tx(&mut radio, now);
    for ack in ["ACK:F1", "ACK2:0000000000000001:00000000", "PONG"] {
        radio.line(&format!("[RAW RX]: {ack}"), now);
        assert!(!radio.deployment.as_ref().unwrap().acknowledged);
    }
    now += Duration::from_millis(1501);
    transport.tick(&mut radio, now);
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Retrying);
    radio.line(&format!("[RAW RX]: ACK2:{key}"), now); // Late, but still this active mission.
    radio.line(&format!("[RAW RX]: ACK2:{key}"), now);
    transport.tick(&mut radio, now);
    assert_eq!(transport.packets.len(), 1);
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Restore);
}

#[test]
fn usb_disconnection_drops_in_flight_state_and_never_replays_commands_on_reconnect() {
    let now = Instant::now();
    let (mut radio, id, mut transport) = start(now);
    radio.connection(None);
    assert_eq!(
        radio.deployment.as_ref().unwrap().failure_code,
        Some("USB_DISCONNECTED")
    );
    assert!(radio.retry(id).is_err());
    radio.connection(Some("mock-reconnected-port".into()));
    transport.tick(&mut radio, now);
    assert_eq!(transport.packets.len(), 1);
    assert_eq!(radio.mode.as_deref(), Some("RX"));
    assert!(radio.begin(PAYLOAD.into()).is_err());
    radio.retry(id).unwrap();
    assert_eq!(radio.deployment.as_ref().unwrap().id, id);
}

#[test]
fn cancellation_before_submission_and_during_local_tx_suppresses_all_future_retries() {
    let now = Instant::now();
    let (mut radio, id, mut transport) = prepared(now);
    radio.cancel(id);
    transport.tick(&mut radio, now);
    assert!(transport.packets.is_empty());
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Cancelled);
    let (mut radio, id, mut transport) = start(now);
    radio.cancel(id);
    transport.tick(&mut radio, now);
    assert!(transport.in_flight.is_none());
    transport.tick(&mut radio, now + Duration::from_secs(100));
    assert_eq!(transport.packets.len(), 1);
    radio.cancel(id); // Cleanup is idempotent, including after recovery failure.
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Cancelled);
}

#[test]
fn cancellation_after_receipt_does_not_recall_a_packet_or_accept_a_late_ack() {
    let now = Instant::now();
    let (mut radio, id, mut transport) = start(now);
    transport.rover.rx = true;
    transport.rover.drop_acks = 1;
    transport.complete_tx(&mut radio, now);
    let key = radio.deployment.as_ref().unwrap().mission_key.clone();
    radio.cancel(id);
    radio.line(&format!("[RAW RX]: ACK2:{key}"), now);
    transport.tick(&mut radio, now);
    assert!(!radio.deployment.as_ref().unwrap().acknowledged);
    assert_eq!(transport.rover.mega_lines.len(), 1);
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Cancelled);
}

#[test]
fn manual_retry_keeps_identity_requires_reconfirmation_and_never_duplicates_the_handoff() {
    let mut now = Instant::now();
    let (mut radio, id, mut transport) = start(now);
    transport.rover.rx = true;
    transport.rover.drop_acks = 8;
    for attempt in 1..=8 {
        transport.complete_tx(&mut radio, now);
        if attempt < 8 {
            transport.next_attempt(&mut radio, &mut now);
        }
    }
    now += Duration::from_millis(1501);
    transport.tick(&mut radio, now);
    radio.retry(id).unwrap();
    transport.tick(&mut radio, now);
    transport.tick(&mut radio, now + Duration::from_secs(1));
    assert_eq!(
        transport.packets.len(),
        8,
        "Safety reconfirmation is required"
    );
    radio.confirm(id).unwrap();
    assert!(radio.confirm(id).is_err());
    transport.tick(&mut radio, now);
    transport.tick(&mut radio, now);
    transport.complete_tx(&mut radio, now);
    assert_eq!(radio.deployment.as_ref().unwrap().id, id);
    assert!(radio.deployment.as_ref().unwrap().acknowledged);
    assert_eq!(transport.rover.mega_lines.len(), 1);
}

#[test]
fn ack_timer_begins_after_radio_completion_and_honors_the_firmware_airtime_budget() {
    let now = Instant::now();
    let (mut radio, _, mut transport) = start(now);
    transport.tick(&mut radio, now + Duration::from_secs(10));
    assert_eq!(transport.packets.len(), 1);
    assert_eq!(
        radio.deployment.as_ref().unwrap().phase,
        Phase::Transmitting
    );
    transport.ack_window = 3000;
    transport.complete_tx(&mut radio, now + Duration::from_secs(10));
    transport.tick(&mut radio, now + Duration::from_millis(12999));
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::WaitAck);
    transport.tick(&mut radio, now + Duration::from_millis(13001));
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Retrying);
}

#[test]
fn missing_packet_completion_restores_rx_instead_of_overlapping_a_transmission() {
    let now = Instant::now();
    let (mut radio, _, mut transport) = start(now);
    transport.tick(
        &mut radio,
        now + TX_COMPLETION_TIMEOUT + Duration::from_millis(1),
    );
    assert_eq!(transport.packets.len(), 1);
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Failed);
    assert_eq!(
        radio.deployment.as_ref().unwrap().failure_code,
        Some("TX_COMPLETION_TIMEOUT")
    );
}

#[test]
fn legacy_ground_station_never_receives_a_retriable_mission() {
    let now = Instant::now();
    let mut radio = Radio::default();
    radio.connection(Some("mock-old-firmware".into()));
    radio.begin(PAYLOAD.into()).unwrap();
    radio.drive(now, |_| Ok(())).unwrap();
    radio.line("[MODE] TX MODE", now);
    assert_eq!(
        radio.deployment.as_ref().unwrap().failure_code,
        Some("PROTOCOL_REQUIRED")
    );
    let mut commands = Vec::new();
    radio
        .drive(now, |c| {
            commands.push(c.to_string());
            Ok(())
        })
        .unwrap();
    assert_eq!(commands, ["RX"]);
}

#[test]
fn oversize_routes_are_rejected_whole_and_never_truncated() {
    let mut radio = Radio::default();
    radio.connection(Some("mock-port".into()));
    assert!(radio
        .begin("F1,".repeat(76))
        .unwrap_err()
        .contains("226-byte"));
    assert!(radio.deployment.is_none());
}

#[test]
fn tx_mode_timeout_restores_rx_without_submitting_a_mission() {
    let now = Instant::now();
    let mut radio = Radio::default();
    radio.connection(Some("mock-port".into()));
    radio.begin(PAYLOAD.into()).unwrap();
    let mut written = Vec::new();
    radio
        .drive(now, |c| {
            written.push(c.to_string());
            Ok(())
        })
        .unwrap();
    radio
        .drive(now + Duration::from_secs(8), |c| {
            written.push(c.to_string());
            Ok(())
        })
        .unwrap();
    assert_eq!(written, ["TX", "RX"]);
    assert_eq!(
        radio.deployment.as_ref().unwrap().failure_code,
        Some("TX_MODE_FAILED")
    );
    assert!(!radio.deployment.as_ref().unwrap().packet_submitted);
}

#[test]
fn old_completion_logs_cannot_advance_a_new_submission_of_the_same_mission() {
    let mut now = Instant::now();
    let (mut radio, _, mut transport) = start(now);
    let key = radio.deployment.as_ref().unwrap().mission_key.clone();
    transport.complete_tx(&mut radio, now);
    transport.next_attempt(&mut radio, &mut now);
    radio.line(&format!("[MISSION TX_DONE] {key}:1:1500"), now);
    assert_eq!(
        radio.deployment.as_ref().unwrap().phase,
        Phase::Transmitting
    );
    assert!(!radio.deployment.as_ref().unwrap().radio_transmitted);
    transport.complete_tx(&mut radio, now);
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::WaitAck);
}

#[test]
fn a_partial_serial_write_has_an_unknown_delivery_outcome_until_explicit_recovery() {
    let now = Instant::now();
    let (mut radio, id, mut transport) = prepared(now);
    radio.confirm(id).unwrap();
    transport.tick(&mut radio, now);
    assert!(radio
        .drive(now, |_| Err("mock partial write".into()))
        .is_err());
    assert!(radio.begin(PAYLOAD.into()).is_err());
    assert!(!radio.deployment.as_ref().unwrap().packet_submitted);
    radio.cancel(id);
    transport.tick(&mut radio, now);
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Cancelled);
}

#[test]
fn firmware_rejection_unsafe_uart_outcome_rx_failure_and_serial_write_failure_are_real_errors() {
    let now = Instant::now();
    let (mut radio, _, mut transport) = start(now);
    let key = radio.deployment.as_ref().unwrap().mission_key.clone();
    radio.line(
        &format!("[RAW RX]: NACK2:{key}:HANDOFF_OUTCOME_UNKNOWN"),
        now,
    );
    transport.tick(&mut radio, now);
    assert_eq!(
        radio.deployment.as_ref().unwrap().failure_code,
        Some("ROVER_REJECTED")
    );
    assert!(!radio.deployment.as_ref().unwrap().acknowledged);
    let (mut radio, id, _) = prepared(now);
    radio.cancel(id);
    radio.drive(now, |_| Ok(())).unwrap();
    radio
        .drive(now + Duration::from_secs(8), |_| Ok(()))
        .unwrap();
    assert_eq!(
        radio.deployment.as_ref().unwrap().failure_code,
        Some("RX_RESTORE_FAILED")
    );
    radio.cancel(id);
    assert!(radio.deployment.as_ref().unwrap().pending.is_none());
    let (mut radio, id, _) = prepared(now);
    radio.confirm(id).unwrap();
    assert!(radio
        .drive(now, |_| Err("mock USB write error".into()))
        .is_err());
    assert_eq!(
        radio.deployment.as_ref().unwrap().failure_code,
        Some("SERIAL_WRITE_FAILED")
    );
}

#[test]
fn absent_telemetry_and_generic_json_never_unlock_start_instructions() {
    let now = Instant::now();
    let (mut radio, _, mut transport) = start(now);
    transport.rover.rx = true;
    transport.complete_tx(&mut radio, now);
    transport.tick(&mut radio, now);
    transport.tick(&mut radio, now + Duration::from_secs(31));
    assert_eq!(radio.deployment.as_ref().unwrap().phase, Phase::Failed);
    assert!(!radio.deployment.as_ref().unwrap().telemetry_seen);
    assert!(!is_rover_telemetry(&serde_json::json!({"seq":1})));
    assert!(is_rover_telemetry(
        &serde_json::json!({"seq":1,"lat":0,"lng":0,"soilValid":0})
    ));
}
