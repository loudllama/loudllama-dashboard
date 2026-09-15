# LoudLlama Dashboard

A Home Assistant add-on for building your own freely customizable, iPad-style dashboard: move and resize widgets, change the background image, and pick exactly which widgets you want from the built-in widget store.

This release includes the dashboard core plus six widgets, all available through the widget store:

- **Weather** – automatically follows Home Assistant's language and shows a background/animation that matches the current weather.
- **Cameras (Frigate)** – a mini-grid of camera thumbnails (auto-refreshing), click a camera to open it fullscreen with a live stream.
- **Room** – one room per widget, and more of a "group widget": pick entities and they're auto-grouped (lights, switches, climate, blinds, sensors, security, media, etc). A light, thermostat, or speaker in the room shows up as its own small Light/Thermostat/Speaker tile inside the room's pop-up — on their own little drag-and-resize grid, arranged independently from the main dashboard. Everything else (switches, blinds, locks, sensors, scenes) is still shown as a plain control row below them.
- **Light**, **Thermostat**, **Speaker** – on/off + dimming, target temperature, and play/pause + volume for a single entity. These work standalone on the main dashboard too, not just nested inside a Room.

## Widget store

Not every dashboard needs every widget. Open **Widgets** in the toolbar (edit mode) to see every widget bundled with the add-on, with a name, description, and a switch to add or remove it. Only installed widgets are loaded and show up under "+ Add widget" — removing one from the store doesn't delete anything you've already placed on your dashboard, it just stops offering it until you add it back. Future add-on updates that ship new widgets show up here automatically — nothing to install manually, and nothing forced on you either.

## Language

The dashboard automatically follows Home Assistant's configured language (**Settings → System → General → Language**). Currently supported: English, Danish, German, Swedish, Norwegian — other languages fall back to English. This applies to the whole UI, including the widget store.

## Installation

### Recommended: add the repository (gives you update notifications)

Installing it this way, instead of copying files by hand, is what lets Home Assistant tell you when a new version is out — and, if you want, install it automatically:

1. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ (menu, top right) → Repositories**.
2. Paste in this repository's URL (`https://github.com/loudllama/loudllama-dashboard`) → **Add**.
3. "LoudLlama Dashboard" now shows up in the store. Click it → **Install**. The first build can take a couple of minutes (the Docker image is built on your device).
4. Start the add-on. It opens automatically in the sidebar via Ingress (the icon in the left-hand menu).

From here, whenever a new version is pushed to this repository, Home Assistant's Supervisor picks it up on its own periodic check (or right away if you go to the add-on and click **⋮ → Check for updates**) and shows an **Update available** notification with a changelog and a one-click **Update** button — the normal way any Home Assistant add-on updates. If you'd rather not review each update yourself, the add-on's page has an **Auto update** toggle that installs new versions the moment Supervisor sees them, with no notification needed.

### Alternative: local add-on (no update notifications)

Still useful for testing a change before it's pushed to GitHub, but Home Assistant has no way to know a "local" add-on has a newer version anywhere, so you won't get update notifications this way — you'd need to re-copy the files by hand every time.

1. Copy the `loudllama_dashboard` folder (this folder — the one this README is in) into your Home Assistant installation's `addons/local/` folder, so you end up with `addons/local/loudllama_dashboard/`.
   - Home Assistant OS/Supervised: use the Samba/SSH add-on, or `docker cp`, to place the folder there.
2. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ (menu) → Check for updates**, or reload the page — "LoudLlama Dashboard" appears under **Local add-ons**.
3. Click the add-on → **Install**, then start it.

## Development / local testing without Home Assistant

```bash
cd backend
npm install
npm start
```

Open `http://localhost:8099`. Without a real Home Assistant connection (i.e. no `SUPERVISOR_TOKEN`) the backend automatically runs in "mock mode" with a fictional `weather.demo` entity and a small set of mock room entities, so the whole dashboard (weather widget, room widget, language, background graphics, widget store) can be tested in isolation.

See `DOCS.md` for more details on the widget system, the widget store, and how to add more widgets.
