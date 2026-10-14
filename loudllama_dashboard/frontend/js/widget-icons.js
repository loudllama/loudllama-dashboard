/*
 * LoudLlama Dashboard - shared hand-drawn icon set.
 *
 * Room's icon picker (widgets/room/room.js) and Weather's per-condition
 * icons (widgets/weather/weather.js) have had their own small hand-built,
 * gradient-shaded SVGs for a while - a flat single-colour emoji reads as
 * "too cartoonish" next to the rest of the dashboard's shaded, dimensional
 * look (see room.js's own comment on exactly that). Every *other* icon in
 * the app - the widget-type glyphs in the "+ Add widget" picker/store/
 * Group's folder-stack preview, every widget's own gear button, the
 * per-entity-domain icons Room shows for its light/switch/climate/... groups,
 * Sensor's per-device-class icon, Shortcuts' scene-vs-script glyph, Weather's
 * humidity/wind readout, and the toolbar's Widgets/Kiosk buttons - was still
 * a plain platform emoji (🏠💡🌡️⚙️...), which looks inconsistent (a
 * different art style per OS/device) and visually flatter than Room/Weather's
 * own icons right next to it. This file is the same technique (64x64
 * viewBox, soft gradient fills, one shared contact-shadow ellipse so nothing
 * looks like it's floating) applied to every one of those remaining spots,
 * collected in one place instead of duplicated per widget file, since many
 * of them (the gear button alone appears in all 14 widgets) are identical
 * everywhere they're used.
 *
 * Every widget file is its own IIFE with no shared scope, so this attaches
 * to the same `window.LoudLlama` namespace every other shared module uses
 * (LL.api, LL.i18n, LL.registerWidget, ...) rather than being imported -
 * loaded in index.html right after widget-catalog.js and before app.js,
 * so it's ready both for app.js's own toolbar/picker icons and for any
 * lazily-loaded widget script, which always runs much later (only once
 * that widget is actually added to a page).
 */
(function () {
  const LL = (window.LoudLlama = window.LoudLlama || {});

  // Every id handed out has to be unique *across the whole document*, not
  // just within one icon - several copies of the same icon can end up
  // inline at once (a widget-type glyph in the add-menu's preview *and* the
  // same type sitting in Group's folder-stack preview *and* in the widget
  // store list, all at the same time), and a bare id like "boltGrad" reused
  // across them would make later instances silently hijack earlier ones'
  // gradients/filters. Same approach as room.js's nextRoomIconUid/
  // weather.js's nextIconUid, just shared here since every icon in this
  // file needs it.
  let iconUid = 0;
  function nextUid() {
    iconUid += 1;
    return `llwsi${iconUid}`;
  }

  function svg(inner) {
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
  }

  // The one bit of shading every icon below shares, so none of them look
  // like they're floating flat against whatever's behind them - identical
  // in spirit to room.js's roomIconShadow.
  function shadow(cx, cy, rx, ry) {
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="0.18"/>`;
  }

  // A soft diagonal highlight band, reused across most icons below for the
  // same "glossy plastic/enamel" look Room's icons already have (see e.g.
  // its couch/bed icons' translucent white rectangles) - a cheap way to get
  // a consistent shine without hand-placing a highlight shape per icon.
  function shine(x, y, w, h, rotate) {
    return `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${h}" fill="#fff" opacity="0.22" transform="rotate(${rotate} ${x} ${y})"/>`;
  }

  // --- Individual icon builders ----------------------------------------------
  // Each takes a uid (for its own <defs> ids) and returns inner SVG markup
  // (no outer <svg> wrapper - svg() above adds that once, at the call site).

  function iconHouse(uid) {
    const wallId = `${uid}w`, roofId = `${uid}r`;
    return `
      <defs>
        <linearGradient id="${wallId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffe8c2"/><stop offset="100%" stop-color="#f3c988"/>
        </linearGradient>
        <linearGradient id="${roofId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#e2654a"/><stop offset="100%" stop-color="#b8402b"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 20, 4)}
      <rect x="16" y="30" width="32" height="24" rx="2" fill="url(#${wallId})"/>
      <path d="M10 32 L32 12 L54 32 L48 32 L32 18 L16 32 Z" fill="url(#${roofId})"/>
      <rect x="27" y="40" width="10" height="14" rx="1.5" fill="#6b4226"/>
    `;
  }

  function iconWeather(uid) {
    const sunId = `${uid}s`, cloudId = `${uid}c`;
    return `
      <defs>
        <radialGradient id="${sunId}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#ffe59a"/><stop offset="100%" stop-color="#ffb53e"/>
        </radialGradient>
        <linearGradient id="${cloudId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#cdd8e3"/>
        </linearGradient>
      </defs>
      ${shadow(33, 54, 20, 4)}
      <circle cx="24" cy="24" r="12" fill="url(#${sunId})"/>
      <ellipse cx="36" cy="38" rx="20" ry="13" fill="url(#${cloudId})"/>
      <circle cx="24" cy="32" r="9" fill="url(#${cloudId})"/>
      ${shine(32, 32, 10, 4, -18)}
    `;
  }

  function iconBulb(uid) {
    const glassId = `${uid}g`;
    return `
      <defs>
        <radialGradient id="${glassId}" cx="40%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#fff6cf"/><stop offset="60%" stop-color="#ffd84d"/><stop offset="100%" stop-color="#e8a71a"/>
        </radialGradient>
      </defs>
      ${shadow(32, 56, 16, 4)}
      <path d="M32 10 C21 10 14 18 14 28 C14 36 19 40 22 44 L22 48 L42 48 L42 44 C45 40 50 36 50 28 C50 18 43 10 32 10 Z" fill="url(#${glassId})"/>
      <rect x="24" y="48" width="16" height="6" rx="1.5" fill="#8d8f93"/>
      <rect x="25" y="54" width="14" height="4" rx="1.5" fill="#6c6e72"/>
      <path d="M26 24 L32 32 L29 32 L34 40" stroke="#c9860a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.65"/>
      ${shine(25, 20, 5, 7, -20)}
    `;
  }

  function iconThermometer(uid) {
    const mercId = `${uid}m`;
    return `
      <defs>
        <linearGradient id="${mercId}" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#ff7a59"/><stop offset="100%" stop-color="#e13b2e"/>
        </linearGradient>
      </defs>
      ${shadow(30, 56, 14, 4)}
      <rect x="25" y="10" width="10" height="36" rx="5" fill="#eef2f6"/>
      <circle cx="30" cy="48" r="10" fill="#eef2f6"/>
      <rect x="27" y="22" width="6" height="24" rx="3" fill="url(#${mercId})"/>
      <circle cx="30" cy="48" r="7" fill="url(#${mercId})"/>
      <circle cx="18" cy="16" r="1.6" fill="#8d9aa3"/>
      <circle cx="18" cy="24" r="1.6" fill="#8d9aa3"/>
      <circle cx="18" cy="32" r="1.6" fill="#8d9aa3"/>
      ${shine(27, 16, 2, 10, 0)}
    `;
  }

  function iconSpeaker(uid) {
    const bodyId = `${uid}b`, waveId = `${uid}v`;
    return `
      <defs>
        <linearGradient id="${bodyId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8fa8d8"/><stop offset="100%" stop-color="#4a63a0"/>
        </linearGradient>
        <linearGradient id="${waveId}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#bfe3f5"/><stop offset="100%" stop-color="#7fd4ff"/>
        </linearGradient>
      </defs>
      ${shadow(30, 56, 16, 4)}
      <path d="M14 26 H24 L36 16 V48 L24 38 H14 Z" fill="url(#${bodyId})"/>
      <path d="M42 22 Q50 32 42 42" stroke="url(#${waveId})" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M46 16 Q58 32 46 48" stroke="url(#${waveId})" stroke-width="3.2" fill="none" stroke-linecap="round" opacity="0.7"/>
      ${shine(20, 24, 4, 7, -12)}
    `;
  }

  function iconCamera(uid) {
    const bodyId = `${uid}b`, lensId = `${uid}l`;
    return `
      <defs>
        <linearGradient id="${bodyId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#5a6472"/><stop offset="100%" stop-color="#30343b"/>
        </linearGradient>
        <radialGradient id="${lensId}" cx="38%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#7fd4ff"/><stop offset="60%" stop-color="#2f8fc2"/><stop offset="100%" stop-color="#17445c"/>
        </radialGradient>
      </defs>
      ${shadow(32, 54, 20, 4)}
      <rect x="10" y="20" width="44" height="28" rx="6" fill="url(#${bodyId})"/>
      <rect x="22" y="12" width="20" height="10" rx="3" fill="url(#${bodyId})"/>
      <circle cx="32" cy="34" r="11" fill="url(#${lensId})"/>
      <circle cx="32" cy="34" r="5" fill="#0c1116"/>
      <circle cx="47" cy="25" r="2.2" fill="#ff6b6b"/>
      ${shine(27, 29, 3, 5, -20)}
    `;
  }

  function iconChart(uid) {
    const barId = `${uid}b`;
    return `
      <defs>
        <linearGradient id="${barId}" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#3fcf8e"/><stop offset="100%" stop-color="#22a06b"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 20, 4)}
      <rect x="12" y="34" width="10" height="20" rx="2" fill="url(#${barId})" opacity="0.75"/>
      <rect x="27" y="22" width="10" height="32" rx="2" fill="url(#${barId})"/>
      <rect x="42" y="12" width="10" height="42" rx="2" fill="url(#${barId})" opacity="0.9"/>
      <path d="M12 30 L27 18 L42 10" stroke="#c7f3dc" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    `;
  }

  function iconStack(uid) {
    const aId = `${uid}a`, bId = `${uid}b`, cId = `${uid}c`;
    return `
      <defs>
        <linearGradient id="${aId}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#b79cf2"/><stop offset="100%" stop-color="#8a63d6"/></linearGradient>
        <linearGradient id="${bId}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f6a9c0"/><stop offset="100%" stop-color="#d9638f"/></linearGradient>
        <linearGradient id="${cId}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#7fd4ff"/><stop offset="100%" stop-color="#2f8fc2"/></linearGradient>
      </defs>
      ${shadow(32, 56, 20, 4)}
      <rect x="12" y="26" width="20" height="20" rx="4" fill="url(#${aId})" transform="rotate(-8 22 36)"/>
      <rect x="32" y="26" width="20" height="20" rx="4" fill="url(#${bId})" transform="rotate(8 42 36)"/>
      <rect x="22" y="14" width="20" height="20" rx="4" fill="url(#${cId})"/>
      ${shine(28, 20, 4, 6, -16)}
    `;
  }

  function iconClockFace(uid) {
    const faceId = `${uid}f`;
    return `
      <defs>
        <radialGradient id="${faceId}" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#dfe6ee"/>
        </radialGradient>
      </defs>
      ${shadow(32, 56, 18, 4)}
      <circle cx="32" cy="32" r="22" fill="#3a4250"/>
      <circle cx="32" cy="32" r="18" fill="url(#${faceId})"/>
      <line x1="32" y1="32" x2="32" y2="19" stroke="#2b2f36" stroke-width="2.6" stroke-linecap="round"/>
      <line x1="32" y1="32" x2="41" y2="35" stroke="#2b2f36" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="32" cy="32" r="2.4" fill="#e2654a"/>
      ${shine(26, 24, 4, 6, -20)}
    `;
  }

  function iconSlate(uid) {
    const boardId = `${uid}b`;
    return `
      <defs>
        <linearGradient id="${boardId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#5a6472"/><stop offset="100%" stop-color="#30343b"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 20, 4)}
      <rect x="10" y="26" width="44" height="24" rx="3" fill="url(#${boardId})"/>
      <path d="M10 26 L16 14 L24 14 L19 26 Z" fill="#ffd166"/>
      <path d="M22 26 L28 14 L36 14 L31 26 Z" fill="#30343b"/>
      <path d="M34 26 L40 14 L48 14 L43 26 Z" fill="#ffd166"/>
      <rect x="10" y="22" width="44" height="6" fill="#1c1e21"/>
      <rect x="14" y="34" width="36" height="3" rx="1.5" fill="#fff" opacity="0.25"/>
      <rect x="14" y="41" width="24" height="3" rx="1.5" fill="#fff" opacity="0.25"/>
    `;
  }

  function iconPeople(uid) {
    const aId = `${uid}a`, bId = `${uid}b`;
    return `
      <defs>
        <linearGradient id="${aId}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#7fd4ff"/><stop offset="100%" stop-color="#2f8fc2"/></linearGradient>
        <linearGradient id="${bId}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#f6a9c0"/><stop offset="100%" stop-color="#d9638f"/></linearGradient>
      </defs>
      ${shadow(32, 56, 20, 4)}
      <circle cx="24" cy="24" r="9" fill="url(#${aId})"/>
      <path d="M10 50 C10 38 16 32 24 32 C32 32 38 38 38 50 Z" fill="url(#${aId})"/>
      <circle cx="42" cy="27" r="8" fill="url(#${bId})"/>
      <path d="M30 52 C30 42 35 37 42 37 C49 37 54 42 54 52 Z" fill="url(#${bId})"/>
    `;
  }

  function iconBolt(uid) {
    const boltId = `${uid}b`;
    return `
      <defs>
        <linearGradient id="${boltId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffe066"/><stop offset="100%" stop-color="#ffb300"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 14, 4)}
      <path d="M36 8 L16 36 L28 36 L24 56 L48 28 L34 28 Z" fill="url(#${boltId})"/>
      ${shine(28, 20, 3, 6, -24)}
    `;
  }

  function iconShield(uid) {
    const shieldId = `${uid}s`;
    return `
      <defs>
        <linearGradient id="${shieldId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#5fd6a8"/><stop offset="100%" stop-color="#1f9c6c"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 15, 4)}
      <path d="M32 8 L50 15 V30 C50 42 42 50 32 55 C22 50 14 42 14 30 V15 Z" fill="url(#${shieldId})"/>
      <rect x="25" y="28" width="14" height="12" rx="2.5" fill="#1c3a2e"/>
      <path d="M28 28 V24 C28 20.5 29.8 18 32 18 C34.2 18 36 20.5 36 24 V28" stroke="#1c3a2e" stroke-width="2.6" fill="none"/>
      <circle cx="32" cy="33" r="2" fill="#5fd6a8"/>
      ${shine(25, 18, 4, 6, -18)}
    `;
  }

  function iconChecklist(uid) {
    const paperId = `${uid}p`;
    return `
      <defs>
        <linearGradient id="${paperId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#dfe6ee"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 17, 4)}
      <rect x="15" y="10" width="34" height="44" rx="3" fill="url(#${paperId})"/>
      <rect x="23" y="7" width="18" height="7" rx="2" fill="#8d9aa3"/>
      <rect x="20" y="22" width="4" height="4" rx="1" fill="#3fcf8e"/>
      <rect x="27" y="22" width="16" height="3" rx="1.5" fill="#9aa5b1"/>
      <rect x="20" y="32" width="4" height="4" rx="1" fill="#3fcf8e"/>
      <rect x="27" y="32" width="16" height="3" rx="1.5" fill="#9aa5b1"/>
      <rect x="20" y="42" width="4" height="4" rx="1" fill="none" stroke="#9aa5b1" stroke-width="1.4"/>
      <rect x="27" y="42" width="12" height="3" rx="1.5" fill="#c7cfd8"/>
    `;
  }

  function iconGear(uid) {
    const gearId = `${uid}g`;
    let teeth = '';
    for (let i = 0; i < 8; i += 1) {
      const angle = (i * 360) / 8;
      teeth += `<rect x="29" y="4" width="6" height="12" rx="2" fill="url(#${gearId})" transform="rotate(${angle} 32 32)"/>`;
    }
    return `
      <defs>
        <linearGradient id="${gearId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#cfd8de"/><stop offset="100%" stop-color="#8d9aa3"/>
        </linearGradient>
      </defs>
      ${teeth}
      <circle cx="32" cy="32" r="18" fill="url(#${gearId})"/>
      <circle cx="32" cy="32" r="7" fill="#454a52"/>
      ${shine(26, 24, 4, 6, -18)}
    `;
  }

  function iconPlug(uid) {
    const plugId = `${uid}p`;
    return `
      <defs>
        <linearGradient id="${plugId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#cfd8de"/><stop offset="100%" stop-color="#8d9aa3"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 16, 4)}
      <rect x="20" y="24" width="24" height="20" rx="6" fill="url(#${plugId})"/>
      <rect x="26" y="14" width="4" height="14" rx="2" fill="#454a52"/>
      <rect x="34" y="14" width="4" height="14" rx="2" fill="#454a52"/>
      <rect x="28" y="44" width="8" height="12" rx="2" fill="#454a52"/>
      <path d="M30 48 L25 54 L30 54 L27 60" stroke="#ffd166" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    `;
  }

  function iconBlinds(uid) {
    const slatId = `${uid}s`;
    const slats = [0, 1, 2, 3, 4].map((i) => `<rect x="14" y="${16 + i * 7}" width="36" height="4.5" rx="2" fill="url(#${slatId})" opacity="${0.75 + i * 0.05}"/>`).join('');
    return `
      <defs>
        <linearGradient id="${slatId}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#bfe3f5"/><stop offset="100%" stop-color="#6fa8c9"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 18, 4)}
      <rect x="12" y="12" width="40" height="4" rx="2" fill="#455059"/>
      ${slats}
      <rect x="30" y="51" width="4" height="7" rx="1.5" fill="#455059"/>
    `;
  }

  function iconFan(uid) {
    const bladeId = `${uid}b`;
    const blades = [0, 120, 240].map((a) => `<ellipse cx="32" cy="20" rx="7" ry="13" fill="url(#${bladeId})" transform="rotate(${a} 32 32)"/>`).join('');
    return `
      <defs>
        <linearGradient id="${bladeId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#9fe8e0"/><stop offset="100%" stop-color="#4bb8ac"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 16, 4)}
      ${blades}
      <circle cx="32" cy="32" r="6" fill="#30343b"/>
      ${shine(26, 20, 3, 5, -20)}
    `;
  }

  function iconVacuum(uid) {
    const bodyId = `${uid}b`;
    return `
      <defs>
        <radialGradient id="${bodyId}" cx="40%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#6b6f76"/><stop offset="100%" stop-color="#2d3034"/>
        </radialGradient>
      </defs>
      ${shadow(32, 56, 20, 4)}
      <circle cx="32" cy="34" r="20" fill="url(#${bodyId})"/>
      <circle cx="32" cy="34" r="10" fill="#1c1e21"/>
      <circle cx="32" cy="34" r="4" fill="#7fd4ff"/>
      <circle cx="46" cy="24" r="2.4" fill="#ff6b6b"/>
      ${shine(24, 24, 5, 8, -20)}
    `;
  }

  function iconDroplet(uid) {
    const dropId = `${uid}d`;
    return `
      <defs>
        <linearGradient id="${dropId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#bfe3f5"/><stop offset="100%" stop-color="#3f8fc4"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 14, 4)}
      <path d="M32 10 C42 26 48 34 48 42 C48 51 40.8 56 32 56 C23.2 56 16 51 16 42 C16 34 22 26 32 10 Z" fill="url(#${dropId})"/>
      ${shine(26, 34, 4, 8, -14)}
    `;
  }

  function iconBattery(uid) {
    const fillId = `${uid}f`;
    return `
      <defs>
        <linearGradient id="${fillId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#7fe8a8"/><stop offset="100%" stop-color="#2fae63"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 16, 4)}
      <rect x="16" y="18" width="32" height="34" rx="5" fill="#eef2f6"/>
      <rect x="26" y="10" width="12" height="8" rx="2" fill="#8d9aa3"/>
      <rect x="20" y="34" width="24" height="14" rx="2.5" fill="url(#${fillId})"/>
      <rect x="20" y="24" width="24" height="6" rx="2" fill="url(#${fillId})" opacity="0.6"/>
    `;
  }

  function iconCompass(uid) {
    const faceId = `${uid}f`;
    return `
      <defs>
        <radialGradient id="${faceId}" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#dfe6ee"/>
        </radialGradient>
      </defs>
      ${shadow(32, 56, 18, 4)}
      <circle cx="32" cy="32" r="22" fill="#455059"/>
      <circle cx="32" cy="32" r="18" fill="url(#${faceId})"/>
      <path d="M32 20 L37 32 L32 44 L27 32 Z" fill="#e2654a"/>
      <circle cx="32" cy="32" r="2.4" fill="#2b2f36"/>
      ${shine(26, 24, 4, 6, -20)}
    `;
  }

  function iconFlame(uid) {
    const flameId = `${uid}f`;
    return `
      <defs>
        <linearGradient id="${flameId}" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#ff9d2e"/><stop offset="60%" stop-color="#ff5a3c"/><stop offset="100%" stop-color="#ffd166"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 14, 4)}
      <path d="M32 8 C24 20 18 28 18 38 C18 49 24 56 32 56 C40 56 46 49 46 38 C46 32 43 28 40 25 C40 32 36 35 33 32 C30 29 32 22 32 8 Z" fill="url(#${flameId})"/>
      ${shine(30, 40, 4, 8, -10)}
    `;
  }

  function iconBubbles(uid) {
    const bId = `${uid}b`;
    return `
      <defs>
        <radialGradient id="${bId}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#d4f5f2"/><stop offset="100%" stop-color="#6fcfc4"/>
        </radialGradient>
      </defs>
      ${shadow(32, 56, 16, 4)}
      <circle cx="26" cy="36" r="14" fill="url(#${bId})"/>
      <circle cx="42" cy="26" r="9" fill="url(#${bId})"/>
      <circle cx="44" cy="44" r="6" fill="url(#${bId})"/>
      ${shine(21, 30, 3, 5, -18)}
    `;
  }

  function iconWindSwirl(uid) {
    const wId = `${uid}w`;
    return `
      <defs>
        <linearGradient id="${wId}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#bfe3f5"/><stop offset="100%" stop-color="#4fa9d8"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 18, 4)}
      <path d="M10 24 H40 Q48 24 48 17 Q48 10 41 10 Q35 10 34 16" stroke="url(#${wId})" stroke-width="4.5" fill="none" stroke-linecap="round"/>
      <path d="M10 34 H48 Q56 34 56 27 Q56 20 49 20" stroke="url(#${wId})" stroke-width="4.5" fill="none" stroke-linecap="round" opacity="0.85"/>
      <path d="M10 44 H34 Q42 44 42 37 Q42 30 35 30" stroke="url(#${wId})" stroke-width="4.5" fill="none" stroke-linecap="round" opacity="0.7"/>
    `;
  }

  function iconRainCloud(uid) {
    const cloudId = `${uid}c`, dropId = `${uid}d`;
    const drops = [0, 1, 2].map((i) => `<path d="M${22 + i * 10} 44 C${24 + i * 10} 48 ${24 + i * 10} 51 ${22 + i * 10} 54 C${20 + i * 10} 51 ${20 + i * 10} 48 ${22 + i * 10} 44 Z" fill="url(#${dropId})"/>`).join('');
    return `
      <defs>
        <linearGradient id="${cloudId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#cdd8e3"/><stop offset="100%" stop-color="#8d9aa3"/>
        </linearGradient>
        <linearGradient id="${dropId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#bfe3f5" stop-opacity="0.5"/><stop offset="100%" stop-color="#4fa9d8"/>
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="26" rx="20" ry="13" fill="url(#${cloudId})"/>
      ${drops}
      ${shadow(32, 58, 18, 3)}
    `;
  }

  function iconSignalBars(uid) {
    const barId = `${uid}b`;
    return `
      <defs>
        <linearGradient id="${barId}" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#7fe8a8"/><stop offset="100%" stop-color="#2fae63"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 18, 4)}
      <rect x="14" y="38" width="9" height="14" rx="2" fill="url(#${barId})" opacity="0.6"/>
      <rect x="27" y="28" width="9" height="24" rx="2" fill="url(#${barId})" opacity="0.8"/>
      <rect x="40" y="16" width="9" height="36" rx="2" fill="url(#${barId})"/>
    `;
  }

  function iconPlayButton(uid) {
    const ringId = `${uid}r`;
    return `
      <defs>
        <radialGradient id="${ringId}" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stop-color="#7fd4ff"/><stop offset="100%" stop-color="#2f8fc2"/>
        </radialGradient>
      </defs>
      ${shadow(32, 56, 17, 4)}
      <circle cx="32" cy="32" r="22" fill="url(#${ringId})"/>
      <path d="M26 20 L46 32 L26 44 Z" fill="#fff"/>
      ${shine(25, 24, 4, 6, -18)}
    `;
  }

  function iconPuzzle(uid) {
    const pieceId = `${uid}p`;
    return `
      <defs>
        <linearGradient id="${pieceId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#b79cf2"/><stop offset="100%" stop-color="#8a63d6"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 18, 4)}
      <path d="M20 14 H30 C30 10 33 8 36 10 C39 12 39 16 36 18 V14 H46 V24 C50 24 52 27 50 30 C48 33 44 33 42 30 V34 H46 V44 H36 V40 C39 42 39 46 36 48 C33 50 30 48 30 44 V44 H20 V34 C16 36 12 34 12 30 C12 26 16 24 20 26 V14 Z" fill="url(#${pieceId})"/>
      ${shine(24, 22, 4, 6, -20)}
    `;
  }

  function iconMonitor(uid) {
    const screenId = `${uid}s`;
    return `
      <defs>
        <linearGradient id="${screenId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#7fd4ff"/><stop offset="100%" stop-color="#2f8fc2"/>
        </linearGradient>
      </defs>
      ${shadow(32, 56, 18, 4)}
      <rect x="10" y="12" width="44" height="30" rx="3" fill="#30343b"/>
      <rect x="13" y="15" width="38" height="24" rx="1.5" fill="url(#${screenId})"/>
      <rect x="27" y="42" width="10" height="8" fill="#45484e"/>
      <rect x="18" y="50" width="28" height="4" rx="2" fill="#5a5e65"/>
      ${shine(22, 20, 5, 7, -16)}
    `;
  }

  // --- Public lookups ---------------------------------------------------------

  // One per widget *type* - shared by the "+ Add widget" size-picker preview
  // (app.js's showSizePicker), the widget store's list (store.js), and
  // Group's "folder stack" compact preview (group.js), which all used to
  // keep their own separate (and inconsistent - store.js and group.js each
  // only covered a handful of ids, falling back to a generic 🧩 for the
  // rest) emoji map for exactly the same concept.
  const WIDGET_TYPE_ICON = {
    room: iconHouse, weather: iconWeather, light: iconBulb, climate: iconThermometer,
    media: iconSpeaker, frigate: iconCamera, sensor: iconChart, group: iconStack,
    clock: iconClockFace, shortcuts: iconSlate, people: iconPeople, energy: iconBolt,
    alarm: iconShield, todo: iconChecklist,
  };

  // Room's own per-entity-domain group icon (GROUP_ICON in room.js) - shown
  // next to "Lights", "Climate", etc inside a room's editor/glance chips/
  // fullscreen modal. Reuses the same drawings as WIDGET_TYPE_ICON wherever
  // the concept is identical (a light's category icon and the Light
  // widget's own icon should look like the same bulb, not two different
  // ones) rather than drawing a second bulb/thermometer/speaker from
  // scratch.
  const CATEGORY_ICON = {
    light: iconBulb, switch: iconPlug, climate: iconThermometer, cover: iconBlinds,
    fan: iconFan, media: iconSpeaker, vacuum: iconVacuum, security: iconShield,
    sensor: iconChart, other: iconGear,
  };

  // Sensor widget's per-device_class icon (DEVICE_CLASS_ICON in sensor.js).
  // Several device classes share one drawing on purpose - power/current/
  // voltage are all "electricity", so they get the same bolt a real
  // multimeter-style reading would; humidity and moisture are both "water
  // level", so they share the droplet.
  const SENSOR_CLASS_ICON = {
    temperature: iconThermometer, humidity: iconDroplet, power: iconBolt,
    energy: iconBolt, battery: iconBattery, illuminance: iconBulb,
    pressure: iconCompass, gas: iconFlame, current: iconBolt, voltage: iconBolt,
    co2: iconBubbles, carbon_dioxide: iconBubbles, moisture: iconDroplet,
    wind_speed: iconWindSwirl, precipitation: iconRainCloud, signal_strength: iconSignalBars,
  };
  const SENSOR_DEFAULT_ICON = iconChart;

  function svgFor(builder) {
    return svg(builder(nextUid()));
  }

  LL.icons = {
    // A widget-type id (room/weather/light/... - same ids WIDGETS/
    // widget-catalog.js use) -> that type's icon, or null if there's no
    // dedicated drawing for it (callers keep their own final fallback,
    // same as before - this only replaces what used to be a per-map emoji
    // lookup with a per-map SVG-builder lookup).
    widgetType(id) {
      const builder = WIDGET_TYPE_ICON[id];
      return builder ? svgFor(builder) : null;
    },
    // Room's per-entity-domain category icon.
    category(key) {
      const builder = CATEGORY_ICON[key] || CATEGORY_ICON.other;
      return svgFor(builder);
    },
    // Sensor's per-device_class icon (falls back to the same generic chart
    // DEFAULT_ICON used to be).
    sensorClass(deviceClass) {
      const builder = SENSOR_CLASS_ICON[deviceClass] || SENSOR_DEFAULT_ICON;
      return svgFor(builder);
    },
    // Shared by every widget's own gear/settings button (⚙ before this).
    gear() { return svgFor(iconGear); },
    // Shortcuts' per-item icon: a script entity gets the play-button glyph,
    // everything else (scenes, mainly) gets the movie-slate.
    shortcut(isScript) { return svgFor(isScript ? iconPlayButton : iconSlate); },
    droplet() { return svgFor(iconDroplet); },
    windSwirl() { return svgFor(iconWindSwirl); },
    puzzle() { return svgFor(iconPuzzle); },
    monitor() { return svgFor(iconMonitor); },
  };
})();
