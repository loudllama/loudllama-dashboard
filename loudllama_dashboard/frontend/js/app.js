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

  // Every popup (Room's view/editor, Group's bubble, Frigate's fullscreen
  // view, the widget store) used to just call .remove() the instant it
  // closed - fine for the open side, which has a nice llw-pop-in/llw-fade-in
  // animation (see app.css), but jarring for the close side, which had
  // nothing. A close function now instead adds a `--closing` class (see
  // llw-pop-out/llw-fade-out in app.css) and awaits this before removing the
  // element, so the same spring-in motion plays in reverse on the way out.
  // Resolves on whichever of 'animationend'/'transitionend' fires first (an
  // element might use either, e.g. Group's card closes via a plain CSS
  // transition rather than a keyframe animation), or after `fallbackMs`
  // regardless - so a browser quirk, or prefers-reduced-motion having
  // already removed the animation in CSS, can never leave a popup stuck on
  // screen forever. Resolves immediately when the user has asked for
  // reduced motion, so turning that on doesn't add a pointless delay to
  // every close with nothing to show for it.
  LL.waitForExitAnimation = function waitForExitAnimation(el, fallbackMs) {
    if (!el || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener('animationend', finish);
        el.removeEventListener('transitionend', finish);
        resolve();
      };
      el.addEventListener('animationend', finish);
      el.addEventListener('transitionend', finish);
      setTimeout(finish, fallbackMs || 300);
    });
  };

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
  // the backend can keep this device's entire dashboard - which widgets
  // exist, their settings, their size and position - fully separate from
  // every other device's. See the big comment above the layout endpoints
  // in backend/server.js for why nothing is shared across devices any more.
  function layoutUrl(suffix) {
    return `api/layout${suffix}${suffix.includes('?') ? '&' : '?'}device=${encodeURIComponent(LL.deviceId || 'default')}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    // Still stored/round-tripped (see serializeLayout()) even though nothing
    // renders it any more, so a dashboard saved by an older version that did
    // show captions doesn't lose that data - just stops displaying it.
    el.dataset.widgetLabel = node.label || '';
    el.innerHTML = `
      <div class="llw-widget-shell">
        <div class="llw-widget">
          <button class="llw-remove" title="${t('app', 'removeWidget')}" aria-label="${t('app', 'removeWidget')}">−</button>
          <button class="llw-pin" title="${t('app', 'pinToDock')}" aria-label="${t('app', 'pinToDock')}">📌</button>
          <button class="llw-page-move llw-page-prev" title="${t('app', 'movePagePrev')}" aria-label="${t('app', 'movePagePrev')}">‹</button>
          <button class="llw-page-move llw-page-next" title="${t('app', 'movePageNext')}" aria-label="${t('app', 'movePageNext')}">›</button>
          <div class="llw-body"></div>
        </div>
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
    // A saved layout always has a real x/y (even 0,0 legitimately) and
    // should land exactly there. A brand new widget - from the "+ Add
    // widget" menu/size picker, which never passes x/y - has no position
    // yet, and defaulting it to a hardcoded (0,0) (the old behaviour) made
    // GridStack treat that as a *requested* spot: colliding with whatever
    // already occupies (0,0) just pushes the new widget straight down the
    // same column, one row below the tallest thing above it, even when a
    // whole empty column was sitting right next to it. That's what was
    // leaving tall blank gaps next to short compact tiles instead of
    // packing them in beside each other. gs-auto-position tells GridStack
    // to actually search the grid for the first free cell instead (still
    // respecting float), which is what we want whenever there's no real
    // saved position to honour.
    if (node.x !== undefined && node.y !== undefined) {
      el.setAttribute('gs-x', size.x ?? 0);
      el.setAttribute('gs-y', size.y ?? 0);
    } else {
      el.setAttribute('gs-auto-position', 'true');
    }
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
    // autoPosition, not a hardcoded x:0/y:0 - see addWidgetElement's own
    // comment on gs-auto-position for why: a *requested* (0,0) just pushes
    // straight down the same column on collision, which can leave a tall
    // blank gap next to a free column instead of using it. autoPosition
    // makes GridStack actually search the destination page for a free
    // cell instead of assuming (0,0) specifically is open.
    destPageEl.gridstack.makeWidget(el, { autoPosition: true, w, h });
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
        // GridStack's legacy "one column mode" (the old default behind
        // disableOneColumnMode: false) collapses EVERY widget to a
        // full-viewport-width row below its breakpoint (768px), ignoring
        // w/x entirely - on a phone that made every widget "too big"
        // regardless of its grid size, which was the original complaint
        // this whole size-variant feature exists to fix, and it would also
        // have silently defeated the feature itself: a 1x1 compact tile
        // would still render as a full-width bar instead of a small icon,
        // same as a 2x2 full widget. Disabling it in favor of columnOpts
        // below keeps an actual multi-column grid at every width.
        disableOneColumnMode: true,
        // Column count adapts to screen width instead of staying fixed at
        // 12, picking whatever count keeps each column close to
        // columnWidth's 90px (matching cellHeight above, so a cell stays
        // roughly square on any device - a phone lands around 4 columns,
        // a tablet/desktop around 12). Without this, a fixed 12-column
        // grid on a ~390px phone gives ~30px columns - too thin for even a
        // compact 1x1 tile to read as a square icon. 'compact' re-packs
        // widgets tightly whenever the column count itself changes (e.g.
        // rotating the device), same spirit as this grid's own float
        // packing, instead of leaving gaps or overflowing.
        columnOpts: { columnWidth: 90, columnMax: 12, layout: 'compact' },
        // Free-form resizing is gone entirely (was 'e, s, w' edge handles,
        // snapping to a tier on resizestop - see wireGridEvents' git history
        // for that code). A widget's size is now a deliberate choice made
        // once, when it's added (see the size-variant picker in
        // buildAddWidgetMenu): either a fixed size for widgets with only one
        // shape, or a pick between that widget's own "full"/"compact"
        // variants (see LL.registerWidget's sizeVariants). Dragging a tile
        // to resize it on a phone was the single biggest source of "my
        // dashboard looks like a jumble" complaints - two or three presets
        // per widget, chosen with actual previews up front, reads as a tidy
        // tile grid the way free dragging never quite managed to.
        resizable: false,
      },
      pageEl
    );
    g.disable(); // matches whatever the *current* global edit mode is - see setEditMode, which enables every page's grid the same way
    if (editMode) g.enable();
    wireGridEvents(g);
    pageEls.push(pageEl);
    return pageEl;
  }

  // Every page's grid needs the same "save on any change" wiring
  // addWidgetElement's single global grid used to get once at init - now it
  // happens once per page, right when that page is created. (Used to also
  // snap a free resize to the nearest size tier on 'resizestop' - gone along
  // with free resizing itself, see createPage's resizable:false.)
  function wireGridEvents(g) {
    g.on('change', scheduleSave);
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

  // Press-and-hold-to-edit, now that there's no "Edit" button sitting on
  // screen to tap (see #llw-toolbar in app.css: hidden outside edit mode, so
  // a wall-mounted tablet/kiosk shows nothing but the dashboard itself).
  // Holding anywhere on the screen for HOLD_MS without moving much enters
  // edit mode - same gesture as holding an app icon on iOS/Android to start
  // rearranging the home screen, deliberately long enough that it can't be
  // triggered by an ordinary tap or scroll.
  function setupLongPressToEdit() {
    const HOLD_MS = 2500;
    const MOVE_TOLERANCE = 10; // px of wiggle room before a hold counts as a drag/scroll instead
    const hintEl = document.getElementById('llw-longpress-hint');
    // Only the fill layer's clip-path needs to be locked to HOLD_MS (the dim
    // base layer and the container's own fade-in keep their fixed CSS
    // timings) - see the .llw-longpress-hint__fill rule in app.css.
    const hintFillEl = hintEl ? hintEl.querySelector('.llw-longpress-hint__fill') : null;
    if (hintFillEl) hintFillEl.style.transitionDuration = `${HOLD_MS}ms`;
    let timer = null;
    let pointerId = null;
    let startX = 0;
    let startY = 0;

    function clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      pointerId = null;
      if (hintEl) hintEl.classList.remove('llw-growing');
    }

    function fire() {
      timer = null;
      if (hintEl) hintEl.classList.remove('llw-growing');
      setEditMode(true);
      // The finger/mouse is still down at this point - whatever's under it
      // (a room tile, a toggle, ...) would otherwise also receive the
      // ordinary 'click' once it's released a moment later, right as edit
      // mode opens underneath it. Swallow exactly that one click so holding
      // a widget to start editing doesn't *also* trigger the widget itself.
      const swallowOnce = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        document.removeEventListener('click', swallowOnce, true);
      };
      document.addEventListener('click', swallowOnce, true);
      setTimeout(() => document.removeEventListener('click', swallowOnce, true), 500);
    }

    document.addEventListener('pointerdown', (ev) => {
      if (editMode) return; // toolbar's already open, and there's nothing left to "enter"
      if (ev.button !== undefined && ev.button !== 0) return; // primary mouse button / touch / pen only
      // Holding a text field, a slider, a <select>, or a link shouldn't
      // flip into edit mode out from under whatever the user's actually
      // doing with it (e.g. dragging a brightness slider for a few seconds).
      if (ev.target.closest && ev.target.closest('input, select, textarea, a[href]')) return;
      clear();
      pointerId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
      if (hintEl) {
        hintEl.style.left = `${startX}px`;
        hintEl.style.top = `${startY}px`;
        void hintEl.offsetWidth; // force layout so the position above lands before the transition starts below
        hintEl.classList.add('llw-growing');
      }
      timer = setTimeout(fire, HOLD_MS);
    });

    document.addEventListener('pointermove', (ev) => {
      if (!timer || ev.pointerId !== pointerId) return;
      if (Math.abs(ev.clientX - startX) > MOVE_TOLERANCE || Math.abs(ev.clientY - startY) > MOVE_TOLERANCE) clear();
    });

    ['pointerup', 'pointercancel'].forEach((type) => {
      document.addEventListener(type, (ev) => {
        if (ev.pointerId === pointerId) clear();
      });
    });
  }

  // Kiosk mode: hide Home Assistant's OWN chrome around our dashboard - its
  // left sidebar on desktop, and the little top bar with a hamburger/back
  // button and a panel title that it puts above an Ingress panel on a
  // narrow screen (phone, tablet, the mobile companion app). On by default,
  // because the whole point of this dashboard is a clean, wall-mounted-
  // tablet-style screen with nothing on it but itself - see the long-press-
  // to-edit gesture above, which exists for exactly the same reason.
  //
  // This is inherently best-effort: it reaches into Home Assistant's own
  // frontend DOM (through its Shadow DOM, same-origin since Ingress just
  // mounts us on a path under the same HA host), which is NOT part of this
  // add-on and NOT something a future HA frontend release owes us any
  // stability on. Every lookup below is wrapped so that if HA's internal
  // structure doesn't match what's expected - a different HA version, a
  // custom frontend theme/fork, or this page loaded outside Ingress at all
  // (e.g. local development, where window.frameElement is simply null) -
  // this quietly does nothing instead of breaking the dashboard itself. If
  // it ever stops working after a Home Assistant update, the well-maintained
  // community "kiosk-mode" HACS integration is a solid, actively-updated
  // fallback that isn't tied to this add-on's own release cycle.
  function applyKioskMode() {
    // Walks into every shadow root under `root` looking for `selector`,
    // since Home Assistant's frontend is built almost entirely of custom
    // elements with their own (open) shadow DOM - a plain querySelectorAll
    // on the top document alone would never reach ha-sidebar etc.
    function deepQueryAll(root, selector, out) {
      out = out || [];
      try {
        root.querySelectorAll(selector).forEach((el) => out.push(el));
        root.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) deepQueryAll(el.shadowRoot, selector, out);
        });
      } catch (err) {
        // Ignore and keep whatever was already found - a detached node or a
        // shadow root that disappeared mid-walk shouldn't abort the sweep.
      }
      return out;
    }

    // parentElement doesn't cross a shadow boundary - when `node` is a
    // direct child of a shadow root, its siblings are that root's own
    // .children, and the next step up is the root's .host (the custom
    // element the shadow root belongs to), not node.parentElement (null).
    function siblingsOf(node) {
      if (node.parentElement) return Array.from(node.parentElement.children);
      const root = node.getRootNode();
      return root && root.children ? Array.from(root.children) : [];
    }
    function stepUp(node) {
      if (node.parentElement) return node.parentElement;
      const root = node.getRootNode();
      return (root && root.host) || null;
    }

    function hide(el) {
      if (el && el.style.display !== 'none') el.style.display = 'none';
    }

    function sweep(topDoc, frame) {
      // The desktop sidebar and the button that opens/closes it - a single,
      // long-stable custom element name across Home Assistant releases.
      deepQueryAll(topDoc, 'ha-sidebar').forEach(hide);
      deepQueryAll(topDoc, 'ha-menu-button').forEach(hide);

      // The Ingress wrapper's own top bar sits a few shadow-DOM levels
      // above our <iframe> - walk up from our OWN frame element and hide
      // only a toolbar/header-looking sibling we actually pass on the way
      // up, rather than every "toolbar" anywhere in Home Assistant (which
      // would also catch dialogs, more-info popups, etc. that have nothing
      // to do with our own panel).
      let node = frame;
      for (let i = 0; i < 8 && node; i++) {
        siblingsOf(node).forEach((sibling) => {
          if (sibling === node) return;
          const tag = sibling.tagName ? sibling.tagName.toLowerCase() : '';
          const cls = typeof sibling.className === 'string' ? sibling.className : '';
          if (/toolbar|app-bar|header/i.test(tag) || /toolbar|app-bar|header/i.test(cls)) hide(sibling);
        });
        node = stepUp(node);
      }
    }

    try {
      // window.frameElement is only non-null when we're same-origin inside
      // an iframe - exactly the Ingress case, and reliably null everywhere
      // else (local development, or this page opened directly), so it also
      // doubles as the "are we even running inside Home Assistant" check.
      const frame = window.frameElement;
      if (!frame) return;
      const topDoc = window.top.document;

      // Home Assistant's own UI can still be mid-render (or re-render, e.g.
      // reconnecting after the mobile app resumes from the background) the
      // first time we look, so sweep a few times early on rather than just
      // once, then settle - this isn't meant to run forever in the
      // background.
      [0, 400, 1200, 2500, 5000].forEach((delay) => {
        setTimeout(() => sweep(topDoc, frame), delay);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') sweep(topDoc, frame);
      });
    } catch (err) {
      // Most likely cause: not actually same-origin with window.top for
      // some reason, or HA's frontend isn't there at all. Either way, the
      // dashboard itself works fine without this - just log and move on.
      console.warn('[loudllama] Kiosk mode: could not reach Home Assistant\'s own UI, leaving it as-is', err);
    }
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
    const haSettingsBtn = document.getElementById('llw-ha-settings');
    if (haSettingsBtn) haSettingsBtn.textContent = `⚙️ ${t('app', 'haSettings')}`;
  }

  // Small representative emoji per widget type, used only as the icon shown
  // inside each size option's preview rectangle in the picker below -
  // purely decorative, doesn't touch what the widget itself renders.
  const LLW_PREVIEW_ICON = { room: '🏠', weather: '⛅', light: '💡', climate: '🌡️', media: '🔊', frigate: '📷', sensor: '📊', group: '🧩' };

  function localized(obj) {
    return (obj && (obj[LL.i18n.lang] || obj.en)) || '';
  }

  // Adds a widget straight away - the original one-click behaviour, still
  // used for every widget that only comes in one size (Sensor, Frigate,
  // Group, and any widget a future update adds without declaring
  // sizeVariants).
  function addWidgetFromMenu(id, def) {
    addWidgetElement({ type: id, page: currentPage, config: def.defaultConfig ? def.defaultConfig() : {} });
    scheduleSave();
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
        // A widget that declares two preset sizes asks which one first
        // (see showSizePicker) instead of landing on the dashboard right
        // away - everything else keeps the original one-click add.
        if (def.sizeVariants) {
          showSizePicker(id, def);
        } else {
          addWidgetFromMenu(id, def);
          menu.classList.remove('llw-open');
        }
      });
      menu.appendChild(btn);
    });
  }
  LL.refreshAddWidgetMenu = buildAddWidgetMenu;

  // Replaces the add-widget menu's contents with a two-option "which size"
  // picker for a widget that declares sizeVariants (see e.g. room.js's
  // registerWidget call) - a small proportional preview rectangle plus a
  // label per option, picked once up front instead of dragging a tile
  // around afterward (free resizing is gone entirely, see createPage's
  // resizable:false). Choosing an option adds the widget at that variant's
  // fixed size with config.sizeVariant set to 'full'/'compact', which is
  // what each widget's own mount() reads to decide which layout to render.
  function showSizePicker(id, def) {
    const menu = document.getElementById('llw-add-widget-menu');
    const icon = LLW_PREVIEW_ICON[id] || '◻';
    const variantKeys = ['full', 'compact'].filter((k) => def.sizeVariants[k]);
    menu.innerHTML = `
      <div class="llw-size-picker">
        <button type="button" class="llw-size-picker__back">‹ ${(def.name && localized(def.name)) || id}</button>
        <div class="llw-size-picker__title">${t('app', 'chooseSize')}</div>
        <div class="llw-size-picker__options">
          ${variantKeys
            .map((key) => {
              const variant = def.sizeVariants[key];
              return `
              <button type="button" class="llw-size-picker__opt" data-variant="${key}">
                <span class="llw-size-picker__preview" style="aspect-ratio:${variant.w}/${variant.h}">
                  <span class="llw-size-picker__icon">${icon}</span>
                </span>
                <span class="llw-size-picker__label">${localized(variant.label)}</span>
                <span class="llw-size-picker__dims">${variant.w}×${variant.h}</span>
              </button>`;
            })
            .join('')}
        </div>
      </div>
    `;
    menu.querySelector('.llw-size-picker__back').addEventListener('click', (ev) => {
      ev.stopPropagation();
      buildAddWidgetMenu();
    });
    menu.querySelectorAll('.llw-size-picker__opt').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const variant = def.sizeVariants[btn.dataset.variant];
        const config = { ...(def.defaultConfig ? def.defaultConfig() : {}), sizeVariant: btn.dataset.variant };
        addWidgetElement({ type: id, page: currentPage, w: variant.w, h: variant.h, config });
        scheduleSave();
        menu.classList.remove('llw-open');
        buildAddWidgetMenu(); // reset back to the main list for next time
      });
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
    setupLongPressToEdit();
    applyKioskMode();

    // 4. Chrome interactions.
    document.getElementById('llw-edit-toggle').addEventListener('click', () => setEditMode(!editMode));

    const addMenuBtn = document.getElementById('llw-add-widget');
    const addMenu = document.getElementById('llw-add-widget-menu');
    buildAddWidgetMenu();
    addMenuBtn.addEventListener('click', () => addMenu.classList.toggle('llw-open'));
    const addWidgetWrap = addMenuBtn.closest('.llw-add-widget-wrap');
    document.addEventListener('click', (ev) => {
      // composedPath(), not ev.target.closest(): picking a widget with
      // sizeVariants (see showSizePicker below) replaces this menu's
      // innerHTML *during* this same click's bubble phase, to swap the
      // widget list for the size picker without closing the menu - which
      // detaches ev.target from the document before this listener runs.
      // closest() on a detached node can never find an ancestor (there's
      // nothing to walk up to any more), so it always said "outside" and
      // closed the menu the instant the picker appeared. composedPath()
      // is captured at dispatch time, before any of that mutation, so it
      // still reflects where the click actually happened.
      if (!ev.composedPath().includes(addWidgetWrap)) addMenu.classList.remove('llw-open');
    });

    const storeBtn = document.getElementById('llw-store-open');
    if (storeBtn) {
      storeBtn.addEventListener('click', () => {
        addMenu.classList.remove('llw-open');
        LL.openWidgetStore && LL.openWidgetStore();
      });
    }

    // Jumps to Home Assistant's own Settings, not anything this add-on
    // hosts itself - we're running inside an Ingress iframe under a dynamic
    // per-session path (see the comment at the top of this file), so this
    // can't be a plain <a href="/config/dashboard">: that would try to load
    // Settings *inside* our own iframe, at our own Ingress path, which isn't
    // where it lives. window.top is the actual browser tab - same-origin
    // with the Ingress iframe either way (Ingress is just another path on
    // the same Home Assistant host), so setting its location takes the
    // whole tab to Home Assistant's real Settings page, leaving this
    // dashboard entirely, same as tapping "Settings" in HA's own sidebar
    // would. The settings button only matters at all once that sidebar is
    // the thing that's hidden (a kiosk-mode browser, a wall tablet) - with
    // it visible there's already a perfectly good way there.
    const haSettingsBtn = document.getElementById('llw-ha-settings');
    if (haSettingsBtn) {
      haSettingsBtn.addEventListener('click', () => {
        window.top.location.href = '/config/dashboard';
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
