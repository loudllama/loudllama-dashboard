'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 8099;

// --- Data directory -------------------------------------------------------
// In production the Supervisor mounts a persistent /data volume for the
// add-on. When running the backend standalone (e.g. local development /
// smoke tests outside Home Assistant) we fall back to a local ./data folder
// so the server still boots and behaves sensibly.
const DATA_DIR = process.env.DATA_DIR && fs.existsSync(path.dirname(process.env.DATA_DIR))
  ? process.env.DATA_DIR
  : (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
const WWW_DIR = path.join(DATA_DIR, 'www');
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

for (const dir of [DATA_DIR, WWW_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// --- Home Assistant connection --------------------------------------------
// When the add-on has `homeassistant_api: true` / `hassio_api: true` set in
// config.yaml, the Supervisor injects SUPERVISOR_TOKEN automatically and the
// Core REST API is reachable at http://supervisor/core/api.
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN || null;
const HA_API_BASE = 'http://supervisor/core/api';
const MOCK_MODE = !SUPERVISOR_TOKEN;

if (MOCK_MODE) {
  console.warn('[loudllama] No SUPERVISOR_TOKEN found - running in local MOCK mode ' +
    '(fake HA config + fake weather.demo entity). This is expected outside Home Assistant.');
}

async function haFetch(pathname) {
  if (MOCK_MODE) {
    return mockHaResponse(pathname);
  }
  const res = await fetch(`${HA_API_BASE}${pathname}`, {
    headers: {
      Authorization: `Bearer ${SUPERVISOR_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HA API ${pathname} -> ${res.status}: ${body}`);
  }
  return res.json();
}

// Minimal mock so the whole stack (frontend <-> backend <-> "HA") can be
// smoke-tested without a real Home Assistant instance.
function mockHaResponse(pathname) {
  if (pathname === '/config') {
    return {
      language: 'da',
      unit_system: { temperature: '°C', length: 'km', mass: 'kg' },
      location_name: 'Home (mock)',
    };
  }
  if (pathname === '/states') {
    return [mockWeatherEntity(), mockLightEntity(), ...mockCameraEntities()];
  }
  if (pathname.startsWith('/states/')) {
    const entityId = decodeURIComponent(pathname.split('/states/')[1]);
    if (entityId === 'weather.demo') return mockWeatherEntity();
    if (entityId === 'light.demo') return mockLightEntity();
    const camera = mockCameraEntities().find((c) => c.entity_id === entityId);
    if (camera) return camera;
    return { entity_id: entityId, state: 'unknown', attributes: {} };
  }
  throw new Error(`No mock handler for ${pathname}`);
}

function mockCameraEntities() {
  return [
    { entity_id: 'camera.front_door', state: 'streaming', attributes: { friendly_name: 'Front Door' } },
    { entity_id: 'camera.backyard', state: 'streaming', attributes: { friendly_name: 'Backyard' } },
    { entity_id: 'camera.driveway', state: 'streaming', attributes: { friendly_name: 'Driveway' } },
  ];
}

function mockWeatherEntity() {
  return {
    entity_id: 'weather.demo',
    state: 'partlycloudy',
    attributes: {
      friendly_name: 'Demo Weather',
      temperature: 14.2,
      temperature_unit: '°C',
      humidity: 71,
      wind_speed: 18,
      wind_speed_unit: 'km/h',
      pressure: 1012,
      pressure_unit: 'hPa',
      forecast: [
        { datetime: new Date(Date.now() + 3 * 3600e3).toISOString(), condition: 'cloudy', temperature: 13 },
        { datetime: new Date(Date.now() + 6 * 3600e3).toISOString(), condition: 'rainy', temperature: 11 },
        { datetime: new Date(Date.now() + 24 * 3600e3).toISOString(), condition: 'sunny', temperature: 16 },
      ],
    },
    last_updated: new Date().toISOString(),
  };
}

function mockLightEntity() {
  return {
    entity_id: 'light.demo',
    state: 'on',
    attributes: { friendly_name: 'Demo Light' },
  };
}

// --- Widget registry (server-side manifest) --------------------------------
// Describes widgets bundled with the add-on so the frontend can list them in
// the "add widget" picker. Rendering itself happens client-side.
const WIDGETS = [
  {
    id: 'weather',
    version: '1.0.0',
    icon: 'weather-partly-cloudy',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    name: {
      da: 'Vejr',
      en: 'Weather',
      de: 'Wetter',
      sv: 'Väder',
      no: 'Vær',
    },
    description: {
      da: 'Viser aktuelt vejr fra en HA vejr-entitet, med baggrund der matcher vejret.',
      en: 'Shows current weather from a HA weather entity, with a background that matches the weather.',
    },
  },
  {
    id: 'frigate',
    version: '1.0.0',
    icon: 'cctv',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
    name: {
      da: 'Kameraer (Frigate)',
      en: 'Cameras (Frigate)',
      de: 'Kameras (Frigate)',
      sv: 'Kameror (Frigate)',
      no: 'Kameraer (Frigate)',
    },
    description: {
      da: 'Mini-grid med kamera-thumbnails fra Frigate/Home Assistant. Klik på et kamera for at åbne det i fuldskærm.',
      en: 'Mini-grid of Frigate/Home Assistant camera thumbnails. Click a camera to open it fullscreen.',
    },
  },
];

// --- App --------------------------------------------------------------------
const app = express();
app.use(express.json());

// Serve uploaded backgrounds etc.
app.use('/media', express.static(WWW_DIR));

// Frontend static assets (all referenced with *relative* paths in the HTML so
// this works correctly both standalone and behind Home Assistant Ingress,
// which mounts the add-on under a dynamic, per-session path prefix).
//
// In the Docker image, the Dockerfile copies frontend/ to /app/public
// (sibling of this file). When running the backend straight from the repo
// (local development / smoke tests) there is no "public" copy - fall back
// to the real ../frontend folder so `node server.js` works either way.
const FRONTEND_DIR = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

// Convenience: GridStack's UMD bundle, served from node_modules so the
// container works fully offline at runtime (no CDN dependency).
app.use('/vendor/gridstack', express.static(path.join(__dirname, 'node_modules', 'gridstack', 'dist')));

// --- Layout persistence ------------------------------------------------------
const DEFAULT_LAYOUT = {
  widgets: [
    { id: 'weather-1', type: 'weather', x: 0, y: 0, w: 4, h: 4, config: { entity_id: '' } },
  ],
};

app.get('/api/layout', (req, res) => {
  try {
    if (fs.existsSync(LAYOUT_FILE)) {
      return res.json(JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')));
    }
    return res.json(DEFAULT_LAYOUT);
  } catch (err) {
    console.error('[loudllama] Failed to read layout:', err);
    res.status(500).json({ error: 'layout_read_failed' });
  }
});

app.post('/api/layout', (req, res) => {
  try {
    fs.writeFileSync(LAYOUT_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    console.error('[loudllama] Failed to save layout:', err);
    res.status(500).json({ error: 'layout_write_failed' });
  }
});

// --- Settings (background image etc.) ---------------------------------------
function readSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch {
      /* fall through to default */
    }
  }
  return { backgroundUrl: null };
}

function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

app.get('/api/settings', (req, res) => {
  res.json(readSettings());
});

const upload = multer({
  storage: multer.diskStorage({
    destination: WWW_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `background${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype));
  },
});

app.post('/api/background', upload.single('background'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_image' });
  const settings = readSettings();
  settings.backgroundUrl = `media/${req.file.filename}?t=${Date.now()}`;
  writeSettings(settings);
  res.json(settings);
});

// --- Widget registry endpoint -------------------------------------------------
app.get('/api/widgets', (req, res) => {
  res.json(WIDGETS);
});

// --- Home Assistant proxy -----------------------------------------------------
app.get('/api/hass/config', async (req, res) => {
  try {
    res.json(await haFetch('/config'));
  } catch (err) {
    console.error('[loudllama] /api/hass/config failed:', err.message);
    res.status(502).json({ error: 'ha_unreachable' });
  }
});

app.get('/api/hass/states', async (req, res) => {
  try {
    const states = await haFetch('/states');
    const { domain } = req.query;
    res.json(domain ? states.filter((s) => s.entity_id.startsWith(`${domain}.`)) : states);
  } catch (err) {
    console.error('[loudllama] /api/hass/states failed:', err.message);
    res.status(502).json({ error: 'ha_unreachable' });
  }
});

app.get('/api/hass/states/:entityId', async (req, res) => {
  try {
    res.json(await haFetch(`/states/${encodeURIComponent(req.params.entityId)}`));
  } catch (err) {
    console.error('[loudllama] /api/hass/states/:entityId failed:', err.message);
    res.status(502).json({ error: 'ha_unreachable' });
  }
});

// --- Camera proxy (Frigate widget) -------------------------------------------
// Frigate cameras show up in Home Assistant as regular `camera.*` entities
// (via the Frigate integration), so - like everything else - we go through
// HA's Core API rather than talking to Frigate directly. That means the
// widget works the same way regardless of how/where Frigate itself is
// installed.
function sendMockImage(res, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">
    <rect width="100%" height="100%" fill="#20262f"/>
    <g fill="none" stroke="#5a6472" stroke-width="6">
      <rect x="150" y="95" width="180" height="110" rx="10"/>
      <circle cx="240" cy="150" r="34"/>
      <rect x="215" y="80" width="50" height="20" rx="4"/>
    </g>
    <text x="240" y="235" fill="#8b93a1" font-family="sans-serif" font-size="16" text-anchor="middle">${label}</text>
  </svg>`;
  res.set('Content-Type', 'image/svg+xml').send(svg);
}

app.get('/api/hass/camera_snapshot/:entityId', async (req, res) => {
  const { entityId } = req.params;
  if (MOCK_MODE) return sendMockImage(res, `${entityId} (mock)`);
  try {
    const upstream = await fetch(`${HA_API_BASE}/camera_proxy/${encodeURIComponent(entityId)}`, {
      headers: { Authorization: `Bearer ${SUPERVISOR_TOKEN}` },
    });
    if (!upstream.ok) return res.status(502).end();
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    upstream.body.pipe(res);
  } catch (err) {
    console.error('[loudllama] camera_snapshot failed:', err.message);
    res.status(502).end();
  }
});

app.get('/api/hass/camera_stream/:entityId', async (req, res) => {
  const { entityId } = req.params;
  if (MOCK_MODE) return sendMockImage(res, `${entityId} (mock live)`);
  try {
    const upstream = await fetch(`${HA_API_BASE}/camera_proxy_stream/${encodeURIComponent(entityId)}`, {
      headers: { Authorization: `Bearer ${SUPERVISOR_TOKEN}` },
    });
    if (!upstream.ok) return res.status(502).end();
    res.set('Content-Type', upstream.headers.get('content-type') || 'multipart/x-mixed-replace');
    upstream.body.pipe(res);
    req.on('close', () => upstream.body.destroy());
  } catch (err) {
    console.error('[loudllama] camera_stream failed:', err.message);
    res.status(502).end();
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mockMode: MOCK_MODE, dataDir: DATA_DIR });
});

app.listen(PORT, () => {
  console.log(`[loudllama] LoudLlama Dashboard backend listening on :${PORT} (data dir: ${DATA_DIR}, mock mode: ${MOCK_MODE})`);
});
