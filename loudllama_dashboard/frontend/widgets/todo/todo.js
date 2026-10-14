/*
 * LoudLlama Dashboard - To-do/shopping list widget.
 *
 * Full CRUD against one Home Assistant `todo.*` entity - the built-in
 * to-do/shopping-list integration, same one HA's own "Shopping list" card
 * and the Home Assistant Companion app's own to-do screen read and write.
 * Unlike almost every other domain this dashboard talks to, a todo entity's
 * actual items don't live in its `attributes` - they live behind three
 * services (`todo.get_items`/`add_item`/`update_item`/`remove_item`), which
 * is why there's a dedicated backend endpoint (GET
 * /api/hass/todo_items/:entityId, wrapping get_items the same way
 * /api/hass/weather_forecast wraps weather.get_forecasts) alongside the
 * generic POST /api/hass/service/:domain/:service every other widget
 * already uses for add/update/remove. See server.js's own comments on both
 * for the full why.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const POLL_MS = 20 * 1000; // another device/automation can edit the same list
  const RECONCILE_DELAY_MS = 900;

  function mount(el, { config, saveConfig }) {
    let entityId = config.entity_id || '';
    let items = [];
    let pollTimer = null;
    let destroyed = false;

    el.classList.add('llw-widget-todo');
    el.innerHTML = `
      <div class="llw-todo">
        <div class="llw-todo__head">
          <span class="llw-todo__name">${t('todo', 'chooseEntity')}</span>
          <button class="llw-todo__gear" type="button" title="${t('todo', 'chooseEntity')}">${LL.icons.gear()}</button>
        </div>
        <form class="llw-todo__add-row">
          <input type="text" class="llw-todo__add-input" placeholder="${t('todo', 'addPlaceholder')}" maxlength="200" />
          <button type="submit" class="llw-todo__add-btn" aria-label="${t('todo', 'add')}">+</button>
        </form>
        <div class="llw-todo__list"></div>
        <div class="llw-todo__settings">
          <label>${t('todo', 'chooseEntity')}</label>
          <select class="llw-todo__select"><option value="">…</option></select>
          <button type="button" class="llw-todo__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const nameEl = el.querySelector('.llw-todo__name');
    const gearBtn = el.querySelector('.llw-todo__gear');
    const settingsEl = el.querySelector('.llw-todo__settings');
    const selectEl = el.querySelector('.llw-todo__select');
    const closeBtn = el.querySelector('.llw-todo__close');
    const addForm = el.querySelector('.llw-todo__add-row');
    const addInput = el.querySelector('.llw-todo__add-input');
    const listEl = el.querySelector('.llw-todo__list');

    gearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.add('llw-open');
      loadEntityOptions();
    });
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.remove('llw-open');
    });
    settingsEl.addEventListener('click', (ev) => ev.stopPropagation());
    selectEl.addEventListener('change', () => {
      entityId = selectEl.value;
      // ...config, not a bare { entity_id } - see weather.js's identical fix
      // for why: saveConfig() replaces the whole saved config.
      saveConfig({ ...config, entity_id: entityId });
      fetchAndRender();
    });

    async function loadEntityOptions() {
      selectEl.innerHTML = `<option value="">…</option>`;
      try {
        const entities = await LL.api.get('api/hass/states?domain=todo');
        if (destroyed) return;
        if (!entities.length) {
          selectEl.innerHTML = `<option value="">${t('todo', 'noEntities')}</option>`;
          return;
        }
        const placeholder = `<option value="" ${entityId ? '' : 'selected'}>…</option>`;
        selectEl.innerHTML = placeholder + entities
          .map((e) => `<option value="${e.entity_id}" ${e.entity_id === entityId ? 'selected' : ''}>${(e.attributes && e.attributes.friendly_name) || e.entity_id}</option>`)
          .join('');
      } catch (err) {
        console.error('[loudllama][todo] Failed to load entity list', err);
      }
    }

    function renderEmpty(message) {
      nameEl.textContent = t('todo', 'chooseEntity');
      listEl.innerHTML = `<div class="llw-todo__empty">${message}</div>`;
    }

    function escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function render(entityName) {
      if (entityName !== undefined) nameEl.textContent = entityName;
      if (!items.length) {
        listEl.innerHTML = `<div class="llw-todo__empty">${t('todo', 'empty')}</div>`;
        return;
      }
      // Open items first (newest-added last within each group), completed
      // ones sink to the bottom with a strikethrough - same shape as every
      // shopping-list app this is standing in for.
      const sorted = items.slice().sort((a, b) => {
        const aDone = a.status === 'completed' ? 1 : 0;
        const bDone = b.status === 'completed' ? 1 : 0;
        return aDone - bDone;
      });
      listEl.innerHTML = sorted
        .map((it) => `
          <div class="llw-todo__row ${it.status === 'completed' ? 'is-done' : ''}" data-uid="${escapeHtml(it.uid)}">
            <label class="llw-todo__check">
              <input type="checkbox" ${it.status === 'completed' ? 'checked' : ''} />
              <span class="llw-todo__check-box"></span>
            </label>
            <span class="llw-todo__summary">${escapeHtml(it.summary)}</span>
            <button type="button" class="llw-todo__remove" aria-label="${t('todo', 'remove')}">×</button>
          </div>`)
        .join('');
      listEl.querySelectorAll('.llw-todo__row').forEach((row) => {
        const uid = row.dataset.uid;
        row.querySelector('input[type="checkbox"]').addEventListener('change', (ev) => toggleItem(uid, ev.target.checked));
        row.querySelector('.llw-todo__remove').addEventListener('click', () => removeItem(uid));
      });
    }

    addForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const summary = addInput.value.trim();
      if (!summary || !entityId) return;
      addInput.value = '';
      // Optimistic: shows the new item immediately (with a throwaway local
      // uid) rather than waiting a round trip - fetchAndRender() below
      // replaces it with the real server copy (real uid included) shortly
      // after, same "optimistic UI + reconcile" shape Room's own toggles use.
      items.push({ uid: `__pending_${Date.now()}`, summary, status: 'needs_action' });
      render();
      LL.api.post('api/hass/service/todo/add_item', { entity_id: entityId, item: summary })
        .catch((err) => console.error('[loudllama][todo] add_item failed', err))
        .finally(() => setTimeout(() => { if (!destroyed) fetchAndRender(); }, RECONCILE_DELAY_MS));
    });

    function toggleItem(uid, checked) {
      const item = items.find((it) => it.uid === uid);
      if (!item) return;
      const previousStatus = item.status;
      item.status = checked ? 'completed' : 'needs_action';
      render();
      LL.api.post('api/hass/service/todo/update_item', { entity_id: entityId, item: uid, status: item.status })
        .catch((err) => {
          console.error('[loudllama][todo] update_item failed', err);
          item.status = previousStatus;
          if (!destroyed) render();
        })
        .finally(() => setTimeout(() => { if (!destroyed) fetchAndRender(); }, RECONCILE_DELAY_MS));
    }

    function removeItem(uid) {
      const previousItems = items;
      items = items.filter((it) => it.uid !== uid);
      render();
      LL.api.post('api/hass/service/todo/remove_item', { entity_id: entityId, item: [uid] })
        .catch((err) => {
          console.error('[loudllama][todo] remove_item failed', err);
          items = previousItems;
          if (!destroyed) render();
        })
        .finally(() => setTimeout(() => { if (!destroyed) fetchAndRender(); }, RECONCILE_DELAY_MS));
    }

    async function fetchAndRender() {
      if (!entityId) {
        renderEmpty(t('todo', 'noEntity'));
        return;
      }
      try {
        const [entity, itemsResult] = await Promise.all([
          LL.api.get(`api/hass/states/${encodeURIComponent(entityId)}`),
          LL.api.get(`api/hass/todo_items/${encodeURIComponent(entityId)}`),
        ]);
        if (destroyed) return;
        items = itemsResult.items || [];
        render((entity && entity.attributes && entity.attributes.friendly_name) || entityId);
      } catch (err) {
        console.error('[loudllama][todo] Failed to fetch list', err);
        if (!destroyed) renderEmpty(t('app', 'connectionError'));
      }
    }

    fetchAndRender();
    if (!entityId) loadEntityOptions();
    pollTimer = setInterval(fetchAndRender, POLL_MS);

    el._llwCleanup = () => {
      destroyed = true;
      clearInterval(pollTimer);
    };
  }

  LL.registerWidget('todo', {
    name: { en: 'To-do/shopping list', da: 'Gøremål/indkøbsliste', de: 'Aufgaben/Einkaufsliste', sv: 'Att göra/inköpslista', no: 'Gjøremål/handleliste' },
    defaultSize: { w: 2, h: 3 },
    minSize: { w: 2, h: 2 },
    defaultConfig: () => ({ entity_id: '' }),
    mount,
  });
})();
