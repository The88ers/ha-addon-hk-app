# Changelog

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).  
Die **Versionsnummer** entspricht `version` in `hk_addon/config.yaml` (Quelle für Home Assistant).

## [0.1.1] – 2026-03-30

### Changed
- Add-on-Ordner und Slug: **`hk_addon`** / Name **HK Addon** (ersetzt `hk_web_app`).
- `config.yaml`: `schema: false` (Store-kompatibel), Version **0.1.1**.
- `.gitattributes`: LF-Zeilenenden für YAML/Scripts (vermeidet CRLF-Probleme auf dem HA-Host).

## [0.1.0] – 2026-03-29

### Added
- Erstes Add-on-Gerüst: `hk_addon` mit Ingress, Node-Server, REST-Proxy zur HA-API (`SUPERVISOR_TOKEN`), Scheduler-Stub, Platzhalter-UI.
- `repository.yaml`, Übersetzungen (`translations/`), `apparmor.txt`, Watchdog-URL, Doku für Installation über GitHub.

[0.1.1]: https://github.com/The88ers/ha-addon-hk-app/releases/tag/v0.1.1
[0.1.0]: https://github.com/The88ers/ha-addon-hk-app/releases/tag/v0.1.0
