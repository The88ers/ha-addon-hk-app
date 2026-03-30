# HK Addon – Home Assistant App

Steuerung der Hühnerklappe(n) als Home-Assistant-App (Docker) mit Ingress-UI und integriertem Scheduler.

## Installation über GitHub (empfohlen)

1. **Home Assistant öffnen** → **Einstellungen** → **Add-ons** → **Add-on Store**.
2. Oben rechts **⋮** → **Repositories** → **Hinzufügen**.
3. Repository-URL **exakt** eintragen (Groß-/Kleinschreibung, **zwei** „8“ in `The88ers`):

   **`https://github.com/The88ers/ha-addon-hk-app`**

4. **Hinzufügen** → im Store **HK Addon** auswählen → **Installieren** (der Supervisor baut das Image aus dem `Dockerfile` – kann einige Minuten dauern).
5. Add-on **starten**. Anschließend **„Open Web UI“** bzw. den Eintrag in der Seitenleiste nutzen (Ingress).

**Privates GitHub-Repository:** Der Home-Assistant-Supervisor kann **private** Repos per HTTPS **nicht** ohne Anmeldung klonen. Dann entweder das Repo **öffentlich** schalten oder **kein** GitHub-Repository in HA eintragen und stattdessen lokal unter `/addons` installieren.

**Falsche/fehlgeschlagene Repositories** in der Liste entfernen (**⋮ → Repositories**), sonst bleiben Fehler im Supervisor-Log (z. B. Tippfehler `The8Bers` oder alte Einträge).

**Updates:** Nach `git push` im Repo in HA unter Add-on **„Nach Updates suchen“** / Store aktualisieren, dann **Aktualisieren** und ggf. **Neu erstellen** (Rebuild), wenn sich `Dockerfile` oder App-Code geändert hat.

## Lokales Add-on (ohne GitHub)

Ordner **`hk_addon`** aus diesem Repo nach **`/addons/hk_addon`** auf dem Home-Assistant-Host kopieren (Samba „addons“-Freigabe oder SSH). Im Store erscheint das Add-on unter **Lokale Add-ons**.

## Projektstruktur (Repository)

| Pfad | Inhalt |
|------|--------|
| `repository.yaml` | Store-Metadaten (Repo-Wurzel) |
| `hk_addon/config.yaml` | App: Ingress, `homeassistant_api`, Watchdog |
| `hk_addon/Dockerfile` | Image (Alpine-Base, Node.js) |
| `hk_addon/app/` | Node-Server, UI, Scheduler |
| `hk_addon/rootfs/` | s6-Service (`run`) |
| `Anforderungen.md` | Funktionale Vorgaben |

## Stand v0.1

- Ingress auf Port **8099**, REST-Proxy zum Supervisor (`/api/ha/...`)
- **`SUPERVISOR_TOKEN`** / `homeassistant_api` (kein manueller Long-Lived-Token)
- Scheduler-Stub (minütliches Log)
- Platzhalter-Webseite; vollständige Klappen-UI folgt

Details: **`hk_addon/DOCS.md`**, Changelog: **`CHANGELOG.md`**.
