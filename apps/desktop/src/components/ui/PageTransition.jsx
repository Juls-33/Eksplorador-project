import React, { useLayoutEffect, useState } from 'react';

// Animate an existing container, never key/remount operational page content.
// Rapid navigation can share a brief entrance; it never waits for an exit.
export default function PageTransition({ transitionKey, hidden = false, children }) {
  const [entering, setEntering] = useState(false);
  useLayoutEffect(() => {
    if (!hidden) setEntering(true);
  }, [transitionKey, hidden]);

  return <div className={`page-transition${entering ? ' is-entering' : ''}`} hidden={hidden} inert={hidden}
    onAnimationEnd={event => { if (event.target === event.currentTarget) setEntering(false); }}>
    {children}
  </div>;
}
