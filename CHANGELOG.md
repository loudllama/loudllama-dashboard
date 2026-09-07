# Changelog

## 0.4.0

- New: **Widget store**. A "Widgets" button in the toolbar (edit mode) opens a store listing every widget bundled with the add-on, each with an icon, localized name/description, and an on/off switch. Installing a widget loads its code and makes it usable immediately (no reload); uninstalling removes it from "+ Add widget" without touching widgets of that type already placed on your dashboard. New widgets shipped in future updates appear in the store automatically.
- New backend endpoints `GET/POST /api/widgets/installed`, persisted to `/data/widgets.json`. On first run (or upgrading from a version before the store existed) every bundled widget starts installed, so nothing changes for existing dashboards until you choose to trim it down.
- Widget JS/CSS is no longer loaded unconditionally for every widget on every page load — only installed widgets are fetched, via a small on-demand loader (`frontend/js/widget-catalog.js` + `LL.loadWidgetAssets`).
- A dashboard widget whose type is no longer installed now shows a friendly "not installed" placeholder with a shortcut back into the store, instead of an unhelpful "unknown widget" error.
- Repository description, README, and DOCS are now in English; the dashboard's own UI keeps following Home Assistant's configured language as before (English, Danish, German, Swedish, Norwegian).

## 0.3.0

- New widget: **Room** — one room per widget. When added, it first asks for a name, then which entities belong to the room (a searchable, grouped list). Entities are auto-grouped on display: Lights, Switches, Climate, Blinds & covers, Ventilation, Speakers & media, Robot vacuum, Security (door locks + door/window/motion sensors), Sensors (temperature/humidity etc.), and Other (scenes/scripts).
- Compact view on the dashboard: room name, temperature if available, and small icon badges per group — with a background color unique to each room name that lights up when a light in the room is on.
- Clicking a room opens it in a rounded pop-up (not edge-to-edge like the camera widget) with real controls: light on/off + dim, switch on/off, blinds up/stop/down, thermostat temperature up/down, speaker play/pause + volume, lock/unlock, and a run button for scenes/scripts. Sensors and security status are shown read-only.
- New backend endpoint `POST /api/hass/service/:domain/:service`, proxying to Home Assistant's service-call API — this is what makes control in the Room widget possible.
- Fix: `saveLayout()` could occasionally throw a console error if a debounced layout save ran right after a widget was removed. Layout serialization now safely skips any widget no longer in the DOM.

## 0.2.0

- New widget: **Cameras (Frigate)** — a mini-grid of camera thumbnails from HA `camera.*` entities (auto-refreshes every 8s), click a camera for a fullscreen live-stream pop-up.
- Fix: the widget settings gear and "close" button could, in edit mode, overlap GridStack's remove-widget button (×) and resize handles, so they were sometimes unclickable. Layout adjusted so the buttons no longer collide.

## 0.1.0

- First release of LoudLlama Dashboard.
- Dashboard shell: a freely movable/resizable grid (GridStack), edit mode, add/remove widgets, custom background image.
- First widget: **Weather** — pulls data from a chosen Home Assistant `weather.*` entity, automatically follows Home Assistant's language setting, and shows an animated background matching the current weather.
