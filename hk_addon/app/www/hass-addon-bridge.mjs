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

function pushHass(app, baseHass, statesMap) {
  app.hass = { ...baseHass, states: statesMap };
  if (typeof app.requestUpdate === 'function') {
    app.requestUpdate();
  }
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
      const text = await r.text();
      if (!r.ok) {
        window.__HK_ADDON_HA_LAST_ERROR__ = `HTTP ${r.status}: ${text.slice(0, 400)}`;
        window.__HK_ADDON_HA_STATE_COUNT__ = 0;
        console.error('[HK Add-on][hass-bridge]', window.__HK_ADDON_HA_LAST_ERROR__);
        pushHass(app, baseHass, {});
        return;
      }
      let arr;
      try {
        arr = JSON.parse(text);
      } catch (e) {
        window.__HK_ADDON_HA_LAST_ERROR__ = 'Ungültige JSON-Antwort von /api/ha/states';
        window.__HK_ADDON_HA_STATE_COUNT__ = 0;
        console.error('[HK Add-on][hass-bridge]', e, text.slice(0, 200));
        pushHass(app, baseHass, {});
        return;
      }
      if (!Array.isArray(arr)) {
        window.__HK_ADDON_HA_LAST_ERROR__ = 'Antwort ist kein State-Array';
        window.__HK_ADDON_HA_STATE_COUNT__ = 0;
        pushHass(app, baseHass, {});
        return;
      }
      window.__HK_ADDON_HA_LAST_ERROR__ = null;
      window.__HK_ADDON_HA_STATE_COUNT__ = arr.length;
      const statesMap = statesArrayToMap(arr);
      pushHass(app, baseHass, statesMap);
    } catch (e) {
      window.__HK_ADDON_HA_LAST_ERROR__ = String(e?.message || e);
      window.__HK_ADDON_HA_STATE_COUNT__ = 0;
      console.error('[HK Add-on][hass-bridge]', e);
      pushHass(app, baseHass, {});
    }
  }

  pushHass(app, baseHass, {});
  setInterval(poll, 500);
  poll();
}
