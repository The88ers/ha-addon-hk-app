/**
 * Stellt ein hass-Objekt bereit (states, services, callService), wie die HK Web App
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

/** HA liefert [{ domain, services: { serviceId: { … } } }, …] → hass.services[domain] */
function serviceRegistryToHassServices(arr) {
  const services = {};
  if (!Array.isArray(arr)) return services;
  for (const entry of arr) {
    const dom = entry?.domain;
    const svcMap = entry?.services;
    if (typeof dom !== 'string' || !dom || !svcMap || typeof svcMap !== 'object') continue;
    services[dom] = svcMap;
  }
  return services;
}

/** @param {Record<string, unknown>|undefined} nextServices – undefined: vorherige services beibehalten */
function pushHass(app, baseHass, statesMap, nextServices) {
  const prev = app.hass || {};
  app.hass = {
    ...baseHass,
    states: statesMap,
    services: nextServices !== undefined ? nextServices : prev.services || {},
  };
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
    callService,
  };

  const SERVICES_REFRESH_MS = 20_000;
  let lastServicesFetch = 0;

  async function fetchServiceRegistry() {
    const r = await fetch(addonApi('/api/ha/services'));
    const text = await r.text();
    if (!r.ok) {
      console.error('[HK Add-on][hass-bridge] /api/ha/services', r.status, text.slice(0, 200));
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error('[HK Add-on][hass-bridge] services JSON', e, text.slice(0, 200));
      return null;
    }
  }

  async function poll() {
    const now = Date.now();
    const refreshServices = now - lastServicesFetch >= SERVICES_REFRESH_MS;
    if (refreshServices) lastServicesFetch = now;

    try {
      const statesP = fetch(addonApi('/api/ha/states')).then(async (r) => ({
        ok: r.ok,
        status: r.status,
        text: await r.text(),
      }));
      const servicesP = refreshServices ? fetchServiceRegistry() : Promise.resolve(null);

      const [statesRes, servicesArr] = await Promise.all([statesP, servicesP]);

      let newServices;
      if (refreshServices && Array.isArray(servicesArr)) {
        newServices = serviceRegistryToHassServices(servicesArr);
      }

      if (!statesRes.ok) {
        window.__HK_ADDON_HA_LAST_ERROR__ = `HTTP ${statesRes.status}: ${statesRes.text.slice(0, 400)}`;
        window.__HK_ADDON_HA_STATE_COUNT__ = 0;
        console.error('[HK Add-on][hass-bridge]', window.__HK_ADDON_HA_LAST_ERROR__);
        pushHass(app, baseHass, {}, newServices);
        return;
      }
      let arr;
      try {
        arr = JSON.parse(statesRes.text);
      } catch (e) {
        window.__HK_ADDON_HA_LAST_ERROR__ = 'Ungültige JSON-Antwort von /api/ha/states';
        window.__HK_ADDON_HA_STATE_COUNT__ = 0;
        console.error('[HK Add-on][hass-bridge]', e, statesRes.text.slice(0, 200));
        pushHass(app, baseHass, {}, newServices);
        return;
      }
      if (!Array.isArray(arr)) {
        window.__HK_ADDON_HA_LAST_ERROR__ = 'Antwort ist kein State-Array';
        window.__HK_ADDON_HA_STATE_COUNT__ = 0;
        console.error('[HK Add-on][hass-bridge]', window.__HK_ADDON_HA_LAST_ERROR__);
        pushHass(app, baseHass, {}, newServices);
        return;
      }
      window.__HK_ADDON_HA_LAST_ERROR__ = null;
      window.__HK_ADDON_HA_STATE_COUNT__ = arr.length;
      const statesMap = statesArrayToMap(arr);
      pushHass(app, baseHass, statesMap, newServices);
    } catch (e) {
      window.__HK_ADDON_HA_LAST_ERROR__ = String(e?.message || e);
      window.__HK_ADDON_HA_STATE_COUNT__ = 0;
      console.error('[HK Add-on][hass-bridge]', e);
      pushHass(app, baseHass, {});
    }
  }

  pushHass(app, baseHass, {}, {});
  setInterval(poll, 500);
  poll();
}
