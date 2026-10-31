import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { getHelpRoute, MANUAL_GUIDES } from '../src/config/helpRoutes.js';
import { getSourceTab, helpNavigationReducer, initialNavigation } from '../src/utils/helpNavigation.js';

let server, UserManual, HelpButton, PageTransition;
before(async () => {
  server = await createServer({
    configFile: false, root: fileURLToPath(new URL('../', import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  });
  UserManual = (await server.ssrLoadModule('/src/views/UserManualView.jsx')).default;
  HelpButton = (await server.ssrLoadModule('/src/components/ui/HelpButton.jsx')).default;
  PageTransition = (await server.ssrLoadModule('/src/components/ui/PageTransition.jsx')).default;
});
after(async () => { await server?.close(); });

const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const destinations = [
  ['Dashboard', 'monitoring', 'Live Monitoring'],
  ['Field Map', 'field', 'Field Map'],
  ['Crop Assessment', 'crops', 'Crop Assessment'],
  ['Reports', 'reports', 'Reports'],
  ['Offline Maps', 'offline', 'Offline Maps'],
];

for (const [tabId, guideId, pageLabel] of destinations) {
  test(`${pageLabel} Help opens the matching guide and Back retains its source tab`, () => {
    const source = helpNavigationReducer(initialNavigation, { type: 'tab', tabId });
    const opened = helpNavigationReducer(source, { type: 'help' });
    assert.deepEqual(opened, { activeTab: 'User Manual', help: { guideId, pageLabel, fromTab: tabId } });
    assert.equal(getSourceTab(opened), tabId);
    assert.deepEqual(helpNavigationReducer(opened, { type: 'back' }), source);
    const button = render(HelpButton, { viewId: tabId, onOpen() {} });
    const guide = MANUAL_GUIDES.find(item => item.id === guideId);
    assert.ok(button.includes(`aria-label="Open ${guide.label}"`));
    assert.match(button, /type="button"/);
  });
}

for (const { id, label } of MANUAL_GUIDES) {
  test(`initial guide ${id} renders ${label} at its introduction with six accessible guide buttons`, () => {
    const html = render(UserManual, { initialGuideId: id, backLabel: 'Field Map', onBack() {} });
    assert.equal((html.match(/aria-pressed="(?:true|false)"/g) || []).length, 6);
    const selected = html.match(/<button[^>]*aria-pressed="true"[^>]*>([\s\S]*?)<\/button>/)?.[1];
    assert.ok(selected?.includes(`<span>${label}</span>`), `Expected ${label} to be selected`);
    assert.match(html, /01 \/ 0[6789]/);
    assert.match(html, /aria-label="Back to Field Map"/);
    assert.match(html, /<h2[^>]*tabindex="-1"/);
    assert.match(html, /<dialog[^>]*aria-labelledby="manual-photo-caption"/);
  });
}

test('direct sidebar opening defaults to Rover and has no contextual Back control', () => {
  const opened = helpNavigationReducer(initialNavigation, { type: 'tab', tabId: 'User Manual' });
  assert.deepEqual(opened, { activeTab: 'User Manual', help: null });
  assert.equal(getSourceTab(opened), null);
  const html = render(UserManual);
  assert.match(html, /<h2[^>]*>Getting Started<\/h2>/);
  assert.doesNotMatch(html, /manual-back-button/);
  assert.match(html, /aria-pressed="true"[^>]*>[\s\S]*?<span>Rover Operation Guide/);
});

test('unknown guides fall back to Rover; unrelated tabs do not invent Help destinations', () => {
  assert.equal(getHelpRoute('Rover Control'), null);
  assert.equal(getHelpRoute('toString'), null);
  assert.equal(render(HelpButton, { viewId: 'Rover Control', onOpen() {} }), '');
  assert.equal(render(HelpButton, { viewId: 'Reports' }), '');
  assert.match(render(UserManual, { initialGuideId: 'missing' }), /<h2[^>]*>Getting Started<\/h2>/);
  assert.equal(helpNavigationReducer(initialNavigation, { type: 'tab', tabId: 'missing' }), initialNavigation);
});

test('manual navigation cannot create a Help/Back loop or retain a stale origin', () => {
  const contextual = helpNavigationReducer(initialNavigation, { type: 'help' });
  assert.equal(helpNavigationReducer(contextual, { type: 'help' }), contextual);
  const direct = helpNavigationReducer(contextual, { type: 'tab', tabId: 'User Manual' });
  assert.equal(direct.help, null);
  assert.equal(helpNavigationReducer(direct, { type: 'back' }), direct);
  const reports = helpNavigationReducer(contextual, { type: 'tab', tabId: 'Reports' });
  assert.equal(reports.help, null);
  assert.equal(helpNavigationReducer(reports, { type: 'back' }), reports);
  assert.equal(helpNavigationReducer(reports, { type: 'help' }).help.fromTab, 'Reports');
});

test('covered source content is retained but hidden and inert during contextual Help', () => {
  const html = render(PageTransition, { transitionKey: 'Field Map', hidden: true, children: React.createElement('input', { defaultValue: 'draft mission' }) });
  assert.match(html, /hidden=""/);
  assert.match(html, /inert=""/);
  assert.match(html, /value="draft mission"/);
});
