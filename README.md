# LoudLlama Dashboard

Et Home Assistant add-on til at bygge dit eget frit tilpasselige, iPad-agtige dashboard: flyt og størrelsesændr widgets frit, skift baggrundsbillede, og udvid med flere widgets over tid.

Denne udgave indeholder dashboard-skelettet plus to widgets:

- **Vejr** – tilpasser automatisk sprog til Home Assistant og viser en baggrund/animation der matcher det aktuelle vejr.
- **Kameraer (Frigate)** – mini-grid med kamera-thumbnails (opdateres automatisk), klik på et kamera for at åbne det i fuldskærm med live-stream.

## Installation (lokalt add-on)

1. Kopiér mappen `loudllama_dashboard` ind i din Home Assistant-installations `addons/local/` mappe, så du får `addons/local/loudllama_dashboard/`.
   - Har du Home Assistant OS/Supervised: brug Samba/SSH-tilføjelsen, eller `docker cp`, til at lægge mappen derind.
2. I Home Assistant: **Indstillinger → Add-ons → Add-on Store → ⋮ (menu) → Tjek for opdateringer**, eller genindlæs siden — "LoudLlama Dashboard" dukker op under **Lokale add-ons**.
3. Klik på add-on'et → **Installer**. Første build kan tage et par minutter (Docker-image bygges på din enhed).
4. Start add-on'et. Det åbner sig automatisk i sidebaren via Ingress (ikonet i venstre menu).

## Udvikling / lokal test uden Home Assistant

```bash
cd backend
npm install
npm start
```

Åbn `http://localhost:8099`. Uden en rigtig Home Assistant-forbindelse (dvs. ingen `SUPERVISOR_TOKEN`) kører backend'en automatisk i "mock mode" med en fiktiv `weather.demo`-entitet, så hele dashboardet (inkl. vejr-widgeten, sprog og baggrundsgrafik) kan testes isoleret.

Se `DOCS.md` for flere detaljer om widget-systemet og hvordan man tilføjer flere widgets.
