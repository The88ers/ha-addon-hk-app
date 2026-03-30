/** Ingress: kein führendes „/“ – sonst trifft fetch die HA-Root-API (/api/…) statt des Add-ons → 404 */
function addonApi(path) {
  const p = path.startsWith('/') ? path.slice(1) : path;
  const base = window.location.pathname.endsWith('/')
    ? window.location.pathname
    : `${window.location.pathname}/`;
  return `${base}${p}`;
}

async function loadHealth() {
  const el = document.getElementById('health');
  try {
    const r = await fetch(addonApi('/api/health'));
    const j = await r.json();
    if (j.ok && j.hasSupervisorToken) {
      el.textContent = 'HA-API bereit';
      el.className = 'badge ok';
    } else {
      el.textContent = 'Token fehlt';
      el.className = 'badge err';
    }
  } catch {
    el.textContent = 'Health fehlgeschlagen';
    el.className = 'badge err';
  }
}

async function loadStates() {
  const pre = document.getElementById('states');
  pre.textContent = 'Lade …';
  try {
    const r = await fetch(addonApi('/api/ha/states'));
    if (!r.ok) {
      const t = await r.text();
      pre.textContent = `HTTP ${r.status}\n${t}`;
      return;
    }
    const data = await r.json();
    const sample = Array.isArray(data) ? data.slice(0, 12) : data;
    pre.textContent = JSON.stringify(sample, null, 2);
    if (Array.isArray(data) && data.length > 12) {
      pre.textContent += `\n\n… ${data.length - 12} weitere Entities`;
    }
  } catch (e) {
    pre.textContent = String(e);
  }
}

document.getElementById('refresh').addEventListener('click', loadStates);

loadHealth();
loadStates();
