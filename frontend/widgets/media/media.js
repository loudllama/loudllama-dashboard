/*
 * LoudLlama Dashboard - Media widget.
 *
 * A single-entity tile for a `media_player.*` entity - Sonos and most other
 * speaker/media integrations all expose themselves this way in Home
 * Assistant. Play/pause, volume, and the current track if HA reports one.
 * Same self-contained shape as Weather/Light/Climate - works standalone on
 * the main dashboard, or mounted inside a Room widget's nested grid.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const POLL_MS = 15 * 1000;
  const RECONCILE_DELAY_MS = 900;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function mount(el, { config, saveConfig }) {
    let entityId = config.entity_id || '';
    let entity = null;
    let pollTimer = null;
    let destroyed = false;

    el.classList.add('llw-widget-media');
    el.innerHTML = `
      <div class="llw-media">
        <div class="llw-media__head">
          <span class="llw-media__name">${t('media', 'chooseEntity')}</span>
          <button class="llw-media__gear" type="button" title="${t('media', 'chooseEntity')}">⚙</button>
        </div>
        <div class="llw-media__body"></div>
        <div class="llw-media__settings">
          <label>${t('media', 'chooseEntity')}</label>
          <select class="llw-media__select"><option value="">…</option></select>
          <button type="button" class="llw-media__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const nameEl = el.querySelector('.llw-media__name');
    const bodyEl = el.querySelector('.llw-media__body');
    const gearBtn = el.querySelector('.llw-media__gear');
    const settingsEl = el.querySelector('.llw-media__settings');
    const selectEl = el.querySelector('.llw-media__select');
    const closeBtn = el.querySelector('.llw-media__close');

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
        const entities = await LL.api.get('api/hass/states?domain=media_player');
        if (destroyed) return;
        if (!entities.length) {
          selectEl.innerHTML = `<option value="">${t('media', 'noEntities')}</option>`;
          return;
        }
        selectEl.innerHTML = entities
          .map((e) => `<option value="${e.entity_id}" ${e.entity_id === entityId ? 'selected' : ''}>${(e.attributes && e.attributes.friendly_name) || e.entity_id}</option>`)
          .join('');
      } catch (err) {
        console.error('[loudllama][media] Failed to load entity list', err);
      }
    }

    function renderEmpty(message) {
      nameEl.textContent = t('media', 'chooseEntity');
      bodyEl.innerHTML = `<div class="llw-media__empty">${message}</div>`;
    }

    function render() {
      if (!entity) return;
      const name = (entity.attributes && entity.attributes.friendly_name) || entity.entity_id;
      const playing = entity.state === 'playing';
      const stateKey = ['playing', 'paused', 'idle'].includes(entity.state) ? entity.state : 'idle';
      const vol = entity.attributes && entity.attributes.volume_level;
      const title = entity.attributes && entity.attributes.media_title;
      const artist = entity.attributes && entity.attributes.media_artist;
      const track = title ? `${escapeHtml(title)}${artist ? ` — ${escapeHtml(artist)}` : ''}` : t('room', `states.${stateKey}`);

      nameEl.textContent = name;
      bodyEl.innerHTML = `
        <div class="llw-media__track" title="${track}">${track}</div>
        <button type="button" class="llw-media__playpause ${playing ? 'is-playing' : ''}" aria-label="${name}">${playing ? '⏸' : '▶'}</button>
        ${vol !== undefined && vol !== null ? `<input type="range" class="llw-media__volume" min="0" max="100" value="${Math.round(vol * 100)}" />` : ''}
      `;

      bodyEl.querySelector('.llw-media__playpause').addEventListener('click', () => {
        const next = entity.state !== 'playing';
        optimisticMutate((e) => { e.state = next ? 'playing' : 'paused'; });
        callService('media_play_pause');
      });
      const volume = bodyEl.querySelector('.llw-media__volume');
      if (volume) {
        volume.addEventListener('click', (ev) => ev.stopPropagation());
        volume.addEventListener('input', () => {
          optimisticMutate((e) => { e.attributes.volume_level = Number(volume.value) / 100; });
        });
        volume.addEventListener('change', () => {
          callService('volume_set', { volume_level: Number(volume.value) / 100 });
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
        await LL.api.post(`api/hass/service/media_player/${service}`, { entity_id: entityId, ...(extra || {}) });
      } catch (err) {
        console.error('[loudllama][media] service failed', err);
      } finally {
        setTimeout(() => {
          if (!destroyed) fetchAndRender();
        }, RECONCILE_DELAY_MS);
      }
    }

    async function fetchAndRender() {
      if (!entityId) {
        renderEmpty(t('media', 'noEntity'));
        return;
      }
      try {
        entity = await LL.api.get(`api/hass/states/${encodeURIComponent(entityId)}`);
        if (destroyed) return;
        render();
      } catch (err) {
        console.error('[loudllama][media] Failed to fetch entity', err);
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

  LL.registerWidget('media', {
    name: { en: 'Speaker', da: 'Højtaler', de: 'Lautsprecher', sv: 'Högtalare', no: 'Høyttaler' },
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    defaultConfig: () => ({ entity_id: '' }),
    mount,
  });
})();
