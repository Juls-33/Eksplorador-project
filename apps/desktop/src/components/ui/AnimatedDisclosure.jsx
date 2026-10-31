import React, { useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function AnimatedDisclosure({ title, defaultOpen = false, className = '', children }) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const id = useId();
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const toggle = () => {
    if (expanded && panelRef.current.contains(document.activeElement)) triggerRef.current.focus({ preventScroll: true });
    setExpanded(value => !value);
  };

  return <section className={`animated-disclosure ${className}`} data-expanded={expanded}>
    <button ref={triggerRef} type="button" className="disclosure-trigger" id={`${id}-trigger`}
      aria-expanded={expanded} aria-controls={`${id}-panel`} onClick={toggle}>
      <span>{title}</span><ChevronDown className="disclosure-chevron" size={17} aria-hidden="true" />
    </button>
    <div ref={panelRef} id={`${id}-panel`} className="disclosure-panel" aria-hidden={!expanded} inert={!expanded}>
      <div className="disclosure-clip"><div className="disclosure-content">{children}</div></div>
    </div>
  </section>;
}
