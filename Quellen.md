# Quellen: Home Assistant Add-ons / Apps programmieren

> **Hinweis zur Terminologie:** In der offiziellen Entwicklerdokumentation heißen Add-ons inzwischen **Apps** (gleiche Technik: Docker-Container über den Home Assistant Supervisor). Alte Links mit `/docs/add-ons/` können ins Leere führen; die aktuelle Sektion ist **`/docs/apps/`**.

---

## Offizielle Entwicklerdokumentation (Website)

Basis-URL: [https://developers.home-assistant.io/](https://developers.home-assistant.io/)

| Thema | URL |
|--------|-----|
| Einführung: Apps entwickeln | [Developing an app](https://developers.home-assistant.io/docs/apps) |
| Tutorial: erste App | [Tutorial: Making your first app](https://developers.home-assistant.io/docs/apps/tutorial) |
| Konfiguration (`config.yaml`, Schema, Berechtigungen) | [Configuration](https://developers.home-assistant.io/docs/apps/configuration) |
| Kommunikation mit Home Assistant / API | [Communication](https://developers.home-assistant.io/docs/apps/communication) |
| Lokales Testen | [Local Testing](https://developers.home-assistant.io/docs/apps/testing) |
| Veröffentlichen / Registry | [Publishing](https://developers.home-assistant.io/docs/apps/publishing) |
| Darstellung in der UI (Icons, Panels) | [Presentation](https://developers.home-assistant.io/docs/apps/presentation) |
| App-Repository anlegen | [Repositories](https://developers.home-assistant.io/docs/apps/repository) |
| Sicherheit | [Security](https://developers.home-assistant.io/docs/apps/security) |

---

## Gleiche Inhalte direkt auf GitHub (Markdown)

Falls die Website nicht erreichbar ist, liegen die Texte im Repo [home-assistant/developers.home-assistant](https://github.com/home-assistant/developers.home-assistant) unter `docs/apps/`:

- [docs/apps.md](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/apps.md) (Übersicht + Linkliste)
- [docs/apps/tutorial.md](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/apps/tutorial.md)
- [docs/apps/configuration.md](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/apps/configuration.md)
- [docs/apps/communication.md](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/apps/communication.md)
- [docs/apps/testing.md](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/apps/testing.md)
- [docs/apps/publishing.md](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/apps/publishing.md)
- [docs/apps/presentation.md](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/apps/presentation.md)
- [docs/apps/repository.md](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/apps/repository.md)
- [docs/apps/security.md](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/apps/security.md)

---

## Offizielle Repositories und Werkzeuge

| Beschreibung | URL |
|----------------|-----|
| Beispiel-Repository (Vorlage für eigene Apps) | [home-assistant/addons-example](https://github.com/home-assistant/addons-example) |
| Supervisor (verwaltet u. a. Apps/Add-ons) | [home-assistant/supervisor](https://github.com/home-assistant/supervisor) |
| Offizielle Core-Apps (Referenz) | [home-assistant/addons](https://github.com/home-assistant/addons) |
| Docker-Basisimages für Builds | [home-assistant/docker-base](https://github.com/home-assistant/docker-base) |
| Builder (Multi-Arch-Builds) | [home-assistant/builder](https://github.com/home-assistant/builder) |
| Repo nur für Entwicklung / Tests | [home-assistant/addons-development](https://github.com/home-assistant/addons-development) |

---

## Supervisor & Plattform (Kontext)

| Thema | URL |
|--------|-----|
| Supervisor (Übersicht) | [Supervisor](https://developers.home-assistant.io/docs/supervisor) |
| Supervisor-Entwicklung | [Supervisor development](https://developers.home-assistant.io/docs/supervisor/development) |
| Home Assistant OS | [Operating System](https://developers.home-assistant.io/docs/operating-system) |

---

## Community

- Sammlung Community-Add-ons: [https://github.com/hassio-addons](https://github.com/hassio-addons)

---

## Blog / Änderungen (für bestehende Add-ons relevant)

- Seit Home Assistant OS 16: geändertes Limit für offene Dateideskriptoren in Add-ons — [Blog: Handling open file limit in add-ons since OS 16](https://developers.home-assistant.io/blog/2025/07/14/home-assistant-os-16-open-file-limit/) ([developers.home-assistant.io](https://developers.home-assistant.io/))

---

*Stand der Recherche: März 2026. URLs der offiziellen Doku können sich bei Umbenennungen oder Site-Updates ändern; die GitHub-Links zu `docs/apps/` sind die stabile Referenz auf die gleichen Texte.*
