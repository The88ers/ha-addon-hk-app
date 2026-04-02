# Changelog

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).  
Die **Versionsnummer** entspricht `version` in `hk_addon/config.yaml` (Quelle für Home Assistant).

## [0.2.8] – 2026-04-02

### Added
- **Add-on-Scheduler:** führt Zeitpläne im Add-on selbst aus (basierend auf der UI-Konfiguration in `/data/hkweb-settings.json`).
- **Sicherheit:** „Schließzeiten“ mit iOS-Notification (Nabu Casa / Companion) bei Fehlschlag.
- **Sicherheit (Modi):** Checkbox „Sicherheitsschließzeiten anwenden“ ist in allen Modi verfügbar und löst zusätzliche Prüfungen aus (inkl. Notification).
- **Sicherheitstests:** Button zum manuellen Senden einer Testnachricht an das iOS-Handy.
## [0.2.7] – 2026-03-30

### Changed
- **Layout:** Karten wachsen mit dem Inhalt, kein Scrollen innerhalb der Kästen; Seiten-Scroll über `index.html` / Host ohne feste `height: 100%`; Karten-Schatten entfernt.
- **Sidebar:** fixiert am linken und oberen Bildschirmrand (`100vh` / `100dvh`, Safe-Area); schmaler (ca. 180px / 56px eingeklappt, mobil 48px); Inhalt mit passendem `margin-left`.

## [0.2.6] – 2026-03-30

### Changed
- **Layout:** einheitliche Kartenbreite (`hk-tab-stack` / `hk-tab-card`) für Modi, Setup, Einstellungen, Log, Notizen; Sidebar-Version unter „Log“, Notizen-Reiter vor Log.
- **Overflow:** kein horizontales Scrollen in der App (`:host`, `container` 100 % statt `100vw`); Touch `pan-y`; Modi-Auswahl, Tag/Nacht-Offsets und Sicherheitsschließzeiten bleiben in der Karte.

## [0.2.5] – 2026-03-30

### Added
- **Notizen:** neuer Reiter; Text in `localStorage` (`hkweb_notes`) und im Add-on mit unter `/data/hkweb-settings.json` gesichert.

### Changed
- **Klappen-Störung:** Status-Anzeige rot, deutlich pulsierend (`pulse-stoerung`).
- **Mobil:** Hauptbereich wird bei fixierter Sidebar eingerückt (60px / 220px), Kacheln mit sichtbarer Kante; gleiche `.content`-Regeln für alle Reiter.

## [0.2.4] – 2026-03-30

### Added
- **Entity-Nomenklatur:** `hk_addon/ENTITY_NOMENKLATUR.md` (Baseline → Projektroot `HOME ASSISTANT ENTITÄTEN.md`).
- **Entity-Prüfung / Auto-Reparatur:** Defaults und Kandidaten an HA-IDs angepasst (u. a. Status `sensor.hkN_status_hkN`), `buildKlappeEntityDefaults()`.

### Changed
- Standard-Status-Entity korrigiert gegenüber falscher Variante `sensor.hkN_hkN_status`.

## [0.1.3] – 2026-03-30

### Fixed
- **Ingress 502 Bad Gateway:** HTTP-Server nicht mehr nur auf IPv4 (`0.0.0.0`) binden – im Docker-Netz kann der Zugriff über IPv6 erfolgen; dann war nichts erreichbar.
- s6-`run`-Skript: `#!/command/with-contenv sh` + `exec node` (ohne `bashio`-Shebang für eine reine Exec-Zeile).

## [0.1.2] – 2026-03-30

### Fixed
- `config.yaml`: **`init: false`** – verhindert Konflikt zwischen Docker-Standard-Init und s6-overlay im HA-Base-Image (Fehler `s6-overlay-suexec: fatal: can only run as pid 1`).

## [0.1.1] – 2026-03-30

### Changed
- Add-on-Ordner und Slug: **`hk_addon`** / Name **HK Addon** (ersetzt `hk_web_app`).
- `config.yaml`: `schema: false` (Store-kompatibel), Version **0.1.1**.
- `.gitattributes`: LF-Zeilenenden für YAML/Scripts (vermeidet CRLF-Probleme auf dem HA-Host).

## [0.1.0] – 2026-03-29

### Added
- Erstes Add-on-Gerüst: `hk_addon` mit Ingress, Node-Server, REST-Proxy zur HA-API (`SUPERVISOR_TOKEN`), Scheduler-Stub, Platzhalter-UI.
- `repository.yaml`, Übersetzungen (`translations/`), `apparmor.txt`, Watchdog-URL, Doku für Installation über GitHub.

[0.2.8]: https://github.com/The88ers/ha-addon-hk-app/releases/tag/v0.2.8
[0.2.7]: https://github.com/The88ers/ha-addon-hk-app/releases/tag/v0.2.7
[0.2.6]: https://github.com/The88ers/ha-addon-hk-app/releases/tag/v0.2.6
[0.2.5]: https://github.com/The88ers/ha-addon-hk-app/releases/tag/v0.2.5
[0.2.4]: https://github.com/The88ers/ha-addon-hk-app/releases/tag/v0.2.4
[0.1.3]: https://github.com/The88ers/ha-addon-hk-app/releases/tag/v0.1.3
[0.1.2]: https://github.com/The88ers/ha-addon-hk-app/releases/tag/v0.1.2
[0.1.1]: https://github.com/The88ers/ha-addon-hk-app/releases/tag/v0.1.1
[0.1.0]: https://github.com/The88ers/ha-addon-hk-app/releases/tag/v0.1.0
