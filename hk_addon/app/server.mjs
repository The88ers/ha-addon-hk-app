import express from 'express';
import http from 'http';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startScheduler } from './scheduler.mjs';
import { initServerLogCapture, getAddonLogLines } from './server-log.mjs';
import { getSunTimesForPlzDE } from './sun-times.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

initServerLogCapture();

/** Persistente UI-Einstellungen (Supervisor-Mount) */
const SETTINGS_PATH = '/data/hkweb-settings.json';

// Ingress: auf HA/Docker oft IPv6 – nur 0.0.0.0 binden blockiert ::-Verbindungen → 502 Bad Gateway
const rawPort = process.env.INGRESS_PORT;
const PORT =
  rawPort != null && rawPort !== '' && Number(rawPort) > 0
    ? Number(rawPort)
    : 8099;
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;
const HA_API = 'http://supervisor/core/api';

const app = express();
app.use(express.json({ limit: '2mb' }));

const www = join(__dirname, 'www');
app.use(express.static(www));

function haHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (SUPERVISOR_TOKEN) {
    h.Authorization = `Bearer ${SUPERVISOR_TOKEN}`;
  }
  return h;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasSupervisorToken: Boolean(SUPERVISOR_TOKEN),
  });
});

/** Gespeicherte Klappen-/UI-Einstellungen (Browser-Snapshot) */
app.get('/api/addon/settings', async (_req, res) => {
  try {
    if (!existsSync(SETTINGS_PATH)) {
      res.status(404).json({ error: 'Keine gespeicherten Einstellungen' });
      return;
    }
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (e) {
    console.error('[api/addon/settings GET]', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/addon/settings', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || !body.keys || typeof body.keys !== 'object') {
      res.status(400).json({ error: 'Ungültiger Body (erwartet: { v, keys, … })' });
      return;
    }
    await fs.mkdir('/data', { recursive: true });
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(body, null, 2), 'utf8');
    console.log('[api/addon/settings] gespeichert:', SETTINGS_PATH, Object.keys(body.keys || {}).length, 'Keys');
    res.json({ ok: true, savedAt: body.savedAt || new Date().toISOString() });
  } catch (e) {
    console.error('[api/addon/settings POST]', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** Server-Log (Ringpuffer) für Support */
app.get('/api/addon/logs', (req, res) => {
  try {
    const lim = Math.min(2000, Math.max(1, Number(req.query.limit) || 500));
    res.json({ lines: getAddonLogLines(lim) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/**
 * Sonnenauf-/untergang für eine deutsche PLZ (Server-Proxy: kein CORS, Nominatim-konformer User-Agent).
 * GET /api/addon/sun-times?plz=12345
 */
app.get('/api/addon/sun-times', async (req, res) => {
  const plz = String(req.query.plz || req.query.postalcode || '').trim();
  if (plz.length < 5) {
    res.status(400).json({ ok: false, error: 'PLZ fehlt oder zu kurz (mindestens 5 Zeichen)' });
    return;
  }
  try {
    const r = await getSunTimesForPlzDE(plz);
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('[api/addon/sun-times]', e);
    const msg = String(e?.message || e);
    const status = msg.includes('PLZ nicht gefunden') ? 404 : 502;
    res.status(status).json({ ok: false, error: msg });
  }
});

/** Proxy: GET /api/ha/states → HA REST */
app.get('/api/ha/states', async (_req, res) => {
  if (!SUPERVISOR_TOKEN) {
    res.status(503).json({ error: 'SUPERVISOR_TOKEN fehlt (homeassistant_api aktivieren)' });
    return;
  }
  try {
    const r = await fetch(`${HA_API}/states`, { headers: haHeaders() });
    const text = await r.text();
    if (!r.ok) {
      console.error('[api/ha/states] Supervisor:', r.status, text.slice(0, 500));
    }
    res.status(r.status).type('application/json').send(text);
  } catch (e) {
    console.error('[api/ha/states]', e);
    res.status(502).json({ error: String(e.message || e) });
  }
});

/** Proxy: GET /api/ha/services → HA REST (Service-Registry, u. a. notify.mobile_app_*) */
app.get('/api/ha/services', async (_req, res) => {
  if (!SUPERVISOR_TOKEN) {
    res.status(503).json({ error: 'SUPERVISOR_TOKEN fehlt' });
    return;
  }
  try {
    const r = await fetch(`${HA_API}/services`, { headers: haHeaders() });
    const text = await r.text();
    if (!r.ok) {
      console.error('[api/ha/services GET] Supervisor:', r.status, text.slice(0, 500));
    }
    res.status(r.status).type('application/json').send(text);
  } catch (e) {
    console.error('[api/ha/services GET]', e);
    res.status(502).json({ error: String(e.message || e) });
  }
});

/**
 * Proxy: POST /api/ha/services/:domain/:service
 * Body: JSON (z. B. { entity_id: "button.x" } für button.press)
 */
app.post('/api/ha/services/:domain/:service', async (req, res) => {
  if (!SUPERVISOR_TOKEN) {
    res.status(503).json({ error: 'SUPERVISOR_TOKEN fehlt' });
    return;
  }
  const { domain, service } = req.params;
  try {
    const r = await fetch(`${HA_API}/services/${domain}/${service}`, {
      method: 'POST',
      headers: haHeaders(),
      body: JSON.stringify(req.body ?? {}),
    });
    const text = await r.text();
    if (!r.ok) {
      console.error(`[api/ha/services] ${domain}.${service}`, r.status, text.slice(0, 400));
    }
    res.status(r.status).type('application/json').send(text);
  } catch (e) {
    console.error('[api/ha/services]', e);
    res.status(502).json({ error: String(e.message || e) });
  }
});

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`HK Addon listening on ${PORT} (all interfaces, IPv4/IPv6 per Node defaults)`);
  startScheduler(console.log);
});
