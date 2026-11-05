import React from 'react';

export default function MissionPrerequisites({items}) {
  return <section aria-label="Send Mission prerequisites">
    <strong>Send Mission prerequisites</strong>
    <ul>{items.map(item => <li key={item.key}>
      <strong>{item.label}: {item.ready ? 'Ready' : 'Missing'}</strong>
      <div style={{fontSize:'0.75rem'}}>{item.detail}</div>
    </li>)}</ul>
    <p>Send Mission only stages the mission. Physical movement requires RC authorization and a deliberate HOLD-to-SEMI_AUTO transition after staging and calibration. Keep HOLD/DISARM during upload.</p>
  </section>;
}
