import React, { useLayoutEffect, useRef } from 'react';
import { motionOptions } from '../../utils/motion.js';

// Restart the existing presentation layer, including during rapid navigation.
// Children keep their identity; there is no exit wait or resting transform.
export default function PageTransition({ transitionKey, hidden = false, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (hidden) return;
    const element = ref.current;
    const options = motionOptions(element);
    const animation = options.duration > 0 && element.animate
      ? element.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], options)
      : null;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const reduce = () => { if (preference.matches) animation?.cancel(); };
    preference.addEventListener('change', reduce);
    return () => { animation?.cancel(); preference.removeEventListener('change', reduce); };
  }, [transitionKey, hidden]);

  return <div ref={ref} className="page-transition" hidden={hidden} inert={hidden}>
    {children}
  </div>;
}
