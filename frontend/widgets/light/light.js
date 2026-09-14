/*
 * LoudLlama Dashboard - Light widget.
 *
 * A single-entity tile: on/off + brightness (when the light supports it).
 * Same shape as Weather/Frigate (self-contained, polls the HA proxy, own
 * settings panel to pick an entity) with one extra trick: because mounting
 * only needs a DOM element + {config, saveConfig}, this exact same widget
 * can be dropped straight onto the main dashboard *or* mounted inside a
 * Room widget's nested grid (see widgets/room/room.js) - it has no idea
 * which one it's in, and doesn't need to.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const POLL_MS = 15 * 1000;
  const RECONCILE_DELAY_MS = 900;

  function mount(el, { config, saveConfig }) {
    let entityId = config.entity_id || '';
    let entity = null;
    let pollTimer = null;
    let destroyed = false;

    el.classList.add('llw-widget-light');
    el.innerHTML = `
      <div class="llw-light">
        <div class="llw-light__head">
          <span class="llw-light__name">${t('light', 'chooseEntity')}</span>
          <button class="llw-light__gear" type="button" title="${t('light', 'chooseEntity')}">⚙</button>
        </div>
        <div class="llw-light__body"></div>
        <div class="llw-light__settings">
          <label>${t('light', 'chooseEntity')}</label>
          <select class="llw-light__select"><option value="">…</option></select>
          <button type="button" class="llw-light__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const rootEl = el.querySelector('.llw-light');
    const nameEl = el.querySelector('.llw-light__name');
    const bodyEl = el.querySelector('.llw-light__body');
    const gearBtn = el.querySelector('.llw-light__gear');
    const settingsEl = el.querySelector('.llw-light__settings');
    const selectEl = el.querySelector('.llw-light__select');
    const closeBtn = el.querySelector('.llw-light__close');

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
        const entities = await LL.api.get('api/hass/states?domain=light');
        if (destroyed) return;
        if (!entities.length) {
          selectEl.innerHTML = `<option value="">${t('light', 'noEntities')}</option>`;
          return;
        }
        selectEl.innerHTML = entities
          .map((e) => `<option value="${e.entity_id}" ${e.entity_id === entityId ? 'selected' : ''}>${(e.attributes && e.attributes.friendly_name) || e.entity_id}</option>`)
          .join('');
      } catch (err) {
        console.error('[loudllama][light] Failed to load entity list', err);
      }
    }

    function renderEmpty(message) {
      rootEl.classList.remove('llw-light--on');
      nameEl.textContent = t('light', 'chooseEntity');
      bodyEl.innerHTML = `<div class="llw-light__empty">${message}</div>`;
    }

    function render() {
      if (!entity) return;
      const name = (entity.attributes && entity.attributes.friendly_name) || entity.entity_id;
      const isOn = entity.state === 'on';
      const hasBrightness = entity.attributes && entity.attributes.brightness !== undefined && entity.attributes.brightness !== null;
      const pct = hasBrightness ? Math.round(((entity.attributes.brightness || 0) / 255) * 100) : 0;

      nameEl.textContent = name;
      rootEl.classList.toggle('llw-light--on', isOn);
      bodyEl.innerHTML = `
        <button type="button" class="llw-light__toggle ${isOn ? 'is-on' : ''}" aria-label="${name}">
          <span class="llw-light__bulb">💡</span>
        </button>
        ${hasBrightness ? `<input type="range" class="llw-light__slider" min="1" max="100" value="${pct}" ${isOn ? '' : 'disabled'} />` : ''}
      `;

      bodyEl.querySelector('.llw-light__toggle').addEventListener('click', () => {
        const on = entity.state !== 'on';
        optimisticMutate((e) => { e.state = on ? 'on' : 'off'; });
        callService(on ? 'turn_on' : 'turn_off');
      });
      const slider = bodyEl.querySelector('.llw-light__slider');
      if (slider) {
        slider.addEventListener('click', (ev) => ev.stopPropagation());
        slider.addEventListener('input', () => {
          optimisticMutate((e) => {
            e.state = 'on';
            e.attributes.brightness = Math.round((Number(slider.value) / 100) * 255);
          });
        });
        slider.addEventListener('change', () => {
          callService('turn_on', { brightness_pct: Number(slider.value) });
        });
      }
    }

    function optimisticMutate(patchFn) {
      if (!entity) return;
      patchFn(entity);
      render();
    }

    async function callService(service, extra) {
      try {
        await LL.api.post(`api/hass/service/light/${service}`, { entity_id: entityId, ...(extra || {}) });
      } catch (err) {
        console.error('[loudllama][light] service failed', err);
      } finally {
        setTimeout(() => {
          if (!destroyed) fetchAndRender();
        }, RECONCILE_DELAY_MS);
      }
    }

    async function fetchAndRender() {
      if (!entityId) {
        renderEmpty(t('light', 'noEntity'));
        return;
      }
      try {
        entity = await LL.api.get(`api/hass/states/${encodeURIComponent(entityId)}`);
        if (destroyed) return;
        render();
      } catch (err) {
        console.error('[loudllama][light] Failed to fetch entity', err);
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

  LL.registerWidget('light', {
    name: { en: 'Light', da: 'Lys', de: 'Licht', sv: 'Belysning', no: 'Lys' },
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    defaultConfig: () => ({ entity_id: '' }),
    mount,
  });
})();
