import React, { useState, useMemo, useEffect } from 'react';
import HeatmapMap from './components/HeatmapMap';
import { useLoRaConnection } from './hooks/useLoRaConnection';
const hasLiveGpsFix = d => d && d.satsLocked > 0 && d.lat !== 0 && d.lng !== 0;
function App() {
  const receiverStatus = useLoRaConnection();
  const [liveData, setLiveData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [batteryData, setBatteryData] = useState(null);
  const [soilReadings, setSoilReadings] = useState([]);
  const selectedHistoricalPos = null;
  const latestDbPos = null;
  const displayedHeatPoints = [];
  const displayScale = () => 1;
  const hasGpsFix =
    isConnected && hasLiveGpsFix(liveData);
  const soilOk = liveData && liveData.soilValid === 1;
  function handleData(data) {
    if(data.type === 'battery') { setBatteryData(data); return; }
    if(hasLiveGpsFix(data) && data.soilValid === 1) setSoilReadings(x => [...x,data]);
    setLiveData(data);
    setIsConnected(true);
  }
  return <div>
    <HeatmapMap
      center={
        selectedHistoricalPos ||
        (
          hasGpsFix
            ? [liveData.lat, liveData.lng]
            : latestDbPos || [14.6095, 120.9890]
        )
      }
      heatPoints={displayedHeatPoints}
      valueToIntensity={displayScale}
      roverPos={
        !selectedHistoricalPos && hasGpsFix
          ? [liveData.lat, liveData.lng]
          : null
      }
      gpsWarning={
        !hasGpsFix
          ? !isConnected
            ? 'Waiting for rover telemetry and GPS position.'
            : Number(liveData?.satsLocked) === 0
              ? '0 satellites locked. Live location is unavailable.'
              : 'Waiting for valid GPS coordinates.'
          : null
      }
    />
    <span>{soilOk?'Soil OK':'No soil'}</span>
  </div>;
}
export default App;
