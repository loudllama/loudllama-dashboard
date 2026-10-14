/*
 * LoudLlama Dashboard - Energy widget.
 *
 * Two independent, optional sensor readings side by side: "right now"
 * (typically a power sensor, W/kW) and "today" (typically an energy/utility
 * sensor that already accumulates its own daily total, e.g. an Energy
 * dashboard helper or a smart plug's own built-in "today" sensor). Either
 * slot can be left empty - this deliberately does NOT call Home Assistant's
 * statistics/recorder API to compute "today" itself from a lifetime-total
 * energy sensor; that's a surprisingly deep rabbit hole (reset detection,
 * timezone-correct day boundaries, long-term-statistics fallback for a
 * sensor whose short-term state history has already been purged) which
 * would make this a fundamentally different, much bigger widget. Pick
 * whichever sensors your own setup already exposes for each.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const POLL_MS = 15 * 1000;

  function mount(el, { config, saveConfig }) {
    let powerId = config.power_entity_id || '';
    let todayId = config.today_entity_id || '';
    let sensorOptions = [];
    let pollTimer = null;
    let destroyed = false;

    el.classList.add('llw-widget-energy');
    el.innerHTML = `
      <div class="llw-energy">
        <div class="llw-energy__head">
          <span class="llw-energy__name">${t('energy', 'title')}</span>
          <button class="llw-energy__gear" type="button" title="${t('energy', 'settings')}">⚙</button>
        </div>
        <div class="llw-energy__body"></div>
        <div class="llw-energy__settings">
          <label>${t('energy', 'choosePower')}</label>
          <select class="llw-energy__select-power"><option value="">…</option></select>
          <label>${t('energy', 'chooseToday')}</label>
          <select class="llw-energy__select-today"><option value="">…</option></select>
          <button type="button" class="llw-energy__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const bodyEl = el.querySelector('.llw-energy__body');
    const gearBtn = el.querySelector('.llw-energy__gear');
    const settingsEl = el.querySelector('.llw-energy__settings');
    const selectPower = el.querySelector('.llw-energy__select-power');
    const selectToday = el.querySelector('.llw-energy__select-today');
    const closeBtn = el.querySelector('.llw-energy__close');

    gearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.add('llw-open');
      loadSensorOptions();
    });
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.remove('llw-open');
    });
    settingsEl.addEventListener('click', (ev) => ev.stopPropagation());

    function fillSelect(selectEl, selectedId) {
      const placeholder = `<option value="" ${selectedId ? '' : 'selected'}>…</option>`;
      selectEl.innerHTML = placeholder + sensorOptions
        .map((e) => `<option value="${e.entity_id}" ${e.entity_id === selectedId ? 'selected' : ''}>${(e.attributes && e.attributes.friendly_name) || e.entity_id}</option>`)
        .join('');
    }

    async function loadSensorOptions() {
      selectPower.innerHTML = selectToday.innerHTML = `<option value="">…</option>`;
      try {
        sensorOptions = await LL.api.get('api/hass/states?domain=sensor');
        if (destroyed) return;
        if (!sensorOptions.length) {
          selectPower.innerHTML = selectToday.innerHTML = `<option value="">${t('energy', 'noEntities')}</option>`;
          return;
        }
        fillSelect(selectPower, powerId);
        fillSelect(selectToday, todayId);
      } catch (err) {
        console.error('[loudllama][energy] Failed to load sensor list', err);
      }
    }

    selectPower.addEventListener('click', (ev) => ev.stopPropagation());
    selectPower.addEventListener('change', () => {
      powerId = selectPower.value;
      saveConfig({ ...config, power_entity_id: powerId, today_entity_id: todayId });
      fetchAndRender();
    });
    selectToday.addEventListener('click', (ev) => ev.stopPropagation());
    selectToday.addEventListener('change', () => {
      todayId = selectToday.value;
      saveConfig({ ...config, power_entity_id: powerId, today_entity_id: todayId });
      fetchAndRender();
    });

    function escapeHtml(s) {
      return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function statHtml(label, entity) {
      if (!entity) return '';
      const attrs = entity.attributes || {};
      const unit = attrs.unit_of_measurement || '';
      const value = entity.state === undefined || entity.state === null || entity.state === 'unknown' || entity.state === 'unavailable'
        ? '--'
        : entity.state;
      return `
        <div class="llw-energy__stat">
          <span class="llw-energy__stat-label">${label}</span>
          <span class="llw-energy__stat-value">${escapeHtml(String(value))}<span class="llw-energy__stat-unit">${escapeHtml(unit)}</span></span>
        </div>`;
    }

    async function fetchAndRender() {
      if (!powerId && !todayId) {
        bodyEl.innerHTML = `<div class="llw-energy__empty">${t('energy', 'noneChosen')}</div>`;
        return;
      }
      try {
        const ids = [powerId, todayId].filter(Boolean);
        const entities = await LL.api.get(`api/hass/states?ids=${ids.map(encodeURIComponent).join(',')}`);
        if (destroyed) return;
        const byId = {};
        entities.forEach((e) => { byId[e.entity_id] = e; });
        bodyEl.innerHTML = [
          statHtml(t('energy', 'power'), powerId && byId[powerId]),
          statHtml(t('energy', 'today'), todayId && byId[todayId]),
        ].join('');
      } catch (err) {
        console.error('[loudllama][energy] Failed to fetch sensors', err);
        if (!destroyed) bodyEl.innerHTML = `<div class="llw-energy__empty">${t('app', 'connectionError')}</div>`;
      }
    }

    fetchAndRender();
    if (!powerId && !todayId) loadSensorOptions();
    pollTimer = setInterval(fetchAndRender, POLL_MS);

    el._llwCleanup = () => {
      destroyed = true;
      clearInterval(pollTimer);
    };
  }

  LL.registerWidget('energy', {
    name: { en: 'Energy', da: 'Energi', de: 'Energie', sv: 'Energi', no: 'Energi' },
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 1 },
    defaultConfig: () => ({ power_entity_id: '', today_entity_id: '' }),
    mount,
  });
})();
