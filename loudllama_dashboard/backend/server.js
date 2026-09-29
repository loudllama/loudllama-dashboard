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
const INSTALLED_WIDGETS_FILE = path.join(DATA_DIR, 'widgets.json');
// Per-device position overrides (see "Layout persistence" below) - one small
// JSON file per device that has ever saved a layout.
const DEVICE_LAYOUTS_DIR = path.join(DATA_DIR, 'device-layouts');

for (const dir of [DATA_DIR, WWW_DIR, DEVICE_LAYOUTS_DIR]) {
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
    return [mockWeatherEntity(), mockLightEntity(), ...mockCameraEntities(), ...Object.values(ROOM_MOCK_ENTITIES)];
  }
  if (pathname.startsWith('/states/')) {
    const entityId = decodeURIComponent(pathname.split('/states/')[1]);
    if (entityId === 'weather.demo') return mockWeatherEntity();
    if (entityId === 'light.demo') return mockLightEntity();
    const camera = mockCameraEntities().find((c) => c.entity_id === entityId);
    if (camera) return camera;
    if (ROOM_MOCK_ENTITIES[entityId]) return ROOM_MOCK_ENTITIES[entityId];
    return { entity_id: entityId, state: 'unknown', attributes: {} };
  }
  throw new Error(`No mock handler for ${pathname}`);
}

// A small, *mutable* set of mock entities covering the domains the Room
// widget knows how to group/control (lights, switches, climate, sensors,
// a security sensor, media player, cover, lock). Unlike the other mocks
// above these persist across requests and are mutated by
// POST /api/hass/service/... so toggling things in mock mode actually
// behaves like a live Home Assistant would.
const ROOM_MOCK_ENTITIES = {
  'light.living_room_ceiling': { entity_id: 'light.living_room_ceiling', state: 'on', attributes: { friendly_name: 'Loftlampe', brightness: 180 } },
  'light.living_room_lamp': { entity_id: 'light.living_room_lamp', state: 'off', attributes: { friendly_name: 'Gulvlampe', brightness: null } },
  'switch.living_room_tv': { entity_id: 'switch.living_room_tv', state: 'off', attributes: { friendly_name: 'TV-stikkontakt' } },
  'sensor.living_room_temperature': { entity_id: 'sensor.living_room_temperature', state: '21.4', attributes: { friendly_name: 'Temperatur', unit_of_measurement: '°C', device_class: 'temperature' } },
  'sensor.living_room_humidity': { entity_id: 'sensor.living_room_humidity', state: '46', attributes: { friendly_name: 'Luftfugtighed', unit_of_measurement: '%', device_class: 'humidity' } },
  'binary_sensor.living_room_motion': { entity_id: 'binary_sensor.living_room_motion', state: 'off', attributes: { friendly_name: 'Bevægelse', device_class: 'motion' } },
  'binary_sensor.living_room_window': { entity_id: 'binary_sensor.living_room_window', state: 'off', attributes: { friendly_name: 'Vindue', device_class: 'window' } },
  'media_player.living_room_speaker': { entity_id: 'media_player.living_room_speaker', state: 'paused', attributes: { friendly_name: 'Stue-højtaler', volume_level: 0.4 } },
  'climate.living_room': { entity_id: 'climate.living_room', state: 'heat', attributes: { friendly_name: 'Termostat', current_temperature: 21.4, temperature: 22, hvac_action: 'heating' } },
  'cover.living_room_blinds': { entity_id: 'cover.living_room_blinds', state: 'closed', attributes: { friendly_name: 'Persienner' } },
  'lock.front_door': { entity_id: 'lock.front_door', state: 'locked', attributes: { friendly_name: 'Hoveddør' } },
};

// Mutates ROOM_MOCK_ENTITIES to roughly emulate what the real HA service
// would do, so the Room widget's optimistic UI + poll-to-confirm flow has
// something real to observe in mock mode.
function applyMockService(domain, service, payload) {
  const ids = [].concat(payload.entity_id || []).filter(Boolean);
  ids.forEach((id) => {
    const entity = ROOM_MOCK_ENTITIES[id];
    if (!entity) return;
    if (domain === 'light') {
      if (service === 'turn_on') {
        entity.state = 'on';
        if (payload.brightness_pct !== undefined) entity.attributes.brightness = Math.round((payload.brightness_pct / 100) * 255);
      } else if (service === 'turn_off') {
        entity.state = 'off';
      }
    } else if (domain === 'switch' || domain === 'fan' || domain === 'input_boolean') {
      if (service === 'turn_on') entity.state = 'on';
      if (service === 'turn_off') entity.state = 'off';
    } else if (domain === 'cover') {
      if (service === 'open_cover') entity.state = 'open';
      if (service === 'close_cover') entity.state = 'closed';
      if (service === 'stop_cover') entity.state = 'stopped';
    } else if (domain === 'lock') {
      if (service === 'lock') entity.state = 'locked';
      if (service === 'unlock') entity.state = 'unlocked';
    } else if (domain === 'climate' && service === 'set_temperature' && payload.temperature !== undefined) {
      entity.attributes.temperature = payload.temperature;
    } else if (domain === 'media_player') {
      if (service === 'media_play_pause') entity.state = entity.state === 'playing' ? 'paused' : 'playing';
      if (service === 'volume_set' && payload.volume_level !== undefined) entity.attributes.volume_level = payload.volume_level;
    } else if (domain === 'vacuum') {
      if (service === 'start') entity.state = 'cleaning';
      if (service === 'stop') entity.state = 'docked';
    }
  });
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
      de: 'Zeigt das aktuelle Wetter einer HA-Wetter-Entität, mit einem zum Wetter passenden Hintergrund.',
      sv: 'Visar aktuellt väder från en HA väder-entitet, med en bakgrund som matchar vädret.',
      no: 'Viser gjeldende vær fra en HA vær-enhet, med en bakgrunn som matcher været.',
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
      de: 'Mini-Raster mit Kamera-Vorschaubildern von Frigate/Home Assistant. Klick auf eine Kamera, um sie im Vollbild zu öffnen.',
      sv: 'Mini-rutnät med kamerauppspelningsbilder från Frigate/Home Assistant. Klicka på en kamera för att öppna den i helskärm.',
      no: 'Mini-rutenett med kamera-miniatyrbilder fra Frigate/Home Assistant. Klikk på et kamera for å åpne det i fullskjerm.',
    },
  },
  {
    id: 'room',
    version: '1.0.0',
    icon: 'sofa',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    name: {
      da: 'Værelse',
      en: 'Room',
      de: 'Raum',
      sv: 'Rum',
      no: 'Rom',
    },
    description: {
      da: 'Et værelse ad gangen: vælg entiteter, de grupperes automatisk (lys, stikkontakter, klima, sensorer, sikkerhed, medier, m.m.). Klik for fuldskærmsstyring. Lys/klima/medie-entiteter vises som deres egne widgets inde i værelset.',
      en: 'One room at a time: pick entities and they are auto-grouped (lights, switches, climate, sensors, security, media, etc). Click for fullscreen control. Light/climate/media entities show up as their own widgets inside the room.',
      de: 'Ein Zimmer nach dem anderen: Wähle Entitäten aus, sie werden automatisch gruppiert (Licht, Steckdosen, Klima, Sensoren, Sicherheit, Medien usw.). Klick für die Vollbild-Steuerung. Licht-/Klima-/Media-Entitäten erscheinen als eigene Widgets innerhalb des Zimmers.',
      sv: 'Ett rum i taget: välj enheter så grupperas de automatiskt (belysning, uttag, klimat, sensorer, säkerhet, media m.m.). Klicka för styrning i helskärm. Ljus-/klimat-/media-entiteter visas som egna widgets inuti rummet.',
      no: 'Ett rom om gangen: velg enheter, så grupperes de automatisk (lys, stikkontakter, klima, sensorer, sikkerhet, media m.m.). Klikk for styring i fullskjerm. Lys-/klima-/media-enheter vises som sine egne widgets inne i rommet.',
    },
  },
  {
    id: 'light',
    version: '1.0.0',
    icon: 'lightbulb',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    name: {
      da: 'Lys',
      en: 'Light',
      de: 'Licht',
      sv: 'Belysning',
      no: 'Lys',
    },
    description: {
      da: 'Tænd/sluk og dæmp ét lys. Kan stå for sig selv på dashboardet, eller dukker automatisk op inde i en Værelse-widget når du tilføjer et lys der.',
      en: 'On/off and dimming for one light. Works standalone on the dashboard, or shows up automatically inside a Room widget once you add a light to that room.',
      de: 'Ein/Aus und Dimmen für ein Licht. Funktioniert eigenständig auf dem Dashboard oder erscheint automatisch in einem Zimmer-Widget, sobald du diesem Zimmer ein Licht hinzufügst.',
      sv: 'Av/på och dimning för en lampa. Fungerar fristående på instrumentpanelen, eller dyker automatiskt upp inuti en Rum-widget när du lägger till en lampa i det rummet.',
      no: 'Av/på og dimming for ett lys. Fungerer frittstående på dashbordet, eller dukker automatisk opp inne i en Rom-widget når du legger til et lys i det rommet.',
    },
  },
  {
    id: 'climate',
    version: '1.0.0',
    icon: 'thermostat',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    name: {
      da: 'Termostat',
      en: 'Thermostat',
      de: 'Thermostat',
      sv: 'Termostat',
      no: 'Termostat',
    },
    description: {
      da: 'Aktuel temperatur og en +/- måltemperatur for én termostat (Tado og de fleste andre virker, da de eksponeres som almindelige climate-entiteter i HA). Dukker automatisk op inde i en Værelse-widget.',
      en: 'Current temperature and a +/- target for one thermostat (Tado and most others work, since they show up as regular HA climate entities). Shows up automatically inside a Room widget.',
      de: 'Aktuelle Temperatur und ein +/- Zielwert für ein Thermostat (Tado und die meisten anderen funktionieren, da sie als normale HA-Climate-Entitäten erscheinen). Erscheint automatisch in einem Zimmer-Widget.',
      sv: 'Aktuell temperatur och ett +/- målvärde för en termostat (Tado och de flesta andra fungerar, eftersom de visas som vanliga HA climate-entiteter). Dyker automatiskt upp inuti en Rum-widget.',
      no: 'Gjeldende temperatur og et +/- måltemperatur for én termostat (Tado og de fleste andre fungerer, siden de vises som vanlige HA climate-enheter). Dukker automatisk opp inne i en Rom-widget.',
    },
  },
  {
    id: 'media',
    version: '1.0.0',
    icon: 'speaker',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    name: {
      da: 'Højtaler',
      en: 'Speaker',
      de: 'Lautsprecher',
      sv: 'Högtalare',
      no: 'Høyttaler',
    },
    description: {
      da: 'Afspil/pause, lydstyrke og aktuelt nummer for én medieafspiller (Sonos og de fleste andre virker, da de eksponeres som almindelige media_player-entiteter i HA). Dukker automatisk op inde i en Værelse-widget.',
      en: 'Play/pause, volume, and the current track for one media player (Sonos and most others work, since they show up as regular HA media_player entities). Shows up automatically inside a Room widget.',
      de: 'Play/Pause, Lautstärke und aktueller Titel für einen Media Player (Sonos und die meisten anderen funktionieren, da sie als normale HA-media_player-Entitäten erscheinen). Erscheint automatisch in einem Zimmer-Widget.',
      sv: 'Play/paus, volym och aktuellt spår för en mediaspelare (Sonos och de flesta andra fungerar, eftersom de visas som vanliga HA media_player-entiteter). Dyker automatiskt upp inuti en Rum-widget.',
      no: 'Spill/pause, volum og gjeldende spor for én mediespiller (Sonos og de fleste andre fungerer, siden de vises som vanlige HA media_player-enheter). Dukker automatisk opp inne i en Rom-widget.',
    },
  },
  {
    id: 'group',
    version: '1.0.0',
    icon: 'view-grid-plus',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 2, h: 2 },
    name: {
      da: 'Gruppe',
      en: 'Group',
      de: 'Gruppe',
      sv: 'Grupp',
      no: 'Gruppe',
    },
    description: {
      da: 'En tom, navngivbar beholder til andre widgets. Giv den et navn, klik ind i den, og tilføj lige de widgets du vil have samlet ét sted - de kan flyttes og størrelsesændres uafhængigt af hovedskærmen.',
      en: 'An empty, nameable container for other widgets. Give it a name, click into it, and add whichever widgets you want grouped together - they can be moved and resized independently of the main dashboard.',
      de: 'Ein leerer, benennbarer Container für andere Widgets. Gib ihm einen Namen, klicke hinein und füge die Widgets hinzu, die du zusammen gruppieren möchtest - sie lassen sich unabhängig vom Hauptdashboard verschieben und in der Größe ändern.',
      sv: 'En tom, namngivningsbar behållare för andra widgets. Ge den ett namn, klicka in i den och lägg till de widgets du vill gruppera tillsammans - de kan flyttas och storleksändras oberoende av huvudpanelen.',
      no: 'En tom, navngivbar beholder for andre widgets. Gi den et navn, klikk inn i den, og legg til de widgetene du vil samle ett sted - de kan flyttes og endres i størrelse uavhengig av hoveddashbordet.',
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
// Every device (phone, tablet, wall-mounted panel, ...) that opens the
// dashboard sees the *same* widgets with the *same* settings (weather
// entity, chosen cameras, a room's entities, ...) - that part is one shared
// "definition" list, exactly what used to be the whole of layout.json.
// Only each widget's *size and position* is remembered separately per
// device, so one device can be arranged however suits its screen without
// moving anything around on anyone else's.
//
// Two files make this up:
//   - layout.json                     shared: [{id, type, config, label,
//                                      x, y, w, h}] - x/y/w/h here are the
//                                      *default* position, used by any
//                                      device that hasn't customized this
//                                      widget's placement yet.
//   - device-layouts/<deviceId>.json  per device: {positions: {widgetId:
//                                      {x, y, w, h, dock}}} - only an
//                                      override, never the widget's own
//                                      definition. `dock` is whether this
//                                      device pins the widget to its fixed
//                                      bottom row instead of the scrollable
//                                      grid.
//
// POSTing a layout only ever *upserts* the shared definitions (adds new
// widgets, updates an existing one's config/label) - it never removes one
// just because a particular device's payload doesn't happen to mention it.
// That matters because two devices can have loaded the page at different
// times and therefore disagree on exactly which widgets exist right now;
// if a save from the stalest one were allowed to delete whatever it didn't
// know about, one device resizing an unrelated widget could silently wipe
// out something another device added minutes earlier. Removing a widget
// for real goes through its own explicit DELETE endpoint instead, fired
// the moment someone clicks that widget's own remove button - an
// unambiguous, deliberate action rather than an inference from a diff.
const DEFAULT_LAYOUT = {
  widgets: [
    { id: 'weather-1', type: 'weather', x: 0, y: 0, w: 4, h: 4, config: { entity_id: '' } },
  ],
};

function sanitizeDeviceId(raw) {
  const cleaned = (typeof raw === 'string' ? raw : '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'default';
}

function devicePositionsFile(deviceId) {
  return path.join(DEVICE_LAYOUTS_DIR, `${deviceId}.json`);
}

function readSharedLayout() {
  if (fs.existsSync(LAYOUT_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8'));
      if (Array.isArray(data.widgets)) return data;
    } catch (err) {
      console.error('[loudllama] Failed to read layout, using default:', err);
    }
  }
  return JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
}

function writeSharedLayout(layout) {
  fs.writeFileSync(LAYOUT_FILE, JSON.stringify(layout, null, 2));
}

function readDevicePositions(deviceId) {
  const file = devicePositionsFile(deviceId);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && typeof data.positions === 'object' && data.positions) return data.positions;
    } catch (err) {
      console.error('[loudllama] Failed to read device layout, ignoring:', err);
    }
  }
  return {};
}

function writeDevicePositions(deviceId, positions) {
  fs.writeFileSync(devicePositionsFile(deviceId), JSON.stringify({ positions }, null, 2));
}

// Best-effort cleanup so a deleted widget's leftover position entries don't
// pile up in every device's file forever. Never blocks the actual delete.
function pruneWidgetFromAllDevicePositions(widgetId) {
  let files;
  try {
    files = fs.readdirSync(DEVICE_LAYOUTS_DIR).filter((f) => f.endsWith('.json'));
  } catch (err) {
    return;
  }
  files.forEach((f) => {
    const full = path.join(DEVICE_LAYOUTS_DIR, f);
    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (data && data.positions && Object.prototype.hasOwnProperty.call(data.positions, widgetId)) {
        delete data.positions[widgetId];
        fs.writeFileSync(full, JSON.stringify(data, null, 2));
      }
    } catch (err) {
      /* corrupt or unrelated file - leave it alone */
    }
  });
}

app.get('/api/layout', (req, res) => {
  try {
    const deviceId = sanitizeDeviceId(req.query.device);
    const shared = readSharedLayout();
    const positions = readDevicePositions(deviceId);
    const widgets = shared.widgets.map((w) => {
      const pos = positions[w.id];
      return pos ? { ...w, x: pos.x, y: pos.y, w: pos.w, h: pos.h, dock: !!pos.dock } : w;
    });
    res.json({ widgets });
  } catch (err) {
    console.error('[loudllama] Failed to read layout:', err);
    res.status(500).json({ error: 'layout_read_failed' });
  }
});

app.post('/api/layout', (req, res) => {
  try {
    const deviceId = sanitizeDeviceId(req.query.device);
    const incoming = Array.isArray(req.body && req.body.widgets) ? req.body.widgets : [];
    const shared = readSharedLayout();
    const sharedById = new Map(shared.widgets.map((w) => [w.id, w]));
    const positions = {};

    incoming.forEach((w) => {
      if (!w || !w.id || !w.type) return;
      const existing = sharedById.get(w.id);
      sharedById.set(w.id, {
        id: w.id,
        type: w.type,
        config: w.config || {},
        label: typeof w.label === 'string' ? w.label : (existing ? existing.label : undefined),
        // The *default* position is set once, when a widget is first seen,
        // and never touched again by an upsert - only this device's own
        // position file changes on every save. Otherwise whichever device
        // happened to save last would keep resetting everyone else's
        // fallback placement.
        x: existing ? existing.x : (w.x ?? 0),
        y: existing ? existing.y : (w.y ?? 0),
        w: existing ? existing.w : (w.w ?? 3),
        h: existing ? existing.h : (w.h ?? 3),
      });
      // dock: whether *this device* pins the widget to its fixed bottom
      // dock row instead of the scrollable grid - same per-device
      // treatment as x/y/w/h, since it's about where a widget sits on this
      // particular screen, not what the widget is or does.
      positions[w.id] = { x: w.x ?? 0, y: w.y ?? 0, w: w.w ?? 3, h: w.h ?? 3, dock: !!w.dock };
    });

    writeSharedLayout({ widgets: Array.from(sharedById.values()) });
    writeDevicePositions(deviceId, positions);
    res.json({ ok: true });
  } catch (err) {
    console.error('[loudllama] Failed to save layout:', err);
    res.status(500).json({ error: 'layout_write_failed' });
  }
});

// Explicit, deliberate widget removal - see the big comment above for why
// this is a separate endpoint instead of being inferred from a POST that
// simply omits the widget.
app.delete('/api/layout/widgets/:id', (req, res) => {
  try {
    const shared = readSharedLayout();
    shared.widgets = shared.widgets.filter((w) => w.id !== req.params.id);
    writeSharedLayout(shared);
    pruneWidgetFromAllDevicePositions(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[loudllama] Failed to delete widget:', err);
    res.status(500).json({ error: 'layout_delete_failed' });
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

// --- Widget registry + widget store (install/uninstall) ---------------------
// WIDGETS above lists every widget bundled with the add-on (this ships fixed
// inside the Docker image - a future update simply adds more entries here).
// Which of those are actually *active* on this user's dashboard is a
// separate, persisted choice ("installed"), so a fresh install/update never
// clutters the dashboard with widgets nobody asked for, and users are never
// forced to keep ones they don't use.
app.get('/api/widgets', (req, res) => {
  res.json(WIDGETS);
});

function readInstalledWidgetIds() {
  const knownIds = WIDGETS.map((w) => w.id);
  if (fs.existsSync(INSTALLED_WIDGETS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(INSTALLED_WIDGETS_FILE, 'utf8'));
      if (Array.isArray(data.installed)) {
        return data.installed.filter((id) => knownIds.includes(id));
      }
    } catch (err) {
      console.error('[loudllama] Failed to read widgets.json, defaulting to all installed:', err);
    }
  }
  // First run (no widgets.json yet): everything bundled with the add-on
  // starts installed, so upgrades and fresh installs behave exactly like
  // before the widget store existed. Users can then trim it down.
  return knownIds;
}

function writeInstalledWidgetIds(ids) {
  const knownIds = WIDGETS.map((w) => w.id);
  const clean = Array.from(new Set(Array.isArray(ids) ? ids : [])).filter((id) => knownIds.includes(id));
  fs.writeFileSync(INSTALLED_WIDGETS_FILE, JSON.stringify({ installed: clean }, null, 2));
  return clean;
}

app.get('/api/widgets/installed', (req, res) => {
  try {
    res.json({ installed: readInstalledWidgetIds() });
  } catch (err) {
    console.error('[loudllama] Failed to resolve installed widgets:', err);
    res.status(500).json({ error: 'widgets_read_failed' });
  }
});

app.post('/api/widgets/installed', (req, res) => {
  try {
    const installed = writeInstalledWidgetIds(req.body && req.body.installed);
    res.json({ installed });
  } catch (err) {
    console.error('[loudllama] Failed to save installed widgets:', err);
    res.status(500).json({ error: 'widgets_write_failed' });
  }
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
    const { domain, ids } = req.query;
    let result = states;
    if (ids) {
      const idSet = new Set(String(ids).split(',').map((s) => s.trim()).filter(Boolean));
      result = states.filter((s) => idSet.has(s.entity_id));
    } else if (domain) {
      result = states.filter((s) => s.entity_id.startsWith(`${domain}.`));
    }
    res.json(result);
  } catch (err) {
    console.error('[loudllama] /api/hass/states failed:', err.message);
    res.status(502).json({ error: 'ha_unreachable' });
  }
});

// Calls a Home Assistant service (e.g. light.turn_on, cover.close_cover).
// Used by the Room widget to make lights/switches/climate/covers/media
// players/locks actually controllable, not just readouts.
app.post('/api/hass/service/:domain/:service', async (req, res) => {
  const { domain, service } = req.params;
  const payload = req.body || {};
  if (MOCK_MODE) {
    applyMockService(domain, service, payload);
    return res.json({ ok: true, mock: true });
  }
  try {
    const upstream = await fetch(`${HA_API_BASE}/services/${domain}/${service}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPERVISOR_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error(`[loudllama] service ${domain}.${service} -> ${upstream.status}: ${detail}`);
      return res.status(502).json({ error: 'ha_service_failed' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(`[loudllama] service ${domain}.${service} failed:`, err.message);
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
