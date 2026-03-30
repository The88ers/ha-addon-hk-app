/**
 * HK Addon – lädt dieselbe Lit-App wie hkweb-app-v2.1.17 (liquid-glass-app.js),
 * versorgt sie mit hass über den Supervisor-Proxy (hass-addon-bridge.mjs).
 */
window.__HK_ADDON__ = true;

import { mountHassBridge } from './hass-addon-bridge.mjs';

await import('./liquid-glass-app.js');

const host = document.getElementById('host');
if (!host) {
  throw new Error('HK Addon: #host fehlt');
}

const app = document.createElement('hk-web-app');
host.appendChild(app);
mountHassBridge(app);
