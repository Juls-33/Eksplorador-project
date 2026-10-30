// V2 wraps the generated sequence; it never changes its values or units.
pub const MAX_PACKET_BYTES: usize = 255;
pub const HEADER_BYTES: usize = 29; // M2:<16 hex ID>:<8 hex CRC32>:

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
    fn crc32_matches_the_standard_and_wire_format_is_stable() {
        assert_eq!(checksum("123456789"), 0xCBF43926);
        assert_eq!(
            frame(1, "123456789"),
            "M2:0000000000000001:CBF43926:123456789"
        );
    }
}
