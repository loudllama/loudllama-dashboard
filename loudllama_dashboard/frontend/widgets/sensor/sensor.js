/*
 * LoudLlama Dashboard - Sensor widget.
 *
 * Deliberately minimal: pick any `sensor.*` entity and show its current
 * reading, big, with its unit and a device-class icon. No history, no
 * graphs, no controls - just "what does this sensor say right now". Same
 * self-contained mount(el, {config, saveConfig}) shape as the other
 * single-entity widgets (Light/Climate/Media).
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const POLL_MS = 15 * 1000;

  // Emoji icon per Home Assistant device_class - no icon font/SVG sheet is
  // loaded on the frontend, and pulling one in just for this would be a lot
  // of weight for what's meant to be a small, simple widget. Falls back to a
  // generic gauge glyph for anything not in this list.
  const DEVICE_CLASS_ICON = {
    temperature: '🌡️',
    humidity: '💧',
    power: '⚡',
    energy: '🔌',
    battery: '🔋',
    illuminance: '💡',
    pressure: '🧭',
    gas: '🔥',
    current: '⚡',
    voltage: '⚡',
    co2: '🫧',
    carbon_dioxide: '🫧',
    moisture: '💧',
    wind_speed: '🌬',
    precipitation: '🌧',
    signal_strength: '📶',
  };
  const DEFAULT_ICON = '📊';

  function iconFor(attrs) {
    const dc = attrs && attrs.device_class;
    return (dc && DEVICE_CLASS_ICON[dc]) || DEFAULT_ICON;
  }

  function mount(el, { config, saveConfig }) {
    let entityId = config.entity_id || '';
    let pollTimer = null;
    let destroyed = false;

    el.classList.add('llw-widget-sensor');
    el.innerHTML = `
      <div class="llw-sensor">
        <div class="llw-sensor__head">
          <span class="llw-sensor__name">${t('sensor', 'title')}</span>
          <button class="llw-sensor__gear" type="button" title="${t('sensor', 'chooseEntity')}">⚙</button>
        </div>
        <div class="llw-sensor__body"></div>
        <div class="llw-sensor__settings">
          <label>${t('sensor', 'chooseEntity')}</label>
          <select class="llw-sensor__select"><option value="">…</option></select>
          <button type="button" class="llw-sensor__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const nameEl = el.querySelector('.llw-sensor__name');
    const bodyEl = el.querySelector('.llw-sensor__body');
    const gearBtn = el.querySelector('.llw-sensor__gear');
    const settingsEl = el.querySelector('.llw-sensor__settings');
    const selectEl = el.querySelector('.llw-sensor__select');
    const closeBtn = el.querySelector('.llw-sensor__close');

    gearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.add('llw-open');
      loadEntityOptions();
    });
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.remove('llw-open');
    });
    selectEl.addEventListener('click', (ev) => ev.stopPropagation());
    selectEl.addEventListener('change', () => {
      entityId = selectEl.value;
      // ...config, not a bare { entity_id } - see weather.js's identical fix
      // for why: saveConfig() replaces the whole saved config, so any other
      // field this widget picks up in the future would otherwise be
      // silently dropped the moment someone (re)picks an entity.
      saveConfig({ ...config, entity_id: entityId });
      settingsEl.classList.remove('llw-open');
      fetchAndRender();
    });

    async function loadEntityOptions() {
      selectEl.innerHTML = `<option value="">…</option>`;
      try {
        const entities = await LL.api.get('api/hass/states?domain=sensor');
        if (destroyed) return;
        if (!entities.length) {
          selectEl.innerHTML = `<option value="">${t('sensor', 'noEntities')}</option>`;
          return;
        }
        // Keep an empty placeholder selected by default - without it the
        // browser auto-selects the first real entity as soon as the list
        // loads (no `change` fires for that), so with just one sensor a
        // user could never trigger a save. See weather.js for the same fix.
        const placeholder = `<option value="" ${entityId ? '' : 'selected'}>…</option>`;
        selectEl.innerHTML = placeholder + entities
          .map((e) => `<option value="${e.entity_id}" ${e.entity_id === entityId ? 'selected' : ''}>${(e.attributes && e.attributes.friendly_name) || e.entity_id}</option>`)
          .join('');
      } catch (err) {
        console.error('[loudllama][sensor] Failed to load entity list', err);
      }
    }

    function renderEmpty(message) {
      nameEl.textContent = t('sensor', 'title');
      bodyEl.innerHTML = `<div class="llw-sensor__empty">${message}</div>`;
    }

    function render(entity) {
      const attrs = entity.attributes || {};
      const name = attrs.friendly_name || entity.entity_id;
      const unit = attrs.unit_of_measurement || '';
      const value = entity.state === undefined || entity.state === null || entity.state === 'unknown' || entity.state === 'unavailable'
        ? '--'
        : entity.state;

      nameEl.textContent = name;
      bodyEl.innerHTML = `
        <div class="llw-sensor__icon">${iconFor(attrs)}</div>
        <div class="llw-sensor__reading">
          <span class="llw-sensor__value">${escapeHtml(String(value))}</span>
          ${unit ? `<span class="llw-sensor__unit">${escapeHtml(unit)}</span>` : ''}
        </div>
      `;
    }

    function escapeHtml(s) {
      return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function fetchAndRender() {
      if (!entityId) {
        renderEmpty(t('sensor', 'noEntity'));
        return;
      }
      try {
        const entity = await LL.api.get(`api/hass/states/${encodeURIComponent(entityId)}`);
        if (destroyed) return;
        render(entity);
      } catch (err) {
        console.error('[loudllama][sensor] Failed to fetch entity', err);
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

  LL.registerWidget('sensor', {
    name: { en: 'Sensor', da: 'Sensor', de: 'Sensor', sv: 'Sensor', no: 'Sensor' },
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    defaultConfig: () => ({ entity_id: '' }),
    mount,
  });
})();
