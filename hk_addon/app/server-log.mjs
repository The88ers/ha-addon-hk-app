/**
 * Ringpuffer für Add-on-Server-Logzeilen (für UI /api/addon/logs).
 */

const MAX_LINES = 2500;
const lines = [];

function push(level, parts) {
  const msg = parts
    .map((p) => {
      if (p instanceof Error) return p.stack || p.message;
      if (typeof p === 'object') {
        try {
          return JSON.stringify(p);
        } catch {
          return String(p);
        }
      }
      return String(p);
    })
    .join(' ');
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  lines.push(line);
  while (lines.length > MAX_LINES) lines.shift();
}

export function getAddonLogLines(limit = 500) {
  const n = Math.min(Math.max(1, limit), MAX_LINES);
  return lines.slice(-n);
}

export function initServerLogCapture() {
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log = (...a) => {
    push('log', a);
    orig.log(...a);
  };
  console.info = (...a) => {
    push('info', a);
    orig.info(...a);
  };
  console.warn = (...a) => {
    push('warn', a);
    orig.warn(...a);
  };
  console.error = (...a) => {
    push('error', a);
    orig.error(...a);
  };
  push('info', ['HK Addon: Server-Log-Puffer aktiv']);
}
