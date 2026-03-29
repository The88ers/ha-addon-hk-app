/**
 * Minütlicher Takt für Zeitpläne / Tag-Nacht (Konfiguration später aus /data oder geteilt mit UI).
 * v0.1: nur Log-Hook; Ausführung (callService) folgt mit gespeicherten Modi.
 */

const TICK_MS = 60_000;

let timer = null;

export function startScheduler(log = console.log) {
  if (timer) return;
  log('[scheduler] gestartet (Intervall 60 s)');
  timer = setInterval(() => {
    try {
      log('[scheduler] tick');
    } catch (e) {
      console.error('[scheduler]', e);
    }
  }, TICK_MS);
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
