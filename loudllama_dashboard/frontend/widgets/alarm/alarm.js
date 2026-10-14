/*
 * LoudLlama Dashboard - Alarm widget.
 *
 * Controls one `alarm_control_panel.*` entity (Alarmo and most others work,
 * since they all expose themselves as a regular HA alarm_control_panel
 * entity either way). Two independent modes, picked once up front when the
 * widget is added (see app.js's showSetupChoicePicker, triggered by this
 * widget's own `setupChoice` below) and changeable later from its settings:
 *
 *   'simple' - one-tap arm/disarm buttons, no code ever asked for. Meant
 *              for a wall-mounted screen inside the home, where typing a
 *              code on every arm/disarm would be pure friction.
 *   'code'   - the same buttons, but each one opens a small on-screen
 *              keypad first and sends whatever code was entered along with
 *              the service call. Meant for a phone/tablet dashboard outside
 *              that physical trust boundary.
 *
 * The exact same alarm_control_panel entity can have one widget of each
 * mode - say, a code-free tile on the kitchen wall tablet and a code-
 * requiring one on your phone - since the mode lives on each *widget*, not
 * on the entity itself.
 */
(function () {
  const LL = window.LoudLlama;
  const { t } = LL.i18n;

  const POLL_MS = 8 * 1000; // arming/pending states are time-sensitive, worth polling a bit faster than most widgets
  const RECONCILE_DELAY_MS = 900;

  const ARMED_STATES = ['armed_home', 'armed_away', 'armed_night', 'armed_vacation'];
  const BUSY_STATES = ['pending', 'arming', 'disarming'];

  function mount(el, { config, saveConfig }) {
    let entityId = config.entity_id || '';
    let mode = config.mode === 'code' ? 'code' : 'simple';
    let entity = null;
    let pollTimer = null;
    let destroyed = false;
    // Set while the code keypad is open, to whichever service the keypad's
    // "OK" button should actually call once a code has been entered.
    let pendingService = null;
    let codeDigits = '';

    el.classList.add('llw-widget-alarm');
    el.innerHTML = `
      <div class="llw-alarm">
        <div class="llw-alarm__head">
          <span class="llw-alarm__name">${t('alarm', 'chooseEntity')}</span>
          <button class="llw-alarm__gear" type="button" title="${t('alarm', 'chooseEntity')}">${LL.icons.gear()}</button>
        </div>
        <div class="llw-alarm__body"></div>
        <div class="llw-alarm__keypad">
          <div class="llw-alarm__keypad-dots"></div>
          <div class="llw-alarm__keypad-grid"></div>
          <div class="llw-alarm__keypad-actions">
            <button type="button" class="llw-alarm__keypad-cancel">${t('alarm', 'cancel')}</button>
          </div>
          <div class="llw-alarm__keypad-error"></div>
        </div>
        <div class="llw-alarm__settings">
          <label>${t('alarm', 'chooseEntity')}</label>
          <select class="llw-alarm__select"><option value="">…</option></select>
          <label>${t('alarm', 'modeLabel')}</label>
          <div class="llw-alarm__mode-row">
            <button type="button" class="llw-alarm__mode-opt" data-mode="simple">${t('alarm', 'modeSimple')}</button>
            <button type="button" class="llw-alarm__mode-opt" data-mode="code">${t('alarm', 'modeCode')}</button>
          </div>
          <button type="button" class="llw-alarm__close">${t('app', 'done')}</button>
        </div>
      </div>
    `;

    const nameEl = el.querySelector('.llw-alarm__name');
    const bodyEl = el.querySelector('.llw-alarm__body');
    const gearBtn = el.querySelector('.llw-alarm__gear');
    const settingsEl = el.querySelector('.llw-alarm__settings');
    const selectEl = el.querySelector('.llw-alarm__select');
    const modeBtns = Array.from(el.querySelectorAll('.llw-alarm__mode-opt'));
    const closeBtn = el.querySelector('.llw-alarm__close');
    const keypadEl = el.querySelector('.llw-alarm__keypad');
    const keypadDotsEl = el.querySelector('.llw-alarm__keypad-dots');
    const keypadGridEl = el.querySelector('.llw-alarm__keypad-grid');
    const keypadCancelBtn = el.querySelector('.llw-alarm__keypad-cancel');
    const keypadOkBtn = el.querySelector('.llw-alarm__keypad-ok');
    const keypadErrorEl = el.querySelector('.llw-alarm__keypad-error');

    function syncModeUi() {
      modeBtns.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.mode === mode));
    }

    gearBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      settingsEl.classList.add('llw-open');
      syncModeUi();
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
      // for why: saveConfig() replaces the whole saved config, so this would
      // otherwise silently drop the mode the moment someone (re)picks the
      // entity.
      saveConfig({ ...config, entity_id: entityId, mode });
      fetchAndRender();
    });
    modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        saveConfig({ ...config, entity_id: entityId, mode });
        syncModeUi();
      });
    });

    async function loadEntityOptions() {
      selectEl.innerHTML = `<option value="">…</option>`;
      try {
        const entities = await LL.api.get('api/hass/states?domain=alarm_control_panel');
        if (destroyed) return;
        if (!entities.length) {
          selectEl.innerHTML = `<option value="">${t('alarm', 'noEntities')}</option>`;
          return;
        }
        const placeholder = `<option value="" ${entityId ? '' : 'selected'}>…</option>`;
        selectEl.innerHTML = placeholder + entities
          .map((e) => `<option value="${e.entity_id}" ${e.entity_id === entityId ? 'selected' : ''}>${(e.attributes && e.attributes.friendly_name) || e.entity_id}</option>`)
          .join('');
      } catch (err) {
        console.error('[loudllama][alarm] Failed to load entity list', err);
      }
    }

    function renderEmpty(message) {
      nameEl.textContent = t('alarm', 'chooseEntity');
      bodyEl.innerHTML = `<div class="llw-alarm__empty">${message}</div>`;
    }

    function stateClass(state) {
      if (state === 'triggered') return 'is-triggered';
      if (BUSY_STATES.includes(state)) return 'is-busy';
      if (ARMED_STATES.includes(state)) return 'is-armed';
      return 'is-disarmed';
    }

    function render() {
      if (!entity) return;
      const name = (entity.attributes && entity.attributes.friendly_name) || entity.entity_id;
      const state = entity.state;
      nameEl.textContent = name;
      const label = t('alarm', `states.${state}`);
      let actionsHtml = '';
      if (state === 'disarmed') {
        actionsHtml = `
          <button type="button" class="llw-alarm__action" data-service="alarm_arm_home">${t('alarm', 'armHome')}</button>
          <button type="button" class="llw-alarm__action" data-service="alarm_arm_away">${t('alarm', 'armAway')}</button>`;
      } else {
        actionsHtml = `<button type="button" class="llw-alarm__action llw-alarm__action--disarm" data-service="alarm_disarm">${t('alarm', 'disarm')}</button>`;
      }
      bodyEl.innerHTML = `
        <div class="llw-alarm__status ${stateClass(state)}">${label === `states.${state}` ? state : label}</div>
        <div class="llw-alarm__actions">${actionsHtml}</div>
      `;
      bodyEl.querySelectorAll('.llw-alarm__action').forEach((btn) => {
        btn.addEventListener('click', () => requestAction(btn.dataset.service));
      });
    }

    function requestAction(service) {
      if (mode === 'code') {
        openKeypad(service);
      } else {
        callService(service);
      }
    }

    function openKeypad(service) {
      pendingService = service;
      codeDigits = '';
      keypadErrorEl.textContent = '';
      renderDots();
      keypadEl.classList.add('llw-open');
    }

    function closeKeypad() {
      keypadEl.classList.remove('llw-open');
      pendingService = null;
      codeDigits = '';
    }

    function renderDots() {
      // A plain dot per digit typed so far - no fixed code length is
      // assumed (Home Assistant alarm codes aren't always exactly 4
      // digits), so this just grows as you type instead of showing empty
      // placeholder slots for a length that might be wrong.
      keypadDotsEl.innerHTML = codeDigits.length
        ? codeDigits.split('').map(() => '<span class="llw-alarm__keypad-dot"></span>').join('')
        : `<span class="llw-alarm__keypad-placeholder">${t('alarm', 'enterCode')}</span>`;
    }

    // Built once - the grid itself never changes, only codeDigits does.
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].forEach((label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'llw-alarm__keypad-key';
      btn.textContent = label;
      if (label === 'OK') btn.classList.add('llw-alarm__keypad-key--ok');
      btn.addEventListener('click', () => {
        if (label === '⌫') {
          codeDigits = codeDigits.slice(0, -1);
          renderDots();
        } else if (label === 'OK') {
          submitCode();
        } else {
          codeDigits += label;
          renderDots();
        }
      });
      keypadGridEl.appendChild(btn);
    });
    keypadCancelBtn.addEventListener('click', closeKeypad);

    async function submitCode() {
      if (!pendingService || !codeDigits) return;
      const service = pendingService;
      const code = codeDigits;
      try {
        await LL.api.post(`api/hass/service/alarm_control_panel/${service}`, { entity_id: entityId, code });
        closeKeypad();
        setTimeout(() => {
          if (!destroyed) fetchAndRender();
        }, RECONCILE_DELAY_MS);
      } catch (err) {
        // Home Assistant rejects a wrong code by failing the service call
        // itself (the backend's generic proxy turns that into a non-OK
        // response, which LL.api.post throws on) - there's no separate
        // "was the code right" field to check, this IS that check.
        keypadErrorEl.textContent = t('alarm', 'wrongCode');
        codeDigits = '';
        renderDots();
      }
    }

    async function callService(service) {
      try {
        await LL.api.post(`api/hass/service/alarm_control_panel/${service}`, { entity_id: entityId });
      } catch (err) {
        console.error('[loudllama][alarm] service failed', err);
      } finally {
        setTimeout(() => {
          if (!destroyed) fetchAndRender();
        }, RECONCILE_DELAY_MS);
      }
    }

    async function fetchAndRender() {
      if (!entityId) {
        renderEmpty(t('alarm', 'noEntity'));
        return;
      }
      try {
        entity = await LL.api.get(`api/hass/states/${encodeURIComponent(entityId)}`);
        if (destroyed) return;
        render();
      } catch (err) {
        console.error('[loudllama][alarm] Failed to fetch entity', err);
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

  LL.registerWidget('alarm', {
    name: { en: 'Alarm', da: 'Alarm', de: 'Alarm', sv: 'Larm', no: 'Alarm' },
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    defaultConfig: () => ({ entity_id: '', mode: 'simple' }),
    // Asked once, right when the widget is added (see app.js's
    // showSetupChoicePicker) - NOT a size choice (sizeVariants), a mode
    // choice, which is why this widget declares its own setupChoice instead.
    // Changeable later too, from this widget's own settings panel.
    setupChoice: {
      key: 'mode',
      options: [
        {
          value: 'simple',
          label: { en: 'Simple', da: 'Simpel', de: 'Einfach', sv: 'Enkel', no: 'Enkel' },
          desc: {
            en: 'One-tap arm/disarm, no code. For a screen inside the home.',
            da: 'Tilkobl/frakobl med ét tryk, ingen kode. Til en skærm inde i huset.',
            de: 'Scharf/unscharf mit einem Tipp, kein Code. Für einen Bildschirm im Haus.',
            sv: 'Till-/frånkoppling med ett tryck, ingen kod. För en skärm i hemmet.',
            no: 'Til-/frakobling med ett trykk, ingen kode. For en skjerm inne i huset.',
          },
        },
        {
          value: 'code',
          label: { en: 'PIN code', da: 'PIN-kode', de: 'PIN-Code', sv: 'PIN-kod', no: 'PIN-kode' },
          desc: {
            en: 'Asks for a code first. For a phone or other mobile device.',
            da: 'Spørger om en kode først. Til en mobil eller anden mobil enhed.',
            de: 'Fragt zuerst nach einem Code. Für ein Smartphone oder ein anderes mobiles Gerät.',
            sv: 'Frågar om en kod först. För en mobil eller annan mobil enhet.',
            no: 'Spør om en kode først. For en mobil eller annen mobil enhet.',
          },
        },
      ],
    },
    mount,
  });
})();
