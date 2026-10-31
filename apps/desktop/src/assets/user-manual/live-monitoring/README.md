# Live Monitoring screenshots

`overview.png` is an unmodified client-window capture of the real running Tauri
app after opening Live Monitoring and scrolling to the top. No receiver was
connected and no sensor packet or sample was injected. The displayed waiting
labels, dashes, empty queue and empty recent-records table are genuine UI state.

The other PNGs are rectangular crops of this same screenshot:

- `connection-cards.png`: receiver search, rover telemetry waiting and Probe --.
- `gps-warning.png`: the actual GPS not locked message.
- `soil-moisture-ph.png`: the moisture and pH cards, without valid measurements.
- `soil-ec-npk.png`: the EC and NPK cards and their displayed units.
- `sampling-queue.png`: the queue before a packet arrives.
- `recent-samples.png`: the saved-record table headers and empty state.

No labels, readings, coordinates, timestamps or statuses were painted in or
replaced. The full screenshot retains map attribution. These images document a
captured screen, not the reader's current hardware status. No successful fix,
valid soil measurement or connected-receiver screenshot was fabricated.

The existing manual lightbox provides enlargement and zoom. Vite imports
package these files for development and production without external image URLs.
