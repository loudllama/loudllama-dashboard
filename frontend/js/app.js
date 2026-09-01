/*
 * LoudLlama Dashboard - app shell.
 *
 * Talks to the backend using *relative* URLs everywhere ('api/...', not
 * '/api/...') because Home Assistant Ingress mounts the add-on under a
 * dynamic per-session path prefix - relative URLs resolve correctly no
 * matter where the app is mounted, absolute ones would break.
 */
(function () {
  const LL = (window.LoudLlama = window.LoudLlama || {});
  const { t } = LL.i18n;

  LL.widgetTypes = {}; // populated by widget scripts via LL.registerWidget(...)
  LL.haConfig = { language: 'en', unit_system: { temperature: '°C' } };

  LL.registerWidget = function registerWidget(id, definition) {
    LL.widgetTypes[id] = definition;
  };

  LL.api = {
    async get(path) {
      const res = await fetch(path, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
      return res.json();
    },
    async post(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
      return res.json();
    },
  };

  let grid;
  let editMode = false;
  let saveTimer = null;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLayout, 500);
  }

  function serializeLayout() {
    // grid.save() can momentarily include a stale node for an item that was
    // just removed (its .el already gone) when a debounced save fires right
    // after removeWidget() - skip anything that isn't a real, still-mounted
    // widget element instead of crashing.
    const widgets = grid
      .save(false)
      .filter((node) => node.el && node.el.dataset && node.el.dataset.widgetType)
      .map((node) => ({
        id: node.id,
        type: node.el.dataset.widgetType,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        config: JSON.parse(node.el.dataset.widgetConfig || '{}'),
      }));
    return { widgets };
  }

  async function saveLayout() {
    try {
      await LL.api.post('api/layout', serializeLayout());
    } catch (err) {
      console.error('[loudllama] Failed to save layout', err);
    }
  }

  function mountWidget(node) {
    const def = LL.widgetTypes[node.type];
    const el = node.el.querySelector('.llw-body');
    if (!def) {
      el.innerHTML = `<div class="llw-error">Unknown widget: ${node.type}</div>`;
      return;
    }
    def.mount(el, {
      config: node.config || {},
      saveConfig(newConfig) {
        node.el.dataset.widgetConfig = JSON.stringify(newConfig);
        scheduleSave();
      },
    });
  }

  function addWidgetElement(node) {
    const widgetId = node.id || `${node.type}-${Date.now()}`;
    const def = LL.widgetTypes[node.type];
    const size = node.w
      ? node
      : { ...(def ? def.defaultSize : { w: 3, h: 3 }), ...node };

    const el = document.createElement('div');
    el.className = 'grid-stack-item';
    el.dataset.widgetType = node.type;
    el.dataset.widgetConfig = JSON.stringify(node.config || {});
    el.setAttribute('gs-id', widgetId);
    el.setAttribute('gs-x', size.x ?? 0);
    el.setAttribute('gs-y', size.y ?? 0);
    el.setAttribute('gs-w', size.w ?? 3);
    el.setAttribute('gs-h', size.h ?? 3);
    el.innerHTML = `
      <div class="grid-stack-item-content llw-widget">
        <button class="llw-remove" title="${t('app', 'removeWidget')}" aria-label="${t('app', 'removeWidget')}">×</button>
        <div class="llw-body"></div>
      </div>
    `;
    el.querySelector('.llw-remove').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const body = el.querySelector('.llw-body');
      if (body && typeof body._llwCleanup === 'function') body._llwCleanup();
      grid.removeWidget(el);
      scheduleSave();
    });

    grid.addWidget(el);
    mountWidget({ ...node, id: widgetId, el });
  }

  function setEditMode(on) {
    editMode = on;
    document.body.classList.toggle('llw-edit-mode', editMode);
    document.getElementById('llw-edit-toggle').textContent = editMode ? t('app', 'done') : t('app', 'edit');
    if (grid) {
      editMode ? grid.enable() : grid.disable();
    }
  }

  function applyBackground(settings) {
    const bg = document.getElementById('llw-background');
    if (settings && settings.backgroundUrl) {
      bg.style.backgroundImage = `url("${settings.backgroundUrl}")`;
      bg.classList.add('llw-has-image');
    } else {
      bg.style.backgroundImage = '';
      bg.classList.remove('llw-has-image');
    }
  }

  function localizeChrome() {
    document.getElementById('llw-edit-toggle').textContent = editMode ? t('app', 'done') : t('app', 'edit');
    document.getElementById('llw-add-widget').textContent = `+ ${t('app', 'addWidget')}`;
    document.getElementById('llw-bg-label').textContent = t('app', 'background');
    document.getElementById('llw-bg-file').title = t('app', 'changeBackground');
  }

  function buildAddWidgetMenu() {
    const menu = document.getElementById('llw-add-widget-menu');
    menu.innerHTML = '';
    Object.entries(LL.widgetTypes).forEach(([id, def]) => {
      const btn = document.createElement('button');
      btn.className = 'llw-menu-item';
      btn.textContent = (def.name && (def.name[LL.i18n.lang] || def.name.en)) || id;
      btn.addEventListener('click', () => {
        addWidgetElement({ type: id, config: def.defaultConfig ? def.defaultConfig() : {} });
        scheduleSave();
        menu.classList.remove('llw-open');
      });
      menu.appendChild(btn);
    });
  }

  async function init() {
    // 1. Language + units from Home Assistant (falls back to English/metric
    //    if HA can't be reached, e.g. during local development).
    try {
      LL.haConfig = await LL.api.get('api/hass/config');
    } catch (err) {
      console.warn('[loudllama] Could not load HA config, defaulting to English', err);
    }
    LL.i18n.setLang(LL.haConfig.language);
    localizeChrome();

    // 2. Background image.
    try {
      applyBackground(await LL.api.get('api/settings'));
    } catch (err) {
      console.warn('[loudllama] Could not load settings', err);
    }

    // 3. Grid + saved layout.
    grid = GridStack.init({
      cellHeight: 90,
      margin: 8,
      float: true,
      disableOneColumnMode: false,
      resizable: { handles: 'e, se, s, sw, w' },
    });
    grid.disable(); // start in view mode

    let layout = { widgets: [] };
    try {
      layout = await LL.api.get('api/layout');
    } catch (err) {
      console.warn('[loudllama] Could not load layout', err);
    }
    layout.widgets.forEach(addWidgetElement);

    grid.on('change', scheduleSave);

    // 4. Chrome interactions.
    document.getElementById('llw-edit-toggle').addEventListener('click', () => setEditMode(!editMode));

    const addMenuBtn = document.getElementById('llw-add-widget');
    const addMenu = document.getElementById('llw-add-widget-menu');
    buildAddWidgetMenu();
    addMenuBtn.addEventListener('click', () => addMenu.classList.toggle('llw-open'));
    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('.llw-add-widget-wrap')) addMenu.classList.remove('llw-open');
    });

    document.getElementById('llw-bg-file').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('background', file);
      const res = await fetch('api/background', { method: 'POST', body: formData });
      if (res.ok) applyBackground(await res.json());
    });

    document.getElementById('llw-loading').remove();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
