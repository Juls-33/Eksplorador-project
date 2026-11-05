//! GPS planning observations from receiver FUS JSON. DATA and encoder/IMU state
//! remain independent. Receipt and sequence checks cannot establish RF latency.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;

pub const MAX_GPS_AGE_MS: u64 = 5000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningGps {
    pub source: String,
    pub sequence: u32,
    pub position: [f64; 2],
    pub valid: bool,
    pub age_at_receipt_ms: u32,
    pub received_at: u64,
}

impl PlanningGps {
    pub fn from_fusion(json: &Value) -> Option<Self> {
        let flag = json.get("gpsValid")?;
        let valid = match flag.as_u64() {
            Some(0) => false,
            Some(1) => true,
            _ => flag.as_bool()?,
        };
        let p = Self {
            source: "fusion".into(),
            sequence: u32::try_from(json.get("fusionSeq")?.as_u64()?).ok()?,
            position: [json.get("lat")?.as_f64()?, json.get("lng")?.as_f64()?],
            valid,
            age_at_receipt_ms: u32::try_from(json.get("gpsAgeMs")?.as_u64()?).ok()?,
            received_at: json.get("receivedAtMs")?.as_u64()?,
        };
        (json.get("type")?.as_str()? == "fusion"
            && json.get("positionSource")?.as_str()? == "GPS_ONLY"
            && p.position.iter().all(|n| n.is_finite())
            && p.position[0].abs() <= 90.0
            && p.position[1].abs() <= 180.0)
            .then_some(p)
    }

    pub fn fresh(&self, now: u64) -> bool {
        self.valid
            && self.source == "fusion"
            && now >= self.received_at
            && now
                .saturating_sub(self.received_at)
                .saturating_add(self.age_at_receipt_ms as u64)
                <= MAX_GPS_AGE_MS
    }
}

#[derive(Default, Serialize)]
pub struct PlanningGpsTracker {
    pub current: Option<PlanningGps>,
    #[serde(skip)]
    sequence: Option<u32>,
    #[serde(skip)]
    recent: VecDeque<PlanningGps>,
}

impl PlanningGpsTracker {
    pub fn reset(&mut self) {
        *self = Self::default();
    }
    pub fn receive(&mut self, json: &Value) -> bool {
        let Some(sequence) = json
            .get("fusionSeq")
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
        else {
            return false;
        };
        if self.sequence.is_some_and(|old| {
            sequence.wrapping_sub(old) == 0 || sequence.wrapping_sub(old) >= (1 << 31)
        }) {
            return false;
        }
        self.sequence = Some(sequence);
        // A newer invalid or malformed GPS observation revokes the old fix;
        // malformed GPS must not interrupt the existing fusion RPM pipeline.
        self.current = PlanningGps::from_fusion(json);
        if let Some(gps) = &self.current {
            if self.recent.len() == 8 {
                self.recent.pop_front();
            }
            self.recent.push_back(gps.clone());
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn packet(seq: u32) -> Value {
        serde_json::json!({"type":"fusion","fusionSeq":seq,"gpsValid":1,
        "lat":14.609,"lng":120.989,"gpsAgeMs":100,"receivedAtMs":1000,"positionSource":"GPS_ONLY"})
    }
    #[test]
    fn gps_is_explicit_valid_fresh_in_range_and_never_inferred_from_data_or_satellites() {
        let gps = PlanningGps::from_fusion(&packet(1)).unwrap();
        assert!(gps.fresh(5900));
        assert!(!gps.fresh(5901));
        assert!(!gps.fresh(999));
        for (key, value) in [
            ("gpsValid", Value::from(2)),
            ("gpsAgeMs", Value::from(-1)),
            ("lat", Value::from(91)),
            ("lng", Value::from("120")),
            ("fusionSeq", Value::from(-1)),
            ("gpsAgeMs", Value::from(0.5)),
            ("receivedAtMs", Value::Null),
            ("type", Value::from("sensor")),
        ] {
            let mut json = packet(1);
            json[key] = value;
            assert!(PlanningGps::from_fusion(&json).is_none(), "accepted {key}");
        }
        let mut invalid = packet(1);
        invalid["gpsValid"] = 0.into();
        invalid["satsLocked"] = 10.into();
        assert!(!PlanningGps::from_fusion(&invalid).unwrap().fresh(1000));
    }
    #[test]
    fn duplicates_reordering_loss_wrap_and_reconnect_cannot_refresh_old_fixes() {
        let mut tracker = PlanningGpsTracker::default();
        assert!(tracker.receive(&packet(u32::MAX)));
        let mut duplicate = packet(u32::MAX);
        duplicate["receivedAtMs"] = 5000.into();
        assert!(!tracker.receive(&duplicate));
        assert_eq!(tracker.current.as_ref().unwrap().received_at, 1000);
        assert!(tracker.receive(&packet(0)));
        assert!(!tracker.receive(&packet(u32::MAX)));
        let mut loss = packet(1);
        loss["gpsValid"] = 0.into();
        tracker.receive(&loss);
        assert!(!tracker.current.as_ref().unwrap().valid);
        let mut malformed = packet(2);
        malformed.as_object_mut().unwrap().remove("gpsAgeMs");
        tracker.receive(&malformed);
        assert!(tracker.current.is_none());
        tracker.reset();
        assert!(tracker.receive(&packet(0)));
    }
}
