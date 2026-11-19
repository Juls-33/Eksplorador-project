// EKSPLORADOR_OBSTACLE_ALERT_V1
// The desktop RX_BOARD prints any LoRa packet as `[RAW RX]: <payload>`.
// This parser intentionally accepts only a bounded, explicit alert frame.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct ObstacleAlert {
    pub id: u32,
    pub remaining_ms: u32,
    pub reason: &'static str,
}

pub fn parse_rx_board_obstacle_line(line: &str) -> Option<ObstacleAlert> {
    let payload = line.strip_prefix("[RAW RX]: ALRT1:")?;
    let (id_str, ms_str) = payload.split_once(':')?;
    if id_str.is_empty() || ms_str.is_empty() || ms_str.contains(':') {
        return None;
    }
    if !id_str.bytes().all(|ch| ch.is_ascii_digit())
        || !ms_str.bytes().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    let id: u32 = id_str.parse().ok()?;
    let remaining_ms: u32 = ms_str.parse().ok()?;
    if id == 0 || remaining_ms > 120_000 { return None; }
    Some(ObstacleAlert { id, remaining_ms, reason: "SONAR" })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_sonar_pause_and_rejects_irrelevant_radio_messages() {
        let alert = parse_rx_board_obstacle_line("[RAW RX]: ALRT1:4294967295:31898").unwrap();
        assert_eq!(alert.id, u32::MAX);
        assert_eq!(alert.remaining_ms, 31898);
        for invalid in [
            "[RAW RX]: DATA:1,2", "[RAW RX]: ALRT1:1:-1",
            "[RAW RX]: ALRT1:0:40", "[RAW RX]: ALRT1:1:120001",
            "[RAW RX]: ALRT1:1:500:extra", "[RAW RX]: ALRT1:hi:5",
            "[OBSTACLE] ALRT1:1:10", "[RAW RX]: ALRT1:1:",
        ] { assert!(parse_rx_board_obstacle_line(invalid).is_none(), "{invalid}"); }
    }
}
