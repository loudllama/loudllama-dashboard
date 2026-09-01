# LoudLlama Dashboard

## Om add-on'et

LoudLlama Dashboard er et Home Assistant add-on, der giver dig et frit tilpasseligt dashboard i stil med hjemmeskærmen på en iPad: widgets kan flyttes rundt, størrelsesændres, og du kan skifte baggrundsbillede. Add-on'et har sit eget widget-plugin-system, så flere widgets nemt kan tilføjes senere.

Dashboardet åbnes direkte i Home Assistants sidebar via Ingress — ingen separat login eller portåbning nødvendig.

## Konfiguration

Add-on'et har ingen påkrævede opsætningsmuligheder. Alt gemmes automatisk i `/data`, som Supervisoren gemmer persistent på tværs af opdateringer:

- `/data/layout.json` — dashboardets widget-layout
- `/data/settings.json` — indstillinger som baggrundsbillede
- `/data/www/` — uploadede baggrundsbilleder

## Vejr-widgeten

Den første widget er en vejr-widget:

- Vælg en `weather.*`-entitet via tandhjulsikonet i redigeringstilstand.
- Temperatur, forhold, luftfugtighed, vind og en kort prognose vises, og opdateres automatisk hvert minut.
- **Sprog:** Widgeten (og resten af dashboardet) følger automatisk Home Assistants konfigurerede sprog (Indstillinger → System → Generelt → Sprog). Understøttede sprog lige nu: dansk, engelsk, tysk, svensk, norsk — andre sprog falder tilbage til engelsk.
- **Baggrundsgrafik:** Widgetens baggrund og animation (sol, skyer, regn, sne, torden, tåge, blæst osv.) skifter automatisk efter den aktuelle vejrtilstand fra HA-entiteten. Der bruges ingen eksterne billeder — alt er tegnet med CSS/SVG, så det virker uden internetadgang.

## Kamera-widgeten (Frigate)

Den anden widget viser et mini-grid af kameraer:

- Kameraerne hentes som almindelige Home Assistant `camera.*`-entiteter — det er sådan Frigate-integrationen eksponerer hvert kamera i HA, så widgeten fungerer uanset hvordan/hvor Frigate selv kører. Vælg hvilke kameraer der skal vises via tandhjulet i redigeringstilstand.
- Thumbnails opdateres automatisk hvert 8. sekund.
- Klik på et kamera for at åbne det i fuldskærm som en pop-up med kameraets live-stream (MJPEG via Home Assistants kamera-proxy). Luk med krydset, Escape-tasten, eller ved at klikke uden for billedet.
- **Anbefalet størrelse:** som udgangspunkt fylder widgeten 6 felter i bredden × 5 i højden (standard). Da grid'et har 12 kolonner i alt og hver række er ca. 98px høj, svarer det til omkring 940×480px på en 1920px-bred skærm — en god balance for 4-8 kameraer i mini-grid. Skal widgeten vise ét enkelt kamera i fuld kvalitet i stedet, er 4 bred × 3 høj tættere på et 16:9-forhold.

## Værelse-widgeten

Den tredje widget repræsenterer ét værelse. Første gang du tilføjer den, spørger den:

1. **Hvad skal værelset hedde?** (fx "Stue", "Køkken", "Soveværelse")
2. **Hvilke entiteter hører til værelset?** — en søgbar liste, allerede grupperet efter type, så det er nemt at finde det du leder efter.

Når du gemmer, sorteres entiteterne automatisk i disse grupper (samme princip som fx Pivo-agtige rum-dashboards — lys for sig, sensorer for sig, højtalere for sig osv.):

| Gruppe | Hvad den indeholder |
| --- | --- |
| 💡 Lys | `light.*` |
| 🔌 Stikkontakter | `switch.*` |
| 🌡️ Klima | `climate.*` (termostater) |
| 🪟 Gardiner & persienner | `cover.*` |
| 🌀 Ventilation | `fan.*` |
| 🔊 Højtalere & medier | `media_player.*` |
| 🤖 Robotstøvsuger | `vacuum.*` |
| 🔒 Sikkerhed | `lock.*`, alarmpaneler, og `binary_sensor.*` med device_class dør/vindue/bevægelse/røg/gas/vand m.fl. — holdt adskilt fra almindelige sensorer, da det er "er der noget galt"-indikatorer |
| 📊 Sensorer | øvrige `sensor.*` og `binary_sensor.*` (temperatur, luftfugtighed, lux, osv.) |
| ⚙️ Andet | scener, scripts, `input_boolean` og alt andet |

**Hvad ellers er relevant at indeksere?** Ud over lys/sensorer/højtalere er det især klima (termostater har brug for betjening, ikke bare en aflæsning), gardiner/persienner, dørlåse + dør/vindue/bevægelses-sensorer (samlet som "Sikkerhed" så de ikke drukner blandt temperatur-aflæsninger), ventilatorer og robotstøvsugere. Scener/scripts er taget med som en "Andet"-gruppe med en kør-knap, så et værelse også kan rumme en genvej som "Film-aften".

Den kompakte visning i selve dashboardet viser værelsesnavn, evt. temperatur, og små tælle-badges pr. gruppe. Baggrunden får en unik, stabil farve ud fra værelsets navn og lyser op når mindst ét lys i værelset er tændt.

Klik på værelset (uden for redigeringstilstand) åbner en afrundet pop-up med fuld styring:

- **Lys:** tænd/sluk-kontakt, og en dæmper hvis lyset understøtter det.
- **Stikkontakter/ventilatorer:** tænd/sluk-kontakt.
- **Gardiner:** op/stop/ned-knapper.
- **Klima:** +/− på måltemperatur.
- **Højtalere:** afspil/pause + lydstyrke.
- **Robotstøvsuger:** start/stop.
- **Dørlåse:** lås/lås op.
- **Sensorer og sikkerhed:** vises read-only (værdi hhv. status-badge).

Tandhjulet (kun synligt i redigeringstilstand) genåbner navn + entitetsvalg, så du altid kan justere værelset senere.

## Tilføj flere widgets

Widgets registreres i `frontend/widgets/<navn>/` og tilmeldes via `LoudLlama.registerWidget(id, { name, defaultSize, defaultConfig, mount })` i widgetens JS-fil. Se `frontend/widgets/weather/weather.js` som eksempel.

## Fejlfinding

- Tjek add-on'ets log i Supervisor, hvis dashboardet ikke loader.
- `GET /api/health` (via ingress-url'en) viser om backend'en kører, og om den kører i "mock mode" (dvs. uden forbindelse til Home Assistant — bør kun ske uden for et rigtigt HA-miljø).
