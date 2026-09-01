# Changelog

## 0.3.0

- Ny widget: **Værelse** — ét værelse pr. widget. Ved oprettelse spørger den først om et navn, derefter hvilke entiteter der hører til værelset (søgbar, grupperet liste). Entiteterne auto-grupperes ved visning: Lys, Stikkontakter, Klima, Gardiner & persienner, Ventilation, Højtalere & medier, Robotstøvsuger, Sikkerhed (dørlåse + dør/vindue/bevægelses-sensorer), Sensorer (temperatur/luftfugtighed m.v.), og Andet (scener/scripts).
- Kompakt visning i selve dashboardet: værelsesnavn, evt. temperatur, og små ikon-badges pr. gruppe — med en farvet baggrund unik for hvert værelsesnavn, der lyser op når der er tændt lys i værelset.
- Klik på et værelse åbner det i en afrundet pop-up (ikke fuld-bredde som kamera-widgeten) med reelle betjeningsmuligheder: tænd/sluk + dæmp lys, tænd/sluk stikkontakter, op/stop/ned på gardiner, temperatur op/ned på termostater, afspil/pause + lydstyrke på højtalere, lås/lås op, og kør-knap til scener/scripts. Sensorer og sikkerhedsstatus vises read-only.
- Ny backend-endpoint `POST /api/hass/service/:domain/:service`, som proxyer til Home Assistants service-kald API — det er det der gør styringen i Værelse-widgeten mulig.
- Rettelse: `saveLayout()` kunne i sjældne tilfælde crashe (konsol-fejl) hvis et debounced layout-gem nåede at køre lige efter en widget blev fjernet. Layout-serialisering springer nu robust forbi enhver widget der ikke længere er i DOM'en.

## 0.2.0

- Ny widget: **Kameraer (Frigate)** — mini-grid med kamera-thumbnails fra HA `camera.*`-entiteter (auto-opdaterer hvert 8. sek.), klik på et kamera for fuldskærms live-stream i en pop-up.
- Rettelse: widget-indstillingernes tandhjul og "luk"-knap kunne i redigeringstilstand overlappe med GridStacks fjern-widget-knap (×) og resize-håndtag, så de nogle gange ikke kunne klikkes. Layoutet er justeret så knapperne ikke længere kolliderer.

## 0.1.0

- Første udgave af LoudLlama Dashboard.
- Dashboard-skelet: frit flytbart/størrelsestilpasseligt grid (GridStack), redigeringstilstand, tilføj/fjern widgets, brugerdefineret baggrundsbillede.
- Første widget: **Vejr** — henter data fra en valgt Home Assistant `weather.*`-entitet, tilpasser sprog automatisk efter Home Assistants sprogindstilling, og viser en animeret baggrund der matcher det aktuelle vejr.
