/**
 * Persistenz der UI-Einstellungen im Add-on (/data) + Abruf des Add-on-Server-Logs.
 */
import { addonApi } from './hass-addon-bridge.mjs';

/** GET: Snapshot wie buildSettingsSnapshot() oder null wenn nicht vorhanden */
export async function loadSettingsFromAddonServer() {
  const r = await fetch(addonApi('/api/addon/settings'), { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GET /api/addon/settings: ${r.status} ${t.slice(0, 200)}`);
  }
  return r.json();
}

/** POST: vollständiger Snapshot { v, savedAt, keys } */
export async function saveSettingsToAddonServer(snapshot) {
  const r = await fetch(addonApi('/api/addon/settings'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`POST /api/addon/settings: ${r.status} ${t.slice(0, 300)}`);
  }
  return r.json().catch(() => ({}));
}

export async function fetchAddonLogs(limit = 500) {
  const r = await fetch(addonApi(`/api/addon/logs?limit=${encodeURIComponent(limit)}`), {
    cache: 'no-store',
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GET /api/addon/logs: ${r.status} ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return Array.isArray(j.lines) ? j.lines : [];
}

/** Sonnenzeiten über Add-on-Server (Nominatim + sunrise-sunset.org, ohne Browser-CORS). */
export async function fetchSunTimesForPlz(plz) {
  const q = new URLSearchParams({ plz: String(plz).trim() });
  const r = await fetch(addonApi(`/api/addon/sun-times?${q}`), { cache: 'no-store' });
  let data = {};
  try {
    data = await r.json();
  } catch {
    /* ignore */
  }
  if (!r.ok) {
    throw new Error(data.error || `HTTP ${r.status}`);
  }
  if (!data.ok || !data.sunrise || !data.sunset) {
    throw new Error(data.error || 'Ungültige Sonnenzeiten-Antwort');
  }
  return { sunrise: data.sunrise, sunset: data.sunset };
}
