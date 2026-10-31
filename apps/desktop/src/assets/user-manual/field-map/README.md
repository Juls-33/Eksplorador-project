# Field Map guide visuals

`overview.png` is an unmodified client-window capture of the running Tauri app.
The saved UST field mission and its waypoints already existed. No mission was
created or transmitted for this capture. The screenshot shows the receiver
searching, no saved samples, and blank sensor values. The displayed marker,
heading and calculated distances must not be interpreted as confirmed live GPS.

The following images are rectangular crops of that same capture. No controls,
statuses, readings or map content were painted in or replaced:

- `mission-directory.png`: Mission Directory and the saved mission card.
- `map-controls.png`: layer selector, zoom, place search and downloaded-area menu.
- `layer-legend.png`: the current Overall Soil Health legend (display bands,
  not recorded measurements).

`movement-sequence.svg` and `mission-handoff.svg` are source-based process
diagrams, explicitly labeled as illustrations. They are not UI screenshots,
measured routes, sensor data, successful ACKs or proof of rover execution.

All assets are imported through Vite and can be enlarged using the existing
User Manual lightbox. The map screenshot retains OpenStreetMap attribution.
