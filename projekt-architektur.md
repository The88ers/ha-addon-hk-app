# Projekt-Architektur (Mermaid-Quelle)

Dieselbe Grafik wie in [`../diagrams/projekt-architektur.html`](../diagrams/projekt-architektur.html) – hier als **Mermaid-Quelltext** für GitHub, Notion oder andere Renderer.

**Interaktiv (Zoomen, Verschieben):** die HTML-Datei im Browser öffnen (Ordner `diagrams/` im Projektordner).

---

```mermaid
flowchart TB
  subgraph clients [Nutzer und Clients]
    Mob[Smartphone_Touch]
    PC[Desktop_Browser]
  end

  subgraph haos [Home_Assistant_OS]
    Sup[Supervisor]
    subgraph addon [HA_App_Addon_HK_Web]
      Ing[Ingress]
      UI[HK_Web_UI]
      LS[LocalStorage_Konfig]
      Sch[Scheduler_Zeitplaene_TagNacht]
      Ad[Hass_Adapter]
    end
  end

  subgraph core [Home_Assistant_Core]
    St[hass_states]
    Sv[callService]
  end

  subgraph extapi [Externe Internet-APIs]
    Nom[OSM_Nominatim]
    Sun[sunrise_sunset_org]
  end

  subgraph esp [ESPHome_Geraete]
    HK1[HK1_Klappe]
    HKx[HK2_HK3_etc]
  end

  Mob --> Ing
  PC --> Ing
  Ing --> UI
  UI --> LS
  LS --> Sch
  Sch --> Ad
  UI --> Ad
  Ad -->|"REST_ws_SUPERVISOR_TOKEN"| St
  Ad --> Sv
  Sch --> Nom
  Sch --> Sun
  St --> UI
  Sv --> HK1
  Sv --> HKx
```

## Option B vs. Lovelace-Panel

| Variante | Quelle von `hass` / States |
|----------|---------------------------|
| Custom Panel in Lovelace | Home Assistant injiziert `hass` |
| **Option B (Add-on)** | **Adapter:** REST/WebSocket zum Core über **`http://supervisor/core/…`** mit **`SUPERVISOR_TOKEN`** (`homeassistant_api: true`); **Scheduler** im Add-on löst Zeitpläne aus und ruft dieselben Services auf |
