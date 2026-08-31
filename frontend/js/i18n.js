/*
 * LoudLlama Dashboard - shared translations.
 *
 * Every widget (and the app chrome itself) reads its strings from here so the
 * whole dashboard automatically follows Home Assistant's configured
 * language. Add a language by adding a top-level key; anything missing in a
 * language falls back to English, then to the raw key so nothing ever
 * renders blank.
 */
(function (global) {
  const TRANSLATIONS = {
    en: {
      app: {
        loading: 'Loading…',
        edit: 'Edit',
        done: 'Done',
        addWidget: 'Add widget',
        background: 'Background',
        changeBackground: 'Change background image',
        removeWidget: 'Remove widget',
        connectionError: 'Could not reach Home Assistant',
      },
      weather: {
        title: 'Weather',
        chooseEntity: 'Choose a weather entity',
        noEntity: 'No weather entity selected',
        noEntities: 'No weather entities found in Home Assistant',
        humidity: 'Humidity',
        wind: 'Wind',
        pressure: 'Pressure',
        updated: 'Updated',
        forecast: 'Forecast',
        conditions: {
          'clear-night': 'Clear night',
          cloudy: 'Cloudy',
          exceptional: 'Exceptional',
          fog: 'Fog',
          hail: 'Hail',
          lightning: 'Thunderstorm',
          'lightning-rainy': 'Thunderstorm with rain',
          partlycloudy: 'Partly cloudy',
          pouring: 'Heavy rain',
          rainy: 'Rainy',
          snowy: 'Snowy',
          'snowy-rainy': 'Sleet',
          sunny: 'Sunny',
          windy: 'Windy',
          'windy-variant': 'Windy',
          unknown: 'Unknown',
        },
      },
      frigate: {
        title: 'Cameras',
        chooseCameras: 'Choose cameras to show',
        noCameras: 'No cameras selected',
        noCamerasFound: 'No camera entities found in Home Assistant',
        live: 'Live',
        close: 'Close',
        snapshotError: 'Could not load image',
      },
    },
    da: {
      app: {
        loading: 'Indlæser…',
        edit: 'Rediger',
        done: 'Færdig',
        addWidget: 'Tilføj widget',
        background: 'Baggrund',
        changeBackground: 'Skift baggrundsbillede',
        removeWidget: 'Fjern widget',
        connectionError: 'Kunne ikke forbinde til Home Assistant',
      },
      weather: {
        title: 'Vejr',
        chooseEntity: 'Vælg en vejr-entitet',
        noEntity: 'Ingen vejr-entitet valgt',
        noEntities: 'Fandt ingen vejr-entiteter i Home Assistant',
        humidity: 'Luftfugtighed',
        wind: 'Vind',
        pressure: 'Tryk',
        updated: 'Opdateret',
        forecast: 'Prognose',
        conditions: {
          'clear-night': 'Klar nat',
          cloudy: 'Skyet',
          exceptional: 'Ekstremt vejr',
          fog: 'Tåge',
          hail: 'Hagl',
          lightning: 'Tordenvejr',
          'lightning-rainy': 'Tordenvejr med regn',
          partlycloudy: 'Delvist skyet',
          pouring: 'Skybrud',
          rainy: 'Regnvejr',
          snowy: 'Sne',
          'snowy-rainy': 'Slud',
          sunny: 'Sol',
          windy: 'Blæsende',
          'windy-variant': 'Blæsende',
          unknown: 'Ukendt',
        },
      },
      frigate: {
        title: 'Kameraer',
        chooseCameras: 'Vælg kameraer der skal vises',
        noCameras: 'Ingen kameraer valgt',
        noCamerasFound: 'Fandt ingen kamera-entiteter i Home Assistant',
        live: 'Direkte',
        close: 'Luk',
        snapshotError: 'Kunne ikke hente billede',
      },
    },
    de: {
      app: {
        loading: 'Lädt…',
        edit: 'Bearbeiten',
        done: 'Fertig',
        addWidget: 'Widget hinzufügen',
        background: 'Hintergrund',
        changeBackground: 'Hintergrundbild ändern',
        removeWidget: 'Widget entfernen',
        connectionError: 'Home Assistant nicht erreichbar',
      },
      weather: {
        title: 'Wetter',
        chooseEntity: 'Wetter-Entität wählen',
        noEntity: 'Keine Wetter-Entität ausgewählt',
        noEntities: 'Keine Wetter-Entitäten gefunden',
        humidity: 'Luftfeuchtigkeit',
        wind: 'Wind',
        pressure: 'Druck',
        updated: 'Aktualisiert',
        forecast: 'Vorhersage',
        conditions: {
          'clear-night': 'Klare Nacht',
          cloudy: 'Bewölkt',
          exceptional: 'Extremwetter',
          fog: 'Nebel',
          hail: 'Hagel',
          lightning: 'Gewitter',
          'lightning-rainy': 'Gewitter mit Regen',
          partlycloudy: 'Teilweise bewölkt',
          pouring: 'Starkregen',
          rainy: 'Regnerisch',
          snowy: 'Schnee',
          'snowy-rainy': 'Schneeregen',
          sunny: 'Sonnig',
          windy: 'Windig',
          'windy-variant': 'Windig',
          unknown: 'Unbekannt',
        },
      },
      frigate: {
        title: 'Kameras',
        chooseCameras: 'Kameras auswählen',
        noCameras: 'Keine Kameras ausgewählt',
        noCamerasFound: 'Keine Kamera-Entitäten gefunden',
        live: 'Live',
        close: 'Schließen',
        snapshotError: 'Bild konnte nicht geladen werden',
      },
    },
    sv: {
      app: {
        loading: 'Läser in…',
        edit: 'Redigera',
        done: 'Klar',
        addWidget: 'Lägg till widget',
        background: 'Bakgrund',
        changeBackground: 'Byt bakgrundsbild',
        removeWidget: 'Ta bort widget',
        connectionError: 'Kunde inte nå Home Assistant',
      },
      weather: {
        title: 'Väder',
        chooseEntity: 'Välj en väder-entitet',
        noEntity: 'Ingen väder-entitet vald',
        noEntities: 'Hittade inga väder-entiteter',
        humidity: 'Luftfuktighet',
        wind: 'Vind',
        pressure: 'Tryck',
        updated: 'Uppdaterad',
        forecast: 'Prognos',
        conditions: {
          'clear-night': 'Klar natt',
          cloudy: 'Molnigt',
          exceptional: 'Extremväder',
          fog: 'Dimma',
          hail: 'Hagel',
          lightning: 'Åska',
          'lightning-rainy': 'Åska med regn',
          partlycloudy: 'Delvis molnigt',
          pouring: 'Kraftigt regn',
          rainy: 'Regnigt',
          snowy: 'Snö',
          'snowy-rainy': 'Snöblandat regn',
          sunny: 'Soligt',
          windy: 'Blåsigt',
          'windy-variant': 'Blåsigt',
          unknown: 'Okänt',
        },
      },
      frigate: {
        title: 'Kameror',
        chooseCameras: 'Välj kameror att visa',
        noCameras: 'Inga kameror valda',
        noCamerasFound: 'Hittade inga kamera-entiteter',
        live: 'Live',
        close: 'Stäng',
        snapshotError: 'Kunde inte läsa in bild',
      },
    },
    no: {
      app: {
        loading: 'Laster…',
        edit: 'Rediger',
        done: 'Ferdig',
        addWidget: 'Legg til widget',
        background: 'Bakgrunn',
        changeBackground: 'Bytt bakgrunnsbilde',
        removeWidget: 'Fjern widget',
        connectionError: 'Fikk ikke kontakt med Home Assistant',
      },
      weather: {
        title: 'Vær',
        chooseEntity: 'Velg en vær-enhet',
        noEntity: 'Ingen vær-enhet valgt',
        noEntities: 'Fant ingen vær-enheter',
        humidity: 'Luftfuktighet',
        wind: 'Vind',
        pressure: 'Trykk',
        updated: 'Oppdatert',
        forecast: 'Værmelding',
        conditions: {
          'clear-night': 'Klar natt',
          cloudy: 'Skyet',
          exceptional: 'Ekstremvær',
          fog: 'Tåke',
          hail: 'Hagl',
          lightning: 'Tordenvær',
          'lightning-rainy': 'Tordenvær med regn',
          partlycloudy: 'Delvis skyet',
          pouring: 'Styrtregn',
          rainy: 'Regn',
          snowy: 'Snø',
          'snowy-rainy': 'Sludd',
          sunny: 'Sol',
          windy: 'Vind',
          'windy-variant': 'Vind',
          unknown: 'Ukjent',
        },
      },
      frigate: {
        title: 'Kameraer',
        chooseCameras: 'Velg kameraer som skal vises',
        noCameras: 'Ingen kameraer valgt',
        noCamerasFound: 'Fant ingen kamera-enheter',
        live: 'Direkte',
        close: 'Lukk',
        snapshotError: 'Kunne ikke laste bilde',
      },
    },
  };

  const SUPPORTED = Object.keys(TRANSLATIONS);
  let currentLang = 'en';

  function resolveSupportedLang(rawLang) {
    if (!rawLang) return 'en';
    const short = String(rawLang).toLowerCase().split('-')[0];
    return SUPPORTED.includes(short) ? short : 'en';
  }

  function setLang(rawLang) {
    currentLang = resolveSupportedLang(rawLang);
    document.documentElement.setAttribute('lang', currentLang);
    return currentLang;
  }

  function t(ns, key) {
    const path = key.split('.');
    const walk = (root) => path.reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), root);
    const inCurrent = TRANSLATIONS[currentLang] && walk(TRANSLATIONS[currentLang][ns]);
    if (inCurrent !== undefined) return inCurrent;
    const inEnglish = TRANSLATIONS.en[ns] && walk(TRANSLATIONS.en[ns]);
    if (inEnglish !== undefined) return inEnglish;
    return key;
  }

  global.LoudLlama = global.LoudLlama || {};
  global.LoudLlama.i18n = {
    setLang,
    t,
    get lang() {
      return currentLang;
    },
    get supported() {
      return SUPPORTED.slice();
    },
  };
})(window);
