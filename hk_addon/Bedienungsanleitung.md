# Bedienungsanleitung — HK Addon (Home Assistant)

Diese Anleitung beschreibt die **Funktionsweise** des Add-ons **HK Addon**, die **Sicherheitsfunktionen** und die **Entscheidungslogik** (wenn etwas eintritt, was dann passiert — und was sonst).

---

## 1. Wofür das Add-on da ist

Das HK Addon ist eine **Web-Oberfläche** (über **Ingress** in Home Assistant), mit der Sie eine oder mehrere **Hühnerklappen** steuern und **Zeitpläne** sowie **Sicherheitsprüfungen** nutzen können. Die eigentliche Motor- und Endschalter-Logik liegt in Ihrem Setup (z. B. ESPHome); das Add-on löst über die Home-Assistant-API vor allem **`button.press`** und wertet **Sensoren** aus.

**Voraussetzungen:** Home Assistant mit Supervisor, Add-on installiert und gestartet, in der Add-on-Konfiguration **`homeassistant_api`** aktiv (damit `SUPERVISOR_TOKEN` gesetzt ist).

Nach dem Start zeigt die Statuszeile **„HA-API bereit“**, wenn die Verbindung zum Core steht.

---

## 2. Aufbau der Oberfläche (Reiter)

| Reiter | Inhalt (Kurz) |
|--------|----------------|
| **Klappen** | Karten pro Klappe: Status, Tasten, Fahr-Slider, Modus-Übersicht |
| **Modi** | Pro Klappe: Modus wählen und Zeiten/Offsets pflegen |
| **Einstellungen** | Darstellung, Theme, Export/Import, Hinweis auf persistente Speicherung |
| **Sicherheit** | Globale Warnoptionen, Notify-Empfänger, Prüfzeit, **Sicherheitsschließzeiten** pro Klappe |
| **Setup** | Zuordnung der Home-Assistant-Entities (Buttons, Sensoren, Motor) |
| **Notizen** | Freitext |
| **Log** | Ereignisanzeige in der App |

Einstellungen werden im Add-on nach **`/data/hkweb-settings.json`** geschrieben und beim Neustart wieder geladen.

---

## 3. Funktionsweise der Betriebsmodi

### 3.1 Manuell

- Es gibt **keine** automatischen Öffnen-/Schließ-Befehle aus dem **Add-on-Scheduler**.
- Sie steuern die Klappe über die UI (Tasten und **Fahr-Slider**: nach oben ziehen = öffnen, nach unten = schließen, **kurz tippen** = Stop — sofern die entsprechenden Buttons im Setup hinterlegt sind).

### 3.2 Zeitpläne

- Sie legen **Öffnungs-** und **Schließzeiten** (Uhrzeiten) fest.
- Solange der Modus **Zeitpläne** aktiv ist, führt der **Add-on-Scheduler** (Hintergrundprozess im Container) **einmal pro Minute** passende Aktionen aus: zum eingestellten Zeitpunkt wird der konfigurierte **Öffnen-** bzw. **Schließen-Button** gedrückt.
- Die UI weist darauf hin: Ausführung erfolgt **im Add-on**, nicht über eine separate `input_text`-Hilfsentity.

### 3.3 Tag/Nacht

- Es werden **Sonnenauf- und -untergangszeiten** aus Ihrer **Postleitzahl** (über externe Dienste) ermittelt; dazu kommen **Offsets** (z. B. Minuten vor/nach Sonnenauf-/untergang).
- Die Oberfläche zeigt die **errechneten Schaltzeiten** als Orientierung.
- **Wichtig:** Die **automatische** Öffnen/Schließen-Minute im Add-on-Scheduler ist für diesen Modus **nicht** wie bei „Zeitpläne“ angebunden — d. h. das reine Umschalten auf „Tag/Nacht“ **löst keine** wiederkehrenden Button-Presses durch den Scheduler aus. Für tageslichtabhängiges Schalten können Sie die angezeigten Zeiten z. B. in **Home Assistant Automations** übernehmen oder parallel den Modus **Zeitpläne** nutzen.

---

## 4. Motor, Endschalter und Erwartungswerte

Für **Sicherheitsprüfungen** wertet das System (sofern im Setup eingetragen) u. a. aus:

- **Endschalter oben/unten** (Zustände **`Aktiv`** / **`Inaktiv`**),
- **Status-** und **Zustandssensoren** (Texte mit **`offen`** bzw. **`geschlossen`** im Kleinschreibung-Sinn).

**Öffnen gilt als erfolgreich**, wenn (für jede konfigurierte Quelle) u. a. gilt: Endschalter oben **Aktiv**, unten **Inaktiv**, Status/Zustand enthalten „offen“.

**Schließen gilt als erfolgreich**, wenn u. a.: oben **Inaktiv**, unten **Aktiv**, Status/Zustand enthalten „geschlossen“.

Ist eine Entity **nicht** konfiguriert, entfällt diese Prüfung für diese Klappe (wird als „OK“ gewertet).

---

## 5. Sicherheitsfunktionen im Überblick

1. **Schließzeiten: bei Fehlschlag warnen (Zeitpläne)**  
   Globale Option unter **Sicherheit**. Wenn nach einer **geplanten** Öffnen-/Schließ-Aktion die **Prüfzeit** abgelaufen ist und der erwartete Zustand **nicht** erreicht ist → **Benachrichtigung** (sofern Empfänger eingetragen).

2. **„Sicherheitsschließzeiten anwenden“** (pro Modus: Zeitpläne, Tag/Nacht, Manuell)  
   - Bei **Zeitpläne**: Zusätzlich zur ersten Warnung kann eine **zweite** Meldung mit dem Präfix **„Sicherheitsschließzeiten:“** gesendet werden, wenn die Nachprüfung fehlschlägt.  
   - Bei **manuellen** Öffnen/Schließen (Slider/Tasten): Wenn diese Option im **aktuellen** Modus aktiv ist, wird nach der **Prüfzeit** ebenfalls geprüft; bei Abweichung → Benachrichtigung mit Präfix **„Sicherheitsschließzeiten:“**.

3. **Sicherheitsschließzeiten (Uhrzeiten pro Klappe)**  
   Unter **Sicherheit** je Klappe eintragbar. Der **Add-on-Scheduler** prüft zur eingestellten Minute (mit der konfigurierten **Prüfzeit** als Warte- und Nachprüfintervall), ob die Klappe **geschlossen** ist. Wenn nicht, wird **einmal** der **Schließen-Button** aus dem Setup ausgelöst; danach erneute Prüfung und **Notify** über das Ergebnis (geschlossen / weiterhin nicht / kein Button / Fehler beim Drücken) — sofern Empfänger konfiguriert sind.

4. **Prüfzeit (Sekunden)**  
   Wartezeit bis zur **ersten** Zustandsprüfung nach geplantem Öffnen/Schließen; dieselbe Größenordnung wird auch für die **Wartezeit nach dem einmaligen Nach-Schließen** bei den Sicherheitsschließzeiten genutzt (im Code begrenzt typischerweise **5–600** Sekunden, Standard **45**).

5. **Benachrichtigungen**  
   Ziele: `notify.mobile_app_…` (Companion App). Mehrere Empfänger möglich; **Testnachricht** in der UI zum Abgleich.

6. **Watchdog**  
   Der Supervisor kann die Erreichbarkeit des Dienstes über **`/api/health`** prüfen (siehe Add-on-Metadaten).

---

## 6. Wenn … dann …, ansonsten … (Entscheidungslogik)

Die folgenden Fälle fassen die Logik in Alltagssprache zusammen.

### A) Geplantes Öffnen oder Schließen (Modus **Zeitpläne**)

| Situation | Dann | Ansonsten |
|-----------|------|-----------|
| Zur eingestellten Zeit wird der Button gedrückt. | — | Wenn der Aufruf fehlschlägt und globale **Warnung** aktiv ist → Notify; wenn zusätzlich **Sicherheitsschließzeiten anwenden** im Zeitplan-Modus aktiv ist → zweite Notify-Variante mit Präfix „Sicherheitsschließzeiten:“. |
| Nach **Prüfzeit** wird der Zustand geprüft (wenn mindestens eine der Optionen Checks auslöst). | **Wenn** Endschalter/Status zum erwarteten Zustand passen → nichts weiter. | **Wenn nicht** → Benachrichtigung (Text je nach Öffnen/Schließen und Variante „normal“ vs. „Sicherheitsschließzeiten“). |

### B) Manuelles Öffnen/Schließen (Slider oder Tasten)

| Situation | Dann | Ansonsten |
|-----------|------|-----------|
| **Sicherheitsschließzeiten anwenden** im **aktuellen** Modus ist **aus**. | Keine automatische Nachprüfung durch diese Logik. | — |
| Option ist **an** und Notify-Ziele sind gesetzt. | Nach **Prüfzeit**: **Wenn** Zustand passt → keine Meldung. | **Wenn** Zustand nicht passt → Notify mit „Sicherheitsschließzeiten: … fehlgeschlagen“. |

### C) Sicherheitsschließzeit (eingestellte Uhrzeit, Add-on-Scheduler)

**Voraussetzung:** Für die **jeweils aktive** Klappe ist im **aktuellen Modus** die Checkbox **„Sicherheitsschließzeiten anwenden“** aktiviert (nur dann laufen die eingetragenen Sicherheitsschließzeiten mit).

| Situation | Dann | Ansonsten |
|-----------|------|------------|
| Zur Sicherheitsschließzeit (nach Ablauf der Prüfzeit) ist die Klappe **bereits geschlossen**. | Protokoll/Hinweis im Scheduler-Log; keine Nachbesserung nötig. | — |
| Klappe **nicht** geschlossen und **kein** Schließen-Button konfiguriert. | — | Notify (falls Empfänger): kein erneuter Versuch möglich. |
| Klappe nicht geschlossen, Button vorhanden. | **Einmal** `button.press` Schließen; warten **Prüfzeit**; **wenn** dann geschlossen → optional Notify „jetzt geschlossen“. | **Wenn** weiterhin nicht geschlossen → Notify „weiterhin nicht geschlossen“. |
| `button.press` wirft einen Fehler. | — | Notify mit Fehlerhinweis (falls Empfänger). |

### D) Keine Benachrichtigung trotz Problem

- Es sind **keine** Notify-Empfänger eingetragen, oder  
- die betreffende Option (globale Warnung / Modus-Checkbox) ist **nicht** aktiv.

---

## 7. Hinweise zum sicheren Betrieb

- Physische **Endschalter** und die **richtige Verdrahtung** der Motorsteuerung bleiben die Grundlage der Sicherheit; das Add-on **ersetzt** keine Not-Aus-Hardware.
- **Entities** im Setup sollten mit den tatsächlichen Gerätenamen in HA übereinstimmen; die App kann fehlende oder falsche IDs im Log melden.
- Bei **AppArmor-Problemen** siehe die technische Kurzdoku im Repository (`DOCS.md`); Profilanpassung ist dem dauerhaften Abschalten von AppArmor vorzuziehen.

---

## 8. Technische Referenz (Kurz)

- Scheduler: `app/scheduler.mjs` (Intervall ca. 10 s, Auswertung **pro lokaler Minute**).
- UI und manuelle Sicherheitsnachprüfung: `app/www/liquid-glass-app.js`.
- REST-Proxy und Persistenz: `app/server.mjs`, Datei `/data/hkweb-settings.json`.

Bei Änderungen an Entity-Namen im Projekt die Datei **`ENTITY_NOMENKLATUR.md`** und die Baseline-Dokumentation im übergeordneten Projektordner beachten.

---

*Stand: abgestimmt auf die Add-on-Struktur mit Version aus `config.yaml` (z. B. 0.2.x).*
