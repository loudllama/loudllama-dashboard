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

  LL.widgetMeta = {}; // id -> {name, description, icon, ...} from /api/widgets, incl. NOT-YET-installed ones
  LL.installedWidgetIds = [];

  // Injects a widget's CSS + JS into the page and resolves once the script
  // has run (and therefore called LL.registerWidget). Safe to call more than
  // once for the same id - e.g. from the widget store right after a user
  // installs something new - it just no-ops the second time.
  LL.loadWidgetAssets = function loadWidgetAssets(entry) {
    if (!entry || LL.widgetTypes[entry.id] || document.querySelector(`script[data-llw-widget="${entry.id}"]`)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      if (entry.css) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = entry.css;
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = entry.js;
      script.dataset.llwWidget = entry.id;
      script.onload = () => resolve();
      script.onerror = () => {
        console.error(`[loudllama] Failed to load widget script: ${entry.js}`);
        resolve(); // one bad widget shouldn't block the rest of the app
      };
      document.body.appendChild(script);
    });
  };

  // Used by container widgets (currently just Room - see
  // widgets/room/room.js) that can mount *other* widgets inside themselves:
  // if a room uses e.g. a Light entity, the Light widget needs to actually
  // be installed (not just loaded for this one session), or it would show
  // as a broken "not installed" placeholder the next time the page loads.
  // No-ops once the id is already installed.
  LL.ensureWidgetInstalled = async function ensureWidgetInstalled(id) {
    if (LL.installedWidgetIds.includes(id)) return;
    const next = LL.installedWidgetIds.concat(id);
    LL.installedWidgetIds = next;
    try {
      await LL.api.post('api/widgets/installed', { installed: next });
    } catch (err) {
      console.error('[loudllama] Failed to persist auto-installed widget', id, err);
    }
    const entry = (LL.widgetCatalog || []).find((w) => w.id === id);
    await LL.loadWidgetAssets(entry);
    LL.refreshAddWidgetMenu && LL.refreshAddWidgetMenu();
  };

  // Loads JS/CSS for every currently-installed widget. Called once at boot;
  // the widget store also calls LL.loadWidgetAssets directly when a widget
  // is installed mid-session so it becomes usable immediately.
  async function loadInstalledWidgets() {
    try {
      const [meta, installedRes] = await Promise.all([
        LL.api.get('api/widgets'),
        LL.api.get('api/widgets/installed'),
      ]);
      LL.widgetMeta = {};
      (meta || []).forEach((w) => { LL.widgetMeta[w.id] = w; });
      LL.installedWidgetIds = (installedRes && installedRes.installed) || [];
    } catch (err) {
      console.warn('[loudllama] Could not load widget catalog/installed list', err);
    }
    const catalog = LL.widgetCatalog || [];
    const toLoad = catalog.filter((entry) => LL.installedWidgetIds.includes(entry.id));
    await Promise.all(toLoad.map(LL.loadWidgetAssets));
  }

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
    // Deliberately NOT using grid.save() here: GridStack always strips
    // `.el` off of every node it returns (see gridstack.js's save(), which
    // unconditionally does `delete n.el`), so a save-based approach can
    // never recover which DOM element - and therefore which widgetType/
    // widgetConfig - a saved node belongs to. Reading straight from the
    // live `.grid-stack-item` elements (and their attached `.gridstackNode`,
    // which GridStack keeps current on every move/resize) sidesteps that
    // entirely, and skipping anything without a widgetType still guards
    // against a stale/detached element lingering right after removeWidget().
    const widgets = Array.from(grid.el.children)
      .filter((el) => el.classList.contains('grid-stack-item') && el.dataset && el.dataset.widgetType && el.gridstackNode)
      .map((el) => {
        const node = el.gridstackNode;
        return {
          id: node.id,
          type: el.dataset.widgetType,
          x: node.x,
          y: node.y,
          w: node.w,
          h: node.h,
          config: JSON.parse(el.dataset.widgetConfig || '{}'),
        };
      });
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
      // The widget was placed on the dashboard at some point but isn't
      // currently installed (its script was never loaded) - most likely the
      // user removed it in the widget store. It's still on the grid (we
      // never delete a user's placement behind their back); this is just a
      // friendly placeholder instead of a dead widget until they either
      // remove it or re-install it from the store.
      const meta = LL.widgetMeta[node.type];
      const label = (meta && meta.name && (meta.name[LL.i18n.lang] || meta.name.en)) || node.type;
      el.innerHTML = `
        <div class="llw-error llw-error--not-installed">
          <div class="llw-error__title">${t('app', 'widgetNotInstalled')}: ${label}</div>
          <button type="button" class="llw-error__store-link">${t('app', 'openStore')}</button>
        </div>
      `;
      const link = el.querySelector('.llw-error__store-link');
      if (link) link.addEventListener('click', () => LL.openWidgetStore && LL.openWidgetStore());
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
    const storeBtn = document.getElementById('llw-store-open');
    if (storeBtn) storeBtn.textContent = `🧩 ${t('app', 'widgetStore')}`;
  }

  // Only *installed* widgets ever end up in LL.widgetTypes (see
  // loadInstalledWidgets/LL.loadWidgetAssets above), so this menu
  // automatically reflects the widget store's install/uninstall state with
  // no extra bookkeeping. Exposed on LL so the widget store can refresh it
  // the instant something is installed, without a page reload.
  function buildAddWidgetMenu() {
    const menu = document.getElementById('llw-add-widget-menu');
    menu.innerHTML = '';
    // A widget's script can still be loaded (and therefore in
    // LL.widgetTypes) after it's been uninstalled - JS can't be unloaded
    // from a running page - so the menu also has to check
    // LL.installedWidgetIds, which the store keeps current on every
    // install/uninstall. That's what actually makes uninstalling take
    // effect immediately instead of only after a reload.
    const ids = Object.keys(LL.widgetTypes).filter((id) => LL.installedWidgetIds.includes(id));
    if (ids.length === 0) {
      const empty = document.createElement('button');
      empty.className = 'llw-menu-item llw-menu-item--empty';
      empty.textContent = t('app', 'noWidgetsInstalled');
      empty.addEventListener('click', () => {
        menu.classList.remove('llw-open');
        LL.openWidgetStore && LL.openWidgetStore();
      });
      menu.appendChild(empty);
      return;
    }
    ids.forEach((id) => {
      const def = LL.widgetTypes[id];
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
  LL.refreshAddWidgetMenu = buildAddWidgetMenu;

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

    // 2b. Widget store: load the catalog + which widgets are installed, and
    //     fetch the JS/CSS for the installed ones. Must happen before the
    //     grid mounts the saved layout and before the "+ Add widget" menu is
    //     built, since both depend on LL.widgetTypes being populated.
    await loadInstalledWidgets();

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

    const storeBtn = document.getElementById('llw-store-open');
    if (storeBtn) {
      storeBtn.addEventListener('click', () => {
        addMenu.classList.remove('llw-open');
        LL.openWidgetStore && LL.openWidgetStore();
      });
    }

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
