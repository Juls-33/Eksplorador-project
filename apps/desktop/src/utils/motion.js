// Read the shared CSS timings at the moment an imperative animation starts.
export function motionOptions(element, token = '--motion-slow') {
  const style = getComputedStyle(element);
  const value = style.getPropertyValue(token).trim();
  const duration = Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
  return {
    duration: matchMedia('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(duration) ? 0 : duration,
    easing: style.getPropertyValue('--ease-out').trim() || 'ease-out',
  };
}
