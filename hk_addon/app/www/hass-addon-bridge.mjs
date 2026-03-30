/**
 * Stellt ein minimales hass-Objekt bereit (states + callService), wie die HK Web App
 * es vom Home-Assistant-Frontend erhält — hier über Supervisor-REST (server.mjs).
 */

/** Ingress: gleiche Logik wie früher main.js — Pfade relativ zum Ingress-Base, nicht HA-Root. */
export function addonApi(path) {
  const p = path.startsWith('/') ? path.slice(1) : path;
  const base = window.location.pathname.endsWith('/')
    ? window.location.pathname
    : `${window.location.pathname}/`;
  return `${base}${p}`;
}

function statesArrayToMap(states) {
  const o = {};
  if (!Array.isArray(states)) return o;
  for (const s of states) {
    if (s && s.entity_id) o[s.entity_id] = s;
  }
  return o;
}

/** @param {HTMLElement} app – <hk-web-app> */
export function mountHassBridge(app) {
  const callService = async (domain, service, serviceData = {}, target = {}) => {
    const body = { ...(serviceData || {}), ...(target || {}) };
    const url = addonApi(
      `/api/ha/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
    );
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      const err = new Error(t || `HTTP ${r.status}`);
      throw err;
    }
    return r.json().catch(() => ({}));
  };

  const baseHass = {
    states: {},
    callService,
  };

  async function poll() {
    try {
      const r = await fetch(addonApi('/api/ha/states'));
      if (!r.ok) return;
      const arr = await r.json();
      const statesMap = statesArrayToMap(arr);
      app.hass = { ...baseHass, states: statesMap };
    } catch (e) {
      console.warn('[HK Add-on][hass-bridge]', e);
    }
  }

  app.hass = { ...baseHass, states: {} };
  setInterval(poll, 500);
  poll();
}
