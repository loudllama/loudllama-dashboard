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
    let rays = '';
    for (let i = 0; i < 12; i += 1) {
      const long = i % 3 === 0;
      const len = long ? 11 : 7;
      const w = long ? 3 : 2;
      const angle = (i * 360) / 12;
      rays += `<line x1="0" y1="${-22 * scale}" x2="0" y2="${-(22 + len) * scale}" stroke="url(#${gradId})" stroke-width="${w}" stroke-linecap="round" transform="translate(${cx} ${cy}) rotate(${angle})"/>`;
    }
    return `
      <defs>
        <radialGradient id="${gradId}" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stop-color="#fff6d8"/>
          <stop offset="55%" stop-color="#ffd166"/>
          <stop offset="100%" stop-color="#ffa93c"/>
        </radialGradient>
        <radialGradient id="${glowId}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffd166" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="#ffd166" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="${24 * scale}" fill="url(#${glowId})"/>
      ${rays}
      <circle cx="${cx}" cy="${cy}" r="${15 * scale}" fill="url(#${gradId})"/>
      <ellipse cx="${cx - 4 * scale}" cy="${cy - 5 * scale}" rx="${6 * scale}" ry="${3.5 * scale}" fill="#fff" opacity="0.35"/>
    `;
  }

  function moonMarkup(uid, cx, cy, scale) {
    const gradId = `${uid}moon`;
    const glowId = `${uid}moonGlow`;
    return `
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fffdf5"/>
          <stop offset="100%" stop-color="#e4dfc8"/>
        </linearGradient>
        <radialGradient id="${glowId}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#f4f1e6" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#f4f1e6" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="${22 * scale}" fill="url(#${glowId})"/>
      <mask id="${uid}moonMask">
        <rect x="${cx - 24 * scale}" y="${cy - 24 * scale}" width="${48 * scale}" height="${48 * scale}" fill="#fff"/>
        <circle cx="${cx + 7 * scale}" cy="${cy - 6 * scale}" r="${12.5 * scale}" fill="#000"/>
      </mask>
      <circle cx="${cx}" cy="${cy}" r="${15 * scale}" fill="url(#${gradId})" mask="url(#${uid}moonMask)"/>
      <circle cx="${cx - 5 * scale}" cy="${cy + 4 * scale}" r="${2 * scale}" fill="#000" opacity="0.06"/>
      <circle cx="${cx - 1 * scale}" cy="${cy - 5 * scale}" r="${1.3 * scale}" fill="#000" opacity="0.06"/>
    `;
  }

  function cloudMarkup(uid, cx, cy, scale) {
    const gradId = `${uid}cloud`;
    const x = cx - 32 * scale;
    const y = cy - 20 * scale;
    return `
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="#dfe6ec"/>
        </linearGradient>
      </defs>
      <g transform="translate(${x + 1.6 * scale},${y + 2.4 * scale}) scale(${scale})" opacity="0.22">
        <ellipse cx="22" cy="27" rx="15" ry="10" fill="#0a1420"/>
        <ellipse cx="36" cy="23" rx="17" ry="13" fill="#0a1420"/>
        <rect x="16" y="27" width="40" height="11" rx="5.5" fill="#0a1420"/>
      </g>
      <g transform="translate(${x},${y}) scale(${scale})">
        <ellipse cx="20" cy="24" rx="14" ry="10" fill="url(#${gradId})"/>
        <ellipse cx="34" cy="20" rx="16" ry="12" fill="url(#${gradId})"/>
        <ellipse cx="46" cy="26" rx="12" ry="9" fill="url(#${gradId})"/>
        <rect x="14" y="24" width="40" height="12" rx="6" fill="url(#${gradId})"/>
        <ellipse cx="29" cy="16" rx="7" ry="3.5" fill="#fff" opacity="0.7"/>
      </g>
    `;
  }

  function dropsMarkup(uid, count) {
    const gradId = `${uid}drop`;
    let out = `<defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#bfe2fb" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#8ec8f0"/>
    </linearGradient></defs>`;
    for (let i = 0; i < count; i += 1) {
      const x = 20 + i * (count > 4 ? 6 : 8);
      // Teardrop: a circle with a small pointed tip, not just a stroked line.
      out += `<path d="M${x} 40 C${x + 3.5} 46 ${x + 3.5} 50.5 ${x} 53 C${x - 3.5} 50.5 ${x - 3.5} 46 ${x} 40 Z" fill="url(#${gradId})"/>`;
    }
    return out;
  }

  function flakesMarkup(count) {
    let out = '';
    for (let i = 0; i < count; i += 1) {
      const x = 20 + i * 8;
      const y = 46 + (i % 2) * 6;
      out += `<g stroke="#ffffff" stroke-width="1.1" stroke-linecap="round" transform="translate(${x} ${y})" opacity="0.95">
        <line x1="-3.2" y1="0" x2="3.2" y2="0"/>
        <line x1="-1.6" y1="-2.8" x2="1.6" y2="2.8"/>
        <line x1="-1.6" y1="2.8" x2="1.6" y2="-2.8"/>
      </g>`;
    }
    return out;
  }

  function hailMarkup() {
    const grad = '<defs><linearGradient id="hailG" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#bcd3de"/></linearGradient></defs>';
    let out = grad;
    for (let i = 0; i < 4; i += 1) {
      const x = 20 + i * 7;
      const y = 46 + (i % 2) * 5;
      out += `<rect x="${x - 2.4}" y="${y - 2.4}" width="4.8" height="4.8" fill="url(#hailG)" transform="rotate(45 ${x} ${y})"/>`;
    }
    return out;
  }

  function fogMarkup() {
    let out = '<defs><linearGradient id="fogG" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#e2e8ec" stop-opacity="0.3"/><stop offset="50%" stop-color="#eef2f5"/><stop offset="100%" stop-color="#e2e8ec" stop-opacity="0.3"/></linearGradient></defs>';
    [{ y: 20, w: 40, x: 12 }, { y: 30, w: 50, x: 7 }, { y: 40, w: 34, x: 15 }, { y: 48, w: 44, x: 10 }].forEach((band) => {
      out += `<rect x="${band.x}" y="${band.y}" width="${band.w}" height="4.5" rx="2.25" fill="url(#fogG)"/>`;
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
    return `
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#fff3b0"/>
          <stop offset="100%" stop-color="#ffb23c"/>
        </linearGradient>
      </defs>
      <path d="M31 36 L23 50 L30 50 L25 60 L41 43 L33 43 Z" fill="#ffb23c" opacity="0.35" transform="translate(1,1)"/>
      <path d="M31 36 L23 50 L30 50 L25 60 L41 43 L33 43 Z" fill="url(#${gradId})"/>
    `;
  }

  function alertMarkup(uid) {
    const gradId = `${uid}alert`;
    return `
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ff9a8f"/>
          <stop offset="100%" stop-color="#ff5c52"/>
        </linearGradient>
      </defs>
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

    function render(entity) {
      const condition = entity.state;
      const attrs = entity.attributes || {};
      const tempUnit = attrs.temperature_unit || (LL.haConfig.unit_system && LL.haConfig.unit_system.temperature) || '°C';

      bgEl.className = `llw-weather__bg llw-bg-${normalizeCondition(condition)}`;
      renderFx(fxEl, condition);

      const forecast = Array.isArray(attrs.forecast) ? attrs.forecast.slice(0, 4) : [];
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
        const entity = await LL.api.get(`api/hass/states/${encodeURIComponent(entityId)}`);
        if (destroyed) return;
        render(entity);
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
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 2, h: 2 },
    defaultConfig: () => ({ entity_id: '' }),
    mount,
  });
})();
