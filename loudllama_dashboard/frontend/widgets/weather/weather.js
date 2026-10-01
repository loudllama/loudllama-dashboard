/*
 * LoudLlama Dashboard - Weather widget.
 *
 * - Pulls live data from a Home Assistant `weather.*` entity via the
 *   backend's HA proxy.
 * - All text automatically follows Home Assistant's configured language
 *   (see js/i18n.js) - nothing here is hardcoded to a single locale.
 * - The widget's background is generated (gradient + animated SVG/CSS
 *   particles), not a static photo, so it always matches the *current*
 *   condition reported by HA without shipping/downloading image assets.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const KNOWN_CONDITIONS = [
    'clear-night', 'cloudy', 'exceptional', 'fog', 'hail', 'lightning',
    'lightning-rainy', 'partlycloudy', 'pouring', 'rainy', 'snowy',
    'snowy-rainy', 'sunny', 'windy', 'windy-variant',
  ];

  const POLL_MS = 60 * 1000;

  function normalizeCondition(condition) {
    return KNOWN_CONDITIONS.includes(condition) ? condition : 'unknown';
  }

  function conditionLabel(condition) {
    return t('weather', `conditions.${normalizeCondition(condition)}`);
  }

  // --- Icons ---------------------------------------------------------------
  // Small hand-built SVG icon per condition family - no external image
  // files, so the add-on has zero runtime dependency on the internet or
  // bundled photo assets. Each icon gets its own <defs> (gradients/soft
  // shadow) scoped with a per-call unique id suffix, since several of these
  // can end up inline in the same document at once (the main icon plus a
  // handful of small forecast-strip icons, and possibly more than one
  // weather widget on the dashboard) - SVG ids are global to the document,
  // so reusing a bare id like "sunGrad" across instances would make later
  // ones silently hijack earlier ones' gradients.
  let iconUid = 0;
  function nextIconUid() {
    iconUid += 1;
    return `llwic${iconUid}`;
  }

  function iconSvg(condition) {
    const c = normalizeCondition(condition);
    const uid = nextIconUid();
    const sun = sunMarkup(uid, 32, 32, 1);
    const moon = moonMarkup(uid, 32, 32, 1);
    const cloud = cloudMarkup(uid, 32, 36, 1);
    const cloudSun = sunMarkup(uid, 24, 24, 0.62) + cloudMarkup(uid, 35, 40, 0.92);
    const rain = cloudMarkup(uid, 32, 28, 0.88) + dropsMarkup(uid, 3);
    const pouring = cloudMarkup(uid, 32, 26, 0.98) + dropsMarkup(uid, 5);
    const snow = cloudMarkup(uid, 32, 28, 0.88) + flakesMarkup(4);
    const sleet = cloudMarkup(uid, 32, 28, 0.88) + dropsMarkup(uid, 2) + flakesMarkup(2);
    const storm = cloudMarkup(uid, 32, 26, 0.98) + boltMarkup(uid);
    const stormRain = storm + dropsMarkup(uid, 2);
    const fog = fogMarkup();
    const wind = windMarkup(uid);
    const hail = cloudMarkup(uid, 32, 28, 0.88) + hailMarkup();
    const alertIcon = alertMarkup(uid);

    const byCondition = {
      sunny: sun,
      'clear-night': moon,
      partlycloudy: cloudSun,
      cloudy: cloud,
      rainy: rain,
      pouring: pouring,
      snowy: snow,
      'snowy-rainy': sleet,
      lightning: storm,
      'lightning-rainy': stormRain,
      fog: fog,
      windy: wind,
      'windy-variant': wind,
      hail: hail,
      exceptional: alertIcon,
      unknown: cloud,
    };

    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${byCondition[c]}</svg>`;
  }

  function sunMarkup(uid, cx, cy, scale) {
    const gradId = `${uid}sun`;
    const glowId = `${uid}sunGlow`;
    const coreId = `${uid}sunCore`;
    let rays = '';
    for (let i = 0; i < 12; i += 1) {
      const long = i % 3 === 0;
      const len = long ? 13 : 8;
      const w = long ? 3.2 : 2;
      const op = long ? 0.9 : 0.55;
      const angle = (i * 360) / 12;
      rays += `<line x1="0" y1="${-21 * scale}" x2="0" y2="${-(21 + len) * scale}" stroke="url(#${gradId})" stroke-width="${w}" stroke-linecap="round" opacity="${op}" transform="translate(${cx} ${cy}) rotate(${angle})"/>`;
    }
    return `
      <defs>
        <radialGradient id="${gradId}" cx="36%" cy="30%" r="72%">
          <stop offset="0%" stop-color="#fffceb"/>
          <stop offset="35%" stop-color="#ffe59a"/>
          <stop offset="70%" stop-color="#ffc247"/>
          <stop offset="100%" stop-color="#ff9d2e"/>
        </radialGradient>
        <radialGradient id="${glowId}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffd166" stop-opacity="0.5"/>
          <stop offset="55%" stop-color="#ffd166" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#ffd166" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${coreId}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fff6d8" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#fff6d8" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="${30 * scale}" fill="url(#${glowId})"/>
      ${rays}
      <circle cx="${cx}" cy="${cy}" r="${15.5 * scale}" fill="url(#${gradId})"/>
      <circle cx="${cx - 3 * scale}" cy="${cy - 4 * scale}" r="${6 * scale}" fill="url(#${coreId})"/>
      <ellipse cx="${cx - 4.5 * scale}" cy="${cy - 5.5 * scale}" rx="${5.5 * scale}" ry="${3 * scale}" fill="#fff" opacity="0.5"/>
    `;
  }

  function moonMarkup(uid, cx, cy, scale) {
    const gradId = `${uid}moon`;
    const glowId = `${uid}moonGlow`;
    const shadeId = `${uid}moonShade`;
    return `
      <defs>
        <linearGradient id="${gradId}" x1="15%" y1="10%" x2="90%" y2="95%">
          <stop offset="0%" stop-color="#fffef8"/>
          <stop offset="55%" stop-color="#f1ecd6"/>
          <stop offset="100%" stop-color="#d8d0ae"/>
        </linearGradient>
        <radialGradient id="${glowId}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#eae6d2" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="#eae6d2" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="${shadeId}" cx="30%" cy="30%" r="80%">
          <stop offset="0%" stop-color="#000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#8f8968" stop-opacity="0.35"/>
        </radialGradient>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="${26 * scale}" fill="url(#${glowId})"/>
      <mask id="${uid}moonMask">
        <rect x="${cx - 26 * scale}" y="${cy - 26 * scale}" width="${52 * scale}" height="${52 * scale}" fill="#fff"/>
        <circle cx="${cx + 7.5 * scale}" cy="${cy - 6.5 * scale}" r="${13 * scale}" fill="#000"/>
      </mask>
      <g mask="url(#${uid}moonMask)">
        <circle cx="${cx}" cy="${cy}" r="${15.5 * scale}" fill="url(#${gradId})"/>
        <circle cx="${cx}" cy="${cy}" r="${15.5 * scale}" fill="url(#${shadeId})"/>
        <circle cx="${cx - 5.5 * scale}" cy="${cy + 4.5 * scale}" r="${2.2 * scale}" fill="#a79c72" opacity="0.28"/>
        <circle cx="${cx - 1 * scale}" cy="${cy - 6 * scale}" r="${1.4 * scale}" fill="#a79c72" opacity="0.25"/>
        <circle cx="${cx + 3 * scale}" cy="${cy + 7 * scale}" r="${1 * scale}" fill="#a79c72" opacity="0.22"/>
      </g>
    `;
  }

  function cloudMarkup(uid, cx, cy, scale) {
    const gradId = `${uid}cloud`;
    const gradBackId = `${uid}cloudBack`;
    const blurId = `${uid}cloudBlur`;
    const x = cx - 32 * scale;
    const y = cy - 20 * scale;
    return `
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="60%" stop-color="#eef2f6"/>
          <stop offset="100%" stop-color="#cfd8e0"/>
        </linearGradient>
        <linearGradient id="${gradBackId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#c3cdd8"/>
          <stop offset="100%" stop-color="#a7b3c0"/>
        </linearGradient>
        <filter id="${blurId}" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.2"/>
        </filter>
      </defs>
      <g transform="translate(${x + 2.2 * scale},${y + 3.4 * scale}) scale(${scale})" opacity="0.32" filter="url(#${blurId})">
        <ellipse cx="22" cy="27" rx="15" ry="10" fill="#060c16"/>
        <ellipse cx="36" cy="23" rx="17" ry="13" fill="#060c16"/>
        <rect x="16" y="27" width="40" height="11" rx="5.5" fill="#060c16"/>
      </g>
      <g transform="translate(${x},${y}) scale(${scale})">
        <ellipse cx="19" cy="25" rx="13" ry="9" fill="url(#${gradBackId})"/>
        <ellipse cx="20" cy="24" rx="14" ry="10" fill="url(#${gradId})"/>
        <ellipse cx="34" cy="20" rx="16" ry="12" fill="url(#${gradId})"/>
        <ellipse cx="46" cy="26" rx="12" ry="9" fill="url(#${gradId})"/>
        <rect x="14" y="24" width="40" height="12" rx="6" fill="url(#${gradId})"/>
        <ellipse cx="30" cy="15" rx="9" ry="4.2" fill="#fff" opacity="0.8"/>
        <ellipse cx="44" cy="19" rx="5" ry="2.4" fill="#fff" opacity="0.55"/>
      </g>
    `;
  }

  function dropsMarkup(uid, count) {
    const gradId = `${uid}drop`;
    let out = `<defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#d6ecfc" stop-opacity="0.25"/>
      <stop offset="45%" stop-color="#9fd0f5"/>
      <stop offset="100%" stop-color="#5ba6e0"/>
    </linearGradient></defs>`;
    for (let i = 0; i < count; i += 1) {
      const x = 20 + i * (count > 4 ? 6 : 8);
      // Teardrop: a circle with a small pointed tip, plus a tiny glint, not
      // just a stroked line.
      out += `<path d="M${x} 40 C${x + 3.5} 46 ${x + 3.5} 50.5 ${x} 53 C${x - 3.5} 50.5 ${x - 3.5} 46 ${x} 40 Z" fill="url(#${gradId})"/>`;
      out += `<ellipse cx="${x - 1.1}" cy="46.5" rx="0.9" ry="1.6" fill="#fff" opacity="0.6"/>`;
    }
    return out;
  }

  function flakesMarkup(count) {
    let out = '';
    for (let i = 0; i < count; i += 1) {
      const x = 20 + i * 8;
      const y = 46 + (i % 2) * 6;
      const s = 1 + (i % 3) * 0.15;
      out += `<g stroke="#ffffff" stroke-width="1.1" stroke-linecap="round" transform="translate(${x} ${y}) scale(${s})" opacity="0.95">
        <line x1="-3.4" y1="0" x2="3.4" y2="0"/>
        <line x1="-1.7" y1="-3" x2="1.7" y2="3"/>
        <line x1="-1.7" y1="3" x2="1.7" y2="-3"/>
        <circle cx="0" cy="0" r="1" fill="#fff" opacity="0.9"/>
      </g>`;
    }
    return out;
  }

  function hailMarkup() {
    const grad = '<defs><linearGradient id="hailG" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#d7e7ef"/><stop offset="100%" stop-color="#a9c3d2"/></linearGradient></defs>';
    let out = grad;
    for (let i = 0; i < 4; i += 1) {
      const x = 20 + i * 7;
      const y = 46 + (i % 2) * 5;
      out += `<rect x="${x - 2.6}" y="${y - 2.6}" width="5.2" height="5.2" rx="1" fill="url(#hailG)" transform="rotate(45 ${x} ${y})"/>`;
      out += `<rect x="${x - 1}" y="${y - 2.2}" width="1" height="1.6" fill="#fff" opacity="0.8" transform="rotate(45 ${x} ${y})"/>`;
    }
    return out;
  }

  function fogMarkup() {
    let out = `<defs>
      <linearGradient id="fogG" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#e2e8ec" stop-opacity="0"/>
        <stop offset="50%" stop-color="#eef2f5" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#e2e8ec" stop-opacity="0"/>
      </linearGradient>
      <filter id="fogBlur" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="1.1"/></filter>
    </defs>`;
    [{ y: 18, w: 42, x: 11, op: 0.85 }, { y: 28, w: 52, x: 6, op: 1 }, { y: 38, w: 36, x: 14, op: 0.8 }, { y: 48, w: 46, x: 9, op: 0.9 }].forEach((band) => {
      out += `<rect x="${band.x}" y="${band.y}" width="${band.w}" height="5" rx="2.5" fill="url(#fogG)" opacity="${band.op}" filter="url(#fogBlur)"/>`;
    });
    return out;
  }

  function windMarkup(uid) {
    const gradId = `${uid}wind`;
    return `
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#dff1ee" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#dff1ee"/>
        </linearGradient>
      </defs>
      <path d="M8 22 H38 a6.5 6.5 0 1 0 -6.5 -6.5" stroke="url(#${gradId})" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      <path d="M8 33 H50 a6.5 6.5 0 1 1 -6.5 6.5" stroke="url(#${gradId})" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      <path d="M8 44 H30" stroke="url(#${gradId})" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      <circle cx="12" cy="22" r="2" fill="#dff1ee" opacity="0.5"/>
      <circle cx="12" cy="44" r="1.6" fill="#dff1ee" opacity="0.5"/>
    `;
  }

  function boltMarkup(uid) {
    const gradId = `${uid}bolt`;
    const glowId = `${uid}boltGlow`;
    return `
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#fff9d6"/>
          <stop offset="45%" stop-color="#ffd166"/>
          <stop offset="100%" stop-color="#ff9d2e"/>
        </linearGradient>
        <filter id="${glowId}" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.4"/></filter>
      </defs>
      <path d="M31 36 L23 50 L30 50 L25 60 L41 43 L33 43 Z" fill="#ffcf5c" opacity="0.55" filter="url(#${glowId})"/>
      <path d="M31 36 L23 50 L30 50 L25 60 L41 43 L33 43 Z" fill="#ffb23c" opacity="0.35" transform="translate(1,1)"/>
      <path d="M31 36 L23 50 L30 50 L25 60 L41 43 L33 43 Z" fill="url(#${gradId})"/>
      <path d="M28 40 L27 47" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity="0.6"/>
    `;
  }

  function alertMarkup(uid) {
    const gradId = `${uid}alert`;
    const glowId = `${uid}alertGlow`;
    return `
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ff9a8f"/>
          <stop offset="100%" stop-color="#ff5c52"/>
        </linearGradient>
        <radialGradient id="${glowId}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ff5c52" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#ff5c52" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="24" fill="url(#${glowId})"/>
      <circle cx="32" cy="32" r="18" fill="url(#${gradId})" opacity="0.18"/>
      <circle cx="32" cy="32" r="15" fill="none" stroke="url(#${gradId})" stroke-width="3.2"/>
      <rect x="29.6" y="20" width="4.8" height="17" rx="2.4" fill="url(#${gradId})"/>
      <rect x="29.6" y="40.5" width="4.8" height="4.8" rx="2.4" fill="url(#${gradId})"/>
    `;
  }

  // --- Animated background particles ---------------------------------------
  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function addParticles(container, count, className, styleFn) {
    for (let i = 0; i < count; i += 1) {
      const el = document.createElement('div');
      el.className = className;
      el.setAttribute('style', styleFn(i));
      container.appendChild(el);
    }
  }

  function renderFx(container, condition) {
    container.innerHTML = '';
    const c = normalizeCondition(condition);

    const wantsClouds = ['cloudy', 'partlycloudy', 'lightning', 'lightning-rainy', 'unknown'].includes(c);
    const wantsRain = ['rainy', 'pouring', 'lightning-rainy'].includes(c);
    const wantsSnow = ['snowy', 'snowy-rainy'].includes(c);

    if (c === 'sunny') {
      const sun = document.createElement('div');
      sun.className = 'llw-sun';
      const rays = document.createElement('div');
      rays.className = 'llw-sun-rays';
      for (let i = 0; i < 10; i += 1) {
        const ray = document.createElement('span');
        ray.style.transform = `rotate(${i * 36}deg)`;
        rays.appendChild(ray);
      }
      sun.appendChild(rays);
      container.appendChild(sun);
    }

    if (c === 'clear-night') {
      const moon = document.createElement('div');
      moon.className = 'llw-moon';
      container.appendChild(moon);
      addParticles(container, 18, 'llw-star', () => {
        const size = rand(1, 2.6);
        return `left:${rand(0, 100)}%; top:${rand(0, 65)}%; width:${size}px; height:${size}px; animation-duration:${rand(1.5, 4)}s; animation-delay:${rand(0, 3)}s;`;
      });
    }

    if (wantsClouds) {
      addParticles(container, c === 'partlycloudy' ? 2 : 3, 'llw-cloud', (i) => {
        const w = rand(38, 60);
        return `top:${10 + i * 18}%; width:${w}%; height:${w * 0.32}px; opacity:${rand(0.5, 0.9)}; animation-duration:${rand(35, 70)}s; animation-delay:${-rand(0, 40)}s;`;
      });
    }

    if (wantsRain) {
      const count = c === 'pouring' ? 34 : 18;
      addParticles(container, count, 'llw-drop', () => `left:${rand(0, 100)}%; animation-duration:${rand(0.5, 1)}s; animation-delay:${rand(0, 1.5)}s; opacity:${rand(0.4, 0.9)};`);
    }

    if (wantsSnow) {
      const count = c === 'snowy-rainy' ? 16 : 26;
      addParticles(container, count, 'llw-flake', () => {
        const size = rand(3, 7);
        return `left:${rand(0, 100)}%; width:${size}px; height:${size}px; animation-duration:${rand(4, 9)}s; animation-delay:${rand(0, 6)}s; opacity:${rand(0.5, 1)};`;
      });
      if (c === 'snowy-rainy') {
        addParticles(container, 10, 'llw-drop', () => `left:${rand(0, 100)}%; animation-duration:${rand(0.6, 1.1)}s; animation-delay:${rand(0, 1.5)}s; opacity:0.6;`);
      }
    }

    if (c === 'hail') {
      addParticles(container, 22, 'llw-hailstone', () => {
        const size = rand(3, 5);
        return `left:${rand(0, 100)}%; width:${size}px; height:${size}px; animation-duration:${rand(0.5, 0.9)}s; animation-delay:${rand(0, 1)}s;`;
      });
    }

    if (c === 'fog') {
      addParticles(container, 5, 'llw-fogband', (i) => `top:${12 + i * 16}%; animation-duration:${rand(20, 34)}s; animation-delay:${-rand(0, 20)}s;`);
    }

    if (c === 'windy' || c === 'windy-variant') {
      addParticles(container, 10, 'llw-windstreak', () => `top:${rand(5, 90)}%; animation-duration:${rand(1.4, 2.6)}s; animation-delay:${rand(0, 2)}s; opacity:${rand(0.3, 0.8)};`);
    }

    if (c === 'lightning' || c === 'lightning-rainy') {
      const flash = document.createElement('div');
      flash.className = 'llw-flash-overlay';
      flash.style.animationDuration = `${rand(3.5, 6)}s`;
      container.appendChild(flash);
    }

    if (c === 'exceptional') {
      const ring = document.createElement('div');
      ring.className = 'llw-alert-ring';
      container.appendChild(ring);
    }
  }

  // --- Formatting helpers ----------------------------------------------------
  function formatTemp(value, unit) {
    if (value === undefined || value === null) return '--';
    return `${Math.round(value)}${unit || ''}`;
  }

  function formatForecastTime(iso, index) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    // First couple of entries are usually hourly; later ones daily. Either
    // way, format using the *dashboard's* current locale so it reads
    // naturally in whatever language Home Assistant is set to.
    const locale = LL.i18n.lang;
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay || index < 3
      ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(locale, { weekday: 'short' });
  }

  // --- Widget lifecycle --------------------------------------------------------
  function mount(el, { config, saveConfig }) {
    let entityId = config.entity_id || '';
    let pollTimer = null;
    let destroyed = false;
    // 'full' (default, for every weather widget saved before this existed)
    // shows the forecast strip below current conditions; 'compact' shows
    // only current conditions - chosen once when the widget is added (see
    // app.js's size picker), same as every other widget with sizeVariants.
    const isCompact = config.sizeVariant === 'compact';

    el.classList.add('llw-widget-weather');
    el.innerHTML = `
      <div class="llw-weather">
        <div class="llw-weather__bg llw-bg-unknown"></div>
        <div class="llw-weather__fx"></div>
        <div class="llw-weather__content">
          <div class="llw-weather__head">
            <span class="llw-weather__title">${t('weather', 'title')}</span>
            <button class="llw-weather__gear" type="button">⚙</button>
          </div>
          <div class="llw-weather__state"></div>
        </div>
        <div class="llw-weather__settings">
          <label>${t('weather', 'chooseEntity')}</label>
          <select class="llw-weather__select"><option value="">…</option></select>
          <button type="button" class="llw-weather__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const bgEl = el.querySelector('.llw-weather__bg');
    const fxEl = el.querySelector('.llw-weather__fx');
    const stateEl = el.querySelector('.llw-weather__state');
    const gearBtn = el.querySelector('.llw-weather__gear');
    const settingsEl = el.querySelector('.llw-weather__settings');
    const selectEl = el.querySelector('.llw-weather__select');
    const closeBtn = el.querySelector('.llw-weather__close');

    gearBtn.addEventListener('click', () => {
      settingsEl.classList.add('llw-open');
      loadEntityOptions();
    });
    closeBtn.addEventListener('click', () => settingsEl.classList.remove('llw-open'));
    selectEl.addEventListener('change', () => {
      entityId = selectEl.value;
      saveConfig({ entity_id: entityId });
      settingsEl.classList.remove('llw-open');
      fetchAndRender();
    });

    async function loadEntityOptions() {
      selectEl.innerHTML = `<option value="">…</option>`;
      try {
        const entities = await LL.api.get('api/hass/states?domain=weather');
        if (destroyed) return;
        if (!entities.length) {
          selectEl.innerHTML = `<option value="">${t('weather', 'noEntities')}</option>`;
          return;
        }
        // Keep an empty placeholder option, selected only when nothing has
        // been chosen yet. Without it the browser silently pre-selects the
        // first real entity the moment this list loads (that's not a user
        // action, so no `change` event fires for it) - and if there's only
        // one entity to begin with, the user can never trigger `change` at
        // all: clicking "the only option" re-selects the value that was
        // already showing, which browsers don't treat as a change. That's
        // exactly what made a single weather entity impossible to save.
        const placeholder = `<option value="" ${entityId ? '' : 'selected'}>…</option>`;
        selectEl.innerHTML = placeholder + entities
          .map((e) => `<option value="${e.entity_id}" ${e.entity_id === entityId ? 'selected' : ''}>${(e.attributes && e.attributes.friendly_name) || e.entity_id}</option>`)
          .join('');
      } catch (err) {
        console.error('[loudllama][weather] Failed to load entity list', err);
      }
    }

    function renderEmpty(message) {
      bgEl.className = 'llw-weather__bg llw-bg-unknown';
      fxEl.innerHTML = '';
      stateEl.innerHTML = `<div class="llw-weather__empty">${message}</div>`;
    }

    function render(entity, fetchedForecast) {
      const condition = entity.state;
      const attrs = entity.attributes || {};
      const tempUnit = attrs.temperature_unit || (LL.haConfig.unit_system && LL.haConfig.unit_system.temperature) || '°C';

      bgEl.className = `llw-weather__bg llw-bg-${normalizeCondition(condition)}`;
      renderFx(fxEl, condition);

      // Current Home Assistant versions (core 2023.9+) no longer put
      // forecast data on the entity's own state - it has to be fetched via
      // the weather.get_forecasts service instead (see fetchAndRender()
      // below). attrs.forecast is kept as a fallback for any integration
      // that still sets it directly.
      const rawForecast = isCompact
        ? []
        : (Array.isArray(fetchedForecast) && fetchedForecast.length)
          ? fetchedForecast
          : (Array.isArray(attrs.forecast) ? attrs.forecast : []);
      const forecast = rawForecast.slice(0, 4);
      const forecastHtml = forecast.length
        ? `<div class="llw-weather__forecast">${forecast
            .map(
              (f, i) => `
              <div class="llw-weather__forecast-item">
                <div>${formatForecastTime(f.datetime, i)}</div>
                <div class="llw-fc-icon">${iconSvg(f.condition)}</div>
                <div class="llw-fc-temp">${formatTemp(f.temperature, tempUnit)}</div>
              </div>`
            )
            .join('')}</div>`
        : '';

      stateEl.innerHTML = `
        <div class="llw-weather__main">
          <div class="llw-weather__icon">${iconSvg(condition)}</div>
          <div>
            <div class="llw-weather__temp">${formatTemp(attrs.temperature, tempUnit)}</div>
            <div class="llw-weather__condition">${conditionLabel(condition)}</div>
          </div>
        </div>
        <div class="llw-weather__meta">
          ${attrs.humidity !== undefined ? `<span>💧 ${t('weather', 'humidity')} ${Math.round(attrs.humidity)}%</span>` : ''}
          ${attrs.wind_speed !== undefined ? `<span>🌬 ${t('weather', 'wind')} ${Math.round(attrs.wind_speed)} ${attrs.wind_speed_unit || ''}</span>` : ''}
        </div>
        ${forecastHtml}
      `;
    }

    async function fetchAndRender() {
      if (!entityId) {
        renderEmpty(t('weather', 'noEntity'));
        return;
      }
      try {
        // Fetched in parallel, not chained: the forecast call hits HA's
        // weather.get_forecasts service, which is a separate round-trip
        // from the entity's own state and shouldn't block or fail the
        // widget's main temperature/condition readout if it errors (e.g.
        // on an older HA version that doesn't support it - render() falls
        // back to attrs.forecast in that case, or shows no forecast strip
        // at all rather than nothing).
        const [entity, forecastRes] = await Promise.all([
          LL.api.get(`api/hass/states/${encodeURIComponent(entityId)}`),
          isCompact
            ? Promise.resolve(null)
            : LL.api.get(`api/hass/weather_forecast/${encodeURIComponent(entityId)}?type=daily`).catch((err) => {
                console.warn('[loudllama][weather] weather_forecast fetch failed, falling back to attrs.forecast', err);
                return null;
              }),
        ]);
        if (destroyed) return;
        render(entity, forecastRes && forecastRes.forecast);
      } catch (err) {
        console.error('[loudllama][weather] Failed to fetch entity', err);
        if (!destroyed) renderEmpty(t('app', 'connectionError'));
      }
    }

    fetchAndRender();
    if (!entityId) loadEntityOptions();
    pollTimer = setInterval(fetchAndRender, POLL_MS);

    el._llwCleanup = () => {
      destroyed = true;
      clearInterval(pollTimer);
    };
  }

  LL.registerWidget('weather', {
    name: { en: 'Weather', da: 'Vejr', de: 'Wetter', sv: 'Väder', no: 'Vær' },
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 2, h: 2 },
    defaultConfig: () => ({ entity_id: '' }),
    // See app.js's showSizePicker: offered as a choice right when the
    // widget is added, instead of free-dragging it to size afterward.
    sizeVariants: {
      full: {
        w: 4,
        h: 2,
        label: { en: 'With forecast', da: 'Med vejrudsigt', de: 'Mit Vorhersage', sv: 'Med prognos', no: 'Med værmelding' },
      },
      compact: {
        w: 2,
        h: 2,
        label: { en: 'Now only', da: 'Kun nu', de: 'Nur jetzt', sv: 'Endast nu', no: 'Kun nå' },
      },
    },
    mount,
  });
})();
