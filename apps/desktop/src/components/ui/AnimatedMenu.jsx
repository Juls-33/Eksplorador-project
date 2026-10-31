import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motionOptions } from '../../utils/motion.js';

// Retain the last result list through its exit and place it outside map clipping.
export default function AnimatedMenu({ open, anchorRef, onDismiss, children }) {
  const [present, setPresent] = useState(open);
  const ref = useRef(null);
  const interruptedFrame = useRef(null);
  const lastChildren = useRef(children);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  if (open) lastChildren.current = children;

  // Presence bookkeeping must not restart or cancel an opening animation.
  useLayoutEffect(() => {
    if (!open && !present) return;
    const element = ref.current;
    if (open) setPresent(true);
    const options = motionOptions(element, '--motion-normal');
    const from = { opacity: 0, transform: 'translateY(-4px) scale(0.98)' };
    const to = { opacity: 1, transform: 'translateY(0) scale(1)' };
    // A reversal starts from the current rendered frame, not a hardcoded end.
    const start = interruptedFrame.current || (open ? from : to);
    const animation = options.duration > 0 ? element.animate([start, open ? to : from], options) : null;
    let cancelled = false;
    const finish = () => { if (!cancelled && !open) setPresent(false); };
    if (animation) animation.finished.then(finish).catch(() => {}); else finish();
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const reduce = () => { if (preference.matches) { animation?.cancel(); finish(); } };
    preference.addEventListener('change', reduce);
    return () => {
      cancelled = true;
      const current = getComputedStyle(element);
      interruptedFrame.current = animation?.playState === 'running' ? { opacity: current.opacity, transform: current.transform } : null;
      animation?.cancel();
      preference.removeEventListener('change', reduce);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open && !present) return;
    const anchor = anchorRef.current, element = ref.current;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      if (!rect.width || !rect.height || anchor.closest('[hidden], [inert]')) {
        element.style.visibility = 'hidden';
        dismissRef.current();
        return;
      }
      element.style.visibility = 'visible';
      const width = Math.min(Math.max(rect.width, 220), innerWidth - 16);
      const below = innerHeight - rect.bottom - 14, above = rect.top - 14;
      const upwards = below < 120 && above > below;
      Object.assign(element.style, {
        width: `${width}px`, left: `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`,
        top: upwards ? 'auto' : `${rect.bottom + 6}px`, bottom: upwards ? `${innerHeight - rect.top + 6}px` : 'auto',
        maxHeight: `${Math.max(0, Math.min(240, upwards ? above : below))}px`,
        transformOrigin: upwards ? 'bottom left' : 'top left',
      });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(anchor);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open, present, anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const dismiss = event => { if (!ref.current.contains(event.target) && !anchor.contains(event.target)) dismissRef.current(); };
    const keyboard = event => {
      if (!ref.current.contains(event.target) && !anchor.contains(event.target)) return;
      if (event.key === 'Escape') { event.preventDefault(); dismissRef.current(); anchor.querySelector('input, button')?.focus({ preventScroll: true }); }
      const items = [...ref.current.querySelectorAll('button:not(:disabled)')];
      const anchorItems = [...anchor.querySelectorAll('input, button:not(:disabled)')];
      if (event.key === 'Tab') {
        if (!event.shiftKey && event.target === anchorItems.at(-1)) { event.preventDefault(); items[0]?.focus(); }
        else if (event.shiftKey && event.target === items[0]) { event.preventDefault(); anchorItems.at(-1)?.focus(); }
        else if (!event.shiftKey && event.target === items.at(-1)) { anchorItems.at(-1)?.focus(); dismissRef.current(); }
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index <= 0 ? items.length : index) - 1;
        items[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', keyboard); };
  }, [open, anchorRef]);

  if (!open && !present) return null;
  return createPortal(<div ref={ref} className="animated-menu ui-menu" aria-hidden={!open} inert={!open}>
    {open ? children : lastChildren.current}
  </div>, document.querySelector('.dashboard-layout') || document.body);
}
