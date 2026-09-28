/*
 * LoudLlama Dashboard - device identity.
 *
 * Every widget's *size and position* is remembered per device (see
 * app.js's saveLayout/init and the backend's /api/layout) so a phone, a
 * wall-mounted tablet, and a desktop browser can each keep their own
 * preferred arrangement of the exact same widgets. That needs a stable id
 * for "this device" to hang those positions off of.
 *
 * A cookie would be the classic way to tag a browser, but it's the wrong
 * tool here: cookies are sent back to the server on *every* request
 * (pure overhead for something only two endpoints care about), they cap
 * out at ~4KB shared across a whole origin, and - the part that actually
 * rules them out - Home Assistant's Ingress proxies this add-on through a
 * different URL prefix per session, so a cookie set under one prefix isn't
 * guaranteed to come back reliably under another. localStorage has none of
 * that: it's plain per-origin storage the page reads and writes itself, so
 * it works the same regardless of whatever prefix Ingress happens to be
 * using this time.
 *
 * This id identifies a *browser on a device*, not a person - clearing site
 * data or using a different browser on the same device starts a fresh one
 * (with its own copy of today's shared default layout, see server.js).
 * That is the right behavior for "this screen remembers how I like it
 * arranged", which is what was actually asked for.
 */
(function () {
  const LL = (window.LoudLlama = window.LoudLlama || {});
  const STORAGE_KEY = 'llw-device-id';

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    // Fallback for older browsers/embedded webviews without
    // crypto.randomUUID - still plenty unique for "tell devices apart".
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function loadOrCreateDeviceId() {
    try {
      const existing = window.localStorage.getItem(STORAGE_KEY);
      if (existing) return existing;
      const fresh = randomId();
      window.localStorage.setItem(STORAGE_KEY, fresh);
      return fresh;
    } catch (err) {
      // Private browsing / blocked storage: fall back to an id that only
      // lives for this page load. The dashboard still works fully, it just
      // won't remember this device's layout across a reload - better than
      // failing to load at all.
      console.warn('[loudllama] localStorage unavailable, this device will not remember its layout', err);
      return randomId();
    }
  }

  LL.deviceId = loadOrCreateDeviceId();
})();
