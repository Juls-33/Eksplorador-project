#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>

// Common, Arduino-independent wire parser, CRC and duplicate decisions.
namespace MissionProtocol {
constexpr size_t MAX_PACKET = 255;
constexpr size_t HEADER = 29;
constexpr size_t MAX_SEQUENCE = MAX_PACKET - HEADER;
constexpr uint8_t SF = 7;
constexpr uint32_t BANDWIDTH = 125000;
constexpr uint8_t CODING_DENOMINATOR = 5;
constexpr uint16_t PREAMBLE = 8;

inline uint32_t crc32(const char* bytes, size_t length) {
  uint32_t crc = ~uint32_t(0);
  for (size_t i = 0; i < length; ++i) {
    crc ^= static_cast<uint8_t>(bytes[i]);
    for (unsigned bit = 0; bit < 8; ++bit)
      crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}

inline bool hex(const char* text, size_t count, uint64_t& result) {
  result = 0;
  for (size_t i = 0; i < count; ++i) {
    const char c = text[i];
    const int n = c >= '0' && c <= '9' ? c - '0' : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
    if (n < 0) return false;
    result = (result << 4) | static_cast<unsigned>(n);
  }
  return true;
}

struct Frame {
  uint64_t id = 0;
  uint32_t checksum = 0;
  const char* sequence = nullptr;
};

inline bool parse(const char* packet, Frame& frame) {
  const size_t size = strlen(packet);
  if (size <= HEADER || size > MAX_PACKET || strncmp(packet, "M2:", 3)
      || packet[19] != ':' || packet[28] != ':') return false;
  uint64_t checksum;
  if (!hex(packet + 3, 16, frame.id) || frame.id == 0 || !hex(packet + 20, 8, checksum)) return false;
  frame.checksum = static_cast<uint32_t>(checksum);
  frame.sequence = packet + HEADER;
  // Prevent framing/newline injection into the unchanged Mega UART protocol.
  for (const char* p = frame.sequence; *p; ++p)
    if (!((*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9') || *p == ',' || *p == '.')) return false;
  return crc32(frame.sequence, size - HEADER) == frame.checksum;
}

inline void key(const Frame& frame, char* out, size_t size) {
  if (size < 26) { if (size) out[0] = '\0'; return; }
  const char* digits = "0123456789ABCDEF";
  for (unsigned i = 0; i < 16; ++i) out[i] = digits[(frame.id >> ((15 - i) * 4)) & 15];
  out[16] = ':';
  for (unsigned i = 0; i < 8; ++i) out[17 + i] = digits[(frame.checksum >> ((7 - i) * 4)) & 15];
  out[25] = '\0';
}

// One atomic NVS blob: reserve BEFORE touching UART, mark queued afterward.
// A reserved record after reboot must never be forwarded a second time.
constexpr uint32_t JOURNAL_MAGIC = 0x4D563201;
enum Stage : uint8_t { RESERVED = 1, UART_QUEUED = 2 };
struct Record {
  uint32_t magic = 0;
  uint64_t id = 0;
  uint32_t checksum = 0;
  uint8_t stage = 0;
  char sequence[MAX_SEQUENCE + 1] = {};
};
enum class Delivery { NEW, DUPLICATE, STALE, CONFLICT, UNCERTAIN };

inline bool valid(const Record& record) {
  return record.magic == JOURNAL_MAGIC && record.id != 0
    && (record.stage == RESERVED || record.stage == UART_QUEUED)
    && record.sequence[MAX_SEQUENCE] == '\0'
    && crc32(record.sequence, strlen(record.sequence)) == record.checksum;
}

inline Delivery classify(const Frame& frame, const Record& record) {
  if (!record.magic) return Delivery::NEW;
  if (frame.id < record.id) return Delivery::STALE;
  if (frame.id > record.id) return Delivery::NEW;
  if (frame.checksum != record.checksum || strcmp(frame.sequence, record.sequence)) return Delivery::CONFLICT;
  return record.stage == UART_QUEUED ? Delivery::DUPLICATE : Delivery::UNCERTAIN;
}

inline Record reserve(const Frame& frame) {
  Record record{};
  record.magic = JOURNAL_MAGIC;
  record.id = frame.id;
  record.checksum = frame.checksum;
  record.stage = RESERVED;
  strncpy(record.sequence, frame.sequence, MAX_SEQUENCE);
  return record;
}

// SX127x explicit header, CRC enabled. ACK timing starts after TX_DONE, so the
// mission airtime itself is never incorrectly charged against the ACK window.
inline uint32_t airtimeMs(size_t bytes) {
  const int de = ((uint64_t(1) << SF) * 1000 / BANDWIDTH) >= 16 ? 1 : 0;
  const int numerator = 8 * static_cast<int>(bytes) - 4 * SF + 28 + 16;
  const int denominator = 4 * (SF - 2 * de);
  const int groups = numerator > 0 ? (numerator + denominator - 1) / denominator : 0;
  const uint32_t symbols = 8 + groups * CODING_DENOMINATOR;
  const uint64_t quarters = (4 * PREAMBLE + 17 + 4 * symbols) * (uint64_t(1) << SF) * 1000;
  return static_cast<uint32_t>((quarters + 4 * BANDWIDTH - 1) / (4 * BANDWIDTH));
}

inline uint32_t ackTimeoutMs(size_t sequenceBytes) {
  // Includes ACK airtime, 9600-baud Mega handoff, NVS/turnaround and USB margin.
  const uint32_t budget = airtimeMs(30) + (sequenceBytes + 5) * 10000 / 9600 + 750;
  return budget > 1500 ? budget : 1500;
}
}
