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
  // Small hand-built SVG icon per condition family. Kept intentionally
  // simple/geometric (no external image files) so the add-on has zero
  // runtime dependency on the internet or bundled photo assets.
  function iconSvg(condition) {
    const c = normalizeCondition(condition);
    const sun = '<circle cx="32" cy="32" r="14" fill="#ffd166"/>' +
      raysMarkup();
    const moon = '<circle cx="32" cy="32" r="14" fill="#f4f1e6"/>' +
      '<circle cx="38" cy="27" r="12" fill="var(--llw-icon-bg,#33475f)"/>';
    const cloud = cloudMarkup(32, 34, 1);
    const cloudSun = '<g transform="translate(-6,-6)">' + '<circle cx="30" cy="26" r="10" fill="#ffd166"/>' + '</g>' + cloudMarkup(34, 38, 0.9);
    const rain = cloudMarkup(32, 26, 0.9) + dropsMarkup(3);
    const pouring = cloudMarkup(32, 24, 1) + dropsMarkup(5);
    const snow = cloudMarkup(32, 26, 0.9) + flakesMarkup(4);
    const sleet = cloudMarkup(32, 26, 0.9) + dropsMarkup(2) + flakesMarkup(2);
    const storm = cloudMarkup(32, 24, 1) + '<path d="M30 34 L24 46 L30 46 L26 56 L40 40 L33 40 Z" fill="#ffe066"/>';
    const stormRain = storm + dropsMarkup(2);
    const fog = fogMarkup();
    const wind = windMarkup();
    const hail = cloudMarkup(32, 26, 0.9) + hailMarkup();
    const alertIcon = '<circle cx="32" cy="32" r="15" fill="none" stroke="#ff7676" stroke-width="3"/>' +
      '<rect x="30" y="20" width="4" height="16" rx="2" fill="#ff7676"/>' +
      '<rect x="30" y="40" width="4" height="4" rx="2" fill="#ff7676"/>';

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

  function raysMarkup() {
    let rays = '';
    for (let i = 0; i < 8; i += 1) {
      const angle = (i * 360) / 8;
      rays += `<line x1="32" y1="32" x2="32" y2="10" stroke="#ffd166" stroke-width="2" stroke-linecap="round" transform="rotate(${angle} 32 32)"/>`;
    }
    return rays;
  }

  function cloudMarkup(cx, cy, scale) {
    return `<g transform="translate(${cx - 32 * scale},${cy - 20 * scale}) scale(${scale})">
      <ellipse cx="20" cy="24" rx="14" ry="10" fill="#f4f6f8"/>
      <ellipse cx="34" cy="20" rx="16" ry="12" fill="#f4f6f8"/>
      <ellipse cx="46" cy="26" rx="12" ry="9" fill="#f4f6f8"/>
      <rect x="14" y="24" width="40" height="12" rx="6" fill="#f4f6f8"/>
    </g>`;
  }

  function dropsMarkup(count) {
    let out = '';
    for (let i = 0; i < count; i += 1) {
      const x = 22 + i * 8;
      out += `<line x1="${x}" y1="42" x2="${x - 3}" y2="54" stroke="#8ec8f0" stroke-width="3" stroke-linecap="round"/>`;
    }
    return out;
  }

  function flakesMarkup(count) {
    let out = '';
    for (let i = 0; i < count; i += 1) {
      const x = 20 + i * 8;
      out += `<circle cx="${x}" cy="${46 + (i % 2) * 6}" r="2.2" fill="#ffffff"/>`;
    }
    return out;
  }

  function hailMarkup() {
    let out = '';
    for (let i = 0; i < 4; i += 1) {
      const x = 20 + i * 7;
      out += `<rect x="${x}" y="${46 + (i % 2) * 5}" width="4" height="4" fill="#dfeaf0" transform="rotate(20 ${x} 48)"/>`;
    }
    return out;
  }

  function fogMarkup() {
    let out = '';
    [22, 32, 42].forEach((y, i) => {
      out += `<rect x="${8 + (i % 2) * 4}" y="${y}" width="48" height="4" rx="2" fill="#e2e8ec"/>`;
    });
    return out;
  }

  function windMarkup() {
    return `
      <path d="M10 24 H40 a6 6 0 1 0 -6 -6" stroke="#dff1ee" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M10 34 H48 a6 6 0 1 1 -6 6" stroke="#dff1ee" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M10 44 H32" stroke="#dff1ee" stroke-width="3" fill="none" stroke-linecap="round"/>
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
        selectEl.innerHTML = entities
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
