/*
 * LoudLlama Dashboard - Clock widget.
 *
 * Purely client-side: no Home Assistant entity, no polling, no backend call
 * at all - just the browser's own clock, formatted with Intl using whatever
 * language Home Assistant is configured in (see LL.i18n.lang). Ticks once a
 * second; the full (2x2) size shows weekday + date underneath, the compact
 * (1x1) size is just the time, bigger, same as a phone's own clock widget.
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

  function mount(el, { config, saveConfig }) {
    const isCompact = config.sizeVariant === 'compact';
    let hourFormat = config.hourFormat || defaultHourFormat();
    let showSeconds = !!config.showSeconds;
    let tickTimer = null;
    let destroyed = false;

    el.classList.add('llw-widget-clock');
    if (isCompact) el.classList.add('llw-widget-clock--compact');
    el.innerHTML = `
      <div class="llw-clock">
        <button class="llw-clock__gear" type="button" title="${t('clock', 'settings')}">${LL.icons.gear()}</button>
        <div class="llw-clock__time"></div>
        <div class="llw-clock__date"></div>
        <div class="llw-clock__settings">
          <label>${t('clock', 'hourFormatLabel')}</label>
          <div class="llw-clock__format-row">
            <button type="button" class="llw-clock__format-opt" data-format="24">${t('clock', 'hourFormat24')}</button>
            <button type="button" class="llw-clock__format-opt" data-format="12">${t('clock', 'hourFormat12')}</button>
          </div>
          <label class="llw-clock__seconds-row">
            <input type="checkbox" class="llw-clock__seconds-check" />
            ${t('clock', 'showSeconds')}
          </label>
          <button type="button" class="llw-clock__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const timeEl = el.querySelector('.llw-clock__time');
    const dateEl = el.querySelector('.llw-clock__date');
    const gearBtn = el.querySelector('.llw-clock__gear');
    const settingsEl = el.querySelector('.llw-clock__settings');
    const closeBtn = el.querySelector('.llw-clock__close');
    const formatBtns = Array.from(el.querySelectorAll('.llw-clock__format-opt'));
    const secondsCheck = el.querySelector('.llw-clock__seconds-check');

    function syncSettingsUi() {
      formatBtns.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.format === hourFormat));
      secondsCheck.checked = showSeconds;
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
    formatBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        hourFormat = btn.dataset.format;
        saveConfig({ ...config, hourFormat, showSeconds });
        syncSettingsUi();
        render();
      });
    });
    secondsCheck.addEventListener('change', () => {
      showSeconds = secondsCheck.checked;
      saveConfig({ ...config, hourFormat, showSeconds });
      render();
    });

    function render() {
      const now = new Date();
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

    render();
    // A second-granularity tick is plenty - this is a clock, not a
    // stopwatch, and lines up with showSeconds's own display granularity.
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
    defaultConfig: () => ({ hourFormat: defaultHourFormat(), showSeconds: false }),
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
