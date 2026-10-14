/*
 * LoudLlama Dashboard - People widget ("who's home").
 *
 * Lists every `person.*` entity in Home Assistant - name, photo (proxied
 * through the backend the same way camera snapshots are, since Ingress
 * means this page can't just hotlink straight to HA's own host) and
 * home/away state - classic wall-dashboard presence glance. Deliberately
 * zero required setup: unlike every other widget here, there's no entity
 * picker at all, it just shows whoever Home Assistant already knows about.
 * The only thing settings lets you do is hide specific people (e.g. a
 * person entity nobody actually wants on the wall screen) - everyone shows
 * by default.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const POLL_MS = 30 * 1000; // presence can change while the dashboard just sits there

  function initialsFor(name) {
    return (name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?';
  }

  // Home Assistant's `person` state is 'home', 'not_home', or (with zone
  // detection set up) the zone's own slug/friendly name - anything that
  // isn't the two well-known values is shown verbatim rather than mapped to
  // a translated string, since there's no fixed list of possible zones.
  function stateLabel(state) {
    if (state === 'home') return t('people', 'home');
    if (state === 'not_home') return t('people', 'away');
    return state;
  }

  function mount(el, { config, saveConfig }) {
    let hiddenIds = Array.isArray(config.hiddenIds) ? config.hiddenIds.slice() : [];
    let allPersons = [];
    let pollTimer = null;
    let destroyed = false;

    el.classList.add('llw-widget-people');
    el.innerHTML = `
      <div class="llw-people">
        <div class="llw-people__head">
          <span class="llw-people__name">${t('people', 'title')}</span>
          <button class="llw-people__gear" type="button" title="${t('people', 'chooseVisible')}">⚙</button>
        </div>
        <div class="llw-people__list"></div>
        <div class="llw-people__settings">
          <label>${t('people', 'chooseVisible')}</label>
          <div class="llw-people__settings-list"></div>
          <button type="button" class="llw-people__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const listEl = el.querySelector('.llw-people__list');
    const gearBtn = el.querySelector('.llw-people__gear');
    const settingsEl = el.querySelector('.llw-people__settings');
    const settingsListEl = el.querySelector('.llw-people__settings-list');
    const closeBtn = el.querySelector('.llw-people__close');

    gearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.add('llw-open');
      renderSettingsList();
    });
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.remove('llw-open');
    });
    settingsEl.addEventListener('click', (ev) => ev.stopPropagation());

    function renderSettingsList() {
      if (!allPersons.length) {
        settingsListEl.innerHTML = `<div class="llw-people__empty">${t('people', 'noPersonsFound')}</div>`;
        return;
      }
      settingsListEl.innerHTML = allPersons
        .map((e) => `
          <label>
            <input type="checkbox" value="${e.entity_id}" ${hiddenIds.includes(e.entity_id) ? '' : 'checked'} />
            ${(e.attributes && e.attributes.friendly_name) || e.entity_id}
          </label>`)
        .join('');
      settingsListEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const shown = Array.from(settingsListEl.querySelectorAll('input[type="checkbox"]:checked')).map((c) => c.value);
          hiddenIds = allPersons.map((e) => e.entity_id).filter((id) => !shown.includes(id));
          // ...config, not a bare { hiddenIds } - see weather.js's identical
          // fix for why: saveConfig() replaces the whole saved config.
          saveConfig({ ...config, hiddenIds });
          renderList();
        });
      });
    }

    function renderList() {
      const visible = allPersons.filter((e) => !hiddenIds.includes(e.entity_id));
      if (!visible.length) {
        listEl.innerHTML = `<div class="llw-people__empty">${t('people', 'noPersonsFound')}</div>`;
        return;
      }
      listEl.innerHTML = visible
        .map((e) => {
          const name = (e.attributes && e.attributes.friendly_name) || e.entity_id;
          const isHome = e.state === 'home';
          return `
            <div class="llw-people__row">
              <span class="llw-people__avatar" data-entity="${e.entity_id}">
                <span class="llw-people__initials">${initialsFor(name)}</span>
              </span>
              <span class="llw-people__info">
                <span class="llw-people__person-name">${name}</span>
                <span class="llw-people__state ${isHome ? 'is-home' : ''}">${stateLabel(e.state)}</span>
              </span>
            </div>`;
        })
        .join('');
      // Try loading each person's actual photo on top of the initials
      // fallback above - not every person entity has entity_picture set
      // (common for a guest/pet/tracker-only person), and even one that
      // does might be behind a path this backend's proxy can't resolve, so
      // the initials circle stays as the <img>'s own parent and only gets
      // covered up once a real photo has actually finished loading.
      listEl.querySelectorAll('.llw-people__avatar').forEach((avatarEl) => {
        const id = avatarEl.dataset.entity;
        const img = document.createElement('img');
        img.alt = '';
        img.className = 'llw-people__photo';
        img.addEventListener('load', () => avatarEl.classList.add('has-photo'));
        img.addEventListener('error', () => img.remove());
        img.src = `api/hass/entity_picture/${encodeURIComponent(id)}?t=${Date.now()}`;
        avatarEl.appendChild(img);
      });
    }

    async function fetchAndRender() {
      try {
        allPersons = await LL.api.get('api/hass/states?domain=person');
        if (destroyed) return;
        renderList();
      } catch (err) {
        console.error('[loudllama][people] Failed to fetch persons', err);
        if (!destroyed) listEl.innerHTML = `<div class="llw-people__empty">${t('app', 'connectionError')}</div>`;
      }
    }

    fetchAndRender();
    pollTimer = setInterval(fetchAndRender, POLL_MS);

    el._llwCleanup = () => {
      destroyed = true;
      clearInterval(pollTimer);
    };
  }

  LL.registerWidget('people', {
    name: { en: 'People', da: 'Hvem er hjemme', de: 'Wer ist da', sv: 'Vem är hemma', no: 'Hvem er hjemme' },
    defaultSize: { w: 2, h: 3 },
    minSize: { w: 2, h: 2 },
    defaultConfig: () => ({ hiddenIds: [] }),
    mount,
  });
})();
