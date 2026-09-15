/*
 * LoudLlama Dashboard - Climate widget.
 *
 * A single-entity tile for a `climate.*` entity (thermostats - Tado and
 * friends all expose themselves this way in Home Assistant, so this works
 * regardless of brand): current temperature + a +/- stepper on the target.
 * Same self-contained shape as Weather/Light - works standalone on the main
 * dashboard, or mounted inside a Room widget's nested grid.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const POLL_MS = 15 * 1000;
  const RECONCILE_DELAY_MS = 900;
  const STEP = 0.5;

  function mount(el, { config, saveConfig }) {
    let entityId = config.entity_id || '';
    let entity = null;
    let pollTimer = null;
    let destroyed = false;

    el.classList.add('llw-widget-climate');
    el.innerHTML = `
      <div class="llw-climate">
        <div class="llw-climate__head">
          <span class="llw-climate__name">${t('climate', 'chooseEntity')}</span>
          <button class="llw-climate__gear" type="button" title="${t('climate', 'chooseEntity')}">⚙</button>
        </div>
        <div class="llw-climate__body"></div>
        <div class="llw-climate__settings">
          <label>${t('climate', 'chooseEntity')}</label>
          <select class="llw-climate__select"><option value="">…</option></select>
          <button type="button" class="llw-climate__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const nameEl = el.querySelector('.llw-climate__name');
    const bodyEl = el.querySelector('.llw-climate__body');
    const gearBtn = el.querySelector('.llw-climate__gear');
    const settingsEl = el.querySelector('.llw-climate__settings');
    const selectEl = el.querySelector('.llw-climate__select');
    const closeBtn = el.querySelector('.llw-climate__close');

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
      saveConfig({ entity_id: entityId });
      settingsEl.classList.remove('llw-open');
      fetchAndRender();
    });

    async function loadEntityOptions() {
      selectEl.innerHTML = `<option value="">…</option>`;
      try {
        const entities = await LL.api.get('api/hass/states?domain=climate');
        if (destroyed) return;
        if (!entities.length) {
          selectEl.innerHTML = `<option value="">${t('climate', 'noEntities')}</option>`;
          return;
        }
        selectEl.innerHTML = entities
          .map((e) => `<option value="${e.entity_id}" ${e.entity_id === entityId ? 'selected' : ''}>${(e.attributes && e.attributes.friendly_name) || e.entity_id}</option>`)
          .join('');
      } catch (err) {
        console.error('[loudllama][climate] Failed to load entity list', err);
      }
    }

    function renderEmpty(message) {
      nameEl.textContent = t('climate', 'chooseEntity');
      bodyEl.innerHTML = `<div class="llw-climate__empty">${message}</div>`;
    }

    function render() {
      if (!entity) return;
      const name = (entity.attributes && entity.attributes.friendly_name) || entity.entity_id;
      const current = entity.attributes && entity.attributes.current_temperature;
      const target = entity.attributes && entity.attributes.temperature;

      nameEl.textContent = name;
      bodyEl.innerHTML = `
        <div class="llw-climate__current">${current !== undefined && current !== null ? `${Math.round(current * 10) / 10}°` : '--'}</div>
        <div class="llw-climate__stepper">
          <button type="button" class="llw-climate__dec" aria-label="-">−</button>
          <span class="llw-climate__target">${target !== undefined && target !== null ? `${Math.round(target * 10) / 10}°` : '--'}</span>
          <button type="button" class="llw-climate__inc" aria-label="+">+</button>
        </div>
      `;
      bodyEl.querySelector('.llw-climate__inc').addEventListener('click', () => step(STEP));
      bodyEl.querySelector('.llw-climate__dec').addEventListener('click', () => step(-STEP));
    }

    function step(delta) {
      const base = (entity.attributes && entity.attributes.temperature) || 20;
      const next = Math.round((base + delta) * 10) / 10;
      optimisticMutate((e) => { e.attributes.temperature = next; });
      callService('set_temperature', { temperature: next });
    }

    function optimisticMutate(patchFn) {
      if (!entity) return;
      patchFn(entity);
      render();
    }

    async function callService(service, extra) {
      try {
        await LL.api.post(`api/hass/service/climate/${service}`, { entity_id: entityId, ...(extra || {}) });
      } catch (err) {
        console.error('[loudllama][climate] service failed', err);
      } finally {
        setTimeout(() => {
          if (!destroyed) fetchAndRender();
        }, RECONCILE_DELAY_MS);
      }
    }

    async function fetchAndRender() {
      if (!entityId) {
        renderEmpty(t('climate', 'noEntity'));
        return;
      }
      try {
        entity = await LL.api.get(`api/hass/states/${encodeURIComponent(entityId)}`);
        if (destroyed) return;
        render();
      } catch (err) {
        console.error('[loudllama][climate] Failed to fetch entity', err);
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

  LL.registerWidget('climate', {
    name: { en: 'Thermostat', da: 'Termostat', de: 'Thermostat', sv: 'Termostat', no: 'Termostat' },
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    defaultConfig: () => ({ entity_id: '' }),
    mount,
  });
})();
