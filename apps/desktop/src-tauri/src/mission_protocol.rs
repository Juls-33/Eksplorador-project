// V2 wraps the generated sequence; it never changes its values or units.
pub const MAX_PACKET_BYTES: usize = 255;
pub const HEADER_BYTES: usize = 29; // M2:<16 hex ID>:<8 hex CRC32>:
pub const MAX_WAYPOINTS: usize = 10;

pub fn validate_sequence(sequence: &str) -> Result<(), String> {
    if !sequence.is_ascii()
        || sequence.len() > MAX_PACKET_BYTES - HEADER_BYTES
        || !sequence.starts_with("N1,")
    {
        return Err(
            "Expected N1 waypoint targets in at most 226 ASCII bytes. No route was truncated."
                .into(),
        );
    }
    let mut tokens = sequence.split(',').skip(1).peekable();
    if tokens.peek().is_some_and(|t| t.starts_with('H')) {
        let token = tokens.next().unwrap();
        let number = &token[1..];
        if token.len() > 8
            || number.is_empty()
            || !number.bytes().all(|b| b.is_ascii_digit() || b == b'.')
            || !number
                .parse::<f64>()
                .is_ok_and(|n| n.is_finite() && (0.0..360.0).contains(&n))
        {
            return Err("Invalid optional true-north heading reference.".into());
        }
    }
    let mut count = 0;
    for token in tokens {
        let coords = token
            .strip_prefix('W')
            .ok_or("Only waypoint targets are accepted after N1 and optional H.")?;
        let (lat, lon) = coords
            .split_once('.')
            .ok_or("W requires two encoded coordinate integers.")?;
        let integer = |s: &str, max: u32| {
            !s.is_empty()
                && s.len() <= 9
                && s.bytes().all(|b| b.is_ascii_digit())
                && s.parse::<u32>().is_ok_and(|n| n <= max)
        };
        if !integer(lat, 180000000) || !integer(lon, 360000000) {
            return Err("Invalid waypoint coordinates.".into());
        }
        count += 1;
    }
    if count == 0 || count > MAX_WAYPOINTS {
        return Err("Mission requires 1-10 waypoint targets within 226 bytes.".into());
    }
    Ok(())
}

pub fn checksum(payload: &str) -> u32 {
    let mut crc = !0u32;
    for byte in payload.bytes() {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xEDB88320u32 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}

pub fn key(id: u64, crc: u32) -> String {
    format!("{id:016X}:{crc:08X}")
}
pub fn frame(id: u64, sequence: &str) -> String {
    format!("M2:{}:{sequence}", key(id, checksum(sequence)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crc_and_transport_are_unchanged() {
        assert_eq!(checksum("123456789"), 0xCBF43926);
        assert_eq!(
            frame(1, "123456789"),
            "M2:0000000000000001:CBF43926:123456789"
        );
    }
    #[test]
    fn targets_upload_without_gps_heading_or_calibration() {
        for s in [
            "N1,W104609000.300989000",
            "N1,H0,W0.0",
            "N1,H359.99,W180000000.360000000",
        ] {
            assert!(validate_sequence(s).is_ok(), "{s}");
        }
        for s in [
            "",
            "N1",
            "N1,",
            "N1,W0.0,",
            "N1,H360,W0.0",
            "N1,HNaN,W0.0",
            "N1,F1,W0.0",
            "N1,W180000001.0",
            "N1,W0.360000001",
            "F1,W0.0",
            "TIME:F1",
        ] {
            assert!(validate_sequence(s).is_err(), "{s}");
        }
        assert!(validate_sequence(&format!("N1{}", ",W104609000.300989000".repeat(10))).is_ok());
        assert!(validate_sequence(&format!("N1{}", ",W104609000.300989000".repeat(11))).is_err());
    }
}
