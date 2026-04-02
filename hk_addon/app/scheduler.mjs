/**
 * Add-on Scheduler:
 * - liest UI-Konfig aus /data/hkweb-settings.json
 * - führt Zeitpläne (modus: 'schedule') zur passenden Minute aus
 * - optional: "Schließzeiten" Security-Check + iOS/Companion Notification bei Fehlschlag
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';

const TICK_MS = 10_000;
const SETTINGS_PATH = '/data/hkweb-settings.json';

const HA_API = 'http://supervisor/core/api';
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;

let timer = null;
let lastMinuteKey = null;
let running = false;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getLocalTimeHM(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function getMinuteKeyLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
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

async function checkScheduleActionOutcome({
  klappe,
  kid,
  direction,
  notifyTargets,
  variant = 'first', // 'first' | 'second'
}) {
  // direction: 'open' | 'close'
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

  const statusLower = String(statusState ?? '').toLowerCase();
  const zustandLower = String(zustandState ?? '').toLowerCase();

  const expectedOpen = 'offen';
  const expectedClose = 'geschlossen';

  const notify = async (message) => {
    if (!notifyTargets?.length) return { notified: false };
    await callNotifyAll(notifyTargets, { title: 'HK Sicherheit', message });
    return { notified: true };
  };

  if (direction === 'open') {
    const endstopObenOk = endstopObenEntity ? endstopObenState === 'Aktiv' : true;
    const endstopUntenOk = endstopUntenEntity ? endstopUntenState === 'Inaktiv' : true;
    const statusOk = statusEntity ? statusLower.includes(expectedOpen) : true;
    const zustandOk = zustandEntity ? zustandLower.includes(expectedOpen) : true;

    const ok = endstopObenOk && endstopUntenOk && statusOk && zustandOk;
    if (ok) return { ok: true };

    if (variant === 'first') {
      await notify(`Öffnen der Klappe ${name} fehlgeschlagen`);
    } else {
      await notify(`Sicherheitsschließzeiten: Öffnen der Klappe ${name} fehlgeschlagen`);
    }
    return { ok: false };
  }

  // close
  const endstopObenOk = endstopObenEntity ? endstopObenState === 'Inaktiv' : true;
  const endstopUntenOk = endstopUntenEntity ? endstopUntenState === 'Aktiv' : true;
  const statusOk = statusEntity ? statusLower.includes(expectedClose) : true;
  const zustandOk = zustandEntity ? zustandLower.includes(expectedClose) : true;

  const ok = endstopObenOk && endstopUntenOk && statusOk && zustandOk;
  if (ok) return { ok: true };

  if (variant === 'first') {
    await notify(`Schließen der Klappe ${name} fehlgeschlagen`);
  } else {
    await notify(`Sicherheitsschließzeiten: Schließen der Klappe ${name} fehlgeschlagen`);
  }
  return { ok: false };
}

/**
 * Sicherheitsschließzeit: prüfen, ggf. einmal Schließen anstoßen, nach Prüfzeit erneut prüfen, benachrichtigen.
 */
async function checkKlappeClosedAtSafetyTimes({ klappe, kid, notifyTargets, delayS, log }) {
  const name = getKlappeName(klappe, kid);
  const waitMs = Math.max(5, Math.min(600, Number(delayS) || 45)) * 1000;

  const states1 = await fetchAllHaStates();
  if (isKlappeClosedFromStates(states1, klappe)) {
    log?.(`[scheduler] Safety-Close ${kid}: Klappe bereits geschlossen`);
    return { ok: true };
  }

  const btn = String(klappe?.buttonSchliessen || '').trim();
  const canNotify = notifyTargets?.length > 0;

  if (!btn) {
    log?.(`[scheduler] Safety-Close ${kid}: nicht geschlossen, kein buttonSchliessen`);
    if (canNotify) {
      await callNotifyAll(notifyTargets, {
        title: 'HK Sicherheit',
        message: `Sicherheitsschließzeiten: Klappe ${name} ist nicht geschlossen. Kein Schließen-Button konfiguriert — kein erneuter Versuch möglich.`,
      });
    }
    return { ok: false, reason: 'no_button' };
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
        message: `Sicherheitsschließzeiten: Klappe ${name} ist nicht geschlossen. Schließen konnte nicht ausgelöst werden: ${err}`,
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
        message: `Sicherheitsschließzeiten: Klappe ${name} war nicht geschlossen — Schließen wurde einmal angestoßen. Ergebnis: jetzt geschlossen.`,
      });
    }
    return { ok: true, recovered: true };
  }

  log?.(`[scheduler] Safety-Close ${kid}: nach erneutem Schließen — weiterhin nicht geschlossen`);
  if (canNotify) {
    await callNotifyAll(notifyTargets, {
      title: 'HK Sicherheit',
      message: `Sicherheitsschließzeiten: Klappe ${name} war nicht geschlossen — Schließen wurde einmal angestoßen. Ergebnis: weiterhin nicht geschlossen.`,
    });
  }
  return { ok: false, reason: 'still_open' };
}

async function tick(log) {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const minuteKey = getMinuteKeyLocal(now);
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
    const notifyTargets = parseNotifyTargetsFromKeys(keys);
    const delaySRaw = Number(keys['hkweb_sicherheit_schliesszeiten_delay_s']);
    const delayS = Number.isFinite(delaySRaw) ? Math.max(5, Math.min(600, delaySRaw)) : 45;

    const timeStr = getLocalTimeHM(now);
    const klappeList = Array.isArray(klappenConfig) ? klappenConfig : [];

    const actions = [];
    const safetyCloseChecks = [];
    for (const klappe of klappeList) {
      const kid = String(klappe.id || '').trim();
      if (!kid) continue;
      const mode = klappenModi?.[kid];
      const modus = mode?.modus;
      const schedule = mode?.schedule || {};
      const scheduleSecondEnabled = Boolean(schedule?.sicherheitsschliessen === true);

      // 1) Timeplan-Ausführung nur wenn Modus "schedule"
      if (modus === 'schedule') {
        const openTimes = Array.isArray(schedule.oeffnenZeiten) ? schedule.oeffnenZeiten.map(normTimeStr) : [];
        const closeTimes = Array.isArray(schedule.schliessenZeiten) ? schedule.schliessenZeiten.map(normTimeStr) : [];

        if (openTimes.includes(timeStr) && klappe.buttonOeffnen) {
          actions.push({ kid, klappe, direction: 'open', firstEnabled: warnEnabled, secondEnabled: scheduleSecondEnabled });
        }
        if (closeTimes.includes(timeStr) && klappe.buttonSchliessen) {
          actions.push({ kid, klappe, direction: 'close', firstEnabled: warnEnabled, secondEnabled: scheduleSecondEnabled });
        }
      }

      // 2) Sicherheitsschließzeiten: laufen für JEDE aktuelle Klappen-Modes,
      //    solange in diesem Modus die Checkbox aktiv ist.
      const currentModeEnabled = Boolean(mode?.[modus]?.sicherheitsschliessen === true);
      const safeTimesRaw = mode?.sicherheit?.schliessenZeiten;
      const safeTimes = Array.isArray(safeTimesRaw) ? safeTimesRaw.map(normTimeStr) : [];
      if (currentModeEnabled && safeTimes.includes(timeStr)) {
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
      actions.map(async ({ kid, klappe, direction, firstEnabled, secondEnabled }) => {
        const buttonEntity = direction === 'open' ? klappe.buttonOeffnen : klappe.buttonSchliessen;
        if (!buttonEntity) return;
        const name = getKlappeName(klappe, kid);
        try {
          await callHaService('button', 'press', { entity_id: buttonEntity });
        } catch (e) {
          log(`[scheduler] button.press fehlgeschlagen (${kid} ${direction}): ${String(e?.message || e)}`);
          if (notifyTargets.length && firstEnabled) {
            await callNotifyAll(notifyTargets, {
              title: 'HK Sicherheit',
              message: `${direction === 'open' ? 'Öffnen' : 'Schließen'} der Klappe ${name} fehlgeschlagen`,
            });
          }
          if (notifyTargets.length && secondEnabled) {
            await callNotifyAll(notifyTargets, {
              title: 'HK Sicherheit',
              message: `Sicherheitsschließzeiten: ${direction === 'open' ? 'Öffnen' : 'Schließen'} der Klappe ${name} fehlgeschlagen`,
            });
          }
          return;
        }

        const scheduleChecks = [];
        if (firstEnabled) {
          scheduleChecks.push(() =>
            checkScheduleActionOutcome({
              klappe,
              kid,
              direction,
              notifyTargets,
              variant: 'first',
            }),
          );
        }
        if (secondEnabled) {
          scheduleChecks.push(() =>
            checkScheduleActionOutcome({
              klappe,
              kid,
              direction,
              notifyTargets,
              variant: 'second',
            }),
          );
        }
        if (scheduleChecks.length) {
          setTimeout(() => {
            scheduleChecks.forEach((fn) => {
              fn().catch((e) => {
                log(`[scheduler] Security-Check Fehler (${kid} ${direction}): ${String(e?.message || e)}`);
              });
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
  log('[scheduler] gestartet (Zeitpläne + Security-Checks)');
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
