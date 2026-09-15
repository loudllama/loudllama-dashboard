# LoudLlama Dashboard

## About the add-on

LoudLlama Dashboard is a Home Assistant add-on that gives you a freely customizable dashboard in the style of an iPad home screen: widgets can be moved around, resized, and you can change the background image. The add-on has its own widget plugin system and a built-in widget store, so more widgets can be added over time without cluttering every dashboard by default.

The dashboard opens directly in Home Assistant's sidebar via Ingress — no separate login or port forwarding needed.

## Configuration

The add-on has no required setup options. Everything is saved automatically under `/data`, which the Supervisor persists across updates:

- `/data/layout.json` — the dashboard's widget layout
- `/data/settings.json` — settings such as the background image
- `/data/widgets.json` — which widgets are installed (see "Widget store" below)
- `/data/www/` — uploaded background images

## Updates

Update notifications (and, optionally, fully automatic updates) come from Home Assistant's own Supervisor — not from anything inside the add-on itself — and only work if the add-on was installed **as a repository** rather than copied into `addons/local/` (see "Installation" in `README.md`). With that in place:

- Supervisor periodically checks this repository for a newer `version` in `config.yaml`, and shows an **Update available** badge on the add-on plus a notification, with the changelog from `CHANGELOG.md` shown before you confirm.
- Updating is one click (**Update** on the add-on's page) — Supervisor rebuilds the Docker image from the new code and restarts the add-on. `/data` (your layout, settings, installed widgets) is untouched by an update.
- If you'd rather not click anything, the add-on's page has an **Auto update** toggle: turn it on and Supervisor installs new versions itself as soon as it sees them, with no prompt.
- A "local" add-on (copied into `addons/local/`) doesn't get any of this — Home Assistant has no repository to check against, so there's never an update notification and files have to be replaced by hand.

## Widget store

Every widget that ships with the add-on is listed in the widget store (the **Widgets** button in the toolbar, visible in edit mode), each with an icon, a name, a short description, and an on/off switch:

- Installing a widget loads its code immediately and makes it available under "+ Add widget" — no restart needed.
- Uninstalling a widget removes it from "+ Add widget", but never deletes widgets of that type you've already placed on your dashboard. They keep working; if you ever uninstall a widget that's still on your dashboard, that spot shows a small "not installed" placeholder with a shortcut back into the store instead of breaking.
- On a fresh install (or an upgrade from a version before the widget store existed), every bundled widget starts installed, so nothing changes for existing dashboards. From there you can trim it down to just what you use.
- When a future update of the add-on ships a new widget, it simply appears in the store — you don't need to install anything by hand, and you're never forced to keep widgets you don't want.

## Weather widget

The first widget is a weather widget:

- Pick a `weather.*` entity via the gear icon in edit mode.
- Temperature, condition, humidity, wind, and a short forecast are shown and refresh automatically every minute.
- **Language:** the widget (and the rest of the dashboard) automatically follows Home Assistant's configured language (Settings → System → General → Language). Currently supported: English, Danish, German, Swedish, Norwegian — other languages fall back to English.
- **Background graphics:** the widget's background and animation (sun, clouds, rain, snow, thunder, fog, wind, etc.) automatically change with the weather entity's current condition. No external images are used — everything is drawn with CSS/SVG, so it works without internet access.

## Camera widget (Frigate)

The second widget shows a mini-grid of cameras:

- Cameras are read as regular Home Assistant `camera.*` entities — that's how the Frigate integration exposes each camera in HA, so the widget works no matter how/where Frigate itself runs. Pick which cameras to show via the gear icon in edit mode.
- Thumbnails refresh automatically every 8 seconds.
- Click a camera to open it fullscreen as a pop-up with the camera's live stream (MJPEG via Home Assistant's camera proxy). Close with the ×, the Escape key, or by clicking outside the image.
- **Recommended size:** by default the widget is 6 columns wide × 5 rows tall. With a 12-column grid and rows about 98px tall, that's roughly 940×480px on a 1920px-wide screen — a good balance for 4-8 cameras in a mini-grid. For a single camera in full quality instead, 4 wide × 3 tall is closer to a 16:9 ratio.

## Room widget

The third widget represents one room. The first time you add it, it asks:

1. **What should the room be called?** (e.g. "Living room", "Kitchen", "Bedroom")
2. **Which entities belong to the room?** — a searchable list, already grouped by type so it's easy to find what you're looking for.

When you save, the entities are automatically sorted into these groups (the same idea as e.g. Pivo-style room dashboards — lights on their own, sensors on their own, speakers on their own, etc.):

| Group | What it contains |
| --- | --- |
| 💡 Lights | `light.*` |
| 🔌 Switches | `switch.*` |
| 🌡️ Climate | `climate.*` (thermostats) |
| 🪟 Blinds & covers | `cover.*` |
| 🌀 Ventilation | `fan.*` |
| 🔊 Speakers & media | `media_player.*` |
| 🤖 Robot vacuum | `vacuum.*` |
| 🔒 Security | `lock.*`, alarm panels, and `binary_sensor.*` with device_class door/window/motion/smoke/gas/water etc. — kept separate from regular sensors since these are "is something wrong" indicators |
| 📊 Sensors | remaining `sensor.*` and `binary_sensor.*` (temperature, humidity, lux, etc.) |
| ⚙️ Other | scenes, scripts, `input_boolean`, and everything else |

**What else is worth indexing?** Beyond lights/sensors/speakers, the main ones are climate (thermostats need control, not just a readout), blinds/covers, door locks + door/window/motion sensors (grouped as "Security" so they don't get lost among temperature readings), fans, and robot vacuums. Scenes/scripts are included as an "Other" group with a run button, so a room can also hold a shortcut like "Movie night".

The compact view on the dashboard itself shows the room name, temperature if available, and small count badges per group. The background gets a unique, stable color based on the room's name and lights up when at least one light in the room is on.

Clicking the room (outside edit mode) opens a rounded pop-up with full control. Lights, thermostats (climate), and speakers (media players) each get their own small widget tile — the same Light/Thermostat/Speaker widgets described below — on a second, independent grid inside the pop-up, so they can be dragged and resized relative to each other (an **Arrange** button in the pop-up's header toggles that mode, the same way edit mode does on the main dashboard). Everything else is shown as a plain control row underneath:

- **Switches/fans:** on/off switch.
- **Blinds:** up/stop/down buttons.
- **Robot vacuum:** start/stop.
- **Door locks:** lock/unlock.
- **Sensors and security:** shown read-only (value or status badge respectively).

Which sub-widgets appear is derived automatically from the room's entity list — there's no separate step to add or remove them. Add a light to the room (via the gear icon's entity picker) and a Light tile appears in the pop-up; remove it and the tile goes away, same as any other entity in the room. A room saved before this feature existed gets its sub-widgets derived the first time it's opened, with nothing lost and nothing to redo by hand. If a sub-widget's type isn't installed yet (see "Widget store" above), the room installs it automatically the moment it needs it — a room full of lights won't quietly show broken tiles just because nobody happened to open the store.

The gear icon (only visible in edit mode) reopens the name + entity picker, so you can always adjust the room later.

## Light, Thermostat, and Speaker widgets

Three small single-entity widgets, usable on their own directly on the main dashboard, or nested inside a Room (see above):

- **Light:** on/off toggle, plus a brightness slider when the light supports dimming.
- **Thermostat:** current temperature and a target temperature with +/− stepper (0.5° steps).
- **Speaker:** play/pause, a volume slider, and the current track's title/artist when available.

Each has its own entity picker (gear icon) scoped to the matching domain (`light.*`, `climate.*`, `media_player.*`).

## Adding more widgets

A widget lives in `frontend/widgets/<name>/` and registers itself via `LoudLlama.registerWidget(id, { name, defaultSize, minSize, defaultConfig, mount })` in the widget's own JS file — see `frontend/widgets/weather/weather.js` as an example.

To make a new widget show up in the widget store, two small additions are needed alongside it:

1. An entry in the backend's widget manifest (`backend/server.js`, the `WIDGETS` array) with the widget's `id`, `version`, `icon`, `defaultSize`/`minSize`, and a `name`/`description` per language — this is what the store displays, including for widgets nobody has installed yet.
2. An entry in `frontend/js/widget-catalog.js` mapping that same `id` to its `js`/`css` file paths — this is what the store (and the dashboard on boot) uses to load the widget's code once it's installed.

Everything else — listing it in the store, lazy-loading it on install, restricting "+ Add widget" to installed widgets — is automatic from there.

**Nesting inside another widget:** any widget built this way can be mounted either at the top level or inside another "container" widget, because `mount(el, { config, saveConfig })` only ever needs a plain element and a config/saveConfig pair — it has no idea whether `el` sits on the main dashboard or inside another widget's pop-up. Room is the only container widget so far (see above): it runs its own small GridStack grid inside its pop-up and calls each sub-widget's `mount()` against a tile on that grid, exactly the way `app.js` does for the main dashboard. A new container widget can reuse the same pattern. Two things are easy to get wrong when doing this, both because GridStack's `grid.save()` always strips the `.el` reference from whatever it returns (by design — it's meant to produce plain, serializable data): don't rely on it (or on matching by id afterwards) to find out what actually moved or resized — read each item's own `el.gridstackNode` instead, which GridStack keeps live and current; and a grid with a column count other than 12 (the default) needs `gridstack-extra.css` loaded on the page, or every item in it renders at zero width.

## Releasing a new version

For an update notification to show up in anyone's Home Assistant (see "Updates" above), a release needs three things, all committed and pushed to this repository's `main` branch:

1. Bump `version` in `loudllama_dashboard/config.yaml` — this is the number Supervisor compares against.
2. Bump `version` in `loudllama_dashboard/backend/package.json` (and run `npm install` there so `package-lock.json` picks it up) to match.
3. Add a new entry at the top of `loudllama_dashboard/CHANGELOG.md` — this is what people see in the "what's new" view before they click Update.

Supervisor picks up the new version on its own next periodic check, or immediately if someone clicks **⋮ → Check for updates** on the add-on store page.

## Troubleshooting

- Check the add-on's log in the Supervisor if the dashboard doesn't load.
- `GET /api/health` (via the ingress URL) shows whether the backend is running, and whether it's running in "mock mode" (i.e. without a connection to Home Assistant — this should only happen outside a real HA environment).
