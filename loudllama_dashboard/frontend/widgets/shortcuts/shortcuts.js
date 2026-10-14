/*
 * LoudLlama Dashboard - Shortcuts widget.
 *
 * A small grid of one-tap buttons, each wired to one Home Assistant scene
 * or script - "Good night", "Movie night", "Away mode", that sort of thing.
 * Tapping a button just calls scene.turn_on / script.turn_on for that one
 * entity (whichever domain it actually is); neither has any ongoing state
 * worth polling for; so unlike Light/Climate/Media this widget never fetches
 * individual entity states for its own buttons - only the one-off list used
 * to build/rename them.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const POLL_MS = 60 * 1000; // just refreshes friendly names, not any live state

  function domainOf(entityId) {
    const idx = entityId.indexOf('.');
    return idx === -1 ? '' : entityId.slice(0, idx);
  }

  function iconFor(entityId) {
    return domainOf(entityId) === 'script' ? '▶️' : '🎬';
  }

  function mount(el, { config, saveConfig }) {
    let items = Array.isArray(config.items) ? config.items.slice() : [];
    let meta = {}; // entity_id -> { friendly_name }
    let pollTimer = null;
    let destroyed = false;

    el.classList.add('llw-widget-shortcuts');
    el.innerHTML = `
      <div class="llw-shortcuts">
        <div class="llw-shortcuts__head">
          <span class="llw-shortcuts__name">${t('shortcuts', 'title')}</span>
          <button class="llw-shortcuts__gear" type="button" title="${t('shortcuts', 'chooseItems')}">⚙</button>
        </div>
        <div class="llw-shortcuts__grid"></div>
        <div class="llw-shortcuts__settings">
          <label>${t('shortcuts', 'chooseItems')}</label>
          <div class="llw-shortcuts__settings-list"></div>
          <button type="button" class="llw-shortcuts__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const gridEl = el.querySelector('.llw-shortcuts__grid');
    const gearBtn = el.querySelector('.llw-shortcuts__gear');
    const settingsEl = el.querySelector('.llw-shortcuts__settings');
    const settingsListEl = el.querySelector('.llw-shortcuts__settings-list');
    const closeBtn = el.querySelector('.llw-shortcuts__close');

    gearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.add('llw-open');
      loadItemOptions();
    });
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.remove('llw-open');
    });
    settingsEl.addEventListener('click', (ev) => ev.stopPropagation());

    async function loadItemOptions() {
      settingsListEl.innerHTML = '…';
      try {
        const [scenes, scripts] = await Promise.all([
          LL.api.get('api/hass/states?domain=scene'),
          LL.api.get('api/hass/states?domain=script'),
        ]);
        if (destroyed) return;
        const entities = [...scenes, ...scripts];
        entities.forEach((e) => {
          meta[e.entity_id] = { friendly_name: (e.attributes && e.attributes.friendly_name) || e.entity_id };
        });
        if (!entities.length) {
          settingsListEl.innerHTML = `<div class="llw-shortcuts__empty">${t('shortcuts', 'noItemsFound')}</div>`;
          return;
        }
        settingsListEl.innerHTML = entities
          .map(
            (e) => `
            <label>
              <input type="checkbox" value="${e.entity_id}" ${items.includes(e.entity_id) ? 'checked' : ''} />
              ${iconFor(e.entity_id)} ${(e.attributes && e.attributes.friendly_name) || e.entity_id}
            </label>`
          )
          .join('');
        settingsListEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
          cb.addEventListener('change', () => {
            items = Array.from(settingsListEl.querySelectorAll('input[type="checkbox"]:checked')).map((c) => c.value);
            // ...config, not a bare { items } - see weather.js's identical
            // fix for why: saveConfig() replaces the whole saved config.
            saveConfig({ ...config, items });
            renderGrid();
          });
        });
      } catch (err) {
        console.error('[loudllama][shortcuts] Failed to load scene/script list', err);
      }
    }

    function renderGrid() {
      if (!items.length) {
        gridEl.innerHTML = `<div class="llw-shortcuts__empty">${t('shortcuts', 'noItemsSelected')}</div>`;
        return;
      }
      gridEl.innerHTML = items
        .map((id) => `
          <button type="button" class="llw-shortcuts__btn" data-id="${id}">
            <span class="llw-shortcuts__icon">${iconFor(id)}</span>
            <span class="llw-shortcuts__label">${(meta[id] && meta[id].friendly_name) || id}</span>
          </button>`)
        .join('');
      gridEl.querySelectorAll('.llw-shortcuts__btn').forEach((btn) => {
        btn.addEventListener('click', () => fire(btn.dataset.id, btn));
      });
    }

    async function fire(entityId, btn) {
      const domain = domainOf(entityId) === 'script' ? 'script' : 'scene';
      btn.classList.add('is-firing');
      setTimeout(() => btn.classList.remove('is-firing'), 600);
      try {
        await LL.api.post(`api/hass/service/${domain}/turn_on`, { entity_id: entityId });
      } catch (err) {
        console.error('[loudllama][shortcuts] service failed', err);
      }
    }

    async function refreshNames() {
      if (!items.length) return;
      try {
        const entities = await LL.api.get(`api/hass/states?ids=${items.map(encodeURIComponent).join(',')}`);
        if (destroyed) return;
        entities.forEach((e) => {
          meta[e.entity_id] = { friendly_name: (e.attributes && e.attributes.friendly_name) || e.entity_id };
        });
        renderGrid();
      } catch (err) {
        console.error('[loudllama][shortcuts] Failed to refresh names', err);
      }
    }

    renderGrid();
    refreshNames();
    pollTimer = setInterval(refreshNames, POLL_MS);

    el._llwCleanup = () => {
      destroyed = true;
      clearInterval(pollTimer);
    };
  }

  LL.registerWidget('shortcuts', {
    name: { en: 'Shortcuts', da: 'Genveje', de: 'Verknüpfungen', sv: 'Genvägar', no: 'Genveier' },
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 2, h: 2 },
    defaultConfig: () => ({ items: [] }),
    mount,
  });
})();
