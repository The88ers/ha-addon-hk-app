# HK Web App

## Übersicht

Web-Oberfläche über **Ingress**. Der Dienst nutzt die Home-Assistant-REST-API über den Supervisor-Proxy **`http://supervisor/core/api`** mit der Umgebungsvariable **`SUPERVISOR_TOKEN`** (`homeassistant_api: true` in `config.yaml`).

## Voraussetzungen

- Home Assistant OS oder Supervised Installation mit Supervisor.
- Add-on **Installieren** lässt den Supervisor das Docker-Image **bauen** (Internet beim ersten Build nötig).

## Nach der Installation

1. Add-on **Starten**.
2. **„Open Web UI“** oder Sidebar-Eintrag **HK Web App** öffnen.
3. Wenn die Statuszeile **„HA-API bereit“** zeigt, ist die Verbindung zum Core in Ordnung.

## Konfiguration

v0.1: keine Nutzer-Optionen in `options`/`schema`. Anpassungen erfolgen über zukünftige Versionen.

## Watchdog

`config.yaml` enthält `watchdog: http://[HOST]:[PORT:8099]/api/health` – der Supervisor prüft periodisch, ob der Dienst antwortet.

## AppArmor

Profildatei `apparmor.txt` im Add-on-Ordner. Sollte der Start mit AppArmor-Fehlern scheitern, in den **Add-on-Expertenoptionen** vorübergehend `apparmor: false` setzen (nur zur Fehlersuche; danach Profil anpassen).

## Entwicklung / lokaler Docker-Build

```bash
cd hk_web_app
docker build --build-arg BUILD_FROM=ghcr.io/home-assistant/base:3.23 -t hk-web-app:local .
```

`SUPERVISOR_TOKEN` existiert nur im Supervisor-Kontext; lokal ohne HA ist die HA-API nicht erreichbar.
