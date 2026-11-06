use crate::mission_protocol;
use serde::Serialize;
use std::collections::VecDeque;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// Only ACK timeout retries are automatic. A local write/TX failure is recovered,
// never overlapped with another packet whose completion is unknown.
pub const MAX_ATTEMPTS: u8 = 8;
pub const ACK_TIMEOUT_MS: u64 = 1500;
const RETRY_PAUSE: Duration = Duration::from_millis(200);
const TX_COMPLETION_TIMEOUT: Duration = Duration::from_secs(22);
const MODE_TIMEOUT: Duration = Duration::from_secs(7);

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Phase {
    Preparing,
    SwitchTx,
    Ready,
    Transmitting,
    WaitAck,
    Retrying,
    Acknowledged,
    SwitchRx,
    Restore,
    Complete,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
pub struct Deployment {
    pub id: u64,
    pub sequence: String,
    pub mission_key: String,
    pub phase: Phase,
    pub error: Option<String>,
    pub failure_code: Option<&'static str>,
    pub acknowledged: bool,
    pub telemetry_seen: bool,
    pub attempt: u8,
    pub submission: u32,
    pub max_attempts: u8,
    pub ack_timeout_ms: u64,
    pub packet_submitted: bool,
    pub ground_submitted: bool,
    pub radio_transmitted: bool,
    pub rx_restored: bool,
    pub retry_exhausted: bool,
    pub evidence: VecDeque<String>,
    #[serde(skip)]
    confirmed: bool,
    #[serde(skip)]
    cancelled: bool,
    #[serde(skip)]
    transmitted_attempts: u32,
    #[serde(skip)]
    delivery_possible: bool,
    #[serde(skip)]
    deadline: Option<Instant>,
    #[serde(skip)]
    pending: Option<String>,
}

impl Deployment {
    fn active(&self) -> bool {
        !matches!(
            self.phase,
            Phase::Complete | Phase::Failed | Phase::Cancelled
        )
    }

    fn unresolved(&self) -> bool {
        self.delivery_possible && !self.acknowledged && !self.cancelled
    }

    fn mission_command(&self) -> String {
        format!(
            "MISSION:{}|{}",
            mission_protocol::frame(self.id, &self.sequence),
            self.submission + 1
        )
    }

    fn restore(&mut self, code: &'static str, error: Option<String>) {
        self.failure_code = if error.is_some() { Some(code) } else { None };
        self.error = error;
        self.phase = Phase::SwitchRx;
        self.pending = Some("RX".into());
        self.deadline = None;
        self.rx_restored = false;
    }
}

#[derive(Default, Serialize)]
pub struct Radio {
    pub connected: bool,
    pub port: Option<String>,
    pub mode: Option<String>,
    pub protocol_v2: bool,
    pub revision: u64,
    pub deployment: Option<Deployment>,
    #[serde(skip)]
    next_id: u64,
    #[serde(skip)]
    commands: VecDeque<String>,
}

pub fn confirmed_mode(line: &str) -> Option<&'static str> {
    match line {
        "[MODE] RX MODE" | "[MODE] Already in RX mode." | "[STATUS] Current mode: RX" => Some("RX"),
        "[MODE] TX MODE" | "[MODE] Already in TX mode." | "[STATUS] Current mode: TX" => Some("TX"),
        _ => None,
    }
}

pub fn validate_sequence(sequence: &str) -> Result<(), String> {
    if sequence.is_empty()
        || !sequence
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == ',' || c == '.')
    {
        return Err("Invalid or empty movement sequence.".into());
    }
    Ok(())
}

pub fn is_rover_telemetry(json: &serde_json::Value) -> bool {
    json.get("error").is_none()
        && json
            .get("seq")
            .and_then(serde_json::Value::as_u64)
            .is_some()
        && json
            .get("lat")
            .and_then(serde_json::Value::as_f64)
            .is_some()
        && json
            .get("lng")
            .and_then(serde_json::Value::as_f64)
            .is_some()
        && json
            .get("soilValid")
            .and_then(serde_json::Value::as_i64)
            .is_some()
}

impl Radio {
    pub fn connection(&mut self, port: Option<String>) {
        self.connected = port.is_some();
        self.port = port;
        self.mode = None;
        self.protocol_v2 = false;
        self.commands.clear();
        if self.connected {
            self.commands.push_back("RX".into());
            self.commands.push_back("STATUS".into());
        } else if let Some(d) = self
            .deployment
            .as_mut()
            .filter(|d| d.active() || d.phase == Phase::Complete)
        {
            d.phase = Phase::Failed;
            d.failure_code = Some("USB_DISCONNECTED");
            d.error = Some("USB connection lost. Delivery may already have occurred. RX restoration could not be verified. Reconnect and recover the same mission; do not arm.".into());
            d.pending = None;
            d.deadline = None;
            d.rx_restored = false;
        }
        self.revision += 1;
    }

    pub fn begin(&mut self, sequence: String) -> Result<Deployment, String> {
        validate_sequence(&sequence)?;
        if sequence.len() + mission_protocol::HEADER_BYTES > mission_protocol::MAX_PACKET_BYTES {
            return Err("Mission exceeds the 226-byte V2 payload limit. The sequence was not truncated or sent; reduce the route.".into());
        }
        if !self.connected {
            return Err("Waiting for rover — Check USB/COM port".into());
        }
        if self
            .deployment
            .as_ref()
            .is_some_and(|d| d.active() || d.unresolved())
        {
            return Err("Resolve the earlier upload with Retry Mission or Cancel before creating another mission.".into());
        }
        self.commands.clear();
        // Microseconds are also exactly representable by JS numbers for current
        // dates. Monotonic IDs allow the rover to reject older delayed missions.
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_micros() as u64;
        self.next_id = timestamp.max(self.next_id + 1);
        let d = Deployment {
            id: self.next_id,
            mission_key: mission_protocol::key(self.next_id, mission_protocol::checksum(&sequence)),
            sequence,
            phase: Phase::Preparing,
            error: None,
            failure_code: None,
            acknowledged: false,
            telemetry_seen: false,
            attempt: 0,
            submission: 0,
            max_attempts: MAX_ATTEMPTS.max(1),
            ack_timeout_ms: ACK_TIMEOUT_MS,
            packet_submitted: false,
            ground_submitted: false,
            radio_transmitted: false,
            rx_restored: false,
            retry_exhausted: false,
            evidence: VecDeque::new(),
            confirmed: false,
            cancelled: false,
            transmitted_attempts: 0,
            delivery_possible: false,
            deadline: None,
            pending: Some("TX".into()),
        };
        self.deployment = Some(d.clone());
        self.revision += 1;
        Ok(d)
    }

    pub fn retry(&mut self, id: u64) -> Result<(), String> {
        let d = self
            .deployment
            .as_mut()
            .filter(|d| d.id == id)
            .ok_or("Deployment no longer exists.")?;
        if !self.connected
            || self.mode.as_deref() != Some("RX")
            || d.phase != Phase::Failed
            || d.acknowledged
            || d.cancelled
            || d.failure_code == Some("ROVER_REJECTED")
        {
            return Err(
                "Recover USB and confirmed desktop RX before retrying an unacknowledged mission."
                    .into(),
            );
        }
        self.commands.clear();
        d.attempt = 0;
        d.confirmed = false;
        d.retry_exhausted = false;
        d.ground_submitted = false;
        d.radio_transmitted = false;
        d.error = None;
        d.failure_code = None;
        d.telemetry_seen = false;
        d.phase = Phase::Preparing;
        d.pending = Some("TX".into());
        d.deadline = None;
        self.revision += 1;
        Ok(())
    }

    pub fn confirm(&mut self, id: u64) -> Result<(), String> {
        let d = self
            .deployment
            .as_mut()
            .filter(|d| d.id == id)
            .ok_or("Deployment no longer exists.")?;
        if !self.connected || d.phase != Phase::Ready {
            return Err("Wait for desktop TX preparation before confirming.".into());
        }
        d.confirmed = true;
        d.phase = Phase::SwitchTx;
        d.pending = Some("TX".into());
        d.deadline = None;
        self.revision += 1;
        Ok(())
    }

    pub fn cancel(&mut self, id: u64) {
        if let Some(d) = self
            .deployment
            .as_mut()
            .filter(|d| d.id == id && (d.active() || d.phase == Phase::Failed))
        {
            if d.cancelled {
                return;
            }
            d.cancelled = true;
            if self.connected && self.mode.as_deref() != Some("RX") {
                d.restore("CANCELLED", None); // Atomically removes an unsent attempt.
            } else {
                d.phase = Phase::Cancelled;
                d.pending = None;
                d.deadline = None;
            }
            self.revision += 1;
        }
    }

    pub fn queue(&mut self, command: String) -> Result<(), String> {
        if !self.connected {
            return Err("Desktop LoRa receiver is not connected.".into());
        }
        if self
            .deployment
            .as_ref()
            .is_some_and(|d| d.active() || (d.unresolved() && command.starts_with("MISSION:")))
        {
            return Err("Radio is managed by the deployment assistant.".into());
        }
        self.commands.push_back(command);
        Ok(())
    }

    // The serial owner and cancel/confirm share one mutex. Nothing schedules
    // retries in detached tasks, timers or the dialog.
    pub fn drive(
        &mut self,
        now: Instant,
        mut write: impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        if !self.connected {
            return Ok(());
        }
        if let Some(d) = self.deployment.as_mut().filter(|d| d.active()) {
            if d.deadline.is_some_and(|deadline| now >= deadline) {
                match d.phase {
                    Phase::WaitAck if d.attempt < d.max_attempts => {
                        d.phase = Phase::Retrying;
                        d.deadline = Some(now + RETRY_PAUSE);
                    }
                    Phase::Retrying => {
                        d.phase = Phase::Transmitting;
                        d.pending = Some(d.mission_command());
                        d.deadline = None;
                    }
                    Phase::WaitAck => {
                        d.retry_exhausted = true;
                        d.restore("ACK_EXHAUSTED", Some(format!("No valid matching rover ACK after {} attempts. Delivery is unconfirmed; the rover may have received the mission.", d.max_attempts)));
                    }
                    Phase::SwitchRx => {
                        d.error = Some(format!("{} Failed to restore desktop RX.", d.error.as_deref().unwrap_or("")));
                        d.failure_code = Some("RX_RESTORE_FAILED");
                        d.phase = Phase::Failed;
                        d.deadline = None;
                        d.pending = None;
                        self.mode = None;
                    }
                    Phase::SwitchTx => d.restore("TX_MODE_FAILED", Some("Desktop LoRa did not confirm TX mode.".into())),
                    Phase::Transmitting => d.restore("TX_COMPLETION_TIMEOUT", Some("Radio packet completion was not confirmed. No overlapping retry was sent.".into())),
                    Phase::Restore => d.restore("TELEMETRY_TIMEOUT", Some("No fresh rover telemetry received. Check rover CH8 = TX. Do not arm.".into())),
                    _ => {}
                }
                self.revision += 1;
            }
            if let Some(command) = d.pending.take() {
                if command.starts_with("MISSION:") {
                    d.delivery_possible = true;
                }
                if let Err(error) = write(&command) {
                    d.phase = Phase::Failed;
                    d.failure_code = Some("SERIAL_WRITE_FAILED");
                    d.error = Some(format!(
                        "Serial write failed: {error}. RX restoration is unconfirmed."
                    ));
                    d.deadline = None;
                    self.mode = None;
                    self.revision += 1;
                    return Err(error);
                }
                match command.as_str() {
                    "TX" => {
                        d.phase = Phase::SwitchTx;
                        d.rx_restored = false;
                        self.mode = None;
                        d.deadline = Some(now + MODE_TIMEOUT);
                    }
                    "RX" => {
                        d.phase = Phase::SwitchRx;
                        self.mode = None;
                        d.deadline = Some(now + MODE_TIMEOUT);
                    }
                    _ => {
                        d.phase = Phase::Transmitting;
                        d.attempt += 1;
                        d.submission += 1;
                        d.packet_submitted = true;
                        d.ground_submitted = false;
                        d.radio_transmitted = false;
                        d.deadline = Some(now + TX_COMPLETION_TIMEOUT);
                    }
                }
                self.revision += 1;
            }
        } else {
            while let Some(command) = self.commands.pop_front() {
                write(&command)?;
            }
        }
        Ok(())
    }

    pub fn line(&mut self, line: &str, now: Instant) {
        if line == "[MISSION PROTOCOL] V2" {
            self.protocol_v2 = true;
            self.revision += 1;
        }
        let mode = confirmed_mode(line);
        if let Some(mode) = mode {
            self.mode = Some(mode.into());
            self.revision += 1;
        }
        let Some(d) = self.deployment.as_mut().filter(|d| d.active()) else {
            return;
        };
        if !line.starts_with('[') {
            return;
        }
        if d.evidence.len() == 16 {
            d.evidence.pop_front();
        }
        d.evidence.push_back(line.into());
        self.revision += 1;
        if d.phase == Phase::SwitchRx && d.pending.is_none() && mode == Some("RX") {
            d.rx_restored = true;
            d.deadline = None;
            d.phase = if d.cancelled {
                Phase::Cancelled
            } else if d.error.is_some() {
                Phase::Failed
            } else {
                Phase::Restore
            };
            if d.phase == Phase::Restore {
                d.deadline = Some(now + Duration::from_secs(30));
            }
        } else if d.phase == Phase::SwitchTx && d.pending.is_none() && mode == Some("TX") {
            d.deadline = None;
            if !self.protocol_v2 {
                d.restore("PROTOCOL_REQUIRED", Some("Desktop ESP32 requires coordinated MISSION_V2 firmware. No mission was sent.".into()));
            } else if d.confirmed {
                d.phase = Phase::Transmitting;
                d.pending = Some(d.mission_command());
            } else {
                d.phase = Phase::Ready;
            }
        } else if matches!(
            d.phase,
            Phase::Transmitting | Phase::WaitAck | Phase::Retrying
        ) {
            let attempt_key = format!("{}:{}", d.mission_key, d.submission);
            if line == format!("[MISSION SUBMITTED] {attempt_key}") && d.pending.is_none() {
                d.ground_submitted = true;
            }
            if d.phase == Phase::Transmitting && d.pending.is_none() {
                if let Some(timeout) = line
                    .strip_prefix(&format!("[MISSION TX_DONE] {attempt_key}:"))
                    .and_then(|v| v.parse::<u64>().ok())
                    .filter(|ms| (100..=10000).contains(ms))
                {
                    d.radio_transmitted = true;
                    d.transmitted_attempts += 1;
                    d.phase = Phase::WaitAck;
                    d.ack_timeout_ms = timeout.max(ACK_TIMEOUT_MS);
                    d.deadline = Some(now + Duration::from_millis(d.ack_timeout_ms));
                }
            }
            if d.transmitted_attempts > 0 && line == format!("[RAW RX]: ACK2:{}", d.mission_key) {
                d.acknowledged = true;
                d.phase = Phase::Acknowledged;
                d.pending = Some("RX".into());
                d.deadline = None;
            } else if line.starts_with(&format!("[RAW RX]: NACK2:{}:", d.mission_key)) {
                d.restore(
                    "ROVER_REJECTED",
                    Some(format!("Rover rejected this mission: {line}")),
                );
            }
        }
        if line.starts_with("[ERROR]")
            || line.contains("Mission transmission failed")
            || line.contains("Could not start mission packet")
        {
            if d.phase == Phase::SwitchRx {
                d.error = Some(format!(
                    "{} RX restoration failed: {line}",
                    d.error.as_deref().unwrap_or("")
                ));
                d.failure_code = Some("RX_RESTORE_FAILED");
                d.phase = Phase::Failed;
                d.pending = None;
                d.deadline = None;
                self.mode = None;
            } else {
                d.restore("TRANSMISSION_FAILED", Some(line.into()));
            }
        }
    }

    pub fn telemetry(&mut self) {
        if let Some(d) = self
            .deployment
            .as_mut()
            .filter(|d| d.phase == Phase::Restore)
        {
            d.telemetry_seen = true;
            d.phase = Phase::Complete;
            d.deadline = None;
            self.revision += 1;
        }
    }
}

#[cfg(test)]
#[path = "mission_mock.rs"]
mod tests;
