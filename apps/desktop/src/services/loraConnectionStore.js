// One subscription and revision-ordered snapshot for every desktop receiver view.
// A missing receiver remains searchable: the backend continuously scans ports.
export function createLoRaConnectionStore({ listen, invoke }) {
  let snapshot = {
    connected: false, port: null, mode: null, revision: -1,
    hadConnection: false, connectionError: null,
  };
  const subscribers = new Set();
  let generation = 0;
  let unlisten;

  const publish = next => {
    snapshot = next;
    subscribers.forEach(notify => notify());
  };
  const accept = (value, epoch) => {
    if (epoch !== generation || !subscribers.size || value.revision < snapshot.revision) return;
    publish({
      ...value,
      hadConnection: snapshot.hadConnection || value.connected,
      connectionError: null,
    });
  };
  const reportError = (error, epoch) => {
    if (epoch === generation && subscribers.size) {
      publish({...snapshot, connectionError: String(error)});
    }
  };
  const refresh = async (epoch = generation) => {
    try { accept(await invoke('get_rx_board_connection'), epoch); }
    catch (error) { reportError(error, epoch); }
  };
  const start = async epoch => {
    try {
      const stop = await listen('rx-board-connection', event => accept(event.payload, epoch));
      if (epoch !== generation || !subscribers.size) { stop(); return; }
      unlisten = stop;
      await refresh(epoch); // Subscribe before reading, so discoveries cannot be missed.
    } catch (error) { reportError(error, epoch); }
  };

  return {
    getSnapshot: () => snapshot,
    refresh,
    subscribe(notify) {
      subscribers.add(notify);
      if (subscribers.size === 1) start(++generation);
      return () => {
        subscribers.delete(notify);
        if (!subscribers.size) {
          generation += 1;
          unlisten?.();
          unlisten = undefined;
        }
      };
    },
  };
}
