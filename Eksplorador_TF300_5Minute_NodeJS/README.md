# Eksplorador Point A → Point B: TF300.000 (5-minute upper bound)

**Scope:** Up to **300.000 seconds** of a *single timed forward command*, not a GPS-guided route. The last validated hardware run was around 28–30 seconds; 5-minute operation is **not hardware-validated**. Do **not** use the current bench-only no-echo-clear ultrasonic profile for autonomous movement on the ground. For the upcoming soil sampling field work, remain on supervised MANUAL RC operation until ground-level obstacle protection and stopping distances have been validated.

This patch updates five corresponding software guardrails together. **Updating only the UI is insufficient:** the Mega and Rust validator currently reject `TF300.000`.

## Installation — Node.js, no Python/npm installer dependencies

Unzip the entire `Eksplorador_TF300_5Minute_NodeJS` folder into:

`D:\UST Capstone\Eksplorador-project\Eksplorador_TF300_5Minute_NodeJS\`

From PowerShell in the **project root**:

```powershell
cd "D:\UST Capstone\Eksplorador-project"
node .\Eksplorador_TF300_5Minute_NodeJS\apply_tf300.js . --dry-run
```

If multiple potential Mega sketches are found, the installer intentionally stops. Select the **Mega source currently flashed** (not the ESP32 `.ino`) explicitly. Example *only if that path contains your correct current Mega sketch*:

```powershell
node .\Eksplorador_TF300_5Minute_NodeJS\apply_tf300.js . --dry-run --mega "embedded\1 V3 semi auto firmware test\semi-autonomous\semi-autonomous.ino"
```

The actual `.ino` path may differ on your workstation. Do **not** select a legacy copy or guess. If the script prints `Mega version mismatch`, it refuses to modify older firmware without the already working encoder-sign and sonar-pause safeguards. Use your latest verified source, rather than forcing an install against a different version.

After **all five** entries show `WOULD PATCH`, apply using the same command without `--dry-run`:

```powershell
node .\Eksplorador_TF300_5Minute_NodeJS\apply_tf300.js . --mega "embedded\1 V3 semi auto firmware test\semi-autonomous\semi-autonomous.ino"
```

The script validates all five source files *before writing anything*, creates timestamped backups inside the installer folder, and is repeatable without double edits. It does **not** flash any hardware.

## Modified source files

1. `apps/desktop/src/utils/pointToPointMission.js` — `MAX_LEG_S` 60→300; retain manual/GPS validation, never silently shorten paths longer than 5 minutes; small floating-point epsilon so a legitimate exactly-300-second calculation isn't rejected.
2. `apps/desktop/src/components/PointToPointMissionDialog.jsx` — dynamic maximum displays 300; adds explicit warning for legs over 60 seconds; operator checkboxes unchanged.
3. `apps/desktop/src/components/MissionDeploymentWizard.jsx` — CH6 authorization wording 60→300; workflow unchanged.
4. `apps/desktop/src-tauri/src/mission_protocol.rs` — server-side TF validator 60→300 and corresponding test boundaries.
5. **Your selected Mega sketch only** — `A31_MAX_STEP_MS` 60,000→300,000 and `A31_MAX_LEG_MS` 120,000→300,000. **Every other byte of the Mega sketch remains unchanged.**

**No changes:** rover ESP32, desktop receiver ESP32, LoRa radio profile, telemetry, soil sensing, GPS fallback implementation, obstacle-alert popup, motor/encoder polarity, RC authorization, emergency interlocks, ultrasonic stopping behavior, `A31_PAUSE_MAX_MS = 30000`, or the encoder stall thresholds.

> The `source/` directory includes updated 300-second **reference sketches** derived from the latest provided sonar transient-guard bench and strict files. Prefer patching **your actually flashed source** with the installer; never overwrite it with an unverified archived reference sketch. The reference sketches still require your existing `SemiAutoStartPolicy.h` and other original Arduino dependencies.

## Verify without powering on the rover

```powershell
node .\Eksplorador_TF300_5Minute_NodeJS\tests\regression.cjs
cd apps\desktop
npm run build
cd src-tauri
cargo test --lib mission_protocol
cargo test --lib obstacle_alert
```

Then verify the selected `.ino` in Arduino IDE with your existing libraries (not yet validated here). The source edit alone does not change firmware already flashed on the board.

### Before physical testing, preferably after the soil field session

- Charge and balance-check the 4S battery; ensure independent physical E-stop/RC disarm and sufficient space.
- Use a short **tracks securely raised** test command first (such as `TF5.000`) with the updated Mega. Confirm encoder feedback, stop, and pause/resume as before.
- Verify desktop can prepare `TF300.000`, that the updated Mega accepts it, and `TF300.001` is refused. You can verify parsing while keeping the motor power disconnected, but encoder-stall protection will prevent completion without actual rotation.
- To assess sustained travel and real stopping distances, first implement/verify the **strict** obstacle profile on the real ground. The BENCH profile can treat no echoes as clear and is not field-safe.
- For live movement, continue with shorter supervised trials before attempting any longer interval. A 300-second single-timer mission **does not correct course** and may drift substantially. `0.25 m/s` is an estimate (up to ~75 meters in 300 seconds), not a measured guarantee.
- HOLD/DISARM and ultrasonic pause/resume durations are unchanged. Current maximum continuous pause remains **30 seconds**; an expired pause aborts, not resumes.

## Important limitation

This is an **offline source patch with regression tests**. We have not performed a real AVR compilation (Arduino toolchain unavailable in this container), full Tauri/Cargo build, or physical five-minute safety test. Do not treat the new upper bound as field-ready simply because earlier 30-second bench missions worked.
