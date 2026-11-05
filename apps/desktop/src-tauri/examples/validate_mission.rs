//! Hardware-free use of the production N1 validator and unchanged V2 envelope.
#[path = "../src/mission_protocol.rs"]
mod mission_protocol;
use std::io::Read;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let json: serde_json::Value = serde_json::from_str(&input)?;
    let sequence = json["sequence"].as_str().ok_or("Missing sequence")?;
    mission_protocol::validate_sequence(sequence)?;
    println!("{}", mission_protocol::frame(1, sequence));
    Ok(())
}
