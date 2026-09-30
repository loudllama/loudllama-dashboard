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
    async del(path) {
      const res = await fetch(path, { method: 'DELETE' });
      if (!res.ok) throw new Error(`DELETE ${path} -> ${res.status}`);
      return res.json();
    },
  };

  // Every layout call is tagged with this device's id (see device.js) so
  // the backend can keep this device's widget positions separate from
  // everyone else's while the widgets themselves (which ones exist, their
  // settings) stay the same for all.
  function layoutUrl(suffix) {
    return `api/layout${suffix}${suffix.includes('?') ? '&' : '?'}device=${encodeURIComponent(LL.deviceId || 'default')}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // What a widget's caption shows when the user hasn't typed a custom one:
  // a Room/Group's own name if it has one (so renaming the room updates its
  // home-screen label too, same as renaming an iOS folder), otherwise the
  // widget type's own localized display name from the store catalog.
  function defaultLabelFor(type, config) {
    if (config && typeof config.name === 'string' && config.name.trim()) return config.name.trim();
    const meta = LL.widgetMeta[type];
    if (meta && meta.name) return meta.name[LL.i18n.lang] || meta.name.en || type;
    const def = LL.widgetTypes[type];
    if (def && def.name) return def.name[LL.i18n.lang] || def.name.en || type;
    return type;
  }

  // The dashboard is a horizontal row of "pages" (iOS home-screen style),
  // each its own independent GridStack instance/12-col grid - see the big
  // comment block above createPage() for why. pageEls[i].gridstack is that
  // page's GridStack instance (GridStack.init sets this itself); currentPage
  // is just which one is currently scrolled into view, purely a client-side
  // view concern, never persisted.
  let pageEls = [];
  let currentPage = 0;
  let editMode = false;
  let saveTimer = null;

  // Widgets resize to one of a curated set of sizes instead of every
  // arbitrary integer cell count the 12-column grid technically allows -
  // the same idea as iOS 14+ widgets only coming in small/medium/large:
  // it's what makes a dashboard people have been freely resizing for a
  // while still read as an ordered tile grid instead of a jumble of
  // slightly-different rectangles. Picks whichever tier is closest to
  // whatever size the user actually dragged to, so it still feels like a
  // normal resize and not like fighting the grid.
  // 1 is included here even though most widgets never reach it: pickTier()
  // below filters candidate tiers down to whatever's >= a widget's own
  // minSize first, so a widget whose minSize is still {w:2,h:2} (the
  // default) simply never sees 1 as a candidate and keeps snapping exactly
  // as before. Only a widget that explicitly declares minSize:{w:1,h:1}
  // (e.g. Room) can actually land on it.
  const LLW_WIDTH_TIERS = [1, 2, 3, 4, 6, 8, 12];
  const LLW_HEIGHT_TIERS = [1, 2, 3, 4, 6];
  function pickTier(current, tiers, min, max) {
    const candidates = tiers.filter((t) => t >= (min || 1) && t <= (max || Infinity));
    if (!candidates.length) return Math.max(min || 1, Math.min(current, max || current));
    return candidates.reduce((best, t) => (Math.abs(t - current) < Math.abs(best - current) ? t : best), candidates[0]);
  }

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
    // Each page contributes its own widgets, tagged with that page's index -
    // this is the only place a widget's page number is decided from, there's
    // no separate "which page" bookkeeping kept anywhere else.
    const gridWidgets = [];
    pageEls.forEach((pageEl, pageIndex) => {
      Array.from(pageEl.children)
        .filter((el) => el.classList.contains('grid-stack-item') && el.dataset && el.dataset.widgetType && el.gridstackNode)
        .forEach((el) => {
          const node = el.gridstackNode;
          gridWidgets.push({
            id: node.id,
            type: el.dataset.widgetType,
            x: node.x,
            y: node.y,
            w: node.w,
            h: node.h,
            page: pageIndex,
            config: JSON.parse(el.dataset.widgetConfig || '{}'),
            label: el.dataset.widgetLabel || '',
            dock: false,
          });
        });
    });
    // Docked widgets live outside GridStack entirely (see pinToDock), so
    // they're read straight off their own dataset instead of a
    // gridstackNode - x/y/w/h are whatever they were the moment they got
    // pinned, kept only so there's a sane place to put them back on unpin.
    const dockWidgets = Array.from(document.getElementById('llw-dock').children)
      .filter((el) => el.dataset && el.dataset.widgetType)
      .map((el) => ({
        id: el.dataset.widgetId,
        type: el.dataset.widgetType,
        x: Number(el.dataset.widgetX || 0),
        y: Number(el.dataset.widgetY || 0),
        w: Number(el.dataset.widgetW || 3),
        h: Number(el.dataset.widgetH || 3),
        // Dock widgets aren't on any page (the dock is fixed chrome, shown
        // the same regardless of which page is scrolled into view) - page:0
        // here is just a harmless, unused placeholder to keep every widget's
        // shape the same.
        page: 0,
        config: JSON.parse(el.dataset.widgetConfig || '{}'),
        label: el.dataset.widgetLabel || '',
        dock: true,
      }));
    return { widgets: gridWidgets.concat(dockWidgets) };
  }

  async function saveLayout() {
    try {
      await LL.api.post(layoutUrl(''), serializeLayout());
    } catch (err) {
      console.error('[loudllama] Failed to save layout', err);
    }
  }

  function mountWidget(node) {
    const def = LL.widgetTypes[node.type];
    const el = node.el.querySelector('.llw-body');
    const captionEl = node.el.querySelector('.llw-caption');
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
        // Keep the caption following e.g. a Room/Group's own name live, as
        // long as nobody has typed a custom caption of their own for this
        // tile (an explicit custom caption always wins).
        if (captionEl && !node.el.dataset.widgetLabel) {
          captionEl.textContent = defaultLabelFor(node.type, newConfig);
        }
        scheduleSave();
      },
    });
  }

  // Swaps a tile's caption for a small text input (edit mode only), and
  // commits back to a <div> on blur/Enter. An empty value means "no custom
  // caption" - go back to following the widget's own default label.
  function startEditingCaption(el, node) {
    const captionEl = el.querySelector('.llw-caption');
    if (!captionEl) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'llw-caption-input';
    input.maxLength = 30;
    input.value = el.dataset.widgetLabel || '';
    input.placeholder = captionEl.textContent;
    captionEl.replaceWith(input);
    input.focus();
    input.select();
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === 'Escape') input.blur();
    });
    input.addEventListener(
      'blur',
      () => {
        const val = input.value.trim();
        el.dataset.widgetLabel = val;
        const config = JSON.parse(el.dataset.widgetConfig || '{}');
        const fresh = document.createElement('div');
        fresh.className = 'llw-caption';
        fresh.tabIndex = 0;
        fresh.title = t('app', 'renameWidget');
        fresh.textContent = val || defaultLabelFor(node.type, config);
        input.replaceWith(fresh);
        wireCaptionEditing(el, node);
        scheduleSave();
      },
      { once: true }
    );
  }

  function wireCaptionEditing(el, node) {
    const captionEl = el.querySelector('.llw-caption');
    if (!captionEl) return;
    captionEl.addEventListener('click', (ev) => {
      if (!editMode) return;
      ev.stopPropagation();
      startEditingCaption(el, node);
    });
  }

  function updateDockVisibility() {
    document.body.classList.toggle('llw-has-dock', document.getElementById('llw-dock').children.length > 0);
  }

  function syncPinButton(el) {
    const btn = el.querySelector('.llw-pin');
    if (!btn) return;
    const pinned = el.classList.contains('llw-dock-item');
    btn.classList.toggle('llw-pinned', pinned);
    const label = t('app', pinned ? 'unpinFromDock' : 'pinToDock');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  // Shared by both the main grid and the dock - the actual card markup
  // (remove button, pin button, body, caption) never depends on which
  // container it currently lives in.
  function buildWidgetCard(node, widgetId) {
    const el = document.createElement('div');
    el.dataset.widgetType = node.type;
    el.dataset.widgetId = widgetId;
    el.dataset.widgetConfig = JSON.stringify(node.config || {});
    el.dataset.widgetLabel = node.label || '';
    const captionText = el.dataset.widgetLabel || defaultLabelFor(node.type, node.config || {});
    el.innerHTML = `
      <div class="llw-widget-shell">
        <div class="llw-widget">
          <button class="llw-remove" title="${t('app', 'removeWidget')}" aria-label="${t('app', 'removeWidget')}">−</button>
          <button class="llw-pin" title="${t('app', 'pinToDock')}" aria-label="${t('app', 'pinToDock')}">📌</button>
          <button class="llw-page-move llw-page-prev" title="${t('app', 'movePagePrev')}" aria-label="${t('app', 'movePagePrev')}">‹</button>
          <button class="llw-page-move llw-page-next" title="${t('app', 'movePageNext')}" aria-label="${t('app', 'movePageNext')}">›</button>
          <div class="llw-body"></div>
        </div>
        <div class="llw-caption" tabindex="0" title="${t('app', 'renameWidget')}">${escapeHtml(captionText)}</div>
      </div>
    `;
    el.querySelector('.llw-remove').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const body = el.querySelector('.llw-body');
      if (body && typeof body._llwCleanup === 'function') body._llwCleanup();
      const removedId = (el.gridstackNode && el.gridstackNode.id) || widgetId;
      if (el.classList.contains('llw-dock-item')) {
        el.remove();
        updateDockVisibility();
      } else {
        const pageEl = el.closest('.llw-page');
        if (pageEl && pageEl.gridstack) pageEl.gridstack.removeWidget(el);
      }
      // Explicit, immediate delete - see server.js's big comment on why
      // widget removal is its own endpoint rather than inferred from a
      // save that simply omits the widget.
      LL.api.del(layoutUrl(`/widgets/${encodeURIComponent(removedId)}`)).catch((err) => {
        console.error('[loudllama] Failed to delete widget', removedId, err);
      });
      scheduleSave();
      // The page this widget just left may now be empty - if it was the
      // trailing page, syncPageCount() will quietly drop it.
      syncPageCount();
    });
    el.querySelector('.llw-pin').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (el.classList.contains('llw-dock-item')) unpinFromDock(el);
      else pinToDock(el);
    });
    el.querySelector('.llw-page-prev').addEventListener('click', (ev) => {
      ev.stopPropagation();
      moveWidgetToPage(el, -1);
    });
    el.querySelector('.llw-page-next').addEventListener('click', (ev) => {
      ev.stopPropagation();
      moveWidgetToPage(el, 1);
    });
    wireCaptionEditing(el, node);
    return el;
  }

  function addWidgetElement(node) {
    const widgetId = node.id || `${node.type}-${Date.now()}`;
    if (node.dock) {
      addDockElement({ ...node, id: widgetId });
      return;
    }
    const def = LL.widgetTypes[node.type];
    const size = node.w
      ? node
      : { ...(def ? def.defaultSize : { w: 3, h: 3 }), ...node };

    const pageIndex = Math.max(0, Number(node.page) || 0);
    ensurePageCount(pageIndex + 1);
    const pageEl = pageEls[pageIndex];

    const el = buildWidgetCard(node, widgetId);
    el.classList.add('grid-stack-item');
    el.querySelector('.llw-widget-shell').classList.add('grid-stack-item-content');
    el.setAttribute('gs-id', widgetId);
    el.setAttribute('gs-x', size.x ?? 0);
    el.setAttribute('gs-y', size.y ?? 0);
    el.setAttribute('gs-w', size.w ?? 3);
    el.setAttribute('gs-h', size.h ?? 3);
    syncPinButton(el);

    pageEl.gridstack.addWidget(el);
    mountWidget({ ...node, id: widgetId, el });
    // A widget landing on a page beyond what currently exists (loading a
    // saved layout) is handled by ensurePageCount above; this also covers
    // the opposite case - e.g. the "+ Add widget" menu always adds to
    // whatever page is currently in view, which never shrinks anything, but
    // running the same resync after every add keeps this one function the
    // single source of truth for page bookkeeping instead of every call site
    // having to remember to do it.
    syncPageCount();
  }

  // Docked widgets are plain elements appended straight to #llw-dock -
  // deliberately never GridStack items, since the dock is a fixed row, not
  // part of the scrollable/resizable canvas.
  function addDockElement(node) {
    const widgetId = node.id;
    const el = buildWidgetCard(node, widgetId);
    el.classList.add('llw-dock-item');
    el.dataset.widgetX = node.x ?? 0;
    el.dataset.widgetY = node.y ?? 0;
    el.dataset.widgetW = node.w ?? 3;
    el.dataset.widgetH = node.h ?? 3;
    syncPinButton(el);
    document.getElementById('llw-dock').appendChild(el);
    updateDockVisibility();
    mountWidget({ ...node, id: widgetId, el });
  }

  // Moves a widget that's currently a GridStack item into the fixed dock
  // row. Keeps its last grid position/size stashed on the element's own
  // dataset (see addDockElement) purely so unpinning has somewhere sane to
  // put it back.
  function pinToDock(el) {
    const node = el.gridstackNode;
    if (node) {
      el.dataset.widgetX = node.x;
      el.dataset.widgetY = node.y;
      el.dataset.widgetW = node.w;
      el.dataset.widgetH = node.h;
    }
    // The widget's own page - keep detaching from the *right* grid instance,
    // not just any one, now that there's more than one on screen.
    const sourcePageEl = el.closest('.llw-page');
    if (sourcePageEl && sourcePageEl.gridstack) {
      sourcePageEl.gridstack.removeWidget(el, false); // keep the element (and its mounted widget) alive, just detach from the grid
    }
    el.classList.remove('grid-stack-item');
    el.classList.add('llw-dock-item');
    const shell = el.querySelector('.llw-widget-shell');
    if (shell) shell.classList.remove('grid-stack-item-content');
    document.getElementById('llw-dock').appendChild(el);
    updateDockVisibility();
    syncPinButton(el);
    scheduleSave();
    // Pinning something might have just emptied the trailing page it came
    // from.
    syncPageCount();
  }

  // Moves a docked widget back onto the main grid, at its last known
  // position/size (or wherever GridStack's own collision handling decides
  // to put it, if that spot is now taken) - on whichever page is currently
  // in view, since that's where the user is looking when they unpin it.
  function unpinFromDock(el) {
    const x = Number(el.dataset.widgetX || 0);
    const y = Number(el.dataset.widgetY || 0);
    const w = Number(el.dataset.widgetW || 3);
    const h = Number(el.dataset.widgetH || 3);
    el.classList.remove('llw-dock-item');
    el.classList.add('grid-stack-item');
    const shell = el.querySelector('.llw-widget-shell');
    if (shell) shell.classList.add('grid-stack-item-content');
    const destPageEl = pageEls[currentPage];
    destPageEl.appendChild(el);
    destPageEl.gridstack.makeWidget(el, { x, y, w, h });
    updateDockVisibility();
    syncPinButton(el);
    scheduleSave();
  }

  // Moves a widget a single page forward/backward (the ◂/▸ badges - see the
  // big comment on .llw-page-move in app.css for why this exists instead of
  // a drag-to-edge gesture). Nudging past the first or last page is simply a
  // no-op, same as a resize handle that's already at its min/max.
  function moveWidgetToPage(el, delta) {
    if (el.classList.contains('llw-dock-item')) return; // shouldn't happen - CSS already hides these buttons there
    const sourcePageEl = el.closest('.llw-page');
    if (!sourcePageEl) return;
    const sourceIndex = Number(sourcePageEl.dataset.page);
    const targetIndex = Math.max(0, sourceIndex + delta);
    if (targetIndex === sourceIndex) return;
    ensurePageCount(targetIndex + 1);
    const node = el.gridstackNode;
    const w = (node && node.w) || 3;
    const h = (node && node.h) || 3;
    // `removeWidget(el, false)` only detaches el from GridStack's own
    // tracking - the "false" means "don't touch the DOM", so el is still
    // sitting inside the *source* page's element afterwards. makeWidget()
    // doesn't relocate an element either (unlike addWidget, which appends
    // it itself) - it just turns whatever's already inside the target grid
    // into a tracked item. So the DOM move in between is this function's own
    // job, same as unpinFromDock already does for the dock -> grid case.
    sourcePageEl.gridstack.removeWidget(el, false);
    const destPageEl = pageEls[targetIndex];
    destPageEl.appendChild(el);
    // x/y deliberately omitted - 0/0 plus GridStack's own collision handling
    // (the same thing every brand-new widget already relies on in
    // addWidgetElement) finds it a free spot on the destination page rather
    // than assuming its old position is free there too.
    destPageEl.gridstack.makeWidget(el, { x: 0, y: 0, w, h });
    goToPage(targetIndex);
    scheduleSave();
    syncPageCount();
  }

  // Creates one page (a plain 12-col GridStack instance) and appends it to
  // the end of the pages track. Pages are only ever created at the end and
  // only ever removed from the end while empty (see syncPageCount) - so a
  // page's index, once assigned, never changes for as long as it holds any
  // widgets, which is what lets serializeLayout/moveWidgetToPage/etc. trust
  // a page element's data-page attribute as a stable identity.
  function createPage() {
    const pageEl = document.createElement('div');
    pageEl.className = 'grid-stack llw-page';
    pageEl.dataset.page = String(pageEls.length);
    document.getElementById('llw-pages-track').appendChild(pageEl);
    const g = GridStack.init(
      {
        cellHeight: 90,
        marginTop: 8,
        marginBottom: 8,
        // Left/right get a bit more than top/bottom: this is what keeps a
        // widget's own side resize handle ('e'/'w') off the true screen
        // edge on a phone - see the resizable comment below for why corner
        // handles are gone, leaving 'e'/'w' as the only way to shrink a
        // widget's width, and a touch dragging exactly at the physical
        // screen edge both has very little room to register precisely and
        // competes with the OS's own edge-swipe gesture (back/forward).
        marginLeft: 16,
        marginRight: 16,
        float: true,
        disableOneColumnMode: false,
        // No 'se'/'sw' corner handles (top-level pages only - Room/Group's
        // own nested sub-grids still use all four and are unaffected, since
        // their tiles don't carry these badges - see below). GridStack
        // inline-styles every resize handle to z-index:100, and the bottom
        // corners are exactly where .llw-pin and .llw-page-prev/-next
        // already live; while jiggle's rotation is live, the *whole*
        // .llw-widget-shell is its own stacking context (any actively
        // animated `transform` creates one, per spec), which traps every
        // badge's z-index inside it - no z-index a badge declares can ever
        // outrank a sibling of the shell, like these handles. That leaves
        // a genuine deadlock the moment a bottom corner has both a badge
        // and a handle: the handle wins every hover, so the badge can never
        // trigger the hover-pause that would stop the jiggle and lift the
        // trap. Diagonal (corner) resizing is still fully reachable, just as
        // two separate edge drags ('e' then 's', or vice versa) instead of
        // one - width and height already snap to independent tiers either
        // way (see LLW_WIDTH_TIERS/LLW_HEIGHT_TIERS), so nothing about the
        // achievable sizes actually changes, only the gesture.
        resizable: { handles: 'e, s, w' },
      },
      pageEl
    );
    g.disable(); // matches whatever the *current* global edit mode is - see setEditMode, which enables every page's grid the same way
    if (editMode) g.enable();
    wireGridEvents(g);
    pageEls.push(pageEl);
    return pageEl;
  }

  // Every page's grid needs the same "save on any change" and "snap resize
  // to a tier" wiring addWidgetElement's single global grid used to get once
  // at init - now it happens once per page, right when that page is created.
  function wireGridEvents(g) {
    g.on('change', scheduleSave);
    // Snap to a size tier the instant a resize ends (not during, so the drag
    // itself still feels smooth/free) - see LLW_WIDTH_TIERS/pickTier above.
    g.on('resizestop', (event, el) => {
      const node = el.gridstackNode;
      if (!node) return;
      const def = LL.widgetTypes[el.dataset.widgetType];
      const minW = (def && def.minSize && def.minSize.w) || 1;
      const minH = (def && def.minSize && def.minSize.h) || 1;
      const snappedW = pickTier(node.w, LLW_WIDTH_TIERS, minW, 12 - node.x);
      const snappedH = pickTier(node.h, LLW_HEIGHT_TIERS, minH, 20);
      if (snappedW !== node.w || snappedH !== node.h) {
        g.update(el, { w: snappedW, h: snappedH });
        scheduleSave();
      }
    });
  }

  // Grows the page list up to (at least) minCount pages. Never shrinks -
  // that's syncPageCount's job, and only for empty trailing pages, so a
  // widget's page index is never invalidated out from under it.
  function ensurePageCount(minCount) {
    while (pageEls.length < minCount) createPage();
  }

  // The single place that decides how many pages currently "exist": one past
  // the highest-numbered page that actually has a widget on it, plus one
  // extra blank page while editing (so there's always somewhere to swipe to
  // and start a new page), floored at 1 (there's always at least a page 0,
  // even empty, so the dashboard has somewhere to render into). Called after
  // every action that could change which pages have widgets - add, remove,
  // move-to-another-page, pin/unpin, and entering/leaving edit mode itself
  // (which is what makes that trailing blank page appear/disappear).
  function syncPageCount() {
    let maxNonEmpty = -1;
    pageEls.forEach((pageEl, i) => {
      if (pageEl.querySelector('.grid-stack-item')) maxNonEmpty = i;
    });
    let desired = maxNonEmpty + 1;
    if (desired < 1) desired = 1;
    if (editMode) desired += 1;

    ensurePageCount(desired);
    while (pageEls.length > desired) {
      const last = pageEls[pageEls.length - 1];
      if (last.querySelector('.grid-stack-item')) break; // safety net - never destroy a page that actually has something on it
      if (last.gridstack) last.gridstack.destroy(); // default true also removes the element itself from the DOM
      pageEls.pop();
    }

    if (currentPage > pageEls.length - 1) currentPage = pageEls.length - 1;
    document.body.classList.toggle('llw-multi-page', pageEls.length > 1);
    // Deliberately a SEPARATE flag from llw-multi-page above: entering edit
    // mode always adds one blank trailing page (so dots + a swipe are enough
    // to discover and reach it - see the comment above), but the ◂/▸ move
    // buttons only earn their keep once there's a second page actually
    // worth moving a widget TO, i.e. real content already on more than one
    // page. Without this distinction, every widget on an ordinary one-page
    // dashboard would sprout ◂/▸ badges the instant edit mode turns on -
    // pure clutter for a setup that was never going multi-page - and, on a
    // small enough tile, those badges plus .llw-pin can even collide in the
    // same bottom corner real estate.
    document.body.classList.toggle('llw-multi-real-pages', maxNonEmpty + 1 > 1);
    renderDots();
    goToPage(currentPage, true);
  }

  function renderDots() {
    const wrap = document.getElementById('llw-page-dots');
    wrap.innerHTML = '';
    if (pageEls.length <= 1) return;
    pageEls.forEach((pageEl, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'llw-dot' + (i === currentPage ? ' llw-dot--active' : '');
      if (editMode && i === pageEls.length - 1 && !pageEl.querySelector('.grid-stack-item')) {
        dot.classList.add('llw-dot--blank');
      }
      dot.title = `${t('app', 'page')} ${i + 1}`;
      dot.setAttribute('aria-label', dot.title);
      dot.addEventListener('click', () => goToPage(i));
      wrap.appendChild(dot);
    });
  }

  // Slides the pages track to `index` (clamped to whatever pages currently
  // exist). skipAnimation is for a resync that shouldn't visibly slide - a
  // page silently appearing/disappearing behind the scenes (see
  // syncPageCount) shouldn't itself look like a swipe.
  function goToPage(index, skipAnimation) {
    currentPage = Math.max(0, Math.min(index, pageEls.length - 1));
    const track = document.getElementById('llw-pages-track');
    if (skipAnimation) {
      track.classList.add('llw-no-anim');
      track.style.transform = `translateX(-${currentPage * 100}%)`;
      void track.offsetWidth; // force layout so the class actually takes effect for this frame before...
      track.classList.remove('llw-no-anim'); // ...it's lifted again, so the *next* goToPage still animates
    } else {
      track.style.transform = `translateX(-${currentPage * 100}%)`;
    }
    document.querySelectorAll('#llw-page-dots .llw-dot').forEach((d, i) => {
      d.classList.toggle('llw-dot--active', i === currentPage);
    });
  }

  // Drag-to-swipe between pages, mirroring how real iOS lets you drag from
  // anywhere on the home screen, not just the dots. Pointer Events unify
  // mouse/touch/pen in one set of listeners. See the CSS comment on
  // .llw-page-move for why moving a WIDGET to another page is a separate,
  // deliberately simpler mechanism (small ◂/▸ badges) rather than also being
  // shoehorned into this same gesture.
  function setupPagesSwipe() {
    const viewport = document.getElementById('llw-pages-viewport');
    const track = document.getElementById('llw-pages-track');
    let active = false;
    let decided = null; // null = not yet decided, 'h' = paging swipe, 'v' = something else (vertical scroll, etc.) - leave it alone
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;

    viewport.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return; // primary mouse button / touch / pen only
      if (pageEls.length <= 1) return; // nothing to swipe to
      // In edit mode, a gesture starting ON a widget belongs entirely to
      // GridStack's own drag/resize handling for that item - grabbing it
      // here too would fight it for the same pointer. Outside edit mode
      // widgets aren't draggable at all (see setEditMode), so any drag
      // anywhere, including over a widget, is fair game for paging there.
      if (editMode && ev.target.closest('.grid-stack-item')) return;
      active = true;
      decided = null;
      pointerId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
      dx = 0;
      dy = 0;
    });

    viewport.addEventListener('pointermove', (ev) => {
      if (!active || ev.pointerId !== pointerId) return;
      dx = ev.clientX - startX;
      dy = ev.clientY - startY;
      if (decided === null) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          decided = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
          if (decided === 'h') {
            track.classList.add('llw-dragging');
            if (viewport.setPointerCapture) viewport.setPointerCapture(pointerId);
          }
        }
      }
      if (decided === 'h') {
        ev.preventDefault();
        const vw = viewport.clientWidth || 1;
        let offsetPct = (dx / vw) * 100;
        // Rubber-band resistance past the first/last page - a full free drag
        // there would feel like the page detached from the row behind it,
        // same reasoning as iOS's own scroll bounce.
        if ((currentPage === 0 && dx > 0) || (currentPage === pageEls.length - 1 && dx < 0)) {
          offsetPct *= 0.35;
        }
        track.style.transform = `translateX(calc(-${currentPage * 100}% + ${offsetPct}%))`;
      }
    });

    function endSwipe(ev) {
      if (!active) return;
      active = false;
      track.classList.remove('llw-dragging');
      if (decided === 'h') {
        const vw = viewport.clientWidth || 1;
        const threshold = vw * 0.18;
        let target = currentPage;
        if (dx <= -threshold) target = currentPage + 1;
        else if (dx >= threshold) target = currentPage - 1;
        goToPage(target);
      }
      decided = null;
    }
    viewport.addEventListener('pointerup', endSwipe);
    viewport.addEventListener('pointercancel', endSwipe);
  }

  function setEditMode(on) {
    editMode = on;
    document.body.classList.toggle('llw-edit-mode', editMode);
    document.getElementById('llw-edit-toggle').textContent = editMode ? t('app', 'done') : t('app', 'edit');
    pageEls.forEach((pageEl) => {
      if (pageEl.gridstack) editMode ? pageEl.gridstack.enable() : pageEl.gridstack.disable();
    });
    // Toggling edit mode is what makes the one trailing blank page
    // appear/disappear (see syncPageCount) - resync right away so the dots
    // and swipe range reflect it immediately instead of only after the next
    // unrelated change.
    syncPageCount();
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
        // New widgets always land on whichever page is currently in view -
        // not always page 0 - so adding something while looking at page 2
        // puts it right where you're looking, not somewhere you'd have to
        // go find.
        addWidgetElement({ type: id, page: currentPage, config: def.defaultConfig ? def.defaultConfig() : {} });
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

    // 3. Pages (each its own grid) + saved layout. Starts in view mode - the
    //    grids themselves start disabled (see createPage) and there's always
    //    at least a page 0 to render into, even before anything's loaded.
    ensurePageCount(1);

    let layout = { widgets: [] };
    try {
      layout = await LL.api.get(layoutUrl(''));
    } catch (err) {
      console.warn('[loudllama] Could not load layout', err);
    }
    layout.widgets.forEach(addWidgetElement);
    // Covers the (rare) case of a genuinely empty layout, where the forEach
    // above never runs at all - still need the dots/llw-multi-page state
    // initialized once.
    syncPageCount();
    setupPagesSwipe();

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
