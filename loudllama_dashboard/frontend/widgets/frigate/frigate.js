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

  // Frigate is the one widget type that was explicitly excluded from the
  // full/compact size-picker pattern every other widget got (see app.js's
  // showSizePicker/sizeVariants): instead of asking the user to pick a size
  // up front, the widget's own GridStack cell grows and shrinks on its own
  // as cameras are added/removed below. Tiers are deliberately coarse
  // (jumping the grid size on every single checkbox tick would feel janky)
  // and start at the widget's own minSize so a 0/1-camera widget never gets
  // smaller than that. Columns top out at 12, matching the page's own grid.
  function sizeForCameraCount(n) {
    if (n <= 1) return { w: 3, h: 3 };
    if (n === 2) return { w: 5, h: 3 };
    if (n <= 4) return { w: 6, h: 5 };
    if (n <= 6) return { w: 8, h: 5 };
    if (n <= 9) return { w: 9, h: 6 };
    return { w: 10, h: 7 };
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
          <button class="llw-frigate__gear" type="button" title="${t('frigate', 'chooseCameras')}">⚙</button>
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
            // ...config, not a bare { cameras } - see weather.js's identical
            // fix for why: saveConfig() replaces the whole saved config, so
            // any other field this widget picks up later would otherwise be
            // silently dropped the moment the camera selection changes.
            saveConfig({ ...config, cameras });
            applyAutoSize();
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

    // Resizes the widget's own GridStack cell to match the current camera
    // count (see sizeForCameraCount above) - a no-op when the widget isn't
    // mounted on a GridStack grid at all (e.g. a preview context) or when
    // the computed size already matches what's there. Manual resize is
    // gone for every widget (see app.js's createPage comment), and Frigate
    // never got a size picker either, so this is the only thing that ever
    // changes this widget's size.
    function applyAutoSize() {
      const itemEl = el.closest('.grid-stack-item');
      const gridRoot = itemEl && itemEl.closest('.grid-stack');
      const gs = gridRoot && gridRoot.gridstack;
      if (!itemEl || !gs) return;
      const target = sizeForCameraCount(cameras.length);
      const node = itemEl.gridstackNode;
      if (node && node.w === target.w && node.h === target.h) return;
      gs.update(itemEl, { w: target.w, h: target.h });
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
      const modalEl = activeModal;
      activeModal = null;
      // Play the close animation (see .llw-frigate-modal--closing in
      // frigate.css) instead of just vanishing, then remove once it's done.
      modalEl.classList.add('llw-frigate-modal--closing');
      LL.waitForExitAnimation(modalEl, 250).then(() => modalEl.remove());
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
    // Formats a Frigate event's unix timestamp (seconds) the same way the
    // rest of the dashboard formats times - using the *dashboard's* current
    // locale, not a hardcoded one (see weather.js's formatForecastTime).
    function formatEventTime(unixSeconds) {
      const d = new Date(unixSeconds * 1000);
      if (Number.isNaN(d.getTime())) return '';
      const locale = LL.i18n.lang;
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      return sameDay
        ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    function eventLabel(ev) {
      // Frigate's own label (e.g. "person", "car") - Home Assistant doesn't
      // translate these, so we just capitalize rather than mistranslate.
      const raw = ev.label || '';
      return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
    }

    // A modal has one of three views open at a time: the live stream, the
    // events list for its camera, or a single event's clip. All three share
    // the same popup shell/header so switching between them never closes
    // and reopens the modal - just swaps its body and header controls,
    // which is what makes "go back and look at recordings, then back to
    // live" feel like one continuous place rather than three dialogs.
    function openFullscreen(entityId) {
      closeFullscreen();
      const modal = document.createElement('div');
      modal.className = 'llw-frigate-modal';
      modal.innerHTML = `
        <div class="llw-frigate-modal__head">
          <div class="llw-frigate-modal__title">
            <span class="llw-frigate-modal__live"><span class="llw-frigate-modal__live-dot"></span>${t('frigate', 'live')}</span>
            <span class="llw-frigate-modal__camname">${cameraLabel(entityId)}</span>
          </div>
          <div class="llw-frigate-modal__actions">
            <button type="button" class="llw-frigate-modal__events-btn">${t('frigate', 'events')}</button>
            <button type="button" class="llw-frigate-modal__close" title="${t('frigate', 'close')}" aria-label="${t('frigate', 'close')}">×</button>
          </div>
        </div>
        <div class="llw-frigate-modal__body">
          <img class="llw-frigate-modal__img" alt="${cameraLabel(entityId)}" />
        </div>
      `;
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeFullscreen();
      });
      modal.querySelector('.llw-frigate-modal__close').addEventListener('click', closeFullscreen);
      document.body.appendChild(modal);
      document.addEventListener('keydown', onModalKeydown);
      activeModal = modal;

      const titleEl = modal.querySelector('.llw-frigate-modal__title');
      const bodyEl = modal.querySelector('.llw-frigate-modal__body');
      const eventsBtn = modal.querySelector('.llw-frigate-modal__events-btn');

      function stopLive() {
        clearTimeout(modal._llwWatchdog);
        clearInterval(modal._llwFallbackTimer);
      }

      function showLive() {
        stopLive();
        titleEl.innerHTML = `
          <span class="llw-frigate-modal__live"><span class="llw-frigate-modal__live-dot"></span>${t('frigate', 'live')}</span>
          <span class="llw-frigate-modal__camname">${cameraLabel(entityId)}</span>
        `;
        eventsBtn.textContent = t('frigate', 'events');
        eventsBtn.onclick = showEvents;
        bodyEl.innerHTML = `<img class="llw-frigate-modal__img" alt="${cameraLabel(entityId)}" />`;
        const img = bodyEl.querySelector('.llw-frigate-modal__img');
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

      async function showEvents() {
        stopLive();
        titleEl.innerHTML = `<span class="llw-frigate-modal__camname">${t('frigate', 'events')} — ${cameraLabel(entityId)}</span>`;
        eventsBtn.textContent = t('frigate', 'backToLive');
        eventsBtn.onclick = showLive;
        bodyEl.innerHTML = `<div class="llw-frigate-modal__loading">${t('app', 'loading')}</div>`;
        try {
          const events = await LL.api.get(`api/hass/frigate/events?cameras=${encodeURIComponent(entityId)}&limit=20`);
          if (destroyed || !activeModal) return;
          if (!events.length) {
            bodyEl.innerHTML = `<div class="llw-frigate-modal__loading">${t('frigate', 'noEvents')}</div>`;
            return;
          }
          bodyEl.innerHTML = `<div class="llw-frigate-modal__events"></div>`;
          const listEl = bodyEl.querySelector('.llw-frigate-modal__events');
          listEl.innerHTML = events
            .map(
              (ev) => `
              <button type="button" class="llw-frigate-modal__event" data-event-id="${ev.id}" ${ev.has_clip ? '' : 'disabled'}>
                <img loading="lazy" alt="${eventLabel(ev)}" src="api/hass/frigate/media/${encodeURIComponent(ev.id)}/thumbnail" />
                <span class="llw-frigate-modal__event-info">
                  <span class="llw-frigate-modal__event-label">${eventLabel(ev)}</span>
                  <span class="llw-frigate-modal__event-time">${formatEventTime(ev.start_time)}</span>
                </span>
              </button>`
            )
            .join('');
          listEl.querySelectorAll('.llw-frigate-modal__event').forEach((btn) => {
            btn.addEventListener('click', () => showClip(btn.dataset.eventId, events.find((e) => String(e.id) === btn.dataset.eventId)));
          });
        } catch (err) {
          console.error('[loudllama][frigate] Failed to load events', err);
          if (!destroyed && activeModal) bodyEl.innerHTML = `<div class="llw-frigate-modal__loading">${t('frigate', 'eventsError')}</div>`;
        }
      }

      function showClip(eventId, ev) {
        stopLive();
        titleEl.innerHTML = `<span class="llw-frigate-modal__camname">${eventLabel(ev)} — ${formatEventTime(ev && ev.start_time)}</span>`;
        eventsBtn.textContent = t('frigate', 'events');
        eventsBtn.onclick = showEvents;
        bodyEl.innerHTML = `
          <video class="llw-frigate-modal__video" src="api/hass/frigate/media/${encodeURIComponent(eventId)}/clip" controls autoplay playsinline></video>
        `;
        const video = bodyEl.querySelector('.llw-frigate-modal__video');
        video.addEventListener('error', () => {
          if (!destroyed && activeModal) bodyEl.innerHTML = `<div class="llw-frigate-modal__loading">${t('frigate', 'clipUnavailable')}</div>`;
        });
      }

      showLive();
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
        if (!destroyed) {
          applyAutoSize();
          renderGrid();
        }
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
