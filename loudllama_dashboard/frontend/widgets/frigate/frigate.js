/*
 * LoudLlama Dashboard - Frigate camera widget.
 *
 * - Shows a mini-grid of camera thumbnails (HA `camera.*` entities, which is
 *   how Frigate exposes each of its cameras inside Home Assistant).
 * - Thumbnails are periodically-refreshed snapshots (cheap, works well with
 *   many cameras at once); clicking one opens a fullscreen popup with the
 *   camera's live MJPEG stream.
 * - Everything goes through the backend's HA proxy - the widget never talks
 *   to Frigate directly, so it works the same way regardless of how/where
 *   Frigate itself is installed.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const THUMBNAIL_REFRESH_MS = 8000;

  function mount(el, { config, saveConfig }) {
    let cameras = Array.isArray(config.cameras) ? config.cameras.slice() : [];
    let cameraMeta = {}; // entity_id -> { friendly_name }
    let refreshTimer = null;
    let destroyed = false;
    let activeModal = null;

    el.classList.add('llw-widget-frigate');
    el.innerHTML = `
      <div class="llw-frigate">
        <div class="llw-frigate__head">
          <span class="llw-frigate__title">${t('frigate', 'title')}</span>
          <button class="llw-frigate__gear" type="button">⚙</button>
        </div>
        <div class="llw-frigate__grid"></div>
        <div class="llw-frigate__settings">
          <label>${t('frigate', 'chooseCameras')}</label>
          <div class="llw-frigate__settings-list"></div>
          <button type="button" class="llw-frigate__close-settings">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const gridEl = el.querySelector('.llw-frigate__grid');
    const gearBtn = el.querySelector('.llw-frigate__gear');
    const settingsEl = el.querySelector('.llw-frigate__settings');
    const settingsListEl = el.querySelector('.llw-frigate__settings-list');
    const closeSettingsBtn = el.querySelector('.llw-frigate__close-settings');

    gearBtn.addEventListener('click', () => {
      settingsEl.classList.add('llw-open');
      loadCameraOptions();
    });
    closeSettingsBtn.addEventListener('click', () => settingsEl.classList.remove('llw-open'));

    async function loadCameraOptions() {
      settingsListEl.innerHTML = '…';
      try {
        const entities = await LL.api.get('api/hass/states?domain=camera');
        if (destroyed) return;
        entities.forEach((e) => {
          cameraMeta[e.entity_id] = { friendly_name: (e.attributes && e.attributes.friendly_name) || e.entity_id };
        });
        if (!entities.length) {
          settingsListEl.innerHTML = `<div class="llw-frigate__empty">${t('frigate', 'noCamerasFound')}</div>`;
          return;
        }
        settingsListEl.innerHTML = entities
          .map(
            (e) => `
            <label>
              <input type="checkbox" value="${e.entity_id}" ${cameras.includes(e.entity_id) ? 'checked' : ''} />
              ${(e.attributes && e.attributes.friendly_name) || e.entity_id}
            </label>`
          )
          .join('');
        settingsListEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
          cb.addEventListener('change', () => {
            cameras = Array.from(settingsListEl.querySelectorAll('input[type="checkbox"]:checked')).map((c) => c.value);
            saveConfig({ cameras });
            renderGrid();
          });
        });
      } catch (err) {
        console.error('[loudllama][frigate] Failed to load camera list', err);
      }
    }

    function cameraLabel(entityId) {
      return (cameraMeta[entityId] && cameraMeta[entityId].friendly_name) || entityId;
    }

    function renderGrid() {
      clearInterval(refreshTimer);
      if (!cameras.length) {
        gridEl.innerHTML = `<div class="llw-frigate__empty">${t('frigate', 'noCameras')}</div>`;
        return;
      }
      gridEl.innerHTML = cameras
        .map(
          (id) => `
          <button type="button" class="llw-frigate__cam" data-entity="${id}">
            <img alt="${cameraLabel(id)}" src="api/hass/camera_snapshot/${encodeURIComponent(id)}?t=${Date.now()}" />
            <span class="llw-frigate__cam-label">${cameraLabel(id)}</span>
          </button>`
        )
        .join('');

      gridEl.querySelectorAll('.llw-frigate__cam').forEach((cell) => {
        cell.addEventListener('click', () => openFullscreen(cell.dataset.entity));
      });

      refreshTimer = setInterval(() => {
        gridEl.querySelectorAll('.llw-frigate__cam img').forEach((img) => {
          const id = img.closest('.llw-frigate__cam').dataset.entity;
          img.src = `api/hass/camera_snapshot/${encodeURIComponent(id)}?t=${Date.now()}`;
        });
      }, THUMBNAIL_REFRESH_MS);
    }

    function closeFullscreen() {
      if (!activeModal) return;
      document.removeEventListener('keydown', onModalKeydown);
      activeModal.remove();
      activeModal = null;
    }

    function onModalKeydown(ev) {
      if (ev.key === 'Escape') closeFullscreen();
    }

    function openFullscreen(entityId) {
      closeFullscreen();
      const modal = document.createElement('div');
      modal.className = 'llw-frigate-modal';
      modal.innerHTML = `
        <div class="llw-frigate-modal__head">
          <div class="llw-frigate-modal__title">
            <span class="llw-frigate-modal__live"><span class="llw-frigate-modal__live-dot"></span>${t('frigate', 'live')}</span>
            <span>${cameraLabel(entityId)}</span>
          </div>
          <button type="button" class="llw-frigate-modal__close" title="${t('frigate', 'close')}" aria-label="${t('frigate', 'close')}">×</button>
        </div>
        <img class="llw-frigate-modal__img" src="api/hass/camera_stream/${encodeURIComponent(entityId)}" alt="${cameraLabel(entityId)}" />
      `;
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeFullscreen();
      });
      modal.querySelector('.llw-frigate-modal__close').addEventListener('click', closeFullscreen);
      modal.querySelector('.llw-frigate-modal__img').addEventListener('error', () => {
        modal.querySelector('.llw-frigate-modal__img').alt = t('frigate', 'snapshotError');
      });
      document.body.appendChild(modal);
      document.addEventListener('keydown', onModalKeydown);
      activeModal = modal;
    }

    // Pre-warm friendly names (so grid labels are correct even before the
    // settings panel has been opened once) and render the initial grid.
    LL.api
      .get('api/hass/states?domain=camera')
      .then((entities) => {
        entities.forEach((e) => {
          cameraMeta[e.entity_id] = { friendly_name: (e.attributes && e.attributes.friendly_name) || e.entity_id };
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!destroyed) renderGrid();
      });

    el._llwCleanup = () => {
      destroyed = true;
      clearInterval(refreshTimer);
      closeFullscreen();
    };
  }

  LL.registerWidget('frigate', {
    name: { en: 'Cameras (Frigate)', da: 'Kameraer (Frigate)', de: 'Kameras (Frigate)', sv: 'Kameror (Frigate)', no: 'Kameraer (Frigate)' },
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
    defaultConfig: () => ({ cameras: [] }),
    mount,
  });
})();
