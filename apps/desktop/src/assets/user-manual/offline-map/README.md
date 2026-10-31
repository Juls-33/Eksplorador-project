# Offline Map guide screenshots

These are rectangular crops of existing desktop-window captures in the local
temporary `eksplorador-offline-captures` directory. The existing
`apps/desktop/.manual-offline-capture.ps1` captures the native desktop client
with PrintWindow. The pictures were inspected against TileManagerView.jsx and
HeatmapMap.jsx before reuse. No map content, labels, estimates, progress or
completion states were generated, painted over or replaced.

Crop coordinates are source pixels, expressed as x, y, width, height:

| Asset | Source capture | Crop | Shows |
| --- | --- | --- | --- |
| search-map.png | overview.png | 480, 315, 1972, 530 | Zoom, place search, Go, saved-map selector and existing campus map |
| selected-area.png | selected-area.png | 480, 183, 1972, 739 | Actual two-corner rectangle and Undo last pin / Remove a pin / Clear all |
| area-settings.png | selected-area.png | 480, 937, 1972, 465 | Unnamed selection, coordinate and zoom inputs, Estimate and disabled Download |
| saved-areas.png | selected-area.png | 480, 4, 1972, 135 | Existing cavite / Santa Rosa saved entries and their zoom ranges |

The map crops retain Leaflet / OpenStreetMap attribution. The campus selection
is only an interface example, not a farm boundary. The saved entries already
existed; they do not prove full coverage or a successful download during this
task. The settings capture has no name or computed estimate. Captions state
these limits and tell operators to use their own location.

Vite imports package these assets with the desktop frontend. Each displayed
image uses the existing manual lightbox with zoom, Fit width and Escape.

## Screenshots still needed

- A real location search with its results displayed.
- A named real selection after Estimate, showing its computed tiles / GB / min.
- A real download in progress with actual counts.
- A real completed download and its actual failed count, with the resulting
  Covered Areas entry.
- The intended saved area displayed with internet disconnected, including
  Offline — saved tiles and the map detail needed for fieldwork.

No new download, connectivity change, database write or rover operation was
performed to obtain these images. Do not substitute a mocked browser screenshot
for any missing native download or offline-verification evidence.
