# User Manual maintenance notes

The User Manual is a static React view. It does not send rover commands, verify
switch positions, or change mission, telemetry, database or firmware behavior.
The Field Map guide is described in `field-map-guide.md`, Live Monitoring
in `live-monitoring-guide.md`, Crop Assessment in `crop-assessment-guide.md`, and
Reports in `reports-guide.md`, and Offline Map in `offline-map-guide.md`.
All six guides are implemented. Guide topics
are selected individually to limit scrolling.

Contextual Help, return navigation and shared motion styles are described in
`global-ux.md`. Manual wording and instructional images are unchanged by that
UX update.

## References

- Custom controller assignments, battery specifications, power access and
  deployment sequence: the supplied Eksplorador operation-guide requirements.
- Deployment terminology checked against `MissionDeploymentWizard.jsx`: a
  matching rover-radio ACK is distinct from unverified Mega storage/execution.
- [Official EdgeTX v2.11 monochrome menu guide](https://manual.edgetx.org/v2.11/bw-radios/user-inteface).
  Menu behavior can vary with firmware, press duration and screen context.
- [Official SkyRC iMAX B6 manual](https://www.skyrc.com/files/26/IMAX_B6_Manual.pdf).
  The manual must match the actual charger revision before use.

## Physical checks still needed

Keep the visible **Charging setup — verify before use** label until the actual
charger setup has been checked. Confirm:

- Battery condition, chemistry and 4S cell count.
- Charger identity/revision, LiPo BALANCE settings and displayed/detected cell
  count. The initial proposed current is 1.0A; battery, charger and 12V/3A adapter
  limits and condition still need confirmation.
- Insulated XT90 charging adapter, main-lead polarity and correct balance port.
- Battery-checker negative pin, cell positions 1–4 and actual plug orientation.
  The UI deliberately gives no assumed physical orientation.
- Custom controller model configuration matches the supplied SA/SB/SD assignments
  and indicators on the physical rover. Indicators alone do not prove safety.

Outdoor navigation calibration is still needed. The guide makes no claim about
waypoint precision. A LoRa ACK does not independently verify Mega mission storage
or execution.

## Image review

Original assets are preserved. Vite imports package the images for offline
development and production use; only the optional reference links need internet.
Images use contained proportions, captions and a keyboard-accessible native
dialog for enlargement.

- The four generated guides are the primary images in Controller Overview,
  Actuator Control, Battery and Power, and Charging and Battery Safety. They
  appear immediately at full content width with their original aspect ratios.
  Original hardware photos and the manufacturer diagram remain in each topic's
  **View actual hardware photos** section.
- `imax-b6-charger.png` has a **2S CHARGE** example screen. Its caption explicitly
  warns against copying it and points to **4S LiPo BALANCE** settings.
- `imax-b6-charger-cables.png` shows assorted leads and clips. Its caption does
  not approve every pictured connector; the secure XT90 adapter is unverified.
- `guide-actuator.png` agrees with the supplied left-stick mapping: right extends
  down, left retracts up, and vertical stick movement is unused.
- `guide-battery.png` includes a 2S CHARGE example screen; the written instructions
  specify the required 4S LiPo BALANCE settings. The existing
  charging-verification warning remains. The image does not verify
  actual wiring, checker orientation or charging safety.
- `guide-power-access.png` has some labels saying “X90” instead of XT90.
  Its cover text says to slide toward the
  rear. The written instructions retain disarming before connection and XT90
  disconnection before battery removal.
- `guide-controller.png` agrees with SA CH5 ARM/DISARM, SB CH6 modes and SD CH8
  LoRa RX/TX. It also includes stick-channel labels CH1/CH2 and CH3/CH4;
  the written table defines the rover's switch and stick assignments.

The user reviewed the images and approved removal of the temporary image-review
banners from the guide cards and lightbox. The separate charging-setup warning
remains; this image review does not record physical charger verification.

Zoom controls scale image width
from 100% to 300%, with scrolling for the enlarged content and a Fit width reset.
No source image pixels, labels or arrows have been edited.

Do not replace or relabel supplied images silently. Review any replacement
against the actual hardware and written instructions first.

## Implementation validation (2026-10-31)

- `npm run build`: passed. Vite reports a JavaScript chunk over 500 kB.
- `node --test tests/*.test.js`: 21 passed.
- Chrome checks of development and production previews passed for all eight
  rover topics and four placeholder guides in the initial implementation. The
  image-hierarchy update checked all four expanded guides and 11 unique hardware
  references (15 images), photo accordions, preserved image proportions, compact
  topic selection, previous/next navigation, lightbox zoom/reset, Escape handling
  and focus restoration. The update was checked at 1366×768, 1024×768 and 800×600
  in development and production. These checks used a mocked Tauri bridge,
  without physical hardware.
- Rapid navigation through existing map views exposed a Leaflet canvas
  `_clear` / `_redraw` error (`reading 'save'`). The same error reproduced when
  serving the original `App.jsx` from Git HEAD in memory. Map code was left alone.
- Native Tauri packaging and physical rover/charging behavior were not tested.
