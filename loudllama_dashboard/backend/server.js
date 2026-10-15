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
// Same host as HA_API_BASE, but without the `/api` suffix - used only by the
// entity_picture proxy below, since a picture path can be either a Core API
// path (`/api/image/serve/...`) or a plain static one HA's frontend itself
// serves (`/local/...`, an uploaded person photo) - the two live under
// different prefixes on the same Home Assistant host, and Supervisor's own
// core proxy forwards both.
const HA_CORE_BASE = 'http://supervisor/core';
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
  // --- Mock entities for the newer, non-Room widgets (Alarm/People/
  // Shortcuts/Energy) - same mutable dict/mechanism as the Room-oriented
  // entities above (mutated by applyMockService below), just not actually
  // specific to a room.
  'alarm_control_panel.home': { entity_id: 'alarm_control_panel.home', state: 'disarmed', attributes: { friendly_name: 'Alarm', code_format: 'number' } },
  'person.anders': { entity_id: 'person.anders', state: 'home', attributes: { friendly_name: 'Anders' } },
  'person.gaest': { entity_id: 'person.gaest', state: 'not_home', attributes: { friendly_name: 'Gæst' } },
  'scene.good_night': { entity_id: 'scene.good_night', state: 'scening', attributes: { friendly_name: 'Godnat' } },
  'script.movie_night': { entity_id: 'script.movie_night', state: 'off', attributes: { friendly_name: 'Biografaften' } },
  'sensor.power_now': { entity_id: 'sensor.power_now', state: '842', attributes: { friendly_name: 'Effekt lige nu', unit_of_measurement: 'W', device_class: 'power' } },
  'sensor.energy_today': { entity_id: 'sensor.energy_today', state: '4.7', attributes: { friendly_name: 'Forbrug i dag', unit_of_measurement: 'kWh', device_class: 'energy' } },
  // `todo.*` entities don't carry their items in `attributes` the way most
  // other domains carry their data - the item list lives behind the
  // `todo.get_items`/`add_item`/`update_item`/`remove_item` *services*
  // instead (see /api/hass/todo_items and applyMockService's 'todo' branch
  // below), so this entity's own state is just a HA-standard item count
  // (`attributes.friendly_name` is still what the widget's entity picker
  // shows, same as everywhere else).
  'todo.indkobsliste': { entity_id: 'todo.indkobsliste', state: '3', attributes: { friendly_name: 'Indkøbsliste' } },
};

// Mock items behind the mock todo.indkobsliste list above - kept separate
// from ROOM_MOCK_ENTITIES since a to-do list's items aren't entity
// attributes in real HA either (see that entity's own comment). uid is a
// plain incrementing counter here; real HA's uids are opaque strings, and
// the widget never assumes anything about their shape.
let mockTodoNextUid = 4;
const MOCK_TODO_ITEMS = {
  'todo.indkobsliste': [
    { uid: '1', summary: 'Mælk', status: 'needs_action' },
    { uid: '2', summary: 'Rugbrød', status: 'needs_action' },
    { uid: '3', summary: 'Kaffe', status: 'completed' },
  ],
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
    } else if (domain === 'todo') {
      const items = MOCK_TODO_ITEMS[id] || (MOCK_TODO_ITEMS[id] = []);
      if (service === 'add_item' && payload.item) {
        items.push({ uid: String(mockTodoNextUid++), summary: payload.item, status: 'needs_action' });
      } else if (service === 'update_item' && payload.item) {
        // Real HA accepts either the item's uid or its current summary in
        // this field to identify which one to update - mirrored here so
        // the widget doesn't need to know or care which one mock mode
        // happens to be matching against.
        const target = items.find((it) => it.uid === payload.item || it.summary === payload.item);
        if (target) {
          if (payload.rename !== undefined) target.summary = payload.rename;
          if (payload.status !== undefined) target.status = payload.status;
        }
      } else if (service === 'remove_item' && payload.item) {
        const toRemove = [].concat(payload.item);
        MOCK_TODO_ITEMS[id] = items.filter((it) => !toRemove.includes(it.uid) && !toRemove.includes(it.summary));
      }
      // Keep the entity's own state (HA's standard "N" open-items count) in
      // sync with the mutated item list, same as a real todo integration
      // would after any of the three services above.
      if (entity) entity.state = String((MOCK_TODO_ITEMS[id] || []).filter((it) => it.status !== 'completed').length);
    } else if (domain === 'alarm_control_panel') {
      // Mock mode doesn't model security seriously (there's no real alarm
      // panel behind it to protect) - any code is accepted here, unlike a
      // real alarm_control_panel integration which would reject a wrong one
      // by failing the service call itself (see alarm.js's own comment on
      // how the widget tells the difference).
      const ARM_SERVICE_TO_STATE = {
        alarm_arm_home: 'armed_home',
        alarm_arm_away: 'armed_away',
        alarm_arm_night: 'armed_night',
        alarm_arm_vacation: 'armed_vacation',
      };
      if (ARM_SERVICE_TO_STATE[service]) entity.state = ARM_SERVICE_TO_STATE[service];
      else if (service === 'alarm_disarm') entity.state = 'disarmed';
      else if (service === 'alarm_trigger') entity.state = 'triggered';
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

// Shared by both the legacy `weather.demo` state's `attributes.forecast`
// (still read directly by very old HA versions/frontends) and the mock
// implementation of the `weather.get_forecasts` service below - real HA
// moved forecast data from the former to the latter around 2023.9, and the
// mock backend needs to keep answering both the same way a real instance
// running either era would.
function mockForecastArray(type) {
  const hourly = [
    { datetime: new Date(Date.now() + 1 * 3600e3).toISOString(), condition: 'cloudy', temperature: 13 },
    { datetime: new Date(Date.now() + 2 * 3600e3).toISOString(), condition: 'cloudy', temperature: 13 },
    { datetime: new Date(Date.now() + 3 * 3600e3).toISOString(), condition: 'rainy', temperature: 12 },
    { datetime: new Date(Date.now() + 6 * 3600e3).toISOString(), condition: 'rainy', temperature: 11 },
  ];
  const daily = [
    { datetime: new Date(Date.now() + 3 * 3600e3).toISOString(), condition: 'cloudy', temperature: 13 },
    { datetime: new Date(Date.now() + 6 * 3600e3).toISOString(), condition: 'rainy', temperature: 11 },
    { datetime: new Date(Date.now() + 24 * 3600e3).toISOString(), condition: 'sunny', temperature: 16 },
    { datetime: new Date(Date.now() + 48 * 3600e3).toISOString(), condition: 'partlycloudy', temperature: 15 },
  ];
  return type === 'hourly' ? hourly : daily;
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
      // Legacy shape, kept only so the mock also exercises the
      // attrs.forecast fallback path in weather.js - a real current-version
      // HA instance no longer sends this, which is why the forecast now
      // primarily comes from /api/hass/weather_forecast below.
      forecast: mockForecastArray('daily'),
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
      // Renamed from "Værelse" to "Rum" in 0.10.017, requested directly -
      // "rum" reads more naturally for non-bedroom spaces (kitchen, hallway,
      // garage, etc.) that this widget is equally meant to cover.
      da: 'Rum',
      en: 'Room',
      de: 'Raum',
      sv: 'Rum',
      no: 'Rom',
    },
    description: {
      da: 'Ét rum ad gangen: vælg entiteter, de grupperes automatisk (lys, stikkontakter, klima, sensorer, sikkerhed, medier, m.m.). Klik for fuldskærmsstyring. Lys/klima/medie-entiteter vises som deres egne widgets inde i rummet.',
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
      da: 'Tænd/sluk og dæmp ét lys. Kan stå for sig selv på dashboardet, eller dukker automatisk op inde i en Rum-widget når du tilføjer et lys der.',
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
      da: 'Aktuel temperatur og en +/- måltemperatur for én termostat (Tado og de fleste andre virker, da de eksponeres som almindelige climate-entiteter i HA). Dukker automatisk op inde i en Rum-widget.',
      en: 'Current temperature and a +/- target for one thermostat (Tado and most others work, since they show up as regular HA climate entities). Shows up automatically inside a Room widget.',
      de: 'Aktuelle Temperatur und ein +/- Zielwert für ein Thermostat (Tado und die meisten anderen funktionieren, da sie als normale HA-Climate-Entitäten erscheinen). Erscheint automatisch in einem Zimmer-Widget.',
      sv: 'Aktuell temperatur och ett +/- målvärde för en termostat (Tado och de flesta andra fungerar, eftersom de visas som vanliga HA climate-entiteter). Dyker automatiskt upp inuti en Rum-widget.',
      no: 'Gjeldende temperatur og et +/- måltemperatur for én termostat (Tado og de fleste andre fungerer, siden de vises som vanlige HA climate-enheter). Dukker automatisk opp inne i en Rom-widget.',
    },
  },
  {
    id: 'sensor',
    version: '1.0.0',
    icon: 'gauge',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    name: {
      da: 'Sensor',
      en: 'Sensor',
      de: 'Sensor',
      sv: 'Sensor',
      no: 'Sensor',
    },
    description: {
      da: 'Viser den aktuelle værdi for én sensor-entitet, med ikon og enhed. Enkel og hurtig at sætte op til alt fra temperatur til strømforbrug.',
      en: 'Shows the current reading for one sensor entity, with icon and unit. Quick to set up for anything from temperature to power usage.',
      de: 'Zeigt den aktuellen Messwert einer Sensor-Entität mit Symbol und Einheit. Schnell eingerichtet für alles von Temperatur bis Stromverbrauch.',
      sv: 'Visar det aktuella värdet för en sensor-entitet, med ikon och enhet. Snabbt att ställa in för allt från temperatur till strömförbrukning.',
      no: 'Viser gjeldende verdi for én sensor-enhet, med ikon og enhet. Raskt å sette opp for alt fra temperatur til strømforbruk.',
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
      da: 'Afspil/pause, lydstyrke og aktuelt nummer for én medieafspiller (Sonos og de fleste andre virker, da de eksponeres som almindelige media_player-entiteter i HA). Dukker automatisk op inde i en Rum-widget.',
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
  {
    id: 'clock',
    version: '1.0.0',
    icon: 'clock-outline',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    name: {
      da: 'Klokke',
      en: 'Clock',
      de: 'Uhr',
      sv: 'Klocka',
      no: 'Klokke',
    },
    description: {
      da: 'Tid og dato, opdateres hvert sekund. Ingen opsætning nødvendig - vælg bare 12- eller 24-timers format.',
      en: 'Time and date, updating every second. No setup needed beyond picking 12- or 24-hour format.',
      de: 'Uhrzeit und Datum, aktualisiert jede Sekunde. Keine Einrichtung nötig außer der Wahl von 12- oder 24-Stunden-Format.',
      sv: 'Tid och datum, uppdateras varje sekund. Ingen inställning behövs utöver att välja 12- eller 24-timmarsformat.',
      no: 'Tid og dato, oppdateres hvert sekund. Ingen oppsett nødvendig utover å velge 12- eller 24-timersformat.',
    },
  },
  {
    id: 'shortcuts',
    version: '1.0.0',
    icon: 'gesture-tap-button',
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 2, h: 2 },
    name: {
      da: 'Genveje',
      en: 'Shortcuts',
      de: 'Verknüpfungen',
      sv: 'Genvägar',
      no: 'Genveier',
    },
    description: {
      da: 'En lille gitter af knapper der hver kører en Home Assistant-scene eller -script med ét tryk ("Godnat", "Biografaften", osv).',
      en: 'A small grid of buttons, each running one Home Assistant scene or script with a single tap ("Good night", "Movie night", etc).',
      de: 'Ein kleines Raster von Schaltflächen, die jeweils eine Home-Assistant-Szene oder ein Skript mit einem Tipp ausführen ("Gute Nacht", "Kinoabend" usw).',
      sv: 'Ett litet rutnät med knappar som var och en kör en Home Assistant-scen eller -skript med ett tryck ("God natt", "Filmkväll" osv).',
      no: 'Et lite rutenett med knapper som hver kjører en Home Assistant-scene eller -skript med ett trykk ("God natt", "Filmkveld" osv).',
    },
  },
  {
    id: 'people',
    version: '1.0.0',
    icon: 'account-group',
    defaultSize: { w: 2, h: 3 },
    minSize: { w: 2, h: 2 },
    name: {
      da: 'Hvem er hjemme',
      en: 'Who’s home',
      de: 'Wer ist da',
      sv: 'Vem är hemma',
      no: 'Hvem er hjemme',
    },
    description: {
      da: 'Lister alle person-enheder i Home Assistant med billede og hjemme/ude-status. Ingen opsætning nødvendig - viser alle som standard.',
      en: 'Lists every person entity in Home Assistant with their photo and home/away status. No setup needed - shows everyone by default.',
      de: 'Listet alle Personen-Entitäten in Home Assistant mit Foto und Zuhause/Unterwegs-Status auf. Keine Einrichtung nötig - zeigt standardmäßig alle an.',
      sv: 'Listar alla person-entiteter i Home Assistant med foto och hemma/borta-status. Ingen inställning behövs - visar alla som standard.',
      no: 'Lister alle person-enheter i Home Assistant med bilde og hjemme/ute-status. Ingen oppsett nødvendig - viser alle som standard.',
    },
  },
  {
    id: 'energy',
    version: '1.0.0',
    icon: 'lightning-bolt',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 1 },
    name: {
      da: 'Energi',
      en: 'Energy',
      de: 'Energie',
      sv: 'Energi',
      no: 'Energi',
    },
    description: {
      da: 'Aktuelt strømforbrug og/eller dagens forbrug, fra to valgfrie sensor-entiteter du selv vælger.',
      en: 'Current power draw and/or today’s usage, from two optional sensor entities you pick yourself.',
      de: 'Aktuelle Leistungsaufnahme und/oder heutiger Verbrauch, aus zwei optionalen, selbst gewählten Sensor-Entitäten.',
      sv: 'Aktuell strömförbrukning och/eller dagens förbrukning, från två valfria sensor-entiteter du själv väljer.',
      no: 'Nåværende strømforbruk og/eller dagens forbruk, fra to valgfrie sensor-enheter du selv velger.',
    },
  },
  {
    id: 'alarm',
    version: '1.0.0',
    icon: 'shield-lock',
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    name: {
      da: 'Alarm',
      en: 'Alarm',
      de: 'Alarm',
      sv: 'Larm',
      no: 'Alarm',
    },
    description: {
      da: 'Til-/frakobl en alarm-enhed (Alarmo og de fleste andre virker). Vælg ved tilføjelse om den skal bruge simple et-tryk-knapper eller spørge om en PIN-kode først.',
      en: 'Arm/disarm an alarm entity (Alarmo and most others work). Choose when adding it whether it uses simple one-tap buttons or asks for a PIN code first.',
      de: 'Eine Alarmanlagen-Entität scharf-/unscharf schalten (Alarmo und die meisten anderen funktionieren). Wähle beim Hinzufügen, ob einfache Ein-Tipp-Tasten verwendet werden oder zuerst ein PIN-Code abgefragt wird.',
      sv: 'Till-/frånkoppla en larm-entitet (Alarmo och de flesta andra fungerar). Välj vid tillägg om den ska använda enkla ett-tryck-knappar eller fråga om en PIN-kod först.',
      no: 'Til-/frakobl en alarm-enhet (Alarmo og de fleste andre fungerer). Velg ved tillegg om den skal bruke enkle ett-trykk-knapper eller spørre om en PIN-kode først.',
    },
  },
  {
    id: 'todo',
    version: '1.0.0',
    icon: 'format-list-checks',
    defaultSize: { w: 2, h: 3 },
    minSize: { w: 2, h: 2 },
    name: {
      da: 'Gøremål/indkøbsliste',
      en: 'To-do/shopping list',
      de: 'Aufgaben/Einkaufsliste',
      sv: 'Att göra/inköpslista',
      no: 'Gjøremål/handleliste',
    },
    description: {
      da: 'Viser og redigerer en af Home Assistants indbyggede to-do-lister (fx den klassiske indkøbsliste, eller enhver anden du har oprettet) direkte fra dashboardet - tilføj, afkryds og fjern punkter.',
      en: "Shows and edits one of Home Assistant's built-in to-do lists (e.g. the classic shopping list, or any other you've created) straight from the dashboard - add, check off and remove items.",
      de: 'Zeigt eine von Home Assistants eingebauten Aufgabenlisten (z. B. die klassische Einkaufsliste oder eine andere, die du erstellt hast) direkt vom Dashboard aus an - Punkte hinzufügen, abhaken und entfernen.',
      sv: 'Visar och redigerar en av Home Assistants inbyggda att göra-listor (t.ex. den klassiska inköpslistan, eller någon annan du skapat) direkt från dashboarden - lägg till, bocka av och ta bort punkter.',
      no: 'Viser og redigerer en av Home Assistants innebygde gjøremålslister (f.eks. den klassiske handlelisten, eller en annen du har opprettet) direkte fra dashbordet - legg til, kryss av og fjern punkter.',
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
// Every device (phone, tablet, wall-mounted panel, ...) gets its own fully
// independent dashboard: its own widgets, its own settings for each one
// (weather entity, chosen cameras, a room's entities, ...), its own sizes
// and positions. Nothing is shared between devices any more - removing a
// widget on your phone, or picking the compact size for it there, has no
// effect on what your PC's browser shows. The tradeoff is the one that
// comes with that: a widget you want on two devices has to be added and
// configured on each of them separately - there's no single shared source
// any more to keep two devices in sync automatically.
//
// (Earlier versions shared one `layout.json` widget list across every
// device, with only size/position kept per device in
// device-layouts/<deviceId>.json - see this file's git history if you need
// the old model. That's what made "remove a widget on my phone" also
// remove it on every other device: the widget itself, not just its
// position, was the shared part.)
//
// Each device's *entire* dashboard now lives in one file:
//   device-layouts/<deviceId>.json   {widgets: [{id, type, config, label,
//                                     x, y, w, h, dock, page}]} - the full
//                                     widget list for this device and
//                                     nothing else, no merging with
//                                     anyone else's.
//
// A device's own file is the single source of truth for that device: a
// POST here always replaces that device's entire widget list with exactly
// what was posted (the client already sends its whole current DOM state on
// every save, see app.js's serializeLayout), and DELETE removes a widget
// from that device's own file only.
//
// Migration: a device that was already running before this version either
// has an old-format file (`{positions: {...}}`, no widgets of its own yet)
// or no file at all (never customized a position). Either way, the first
// time such a device asks for its layout under the new model, it's seeded
// with a one-time snapshot of whatever it *used to* effectively see under
// the old shared-layout.json + positions model (readLegacyLayoutForSeeding
// below), then written out as that device's own independent file from then
// on. This runs lazily per device (there's no way to migrate a device that
// hasn't asked yet), so a device that hasn't opened the dashboard in a
// while still gets its own faithful snapshot the next time it does,
// whenever that is - not whatever layout.json happens to look like by then.
const DEFAULT_LAYOUT = {
  widgets: [
    { id: 'weather-1', type: 'weather', x: 0, y: 0, w: 4, h: 4, config: { entity_id: '' } },
  ],
};

function sanitizeDeviceId(raw) {
  const cleaned = (typeof raw === 'string' ? raw : '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'default';
}

function deviceLayoutFile(deviceId) {
  return path.join(DEVICE_LAYOUTS_DIR, `${deviceId}.json`);
}

function writeDeviceLayout(deviceId, widgets) {
  fs.writeFileSync(deviceLayoutFile(deviceId), JSON.stringify({ widgets }, null, 2));
}

// Only ever used to seed a device that hasn't been migrated to the new
// per-device-only model yet (see the big comment above) - never read or
// written to again afterward, so it's fine that this stays frozen at
// whatever it looked like right before the upgrade.
function readLegacyLayoutForSeeding() {
  if (fs.existsSync(LAYOUT_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8'));
      if (Array.isArray(data.widgets)) return JSON.parse(JSON.stringify(data.widgets));
    } catch (err) {
      console.error('[loudllama] Failed to read legacy shared layout, using default:', err);
    }
  }
  return JSON.parse(JSON.stringify(DEFAULT_LAYOUT.widgets));
}

function readDeviceLayout(deviceId) {
  const file = deviceLayoutFile(deviceId);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && Array.isArray(data.widgets)) {
        // Already on the new per-device-only format.
        return data.widgets;
      }
      if (data && data.positions && typeof data.positions === 'object') {
        // Old format: this device only ever had position overrides on top
        // of the old shared layout.json, never its own widget list. Merge
        // the two once, now, into this device's own full copy - see the
        // migration comment above.
        const legacyWidgets = readLegacyLayoutForSeeding();
        const migrated = legacyWidgets.map((w) => {
          const pos = data.positions[w.id];
          return pos
            ? { ...w, x: pos.x, y: pos.y, w: pos.w, h: pos.h, dock: !!pos.dock, page: Number.isFinite(pos.page) ? pos.page : 0 }
            : { ...w, page: 0 };
        });
        writeDeviceLayout(deviceId, migrated);
        return migrated;
      }
    } catch (err) {
      console.error('[loudllama] Failed to read device layout, falling back to a fresh seed:', err);
    }
  }
  // Brand new device, or a corrupt file: seed it from whatever the old
  // shared layout.json currently has (so an in-place upgrade doesn't make
  // an existing device's dashboard look empty the first time it loads),
  // falling back to DEFAULT_LAYOUT for a genuinely fresh install that never
  // had a shared layout.json either.
  const seed = readLegacyLayoutForSeeding();
  writeDeviceLayout(deviceId, seed);
  return seed;
}

app.get('/api/layout', (req, res) => {
  try {
    const deviceId = sanitizeDeviceId(req.query.device);
    res.json({ widgets: readDeviceLayout(deviceId) });
  } catch (err) {
    console.error('[loudllama] Failed to read layout:', err);
    res.status(500).json({ error: 'layout_read_failed' });
  }
});

app.post('/api/layout', (req, res) => {
  try {
    const deviceId = sanitizeDeviceId(req.query.device);
    const incoming = Array.isArray(req.body && req.body.widgets) ? req.body.widgets : [];
    const widgets = incoming
      .filter((w) => w && w.id && w.type)
      .map((w) => ({
        id: w.id,
        type: w.type,
        config: w.config || {},
        label: typeof w.label === 'string' ? w.label : '',
        x: w.x ?? 0,
        y: w.y ?? 0,
        w: w.w ?? 3,
        h: w.h ?? 3,
        dock: !!w.dock,
        page: Number.isFinite(w.page) ? w.page : 0,
      }));
    // A full, authoritative replace of this device's own widget list - the
    // client always posts its whole current DOM state (see app.js's
    // serializeLayout), and no other device shares this file, so there's
    // nothing to merge against.
    writeDeviceLayout(deviceId, widgets);
    res.json({ ok: true });
  } catch (err) {
    console.error('[loudllama] Failed to save layout:', err);
    res.status(500).json({ error: 'layout_write_failed' });
  }
});

// Explicit, deliberate widget removal - see the big comment above for why
// this is a separate endpoint instead of being inferred from a POST that
// simply omits the widget. Only ever touches this one device's own file.
app.delete('/api/layout/widgets/:id', (req, res) => {
  try {
    const deviceId = sanitizeDeviceId(req.query.device);
    const widgets = readDeviceLayout(deviceId).filter((w) => w.id !== req.params.id);
    writeDeviceLayout(deviceId, widgets);
    res.json({ ok: true });
  } catch (err) {
    console.error('[loudllama] Failed to delete widget:', err);
    res.status(500).json({ error: 'layout_delete_failed' });
  }
});

// --- Settings (background image, kiosk mode, etc.) --------------------------
// Defaults merged *underneath* whatever's actually on disk, so a settings.json
// written by an older version of this add-on (before a given field existed -
// e.g. every settings.json saved before kioskMode was added below) still
// comes back with a sensible value for the new field instead of `undefined`.
// backgroundStyle picks which of the dashboard's background options is
// shown - 'standard' (the original soft gradient mesh), 'aurora' (the new
// aurora-over-mountains gradient added in 0.10.017), or 'photo' (whatever
// image backgroundUrl below points at). backgroundUrl itself is kept even
// while a gradient style is active, so switching back to 'photo' later
// restores the uploaded image without asking the user to upload it again.
const SETTINGS_DEFAULTS = { backgroundUrl: null, backgroundStyle: 'standard', kioskMode: true };

function readSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      const merged = { ...SETTINGS_DEFAULTS, ...saved };
      // Back-compat: a settings.json saved before backgroundStyle existed
      // (anything from before 0.10.017) has a backgroundUrl but never
      // mentions backgroundStyle at all - falling through to this
      // version's actual default ('standard') would silently hide a
      // photo someone had already uploaded the moment this update
      // installs. Only a *missing* key counts, not an explicit 'standard'/
      // 'aurora' saved later by this same version choosing to switch away
      // from their photo.
      if (saved.backgroundUrl && saved.backgroundStyle === undefined) {
        merged.backgroundStyle = 'photo';
      }
      return merged;
    } catch {
      /* fall through to default */
    }
  }
  return { ...SETTINGS_DEFAULTS };
}

function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

app.get('/api/settings', (req, res) => {
  res.json(readSettings());
});

// Generic partial-update endpoint for simple on/off style settings (kiosk
// mode, which background style is active, anything similar later) - unlike
// /api/background below, there's no file upload involved, just a small JSON
// merge onto whatever's already saved. Only fields this endpoint explicitly
// recognizes are ever accepted, so a stray/garbled request body can't
// silently inject arbitrary keys into settings.json.
const BACKGROUND_STYLES = ['standard', 'aurora', 'photo'];
app.post('/api/settings', (req, res) => {
  try {
    const settings = readSettings();
    const body = req.body || {};
    if (typeof body.kioskMode === 'boolean') settings.kioskMode = body.kioskMode;
    if (BACKGROUND_STYLES.includes(body.backgroundStyle)) settings.backgroundStyle = body.backgroundStyle;
    writeSettings(settings);
    res.json(settings);
  } catch (err) {
    console.error('[loudllama] Failed to save settings:', err);
    res.status(500).json({ error: 'settings_write_failed' });
  }
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
  // Uploading a photo is itself the "use my photo" choice - switch to it
  // right away rather than leaving whichever gradient style was active
  // still showing until the user also remembers to pick "Your photo" from
  // the background menu separately.
  settings.backgroundStyle = 'photo';
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

// Home Assistant removed forecast data from `weather.*` entities'
// `attributes.forecast` around core 2023.9, in favour of calling the
// `weather.get_forecasts` *service* explicitly (it returns its result in the
// response body rather than storing it as entity state). The weather widget
// used to read `attributes.forecast` directly, which is why the forecast
// strip quietly stopped appearing for anyone on a current HA version - this
// wraps that service call so the frontend has one endpoint that works
// regardless of which era of HA it's talking to (weather.js still also
// checks attrs.forecast as a fallback for any integration that still sets
// it).
app.get('/api/hass/weather_forecast/:entityId', async (req, res) => {
  const { entityId } = req.params;
  const type = ['daily', 'hourly', 'twice_daily'].includes(req.query.type) ? req.query.type : 'daily';
  if (MOCK_MODE) {
    return res.json({ forecast: mockForecastArray(type) });
  }
  try {
    // `return_response` is what tells HA's REST API to include the
    // service's return value in the response body at all (services are
    // fire-and-forget by default) - it's a bare query flag, no value.
    const upstream = await fetch(`${HA_API_BASE}/services/weather/get_forecasts?return_response`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPERVISOR_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entity_id: entityId, type }),
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error(`[loudllama] weather.get_forecasts -> ${upstream.status}: ${detail}`);
      return res.status(502).json({ error: 'ha_service_failed' });
    }
    const body = await upstream.json();
    // Response shape: { changed_states: [...], service_response: { "<entity_id>": { forecast: [...] } } }
    const forecast = (body && body.service_response && body.service_response[entityId] && body.service_response[entityId].forecast) || [];
    res.json({ forecast });
  } catch (err) {
    console.error('[loudllama] /api/hass/weather_forecast failed:', err.message);
    res.status(502).json({ error: 'ha_unreachable' });
  }
});

// A `todo.*` entity's items live behind the `todo.get_items` *service*, not
// in its own attributes (see MOCK_TODO_ITEMS's comment above for why) - same
// "wrap a return_response service call as a plain GET" shape as
// /api/hass/weather_forecast just above, for exactly the same reason: the
// widget shouldn't have to know or care that this is a service call
// underneath rather than ordinary entity state.
app.get('/api/hass/todo_items/:entityId', async (req, res) => {
  const { entityId } = req.params;
  if (MOCK_MODE) {
    return res.json({ items: MOCK_TODO_ITEMS[entityId] || [] });
  }
  try {
    const upstream = await fetch(`${HA_API_BASE}/services/todo/get_items?return_response`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPERVISOR_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ entity_id: entityId }),
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error(`[loudllama] todo.get_items -> ${upstream.status}: ${detail}`);
      return res.status(502).json({ error: 'ha_service_failed' });
    }
    const body = await upstream.json();
    // Response shape: { changed_states: [...], service_response: { "<entity_id>": { items: [...] } } }
    const items = (body && body.service_response && body.service_response[entityId] && body.service_response[entityId].items) || [];
    res.json({ items });
  } catch (err) {
    console.error('[loudllama] /api/hass/todo_items failed:', err.message);
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

// --- Entity picture proxy (People widget) ------------------------------------
// A person entity's `entity_picture` attribute is a path on Home Assistant's
// OWN host, not ours - this page runs inside an Ingress iframe under a
// different, per-session path, so the browser can't just load that path
// directly (and in production, authless anyway - HA requires the same
// Authorization this backend already holds for everything else). Mirrors
// the existing camera_snapshot proxy below in spirit: fetch it from the HA
// side with our Supervisor token and pipe the bytes straight through.
app.get('/api/hass/entity_picture/:entityId', async (req, res) => {
  const { entityId } = req.params;
  if (MOCK_MODE) return res.status(404).end(); // no mock entity has a real photo - frontend falls back to initials
  try {
    const entity = await haFetch(`/states/${encodeURIComponent(entityId)}`);
    const picturePath = entity && entity.attributes && entity.attributes.entity_picture;
    if (!picturePath) return res.status(404).end();
    // See HA_CORE_BASE above: a Core API path and a plain static one live
    // under different prefixes on the same host.
    const upstreamUrl = picturePath.startsWith('/api/')
      ? `${HA_API_BASE}${picturePath.slice(4)}`
      : `${HA_CORE_BASE}${picturePath}`;
    const upstream = await fetch(upstreamUrl, {
      headers: { Authorization: `Bearer ${SUPERVISOR_TOKEN}` },
    });
    if (!upstream.ok) return res.status(502).end();
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    upstream.body.pipe(res);
  } catch (err) {
    console.error('[loudllama] entity_picture proxy failed:', err.message);
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

// --- Frigate events (recent recordings/detections) --------------------------
// Still entirely through Home Assistant, never a direct connection to
// Frigate - same principle as the snapshot/stream proxies above. The
// Frigate HA integration registers its own REST views under HA's `/api/
// frigate/...` namespace (proxied through Supervisor's core API the same
// way `/api/camera_proxy/...` is), including a generic events listing and
// per-event thumbnail/snapshot/clip media. A camera's HA entity id is
// `camera.<frigate_camera_name>` by the integration's own convention, so
// the Frigate-side camera name is recovered by stripping the domain.
function frigateCameraName(entityId) {
  const idx = entityId.indexOf('.');
  return idx === -1 ? entityId : entityId.slice(idx + 1);
}

const MOCK_EVENT_LABELS = ['person', 'car', 'dog', 'package'];

function mockFrigateEvents(cameraNames, limit) {
  const now = Date.now();
  const events = [];
  cameraNames.forEach((cam, camIdx) => {
    const count = Math.min(limit, 4);
    for (let i = 0; i < count; i += 1) {
      const startMs = now - (camIdx * 1300 + i * 45 * 60 * 1000 + 3 * 60 * 1000);
      events.push({
        id: `mock-${cam}-${i}`,
        camera: cam,
        label: MOCK_EVENT_LABELS[(camIdx + i) % MOCK_EVENT_LABELS.length],
        start_time: startMs / 1000,
        end_time: startMs / 1000 + 12,
        has_clip: true,
        has_snapshot: true,
      });
    }
  });
  events.sort((a, b) => b.start_time - a.start_time);
  return events.slice(0, limit);
}

app.get('/api/hass/frigate/events', async (req, res) => {
  const entityIds = String(req.query.cameras || '').split(',').map((s) => s.trim()).filter(Boolean);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  if (!entityIds.length) return res.json([]);
  const cameraNames = entityIds.map(frigateCameraName);
  const nameToEntity = {};
  entityIds.forEach((id, i) => { nameToEntity[cameraNames[i]] = id; });

  if (MOCK_MODE) {
    const events = mockFrigateEvents(cameraNames, limit);
    return res.json(events.map((e) => ({ ...e, entity_id: nameToEntity[e.camera] })));
  }

  try {
    // Per-camera requests rather than trusting a single comma-joined
    // `cameras` filter - Frigate's own /api/events accepts a singular
    // `camera` query param, and staying per-camera here means one unknown
    // camera name can't break the whole request, only that camera's slice.
    const perCameraLimit = Math.min(limit, 20);
    const results = await Promise.all(
      cameraNames.map(async (name) => {
        try {
          const events = await haFetch(`/frigate/events?camera=${encodeURIComponent(name)}&limit=${perCameraLimit}`);
          return Array.isArray(events) ? events : [];
        } catch (err) {
          console.error('[loudllama] frigate events fetch failed for camera', name, err.message);
          return [];
        }
      })
    );
    const merged = results.flat().map((e) => ({ ...e, entity_id: nameToEntity[e.camera] || null }));
    merged.sort((a, b) => (b.start_time || 0) - (a.start_time || 0));
    res.json(merged.slice(0, limit));
  } catch (err) {
    console.error('[loudllama] /api/hass/frigate/events failed:', err.message);
    res.status(502).json({ error: 'ha_unreachable' });
  }
});

const FRIGATE_MEDIA_KINDS = {
  thumbnail: 'thumbnail.jpg',
  snapshot: 'snapshot.jpg',
  clip: 'clip.mp4',
};

app.get('/api/hass/frigate/media/:eventId/:kind', async (req, res) => {
  const { eventId, kind } = req.params;
  const suffix = FRIGATE_MEDIA_KINDS[kind];
  if (!suffix) return res.status(400).end();
  if (MOCK_MODE) {
    if (kind === 'clip') return res.status(404).end(); // no fake video in mock mode
    return sendMockImage(res, `${eventId} (mock)`);
  }
  try {
    const upstream = await fetch(`${HA_API_BASE}/frigate/notifications/${encodeURIComponent(eventId)}/${suffix}`, {
      headers: { Authorization: `Bearer ${SUPERVISOR_TOKEN}` },
    });
    if (!upstream.ok) return res.status(502).end();
    res.set('Content-Type', upstream.headers.get('content-type') || (kind === 'clip' ? 'video/mp4' : 'image/jpeg'));
    upstream.body.pipe(res);
  } catch (err) {
    console.error('[loudllama] frigate media proxy failed:', err.message);
    res.status(502).end();
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mockMode: MOCK_MODE, dataDir: DATA_DIR });
});

app.listen(PORT, () => {
  console.log(`[loudllama] LoudLlama Dashboard backend listening on :${PORT} (data dir: ${DATA_DIR}, mock mode: ${MOCK_MODE})`);
});
