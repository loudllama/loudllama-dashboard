/*
 * LoudLlama Dashboard - Room widget.
 *
 * One widget instance = one room. On first add it asks for a name, then
 * which entities belong to the room; from then on it shows a compact
 * "glance" tile, and clicking it opens a rounded fullscreen popup with the
 * room's entities auto-grouped (lights / switches / climate / covers / fans
 * / media / security / sensors / other) and directly controllable - not
 * just a readout.
 *
 * Everything goes through the backend's HA proxy, same as the other
 * widgets, plus one new endpoint: POST /api/hass/service/:domain/:service
 * (a thin passthrough to HA's `POST /api/services/...`) so lights/switches/
 * covers/climate/media/locks can actually be operated from here.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const POLL_MS = 20 * 1000;
  const RECONCILE_DELAY_MS = 900;

  // --- Categorisation -------------------------------------------------------
  // What else is worth indexing for room placement, beyond lights/sensors/
  // speakers: switches (plugs, often not lighting), climate/thermostats
  // (need controls, not just a reading), covers/blinds, fans, vacuums,
  // locks + security-flagged binary sensors (door/window/motion/smoke/etc,
  // kept apart from ordinary numeric sensors since they're "is something
  // wrong" indicators), and a catch-all for scenes/scripts/helpers so a
  // room can carry a quick-action button too.
  const SECURITY_DEVICE_CLASSES = [
    'door', 'window', 'garage_door', 'opening', 'motion', 'moisture',
    'smoke', 'gas', 'safety', 'presence', 'vibration', 'sound', 'tamper',
  ];
  const OPENING_DEVICE_CLASSES = ['door', 'window', 'garage_door', 'opening'];

  const GROUP_ORDER = ['light', 'switch', 'climate', 'cover', 'fan', 'media', 'vacuum', 'security', 'sensor', 'other'];
  const GROUP_ICON = {
    light: '💡', switch: '🔌', climate: '🌡️', cover: '🪟', fan: '🌀',
    media: '🔊', vacuum: '🤖', security: '🔒', sensor: '📊', other: '⚙️',
  };

  // Preset icons offered for the compact (1x1) size variant - see
  // sizeVariants on registerWidget below and renderCompact()'s
  // llw-room--compact branch. Deliberately a small curated set covering the
  // room types people actually have, not a full icon-font picker - picking
  // one should be a two-second tap, not its own search UI.
  //
  // Each entry is still identified by its original plain-emoji character
  // (so a room saved before the icons below existed keeps showing exactly
  // the icon it already had - the emoji is just a lookup key now, not what
  // actually gets drawn). ROOM_ICON_SVG maps that same key to a small
  // hand-built gradient-shaded SVG, same style as the weather widget's
  // icons (see weather.js's iconSvg) - picked because a flat single-colour
  // emoji read as "too cartoonish" next to the rest of the dashboard's
  // shaded, dimensional look.
  const ROOM_ICONS = ['🏠', '🛋️', '🛏️', '🍳', '🚿', '💻', '🚗', '🌳', '🧺', '🎮', '📺', '🍽️', '🚪'];

  // --- Icons (compact 1x1 size) ---------------------------------------------
  let roomIconUid = 0;
  function nextRoomIconUid() {
    roomIconUid += 1;
    return `llwri${roomIconUid}`;
  }

  // A soft contact shadow under each icon - the one bit of shading every
  // icon below shares, so none of them look like they're floating flat
  // against the tile.
  function roomIconShadow(cx, cy, rx, ry) {
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="0.18"/>`;
  }

  function roomIconHouse(uid) {
    const wallId = `${uid}wall`, roofId = `${uid}roof`;
    return `
      <defs>
        <linearGradient id="${wallId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffe8c2"/>
          <stop offset="100%" stop-color="#f3c988"/>
        </linearGradient>
        <linearGradient id="${roofId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#e2654a"/>
          <stop offset="100%" stop-color="#b8402b"/>
        </linearGradient>
      </defs>
      ${roomIconShadow(32, 56, 20, 4)}
      <rect x="16" y="30" width="32" height="24" rx="2" fill="url(#${wallId})"/>
      <path d="M10 32 L32 12 L54 32 L48 32 L32 18 L16 32 Z" fill="url(#${roofId})"/>
      <rect x="27" y="40" width="10" height="14" rx="1.5" fill="#6b4226"/>
      <rect x="20" y="36" width="6" height="6" fill="#bfe3f0" opacity="0.9"/>
      <rect x="38" y="36" width="6" height="6" fill="#bfe3f0" opacity="0.9"/>
    `;
  }

  function roomIconCouch(uid) {
    const padId = `${uid}pad`;
    return `
      <defs>
        <linearGradient id="${padId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#8fa8d8"/>
          <stop offset="100%" stop-color="#5c7ab8"/>
        </linearGradient>
      </defs>
      ${roomIconShadow(32, 54, 22, 4)}
      <rect x="10" y="30" width="44" height="10" rx="5" fill="url(#${padId})"/>
      <rect x="12" y="36" width="40" height="14" rx="6" fill="url(#${padId})"/>
      <rect x="8" y="26" width="8" height="24" rx="4" fill="url(#${padId})"/>
      <rect x="48" y="26" width="8" height="24" rx="4" fill="url(#${padId})"/>
      <rect x="18" y="32" width="12" height="8" rx="3" fill="#fff" opacity="0.18"/>
      <rect x="34" y="32" width="12" height="8" rx="3" fill="#fff" opacity="0.18"/>
    `;
  }

  function roomIconBed(uid) {
    const blanketId = `${uid}blanket`;
    return `
      <defs>
        <linearGradient id="${blanketId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#f6a9c0"/>
          <stop offset="100%" stop-color="#d9638f"/>
        </linearGradient>
      </defs>
      ${roomIconShadow(32, 54, 22, 4)}
      <rect x="10" y="22" width="12" height="14" rx="3" fill="#fff" opacity="0.92"/>
      <rect x="12" y="24" width="8" height="8" rx="2" fill="#dfe6ee"/>
      <rect x="10" y="34" width="44" height="18" rx="4" fill="url(#${blanketId})"/>
      <rect x="8" y="30" width="48" height="8" rx="4" fill="#fff" opacity="0.85"/>
    `;
  }

  function roomIconKitchen(uid) {
    const panId = `${uid}pan`;
    return `
      <defs>
        <radialGradient id="${panId}" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#6b6f76"/>
          <stop offset="100%" stop-color="#2d3034"/>
        </radialGradient>
      </defs>
      ${roomIconShadow(30, 52, 18, 4)}
      <circle cx="28" cy="34" r="18" fill="url(#${panId})"/>
      <circle cx="28" cy="34" r="14" fill="#1c1e21"/>
      <ellipse cx="28" cy="34" rx="10" ry="8" fill="#fff" opacity="0.92"/>
      <circle cx="28" cy="34" r="4" fill="#ffc94a"/>
      <rect x="44" y="30" width="18" height="5" rx="2.5" fill="url(#${panId})" transform="rotate(10 44 30)"/>
    `;
  }

  function roomIconShower(uid) {
    const headId = `${uid}head`, dropId = `${uid}drop`;
    const drops = [0, 1, 2, 3, 4]
      .map((i) => `<path d="M${17 + i * 8} 28 C${19 + i * 8} 33 ${19 + i * 8} 37 ${17 + i * 8} 40 C${15 + i * 8} 37 ${15 + i * 8} 33 ${17 + i * 8} 28 Z" fill="url(#${dropId})"/>`)
      .join('');
    return `
      <defs>
        <linearGradient id="${headId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#cfd8de"/>
          <stop offset="100%" stop-color="#8d9aa3"/>
        </linearGradient>
        <linearGradient id="${dropId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#bfe3f5" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#4fa9d8"/>
        </linearGradient>
      </defs>
      <path d="M14 18 Q32 2 50 18" stroke="url(#${headId})" stroke-width="5" fill="none" stroke-linecap="round"/>
      <rect x="12" y="18" width="40" height="7" rx="3.5" fill="url(#${headId})"/>
      ${drops}
      ${roomIconShadow(32, 54, 20, 4)}
    `;
  }

  function roomIconOffice(uid) {
    const screenId = `${uid}screen`;
    return `
      <defs>
        <linearGradient id="${screenId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#7fd4ff"/>
          <stop offset="100%" stop-color="#2f8fc2"/>
        </linearGradient>
      </defs>
      ${roomIconShadow(32, 54, 22, 4)}
      <rect x="16" y="14" width="32" height="22" rx="2" fill="#30343b"/>
      <rect x="19" y="17" width="26" height="16" rx="1" fill="url(#${screenId})"/>
      <path d="M10 38 H54 L48 48 H16 Z" fill="#45484e"/>
      <rect x="10" y="36" width="44" height="4" rx="2" fill="#5a5e65"/>
    `;
  }

  function roomIconCar(uid) {
    const bodyId = `${uid}car`;
    return `
      <defs>
        <linearGradient id="${bodyId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ff8a65"/>
          <stop offset="100%" stop-color="#d84a2b"/>
        </linearGradient>
      </defs>
      ${roomIconShadow(32, 50, 22, 4)}
      <path d="M12 38 Q14 26 24 24 H40 Q50 26 52 38 Z" fill="url(#${bodyId})"/>
      <rect x="10" y="36" width="44" height="8" rx="4" fill="url(#${bodyId})"/>
      <path d="M22 26 H42 L46 34 H18 Z" fill="#bfe3f5" opacity="0.85"/>
      <circle cx="20" cy="45" r="6" fill="#26282b"/>
      <circle cx="44" cy="45" r="6" fill="#26282b"/>
      <circle cx="20" cy="45" r="2.4" fill="#8a8d92"/>
      <circle cx="44" cy="45" r="2.4" fill="#8a8d92"/>
    `;
  }

  function roomIconGarden(uid) {
    const leafId = `${uid}leaf`, trunkId = `${uid}trunk`;
    return `
      <defs>
        <radialGradient id="${leafId}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#9fdb86"/>
          <stop offset="100%" stop-color="#4b9c4a"/>
        </radialGradient>
        <linearGradient id="${trunkId}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#9c6b43"/>
          <stop offset="100%" stop-color="#6e4728"/>
        </linearGradient>
      </defs>
      ${roomIconShadow(32, 56, 18, 4)}
      <rect x="28" y="38" width="8" height="16" rx="2" fill="url(#${trunkId})"/>
      <circle cx="24" cy="26" r="13" fill="url(#${leafId})"/>
      <circle cx="38" cy="22" r="15" fill="url(#${leafId})"/>
      <circle cx="40" cy="36" r="11" fill="url(#${leafId})"/>
    `;
  }

  function roomIconLaundry(uid) {
    const basketId = `${uid}basket`;
    return `
      <defs>
        <linearGradient id="${basketId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#e3bd82"/>
          <stop offset="100%" stop-color="#a97c43"/>
        </linearGradient>
      </defs>
      ${roomIconShadow(32, 56, 20, 4)}
      <path d="M14 34 L50 34 L45 56 L19 56 Z" fill="url(#${basketId})"/>
      <ellipse cx="32" cy="34" rx="18" ry="5" fill="#c99a5d"/>
      <ellipse cx="26" cy="26" rx="8" ry="6" fill="#5c9bd8"/>
      <ellipse cx="38" cy="24" rx="7" ry="6" fill="#e06a7a"/>
      <ellipse cx="33" cy="29" rx="6" ry="5" fill="#f3d35c"/>
    `;
  }

  function roomIconGame(uid) {
    const bodyId = `${uid}pad`;
    return `
      <defs>
        <linearGradient id="${bodyId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#5c6773"/>
          <stop offset="100%" stop-color="#2d333b"/>
        </linearGradient>
      </defs>
      ${roomIconShadow(32, 50, 22, 4)}
      <path d="M14 26 Q10 26 9 32 L7 42 Q6 48 12 48 Q16 48 18 44 L22 38 H42 L46 44 Q48 48 52 48 Q58 48 57 42 L55 32 Q54 26 50 26 Z" fill="url(#${bodyId})"/>
      <circle cx="20" cy="33" r="2.2" fill="#9aa3ad"/>
      <circle cx="20" cy="39" r="2.2" fill="#9aa3ad"/>
      <circle cx="17" cy="36" r="2.2" fill="#9aa3ad"/>
      <circle cx="23" cy="36" r="2.2" fill="#9aa3ad"/>
      <circle cx="44" cy="33" r="2.6" fill="#ff6b6b"/>
      <circle cx="49" cy="37" r="2.6" fill="#4fd1a0"/>
    `;
  }

  function roomIconTv(uid) {
    const screenId = `${uid}tv`;
    return `
      <defs>
        <linearGradient id="${screenId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8fd8ff"/>
          <stop offset="100%" stop-color="#2d6fa8"/>
        </linearGradient>
      </defs>
      ${roomIconShadow(32, 52, 20, 4)}
      <rect x="10" y="14" width="44" height="28" rx="3" fill="#24262b"/>
      <rect x="13" y="17" width="38" height="22" rx="1.5" fill="url(#${screenId})"/>
      <rect x="28" y="42" width="8" height="6" fill="#3a3d43"/>
      <rect x="20" y="48" width="24" height="3" rx="1.5" fill="#3a3d43"/>
    `;
  }

  function roomIconDining(uid) {
    const plateId = `${uid}plate`;
    return `
      <defs>
        <radialGradient id="${plateId}" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#cfd6dc"/>
        </radialGradient>
      </defs>
      ${roomIconShadow(32, 54, 20, 4)}
      <circle cx="32" cy="32" r="17" fill="url(#${plateId})"/>
      <circle cx="32" cy="32" r="11" fill="#e6eaee"/>
      <rect x="12" y="18" width="4" height="26" rx="2" fill="#aeb4ba"/>
      <rect x="10" y="16" width="2.4" height="10" rx="1.2" fill="#aeb4ba"/>
      <rect x="13.8" y="16" width="2.4" height="10" rx="1.2" fill="#aeb4ba"/>
      <rect x="48" y="18" width="4" height="26" rx="2" fill="#aeb4ba"/>
    `;
  }

  function roomIconDoor(uid) {
    const doorId = `${uid}door`;
    return `
      <defs>
        <linearGradient id="${doorId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#c9975f"/>
          <stop offset="100%" stop-color="#8a5f34"/>
        </linearGradient>
      </defs>
      ${roomIconShadow(32, 56, 16, 4)}
      <rect x="18" y="10" width="28" height="46" rx="2" fill="url(#${doorId})"/>
      <rect x="22" y="16" width="20" height="16" rx="1.5" fill="#fff" opacity="0.18"/>
      <rect x="22" y="36" width="20" height="14" rx="1.5" fill="#fff" opacity="0.14"/>
      <circle cx="40" cy="34" r="2.4" fill="#f3d98a"/>
    `;
  }

  const ROOM_ICON_BUILDERS = {
    '🏠': roomIconHouse,
    '🛋️': roomIconCouch,
    '🛏️': roomIconBed,
    '🍳': roomIconKitchen,
    '🚿': roomIconShower,
    '💻': roomIconOffice,
    '🚗': roomIconCar,
    '🌳': roomIconGarden,
    '🧺': roomIconLaundry,
    '🎮': roomIconGame,
    '📺': roomIconTv,
    '🍽️': roomIconDining,
    '🚪': roomIconDoor,
  };

  function roomIconSvg(key) {
    const uid = nextRoomIconUid();
    const build = ROOM_ICON_BUILDERS[key] || roomIconHouse;
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${build(uid)}</svg>`;
  }

  function domainOf(entityId) {
    return entityId.split('.')[0];
  }

  function categorize(entity) {
    const domain = domainOf(entity.entity_id);
    const deviceClass = entity.attributes && entity.attributes.device_class;
    if (domain === 'light') return 'light';
    if (domain === 'switch') return 'switch';
    if (domain === 'climate') return 'climate';
    if (domain === 'media_player') return 'media';
    if (domain === 'cover') return 'cover';
    if (domain === 'fan') return 'fan';
    if (domain === 'vacuum') return 'vacuum';
    if (domain === 'lock' || domain === 'alarm_control_panel') return 'security';
    if (domain === 'binary_sensor') return SECURITY_DEVICE_CLASSES.includes(deviceClass) ? 'security' : 'sensor';
    if (domain === 'sensor') return 'sensor';
    return 'other';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function friendlyName(entity) {
    return (entity && entity.attributes && entity.attributes.friendly_name) || (entity && entity.entity_id) || '';
  }

  // --- Sub-widgets (nested grid) ---------------------------------------------
  // Light/climate/media entities in a room don't just get a plain control
  // row like everything else - they get mounted as their own real widgets
  // (frontend/widgets/light, /climate, /media) inside a small GridStack grid
  // of their own, right inside the fullscreen popup. Because a widget only
  // ever needs a DOM element + {config, saveConfig} to mount, the exact same
  // Light/Climate/Media widget code runs here as on the main dashboard - it
  // has no idea it's nested. This is what turns a Room widget into more of
  // a "group of widgets" than a single tile.
  const SUBWIDGET_TYPE_BY_DOMAIN = { light: 'light', climate: 'climate', media_player: 'media' };
  const SUBGRID_COLUMNS = 4;
  const SUBGRID_CELL_HEIGHT = 78;

  // --- Widget lifecycle -------------------------------------------------------
  function mount(el, { config, saveConfig }) {
    let cfg = {
      name: config.name || '',
      entities: Array.isArray(config.entities) ? config.entities.slice() : [],
      // {id, type, x, y, w, h, config} per light/climate/media_player entity
      // - kept in sync with `entities` by syncSubWidgets(). Older saved
      // rooms (from before this existed) just get it derived the first time
      // they're opened, so upgrading never loses anything.
      subWidgets: Array.isArray(config.subWidgets) ? config.subWidgets.slice() : null,
      // Which of this room's entities the glance temperature/target-temp
      // stepper comes from. '' (the default) means auto-detect, same as
      // before this setting existed - findPrimaryTemperature() falls back
      // to that whenever this is unset or points at something that's no
      // longer in the room.
      tempEntityId: config.tempEntityId || '',
      // entity_id -> custom display name, scoped to this room only (doesn't
      // touch the entity's actual name in Home Assistant or on any other
      // widget). Anything not in here just falls back to friendly_name, same
      // as always - see displayName() below.
      entityLabels: (config.entityLabels && typeof config.entityLabels === 'object') ? { ...config.entityLabels } : {},
      // 'full' (default, for every room saved before this existed) shows the
      // original header+glance tile; 'compact' shows just an icon with the
      // room's name in a small caption below the tile - see
      // renderCompact()'s llw-room--compact branch. Chosen once, when the
      // widget is added (see app.js's size picker) - not something this
      // widget itself offers a way to change later, same as every other
      // widget with sizeVariants.
      sizeVariant: config.sizeVariant === 'compact' ? 'compact' : 'full',
      // Which of ROOM_ICONS this room shows in compact mode - '' falls back
      // to the first entry (the plain house) rather than showing nothing.
      icon: config.icon || '',
    };
    let liveEntities = {}; // entity_id -> live HA entity
    let pollTimer = null;
    let destroyed = false;
    let activeModal = null;
    let activeEditorModal = null;
    let editorBodyEl = null;
    let subGrid = null;
    let subWidgetCleanups = [];
    let arranging = false;
    let saveTimer = null;
    let editorDraftName = '';
    let editorDraftEntities = [];
    let editorDraftTempEntity = '';
    let editorDraftEntityLabels = {};
    let editorDraftIcon = '';

    function scheduleSaveRoom() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveConfig(cfg), 500);
    }

    // Adds/removes sub-widget entries so they match cfg.entities 1:1 for the
    // domains that have a dedicated widget. Never touches x/y/w/h on an
    // entry that already exists, so rearranging in the popup sticks.
    function syncSubWidgets() {
      if (!Array.isArray(cfg.subWidgets)) cfg.subWidgets = [];
      const wanted = new Set();
      cfg.entities.forEach((id) => {
        const type = SUBWIDGET_TYPE_BY_DOMAIN[domainOf(id)];
        if (!type) return;
        wanted.add(id);
        let sw = cfg.subWidgets.find((w) => w.config && w.config.entity_id === id);
        if (!sw) {
          sw = {
            id: `${type}-${id.replace(/[^a-z0-9_]/gi, '')}-${Date.now().toString(36)}`,
            type,
            w: 2,
            h: 2,
            config: { entity_id: id },
          };
          cfg.subWidgets.push(sw);
        }
        // Keep the sub-widget's own displayed name in sync with this room's
        // custom label, in both directions - set it when there's a label,
        // clear it when there isn't (so a removed label really does fall
        // back to the entity's real friendly_name again).
        const label = cfg.entityLabels && cfg.entityLabels[id];
        if (label) {
          sw.config.displayName = label;
        } else if (sw.config && sw.config.displayName) {
          delete sw.config.displayName;
        }
      });
      cfg.subWidgets = cfg.subWidgets.filter((w) => w.config && wanted.has(w.config.entity_id));
    }

    // Sub-widget types (light/climate/media) are only actually usable once
    // their script has loaded - and, so they survive a page reload, once
    // they're marked "installed" the same way the widget store would (see
    // LL.ensureWidgetInstalled in app.js). A room full of lights shouldn't
    // silently break just because nobody happened to open the widget store.
    function ensureSubWidgetTypesLoaded() {
      const types = Array.from(new Set(cfg.subWidgets.map((w) => w.type)));
      return Promise.all(
        types.map((type) => {
          const entry = (LL.widgetCatalog || []).find((w) => w.id === type);
          return Promise.all([LL.loadWidgetAssets(entry), LL.ensureWidgetInstalled(type)]);
        })
      );
    }

    el.classList.add('llw-widget-room');
    el.innerHTML = `
      <div class="llw-room">
        <div class="llw-room__bg"></div>
        <div class="llw-room__content">
          <div class="llw-room__head">
            <span class="llw-room__name"></span>
            <button class="llw-room__gear" type="button">⚙</button>
          </div>
          <div class="llw-room__glance"></div>
          <div class="llw-room__compact-icon"></div>
        </div>
      </div>
    `;

    const roomEl = el.querySelector('.llw-room');
    const nameEl = el.querySelector('.llw-room__name');
    const glanceEl = el.querySelector('.llw-room__glance');
    const compactIconEl = el.querySelector('.llw-room__compact-icon');
    const gearBtn = el.querySelector('.llw-room__gear');
    // The compact variant's caption ("which room is this") renders OUTSIDE
    // this widget's own box, as a sibling inside the shared shell (see
    // .llw-widget-shell in app.css) - same spot the old per-widget caption
    // used to live before 0.09.015 removed it for everyone. Full-size rooms
    // never get one; see syncCompactCaption().
    const shellEl = el.closest('.llw-widget-shell');

    // --- Editor (setup wizard + later edits) -----------------------------
    // Unlike the compact glance tile, the editor is a true fullscreen popup
    // appended to document.body (same pattern as openModal() below) instead
    // of living inside the widget's own element - so picking entities is
    // never cramped by whatever size the room tile itself happens to be
    // (it can be resized down to 1x1).
    function openEditor() {
      closeEditor();
      editorDraftName = cfg.name;
      editorDraftEntities = cfg.entities.slice();
      editorDraftTempEntity = cfg.tempEntityId || '';
      editorDraftEntityLabels = { ...cfg.entityLabels };
      editorDraftIcon = cfg.icon || '';

      const modal = document.createElement('div');
      modal.className = 'llw-room-editor-modal';
      modal.innerHTML = `
        <div class="llw-room-editor-modal__card">
          <div class="llw-room-editor-modal__body"></div>
        </div>
      `;
      const canCancel = !!cfg.name;
      modal.addEventListener('click', (ev) => {
        if (canCancel && ev.target === modal) closeEditor();
      });
      document.body.appendChild(modal);
      if (canCancel) document.addEventListener('keydown', onEditorKeydown);
      activeEditorModal = modal;
      editorBodyEl = modal.querySelector('.llw-room-editor-modal__body');
      renderEditorStep1();
    }

    function closeEditor() {
      if (!activeEditorModal) return;
      document.removeEventListener('keydown', onEditorKeydown);
      activeEditorModal.remove();
      activeEditorModal = null;
      editorBodyEl = null;
    }

    function onEditorKeydown(ev) {
      if (ev.key === 'Escape') closeEditor();
    }

    function renderEditorStep1() {
      if (!editorBodyEl) return;
      const canCancel = !!cfg.name;
      // Icon picker only matters for the compact (1x1) variant - a full-size
      // room's tile has no room for an icon and never shows one, so asking a
      // full-size room's owner to also pick one would just be noise.
      const showIconPicker = cfg.sizeVariant === 'compact';
      editorBodyEl.innerHTML = `
        ${canCancel ? `<button type="button" class="llw-room-editor-modal__close" aria-label="${t('room', 'close')}">×</button>` : ''}
        <label class="llw-room__editor-label">${t('room', 'setupTitle')}</label>
        <input type="text" class="llw-room__name-input" placeholder="${escapeHtml(t('room', 'namePlaceholder'))}" value="${escapeHtml(editorDraftName)}" maxlength="40" />
        ${showIconPicker ? `
          <label class="llw-room__editor-label">${t('room', 'chooseIconTitle')}</label>
          <div class="llw-room__icon-picker">
            ${ROOM_ICONS.map(
              (icon) => `<button type="button" class="llw-room__icon-opt ${(editorDraftIcon || ROOM_ICONS[0]) === icon ? 'is-selected' : ''}" data-icon="${icon}" aria-label="${icon}">${roomIconSvg(icon)}</button>`
            ).join('')}
          </div>` : ''}
        <div class="llw-room__editor-actions">
          <button type="button" class="llw-room__next">${t('room', 'next')}</button>
        </div>
      `;
      const input = editorBodyEl.querySelector('.llw-room__name-input');
      if (showIconPicker) {
        editorBodyEl.querySelectorAll('.llw-room__icon-opt').forEach((btn) => {
          btn.addEventListener('click', () => {
            editorDraftIcon = btn.dataset.icon;
            editorBodyEl.querySelectorAll('.llw-room__icon-opt').forEach((b) => b.classList.toggle('is-selected', b === btn));
          });
        });
      }
      const goNext = () => {
        const val = input.value.trim();
        if (!val) {
          input.classList.add('llw-shake');
          input.focus();
          setTimeout(() => input.classList.remove('llw-shake'), 300);
          return;
        }
        editorDraftName = val;
        renderEditorStep2();
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') goNext();
      });
      editorBodyEl.querySelector('.llw-room__next').addEventListener('click', goNext);
      if (canCancel) editorBodyEl.querySelector('.llw-room-editor-modal__close').addEventListener('click', closeEditor);
      requestAnimationFrame(() => input.focus());
    }

    function renderEditorStep2() {
      if (!editorBodyEl) return;
      const canCancel = !!cfg.name;
      editorBodyEl.innerHTML = `
        ${canCancel ? `<button type="button" class="llw-room-editor-modal__close" aria-label="${t('room', 'close')}">×</button>` : ''}
        <label class="llw-room__editor-label">${t('room', 'chooseEntitiesTitle')}</label>
        <input type="text" class="llw-room__search" placeholder="${escapeHtml(t('room', 'searchPlaceholder'))}" />
        <div class="llw-room__editor-list">…</div>
        <div class="llw-room__editor-temp">
          <label class="llw-room__editor-label llw-room__editor-label--sub">${t('room', 'tempSourceLabel')}</label>
          <select class="llw-room__temp-select"><option value="">${t('room', 'tempSourceAuto')}</option></select>
        </div>
        <div class="llw-room__editor-actions">
          <button type="button" class="llw-room__back">${t('room', 'back')}</button>
          <button type="button" class="llw-room__save">${t('room', 'save')}</button>
        </div>
      `;
      if (canCancel) editorBodyEl.querySelector('.llw-room-editor-modal__close').addEventListener('click', closeEditor);
      const listEl = editorBodyEl.querySelector('.llw-room__editor-list');
      const searchEl = editorBodyEl.querySelector('.llw-room__search');
      const tempSelectEl = editorBodyEl.querySelector('.llw-room__temp-select');
      let allEntities = [];

      // Custom label (if any) currently staged for this entity, else its
      // real Home Assistant friendly_name - used for both the list's display
      // text and the search filter, so renaming "spisestue anden lysgruppe"
      // to "Spisestue loft" also makes it findable under the new name.
      function labelFor(e) {
        return (editorDraftEntityLabels && editorDraftEntityLabels[e.entity_id]) || friendlyName(e);
      }

      function startRename(id) {
        const span = listEl.querySelector(`.llw-room__editor-row-name[data-row-entity="${id}"]`);
        if (!span || span.tagName === 'INPUT') return;
        const entity = allEntities.find((e) => e.entity_id === id) || { entity_id: id, attributes: {} };
        const original = friendlyName(entity);
        const currentValue = (editorDraftEntityLabels && editorDraftEntityLabels[id]) || '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'llw-room__editor-rename-input';
        input.maxLength = 60;
        input.value = currentValue;
        input.placeholder = original;
        input.dataset.rowEntity = id;
        span.replaceWith(input);
        input.focus();
        input.select();
        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          const val = input.value.trim();
          if (val && val !== original) editorDraftEntityLabels[id] = val;
          else delete editorDraftEntityLabels[id];
          const newSpan = document.createElement('span');
          newSpan.className = 'llw-room__editor-row-name';
          newSpan.dataset.rowEntity = id;
          newSpan.textContent = editorDraftEntityLabels[id] || original;
          input.replaceWith(newSpan);
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            ev.stopPropagation();
            input.blur();
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            input.value = currentValue;
            input.blur();
          }
        });
        input.addEventListener('blur', commit);
        input.addEventListener('click', (ev) => ev.stopPropagation());
      }

      // Only a climate entity (has a settable target) or a temperature
      // sensor is worth offering as "the" room temperature - and only ones
      // actually checked into this room, so this stays a refinement of
      // what's already there rather than a second, unrelated entity picker.
      function isTempCandidate(e) {
        const domain = domainOf(e.entity_id);
        if (domain === 'climate') return true;
        return domain === 'sensor' && e.attributes && e.attributes.device_class === 'temperature';
      }
      function refreshTempOptions() {
        const candidates = editorDraftEntities
          .map((id) => allEntities.find((e) => e.entity_id === id) || { entity_id: id, attributes: {} })
          .filter(isTempCandidate);
        // If the entity that was providing the temperature just got
        // unchecked, fall back to "Automatic" rather than keeping a
        // dangling id nothing points at any more.
        if (editorDraftTempEntity && !candidates.some((e) => e.entity_id === editorDraftTempEntity)) {
          editorDraftTempEntity = '';
        }
        tempSelectEl.disabled = !candidates.length;
        tempSelectEl.innerHTML =
          `<option value="">${t('room', 'tempSourceAuto')}</option>` +
          candidates
            .map((e) => `<option value="${e.entity_id}" ${e.entity_id === editorDraftTempEntity ? 'selected' : ''}>${escapeHtml(labelFor(e))}</option>`)
            .join('');
      }
      tempSelectEl.addEventListener('change', () => {
        editorDraftTempEntity = tempSelectEl.value;
      });

      function renderList(filterText) {
        const q = filterText.trim().toLowerCase();
        const filtered = q
          ? allEntities.filter((e) => labelFor(e).toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q))
          : allEntities;
        if (!filtered.length) {
          listEl.innerHTML = `<div class="llw-room__empty-msg">${t('room', 'noEntitiesFound')}</div>`;
          return;
        }
        const byGroup = {};
        filtered.forEach((e) => {
          const g = categorize(e);
          (byGroup[g] = byGroup[g] || []).push(e);
        });
        listEl.innerHTML = GROUP_ORDER.filter((g) => byGroup[g] && byGroup[g].length)
          .map(
            (g) => `
            <div class="llw-room__editor-group">
              <div class="llw-room__editor-group-label">${GROUP_ICON[g]} ${t('room', `groups.${g}`)}</div>
              ${byGroup[g]
                .map(
                  (e) => `
                <div class="llw-room__editor-row">
                  <label class="llw-room__editor-row-label">
                    <input type="checkbox" value="${e.entity_id}" ${editorDraftEntities.includes(e.entity_id) ? 'checked' : ''} />
                    <span class="llw-room__editor-row-name" data-row-entity="${e.entity_id}">${escapeHtml(labelFor(e))}</span>
                  </label>
                  <button type="button" class="llw-room__editor-rename" data-row-entity="${e.entity_id}" title="${escapeHtml(t('room', 'renameEntity'))}" aria-label="${escapeHtml(t('room', 'renameEntity'))}">✎</button>
                </div>`
                )
                .join('')}
            </div>`
          )
          .join('');
        listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
          cb.addEventListener('change', () => {
            editorDraftEntities = cb.checked
              ? editorDraftEntities.concat(cb.value)
              : editorDraftEntities.filter((id) => id !== cb.value);
            refreshTempOptions();
          });
        });
        listEl.querySelectorAll('.llw-room__editor-rename').forEach((btn) => {
          btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            startRename(btn.dataset.rowEntity);
          });
        });
      }

      LL.api
        .get('api/hass/states')
        .then((entities) => {
          allEntities = entities;
          renderList('');
          refreshTempOptions();
        })
        .catch((err) => {
          console.error('[loudllama][room] failed to load entities', err);
          listEl.innerHTML = `<div class="llw-room__empty-msg">${t('room', 'noEntitiesFound')}</div>`;
        });

      searchEl.addEventListener('input', () => renderList(searchEl.value));
      editorBodyEl.querySelector('.llw-room__back').addEventListener('click', renderEditorStep1);
      editorBodyEl.querySelector('.llw-room__save').addEventListener('click', () => {
        const entityLabels = {};
        editorDraftEntities.forEach((id) => {
          if (editorDraftEntityLabels[id]) entityLabels[id] = editorDraftEntityLabels[id];
        });
        cfg = {
          name: editorDraftName,
          entities: editorDraftEntities.slice(),
          subWidgets: cfg.subWidgets || [],
          tempEntityId: editorDraftTempEntity || '',
          entityLabels,
          sizeVariant: cfg.sizeVariant,
          icon: cfg.sizeVariant === 'compact' ? (editorDraftIcon || ROOM_ICONS[0]) : cfg.icon,
        };
        syncSubWidgets();
        ensureSubWidgetTypesLoaded().then(() => saveConfig(cfg));
        closeEditor();
        renderCompact();
        startPolling();
      });
    }

    gearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openEditor();
    });

    // --- Live data ----------------------------------------------------------
    async function fetchLiveEntities() {
      if (!cfg.entities.length) {
        liveEntities = {};
        return;
      }
      try {
        const list = await LL.api.get(`api/hass/states?ids=${encodeURIComponent(cfg.entities.join(','))}`);
        const next = {};
        list.forEach((e) => {
          next[e.entity_id] = e;
        });
        liveEntities = next;
      } catch (err) {
        console.error('[loudllama][room] failed to fetch live entity states', err);
      }
    }

    function startPolling() {
      clearInterval(pollTimer);
      fetchLiveEntities().then(() => {
        renderCompact();
        if (activeModal) renderModalGroups();
      });
      pollTimer = setInterval(() => {
        fetchLiveEntities().then(() => {
          if (destroyed) return;
          renderCompact();
          if (activeModal) renderModalGroups();
        });
      }, POLL_MS);
    }

    // --- Compact glance tile --------------------------------------------------
    function groupCounts() {
      const counts = {};
      cfg.entities.forEach((id) => {
        const e = liveEntities[id] || { entity_id: id, attributes: {} };
        const g = categorize(e);
        counts[g] = (counts[g] || 0) + 1;
      });
      return counts;
    }

    function anyLightOn() {
      return cfg.entities.some((id) => {
        const e = liveEntities[id];
        return e && domainOf(id) === 'light' && e.state === 'on';
      });
    }

    // Returns {value, unit, climateEntityId?} - climateEntityId is only set
    // when the source is a climate.* entity (i.e. one with an actual
    // settable target), which is what renderCompact() uses to decide
    // whether to show the +/- stepper next to the glance temperature.
    function findPrimaryTemperature() {
      if (cfg.tempEntityId) {
        const chosen = liveEntities[cfg.tempEntityId];
        if (chosen) {
          if (domainOf(chosen.entity_id) === 'climate' && chosen.attributes && chosen.attributes.current_temperature !== undefined) {
            return { value: chosen.attributes.current_temperature, unit: '°', climateEntityId: chosen.entity_id };
          }
          if (chosen.attributes && chosen.attributes.device_class === 'temperature') {
            return { value: chosen.state, unit: chosen.attributes.unit_of_measurement || '°' };
          }
        }
        // Chosen entity is missing or turned out not to be temperature-
        // shaped (e.g. removed from HA) - fall through to auto-detect
        // rather than showing nothing.
      }
      const climateEnt = cfg.entities
        .map((id) => liveEntities[id])
        .find((e) => e && domainOf(e.entity_id) === 'climate' && e.attributes && e.attributes.current_temperature !== undefined);
      if (climateEnt) return { value: climateEnt.attributes.current_temperature, unit: '°', climateEntityId: climateEnt.entity_id };
      const sensorEnt = cfg.entities
        .map((id) => liveEntities[id])
        .find((e) => e && e.attributes && e.attributes.device_class === 'temperature');
      if (sensorEnt) return { value: sensorEnt.state, unit: sensorEnt.attributes.unit_of_measurement || '°' };
      return null;
    }

    function formatGlanceTemp(t2) {
      const num = Number(t2.value);
      return `${Number.isFinite(num) ? Math.round(num * 10) / 10 : t2.value}${t2.unit}`;
    }

    // Creates/updates/removes the under-card caption for the compact
    // variant - see the shellEl comment above. Shell is display:flex;
    // flex-direction:column (see .llw-widget-shell in app.css), so an extra
    // child here simply appears below this widget's own box, no absolute
    // positioning needed.
    function syncCompactCaption() {
      if (!shellEl) return;
      let capEl = shellEl.querySelector(':scope > .llw-widget-caption');
      if (cfg.sizeVariant === 'compact') {
        if (!capEl) {
          capEl = document.createElement('div');
          capEl.className = 'llw-widget-caption';
          shellEl.appendChild(capEl);
        }
        capEl.textContent = cfg.name || '';
      } else if (capEl) {
        capEl.remove();
      }
    }

    function renderCompact() {
      nameEl.textContent = cfg.name;
      roomEl.style.setProperty('--room-hue', String(hashHue(cfg.name || 'room')));
      roomEl.classList.toggle('llw-room--lit', anyLightOn());
      roomEl.classList.toggle('llw-room--clickable', cfg.entities.length > 0);
      roomEl.classList.toggle('llw-room--compact', cfg.sizeVariant === 'compact');
      compactIconEl.innerHTML = roomIconSvg(cfg.icon || ROOM_ICONS[0]);
      syncCompactCaption();

      if (!cfg.entities.length) {
        glanceEl.innerHTML = `<div class="llw-room__empty">${t('room', 'noEntitiesSelected')}</div>`;
        return;
      }
      const counts = groupCounts();
      const temp = findPrimaryTemperature();
      const climateId = temp && temp.climateEntityId;
      const climateEnt = climateId ? liveEntities[climateId] : null;
      const target = climateEnt && climateEnt.attributes ? climateEnt.attributes.temperature : undefined;
      glanceEl.innerHTML = `
        ${temp ? `
          <div class="llw-room__temp-row">
            <div class="llw-room__temp">${formatGlanceTemp(temp)}</div>
            ${climateId ? `
              <div class="llw-room__temp-stepper">
                <button type="button" class="llw-room__temp-btn" data-temp-action="dec" aria-label="-">−</button>
                <span class="llw-room__temp-target">${target !== undefined && target !== null ? `${Math.round(target * 10) / 10}°` : '--'}</span>
                <button type="button" class="llw-room__temp-btn" data-temp-action="inc" aria-label="+">+</button>
              </div>` : ''}
          </div>` : ''}
        <div class="llw-room__chips">
          ${GROUP_ORDER.filter((g) => counts[g])
            .map((g) => `<span class="llw-room__chip" title="${t('room', `groups.${g}`)}">${GROUP_ICON[g]}<b>${counts[g]}</b></span>`)
            .join('')}
        </div>
        <div class="llw-room__hint">${t('room', 'tapToOpen')}</div>
      `;
      // Glance tile itself is clickable (opens the full room popup), so
      // both stepper buttons have to stop that click from reaching it -
      // same pattern as the gear icon just above.
      if (climateId) {
        const stepClimateTarget = (delta) => {
          const ent = liveEntities[climateId];
          if (!ent) return;
          const base = (ent.attributes && ent.attributes.temperature) || 20;
          const next = Math.round((base + delta) * 10) / 10;
          optimisticMutate(climateId, (e) => { e.attributes.temperature = next; });
          callService('climate', 'set_temperature', climateId, { temperature: next });
        };
        const decBtn = glanceEl.querySelector('[data-temp-action="dec"]');
        const incBtn = glanceEl.querySelector('[data-temp-action="inc"]');
        decBtn.addEventListener('click', (ev) => { ev.stopPropagation(); stepClimateTarget(-0.5); });
        incBtn.addEventListener('click', (ev) => { ev.stopPropagation(); stepClimateTarget(0.5); });
      }
    }

    roomEl.addEventListener('click', (ev) => {
      if (document.body.classList.contains('llw-edit-mode')) return;
      if (ev.target.closest('.llw-room__gear')) return;
      if (!cfg.entities.length) return;
      openModal();
    });

    // --- Service calls (optimistic UI + reconcile shortly after) -------------
    function optimisticMutate(entityId, patchFn) {
      const e = liveEntities[entityId];
      if (!e) return;
      patchFn(e);
      renderCompact();
      if (activeModal) renderModalGroups();
    }

    async function callService(domain, service, entityId, extra) {
      try {
        await LL.api.post(`api/hass/service/${domain}/${service}`, { entity_id: entityId, ...(extra || {}) });
      } catch (err) {
        console.error(`[loudllama][room] service ${domain}.${service} failed`, err);
      } finally {
        setTimeout(() => {
          if (destroyed) return;
          fetchLiveEntities().then(() => {
            renderCompact();
            if (activeModal) renderModalGroups();
          });
        }, RECONCILE_DELAY_MS);
      }
    }

    // --- Fullscreen popup -----------------------------------------------------
    function stateLabel(key) {
      return t('room', `states.${key}`);
    }

    function securityStateKey(e) {
      const domain = domainOf(e.entity_id);
      if (domain === 'lock') return e.state === 'locked' ? 'locked' : 'unlocked';
      if (domain === 'alarm_control_panel') return e.state && stateLabel(e.state) !== e.state ? e.state : 'unknown';
      const dc = e.attributes && e.attributes.device_class;
      const isOn = e.state === 'on';
      if (OPENING_DEVICE_CLASSES.includes(dc)) return isOn ? 'open' : 'closed';
      return isOn ? 'detected' : 'clear';
    }

    // Custom label for this entity, scoped to this room (cfg.entityLabels),
    // falling back to its real Home Assistant friendly_name - used for
    // every entity row in the live room popup (sub-widgets get the same
    // label via syncSubWidgets() setting their own config.displayName).
    function displayName(entity) {
      const id = entity && entity.entity_id;
      if (id && cfg.entityLabels && cfg.entityLabels[id]) return cfg.entityLabels[id];
      return friendlyName(entity);
    }

    function rowHtml(entity) {
      const domain = domainOf(entity.entity_id);
      const name = escapeHtml(displayName(entity));
      const id = entity.entity_id;

      if (domain === 'light') {
        const isOn = entity.state === 'on';
        const hasBrightness = entity.attributes && entity.attributes.brightness !== undefined && entity.attributes.brightness !== null;
        const pct = hasBrightness ? Math.round(((entity.attributes.brightness || 0) / 255) * 100) : 0;
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main">
              <span class="llw-room__row-name">${name}</span>
              ${hasBrightness ? `<input type="range" class="llw-room__slider" min="1" max="100" value="${pct}" data-action="brightness" data-entity="${id}" ${isOn ? '' : 'disabled'} />` : ''}
            </div>
            <button type="button" class="llw-room__toggle ${isOn ? 'is-on' : ''}" data-action="toggle-light" data-entity="${id}" aria-label="${name}"></button>
          </div>`;
      }
      if (domain === 'switch' || domain === 'fan') {
        const isOn = entity.state === 'on';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
            <button type="button" class="llw-room__toggle ${isOn ? 'is-on' : ''}" data-action="${domain === 'fan' ? 'toggle-fan' : 'toggle-switch'}" data-entity="${id}" aria-label="${name}"></button>
          </div>`;
      }
      if (domain === 'lock') {
        const locked = entity.state === 'locked';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span><span class="llw-room__row-sub">${stateLabel(locked ? 'locked' : 'unlocked')}</span></div>
            <button type="button" class="llw-room__toggle ${locked ? 'is-on' : ''}" data-action="toggle-lock" data-entity="${id}" aria-label="${name}"></button>
          </div>`;
      }
      if (domain === 'cover') {
        const state = ['open', 'closed', 'opening', 'closing', 'stopped'].includes(entity.state) ? entity.state : 'unknown';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span><span class="llw-room__row-sub">${stateLabel(state)}</span></div>
            <div class="llw-room__icon-row">
              <button type="button" class="llw-room__icon-btn" data-action="cover-open" data-entity="${id}" title="${t('room', 'actions.open')}">▲</button>
              <button type="button" class="llw-room__icon-btn" data-action="cover-stop" data-entity="${id}" title="${t('room', 'actions.stop')}">■</button>
              <button type="button" class="llw-room__icon-btn" data-action="cover-close" data-entity="${id}" title="${t('room', 'actions.close')}">▼</button>
            </div>
          </div>`;
      }
      if (domain === 'climate') {
        const target = entity.attributes && entity.attributes.temperature;
        const current = entity.attributes && entity.attributes.current_temperature;
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main">
              <span class="llw-room__row-name">${name}</span>
              ${current !== undefined ? `<span class="llw-room__row-sub">${Math.round(current * 10) / 10}°</span>` : ''}
            </div>
            <div class="llw-room__stepper">
              <button type="button" data-action="climate-dec" data-entity="${id}" aria-label="-">−</button>
              <span class="llw-room__stepper-value">${target !== undefined ? `${Math.round(target * 10) / 10}°` : '--'}</span>
              <button type="button" data-action="climate-inc" data-entity="${id}" aria-label="+">+</button>
            </div>
          </div>`;
      }
      if (domain === 'media_player') {
        const playing = entity.state === 'playing';
        const stateKey = ['playing', 'paused', 'idle'].includes(entity.state) ? entity.state : 'idle';
        const vol = entity.attributes && entity.attributes.volume_level;
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main">
              <span class="llw-room__row-name">${name}</span>
              <span class="llw-room__row-sub">${stateLabel(stateKey)}</span>
              ${vol !== undefined ? `<input type="range" class="llw-room__slider" min="0" max="100" value="${Math.round(vol * 100)}" data-action="volume" data-entity="${id}" />` : ''}
            </div>
            <button type="button" class="llw-room__icon-btn" data-action="media-playpause" data-entity="${id}" title="${t('room', 'actions.playPause')}">${playing ? '⏸' : '▶'}</button>
          </div>`;
      }
      if (domain === 'vacuum') {
        const cleaning = entity.state === 'cleaning';
        const stateKey = ['cleaning', 'docked'].includes(entity.state) ? entity.state : 'idle';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span><span class="llw-room__row-sub">${stateLabel(stateKey)}</span></div>
            <button type="button" class="llw-room__icon-btn" data-action="vacuum-toggle" data-entity="${id}" title="${t('room', cleaning ? 'actions.stop' : 'actions.start')}">${cleaning ? '■' : '▶'}</button>
          </div>`;
      }
      if (domain === 'alarm_control_panel' || domain === 'binary_sensor') {
        const key = securityStateKey(entity);
        const alert = ['open', 'detected', 'unlocked'].includes(key);
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
            <span class="llw-room__badge ${alert ? 'llw-room__badge--alert' : 'llw-room__badge--ok'}">${stateLabel(key)}</span>
          </div>`;
      }
      if (domain === 'sensor') {
        const unit = (entity.attributes && entity.attributes.unit_of_measurement) || '';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
            <span class="llw-room__row-sub">${escapeHtml(entity.state)}${unit ? ` ${escapeHtml(unit)}` : ''}</span>
          </div>`;
      }
      if (domain === 'scene' || domain === 'script' || domain === 'button') {
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
            <button type="button" class="llw-room__run-btn" data-action="run" data-entity="${id}">${t('room', 'actions.run')}</button>
          </div>`;
      }
      if (domain === 'input_boolean') {
        const isOn = entity.state === 'on';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
            <button type="button" class="llw-room__toggle ${isOn ? 'is-on' : ''}" data-action="toggle-input-boolean" data-entity="${id}" aria-label="${name}"></button>
          </div>`;
      }
      return `
        <div class="llw-room__row">
          <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
          <span class="llw-room__row-sub">${escapeHtml(entity.state)}</span>
        </div>`;
    }

    // Light/climate/media entities are rendered as real sub-widgets in the
    // nested grid instead (see mountSubWidgets) - this only covers the
    // remaining domains (switches, covers, fans, locks, sensors, security,
    // scenes/scripts, ...), same simple row list as before.
    function renderModalGroups() {
      if (!activeModal) return;
      const other = activeModal.querySelector('.llw-room-modal__other');
      if (!other) return;
      const byGroup = {};
      cfg.entities.forEach((id) => {
        const g = categorize(liveEntities[id] || { entity_id: id, attributes: {} });
        if (SUBWIDGET_TYPE_BY_DOMAIN[domainOf(id)]) return; // has its own sub-widget above
        const e = liveEntities[id] || { entity_id: id, state: 'unknown', attributes: {} };
        (byGroup[g] = byGroup[g] || []).push(e);
      });
      other.innerHTML = GROUP_ORDER.filter((g) => byGroup[g] && byGroup[g].length)
        .map(
          (g) => `
          <div class="llw-room-modal__group">
            <div class="llw-room-modal__group-label">${GROUP_ICON[g]} ${t('room', `groups.${g}`)}</div>
            ${byGroup[g].map(rowHtml).join('')}
          </div>`
        )
        .join('');
    }

    function handleModalClick(ev) {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const entityId = btn.dataset.entity;
      const entity = liveEntities[entityId];
      if (!entity) return;

      if (action === 'toggle-light') {
        const on = entity.state !== 'on';
        optimisticMutate(entityId, (e) => { e.state = on ? 'on' : 'off'; });
        callService('light', on ? 'turn_on' : 'turn_off', entityId);
      } else if (action === 'toggle-switch') {
        const on = entity.state !== 'on';
        optimisticMutate(entityId, (e) => { e.state = on ? 'on' : 'off'; });
        callService('switch', on ? 'turn_on' : 'turn_off', entityId);
      } else if (action === 'toggle-fan') {
        const on = entity.state !== 'on';
        optimisticMutate(entityId, (e) => { e.state = on ? 'on' : 'off'; });
        callService('fan', on ? 'turn_on' : 'turn_off', entityId);
      } else if (action === 'toggle-input-boolean') {
        const on = entity.state !== 'on';
        optimisticMutate(entityId, (e) => { e.state = on ? 'on' : 'off'; });
        callService('input_boolean', on ? 'turn_on' : 'turn_off', entityId);
      } else if (action === 'toggle-lock') {
        const locking = entity.state !== 'locked';
        optimisticMutate(entityId, (e) => { e.state = locking ? 'locked' : 'unlocked'; });
        callService('lock', locking ? 'lock' : 'unlock', entityId);
      } else if (action === 'cover-open') {
        optimisticMutate(entityId, (e) => { e.state = 'opening'; });
        callService('cover', 'open_cover', entityId);
      } else if (action === 'cover-close') {
        optimisticMutate(entityId, (e) => { e.state = 'closing'; });
        callService('cover', 'close_cover', entityId);
      } else if (action === 'cover-stop') {
        optimisticMutate(entityId, (e) => { e.state = 'stopped'; });
        callService('cover', 'stop_cover', entityId);
      } else if (action === 'media-playpause') {
        const playing = entity.state !== 'playing';
        optimisticMutate(entityId, (e) => { e.state = playing ? 'playing' : 'paused'; });
        callService('media_player', 'media_play_pause', entityId);
      } else if (action === 'vacuum-toggle') {
        const cleaning = entity.state !== 'cleaning';
        optimisticMutate(entityId, (e) => { e.state = cleaning ? 'cleaning' : 'docked'; });
        callService('vacuum', cleaning ? 'start' : 'stop', entityId);
      } else if (action === 'climate-inc' || action === 'climate-dec') {
        const step = action === 'climate-inc' ? 0.5 : -0.5;
        const next = Math.round((((entity.attributes.temperature || 20) + step) * 10)) / 10;
        optimisticMutate(entityId, (e) => { e.attributes.temperature = next; });
        callService('climate', 'set_temperature', entityId, { temperature: next });
      } else if (action === 'run') {
        const domain = domainOf(entityId);
        callService(domain, 'turn_on', entityId);
      }
    }

    function handleModalInput(ev) {
      const elx = ev.target;
      const entityId = elx.dataset.entity;
      if (!entityId || !liveEntities[entityId]) return;
      if (elx.dataset.action === 'brightness') {
        optimisticMutate(entityId, (e) => { e.state = 'on'; e.attributes.brightness = Math.round((Number(elx.value) / 100) * 255); });
      } else if (elx.dataset.action === 'volume') {
        optimisticMutate(entityId, (e) => { e.attributes.volume_level = Number(elx.value) / 100; });
      }
    }

    function handleModalChange(ev) {
      const elx = ev.target;
      const entityId = elx.dataset.entity;
      if (!entityId) return;
      if (elx.dataset.action === 'brightness') {
        callService('light', 'turn_on', entityId, { brightness_pct: Number(elx.value) });
      } else if (elx.dataset.action === 'volume') {
        callService('media_player', 'volume_set', entityId, { volume_level: Number(elx.value) / 100 });
      }
    }

    function closeModal() {
      if (!activeModal) return;
      document.removeEventListener('keydown', onModalKeydown);
      subWidgetCleanups.forEach((fn) => { try { fn(); } catch (err) { /* ignore */ } });
      subWidgetCleanups = [];
      if (subGrid) {
        try { subGrid.destroy(false); } catch (err) { /* ignore */ }
        subGrid = null;
      }
      activeModal.remove();
      activeModal = null;
      arranging = false;
    }
    function onModalKeydown(ev) {
      if (ev.key === 'Escape') closeModal();
    }

    // Mounts every entry in cfg.subWidgets into the popup's own small
    // GridStack grid - each one via the *exact same* mount(el, {config,
    // saveConfig}) contract app.js uses for top-level widgets, so
    // Light/Climate/Media behave identically whether they're standalone on
    // the dashboard or nested in here.
    function mountSubWidgets(subGridEl) {
      subGrid = GridStack.init(
        {
          column: SUBGRID_COLUMNS,
          cellHeight: SUBGRID_CELL_HEIGHT,
          margin: 6,
          float: true,
          disableOneColumnMode: true,
          resizable: { handles: 'e, se, s, sw, w' },
        },
        subGridEl
      );
      subGrid.disable(); // starts in view mode, like the main dashboard

      cfg.subWidgets.forEach((sw) => {
        const def = LL.widgetTypes[sw.type];
        const tileEl = document.createElement('div');
        tileEl.className = 'grid-stack-item';
        tileEl.setAttribute('gs-id', sw.id);
        tileEl.setAttribute('gs-w', sw.w || 2);
        tileEl.setAttribute('gs-h', sw.h || 2);
        if (sw.x !== undefined && sw.y !== undefined) {
          tileEl.setAttribute('gs-x', sw.x);
          tileEl.setAttribute('gs-y', sw.y);
        } else {
          tileEl.setAttribute('gs-auto-position', 'true');
        }
        tileEl.innerHTML = `<div class="grid-stack-item-content llw-widget llw-room-subwidget"><div class="llw-body"></div></div>`;
        subGrid.addWidget(tileEl);

        const bodyEl = tileEl.querySelector('.llw-body');
        if (def) {
          def.mount(bodyEl, {
            config: sw.config || {},
            saveConfig(newConfig) {
              sw.config = newConfig;
              scheduleSaveRoom();
            },
          });
          if (typeof bodyEl._llwCleanup === 'function') subWidgetCleanups.push(bodyEl._llwCleanup);
        } else {
          bodyEl.innerHTML = `<div class="llw-error">${t('app', 'widgetNotInstalled')}</div>`;
        }
      });

      subGrid.on('change', () => {
        // Not using subGrid.save() here: GridStack always strips `.el` off
        // every node it returns (see gridstack.js save(), unconditional
        // `delete n.el`), so matching against node.id/node.el can never
        // work - this used to silently no-op every resize/drag, leaving
        // cfg.subWidgets' x/y/w/h frozen at their initial values forever.
        // Reading each live item's own `.gridstackNode` (kept current by
        // GridStack on every move/resize) is what app.js's serializeLayout
        // does for the same reason - same fix, same root cause.
        Array.from(subGrid.el.children).forEach((el) => {
          if (!el.classList.contains('grid-stack-item') || !el.gridstackNode) return;
          const node = el.gridstackNode;
          const sw = cfg.subWidgets.find((s) => s.id === node.id);
          if (sw) {
            sw.x = node.x;
            sw.y = node.y;
            sw.w = node.w;
            sw.h = node.h;
          }
        });
        scheduleSaveRoom();
      });
    }

    function setArranging(on) {
      arranging = on;
      if (!activeModal) return;
      activeModal.classList.toggle('llw-room-modal--arranging', arranging);
      const btn = activeModal.querySelector('.llw-room-modal__arrange');
      if (btn) btn.classList.toggle('is-active', arranging);
      if (subGrid) arranging ? subGrid.enable() : subGrid.disable();
    }

    function openModal() {
      closeModal();
      const hasSubWidgets = cfg.subWidgets.length > 0;
      const modal = document.createElement('div');
      modal.className = 'llw-room-modal';
      modal.innerHTML = `
        <div class="llw-room-modal__card">
          <div class="llw-room-modal__head">
            <span class="llw-room-modal__title">${escapeHtml(cfg.name)}</span>
            <div class="llw-room-modal__head-actions">
              ${hasSubWidgets ? `<button type="button" class="llw-room-modal__arrange" title="${t('room', 'arrange')}" aria-label="${t('room', 'arrange')}">✥</button>` : ''}
              <button type="button" class="llw-room-modal__close" aria-label="${t('room', 'close')}">×</button>
            </div>
          </div>
          <div class="llw-room-modal__body">
            ${hasSubWidgets ? '<div class="grid-stack llw-room-modal__subgrid"></div>' : ''}
            <div class="llw-room-modal__other"></div>
          </div>
        </div>
      `;
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeModal();
      });
      modal.querySelector('.llw-room-modal__close').addEventListener('click', closeModal);
      const arrangeBtn = modal.querySelector('.llw-room-modal__arrange');
      if (arrangeBtn) arrangeBtn.addEventListener('click', () => setArranging(!arranging));
      const other = modal.querySelector('.llw-room-modal__other');
      other.addEventListener('click', handleModalClick);
      other.addEventListener('input', handleModalInput);
      other.addEventListener('change', handleModalChange);
      document.body.appendChild(modal);
      document.addEventListener('keydown', onModalKeydown);
      activeModal = modal;

      const subGridEl = modal.querySelector('.llw-room-modal__subgrid');
      if (subGridEl) mountSubWidgets(subGridEl);

      renderModalGroups();
      fetchLiveEntities().then(() => renderModalGroups());
    }

    // --- Boot ------------------------------------------------------------------
    // cfg.subWidgets is null for a brand-new room, or for one saved before
    // sub-widgets existed - either way, derive it from cfg.entities once and
    // persist it, so upgrading never breaks an existing room.
    const isMigration = cfg.subWidgets === null && cfg.entities.length > 0;
    if (cfg.subWidgets === null) cfg.subWidgets = [];
    syncSubWidgets();
    ensureSubWidgetTypesLoaded().then(() => {
      if (isMigration && !destroyed) saveConfig(cfg);
    });

    if (!cfg.name || !cfg.entities.length) {
      openEditor();
      renderCompact();
    } else {
      renderCompact();
      startPolling();
    }

    el._llwCleanup = () => {
      destroyed = true;
      clearInterval(pollTimer);
      closeModal();
      closeEditor();
    };
  }

  LL.registerWidget('room', {
    name: { en: 'Room', da: 'Værelse', de: 'Raum', sv: 'Rum', no: 'Rom' },
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    defaultConfig: () => ({ name: '', entities: [] }),
    // See app.js's showSizePicker: offered as a choice right when the
    // widget is added, instead of free-dragging it to size afterward.
    sizeVariants: {
      full: {
        w: 2,
        h: 2,
        label: { en: 'Full', da: 'Fuld', de: 'Voll', sv: 'Full', no: 'Full' },
      },
      compact: {
        w: 1,
        h: 1,
        label: { en: 'Icon', da: 'Ikon', de: 'Symbol', sv: 'Ikon', no: 'Ikon' },
      },
    },
    mount,
  });
})();
