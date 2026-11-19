from pathlib import Path
import importlib.util
import subprocess
import tempfile
import unittest

p = Path(__file__).resolve().parents[1] / 'apply_obstacle_alert.py'
s = importlib.util.spec_from_file_location('m',p)
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)

STUB = r'''
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
using namespace std;
unsigned long now_ms = 1000;
unsigned long millis() { return now_ms; }
uint32_t esp_random() { return 123456789; }
struct FakeSerial { template <class... A> void printf(const char*, A...) {} } Serial;
struct FakeLoRa {
  string assembling;
  vector<string> sent;
  bool beginOk = true;
  void idle() {}
  bool beginPacket() { assembling.clear(); return beginOk; }
  void print(const char* p) { assembling += p; }
  int endPacket() { sent.push_back(assembling); return 1; }
  void receive() {}
} LoRa;
bool awaitingAck = true;
uint32_t packetId = 7;
'''
TEST = r'''
int main() {
  queueObstacleAlert("MISSION_STATUS:A31_PAUSED:HOLD:25000");
  assert(!obstacleAlertPending);
  queueObstacleAlert("MISSION_STATUS:A31_PAUSED:SONAR:bad");
  assert(!obstacleAlertPending);
  queueObstacleAlert("MISSION_STATUS:A31_PAUSED:SONAR:31898");
  assert(obstacleAlertPending && strcmp(obstacleAlertPacket,"ALRT1:123456789:31898")==0);
  assert(serviceObstacleAlert());
  assert(!awaitingAck && packetId==8);
  assert(LoRa.sent.size()==1 && LoRa.sent[0]=="ALRT1:123456789:31898");
  for(int i=0;i<3;i++) {
    now_ms+=150;
    assert(serviceObstacleAlert());
    assert(LoRa.sent.size()==(size_t)i+1);
    now_ms+=150;
    assert(serviceObstacleAlert());
    assert(LoRa.sent.size()==(size_t)i+2);
  }
  assert(!serviceObstacleAlert());
  assert(!obstacleAlertPending);
  assert(LoRa.sent.size()==4);
  for(const auto &p:LoRa.sent) assert(p=="ALRT1:123456789:31898");
  assert(!serviceObstacleAlert());
  printf("Rover alert: 4 deduplicable LoRa messages, priority, no malformed events: PASS\n");
}
'''

class TestRover(unittest.TestCase):
 def test_compiled_rover_transmission(self):
  with tempfile.TemporaryDirectory() as d:
   cpp=Path(d)/'test.cpp';exe=Path(d)/'test'
   cpp.write_text(STUB+m.ROVER_GLOBALS+'\n'+m.ROVER_TX+'\n'+TEST)
   c=subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',str(cpp),'-o',str(exe)],capture_output=True,text=True)
   self.assertEqual(c.returncode,0,c.stderr)
   r=subprocess.run([str(exe)],capture_output=True,text=True)
   self.assertEqual(r.returncode,0,r.stderr)
   self.assertIn('PASS',r.stdout)

if __name__=='__main__':unittest.main(verbosity=2)
