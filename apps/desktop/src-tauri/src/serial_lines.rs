//! Bounded newline framing, retained across serial timeouts and corrupt lines.
use crate::encoder_telemetry::trace;
use std::io::{self, BufRead, ErrorKind, Read};

const MAX_LINE_BYTES: usize = 64 * 1024;
const READ_CHUNK_BYTES: usize = 1024;

#[derive(Default)]
pub struct SerialLines {
    bytes: Vec<u8>,
    discarding: bool,
}

impl SerialLines {
    // None means a partial, ignored or discarded line, never a lost connection.
    // EOF and actual serial I/O failures remain errors for the reconnect owner.
    pub fn read(&mut self, reader: &mut impl BufRead) -> io::Result<Option<String>> {
        let budget = READ_CHUNK_BYTES.min(MAX_LINE_BYTES + 1 - self.bytes.len());
        let result = reader
            .take(budget as u64)
            .read_until(b'\n', &mut self.bytes);
        match result {
            Err(error)
                if matches!(
                    error.kind(),
                    ErrorKind::TimedOut | ErrorKind::WouldBlock | ErrorKind::Interrupted
                ) => {}
            Err(error) => return Err(error),
            Ok(0) => {
                return Err(io::Error::new(
                    ErrorKind::UnexpectedEof,
                    "serial stream closed",
                ))
            }
            Ok(_) => {}
        }
        let terminated = self.bytes.last() == Some(&b'\n');
        if self.bytes.len() > MAX_LINE_BYTES {
            trace("rejected", || {
                format!("serial_line_too_long: limit={MAX_LINE_BYTES}; discarding through newline")
            });
            self.bytes.clear();
            self.discarding = !terminated;
            return Ok(None);
        }
        if !terminated {
            return Ok(None);
        }
        let bytes = std::mem::take(&mut self.bytes);
        if self.discarding {
            self.discarding = false;
            return Ok(None);
        }
        match String::from_utf8(bytes) {
            Ok(line) => Ok(Some(line)),
            Err(error) => {
                trace("raw", || {
                    String::from_utf8_lossy(error.as_bytes())
                        .trim_end()
                        .to_string()
                });
                trace("rejected", || {
                    format!("invalid_utf8_serial_line: {}", error.utf8_error())
                });
                Ok(None)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::VecDeque,
        io::{BufReader, Cursor},
    };

    struct InterruptedRead(VecDeque<io::Result<Vec<u8>>>);
    impl Read for InterruptedRead {
        fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
            let bytes = match self.0.pop_front() {
                Some(step) => step?,
                None => return Ok(0),
            };
            let count = bytes.len().min(out.len());
            out[..count].copy_from_slice(&bytes[..count]);
            if count < bytes.len() {
                self.0.push_front(Ok(bytes[count..].to_vec()));
            }
            Ok(count)
        }
    }

    #[test]
    fn fragmented_lines_survive_timeouts_without_joining_adjacent_messages() {
        let source = InterruptedRead(VecDeque::from([
            Ok(b"ENC: {\"type\":".to_vec()),
            Err(io::Error::from(ErrorKind::TimedOut)),
            Ok(b"\"encoder\"}\r\nFUS: {\"type\":\"fusion\"}\n".to_vec()),
        ]));
        let mut reader = BufReader::new(source);
        let mut lines = SerialLines::default();
        assert!(lines.read(&mut reader).unwrap().is_none());
        assert_eq!(
            lines.read(&mut reader).unwrap().unwrap(),
            "ENC: {\"type\":\"encoder\"}\r\n"
        );
        assert_eq!(
            lines.read(&mut reader).unwrap().unwrap(),
            "FUS: {\"type\":\"fusion\"}\n"
        );
        assert_eq!(
            lines.read(&mut reader).unwrap_err().kind(),
            ErrorKind::UnexpectedEof
        );
    }

    #[test]
    fn invalid_utf8_and_oversized_diagnostics_do_not_disconnect_or_poison_the_next_line() {
        let mut bytes = vec![0xff, b'\n'];
        bytes.extend(vec![b'X'; MAX_LINE_BYTES + 1500]);
        bytes.extend(b"\nENC: {\"type\":\"encoder\"}\n");
        let mut reader = Cursor::new(bytes);
        let mut lines = SerialLines::default();
        assert!(lines.read(&mut reader).unwrap().is_none());
        let mut completed = Vec::new();
        while let Ok(line) = lines.read(&mut reader) {
            if let Some(line) = line {
                completed.push(line);
            }
            assert!(lines.bytes.len() <= MAX_LINE_BYTES);
        }
        assert_eq!(completed, vec!["ENC: {\"type\":\"encoder\"}\n"]);
    }
}
