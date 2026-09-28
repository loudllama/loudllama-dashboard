/*
 * LoudLlama Dashboard - Group widget.
 *
 * A plain, user-named container for other widgets - the "put a few things
 * together under one tile" counterpart to Room (which is specifically a
 * room: pick entities, they get auto-grouped and auto-populate their own
 * sub-widgets). A Group starts empty; you name it, open it, and use its own
 * "+ Add widget" to put whichever installed widgets you want inside, then
 * drag/resize them on their own small grid - same idea as Room's nested
 * grid, reused directly (see widgets/room/room.js's big comment on why a
 * widget only ever needs a DOM element + {config, saveConfig} to mount, so
 * the exact same code runs standalone or nested either way).
 *
 * Deliberately NOT nestable inside itself (see LL.groupAddableWidgetIds in
 * the mount() below) - one level of "a tile that contains other tiles" is
 * plenty for a home dashboard, and ruling out Group-inside-Group sidesteps
 * having to think about infinite recursion anywhere else in the app.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const SUBGRID_COLUMNS = 4;
  const SUBGRID_CELL_HEIGHT = 78;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function mount(el, { config, saveConfig }) {
    let cfg = {
      name: config.name || '',
      // Full widget entries (id/type/x/y/w/h/config) - unlike Room's
      // subWidgets these are never derived automatically, only ever added
      // or removed by hand via this widget's own "+ Add widget" button.
      widgets: Array.isArray(config.widgets) ? config.widgets.slice() : [],
    };
    let destroyed = false;
    let activeModal = null;
    let subGrid = null;
    let subWidgetCleanups = [];
    let arranging = false;
    let saveTimer = null;
    let editorDraftName = '';

    function scheduleSaveGroup() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveConfig(cfg), 500);
    }

    el.classList.add('llw-widget-group');
    el.innerHTML = `
      <div class="llw-group">
        <div class="llw-group__bg"></div>
        <div class="llw-group__content">
          <div class="llw-group__head">
            <span class="llw-group__name"></span>
            <button class="llw-group__gear" type="button">⚙</button>
          </div>
          <div class="llw-group__glance"></div>
        </div>
        <div class="llw-group__editor"></div>
      </div>
    `;

    const groupEl = el.querySelector('.llw-group');
    const nameEl = el.querySelector('.llw-group__name');
    const glanceEl = el.querySelector('.llw-group__glance');
    const gearBtn = el.querySelector('.llw-group__gear');
    const editorEl = el.querySelector('.llw-group__editor');

    // --- Name editor (setup + later rename) ------------------------------
    function openEditor() {
      editorDraftName = cfg.name;
      editorEl.classList.add('llw-open');
      const canCancel = !!cfg.name;
      editorEl.innerHTML = `
        <div class="llw-group__editor-inner">
          ${canCancel ? `<button type="button" class="llw-group__editor-close" aria-label="${t('group', 'close')}">×</button>` : ''}
          <label class="llw-group__editor-label">${t('group', 'setupTitle')}</label>
          <input type="text" class="llw-group__name-input" placeholder="${escapeHtml(t('group', 'namePlaceholder'))}" value="${escapeHtml(editorDraftName)}" maxlength="40" />
          <div class="llw-group__editor-actions">
            <button type="button" class="llw-group__save">${t('group', 'save')}</button>
          </div>
        </div>
      `;
      const input = editorEl.querySelector('.llw-group__name-input');
      const commit = () => {
        const val = input.value.trim();
        if (!val) {
          input.classList.add('llw-shake');
          input.focus();
          setTimeout(() => input.classList.remove('llw-shake'), 300);
          return;
        }
        cfg = { ...cfg, name: val };
        saveConfig(cfg);
        closeEditor();
        renderCompact();
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') commit();
      });
      editorEl.querySelector('.llw-group__save').addEventListener('click', commit);
      if (canCancel) editorEl.querySelector('.llw-group__editor-close').addEventListener('click', closeEditor);
      requestAnimationFrame(() => input.focus());
    }

    function closeEditor() {
      editorEl.classList.remove('llw-open');
    }

    gearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openEditor();
    });

    // --- Compact glance tile ------------------------------------------------
    function renderCompact() {
      nameEl.textContent = cfg.name;
      groupEl.style.setProperty('--group-hue', String(hashHue(cfg.name || 'group')));
      groupEl.classList.toggle('llw-group--clickable', !!cfg.name);
      const count = cfg.widgets.length;
      glanceEl.innerHTML = count
        ? `<div class="llw-group__count">${count}</div><div class="llw-group__hint">${t('room', 'tapToOpen')}</div>`
        : `<div class="llw-group__empty">${escapeHtml(t('group', 'empty'))}</div>`;
    }

    groupEl.addEventListener('click', (ev) => {
      if (document.body.classList.contains('llw-edit-mode')) return;
      if (ev.target.closest('.llw-group__gear')) return;
      if (!cfg.name) return;
      openModal();
    });

    // --- Nested grid (same pattern as Room's mountSubWidgets) ----------------
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

    function addableWidgetIds() {
      // Any installed widget except Group itself (no nesting groups inside
      // groups - see the file header comment).
      return Object.keys(LL.widgetTypes).filter((id) => id !== 'group' && LL.installedWidgetIds.includes(id));
    }

    function refreshAddMenu(menuEl) {
      menuEl.innerHTML = '';
      const ids = addableWidgetIds();
      if (!ids.length) {
        const empty = document.createElement('div');
        empty.className = 'llw-group-menu__empty';
        empty.textContent = t('app', 'noWidgetsInstalled');
        menuEl.appendChild(empty);
        return;
      }
      ids.forEach((id) => {
        const def = LL.widgetTypes[id];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'llw-group-menu__item';
        btn.textContent = (def.name && (def.name[LL.i18n.lang] || def.name.en)) || id;
        btn.addEventListener('click', () => {
          addChildWidget(id);
          menuEl.classList.remove('llw-open');
        });
        menuEl.appendChild(btn);
      });
    }

    function addChildWidget(type) {
      const def = LL.widgetTypes[type];
      const entry = {
        id: `${type}-${Date.now().toString(36)}`,
        type,
        w: (def && def.defaultSize && def.defaultSize.w) || 2,
        h: (def && def.defaultSize && def.defaultSize.h) || 2,
        config: def && def.defaultConfig ? def.defaultConfig() : {},
      };
      cfg.widgets.push(entry);
      mountChildTile(entry);
      renderCompact();
      scheduleSaveGroup();
    }

    function removeChildWidget(childId) {
      const tile = subGrid && subGrid.el.querySelector(`[gs-id="${CSS.escape(childId)}"]`);
      if (tile) {
        const bodyEl = tile.querySelector('.llw-body');
        if (bodyEl && typeof bodyEl._llwCleanup === 'function') {
          bodyEl._llwCleanup();
          subWidgetCleanups = subWidgetCleanups.filter((fn) => fn !== bodyEl._llwCleanup);
        }
        subGrid.removeWidget(tile);
      }
      cfg.widgets = cfg.widgets.filter((w) => w.id !== childId);
      renderCompact();
      scheduleSaveGroup();
    }

    function mountChildTile(entry) {
      const def = LL.widgetTypes[entry.type];
      const tileEl = document.createElement('div');
      tileEl.className = 'grid-stack-item';
      tileEl.setAttribute('gs-id', entry.id);
      tileEl.setAttribute('gs-w', entry.w || 2);
      tileEl.setAttribute('gs-h', entry.h || 2);
      if (entry.x !== undefined && entry.y !== undefined) {
        tileEl.setAttribute('gs-x', entry.x);
        tileEl.setAttribute('gs-y', entry.y);
      } else {
        tileEl.setAttribute('gs-auto-position', 'true');
      }
      tileEl.innerHTML = `
        <div class="grid-stack-item-content llw-widget llw-group-subwidget">
          <button class="llw-group-subwidget__remove" type="button" title="${t('app', 'removeWidget')}" aria-label="${t('app', 'removeWidget')}">×</button>
          <div class="llw-body"></div>
        </div>`;
      subGrid.addWidget(tileEl);
      tileEl.querySelector('.llw-group-subwidget__remove').addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeChildWidget(entry.id);
      });

      const bodyEl = tileEl.querySelector('.llw-body');
      if (def) {
        def.mount(bodyEl, {
          config: entry.config || {},
          saveConfig(newConfig) {
            entry.config = newConfig;
            scheduleSaveGroup();
          },
        });
        if (typeof bodyEl._llwCleanup === 'function') subWidgetCleanups.push(bodyEl._llwCleanup);
      } else {
        bodyEl.innerHTML = `<div class="llw-error">${t('app', 'widgetNotInstalled')}</div>`;
      }
    }

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
      subGrid.disable();

      cfg.widgets.forEach(mountChildTile);

      subGrid.on('change', () => {
        // Same reasoning as app.js's serializeLayout and Room's
        // mountSubWidgets: grid.save() always strips `.el`, so read each
        // live item's own `.gridstackNode` instead of relying on it.
        Array.from(subGrid.el.children).forEach((itemEl) => {
          if (!itemEl.classList.contains('grid-stack-item') || !itemEl.gridstackNode) return;
          const node = itemEl.gridstackNode;
          const entry = cfg.widgets.find((w) => w.id === node.id);
          if (entry) {
            entry.x = node.x;
            entry.y = node.y;
            entry.w = node.w;
            entry.h = node.h;
          }
        });
        scheduleSaveGroup();
      });
    }

    function setArranging(on) {
      arranging = on;
      if (!activeModal) return;
      activeModal.classList.toggle('llw-group-modal--arranging', arranging);
      const btn = activeModal.querySelector('.llw-group-modal__arrange');
      if (btn) btn.classList.toggle('is-active', arranging);
      activeModal.querySelectorAll('.llw-group-subwidget__remove').forEach((b) => {
        b.style.display = arranging ? 'flex' : 'none';
      });
      if (subGrid) arranging ? subGrid.enable() : subGrid.disable();
    }

    function openModal() {
      closeModal();
      const modal = document.createElement('div');
      modal.className = 'llw-group-modal';
      modal.innerHTML = `
        <div class="llw-group-modal__card">
          <div class="llw-group-modal__head">
            <span class="llw-group-modal__title">${escapeHtml(cfg.name)}</span>
            <div class="llw-group-modal__head-actions">
              <div class="llw-group-add-wrap">
                <button type="button" class="llw-group-modal__add" title="${t('app', 'addWidget')}">+ ${t('app', 'addWidget')}</button>
                <div class="llw-group-menu"></div>
              </div>
              <button type="button" class="llw-group-modal__arrange" title="${t('group', 'arrange')}" aria-label="${t('group', 'arrange')}">✥</button>
              <button type="button" class="llw-group-modal__close" aria-label="${t('group', 'close')}">×</button>
            </div>
          </div>
          <div class="llw-group-modal__body">
            <div class="grid-stack llw-group-modal__subgrid"></div>
          </div>
        </div>
      `;
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeModal();
      });
      modal.querySelector('.llw-group-modal__close').addEventListener('click', closeModal);
      modal.querySelector('.llw-group-modal__arrange').addEventListener('click', () => setArranging(!arranging));

      const addBtn = modal.querySelector('.llw-group-modal__add');
      const addMenu = modal.querySelector('.llw-group-menu');
      addBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        refreshAddMenu(addMenu);
        addMenu.classList.toggle('llw-open');
      });
      modal.addEventListener('click', (ev) => {
        if (!ev.target.closest('.llw-group-add-wrap')) addMenu.classList.remove('llw-open');
      });

      document.body.appendChild(modal);
      document.addEventListener('keydown', onModalKeydown);
      activeModal = modal;

      mountSubWidgets(modal.querySelector('.llw-group-modal__subgrid'));
      // Start straight into arrange mode when the group is empty - an
      // empty group otherwise has nothing to click and no obvious way in.
      if (!cfg.widgets.length) setArranging(true);
      else setArranging(false);
    }

    // --- Boot ------------------------------------------------------------------
    if (!cfg.name) {
      openEditor();
      renderCompact();
    } else {
      renderCompact();
    }

    el._llwCleanup = () => {
      destroyed = true;
      closeModal();
    };
  }

  LL.registerWidget('group', {
    name: { en: 'Group', da: 'Gruppe', de: 'Gruppe', sv: 'Grupp', no: 'Gruppe' },
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 2, h: 2 },
    defaultConfig: () => ({ name: '', widgets: [] }),
    mount,
  });
})();
