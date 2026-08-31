# Changelog

## 0.2.0

- Ny widget: **Kameraer (Frigate)** — mini-grid med kamera-thumbnails fra HA `camera.*`-entiteter (auto-opdaterer hvert 8. sek.), klik på et kamera for fuldskærms live-stream i en pop-up.
- Rettelse: widget-indstillingernes tandhjul og "luk"-knap kunne i redigeringstilstand overlappe med GridStacks fjern-widget-knap (×) og resize-håndtag, så de nogle gange ikke kunne klikkes. Layoutet er justeret så knapperne ikke længere kolliderer.

## 0.1.0

- Første udgave af LoudLlama Dashboard.
- Dashboard-skelet: frit flytbart/størrelsestilpasseligt grid (GridStack), redigeringstilstand, tilføj/fjern widgets, brugerdefineret baggrundsbillede.
- Første widget: **Vejr** — henter data fra en valgt Home Assistant `weather.*`-entitet, tilpasser sprog automatisk efter Home Assistants sprogindstilling, og viser en animeret baggrund der matcher det aktuelle vejr.
