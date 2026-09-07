# LoudLlama Dashboard

A Home Assistant add-on for building your own freely customizable, iPad-style dashboard: move and resize widgets, change the background image, and pick exactly which widgets you want from the built-in widget store.

This release includes the dashboard core plus three widgets, all available through the widget store:

- **Weather** – automatically follows Home Assistant's language and shows a background/animation that matches the current weather.
- **Cameras (Frigate)** – a mini-grid of camera thumbnails (auto-refreshing), click a camera to open it fullscreen with a live stream.
- **Room** – one room per widget. Pick entities and they're auto-grouped (lights, switches, climate, blinds, sensors, security, media, etc). Click for a rounded pop-up with real control — turn lights on/off/dim, blinds up/down, temperature, lock/unlock, and more.

## Widget store

Not every dashboard needs every widget. Open **Widgets** in the toolbar (edit mode) to see every widget bundled with the add-on, with a name, description, and a switch to add or remove it. Only installed widgets are loaded and show up under "+ Add widget" — removing one from the store doesn't delete anything you've already placed on your dashboard, it just stops offering it until you add it back. Future add-on updates that ship new widgets show up here automatically — nothing to install manually, and nothing forced on you either.

## Language

The dashboard automatically follows Home Assistant's configured language (**Settings → System → General → Language**). Currently supported: English, Danish, German, Swedish, Norwegian — other languages fall back to English. This applies to the whole UI, including the widget store.

## Installation (local add-on)

1. Copy the `loudllama_dashboard` folder into your Home Assistant installation's `addons/local/` folder, so you end up with `addons/local/loudllama_dashboard/`.
   - Home Assistant OS/Supervised: use the Samba/SSH add-on, or `docker cp`, to place the folder there.
2. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ (menu) → Check for updates**, or reload the page — "LoudLlama Dashboard" appears under **Local add-ons**.
3. Click the add-on → **Install**. The first build can take a couple of minutes (the Docker image is built on your device).
4. Start the add-on. It opens automatically in the sidebar via Ingress (the icon in the left-hand menu).

## Development / local testing without Home Assistant

```bash
cd backend
npm install
npm start
```

Open `http://localhost:8099`. Without a real Home Assistant connection (i.e. no `SUPERVISOR_TOKEN`) the backend automatically runs in "mock mode" with a fictional `weather.demo` entity and a small set of mock room entities, so the whole dashboard (weather widget, room widget, language, background graphics, widget store) can be tested in isolation.

See `DOCS.md` for more details on the widget system, the widget store, and how to add more widgets.
