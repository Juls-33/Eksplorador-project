// Host-only assertions against the same header used by both ESP32 endpoints.
#include "../shared/MissionProtocol.h"
#include <assert.h>
#include <string>
#include <iostream>

using namespace MissionProtocol;

static std::string packet(uint64_t id, const std::string& sequence) {
  Frame frame;
  frame.id = id;
  frame.checksum = crc32(sequence.c_str(), sequence.size());
  char buffer[26];
  key(frame, buffer, sizeof(buffer));
  return std::string("M2:") + buffer + ":" + sequence;
}

int main() {
  assert(crc32("123456789", 9) == 0xCBF43926);
  assert(packet(1, "123456789") == "M2:0000000000000001:CBF43926:123456789");
  Frame f;
  const std::string wire = packet(10, "R90,F12.3,L45,F2");
  assert(parse(wire.c_str(), f));
  assert(f.id == 10);
  assert(std::string(f.sequence) == "R90,F12.3,L45,F2");
  Record journal{};
  assert(classify(f, journal) == Delivery::NEW);
  journal = reserve(f); // Persisted before a UART handoff is allowed.
  assert(valid(journal));
  assert(classify(f, journal) == Delivery::UNCERTAIN);
  Record afterReboot = journal;
  assert(classify(f, afterReboot) == Delivery::UNCERTAIN);

  size_t megaDeliveries = 0;
  // Simulate one UART handoff followed by 8 lost ACK / duplicate deliveries.
  ++megaDeliveries;
  journal.stage = UART_QUEUED;
  for (int retry = 0; retry < 8; ++retry) {
    assert(classify(f, journal) == Delivery::DUPLICATE);
  }
  assert(megaDeliveries == 1);
  afterReboot = journal;
  assert(classify(f, afterReboot) == Delivery::DUPLICATE);

  const std::string changed = packet(10, "F999");
  Frame conflict;
  assert(parse(changed.c_str(), conflict));
  assert(classify(conflict, journal) == Delivery::CONFLICT);
  const std::string newer = packet(11, "F2");
  Frame next;
  assert(parse(newer.c_str(), next));
  assert(classify(next, journal) == Delivery::NEW);
  journal = reserve(next);
  journal.stage = UART_QUEUED;
  assert(classify(f, journal) == Delivery::STALE); // A delayed old mission never replaces a new one.

  std::string bad = wire;
  bad.back() = '3';
  Frame invalid;
  assert(!parse(bad.c_str(), invalid));
  assert(!parse("M2:bad", invalid));
  assert(!parse("ACK2:000000000000000A:00000000", invalid));
  assert(!parse(packet(0, "F1").c_str(), invalid));
  assert(!parse(packet(12, "F1\nRCV:F2").c_str(), invalid));
  assert(parse(packet(12, std::string(MAX_SEQUENCE, '1')).c_str(), invalid));
  assert(!parse(packet(12, std::string(MAX_SEQUENCE + 1, '1')).c_str(), invalid));
  journal.sequence[0] = 'X';
  assert(!valid(journal));
  assert(airtimeMs(255) == 400);
  assert(airtimeMs(30) == 72);
  assert(ackTimeoutMs(MAX_SEQUENCE) >= 1500);
  std::cout << "Mission protocol: CRC, framing, durable duplicate/stale/reboot protection, size and airtime checks passed\n";
}
