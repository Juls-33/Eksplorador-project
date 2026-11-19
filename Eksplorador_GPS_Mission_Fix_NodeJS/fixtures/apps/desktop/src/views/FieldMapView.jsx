import { operatorMapStart } from '../utils/pointToPointMission.js';
function useState(){}; function useRef(){}; function useEffect(){};
function mockFieldMapView() {
  const [roverPos, setRoverPos] = useState(null);
  const [roverHeading, setRoverHeading] = useState(null);
  const planningGps = receiverStatus.connected && !receiverStatus.connectionError
    ? receiverStatus.planning_gps?.current ?? null : null;
  const gpsExpiry = useRef(null);
  useEffect(() => {
    if (!receiverStatus.connected || receiverStatus.connectionError) {
      setRoverPos(null); setRoverHeading(null);
      clearTimeout(gpsExpiry.current);
    }
  }, [receiverStatus.connected, receiverStatus.connectionError]);
  useEffect(() => () => clearTimeout(gpsExpiry.current), []);
  const hasValidGps = true;
      if (hasValidGps) {
        setRoverPos([lat, lng]);
        clearTimeout(gpsExpiry.current);
        gpsExpiry.current = setTimeout(() => { setRoverPos(null); setRoverHeading(null); }, 5000);
      } else {
        clearTimeout(gpsExpiry.current);
        setRoverPos(null); setRoverHeading(null);
      }
}
