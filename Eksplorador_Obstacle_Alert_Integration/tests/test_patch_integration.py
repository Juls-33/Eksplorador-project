from pathlib import Path
import hashlib
import importlib.util
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'apply_obstacle_alert.py'
spec = importlib.util.spec_from_file_location('obstacle_patcher', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

ROVER = '''#include <Arduino.h>\n#include <LoRa.h>\nchar inLine[160];\nbool awaitingAck=false;\nuint32_t packetId=1;\nvoid serviceMissionForward() {}\nvoid processMegaLine(const char *s) {\n if (!strcmp(s, "SET_MODE:RX")) {}\n else if (!strncmp(s, "MISSION_STATUS:", 15)) {\n   Serial.print("[MEGA MISSION] ");\n   Serial.println(s + 15);\n }\n}\nvoid serviceTx() { int n=LoRa.parsePacket(); }\nvoid loop() { if (txMode) {\n      serviceTx();\n\n      if (!awaitingAck) { doTelemetry(); }\n} }\n'''
RUST = '''use tauri::Emitter;\nfn read_serial(text: String) {\n let trimmed = text.trim();\n if trimmed.is_empty() { return; }\n                                match encoder_telemetry::classify(trimmed) {\n_ => {}\n}\n}\n'''
JS = "import App from './App.jsx';\nimport React from 'react';\ncreateRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);\n"

class TestPatcher(unittest.TestCase):
 def fake_repo(self,base):
  root=Path(base)
  for name,data in {
   'embedded/rover/rover.ino':ROVER,
   'embedded/mega/mega.ino':'// verified mega baseline — DO NOT CHANGE',
   'embedded/rx_board/receiver.ino':'// existing receiver prints [RAW RX]: payload',
   'apps/desktop/src-tauri/src/lib.rs':RUST,
   'apps/desktop/src/main.jsx':JS,
  }.items():
   p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(data)
  return root
 def patch(self,root,dry=False):
  return subprocess.run(['python',str(SCRIPT),str(root)]+(['--dry-run'] if dry else []),capture_output=True,text=True)
 def test_wires_all_layers_without_touching_mega_or_rx_and_is_idempotent(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=self.fake_repo(tmp)
   before={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
   dry=self.patch(root,True);self.assertEqual(dry.returncode,0,dry.stderr)
   self.assertEqual(before,{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()})
   done=self.patch(root);self.assertEqual(done.returncode,0,done.stderr)
   updated=(root/'embedded/rover/rover.ino').read_text()
   self.assertIn('queueObstacleAlert(s);',updated)
   self.assertIn('serviceObstacleAlert()',updated)
   self.assertIn('ALRT1:',updated)
   self.assertIn('OBSTACLE_ALERT_REPEATS = 4',updated)
   self.assertIn('if (serviceObstacleAlert()) { delay(1); return; }',updated)
   rust=(root/'apps/desktop/src-tauri/src/lib.rs').read_text()
   self.assertIn('app_handle.emit("rover-obstacle", alert)',rust)
   self.assertIn('mod obstacle_alert;',rust)
   entry=(root/'apps/desktop/src/main.jsx').read_text()
   self.assertIn('<><App /><RoverObstacleAlert /></>',entry)
   self.assertEqual((root/'embedded/mega/mega.ino').read_text(),'// verified mega baseline — DO NOT CHANGE')
   self.assertEqual((root/'embedded/rx_board/receiver.ino').read_text(),'// existing receiver prints [RAW RX]: payload')
   after={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
   rerun=self.patch(root);self.assertEqual(rerun.returncode,0,rerun.stderr)
   self.assertIn('Already installed',rerun.stdout)
   self.assertEqual(after,{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()})
 def test_anchor_mismatch_aborts_without_partial_changes(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=self.fake_repo(tmp)
   p=root/'apps/desktop/src-tauri/src/lib.rs';p.write_text('not the expected code')
   initial=(root/'embedded/rover/rover.ino').read_text()
   done=self.patch(root)
   self.assertNotEqual(done.returncode,0)
   self.assertEqual((root/'embedded/rover/rover.ino').read_text(),initial)

if __name__=='__main__':unittest.main(verbosity=2)
