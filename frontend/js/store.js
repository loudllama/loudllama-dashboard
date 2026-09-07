/*
 * LoudLlama Dashboard - Widget store.
 *
 * Lets people pick which of the widgets bundled with the add-on are active
 * on their dashboard, instead of every widget always being loaded whether
 * they use it or not. Installing a widget here makes it usable immediately
 * (no reload): it fetches that widget's JS/CSS on the spot via
 * LL.loadWidgetAssets and refreshes the "+ Add widget" menu. Uninstalling
 * never touches widgets already placed on the dashboard - it only stops
 * offering the type under "+ Add widget" (see app.js mountWidget's
 * not-installed placeholder for what a placed-but-uninstalled widget looks
 * like).
 */
(function () {
  const LL = (window.LoudLlama = window.LoudLlama || {});
  const { t } = LL.i18n;

  // Purely decorative fallback so the store has *something* to show next to
  // each widget without pulling in an icon font. Unknown future widget ids
  // just get a generic puzzle piece.
  const EMOJI = {
    weather: '🌤️',
    frigate: '📷',
    room: '🚪',
  };

  let activeModal = null;
  let pendingIds = null; // in-flight optimistic install/uninstall state

  function pick(strings, fallback) {
    if (!strings) return fallback || '';
    return strings[LL.i18n.lang] || strings.en || fallback || '';
  }

  function closeStore() {
    if (!activeModal) return;
    document.removeEventListener('keydown', onKeydown);
    activeModal.remove();
    activeModal = null;
  }

  function onKeydown(ev) {
    if (ev.key === 'Escape') closeStore();
  }

  async function toggleInstalled(id, install) {
    const next = new Set(pendingIds);
    if (install) next.add(id);
    else next.delete(id);
    pendingIds = Array.from(next);
    LL.installedWidgetIds = pendingIds;

    try {
      await LL.api.post('api/widgets/installed', { installed: pendingIds });
    } catch (err) {
      console.error('[loudllama] Failed to save widget store selection', err);
    }

    if (install) {
      const entry = (LL.widgetCatalog || []).find((w) => w.id === id);
      await LL.loadWidgetAssets(entry);
    }
    LL.refreshAddWidgetMenu && LL.refreshAddWidgetMenu();
  }

  function renderList(container, catalog) {
    container.innerHTML = '';
    catalog.forEach((widget) => {
      const installed = pendingIds.includes(widget.id);
      const row = document.createElement('div');
      row.className = 'llw-store-item';
      row.innerHTML = `
        <div class="llw-store-item__icon">${EMOJI[widget.id] || '🧩'}</div>
        <div class="llw-store-item__text">
          <div class="llw-store-item__name">${pick(widget.name, widget.id)}</div>
          <div class="llw-store-item__desc">${pick(widget.description, '')}</div>
        </div>
        <button type="button" class="llw-store-item__toggle${installed ? ' llw-store-item__toggle--on' : ''}" role="switch" aria-checked="${installed}">
          <span class="llw-store-item__toggle-knob"></span>
        </button>
      `;
      const toggleBtn = row.querySelector('.llw-store-item__toggle');
      toggleBtn.title = installed ? t('store', 'uninstall') : t('store', 'install');
      toggleBtn.addEventListener('click', async () => {
        const nowInstalled = !toggleBtn.classList.contains('llw-store-item__toggle--on');
        toggleBtn.classList.toggle('llw-store-item__toggle--on', nowInstalled);
        toggleBtn.setAttribute('aria-checked', String(nowInstalled));
        toggleBtn.title = nowInstalled ? t('store', 'uninstall') : t('store', 'install');
        await toggleInstalled(widget.id, nowInstalled);
      });
      container.appendChild(row);
    });
  }

  async function openStore() {
    closeStore();

    const modal = document.createElement('div');
    modal.className = 'llw-store-modal';
    modal.innerHTML = `
      <div class="llw-store-modal__card">
        <div class="llw-store-modal__head">
          <div>
            <div class="llw-store-modal__title">${t('store', 'title')}</div>
            <div class="llw-store-modal__subtitle">${t('store', 'subtitle')}</div>
          </div>
          <button type="button" class="llw-store-modal__close" title="${t('store', 'close')}" aria-label="${t('store', 'close')}">×</button>
        </div>
        <div class="llw-store-modal__body">
          <div class="llw-store-list llw-store-list--loading">…</div>
          <div class="llw-store-modal__note">${t('store', 'uninstallNote')}</div>
        </div>
      </div>
    `;
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) closeStore();
    });
    modal.querySelector('.llw-store-modal__close').addEventListener('click', closeStore);
    document.body.appendChild(modal);
    document.addEventListener('keydown', onKeydown);
    activeModal = modal;

    const listEl = modal.querySelector('.llw-store-list');
    try {
      const [catalog, installedRes] = await Promise.all([
        LL.api.get('api/widgets'),
        LL.api.get('api/widgets/installed'),
      ]);
      LL.widgetMeta = {};
      catalog.forEach((w) => { LL.widgetMeta[w.id] = w; });
      pendingIds = (installedRes && installedRes.installed) || [];
      LL.installedWidgetIds = pendingIds;
      listEl.classList.remove('llw-store-list--loading');
      renderList(listEl, catalog);
    } catch (err) {
      console.error('[loudllama] Failed to load widget store', err);
      listEl.classList.remove('llw-store-list--loading');
      listEl.textContent = t('store', 'loadError');
    }
  }

  LL.openWidgetStore = openStore;
})();
