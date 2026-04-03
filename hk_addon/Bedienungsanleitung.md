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
| **Sicherheit** | Globale Schalter, Vollzugsprüfung, **Benachrichtigung bei Störung**, Notify-Empfänger, Prüfzeit, **Sicherheitsschließzeiten** pro Klappe |
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
- **Geplante Schließzeiten** dürfen **nicht nach der spätesten Sicherheitsschließzeit** liegen, die Sie unter **Sicherheit** für dieselbe Klappe eingetragen haben — sonst wird die Eingabe **abgelehnt** (mit Hinweis im App-Log).

### 3.3 Tag/Nacht

- Es werden **Sonnenauf- und -untergangszeiten** aus Ihrer **Postleitzahl** (über externe Dienste) ermittelt; dazu kommen **Offsets** (z. B. Minuten vor/nach Sonnenauf-/untergang). Die Zeiten beziehen sich auf **Europe/Berlin** und **ändern sich mit Kalendertag und Jahreszeit** — der Add-on-Scheduler **holt sie pro Tag neu** (Cache im laufenden Tag), damit Öffnen und Schließen zur richtigen Jahreszeit passieren.
- Die Oberfläche zeigt die **errechneten Öffnungs-/Schließminuten** zur Kontrolle; die Anzeige **aktualisiert sich** u. a. etwa **alle 4 Stunden**, beim **Wiederaktivieren** der Seite und per **Aktualisieren**. Liegt die errechnete Schließzeit **nach der spätesten Sicherheitsschließzeit**, wird eine **Offset-Änderung abgelehnt** (Offset wird zurückgesetzt, Hinweis im Log).
- Solange der Modus **Tag/Nacht** aktiv ist, führt der **Add-on-Scheduler** zur passenden **Minute** (wie bei Zeitpläne) die konfigurierten **Öffnen-** bzw. **Schließen-Buttons** aus — gestützt auf die **tagesaktuellen** Sonnenzeiten plus Offsets.

---

## 4. Motor, Endschalter und Erwartungswerte

Für **Sicherheitsprüfungen** wertet das System (sofern im Setup eingetragen) u. a. aus:

- **Endschalter oben/unten** — sowohl **Text** wie bei ESPHome (**`Aktiv`** / **`Inaktiv`**) als auch **`binary_sensor`** mit **`on`** / **`off`** werden erkannt,
- **Status-** und **Zustandssensoren** (Texte mit **`offen`** bzw. **`geschlossen`** im Kleinschreibung-Sinn).

**Öffnen gilt als erfolgreich**, wenn (für jede konfigurierte Quelle) u. a. gilt: Endschalter oben **betätigt** (z. B. `on` oder „Aktiv“), unten **nicht betätigt** (`off` / „Inaktiv“), Status/Zustand enthalten „offen“.

**Schließen gilt als erfolgreich**, wenn u. a.: oben **nicht betätigt**, unten **betätigt**, Status/Zustand enthalten „geschlossen“.

Ist eine Entity **nicht** konfiguriert, entfällt diese Prüfung für diese Klappe (wird als „OK“ gewertet).

In **Benachrichtigungen** wird der Klappenzustand als kurzer Text aus den konfigurierten Sensoren zusammengefasst (z. B. `Status: …; Zustand: …; Endschalter …`). Fehlen alle relevanten Entities, lautet der Hinweis **„keine Sensoren konfiguriert“**.

---

## 5. Sicherheitsfunktionen im Überblick

### 5.1 Sicherheitsschließzeiten (pro Klappe, global schaltbar)

- Unter **Sicherheit** tragen Sie **pro Klappe** eine oder mehrere **Uhrzeiten** ein, zu denen die Klappe **geschlossen** sein soll.
- Der Schalter **„Sicherheitsschließzeiten global aktiv“** steuert, ob der **Add-on-Scheduler** diese Prüfungen überhaupt ausführt. Ohne Aktivierung werden die Zeiten ignoriert (unabhängig vom gewählten Modus).
- Diese Funktion steht **über** den Modi: Sie definiert den Zeitpunkt, zu dem „zu sein hat“, dass die Klappe zu ist. Deshalb dürfen **keine** geplanten Schließzeiten (Modus Zeitpläne) und **keine** errechnete Tag/Nacht-Schließzeit **nach der spätesten** eingetragenen Sicherheitsschließzeit liegen — die App **lehnt** solche Eingaben ab.
- Ablauf (nach Ablauf der **Prüfzeit** ab der vollen Minute der Sicherheitsschließzeit): Zustand lesen → wenn nicht geschlossen, **Warnung** mit Ist-Zustand → einmal **Schließen** auslösen → erneut **Prüfzeit** warten → erneut prüfen → **Erfolgs-** oder **Fehlermeldung** (siehe unten).

### 5.2 Vollzugsprüfung (Zeitpläne, Tag/Nacht und optional manuell)

- Schalter **„Vollzugsprüfung“** unter **Sicherheit**: Nach jedem **geplanten** Öffnen/Schließen (Modus **Zeitpläne** oder **Tag/Nacht**) wartet das Add-on die **Prüfzeit** und sendet eine Benachrichtigung, ob der **erwartete Zustand** erreicht wurde (**Erfolg** oder **Misserfolg** mit Zustandstext).
- **Manuell:** Zusätzlich in jedem Modus die Checkbox **„Vollzugsprüfung bei manueller Bedienung (dieser Modus)“** aktivieren. Dann lösen die Tasten **Öffnen** / **Schließen** und der **Fahr-Slider** auf der Klappenkarte dieselbe Prüfung aus wie der Zeitplan (nach **Prüfzeit** Auswertung und **Notify**). Es gelten dieselbe **globale** Option und die eingetragenen **Notify-Empfänger**. Die Prüfung läuft in der **Web-Oberfläche** (Ingress); die Seite sollte bis nach Ablauf der Prüfzeit geöffnet bleiben, damit der Timer ausgeführt wird.

### 5.3 Benachrichtigung bei Störung

- Schalter **„Benachrichtigung bei Störung“** unter **Sicherheit** (standardmäßig an): Der **Add-on-Scheduler** prüft etwa **alle 45 Sekunden** die konfigurierten **Status-** und **Zustandssensoren**. Enthält mindestens einer der Texte **„Störung“** oder **„storung“**, wird **einmal pro neuem Störungsfall** an die gleichen **Notify-Ziele** wie bei den anderen Sicherheitsmeldungen gesendet. Läuft **unabhängig** davon, ob die Web-UI offen ist.

### 5.4 Prüfzeit, Notify, Watchdog

- **Prüfzeit (Sekunden):** Wartezeit bis zur ersten Zustandsprüfung nach einem geplanten Öffnen/Schließen (Zeitpläne oder Tag/Nacht); dieselbe Dauer wird nach dem **einmaligen Nach-Schließen** bei den Sicherheitsschließzeiten erneut gewartet (5–600 s, Standard oft 45). **Manuelle** Vollzugsprüfung nutzt dieselbe Prüfzeit.
- **Benachrichtigungen:** konfigurierte `notify`-Ziele (z. B. Companion-App); **Testbutton** in der UI.
- **Watchdog:** Supervisor kann **`/api/health`** prüfen.

---

## 6. Konkrete Meldungstexte

### A) Sicherheitsschließzeiten (Scheduler)

| Situation | Meldung (Auszug) |
|-----------|------------------|
| Nach Prüfzeit nicht geschlossen, Schließen-Button vorhanden | **WARNUNG:** Klappe … zur definierten Sicherheitsschließzeit nicht geschlossen. Zustand der Klappe: „…“. Es wird versucht, die Klappe erneut zu schließen. |
| Nicht geschlossen, im **Setup** kein **Schließen-**`button` eingetragen | **WARNUNG:** … Kein Schließen-Button konfiguriert — kein automatischer Nachversuch möglich. (Das Add-on kann sonst kein `button.press` fürs Schließen senden.) |
| Nachversuch Schließen erfolgreich | Nach Abweichung zur eingestellten Schließzeit konnte die Klappe … geschlossen werden. |
| Nachversuch fehlgeschlagen oder `button.press` scheitert | **WARNUNG:** Schließen der Klappe … fehlgeschlagen. (bei Servicefehler ggf. mit technischem Zusatz in Klammern) |

### B) Vollzugsprüfung (Zeitplan, Tag/Nacht oder manuell mit Modus-Checkbox)

| Situation | Meldung (Auszug) |
|-----------|------------------|
| Erwarteter Zustand erreicht | Klappe … wurde geöffnet. / Klappe … wurde geschlossen. |
| Nicht erreicht (oder geplanter Button-Aufruf schon fehlgeschlagen) | Klappe … konnte nicht geöffnet/geschlossen werden. Zustand der Klappe: „…“ |

### C) Störung (Add-on-Überwachung)

| Situation | Meldung (Auszug) |
|-----------|------------------|
| Status oder Zustand meldet Störung (neuer Fall) | **STÖRUNG:** Klappe …. Status: …; Zustand: …; … |

---

## 7. Wenn … dann … (Kurz)

- **Sicherheitsschließzeiten aus:** keine automatischen Checks zu diesen Zeiten.
- **Vollzugsprüfung aus:** nach Zeitplan kein Erfolgs-/Fehler-Ping; manuelle Nachprüfung entfällt ebenfalls (auch wenn die Modus-Checkbox an ist).
- **Benachrichtigung bei Störung aus:** keine automatischen Störungs-Pushes; andere Scheduler-Funktionen laufen weiter.
- **Keine Notify-Empfänger:** es werden keine Benachrichtigungen gesendet, die Logik im Scheduler läuft aber weiter (soweit sinnvoll).

---

## 8. Hinweise zum sicheren Betrieb

- Physische **Endschalter** und die **richtige Verdrahtung** der Motorsteuerung bleiben die Grundlage der Sicherheit; das Add-on **ersetzt** keine Not-Aus-Hardware.
- **Entities** im Setup sollten mit den tatsächlichen Gerätenamen in HA übereinstimmen.
- Bei **AppArmor-Problemen** siehe `DOCS.md`.

---

## 9. Technische Referenz (Kurz)

- Scheduler: `app/scheduler.mjs` (inkl. Störungsüberwachung)
- Gemeinsame Vollzugslogik Endschalter: `app/www/safety-gates.mjs`
- UI: `app/www/liquid-glass-app.js`
- REST: `app/server.mjs`, `/data/hkweb-settings.json`

---

*Stand: abgestimmt auf die Add-on-Version in `config.yaml`.*
