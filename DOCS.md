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

## Tilføj flere widgets

Widgets registreres i `frontend/widgets/<navn>/` og tilmeldes via `LoudLlama.registerWidget(id, { name, defaultSize, defaultConfig, mount })` i widgetens JS-fil. Se `frontend/widgets/weather/weather.js` som eksempel.

## Fejlfinding

- Tjek add-on'ets log i Supervisor, hvis dashboardet ikke loader.
- `GET /api/health` (via ingress-url'en) viser om backend'en kører, og om den kører i "mock mode" (dvs. uden forbindelse til Home Assistant — bør kun ske uden for et rigtigt HA-miljø).
