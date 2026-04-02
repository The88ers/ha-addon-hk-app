/**
 * Add-on Scheduler:
 * - liest UI-Konfig aus /data/hkweb-settings.json
 * - führt Zeitpläne (modus: 'schedule') zur passenden Minute aus
 * - Tag/Nacht (modus: 'daynight'): tagesaktuelle Sonnenzeiten (PLZ) + Offsets, Zeitzone Europe/Berlin
 * - Sicherheitsschließzeiten (global + Zeiten pro Klappe): Prüfung + optional Nach-Schließen + Notify
 * - Vollzugsprüfung nach geplantem Öffnen/Schließen: Erfolg/Misserfolg per Notify
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import { getSunTimesForPlzDE } from './sun-times.mjs';

const TICK_MS = 10_000;
const SETTINGS_PATH = '/data/hkweb-settings.json';

const HA_API = 'http://supervisor/core/api';
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;

let timer = null;
let lastMinuteKey = null;
let running = false;
let lastBerlinDateKey = null;
/** `${plz}|${yyyy-mm-dd}` → { sunrise: 'HH:mm', sunset: 'HH:mm' } (Europe/Berlin, Kalendertag) */
const sunByPlzDay = new Map();

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getBerlinWallClockParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const pickN = (t) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  return {
    y: pickN('year'),
    mo: pickN('month'),
    da: pickN('day'),
    h: pickN('hour'),
    mi: pickN('minute'),
  };
}

function getBerlinTimeHM(d = new Date()) {
  const { h, mi } = getBerlinWallClockParts(d);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return '00:00';
  return `${pad2(h)}:${pad2(mi)}`;
}

function getBerlinDateKey(d = new Date()) {
  const { y, mo, da } = getBerlinWallClockParts(d);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return '1970-01-01';
  return `${y}-${pad2(mo)}-${pad2(da)}`;
}

function getMinuteKeyBerlin(d = new Date()) {
  const { y, mo, da, h, mi } = getBerlinWallClockParts(d);
  return `${y}-${pad2(mo)}-${pad2(da)} ${pad2(h)}:${pad2(mi)}`;
}

function haHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (SUPERVISOR_TOKEN) h.Authorization = `Bearer ${SUPERVISOR_TOKEN}`;
  return h;
}

async function callHaService(domain, service, serviceData = {}) {
  if (!SUPERVISOR_TOKEN) {
    throw new Error('SUPERVISOR_TOKEN fehlt (homeassistant_api aktivieren)');
  }
  const url = `${HA_API}/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: haHeaders(),
    body: JSON.stringify(serviceData ?? {}),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`[HA service] ${domain}.${service} HTTP ${r.status} ${text.slice(0, 300)}`);
  }
  return r.json().catch(() => ({}));
}

async function fetchAllHaStates() {
  if (!SUPERVISOR_TOKEN) throw new Error('SUPERVISOR_TOKEN fehlt');
  const r = await fetch(`${HA_API}/states`, { headers: haHeaders() });
  const text = await r.text();
  if (!r.ok) throw new Error(`[HA states] HTTP ${r.status} ${text.slice(0, 250)}`);
  const arr = JSON.parse(text);
  const map = {};
  for (const s of Array.isArray(arr) ? arr : []) {
    if (s && s.entity_id) map[s.entity_id] = s;
  }
  return map;
}

async function loadAddonSettingsSnapshot() {
  if (!existsSync(SETTINGS_PATH)) return null;
  const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
  const data = JSON.parse(raw);
  const keys = data?.keys;
  if (!keys || typeof keys !== 'object') return null;
  return keys;
}

function safeJsonParse(raw, fallback) {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normTimeStr(s) {
  if (!s) return '';
  const t = String(s).trim();
  return t.length >= 5 ? t.slice(0, 5) : '';
}

/** HH:mm auch mit einstelligen Stunden (z. B. API-/Intl-Ausgabe) */
function normHHmmFlexible(s) {
  const t = String(s ?? '').trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || mi > 59 || h > 23) return '';
  return `${pad2(h)}:${pad2(mi)}`;
}

function addMinutesToHHMM(hhmm, deltaMin) {
  const n = normHHmmFlexible(hhmm);
  if (!n) return '';
  const [h, m] = n.split(':').map(Number);
  let t = h * 60 + m + (Number(deltaMin) || 0);
  t = ((t % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
}

/** HH:mm → Minuten seit Mitternacht (0–1439); ungültig → NaN */
function timeStrToMinutes(t) {
  const n = normTimeStr(t);
  if (!n || n.length < 5) return NaN;
  const [h, m] = n.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

/** Kurzbeschreibung des Klappenzustands für Notify-Texte */
function formatKlappeZustandText(states, klappe) {
  const parts = [];
  const get = (id) => (id ? states[id]?.state ?? null : null);
  const st = klappe?.statusEntity;
  const zu = klappe?.zustandEntity;
  const eo = klappe?.endstopObenEntity;
  const eu = klappe?.endstopUntenEntity;
  if (st) parts.push(`Status: ${get(st) ?? '—'}`);
  if (zu) parts.push(`Zustand: ${get(zu) ?? '—'}`);
  if (eo) parts.push(`Endschalter oben: ${get(eo) ?? '—'}`);
  if (eu) parts.push(`Endschalter unten: ${get(eu) ?? '—'}`);
  return parts.length ? parts.join('; ') : 'keine Sensoren konfiguriert';
}

function getKlappeName(klappe, kid) {
  return klappe?.name && String(klappe.name).trim() ? String(klappe.name).trim() : kid;
}

/** Mehrere notify.mobile_app_*-Ziele; Legacy: einzelner Key notify_suffix. */
function parseNotifyTargetsFromKeys(keys) {
  const raw = keys['hkweb_sicherheit_schliesszeiten_notify_targets'];
  if (raw != null && String(raw).trim() !== '') {
    const arr = safeJsonParse(String(raw), null);
    if (Array.isArray(arr)) {
      return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
    }
  }
  const legacy = String(keys['hkweb_sicherheit_schliesszeiten_notify_suffix'] || '').trim();
  return legacy ? [legacy] : [];
}

async function callNotifyAll(targets, payload) {
  const list = Array.isArray(targets) ? targets : [];
  for (const t of list) {
    await callHaService('notify', t, payload);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** true = alle konfigurierten Indikatoren melden „geschlossen“ (gleiche Logik wie bisher). */
function isKlappeClosedFromStates(states, klappe) {
  const endstopObenEntity = klappe?.endstopObenEntity || '';
  const endstopUntenEntity = klappe?.endstopUntenEntity || '';
  const statusEntity = klappe?.statusEntity || '';
  const zustandEntity = klappe?.zustandEntity || '';

  const getState = (entityId) => {
    if (!entityId) return null;
    return states[entityId]?.state ?? null;
  };

  const endstopObenState = getState(endstopObenEntity);
  const endstopUntenState = getState(endstopUntenEntity);
  const statusState = getState(statusEntity);
  const zustandState = getState(zustandEntity);

  const expectedClose = 'geschlossen';
  const endstopObenOk = endstopObenEntity ? endstopObenState === 'Inaktiv' : true;
  const endstopUntenOk = endstopUntenEntity ? endstopUntenState === 'Aktiv' : true;
  const statusOk = statusEntity ? String(statusState ?? '').toLowerCase().includes(expectedClose) : true;
  const zustandOk = zustandEntity ? String(zustandState ?? '').toLowerCase().includes(expectedClose) : true;

  return endstopObenOk && endstopUntenOk && statusOk && zustandOk;
}

/** Vollzugsprüfung nach geplantem Öffnen/Schließen (eine Nachricht bei Erfolg oder Misserfolg). */
async function checkScheduleActionOutcome({ klappe, kid, direction, notifyTargets, vollzug }) {
  const states = await fetchAllHaStates();
  const endstopObenEntity = klappe?.endstopObenEntity || '';
  const endstopUntenEntity = klappe?.endstopUntenEntity || '';
  const statusEntity = klappe?.statusEntity || '';
  const zustandEntity = klappe?.zustandEntity || '';

  const getState = (entityId) => {
    if (!entityId) return null;
    const st = states[entityId];
    return st?.state ?? null;
  };

  const endstopObenState = getState(endstopObenEntity);
  const endstopUntenState = getState(endstopUntenEntity);
  const statusState = getState(statusEntity);
  const zustandState = getState(zustandEntity);

  const name = getKlappeName(klappe, kid);
  const zustandTxt = formatKlappeZustandText(states, klappe);

  const statusLower = String(statusState ?? '').toLowerCase();
  const zustandLower = String(zustandState ?? '').toLowerCase();

  const expectedOpen = 'offen';
  const expectedClose = 'geschlossen';

  const notify = async (message) => {
    if (!vollzug || !notifyTargets?.length) return;
    await callNotifyAll(notifyTargets, { title: 'HK Sicherheit', message });
  };

  if (direction === 'open') {
    const endstopObenOk = endstopObenEntity ? endstopObenState === 'Aktiv' : true;
    const endstopUntenOk = endstopUntenEntity ? endstopUntenState === 'Inaktiv' : true;
    const statusOk = statusEntity ? statusLower.includes(expectedOpen) : true;
    const zustandOk = zustandEntity ? zustandLower.includes(expectedOpen) : true;

    const ok = endstopObenOk && endstopUntenOk && statusOk && zustandOk;
    if (ok) {
      await notify(`Klappe ${name} wurde geöffnet.`);
      return { ok: true };
    }
    await notify(`Klappe ${name} konnte nicht geöffnet werden. Zustand der Klappe: "${zustandTxt}"`);
    return { ok: false };
  }

  const endstopObenOk = endstopObenEntity ? endstopObenState === 'Inaktiv' : true;
  const endstopUntenOk = endstopUntenEntity ? endstopUntenState === 'Aktiv' : true;
  const statusOk = statusEntity ? statusLower.includes(expectedClose) : true;
  const zustandOk = zustandEntity ? zustandLower.includes(expectedClose) : true;

  const ok = endstopObenOk && endstopUntenOk && statusOk && zustandOk;
  if (ok) {
    await notify(`Klappe ${name} wurde geschlossen.`);
    return { ok: true };
  }
  await notify(`Klappe ${name} konnte nicht geschlossen werden. Zustand der Klappe: "${zustandTxt}"`);
  return { ok: false };
}

/**
 * Sicherheitsschließzeit: nach Prüfzeit prüfen; bei offen WARNUNG + Nachversuch Schließen; erneut prüfen.
 */
async function checkKlappeClosedAtSafetyTimes({ klappe, kid, notifyTargets, delayS, log }) {
  const name = getKlappeName(klappe, kid);
  const waitMs = Math.max(5, Math.min(600, Number(delayS) || 45)) * 1000;

  const states1 = await fetchAllHaStates();
  if (isKlappeClosedFromStates(states1, klappe)) {
    log?.(`[scheduler] Safety-Close ${kid}: Klappe bereits geschlossen`);
    return { ok: true };
  }

  const zustand1 = formatKlappeZustandText(states1, klappe);
  const btn = String(klappe?.buttonSchliessen || '').trim();
  const canNotify = notifyTargets?.length > 0;

  if (!btn) {
    log?.(`[scheduler] Safety-Close ${kid}: nicht geschlossen, kein buttonSchliessen`);
    if (canNotify) {
      await callNotifyAll(notifyTargets, {
        title: 'HK Sicherheit',
        message: `WARNUNG: Klappe ${name} zur definierten Sicherheitsschließzeit nicht geschlossen. Zustand der Klappe: "${zustand1}". Kein Schließen-Button konfiguriert — kein automatischer Nachversuch möglich.`,
      });
    }
    return { ok: false, reason: 'no_button' };
  }

  if (canNotify) {
    await callNotifyAll(notifyTargets, {
      title: 'HK Sicherheit',
      message: `WARNUNG: Klappe ${name} zur definierten Sicherheitsschließzeit nicht geschlossen. Zustand der Klappe: "${zustand1}". Es wird versucht, die Klappe erneut zu schließen.`,
    });
  }

  try {
    await callHaService('button', 'press', { entity_id: btn });
    log?.(`[scheduler] Safety-Close ${kid}: Schließen einmal angestoßen (${btn})`);
  } catch (e) {
    const err = String(e?.message || e);
    log?.(`[scheduler] Safety-Close ${kid}: button.press fehlgeschlagen: ${err}`);
    if (canNotify) {
      await callNotifyAll(notifyTargets, {
        title: 'HK Sicherheit',
        message: `WARNUNG: Schließen der Klappe ${name} fehlgeschlagen. (${err})`,
      });
    }
    return { ok: false, reason: 'press_failed' };
  }

  await sleep(waitMs);

  const states2 = await fetchAllHaStates();
  const closedNow = isKlappeClosedFromStates(states2, klappe);

  if (closedNow) {
    log?.(`[scheduler] Safety-Close ${kid}: nach erneutem Schließen — jetzt geschlossen`);
    if (canNotify) {
      await callNotifyAll(notifyTargets, {
        title: 'HK Sicherheit',
        message: `Nach Abweichung zur eingestellten Schließzeit konnte die Klappe ${name} geschlossen werden.`,
      });
    }
    return { ok: true, recovered: true };
  }

  log?.(`[scheduler] Safety-Close ${kid}: nach erneutem Schließen — weiterhin nicht geschlossen`);
  if (canNotify) {
    await callNotifyAll(notifyTargets, {
      title: 'HK Sicherheit',
      message: `WARNUNG: Schließen der Klappe ${name} fehlgeschlagen.`,
    });
  }
  return { ok: false, reason: 'still_open' };
}

async function tick(log) {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const minuteKey = getMinuteKeyBerlin(now);
    if (minuteKey === lastMinuteKey) return;
    lastMinuteKey = minuteKey;

    const keys = await loadAddonSettingsSnapshot();
    if (!keys) {
      log('[scheduler] kein /data/hkweb-settings.json vorhanden (noch keine UI-Persistenz?)');
      return;
    }

    const klappenConfig = safeJsonParse(keys['hkweb_klappen_config'], []);
    const klappenModi = safeJsonParse(keys['hkweb_klappen_modi'], {});

    const warnEnabled = keys['hkweb_sicherheit_schliesszeiten_warn_enabled'] === 'true';
    const safetyCloseGlobal = keys['hkweb_sicherheit_safety_close_global'] !== 'false';
    const notifyTargets = parseNotifyTargetsFromKeys(keys);
    const delaySRaw = Number(keys['hkweb_sicherheit_schliesszeiten_delay_s']);
    const delayS = Number.isFinite(delaySRaw) ? Math.max(5, Math.min(600, delaySRaw)) : 45;

    const berlinDateKey = getBerlinDateKey(now);
    if (berlinDateKey !== lastBerlinDateKey) {
      sunByPlzDay.clear();
      lastBerlinDateKey = berlinDateKey;
    }

    const timeStr = getBerlinTimeHM(now);
    const klappeList = Array.isArray(klappenConfig) ? klappenConfig : [];

    const daynightPlzSet = new Set();
    for (const klappe of klappeList) {
      const kid0 = String(klappe.id || '').trim();
      if (!kid0) continue;
      const mode0 = klappenModi?.[kid0];
      if (mode0?.modus === 'daynight') {
        const plz0 = String(mode0?.daynight?.plz || '').trim();
        if (plz0.length >= 5) daynightPlzSet.add(plz0);
      }
    }

    const sunByPlz = {};
    let didSunNetwork = false;
    for (const plz of daynightPlzSet) {
      const cacheKey = `${plz}|${berlinDateKey}`;
      if (sunByPlzDay.has(cacheKey)) {
        sunByPlz[plz] = sunByPlzDay.get(cacheKey);
        continue;
      }
      if (didSunNetwork) await sleep(1100);
      didSunNetwork = true;
      try {
        const r = await getSunTimesForPlzDE(plz);
        const entry = {
          sunrise: normHHmmFlexible(r.sunrise),
          sunset: normHHmmFlexible(r.sunset),
        };
        sunByPlzDay.set(cacheKey, entry);
        sunByPlz[plz] = entry;
      } catch (e) {
        log(`[scheduler] Sonnenzeiten PLZ ${plz}: ${String(e?.message || e)}`);
        sunByPlz[plz] = null;
      }
    }

    const actions = [];
    const safetyCloseChecks = [];
    for (const klappe of klappeList) {
      const kid = String(klappe.id || '').trim();
      if (!kid) continue;
      const mode = klappenModi?.[kid];
      const modus = mode?.modus;
      const schedule = mode?.schedule || {};

      // 1) Timeplan-Ausführung nur wenn Modus "schedule"
      if (modus === 'schedule') {
        const openTimes = Array.isArray(schedule.oeffnenZeiten) ? schedule.oeffnenZeiten.map(normTimeStr) : [];
        const closeTimes = Array.isArray(schedule.schliessenZeiten) ? schedule.schliessenZeiten.map(normTimeStr) : [];

        if (openTimes.includes(timeStr) && klappe.buttonOeffnen) {
          actions.push({ kid, klappe, direction: 'open', vollzug: warnEnabled });
        }
        if (closeTimes.includes(timeStr) && klappe.buttonSchliessen) {
          actions.push({ kid, klappe, direction: 'close', vollzug: warnEnabled });
        }
      }

      // 1b) Tag/Nacht: Sonnenzeiten des Kalendertags (Europe/Berlin) + Offsets
      if (modus === 'daynight') {
        const plz = String(mode?.daynight?.plz || '').trim();
        const st = sunByPlz[plz];
        if (st?.sunrise && st?.sunset) {
          const offO = Number(mode?.daynight?.offsetOeffnen) || 0;
          const offS = Number(mode?.daynight?.offsetSchliessen) || 0;
          const oeffnen = addMinutesToHHMM(st.sunrise, offO);
          const schliessen = addMinutesToHHMM(st.sunset, offS);
          const tNorm = normHHmmFlexible(timeStr);
          if (normHHmmFlexible(oeffnen) === tNorm && klappe.buttonOeffnen) {
            actions.push({ kid, klappe, direction: 'open', vollzug: warnEnabled });
          }
          if (normHHmmFlexible(schliessen) === tNorm && klappe.buttonSchliessen) {
            actions.push({ kid, klappe, direction: 'close', vollzug: warnEnabled });
          }
        }
      }

      // 2) Sicherheitsschließzeiten: global schaltbar; Zeiten pro Klappe (Reiter Sicherheit)
      const safeTimesRaw = mode?.sicherheit?.schliessenZeiten;
      const safeTimes = Array.isArray(safeTimesRaw) ? safeTimesRaw.map(normTimeStr) : [];
      if (safetyCloseGlobal && safeTimes.length && safeTimes.includes(timeStr)) {
        safetyCloseChecks.push({ kid, klappe });
      }
    }

    if (!actions.length && !safetyCloseChecks.length) return;

    log(
      `[scheduler] ${timeStr} Aktionen: ${actions.length ? actions.map((a) => `${a.klappe.id}:${a.direction}`).join(', ') : '—'}`,
    );
    if (safetyCloseChecks.length) {
      log(`[scheduler] ${timeStr} Safety-CloseChecks: ${safetyCloseChecks.map((a) => a.klappe.id).join(', ')}`);
    }

    if (safetyCloseChecks.length) {
      for (const { kid, klappe } of safetyCloseChecks) {
        setTimeout(() => {
          checkKlappeClosedAtSafetyTimes({ klappe, kid, notifyTargets, delayS, log }).catch((e) => {
            log(`[scheduler] Safety-CloseCheck Fehler (${kid}): ${String(e?.message || e)}`);
          });
        }, delayS * 1000);
      }
    }

    // Button-Presses parallel ausführen (ohne auf Checks zu warten).
    await Promise.all(
      actions.map(async ({ kid, klappe, direction, vollzug }) => {
        const buttonEntity = direction === 'open' ? klappe.buttonOeffnen : klappe.buttonSchliessen;
        if (!buttonEntity) return;
        const name = getKlappeName(klappe, kid);
        try {
          await callHaService('button', 'press', { entity_id: buttonEntity });
        } catch (e) {
          log(`[scheduler] button.press fehlgeschlagen (${kid} ${direction}): ${String(e?.message || e)}`);
          if (notifyTargets.length && vollzug) {
            let statesSnap = {};
            try {
              statesSnap = await fetchAllHaStates();
            } catch (_) {
              /* ignore */
            }
            const zt = formatKlappeZustandText(statesSnap, klappe);
            const open = direction === 'open';
            await callNotifyAll(notifyTargets, {
              title: 'HK Sicherheit',
              message: open
                ? `Klappe ${name} konnte nicht geöffnet werden. Zustand der Klappe: "${zt}"`
                : `Klappe ${name} konnte nicht geschlossen werden. Zustand der Klappe: "${zt}"`,
            });
          }
          return;
        }

        if (vollzug) {
          setTimeout(() => {
            checkScheduleActionOutcome({
              klappe,
              kid,
              direction,
              notifyTargets,
              vollzug: true,
            }).catch((err) => {
              log(`[scheduler] Vollzugsprüfung Fehler (${kid} ${direction}): ${String(err?.message || err)}`);
            });
          }, delayS * 1000);
        }
      }),
    );
  } catch (e) {
    console.error('[scheduler]', e);
    log(`[scheduler] tick-Fehler: ${String(e?.message || e)}`);
  } finally {
    running = false;
  }
}

export function startScheduler(log = console.log) {
  if (timer) return;
  log('[scheduler] gestartet (Zeitpläne, Tag/Nacht, Security-Checks)');
  // Sofort ein Tick, damit beim Add-on-Start nicht bis zum nächsten Intervall gewartet wird.
  void tick(log);
  timer = setInterval(() => {
    void tick(log);
  }, TICK_MS);
}

export function stopScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
