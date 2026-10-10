import { useEffect, useState } from 'react';
import { getDownloadJob, subscribeDownloadJob } from '../services/tileStorage';

// Full job state — for the Offline Maps screen, which shows live progress.
export default function useDownloadJob() {
  const [job, setJob] = useState(getDownloadJob());

  useEffect(() => {
    setJob(getDownloadJob()); // catch anything that changed between render and subscribing
    return subscribeDownloadJob(setJob);
  }, []);

  return job;
}

// Just "is something downloading, and how far along" as a single number
// (-1 = nothing running, otherwise 0-100). Because it is a primitive, React
// skips re-rendering the caller until the whole-number percent actually
// changes — so the app shell can show a sidebar badge without re-rendering
// on every single tile.
export function useDownloadPercent() {
  const compute = (job) =>
    job.status === 'running' && job.progress
      ? Math.min(100, Math.floor((job.progress.done / Math.max(1, job.progress.total)) * 100))
      : -1;

  const [percent, setPercent] = useState(compute(getDownloadJob()));

  useEffect(() => {
    setPercent(compute(getDownloadJob()));
    return subscribeDownloadJob((job) => setPercent(compute(job)));
  }, []);

  return percent;
}