/*
 * LoudLlama Dashboard - static widget asset catalog.
 *
 * Every widget bundled with the add-on gets one entry here mapping its id to
 * its JS/CSS file. This is the only place that needs a new line when a
 * future update adds a widget - the store, the "+ Add widget" menu and the
 * lazy-loader all read from this list plus the backend's /api/widgets
 * metadata, so nothing else has to change.
 *
 * Display metadata (name, description, icon, sizes) lives on the backend
 * (server.js WIDGETS) so it can be looked up before a widget's own script has
 * even been loaded - which is exactly the situation the widget store is in
 * for anything the user hasn't installed yet.
 */
(function () {
  const LL = (window.LoudLlama = window.LoudLlama || {});

  LL.widgetCatalog = [
    { id: 'weather', js: 'widgets/weather/weather.js', css: 'widgets/weather/weather.css' },
    { id: 'frigate', js: 'widgets/frigate/frigate.js', css: 'widgets/frigate/frigate.css' },
    { id: 'room', js: 'widgets/room/room.js', css: 'widgets/room/room.css' },
    { id: 'light', js: 'widgets/light/light.js', css: 'widgets/light/light.css' },
    { id: 'climate', js: 'widgets/climate/climate.js', css: 'widgets/climate/climate.css' },
    { id: 'media', js: 'widgets/media/media.js', css: 'widgets/media/media.css' },
  ];
})();
