#!/usr/bin/env python3
"""Add an acknowledged-by-operator obstacle popup without touching Arduino Mega.
This patches the latest rover ESP32 .ino, the Tauri serial listener, and the
React app entry point. Desktop RX_BOARD .ino remains entirely untouched: it
already prints arbitrary LoRa packets as '[RAW RX]: ...'.
"""
import argparse
import difflib
from pathlib import Path
import re
import shutil
import sys

HERE = Path(__file__).resolve().parent
MARKER = 'EKSPLORADOR_OBSTACLE_ALERT_V1'

ROVER_GLOBALS = r'''// EKSPLORADOR_OBSTACLE_ALERT_V1: independent, bounded alert queue.
// A safety stop is enforced by the UNCHANGED Mega. This path only notifies.
char obstacleAlertPacket[72] = {0};
bool obstacleAlertPending = false;
uint8_t obstacleAlertAttempts = 0;
unsigned long obstacleAlertLastTxMs = 0;
const uint8_t OBSTACLE_ALERT_REPEATS = 4;
const unsigned long OBSTACLE_ALERT_REPEAT_MS = 300UL;

void queueObstacleAlert(const char *megaMessage) {
  // The Mega sends: MISSION_STATUS:A31_PAUSED:SONAR:<remaining milliseconds>
  static const char kPrefix[] = "MISSION_STATUS:A31_PAUSED:SONAR:";
  if (strncmp(megaMessage, kPrefix, sizeof(kPrefix) - 1) != 0) return;
  const char *timeText = megaMessage + sizeof(kPrefix) - 1;
  if (!*timeText) return;
  for (const char *p = timeText; *p; ++p) {
    if (*p < '0' || *p > '9') return;
  }
  const unsigned long remaining = strtoul(timeText, nullptr, 10);
  if (remaining > 120000UL) return;
  uint32_t id = (uint32_t)esp_random();
  if (id == 0) id = 1;
  snprintf(obstacleAlertPacket, sizeof(obstacleAlertPacket),
           "ALRT1:%lu:%lu", (unsigned long)id, remaining);
  obstacleAlertPending = true;
  obstacleAlertAttempts = 0;
  obstacleAlertLastTxMs = 0;
  Serial.printf("[OBSTACLE ALERT QUEUED] %s\n", obstacleAlertPacket);
}
'''

ROVER_TX = r'''// EKSPLORADOR_OBSTACLE_ALERT_V1: sends safety notification before routine telemetry.
// Desktop RX_BOARD already prints raw LoRa payloads; no RX_BOARD flash is needed.
// No ACK channel is added here. Four identical-ID transmissions are attempted;
// desktop suppresses duplicates. Delivery cannot be guaranteed across radio loss.
bool serviceObstacleAlert() {
  if (!obstacleAlertPending) return false;
  if (obstacleAlertAttempts >= OBSTACLE_ALERT_REPEATS) {
    obstacleAlertPending = false;
    return false;
  }
  const unsigned long now = millis();
  if (obstacleAlertAttempts && now - obstacleAlertLastTxMs < OBSTACLE_ALERT_REPEAT_MS)
    return true;

  // An in-flight DATA telemetry ACK must not prevent immediate alert priority.
  // Retire that old DATA ID so a late ACK cannot be confused with a new packet.
  if (awaitingAck) {
    awaitingAck = false;
    packetId++;
  }

  LoRa.idle();
  bool sent = false;
  if (LoRa.beginPacket()) {
    LoRa.print(obstacleAlertPacket);
    sent = LoRa.endPacket() == 1;
  }
  // Count failed attempts too: a broken radio must not starve all telemetry.
  ++obstacleAlertAttempts;
  obstacleAlertLastTxMs = millis();
  Serial.printf("[OBSTACLE ALERT %s] %u/%u %s\n",
                sent ? "TX" : "SEND_FAILED", obstacleAlertAttempts,
                OBSTACLE_ALERT_REPEATS, obstacleAlertPacket);
  LoRa.receive();
  // Keep the alert exclusive until last copy goes out; safety is Mega-owned.
  return true;
}
'''

RUST_MODULE = r'''// EKSPLORADOR_OBSTACLE_ALERT_V1
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
'''

RUST_EMIT = '''                                // EKSPLORADOR_OBSTACLE_ALERT_V1: separate urgent safety notification.
                                if let Some(alert) = obstacle_alert::parse_rx_board_obstacle_line(trimmed) {
                                    let _ = app_handle.emit("rover-obstacle", alert);
                                    continue; // Never treat an alert as soil/encoder/GPS telemetry.
                                }
'''

APP_COMPONENT = r'''// EKSPLORADOR_OBSTACLE_ALERT_V1
import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AlertTriangle, X } from 'lucide-react';
import './RoverObstacleAlert.css';

// App-visible instructions, not commands. The receiver cannot control RC switches.
export default function RoverObstacleAlert() {
  const [alert, setAlert] = useState(null);
  const seenIds = useRef(new Set());

  useEffect(() => {
    let active = true;
    let stopListening = null;
    const show = payload => {
      if (!active || !payload || payload.reason !== 'SONAR' ||
          !Number.isInteger(payload.id) || payload.id <= 0 ||
          !Number.isInteger(payload.remaining_ms) || payload.remaining_ms < 0) return;
      if (seenIds.current.has(payload.id)) return;
      seenIds.current.add(payload.id);
      // Bound de-duplication memory. Repeats of the same frame cannot open many modals.
      if (seenIds.current.size > 64) {
        const oldest = seenIds.current.values().next().value;
        seenIds.current.delete(oldest);
      }
      setAlert(payload);
    };
    // Development-only simulation: DevTools console command listed in README.
    const showDemo = () => show({ id: Date.now() % 4000000000 + 1, remaining_ms: 31898, reason: 'SONAR', demo: true });
    if (import.meta.env.DEV) window.addEventListener('eksplorador-obstacle-demo', showDemo);
    listen('rover-obstacle', ({ payload }) => show(payload)).then(unlisten => {
      if (active) stopListening = unlisten;
      else unlisten();
    }).catch(error => console.error('[Obstacle Alert] listener unavailable', error));
    return () => {
      active = false;
      stopListening?.();
      if (import.meta.env.DEV) window.removeEventListener('eksplorador-obstacle-demo', showDemo);
    };
  }, []);

  if (!alert) return null;
  return (
    <div className="rover-obstacle-overlay">
      <section className="rover-obstacle-modal" role="alertdialog" aria-modal="true"
        aria-labelledby="rover-obstacle-title" aria-describedby="rover-obstacle-description">
        <header className="rover-obstacle-header">
          <AlertTriangle size={25} aria-hidden="true" />
          <h2 id="rover-obstacle-title">{alert.demo ? 'DEMO — ' : ''}Obstacle detected — manual intervention required</h2>
        </header>
        <p id="rover-obstacle-description">The rover reported an ultrasonic safety stop. The current timed movement was interrupted; it must not restart automatically when the obstacle disappears.</p>
        <p className="rover-obstacle-meta">Remaining at stop: {(alert.remaining_ms / 1000).toFixed(1)} seconds · Alert ID {alert.id}</p>
        <ol>
          <li>Inspect the area. Switch <strong>CH6 to MANUAL</strong> while supervising the rover.</li>
          <li>Use your RC controller to drive around the obstacle. MANUAL mode cancels the unfinished mission.</li>
          <li>Stop, DISARM, and re-plan from the rover's <strong>new actual position</strong>. Upload a fresh movement sequence using the normal mission assistant.</li>
        </ol>
        <p className="rover-obstacle-note">This popup is an alert only. Dismissing it does not arm, resume, or move the rover. If the radio link is unavailable, no desktop alert is guaranteed.</p>
        <button className="rover-obstacle-dismiss" type="button" autoFocus onClick={() => setAlert(null)}>
          <X size={16} aria-hidden="true" /> Acknowledge notification
        </button>
      </section>
    </div>
  );
}
'''

APP_CSS = r'''/* EKSPLORADOR_OBSTACLE_ALERT_V1 */
.rover-obstacle-overlay { position: fixed; inset: 0; z-index: 25000; background: rgba(10, 16, 24, .68); display: flex; align-items: center; justify-content: center; padding: 20px; }
.rover-obstacle-modal { max-width: 610px; width: 100%; max-height: 90vh; overflow: auto; padding: 24px; border-radius: 14px; background: #fff; color: #132437; box-shadow: 0 22px 80px rgba(0,0,0,.35); }
.rover-obstacle-header { display: flex; gap: 12px; align-items: center; color: #a32e22; }
.rover-obstacle-header h2 { font-size: 1.25rem; line-height: 1.4; margin: 0; }
.rover-obstacle-modal p { line-height: 1.55; }
.rover-obstacle-meta { font-size: .9rem; color: #52627a; }
.rover-obstacle-modal ol { padding-left: 1.5rem; line-height: 1.7; }
.rover-obstacle-modal li + li { margin-top: 8px; }
.rover-obstacle-note { border-left: 3px solid #cf9b43; padding-left: 12px; font-size: .88rem; color: #536175; }
.rover-obstacle-dismiss { margin-top: 8px; padding: 12px 16px; border-radius: 9px; border: 0; background: #a82c23; color: white; font-weight: 700; cursor: pointer; display: flex; gap: 8px; align-items: center; }
.rover-obstacle-dismiss:focus-visible { outline: 3px solid #597dff; outline-offset: 3px; }
'''


def exactly_once(body, find, replace, label):
    count = body.count(find)
    if count != 1:
        raise RuntimeError(f'{label}: anchor expected once, found {count}; source may differ from inspected version.')
    return body.replace(find, replace, 1)


def patch_rover(body):
    if MARKER in body: return body
    body = exactly_once(body, 'void processMegaLine(const char *s) {',
        ROVER_GLOBALS + '\nvoid processMegaLine(const char *s) {', 'Rover ESP32: processMegaLine')
    body = exactly_once(body,
        'Serial.println(s + 15);',
        'Serial.println(s + 15);\n      queueObstacleAlert(s);', 'Rover ESP32: mission status receipt')
    body = exactly_once(body, 'void serviceTx() {', ROVER_TX + '\nvoid serviceTx() {', 'Rover ESP32: serviceTx')
    body = exactly_once(body,
        '      serviceTx();\n\n      if (!awaitingAck)',
        '      if (serviceObstacleAlert()) { delay(1); return; }\n      serviceTx();\n\n      if (!awaitingAck)', 'Rover ESP32: loop TX priority')
    return body


def patch_rust(body):
    if MARKER in body: return body
    body = 'mod obstacle_alert; // ' + MARKER + '\n' + body
    body = exactly_once(body, '                                match encoder_telemetry::classify(trimmed) {',
        RUST_EMIT + '\n                                match encoder_telemetry::classify(trimmed) {', 'lib.rs: classify telemetry')
    return body


def patch_react_entry(body):
    if MARKER in body: return body
    match = re.search(r'<App\s*/>', body)
    if not match: raise RuntimeError('main.jsx/tsx: could not identify <App /> root; mount RoverObstacleAlert manually.')
    body = "import RoverObstacleAlert from './components/RoverObstacleAlert'; // " + MARKER + '\n' + body
    body = re.sub(r'<App\s*/>', '<><App /><RoverObstacleAlert /></>', body, count=1)
    return body


def locate_rover(root):
    candidates = []
    for path in (root / 'embedded').rglob('*.ino'):
        if path.stat().st_size > 250_000: continue
        data = path.read_text(encoding='utf-8-sig')
        if ('void processMegaLine(const char *s)' in data and
            'void serviceMissionForward()' in data and 'LoRa.parsePacket()' in data):
            candidates.append(path)
    if len(candidates) != 1:
        raise RuntimeError(f'Expected 1 rover ESP32 source under embedded/, got {len(candidates)}: {candidates}')
    return candidates[0]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('project_root', type=Path, help='Your Eksplorador-project root folder')
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--rover', type=Path, help='Optional exact rover ESP32 .ino (relative to project root) when multiple archived variants exist')
    args = p.parse_args()
    root = args.project_root.expanduser().resolve()
    tauri = root / 'apps/desktop/src-tauri/src/lib.rs'
    source = root / 'apps/desktop/src'
    entries = [source / 'main.jsx', source / 'main.tsx', source / 'main.js']
    entry = next((e for e in entries if e.is_file()), None)
    if not tauri.is_file() or not entry:
        raise RuntimeError(f'Expected Tauri lib.rs and main.jsx or main.tsx under {root}/apps/desktop')
    rover = (args.rover if args.rover.is_absolute() else root / args.rover).resolve() if args.rover else locate_rover(root)
    if args.rover:
        if not rover.is_file() or root not in rover.parents or rover.suffix != '.ino':
            raise RuntimeError(f'--rover must point to an existing .ino inside the project: {rover}')
        required = ('void processMegaLine(const char *s)', 'void serviceMissionForward()', 'void serviceTx()')
        if any(token not in rover.read_text(encoding='utf-8-sig') for token in required):
            raise RuntimeError(f'--rover does not look like the tested rover ESP32 firmware: {rover}')
    files = {
        rover: patch_rover(rover.read_text(encoding='utf-8-sig')),
        tauri: patch_rust(tauri.read_text(encoding='utf-8-sig')),
        entry: patch_react_entry(entry.read_text(encoding='utf-8-sig')),
        tauri.parent / 'obstacle_alert.rs': RUST_MODULE,
        source / 'components/RoverObstacleAlert.jsx': APP_COMPONENT,
        source / 'components/RoverObstacleAlert.css': APP_CSS,
    }
    # Validate every target and discover any pre-existing mismatched custom files BEFORE writing.
    for path, body in files.items():
        if path.is_file() and path not in (rover, tauri, entry) and path.read_text(encoding='utf-8-sig') != body:
            raise RuntimeError(f'{path} already exists with different contents; back it up or resolve manually')
    changes = [path for path, body in files.items() if not path.is_file() or path.read_text(encoding='utf-8-sig') != body]
    if not changes:
        print('Already installed; no files changed.')
        return
    for path in changes:
        print(f'{"WOULD PATCH" if args.dry_run else "PATCH"}: {path.relative_to(root)}')
    if args.dry_run: return
    for path in changes:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_file():
            backup = path.with_suffix(path.suffix + '.before-obstacle-alert.bak')
            if not backup.exists(): shutil.copy2(path, backup)
        path.write_text(files[path], encoding='utf-8', newline='\n')
    print('Done. Arduino Mega and RX_BOARD files were not altered.')
    print('Next: npm test/build, cargo test, Verify/upload rover ESP32 ONLY when battery charged.')

if __name__ == '__main__':
    try: main()
    except Exception as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        raise SystemExit(1)
