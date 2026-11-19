#pragma once
#include <stdint.h>

// Pure start policy shared by Mega firmware and desktop host-side regression tests.
// A short pending request is not a persistent auto-run permission.
namespace SemiAutoStartPolicy {
constexpr uint32_t START_WINDOW_MS = 8000UL;
struct Inputs {
  bool staged;
  bool recentExplicitSemiSelection;
  bool sawArmedHoldSinceRearm;
  bool rcFresh;
  bool rcRearmRequired;
  bool armed;
  bool selectedSemi;
  bool radioTxRequested;
  bool neutralSticks;
  bool tiltFault;
  bool encoderFault;
  bool sonarInterlockEnabled;
  bool sonarValid;
  bool sonarBlocked;
  uint32_t nowMs;
  uint32_t selectionMs;
};
inline bool withinWindow(uint32_t nowMs, uint32_t sinceMs) {
  return static_cast<uint32_t>(nowMs - sinceMs) <= START_WINDOW_MS;
}
inline bool canStart(const Inputs& i) {
  return i.staged && i.recentExplicitSemiSelection &&
    withinWindow(i.nowMs, i.selectionMs) && i.sawArmedHoldSinceRearm &&
    i.rcFresh && !i.rcRearmRequired && i.armed && i.selectedSemi &&
    i.radioTxRequested && i.neutralSticks && !i.tiltFault &&
    !i.encoderFault && (!i.sonarInterlockEnabled || (i.sonarValid && !i.sonarBlocked));
}
}
