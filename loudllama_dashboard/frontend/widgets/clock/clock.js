/*
 * LoudLlama Dashboard - Clock widget.
 *
 * Purely client-side: no Home Assistant entity, no polling, no backend call
 * at all - just the browser's own clock, formatted with Intl using whatever
 * language Home Assistant is configured in (see LL.i18n.lang). Ticks once a
 * second; the full (2x2) size shows weekday + date underneath, the compact
 * (1x1) size is just the time, bigger, same as a phone's own clock widget.
 *
 * Two independent choices, both in config (so both survive a reload and
 * both get their own settings-panel control): clockStyle ('digital', the
 * original look, or 'analog' - a hand-drawn SVG dial, requested directly
 * alongside the sizing fix below) and the pre-existing hourFormat/
 * showSeconds (digital-only - an analog face is inherently 12-hour and
 * showSeconds there just means "show the sweeping second hand instead of
 * hiding it", same setting, different effect per style rather than a
 * second checkbox). Digital text size and the analog SVG's own sizing are
 * both covered by clock.css: digital uses CSS container query units
 * (cqmin) on .llw-widget-clock itself so the time/date scale continuously
 * with whatever box this widget ends up being rather than jumping between
 * two hardcoded font sizes; analog is just an SVG with a viewBox, which
 * scales to fill its container for free. Both were requested directly
 * ("jeg vil gerne have at ur widgeten tilpasser størrelsen på uret efter
 * hvor stor widget kasse jeg laver").
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  // Danish/German/Swedish/Norwegian all default to 24h on a wall clock;
  // English is the one language here where 12h + am/pm is the everyday
  // convention. Only used the very first time this widget is added - from
  // then on it's whatever the user picked in settings (config.hourFormat).
  const DEFAULT_24H_LANGS = ['da', 'de', 'sv', 'no'];

  function defaultHourFormat() {
    return DEFAULT_24H_LANGS.includes(LL.i18n.lang) ? '24' : '12';
  }

  // --- Analog face (SVG) ----------------------------------------------------
  // One hour tick every 30°, the four cardinal ones (12/3/6/9) drawn longer
  // and thicker so the face reads correctly even tiny (the compact 1x1
  // size). Built once per mount, not regenerated every tick - only the
  // three hands' own `transform: rotate()` changes on each render().
  function analogTicks() {
    let out = '';
    for (let i = 0; i < 12; i += 1) {
      const major = i % 3 === 0;
      const r1 = major ? 36 : 41;
      const r2 = 46;
      out += `<line class="llw-clock__tick${major ? ' llw-clock__tick--major' : ''}" x1="50" y1="${50 - r1}" x2="50" y2="${50 - r2}" transform="rotate(${i * 30} 50 50)" />`;
    }
    return out;
  }

  function analogFaceSvg() {
    return `
      <svg class="llw-clock__analog-face" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <radialGradient id="llwClockFace" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stop-color="rgba(255,255,255,0.16)" />
            <stop offset="100%" stop-color="rgba(255,255,255,0.03)" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="47" fill="url(#llwClockFace)" stroke="rgba(255,255,255,0.4)" stroke-width="2" />
        ${analogTicks()}
        <line class="llw-clock__hand llw-clock__hand--hour" x1="50" y1="50" x2="50" y2="28" />
        <line class="llw-clock__hand llw-clock__hand--minute" x1="50" y1="50" x2="50" y2="18" />
        <line class="llw-clock__hand llw-clock__hand--second" x1="50" y1="58" x2="50" y2="13" />
        <circle class="llw-clock__hand-pin" cx="50" cy="50" r="3" />
      </svg>
    `;
  }

  function mount(el, { config, saveConfig }) {
    const isCompact = config.sizeVariant === 'compact';
    let hourFormat = config.hourFormat || defaultHourFormat();
    let showSeconds = !!config.showSeconds;
    let clockStyle = config.clockStyle === 'analog' ? 'analog' : 'digital';
    let tickTimer = null;
    let destroyed = false;

    el.classList.add('llw-widget-clock');
    if (isCompact) el.classList.add('llw-widget-clock--compact');
    el.innerHTML = `
      <div class="llw-clock">
        <button class="llw-clock__gear" type="button" title="${t('clock', 'settings')}">${LL.icons.gear()}</button>
        <div class="llw-clock__time"></div>
        <div class="llw-clock__date"></div>
        ${analogFaceSvg()}
        <div class="llw-clock__settings">
          <label>${t('clock', 'clockStyleLabel')}</label>
          <div class="llw-clock__format-row">
            <button type="button" class="llw-clock__style-opt" data-style="digital">${t('clock', 'clockStyleDigital')}</button>
            <button type="button" class="llw-clock__style-opt" data-style="analog">${t('clock', 'clockStyleAnalog')}</button>
          </div>
          <div class="llw-clock__hourformat-group">
            <label>${t('clock', 'hourFormatLabel')}</label>
            <div class="llw-clock__format-row">
              <button type="button" class="llw-clock__format-opt" data-format="24">${t('clock', 'hourFormat24')}</button>
              <button type="button" class="llw-clock__format-opt" data-format="12">${t('clock', 'hourFormat12')}</button>
            </div>
          </div>
          <label class="llw-clock__seconds-row">
            <input type="checkbox" class="llw-clock__seconds-check" />
            ${t('clock', 'showSeconds')}
          </label>
          <button type="button" class="llw-clock__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const clockEl = el.querySelector('.llw-clock');
    const timeEl = el.querySelector('.llw-clock__time');
    const dateEl = el.querySelector('.llw-clock__date');
    const hourHandEl = el.querySelector('.llw-clock__hand--hour');
    const minuteHandEl = el.querySelector('.llw-clock__hand--minute');
    const secondHandEl = el.querySelector('.llw-clock__hand--second');
    const gearBtn = el.querySelector('.llw-clock__gear');
    const settingsEl = el.querySelector('.llw-clock__settings');
    const closeBtn = el.querySelector('.llw-clock__close');
    const hourFormatGroup = el.querySelector('.llw-clock__hourformat-group');
    const styleBtns = Array.from(el.querySelectorAll('.llw-clock__style-opt'));
    const formatBtns = Array.from(el.querySelectorAll('.llw-clock__format-opt'));
    const secondsCheck = el.querySelector('.llw-clock__seconds-check');

    function syncSettingsUi() {
      styleBtns.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.style === clockStyle));
      formatBtns.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.format === hourFormat));
      secondsCheck.checked = showSeconds;
      // Hour format (12h/24h) only means anything for the digital face - an
      // analog dial is inherently 12-hour, so hide the row entirely rather
      // than leave a control sitting there that does nothing.
      hourFormatGroup.style.display = clockStyle === 'analog' ? 'none' : '';
    }

    function applyStyle() {
      clockEl.classList.toggle('llw-clock--analog', clockStyle === 'analog');
    }

    gearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      syncSettingsUi();
      settingsEl.classList.add('llw-open');
    });
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.remove('llw-open');
    });
    settingsEl.addEventListener('click', (ev) => ev.stopPropagation());
    styleBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        clockStyle = btn.dataset.style;
        saveConfig({ ...config, hourFormat, showSeconds, clockStyle });
        syncSettingsUi();
        applyStyle();
        render();
      });
    });
    formatBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        hourFormat = btn.dataset.format;
        saveConfig({ ...config, hourFormat, showSeconds, clockStyle });
        syncSettingsUi();
        render();
      });
    });
    secondsCheck.addEventListener('change', () => {
      showSeconds = secondsCheck.checked;
      saveConfig({ ...config, hourFormat, showSeconds, clockStyle });
      render();
    });

    function renderDigital(now) {
      const timeFmt = new Intl.DateTimeFormat(LL.i18n.lang, {
        hour: '2-digit',
        minute: '2-digit',
        second: showSeconds ? '2-digit' : undefined,
        hour12: hourFormat === '12',
      });
      timeEl.textContent = timeFmt.format(now);
      if (!isCompact) {
        const dateFmt = new Intl.DateTimeFormat(LL.i18n.lang, { weekday: 'long', day: 'numeric', month: 'long' });
        dateEl.textContent = dateFmt.format(now);
      }
    }

    function renderAnalog(now) {
      const h = now.getHours() % 12;
      const m = now.getMinutes();
      const s = now.getSeconds();
      hourHandEl.style.transform = `rotate(${(h + m / 60) * 30}deg)`;
      minuteHandEl.style.transform = `rotate(${(m + s / 60) * 6}deg)`;
      secondHandEl.style.display = showSeconds ? '' : 'none';
      if (showSeconds) secondHandEl.style.transform = `rotate(${s * 6}deg)`;
    }

    function render() {
      const now = new Date();
      if (clockStyle === 'analog') {
        renderAnalog(now);
      } else {
        renderDigital(now);
      }
    }

    applyStyle();
    render();
    // A second-granularity tick is plenty - this is a clock, not a
    // stopwatch, and lines up with showSeconds's own display granularity
    // (digital) / the analog second hand's own sweep (analog).
    tickTimer = setInterval(render, 1000);

    el._llwCleanup = () => {
      destroyed = true;
      clearInterval(tickTimer);
    };
  }

  LL.registerWidget('clock', {
    name: { en: 'Clock', da: 'Klokke', de: 'Uhr', sv: 'Klocka', no: 'Klokke' },
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    defaultConfig: () => ({ hourFormat: defaultHourFormat(), showSeconds: false, clockStyle: 'digital' }),
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
