/**
 * Sonnenauf-/untergang für eine deutsche PLZ (Nominatim + sunrise-sunset.org).
 * Genutzt von server.mjs (REST) und scheduler.mjs (Tag/Nacht, täglich neu).
 */

export const SUN_FETCH_UA =
  'HK-Addon/0.2.18 (Home Assistant add-on; https://github.com/The88ers/ha-addon-hk-app)';

const geoCache = new Map();

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** HH:mm in lokaler Zone — bei TZ=Europe/Berlin = deutsche Uhrzeit, ohne Intl. */
function formatLocalHm(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseUtcIso(iso) {
  const s = String(iso || '');
  if (!s) return null;
  const d = new Date(/Z|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {string} plz
 * @returns {Promise<{ sunrise: string, sunset: string, plz: string, lat: number, lon: number }>}
 */
export async function getSunTimesForPlzDE(plz) {
  const p = String(plz || '').trim();
  if (p.length < 5) {
    throw new Error('PLZ fehlt oder zu kurz');
  }

  let latlon = geoCache.get(p);
  if (!latlon) {
    const geoUrl = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(p)}&countrycodes=de&format=json&limit=1`;
    const geoR = await fetch(geoUrl, {
      headers: {
        'User-Agent': SUN_FETCH_UA,
        Accept: 'application/json',
        'Accept-Language': 'de',
      },
    });
    if (!geoR.ok) {
      const t = await geoR.text();
      throw new Error(`Geocoding HTTP ${geoR.status} ${t.slice(0, 120)}`);
    }
    const geoData = await geoR.json();
    if (!Array.isArray(geoData) || geoData.length === 0) {
      throw new Error('PLZ nicht gefunden');
    }
    const lat = parseFloat(geoData[0].lat);
    const lon = parseFloat(geoData[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error('Ungültige Koordinaten');
    }
    latlon = { lat, lon };
    geoCache.set(p, latlon);
  }

  const sunUrl = `https://api.sunrise-sunset.org/json?lat=${latlon.lat}&lng=${latlon.lon}&formatted=0`;
  const sunR = await fetch(sunUrl, { headers: { Accept: 'application/json' } });
  if (!sunR.ok) {
    const t = await sunR.text();
    throw new Error(`Sonnenzeiten-API HTTP ${sunR.status} ${t.slice(0, 120)}`);
  }
  const sunData = await sunR.json();
  if (sunData.status !== 'OK' || !sunData.results) {
    throw new Error('Sonnenzeiten-API: kein OK');
  }

  const sunriseUTC = parseUtcIso(sunData.results.sunrise);
  const sunsetUTC = parseUtcIso(sunData.results.sunset);
  if (!sunriseUTC || !sunsetUTC) {
    throw new Error('Sonnenzeiten konnten nicht geparst werden');
  }

  return {
    plz: p,
    lat: latlon.lat,
    lon: latlon.lon,
    sunrise: formatLocalHm(sunriseUTC),
    sunset: formatLocalHm(sunsetUTC),
  };
}
