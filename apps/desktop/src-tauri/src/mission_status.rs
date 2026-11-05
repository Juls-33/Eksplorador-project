//! Mega observations are independent of the upload transport state machine.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionStatus {
    #[serde(rename = "type")]
    kind: String,
    pub mission_id: String,
    pub status_seq: u32,
    pub state: String,
    pub step: u8,
    pub reason: String,
    pub rssi: i16,
    pub snr: f64,
}

impl MissionStatus {
    pub fn parse(json: serde_json::Value) -> Option<Self> {
        let status: Self = serde_json::from_value(json).ok()?;
        let token = |s: &str, max| {
            !s.is_empty()
                && s.len() <= max
                && s.bytes().all(|c| c.is_ascii_uppercase() || c == b'_')
        };
        (status.kind == "missionStatus"
            && status.mission_id.len() == 16
            && status
                .mission_id
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'A'..=b'F').contains(&c))
            && status.mission_id != "0000000000000000"
            && status.status_seq > 0
            && status.step <= 40
            && (status.state != "STAGED" || status.step == 0)
            && (!["STEP_DONE", "PIN_CHECKED"].contains(&status.state.as_str()) || status.step >= 1)
            && token(&status.state, 21)
            && !status.reason.is_empty()
            && status.reason.len() <= 33
            && status
                .reason
                .bytes()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
            && (-200..=0).contains(&status.rssi)
            && status.snr.is_finite()
            && (-30.0..=30.0).contains(&status.snr))
        .then_some(status)
    }

    pub fn same_report(&self, other: &Self) -> bool {
        self.mission_id == other.mission_id
            && self.status_seq == other.status_seq
            && self.state == other.state
            && self.step == other.step
            && self.reason == other.reason
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_a30_states_reasons_and_one_based_execution_steps_parse() {
        for line in include_str!("../../tests/fixtures/a30-status.jsonl").lines() {
            assert!(
                MissionStatus::parse(serde_json::from_str(line).unwrap()).is_some(),
                "rejected {line}"
            );
        }
        for state in ["STEP_DONE", "PIN_CHECKED"] {
            let mut json = packet();
            json["state"] = state.into();
            assert!(MissionStatus::parse(json.clone()).is_none());
            json["step"] = 40.into();
            json["reason"] = "GPS_WITHIN_5M".into();
            assert!(MissionStatus::parse(json).is_some());
        }
        let mut staged = packet();
        staged["step"] = 1.into();
        assert!(MissionStatus::parse(staged).is_none());
    }
    pub fn packet() -> serde_json::Value {
        serde_json::json!({"type":"missionStatus", "missionId":"0123456789ABCDEF",
            "statusSeq":1, "state":"STAGED", "step":0, "reason":"NAV_NOT_CALIBRATED", "rssi":-42, "snr":8.6})
    }
    #[test]
    fn validates_firmware_bounds_and_types() {
        assert!(MissionStatus::parse(packet()).is_some());
        for (key, value) in [
            ("missionId", serde_json::json!("0123456789abcdef")),
            ("missionId", serde_json::json!("0000000000000000")),
            ("statusSeq", serde_json::json!(0)),
            ("statusSeq", serde_json::json!(4294967296u64)),
            ("statusSeq", serde_json::json!(1.5)),
            ("step", serde_json::json!(51)),
            ("step", serde_json::json!(41)),
            ("state", serde_json::json!("bad state")),
            ("reason", serde_json::json!("")),
            ("rssi", serde_json::json!(30)),
            ("snr", serde_json::json!("8.6")),
        ] {
            let mut json = packet();
            json[key] = value;
            assert!(MissionStatus::parse(json).is_none(), "accepted {key}");
        }
        for key in packet().as_object().unwrap().keys() {
            let mut json = packet();
            json.as_object_mut().unwrap().remove(key);
            assert!(MissionStatus::parse(json).is_none(), "missing {key}");
        }
    }
}
