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
  const LIVE_FALLBACK_REFRESH_MS = 600;
  const LIVE_STREAM_TIMEOUT_MS = 4000;
  const CAMERA_ASPECT = 16 / 9;

  // Picks the column count that lets `n` same-aspect-ratio tiles fill a
  // width x height box as large as possible, instead of a fixed
  // auto-fill/minmax CSS grid that doesn't know or care how many cameras
  // are actually in it - 1 camera should get to fill nearly the whole
  // widget, 9 cameras should pack into a tight grid, and the widget's own
  // size (via GridStack resize) should feed back into all of that too, not
  // just the camera count. Same idea most video-call grids use.
  function bestColumnCount(n, width, height) {
    if (n <= 0) return 1;
    if (!(width > 0) || !(height > 0)) return Math.min(n, 3);
    let bestCols = 1;
    let bestArea = -1;
    for (let cols = 1; cols <= n; cols += 1) {
      const rows = Math.ceil(n / cols);
      const cellW = width / cols;
      const cellH = cellW / CAMERA_ASPECT;
      const totalH = cellH * rows;
      const scale = totalH > height ? height / totalH : 1;
      const area = cellW * scale * (cellH * scale);
      if (area > bestArea) {
        bestArea = area;
        bestCols = cols;
      }
    }
    return bestCols;
  }

  function mount(el, { config, saveConfig }) {
    let cameras = Array.isArray(config.cameras) ? config.cameras.slice() : [];
    let cameraMeta = {}; // entity_id -> { friendly_name }
    let refreshTimer = null;
    let resizeObserver = null;
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

    // Recomputes and applies the grid's column count from the widget's
    // *current* rendered size - called after every render and again
    // whenever the widget itself gets resized (see the ResizeObserver
    // below), so the camera tiles always adapt to both how many cameras
    // are shown and how big the widget currently is, not just one or the
    // other.
    function layoutGrid() {
      if (!cameras.length) return;
      const rect = gridEl.getBoundingClientRect();
      const cols = bestColumnCount(cameras.length, rect.width, rect.height);
      gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    }

    function renderGrid() {
      clearInterval(refreshTimer);
      if (!cameras.length) {
        gridEl.style.gridTemplateColumns = '';
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
      layoutGrid();

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
      clearTimeout(activeModal._llwWatchdog);
      clearInterval(activeModal._llwFallbackTimer);
      activeModal.remove();
      activeModal = null;
    }

    function onModalKeydown(ev) {
      if (ev.key === 'Escape') closeFullscreen();
    }

    // True MJPEG streaming (HA's /api/camera_proxy_stream, proxied through
    // our own /api/hass/camera_stream) is tried first - when it works it's
    // smooth and near-instant. The catch: a proxy that responds but never
    // actually sends a valid multipart frame (some camera integrations
    // don't implement HA's async MJPEG helper the same way Frigate's own
    // snapshot endpoint does) never fires the <img>'s `error` event either
    // - it just sits there blank forever, which is exactly the "click a
    // camera and nothing happens" symptom. So: if the stream hasn't
    // produced a first frame within a few seconds (or errors out sooner),
    // fall back to polling plain snapshots quickly enough to read as
    // "live" - strictly worse than true MJPEG, but it always ends up
    // showing a moving picture instead of a dead tile.
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
        <img class="llw-frigate-modal__img" alt="${cameraLabel(entityId)}" />
      `;
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeFullscreen();
      });
      modal.querySelector('.llw-frigate-modal__close').addEventListener('click', closeFullscreen);
      document.body.appendChild(modal);
      document.addEventListener('keydown', onModalKeydown);
      activeModal = modal;

      const img = modal.querySelector('.llw-frigate-modal__img');
      let usingFallback = false;
      let streamLoaded = false;

      function startFallback() {
        if (usingFallback || destroyed) return;
        usingFallback = true;
        clearTimeout(modal._llwWatchdog);
        const refresh = () => {
          img.src = `api/hass/camera_snapshot/${encodeURIComponent(entityId)}?t=${Date.now()}`;
        };
        refresh();
        modal._llwFallbackTimer = setInterval(refresh, LIVE_FALLBACK_REFRESH_MS);
      }

      img.addEventListener('load', () => {
        streamLoaded = true;
        clearTimeout(modal._llwWatchdog);
      });
      img.addEventListener('error', () => {
        if (!streamLoaded) startFallback();
      });
      modal._llwWatchdog = setTimeout(() => {
        if (!streamLoaded) startFallback();
      }, LIVE_STREAM_TIMEOUT_MS);

      img.src = `api/hass/camera_stream/${encodeURIComponent(entityId)}?t=${Date.now()}`;
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

    // Reacts to the widget itself being resized (dragged/resized on the
    // GridStack grid) so the camera tiles re-pack immediately instead of
    // staying sized for whatever the widget's dimensions were when it was
    // first rendered.
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => layoutGrid());
      resizeObserver.observe(el);
    }

    el._llwCleanup = () => {
      destroyed = true;
      clearInterval(refreshTimer);
      if (resizeObserver) resizeObserver.disconnect();
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
