/**
 * Gemeinsame Logik für Vollzugsprüfung (Browser-UI + Node-Scheduler).
 * Endschalter: ESPHome-Text „Aktiv“/„Inaktiv“ sowie binary_sensor on/off.
 */

/**
 * @param {unknown} raw HA-Entity-State (Rohstring)
 * @returns {boolean|null} true = Endschalter betätigt/ausgelöst, false = nicht betätigt, null = unbekannt/nicht auswertbar
 */
export function parseEndstopTriggered(raw) {
  if (raw == null) return null;
  const s0 = String(raw).trim();
  if (s0 === '' || s0 === 'unavailable' || s0 === 'unknown') return null;
  const s = s0.toLowerCase();
  if (/\b(störung|storung|fault|error)\b/i.test(s0)) return null;
  if (s === 'off' || s === 'false' || s === '0' || s === 'inaktiv' || s === 'no' || s === 'aus') return false;
  if (s === 'on' || s === 'true' || s === '1' || s === 'aktiv' || s === 'yes' || s === 'an') return true;
  if (s.includes('inaktiv')) return false;
  if (s.includes('aktiv')) return true;
  return null;
}

/** @param {string} [entityId] */
export function vollzugOpenEndstopsOk(getState, endstopObenEntity, endstopUntenEntity) {
  const oben = endstopObenEntity ? parseEndstopTriggered(getState(endstopObenEntity)) : null;
  const unten = endstopUntenEntity ? parseEndstopTriggered(getState(endstopUntenEntity)) : null;
  const obenOk = !endstopObenEntity || oben === true;
  const untenOk = !endstopUntenEntity || unten === false;
  return obenOk && untenOk;
}

export function vollzugCloseEndstopsOk(getState, endstopObenEntity, endstopUntenEntity) {
  const oben = endstopObenEntity ? parseEndstopTriggered(getState(endstopObenEntity)) : null;
  const unten = endstopUntenEntity ? parseEndstopTriggered(getState(endstopUntenEntity)) : null;
  const obenOk = !endstopObenEntity || oben === false;
  const untenOk = !endstopUntenEntity || unten === true;
  return obenOk && untenOk;
}

export function textIndicatesStoerung(text) {
  if (text == null || text === '') return false;
  const s = String(text).toLowerCase();
  return s.includes('störung') || s.includes('storung');
}
