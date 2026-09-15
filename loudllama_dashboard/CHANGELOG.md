# Changelog

## 0.9.2

- New: **update notifications from Home Assistant**. The add-on is now structured as a proper Home Assistant add-on *repository* (a `repository.yaml` at the repo root, with the add-on itself in its own `loudllama_dashboard/` folder) instead of a single folder meant to be copied into `addons/local/`. Installed by adding this repository's URL in Home Assistant (**Settings → Add-ons → Add-on Store → ⋮ → Repositories**), Home Assistant's own Supervisor takes it from there: it checks this repository for new versions on its own, shows an **Update available** notification with the changelog, and updates in one click — or fully automatically if you turn on the add-on's **Auto update** toggle. No custom update-checking code needed; this is the same mechanism every other Home Assistant add-on uses. See `loudllama_dashboard/README.md` for installation and `loudllama_dashboard/DOCS.md` for details (a "Updates" section) and the release checklist for pushing a new version.
- The old "copy the folder into `addons/local/`" install method still works for local testing, but never gets update notifications — Home Assistant has no repository to check a local add-on against.

## 0.9.1

- New: **nested widgets inside Room**. A Room can now contain its own small widgets instead of a flat list of controls — add a light, thermostat, or speaker to a room and it shows up as its own Light/Thermostat/Speaker tile inside that room's pop-up, on a second, independent drag-and-resize grid. Room becomes more of a "group widget": rearrange and resize the tiles inside it (an "Arrange" button in the pop-up header toggles that mode) independently of the main dashboard's layout.
- New standalone widgets: **Light** (on/off + brightness), **Thermostat** (current temperature, target with +/- stepper), **Speaker** (play/pause, volume, track info). Each also works on its own, directly on the main dashboard, not only inside a Room.
- Which sub-widget a room shows is derived automatically from the entities you already picked for that room — add a light to a room's entity list and a Light tile appears inside it; remove it and the tile goes away. There's no separate "add sub-widget" step to learn.
- Existing rooms (saved before this version) are upgraded automatically the first time you open them — their lights/thermostats/speakers become sub-widgets immediately, nothing is lost, and nothing needs to be redone by hand.
- A room that uses a sub-widget type installs it (in the sense of the widget store from 0.4.0) automatically, so a room full of lights doesn't quietly break for someone who never happened to open the store themselves.
- Fix: saving the dashboard's layout (and, the same way, saving a room's sub-widget arrangement) could silently write an **empty** layout to disk under some timings — most reliably right after the page loaded, or right after a sub-widget resize. The 0.3.0 fix for a related crash (see below) filtered saved widgets by a `.el` field that GridStack always strips from what `grid.save()` returns, which — instead of only skip­ping the occasional stale entry it was meant to handle — silently filtered out every entry, every time. Saving now reads each widget's live element directly instead of relying on `.save()` for that, so this can't happen again.
- Fix: the nested grid inside a Room's pop-up rendered completely blank (though the widgets *were* there in the page, invisibly, at zero width) because GridStack needs an extra stylesheet (`gridstack-extra.css`) for a grid that isn't the default 12 columns, which wasn't loaded. It's now included alongside GridStack's own CSS.

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
