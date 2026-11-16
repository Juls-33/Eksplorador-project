import React, { useEffect, useRef } from 'react';
import { Check, Image as ImageIcon, X } from 'lucide-react';
import sandy from '../assets/soil-types/sandy.webp';
import sandyLoam from '../assets/soil-types/sandy-loam.webp';
import loam from '../assets/soil-types/loam.webp';
import siltLoam from '../assets/soil-types/silt-loam.webp';
import clayLoam from '../assets/soil-types/clay-loam.webp';
import clay from '../assets/soil-types/clay.webp';
import './SoilTypeGuide.css';

// Keep values identical to fields.soil_type and the Field Map select options.
export const SOIL_TYPE_REFERENCES = [
  { value: 'sandy', label: 'Sandy', image: sandy, alt: 'Illustrative loose, coarse, light-colored sandy soil',
    summary: 'Large, gritty grains; loose and generally fast-draining.',
    check: 'When damp, falls apart rather than forming a stable ball.' },
  { value: 'sandy-loam', label: 'Sandy loam', image: sandyLoam, alt: 'Illustrative coarse sandy loam soil',
    summary: 'Mostly sand with finer particles and some cohesion.',
    check: 'Gritty, but a damp handful forms a weak ball.' },
  { value: 'loam', label: 'Loam', image: loam, alt: 'Illustrative dark, crumbly loam soil',
    summary: 'Mixed sand, silt and clay; typically crumbly.',
    check: 'Feels both slightly gritty and smooth; holds a ball without a long ribbon.' },
  { value: 'clay-loam', label: 'Clay loam', image: clayLoam, alt: 'Illustrative cohesive clay-loam aggregates',
    summary: 'Noticeable clay; holds its shape while retaining some grit.',
    check: 'Forms a firm ball and a short ribbon when damp.' },
  { value: 'clay', label: 'Clay', image: clay, alt: 'Illustrative dense, dry cracked clay aggregates',
    summary: 'Very fine particles; sticky when wet and hard when dry.',
    check: 'Forms a long, cohesive ribbon when damp.' },
  { value: 'silt-loam', label: 'Silt loam', image: siltLoam, alt: 'Illustrative finely textured silt loam soil',
    summary: 'Fine, smooth particles; feels soft and floury when dry.',
    check: 'Smooth or silky rather than gritty; a damp ball is fragile.' }
];

export default function SoilTypeGuide({ open, value, saving = false, onClose, onChoose }) {
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(saving);
  onCloseRef.current = onClose;
  savingRef.current = saving;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !savingRef.current) onCloseRef.current();
      if (event.key !== 'Tab') return;
      const modal = closeRef.current?.closest('[role="dialog"]');
      const controls = [...(modal?.querySelectorAll('button:not([disabled])') || [])];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="soil-guide-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="soil-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="soil-guide-title" aria-describedby="soil-guide-description">
        <header className="soil-guide-header">
          <div className="soil-guide-header__title">
            <span className="soil-guide-header__icon"><ImageIcon size={22} aria-hidden="true" /></span>
            <div><h2 id="soil-guide-title">Soil Type Visual Guide</h2><p id="soil-guide-description">Compare examples before tagging the field's soil.</p></div>
          </div>
          <button type="button" className="soil-guide-close" ref={closeRef} onClick={onClose} disabled={saving} aria-label="Close soil type guide"><X size={19}/></button>
        </header>
        <div className="soil-guide-body">
          <div className="soil-guide-caution">
            These are <strong>illustrative references</strong>, not photographs or a soil texture test. Color can vary widely. Check the soil's feel when damp, or use an agricultural technician's field classification.
          </div>
          <div className="soil-guide-grid">
            {SOIL_TYPE_REFERENCES.map(soil => {
              const selected = soil.value === value;
              return (
                <article key={soil.value} className={`soil-guide-item${selected ? ' soil-guide-item--selected' : ''}`}>
                  <img src={soil.image} alt={soil.alt} loading="lazy" width="220" height="135" />
                  <div className="soil-guide-item__content">
                    <div className="soil-guide-item__top"><h3>{soil.label}</h3>{selected && <span className="soil-guide-current"><Check size={12} aria-hidden="true" /> Current</span>}</div>
                    <p>{soil.summary}</p>
                    <small><strong>Feel test:</strong> {soil.check}</small>
                    <button type="button" className="soil-guide-choose" disabled={saving || selected} onClick={() => onChoose(soil.value)}>
                      {selected ? 'Selected for this field' : saving ? 'Saving…' : `Use ${soil.label}`}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
        <footer className="soil-guide-footer">
          <span>The rover does not detect soil texture; classifications are entered by the operator.</span>
          <button type="button" onClick={onClose} disabled={saving}>Close guide</button>
        </footer>
      </section>
    </div>
  );
}
