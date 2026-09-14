/*
 * LoudLlama Dashboard - Room widget.
 *
 * One widget instance = one room. On first add it asks for a name, then
 * which entities belong to the room; from then on it shows a compact
 * "glance" tile, and clicking it opens a rounded fullscreen popup with the
 * room's entities auto-grouped (lights / switches / climate / covers / fans
 * / media / security / sensors / other) and directly controllable - not
 * just a readout.
 *
 * Everything goes through the backend's HA proxy, same as the other
 * widgets, plus one new endpoint: POST /api/hass/service/:domain/:service
 * (a thin passthrough to HA's `POST /api/services/...`) so lights/switches/
 * covers/climate/media/locks can actually be operated from here.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const POLL_MS = 20 * 1000;
  const RECONCILE_DELAY_MS = 900;

  // --- Categorisation -------------------------------------------------------
  // What else is worth indexing for room placement, beyond lights/sensors/
  // speakers: switches (plugs, often not lighting), climate/thermostats
  // (need controls, not just a reading), covers/blinds, fans, vacuums,
  // locks + security-flagged binary sensors (door/window/motion/smoke/etc,
  // kept apart from ordinary numeric sensors since they're "is something
  // wrong" indicators), and a catch-all for scenes/scripts/helpers so a
  // room can carry a quick-action button too.
  const SECURITY_DEVICE_CLASSES = [
    'door', 'window', 'garage_door', 'opening', 'motion', 'moisture',
    'smoke', 'gas', 'safety', 'presence', 'vibration', 'sound', 'tamper',
  ];
  const OPENING_DEVICE_CLASSES = ['door', 'window', 'garage_door', 'opening'];

  const GROUP_ORDER = ['light', 'switch', 'climate', 'cover', 'fan', 'media', 'vacuum', 'security', 'sensor', 'other'];
  const GROUP_ICON = {
    light: '💡', switch: '🔌', climate: '🌡️', cover: '🪟', fan: '🌀',
    media: '🔊', vacuum: '🤖', security: '🔒', sensor: '📊', other: '⚙️',
  };

  function domainOf(entityId) {
    return entityId.split('.')[0];
  }

  function categorize(entity) {
    const domain = domainOf(entity.entity_id);
    const deviceClass = entity.attributes && entity.attributes.device_class;
    if (domain === 'light') return 'light';
    if (domain === 'switch') return 'switch';
    if (domain === 'climate') return 'climate';
    if (domain === 'media_player') return 'media';
    if (domain === 'cover') return 'cover';
    if (domain === 'fan') return 'fan';
    if (domain === 'vacuum') return 'vacuum';
    if (domain === 'lock' || domain === 'alarm_control_panel') return 'security';
    if (domain === 'binary_sensor') return SECURITY_DEVICE_CLASSES.includes(deviceClass) ? 'security' : 'sensor';
    if (domain === 'sensor') return 'sensor';
    return 'other';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function friendlyName(entity) {
    return (entity && entity.attributes && entity.attributes.friendly_name) || (entity && entity.entity_id) || '';
  }

  // --- Sub-widgets (nested grid) ---------------------------------------------
  // Light/climate/media entities in a room don't just get a plain control
  // row like everything else - they get mounted as their own real widgets
  // (frontend/widgets/light, /climate, /media) inside a small GridStack grid
  // of their own, right inside the fullscreen popup. Because a widget only
  // ever needs a DOM element + {config, saveConfig} to mount, the exact same
  // Light/Climate/Media widget code runs here as on the main dashboard - it
  // has no idea it's nested. This is what turns a Room widget into more of
  // a "group of widgets" than a single tile.
  const SUBWIDGET_TYPE_BY_DOMAIN = { light: 'light', climate: 'climate', media_player: 'media' };
  const SUBGRID_COLUMNS = 4;
  const SUBGRID_CELL_HEIGHT = 78;

  // --- Widget lifecycle -------------------------------------------------------
  function mount(el, { config, saveConfig }) {
    let cfg = {
      name: config.name || '',
      entities: Array.isArray(config.entities) ? config.entities.slice() : [],
      // {id, type, x, y, w, h, config} per light/climate/media_player entity
      // - kept in sync with `entities` by syncSubWidgets(). Older saved
      // rooms (from before this existed) just get it derived the first time
      // they're opened, so upgrading never loses anything.
      subWidgets: Array.isArray(config.subWidgets) ? config.subWidgets.slice() : null,
    };
    let liveEntities = {}; // entity_id -> live HA entity
    let pollTimer = null;
    let destroyed = false;
    let activeModal = null;
    let subGrid = null;
    let subWidgetCleanups = [];
    let arranging = false;
    let saveTimer = null;
    let editorDraftName = '';
    let editorDraftEntities = [];

    function scheduleSaveRoom() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveConfig(cfg), 500);
    }

    // Adds/removes sub-widget entries so they match cfg.entities 1:1 for the
    // domains that have a dedicated widget. Never touches x/y/w/h on an
    // entry that already exists, so rearranging in the popup sticks.
    function syncSubWidgets() {
      if (!Array.isArray(cfg.subWidgets)) cfg.subWidgets = [];
      const wanted = new Set();
      cfg.entities.forEach((id) => {
        const type = SUBWIDGET_TYPE_BY_DOMAIN[domainOf(id)];
        if (!type) return;
        wanted.add(id);
        if (!cfg.subWidgets.some((w) => w.config && w.config.entity_id === id)) {
          cfg.subWidgets.push({
            id: `${type}-${id.replace(/[^a-z0-9_]/gi, '')}-${Date.now().toString(36)}`,
            type,
            w: 2,
            h: 2,
            config: { entity_id: id },
          });
        }
      });
      cfg.subWidgets = cfg.subWidgets.filter((w) => w.config && wanted.has(w.config.entity_id));
    }

    // Sub-widget types (light/climate/media) are only actually usable once
    // their script has loaded - and, so they survive a page reload, once
    // they're marked "installed" the same way the widget store would (see
    // LL.ensureWidgetInstalled in app.js). A room full of lights shouldn't
    // silently break just because nobody happened to open the widget store.
    function ensureSubWidgetTypesLoaded() {
      const types = Array.from(new Set(cfg.subWidgets.map((w) => w.type)));
      return Promise.all(
        types.map((type) => {
          const entry = (LL.widgetCatalog || []).find((w) => w.id === type);
          return Promise.all([LL.loadWidgetAssets(entry), LL.ensureWidgetInstalled(type)]);
        })
      );
    }

    el.classList.add('llw-widget-room');
    el.innerHTML = `
      <div class="llw-room">
        <div class="llw-room__bg"></div>
        <div class="llw-room__content">
          <div class="llw-room__head">
            <span class="llw-room__name"></span>
            <button class="llw-room__gear" type="button">⚙</button>
          </div>
          <div class="llw-room__glance"></div>
        </div>
        <div class="llw-room__editor"></div>
      </div>
    `;

    const roomEl = el.querySelector('.llw-room');
    const nameEl = el.querySelector('.llw-room__name');
    const glanceEl = el.querySelector('.llw-room__glance');
    const gearBtn = el.querySelector('.llw-room__gear');
    const editorEl = el.querySelector('.llw-room__editor');

    // --- Editor (setup wizard + later edits) -----------------------------
    function openEditor() {
      editorDraftName = cfg.name;
      editorDraftEntities = cfg.entities.slice();
      editorEl.classList.add('llw-open');
      renderEditorStep1();
    }

    function closeEditor() {
      editorEl.classList.remove('llw-open');
    }

    function renderEditorStep1() {
      const canCancel = !!cfg.name;
      editorEl.innerHTML = `
        <div class="llw-room__editor-inner">
          ${canCancel ? `<button type="button" class="llw-room__editor-close" aria-label="${t('room', 'close')}">×</button>` : ''}
          <label class="llw-room__editor-label">${t('room', 'setupTitle')}</label>
          <input type="text" class="llw-room__name-input" placeholder="${escapeHtml(t('room', 'namePlaceholder'))}" value="${escapeHtml(editorDraftName)}" maxlength="40" />
          <div class="llw-room__editor-actions">
            <button type="button" class="llw-room__next">${t('room', 'next')}</button>
          </div>
        </div>
      `;
      const input = editorEl.querySelector('.llw-room__name-input');
      const goNext = () => {
        const val = input.value.trim();
        if (!val) {
          input.classList.add('llw-shake');
          input.focus();
          setTimeout(() => input.classList.remove('llw-shake'), 300);
          return;
        }
        editorDraftName = val;
        renderEditorStep2();
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') goNext();
      });
      editorEl.querySelector('.llw-room__next').addEventListener('click', goNext);
      if (canCancel) editorEl.querySelector('.llw-room__editor-close').addEventListener('click', closeEditor);
      requestAnimationFrame(() => input.focus());
    }

    function renderEditorStep2() {
      editorEl.innerHTML = `
        <div class="llw-room__editor-inner">
          <label class="llw-room__editor-label">${t('room', 'chooseEntitiesTitle')}</label>
          <input type="text" class="llw-room__search" placeholder="${escapeHtml(t('room', 'searchPlaceholder'))}" />
          <div class="llw-room__editor-list">…</div>
          <div class="llw-room__editor-actions">
            <button type="button" class="llw-room__back">${t('room', 'back')}</button>
            <button type="button" class="llw-room__save">${t('room', 'save')}</button>
          </div>
        </div>
      `;
      const listEl = editorEl.querySelector('.llw-room__editor-list');
      const searchEl = editorEl.querySelector('.llw-room__search');
      let allEntities = [];

      function renderList(filterText) {
        const q = filterText.trim().toLowerCase();
        const filtered = q
          ? allEntities.filter((e) => friendlyName(e).toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q))
          : allEntities;
        if (!filtered.length) {
          listEl.innerHTML = `<div class="llw-room__empty-msg">${t('room', 'noEntitiesFound')}</div>`;
          return;
        }
        const byGroup = {};
        filtered.forEach((e) => {
          const g = categorize(e);
          (byGroup[g] = byGroup[g] || []).push(e);
        });
        listEl.innerHTML = GROUP_ORDER.filter((g) => byGroup[g] && byGroup[g].length)
          .map(
            (g) => `
            <div class="llw-room__editor-group">
              <div class="llw-room__editor-group-label">${GROUP_ICON[g]} ${t('room', `groups.${g}`)}</div>
              ${byGroup[g]
                .map(
                  (e) => `
                <label class="llw-room__editor-row">
                  <input type="checkbox" value="${e.entity_id}" ${editorDraftEntities.includes(e.entity_id) ? 'checked' : ''} />
                  <span>${escapeHtml(friendlyName(e))}</span>
                </label>`
                )
                .join('')}
            </div>`
          )
          .join('');
        listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
          cb.addEventListener('change', () => {
            editorDraftEntities = cb.checked
              ? editorDraftEntities.concat(cb.value)
              : editorDraftEntities.filter((id) => id !== cb.value);
          });
        });
      }

      LL.api
        .get('api/hass/states')
        .then((entities) => {
          allEntities = entities;
          renderList('');
        })
        .catch((err) => {
          console.error('[loudllama][room] failed to load entities', err);
          listEl.innerHTML = `<div class="llw-room__empty-msg">${t('room', 'noEntitiesFound')}</div>`;
        });

      searchEl.addEventListener('input', () => renderList(searchEl.value));
      editorEl.querySelector('.llw-room__back').addEventListener('click', renderEditorStep1);
      editorEl.querySelector('.llw-room__save').addEventListener('click', () => {
        cfg = { name: editorDraftName, entities: editorDraftEntities.slice(), subWidgets: cfg.subWidgets || [] };
        syncSubWidgets();
        ensureSubWidgetTypesLoaded().then(() => saveConfig(cfg));
        closeEditor();
        renderCompact();
        startPolling();
      });
    }

    gearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openEditor();
    });

    // --- Live data ----------------------------------------------------------
    async function fetchLiveEntities() {
      if (!cfg.entities.length) {
        liveEntities = {};
        return;
      }
      try {
        const list = await LL.api.get(`api/hass/states?ids=${encodeURIComponent(cfg.entities.join(','))}`);
        const next = {};
        list.forEach((e) => {
          next[e.entity_id] = e;
        });
        liveEntities = next;
      } catch (err) {
        console.error('[loudllama][room] failed to fetch live entity states', err);
      }
    }

    function startPolling() {
      clearInterval(pollTimer);
      fetchLiveEntities().then(() => {
        renderCompact();
        if (activeModal) renderModalGroups();
      });
      pollTimer = setInterval(() => {
        fetchLiveEntities().then(() => {
          if (destroyed) return;
          renderCompact();
          if (activeModal) renderModalGroups();
        });
      }, POLL_MS);
    }

    // --- Compact glance tile --------------------------------------------------
    function groupCounts() {
      const counts = {};
      cfg.entities.forEach((id) => {
        const e = liveEntities[id] || { entity_id: id, attributes: {} };
        const g = categorize(e);
        counts[g] = (counts[g] || 0) + 1;
      });
      return counts;
    }

    function anyLightOn() {
      return cfg.entities.some((id) => {
        const e = liveEntities[id];
        return e && domainOf(id) === 'light' && e.state === 'on';
      });
    }

    function findPrimaryTemperature() {
      const climateEnt = cfg.entities
        .map((id) => liveEntities[id])
        .find((e) => e && domainOf(e.entity_id) === 'climate' && e.attributes && e.attributes.current_temperature !== undefined);
      if (climateEnt) return { value: climateEnt.attributes.current_temperature, unit: '°' };
      const sensorEnt = cfg.entities
        .map((id) => liveEntities[id])
        .find((e) => e && e.attributes && e.attributes.device_class === 'temperature');
      if (sensorEnt) return { value: sensorEnt.state, unit: sensorEnt.attributes.unit_of_measurement || '°' };
      return null;
    }

    function formatGlanceTemp(t2) {
      const num = Number(t2.value);
      return `${Number.isFinite(num) ? Math.round(num * 10) / 10 : t2.value}${t2.unit}`;
    }

    function renderCompact() {
      nameEl.textContent = cfg.name;
      roomEl.style.setProperty('--room-hue', String(hashHue(cfg.name || 'room')));
      roomEl.classList.toggle('llw-room--lit', anyLightOn());
      roomEl.classList.toggle('llw-room--clickable', cfg.entities.length > 0);

      if (!cfg.entities.length) {
        glanceEl.innerHTML = `<div class="llw-room__empty">${t('room', 'noEntitiesSelected')}</div>`;
        return;
      }
      const counts = groupCounts();
      const temp = findPrimaryTemperature();
      glanceEl.innerHTML = `
        ${temp ? `<div class="llw-room__temp">${formatGlanceTemp(temp)}</div>` : ''}
        <div class="llw-room__chips">
          ${GROUP_ORDER.filter((g) => counts[g])
            .map((g) => `<span class="llw-room__chip" title="${t('room', `groups.${g}`)}">${GROUP_ICON[g]}<b>${counts[g]}</b></span>`)
            .join('')}
        </div>
        <div class="llw-room__hint">${t('room', 'tapToOpen')}</div>
      `;
    }

    roomEl.addEventListener('click', (ev) => {
      if (document.body.classList.contains('llw-edit-mode')) return;
      if (ev.target.closest('.llw-room__gear')) return;
      if (!cfg.entities.length) return;
      openModal();
    });

    // --- Service calls (optimistic UI + reconcile shortly after) -------------
    function optimisticMutate(entityId, patchFn) {
      const e = liveEntities[entityId];
      if (!e) return;
      patchFn(e);
      renderCompact();
      if (activeModal) renderModalGroups();
    }

    async function callService(domain, service, entityId, extra) {
      try {
        await LL.api.post(`api/hass/service/${domain}/${service}`, { entity_id: entityId, ...(extra || {}) });
      } catch (err) {
        console.error(`[loudllama][room] service ${domain}.${service} failed`, err);
      } finally {
        setTimeout(() => {
          if (destroyed) return;
          fetchLiveEntities().then(() => {
            renderCompact();
            if (activeModal) renderModalGroups();
          });
        }, RECONCILE_DELAY_MS);
      }
    }

    // --- Fullscreen popup -----------------------------------------------------
    function stateLabel(key) {
      return t('room', `states.${key}`);
    }

    function securityStateKey(e) {
      const domain = domainOf(e.entity_id);
      if (domain === 'lock') return e.state === 'locked' ? 'locked' : 'unlocked';
      if (domain === 'alarm_control_panel') return e.state && stateLabel(e.state) !== e.state ? e.state : 'unknown';
      const dc = e.attributes && e.attributes.device_class;
      const isOn = e.state === 'on';
      if (OPENING_DEVICE_CLASSES.includes(dc)) return isOn ? 'open' : 'closed';
      return isOn ? 'detected' : 'clear';
    }

    function rowHtml(entity) {
      const domain = domainOf(entity.entity_id);
      const name = escapeHtml(friendlyName(entity));
      const id = entity.entity_id;

      if (domain === 'light') {
        const isOn = entity.state === 'on';
        const hasBrightness = entity.attributes && entity.attributes.brightness !== undefined && entity.attributes.brightness !== null;
        const pct = hasBrightness ? Math.round(((entity.attributes.brightness || 0) / 255) * 100) : 0;
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main">
              <span class="llw-room__row-name">${name}</span>
              ${hasBrightness ? `<input type="range" class="llw-room__slider" min="1" max="100" value="${pct}" data-action="brightness" data-entity="${id}" ${isOn ? '' : 'disabled'} />` : ''}
            </div>
            <button type="button" class="llw-room__toggle ${isOn ? 'is-on' : ''}" data-action="toggle-light" data-entity="${id}" aria-label="${name}"></button>
          </div>`;
      }
      if (domain === 'switch' || domain === 'fan') {
        const isOn = entity.state === 'on';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
            <button type="button" class="llw-room__toggle ${isOn ? 'is-on' : ''}" data-action="${domain === 'fan' ? 'toggle-fan' : 'toggle-switch'}" data-entity="${id}" aria-label="${name}"></button>
          </div>`;
      }
      if (domain === 'lock') {
        const locked = entity.state === 'locked';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span><span class="llw-room__row-sub">${stateLabel(locked ? 'locked' : 'unlocked')}</span></div>
            <button type="button" class="llw-room__toggle ${locked ? 'is-on' : ''}" data-action="toggle-lock" data-entity="${id}" aria-label="${name}"></button>
          </div>`;
      }
      if (domain === 'cover') {
        const state = ['open', 'closed', 'opening', 'closing', 'stopped'].includes(entity.state) ? entity.state : 'unknown';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span><span class="llw-room__row-sub">${stateLabel(state)}</span></div>
            <div class="llw-room__icon-row">
              <button type="button" class="llw-room__icon-btn" data-action="cover-open" data-entity="${id}" title="${t('room', 'actions.open')}">▲</button>
              <button type="button" class="llw-room__icon-btn" data-action="cover-stop" data-entity="${id}" title="${t('room', 'actions.stop')}">■</button>
              <button type="button" class="llw-room__icon-btn" data-action="cover-close" data-entity="${id}" title="${t('room', 'actions.close')}">▼</button>
            </div>
          </div>`;
      }
      if (domain === 'climate') {
        const target = entity.attributes && entity.attributes.temperature;
        const current = entity.attributes && entity.attributes.current_temperature;
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main">
              <span class="llw-room__row-name">${name}</span>
              ${current !== undefined ? `<span class="llw-room__row-sub">${Math.round(current * 10) / 10}°</span>` : ''}
            </div>
            <div class="llw-room__stepper">
              <button type="button" data-action="climate-dec" data-entity="${id}" aria-label="-">−</button>
              <span class="llw-room__stepper-value">${target !== undefined ? `${Math.round(target * 10) / 10}°` : '--'}</span>
              <button type="button" data-action="climate-inc" data-entity="${id}" aria-label="+">+</button>
            </div>
          </div>`;
      }
      if (domain === 'media_player') {
        const playing = entity.state === 'playing';
        const stateKey = ['playing', 'paused', 'idle'].includes(entity.state) ? entity.state : 'idle';
        const vol = entity.attributes && entity.attributes.volume_level;
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main">
              <span class="llw-room__row-name">${name}</span>
              <span class="llw-room__row-sub">${stateLabel(stateKey)}</span>
              ${vol !== undefined ? `<input type="range" class="llw-room__slider" min="0" max="100" value="${Math.round(vol * 100)}" data-action="volume" data-entity="${id}" />` : ''}
            </div>
            <button type="button" class="llw-room__icon-btn" data-action="media-playpause" data-entity="${id}" title="${t('room', 'actions.playPause')}">${playing ? '⏸' : '▶'}</button>
          </div>`;
      }
      if (domain === 'vacuum') {
        const cleaning = entity.state === 'cleaning';
        const stateKey = ['cleaning', 'docked'].includes(entity.state) ? entity.state : 'idle';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span><span class="llw-room__row-sub">${stateLabel(stateKey)}</span></div>
            <button type="button" class="llw-room__icon-btn" data-action="vacuum-toggle" data-entity="${id}" title="${t('room', cleaning ? 'actions.stop' : 'actions.start')}">${cleaning ? '■' : '▶'}</button>
          </div>`;
      }
      if (domain === 'alarm_control_panel' || domain === 'binary_sensor') {
        const key = securityStateKey(entity);
        const alert = ['open', 'detected', 'unlocked'].includes(key);
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
            <span class="llw-room__badge ${alert ? 'llw-room__badge--alert' : 'llw-room__badge--ok'}">${stateLabel(key)}</span>
          </div>`;
      }
      if (domain === 'sensor') {
        const unit = (entity.attributes && entity.attributes.unit_of_measurement) || '';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
            <span class="llw-room__row-sub">${escapeHtml(entity.state)}${unit ? ` ${escapeHtml(unit)}` : ''}</span>
          </div>`;
      }
      if (domain === 'scene' || domain === 'script' || domain === 'button') {
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
            <button type="button" class="llw-room__run-btn" data-action="run" data-entity="${id}">${t('room', 'actions.run')}</button>
          </div>`;
      }
      if (domain === 'input_boolean') {
        const isOn = entity.state === 'on';
        return `
          <div class="llw-room__row">
            <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
            <button type="button" class="llw-room__toggle ${isOn ? 'is-on' : ''}" data-action="toggle-input-boolean" data-entity="${id}" aria-label="${name}"></button>
          </div>`;
      }
      return `
        <div class="llw-room__row">
          <div class="llw-room__row-main"><span class="llw-room__row-name">${name}</span></div>
          <span class="llw-room__row-sub">${escapeHtml(entity.state)}</span>
        </div>`;
    }

    // Light/climate/media entities are rendered as real sub-widgets in the
    // nested grid instead (see mountSubWidgets) - this only covers the
    // remaining domains (switches, covers, fans, locks, sensors, security,
    // scenes/scripts, ...), same simple row list as before.
    function renderModalGroups() {
      if (!activeModal) return;
      const other = activeModal.querySelector('.llw-room-modal__other');
      if (!other) return;
      const byGroup = {};
      cfg.entities.forEach((id) => {
        const g = categorize(liveEntities[id] || { entity_id: id, attributes: {} });
        if (SUBWIDGET_TYPE_BY_DOMAIN[domainOf(id)]) return; // has its own sub-widget above
        const e = liveEntities[id] || { entity_id: id, state: 'unknown', attributes: {} };
        (byGroup[g] = byGroup[g] || []).push(e);
      });
      other.innerHTML = GROUP_ORDER.filter((g) => byGroup[g] && byGroup[g].length)
        .map(
          (g) => `
          <div class="llw-room-modal__group">
            <div class="llw-room-modal__group-label">${GROUP_ICON[g]} ${t('room', `groups.${g}`)}</div>
            ${byGroup[g].map(rowHtml).join('')}
          </div>`
        )
        .join('');
    }

    function handleModalClick(ev) {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const entityId = btn.dataset.entity;
      const entity = liveEntities[entityId];
      if (!entity) return;

      if (action === 'toggle-light') {
        const on = entity.state !== 'on';
        optimisticMutate(entityId, (e) => { e.state = on ? 'on' : 'off'; });
        callService('light', on ? 'turn_on' : 'turn_off', entityId);
      } else if (action === 'toggle-switch') {
        const on = entity.state !== 'on';
        optimisticMutate(entityId, (e) => { e.state = on ? 'on' : 'off'; });
        callService('switch', on ? 'turn_on' : 'turn_off', entityId);
      } else if (action === 'toggle-fan') {
        const on = entity.state !== 'on';
        optimisticMutate(entityId, (e) => { e.state = on ? 'on' : 'off'; });
        callService('fan', on ? 'turn_on' : 'turn_off', entityId);
      } else if (action === 'toggle-input-boolean') {
        const on = entity.state !== 'on';
        optimisticMutate(entityId, (e) => { e.state = on ? 'on' : 'off'; });
        callService('input_boolean', on ? 'turn_on' : 'turn_off', entityId);
      } else if (action === 'toggle-lock') {
        const locking = entity.state !== 'locked';
        optimisticMutate(entityId, (e) => { e.state = locking ? 'locked' : 'unlocked'; });
        callService('lock', locking ? 'lock' : 'unlock', entityId);
      } else if (action === 'cover-open') {
        optimisticMutate(entityId, (e) => { e.state = 'opening'; });
        callService('cover', 'open_cover', entityId);
      } else if (action === 'cover-close') {
        optimisticMutate(entityId, (e) => { e.state = 'closing'; });
        callService('cover', 'close_cover', entityId);
      } else if (action === 'cover-stop') {
        optimisticMutate(entityId, (e) => { e.state = 'stopped'; });
        callService('cover', 'stop_cover', entityId);
      } else if (action === 'media-playpause') {
        const playing = entity.state !== 'playing';
        optimisticMutate(entityId, (e) => { e.state = playing ? 'playing' : 'paused'; });
        callService('media_player', 'media_play_pause', entityId);
      } else if (action === 'vacuum-toggle') {
        const cleaning = entity.state !== 'cleaning';
        optimisticMutate(entityId, (e) => { e.state = cleaning ? 'cleaning' : 'docked'; });
        callService('vacuum', cleaning ? 'start' : 'stop', entityId);
      } else if (action === 'climate-inc' || action === 'climate-dec') {
        const step = action === 'climate-inc' ? 0.5 : -0.5;
        const next = Math.round((((entity.attributes.temperature || 20) + step) * 10)) / 10;
        optimisticMutate(entityId, (e) => { e.attributes.temperature = next; });
        callService('climate', 'set_temperature', entityId, { temperature: next });
      } else if (action === 'run') {
        const domain = domainOf(entityId);
        callService(domain, 'turn_on', entityId);
      }
    }

    function handleModalInput(ev) {
      const elx = ev.target;
      const entityId = elx.dataset.entity;
      if (!entityId || !liveEntities[entityId]) return;
      if (elx.dataset.action === 'brightness') {
        optimisticMutate(entityId, (e) => { e.state = 'on'; e.attributes.brightness = Math.round((Number(elx.value) / 100) * 255); });
      } else if (elx.dataset.action === 'volume') {
        optimisticMutate(entityId, (e) => { e.attributes.volume_level = Number(elx.value) / 100; });
      }
    }

    function handleModalChange(ev) {
      const elx = ev.target;
      const entityId = elx.dataset.entity;
      if (!entityId) return;
      if (elx.dataset.action === 'brightness') {
        callService('light', 'turn_on', entityId, { brightness_pct: Number(elx.value) });
      } else if (elx.dataset.action === 'volume') {
        callService('media_player', 'volume_set', entityId, { volume_level: Number(elx.value) / 100 });
      }
    }

    function closeModal() {
      if (!activeModal) return;
      document.removeEventListener('keydown', onModalKeydown);
      subWidgetCleanups.forEach((fn) => { try { fn(); } catch (err) { /* ignore */ } });
      subWidgetCleanups = [];
      if (subGrid) {
        try { subGrid.destroy(false); } catch (err) { /* ignore */ }
        subGrid = null;
      }
      activeModal.remove();
      activeModal = null;
      arranging = false;
    }
    function onModalKeydown(ev) {
      if (ev.key === 'Escape') closeModal();
    }

    // Mounts every entry in cfg.subWidgets into the popup's own small
    // GridStack grid - each one via the *exact same* mount(el, {config,
    // saveConfig}) contract app.js uses for top-level widgets, so
    // Light/Climate/Media behave identically whether they're standalone on
    // the dashboard or nested in here.
    function mountSubWidgets(subGridEl) {
      subGrid = GridStack.init(
        {
          column: SUBGRID_COLUMNS,
          cellHeight: SUBGRID_CELL_HEIGHT,
          margin: 6,
          float: true,
          disableOneColumnMode: true,
          resizable: { handles: 'e, se, s, sw, w' },
        },
        subGridEl
      );
      subGrid.disable(); // starts in view mode, like the main dashboard

      cfg.subWidgets.forEach((sw) => {
        const def = LL.widgetTypes[sw.type];
        const tileEl = document.createElement('div');
        tileEl.className = 'grid-stack-item';
        tileEl.setAttribute('gs-id', sw.id);
        tileEl.setAttribute('gs-w', sw.w || 2);
        tileEl.setAttribute('gs-h', sw.h || 2);
        if (sw.x !== undefined && sw.y !== undefined) {
          tileEl.setAttribute('gs-x', sw.x);
          tileEl.setAttribute('gs-y', sw.y);
        } else {
          tileEl.setAttribute('gs-auto-position', 'true');
        }
        tileEl.innerHTML = `<div class="grid-stack-item-content llw-widget llw-room-subwidget"><div class="llw-body"></div></div>`;
        subGrid.addWidget(tileEl);

        const bodyEl = tileEl.querySelector('.llw-body');
        if (def) {
          def.mount(bodyEl, {
            config: sw.config || {},
            saveConfig(newConfig) {
              sw.config = newConfig;
              scheduleSaveRoom();
            },
          });
          if (typeof bodyEl._llwCleanup === 'function') subWidgetCleanups.push(bodyEl._llwCleanup);
        } else {
          bodyEl.innerHTML = `<div class="llw-error">${t('app', 'widgetNotInstalled')}</div>`;
        }
      });

      subGrid.on('change', () => {
        // Not using subGrid.save() here: GridStack always strips `.el` off
        // every node it returns (see gridstack.js save(), unconditional
        // `delete n.el`), so matching against node.id/node.el can never
        // work - this used to silently no-op every resize/drag, leaving
        // cfg.subWidgets' x/y/w/h frozen at their initial values forever.
        // Reading each live item's own `.gridstackNode` (kept current by
        // GridStack on every move/resize) is what app.js's serializeLayout
        // does for the same reason - same fix, same root cause.
        Array.from(subGrid.el.children).forEach((el) => {
          if (!el.classList.contains('grid-stack-item') || !el.gridstackNode) return;
          const node = el.gridstackNode;
          const sw = cfg.subWidgets.find((s) => s.id === node.id);
          if (sw) {
            sw.x = node.x;
            sw.y = node.y;
            sw.w = node.w;
            sw.h = node.h;
          }
        });
        scheduleSaveRoom();
      });
    }

    function setArranging(on) {
      arranging = on;
      if (!activeModal) return;
      activeModal.classList.toggle('llw-room-modal--arranging', arranging);
      const btn = activeModal.querySelector('.llw-room-modal__arrange');
      if (btn) btn.classList.toggle('is-active', arranging);
      if (subGrid) arranging ? subGrid.enable() : subGrid.disable();
    }

    function openModal() {
      closeModal();
      const hasSubWidgets = cfg.subWidgets.length > 0;
      const modal = document.createElement('div');
      modal.className = 'llw-room-modal';
      modal.innerHTML = `
        <div class="llw-room-modal__card">
          <div class="llw-room-modal__head">
            <span class="llw-room-modal__title">${escapeHtml(cfg.name)}</span>
            <div class="llw-room-modal__head-actions">
              ${hasSubWidgets ? `<button type="button" class="llw-room-modal__arrange" title="${t('room', 'arrange')}" aria-label="${t('room', 'arrange')}">✥</button>` : ''}
              <button type="button" class="llw-room-modal__close" aria-label="${t('room', 'close')}">×</button>
            </div>
          </div>
          <div class="llw-room-modal__body">
            ${hasSubWidgets ? '<div class="grid-stack llw-room-modal__subgrid"></div>' : ''}
            <div class="llw-room-modal__other"></div>
          </div>
        </div>
      `;
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeModal();
      });
      modal.querySelector('.llw-room-modal__close').addEventListener('click', closeModal);
      const arrangeBtn = modal.querySelector('.llw-room-modal__arrange');
      if (arrangeBtn) arrangeBtn.addEventListener('click', () => setArranging(!arranging));
      const other = modal.querySelector('.llw-room-modal__other');
      other.addEventListener('click', handleModalClick);
      other.addEventListener('input', handleModalInput);
      other.addEventListener('change', handleModalChange);
      document.body.appendChild(modal);
      document.addEventListener('keydown', onModalKeydown);
      activeModal = modal;

      const subGridEl = modal.querySelector('.llw-room-modal__subgrid');
      if (subGridEl) mountSubWidgets(subGridEl);

      renderModalGroups();
      fetchLiveEntities().then(() => renderModalGroups());
    }

    // --- Boot ------------------------------------------------------------------
    // cfg.subWidgets is null for a brand-new room, or for one saved before
    // sub-widgets existed - either way, derive it from cfg.entities once and
    // persist it, so upgrading never breaks an existing room.
    const isMigration = cfg.subWidgets === null && cfg.entities.length > 0;
    if (cfg.subWidgets === null) cfg.subWidgets = [];
    syncSubWidgets();
    ensureSubWidgetTypesLoaded().then(() => {
      if (isMigration && !destroyed) saveConfig(cfg);
    });

    if (!cfg.name || !cfg.entities.length) {
      editorDraftName = cfg.name;
      editorDraftEntities = cfg.entities.slice();
      editorEl.classList.add('llw-open');
      renderEditorStep1();
      renderCompact();
    } else {
      renderCompact();
      startPolling();
    }

    el._llwCleanup = () => {
      destroyed = true;
      clearInterval(pollTimer);
      closeModal();
    };
  }

  LL.registerWidget('room', {
    name: { en: 'Room', da: 'Værelse', de: 'Raum', sv: 'Rum', no: 'Rom' },
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    defaultConfig: () => ({ name: '', entities: [] }),
    mount,
  });
})();
