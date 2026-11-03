//! Hardware-free replay of the production framing, classifier and encoder stream.
//! stdout is NDJSON for tests; optional diagnostic traces are written to stderr.
#[path = "../src/encoder_telemetry.rs"]
mod encoder_telemetry;
#[path = "../src/mission_status.rs"]
mod mission_status;
#[path = "../src/serial_lines.rs"]
mod serial_lines;

use encoder_telemetry::{EncoderStream, FusionStream, Message};
use std::{
    fs::File,
    io::{BufReader, ErrorKind},
    time::{Duration, Instant},
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: replay_telemetry <serial-lines-file>")?;
    let mut reader = BufReader::new(File::open(path)?);
    let mut lines = serial_lines::SerialLines::default();
    let mut stream = EncoderStream::default();
    let mut fusion = FusionStream::default();
    let base = Instant::now();
    let mut elapsed_ms = 0_u64;
    loop {
        let line = match lines.read(&mut reader) {
            Ok(Some(line)) => line,
            Ok(None) => continue,
            Err(error) if error.kind() == ErrorKind::UnexpectedEof => break,
            Err(error) => return Err(error.into()),
        };
        let now = base + Duration::from_millis(elapsed_ms);
        let mut events = Vec::new();
        match encoder_telemetry::classify(&line) {
            // Live status is published by Radio as rx-board-connection, never
            // as a sensor event. Radio correlation/recovery has its own tests.
            Message::MissionStatus(_) => {}
            Message::Encoder(packet) => {
                stream.receive(packet, now, 10000 + elapsed_ms);
            }
            Message::Sensor(payload) => {
                events.push(serde_json::json!({"event":"sensor-data", "payload":payload}))
            }
            Message::Fusion(payload) => {
                if let Some(payload) = fusion.receive(payload, now, 10000 + elapsed_ms) {
                    events.push(serde_json::json!({"event":"fusion-data", "payload":payload}));
                }
            }
            Message::Ignore => {}
        }
        if let Some(payload) = stream.take_due(now) {
            encoder_telemetry::trace("encoder_emitted", || {
                serde_json::to_string(&payload).unwrap()
            });
            events.push(serde_json::json!({"event":"encoder-data", "payload":payload}));
        }
        println!(
            "{}",
            serde_json::json!({"elapsedMs":elapsed_ms, "events":events})
        );
        elapsed_ms += 250;
    }
    Ok(())
}
