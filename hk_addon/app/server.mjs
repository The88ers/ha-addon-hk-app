import express from 'express';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startScheduler } from './scheduler.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.INGRESS_PORT || 8099);
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;
const HA_API = 'http://supervisor/core/api';

const app = express();
app.use(express.json({ limit: '1mb' }));

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

/** Proxy: GET /api/ha/states → HA REST */
app.get('/api/ha/states', async (_req, res) => {
  if (!SUPERVISOR_TOKEN) {
    res.status(503).json({ error: 'SUPERVISOR_TOKEN fehlt (homeassistant_api aktivieren)' });
    return;
  }
  try {
    const r = await fetch(`${HA_API}/states`, { headers: haHeaders() });
    const text = await r.text();
    res.status(r.status).type('application/json').send(text);
  } catch (e) {
    console.error('[api/ha/states]', e);
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
    res.status(r.status).type('application/json').send(text);
  } catch (e) {
    console.error('[api/ha/services]', e);
    res.status(502).json({ error: String(e.message || e) });
  }
});

const server = http.createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HK Addon listening on ${PORT}`);
  startScheduler(console.log);
});
