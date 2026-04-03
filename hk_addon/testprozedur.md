# Testprozedur — HK Addon (Home Assistant)

Dieses Dokument ist ein **Testkatalog** zur systematischen Prüfung der Funktionen aus der **Bedienungsanleitung**, inklusive **Sicherheitsfunktionen** und **Benachrichtigungen**. Vor jedem Testlauf die Voraussetzungen prüfen und Ergebnisse protokollieren (bestanden / nicht bestanden, Datum, Version).

---

## 0. Voraussetzungen und Testumgebung

| ID | Prüfpunkt | Erwartung |
|----|-----------|-----------|
| T0.1 | Home Assistant mit Supervisor, Add-on installiert und gestartet | Add-on läuft stabil |
| T0.2 | Add-on-Konfiguration: `homeassistant_api` aktiv | `SUPERVISOR_TOKEN` gesetzt, API-Zugriff möglich |
| T0.3 | Ingress/Web-Oberfläche öffnen | UI lädt ohne Fehler |
| T0.4 | Statuszeile nach Start | Anzeige **„HA-API bereit“**, wenn Core erreichbar |
| T0.5 | Optional: Health-Check | Supervisor bzw. Monitoring kann **`/api/health`** erfolgreich abfragen (**Watchdog**) |

**Hinweis:** Physische Endschalter und Motorverdrahtung sind Voraussetzung für realistische Sicherheits- und Vollzugstests; ohne Hardware können Teile nur logisch oder mit simulierten Sensoren geprüft werden.

---

## 1. Oberfläche und Navigation

| ID | Test | Schritte | Erwartung |
|----|------|----------|-----------|
| T1.1 | Reiter **Klappen** | Alle Reiter durchklicken | Karten pro Klappe: Status, Tasten, Fahr-Slider, Modus-Übersicht sichtbar |
| T1.2 | Reiter **Modi** | Öffnen | Pro Klappe Modus wählbar; Zeiten/Offsets bearbeitbar |
| T1.3 | Reiter **Einstellungen** | Theme/Darstellung ändern | Änderungen wirken in der UI |
| T1.4 | Reiter **Sicherheit** | Öffnen | Globale Schalter, Vollzugsprüfung, Notify-Empfänger, Prüfzeit, Sicherheitsschließzeiten pro Klappe sichtbar |
| T1.5 | Reiter **Setup** | Öffnen | Zuordnung Buttons/Sensoren/Motor je Klappe möglich |
| T1.6 | Reiter **Notizen** | Text eingeben, speichern/neu laden | Freitext bleibt erhalten (soweit von der App vorgesehen) |
| T1.7 | Reiter **Log** | Nach Aktionen öffnen | Ereignisse erscheinen konsistent zu den ausgelösten Vorgängen |

---

## 2. Persistenz der Einstellungen

| ID | Test | Schritte | Erwartung |
|----|------|----------|-----------|
| T2.1 | Speichern | Einstellungen/Setup ändern, Add-on neu starten | Werte werden aus **`/data/hkweb-settings.json`** wieder geladen |
| T2.2 | Export/Import | Unter **Einstellungen** Export durchführen, Import mit gültiger Datei | Daten werden übernommen ohne Datenverlust der relevanten Felder |

---

## 3. Betriebsmodus **Manuell**

| ID | Test | Schritte | Erwartung |
|----|------|----------|-----------|
| T3.1 | Kein Scheduler bei Manuell | Modus **Manuell** aktiv lassen, keine manuelle Bedienung | **Keine** automatischen Öffnen-/Schließ-Befehle vom Add-on-Scheduler |
| T3.2 | Tasten | Öffnen/Schließen/Stop (sofern im Setup hinterlegt) | Entsprechende **`button.press`**-Aufrufe in HA / erwartete Hardware-Reaktion |
| T3.3 | Fahr-Slider | Nach oben ziehen / nach unten ziehen / kurz tippen (Stop) | Verhalten entspricht der Anleitung, sofern Buttons konfiguriert sind |

---

## 4. Betriebsmodus **Zeitpläne**

| ID | Test | Schritte | Erwartung |
|----|------|----------|-----------|
| T4.1 | Öffnungszeit | Modus **Zeitpläne**, Öffnungszeit auf nächste volle Minute setzen | Zur Minute wird **Öffnen-Button** gedrückt |
| T4.2 | Schließzeit | Schließzeit setzen (vor **spätester Sicherheitsschließzeit**, siehe Abschnitt 6) | Zur Minute wird **Schließen-Button** gedrückt |
| T4.3 | Scheduler-Takt | Log beobachten | Scheduler arbeitet **mindestens im Minutentakt** (einmal pro Minute Prüfung/Ausführung) |
| T4.4 | Ablehnung Schließzeit | Schließzeit **nach** der spätesten Sicherheitsschließzeit eintragen | Eingabe wird **abgelehnt**; **Hinweis im App-Log** |

---

## 5. Betriebsmodus **Tag/Nacht**

| ID | Test | Schritte | Erwartung |
|----|------|----------|-----------|
| T5.1 | PLZ / Sonnenzeiten | Gültige Postleitzahl, Modus **Tag/Nacht** | Errechnete Öffnungs-/Schließminuten in der UI plausibel |
| T5.2 | Ausführung | Warten bis errechnete Minute | **Öffnen-** bzw. **Schließen-Button** wie konfiguriert |
| T5.3 | Tagesaktualität | Über Mitternacht / anderen Kalendertag beobachten | Zeiten werden **pro Tag neu** bezogen (Cache innerhalb des Tages) |
| T5.4 | UI-Aktualisierung | Seite im Hintergrund, wieder aktivieren; **Aktualisieren** | Anzeige der errechneten Minuten aktualisiert sich (u. a. ca. **alle 4 Stunden**, bei Reaktivierung, manuell) |
| T5.5 | Offset vs. Sicherheit | Offset so wählen, dass Schließzeit **nach** spätester Sicherheitsschließzeit läge | **Offset-Änderung abgelehnt**, Offset zurückgesetzt, **Hinweis im Log** |

---

## 6. Sicherheitsschließzeiten

| ID | Test | Schritte | Erwartung |
|----|------|----------|-----------|
| T6.1 | Global aus | **„Sicherheitsschließzeiten global aktiv“** aus | Keine automatischen Checks zu den eingetragenen Zeiten (unabhängig vom Modus) |
| T6.2 | Global an, Klappe offen | Sicherheitsschließzeit setzen, Klappe zur Prüfminute **nicht** geschlossen, **Schließen-Button** im Setup vorhanden | Nach **Prüfzeit** ab voller Minute: **WARNUNG** mit Ist-Zustand; einmal **Schließen** ausgelöst (vgl. Meldungstexte Abschnitt 9) |
| T6.3 | Kein Schließen-Button | Wie T6.2, aber kein Schließen-`button` im Setup | **WARNUNG:** kein Schließen-Button — **kein** automatischer Nachversuch |
| T6.4 | Nachversuch erfolgreich | Nach T6.2 Hardware/Sensoren so, dass Schließen klappt | Meldung: Nach Abweichung … konnte die Klappe … **geschlossen** werden |
| T6.5 | Nachversuch fehlgeschlagen | Schließen scheitert oder `button.press` fehlerhaft | **WARNUNG:** Schließen … **fehlgeschlagen** (ggf. technischer Zusatz) |
| T6.6 | Konsistenz mit Zeitplänen | Späteste Sicherheitsschließzeit festlegen | Geplante Schließzeit **Zeitpläne** und errechnete **Tag/Nacht**-Schließzeit dürfen **nicht danach** liegen (Ablehnung in UI/Log) |

---

## 7. Vollzugsprüfung

| ID | Test | Schritte | Erwartung |
|----|------|----------|-----------|
| T7.1 | Global aus | **„Vollzugsprüfung“** unter Sicherheit aus; geplantes Öffnen/Schließen auslösen | **Keine** Erfolgs-/Fehler-Benachrichtigung zur Vollzugsprüfung (auch wenn Modus-Checkbox an ist) |
| T7.2 | Global an, Zeitpläne | Nach geplantem Öffnen/Schließen **Prüfzeit** abwarten | Benachrichtigung: **Erfolg** („wurde geöffnet/geschlossen“) oder **Misserfolg** mit Zustandstext |
| T7.3 | Global an, Tag/Nacht | Wie T7.2 im Modus Tag/Nacht | Gleiches Verhalten |
| T7.4 | Manuell mit Checkbox | Pro Modus: **„Vollzugsprüfung bei manueller Bedienung“** aktivieren; **Öffnen/Schließen-Tasten** oder Fahr-Slider; UI bis nach Prüfzeit offen lassen | Nach **Prüfzeit** dieselbe globale Logik wie bei Zeitplan (Notify wie konfiguriert) |
| T7.5 | Prüfzeit-Grenzen | Prüfzeit auf Minimum/Maximum setzen (5–600 s) | Akzeptanz in UI; Wartezeit bis zur ersten Prüfung entspricht Einstellung |
| T7.6 | Geplanter Button fehlgeschlagen | HA so konfigurieren/simulieren, dass Aufruf fehlschlägt | Vollzugsprüfung meldet **Misserfolg** inkl. Zustand (laut Anleitung) |

---

## 8. Sensoren, Erwartungswerte und Meldungstexte

| ID | Test | Schritte | Erwartung |
|----|------|----------|-----------|
| T8.1 | Öffnen erfolgreich | Endschalter oben betätigt (`on` oder **Aktiv**), unten nicht (`off` oder **Inaktiv**), Status/Zustand enthält **„offen“** | Vollzugsprüfung **Erfolg** beim Öffnen |
| T8.2 | Schließen erfolgreich | Oben nicht betätigt, unten betätigt, Texte enthalten **„geschlossen“** | Vollzugsprüfung **Erfolg** beim Schließen |
| T8.3 | Fehlende Entity | Eine Quelle im Setup leer lassen | Diese Prüfung **entfällt** (wird als OK gewertet) für diese Klappe |
| T8.4 | Benachrichtigung Zusammenfassung | Notify bei beliebigem relevanten Ereignis | Kurztext aus Sensoren (z. B. Status, Zustand, Endschalter) |
| T8.5 | Keine Sensoren | Alle relevanten Sensor-Entities entfernen/leer | Hinweis **„keine Sensoren konfiguriert“** in Benachrichtigung, wo zutreffend |

---

## 9. Benachrichtigungen (Notify) — Inhalte und Randfälle

Referenz: Abschnitt 6 der Bedienungsanleitung (Meldungstexte).

### 9.1 Sicherheitsschließzeiten (Scheduler)

| ID | Situation | Zu prüfender Meldungsinhalt (Auszug) |
|----|-----------|--------------------------------------|
| N1.1 | Nach Prüfzeit nicht geschlossen, Schließen-Button vorhanden | **WARNUNG:** … zur definierten Sicherheitsschließzeit nicht geschlossen … Zustand … Nachversuch Schließen |
| N1.2 | Nicht geschlossen, kein Schließen-Button | **WARNUNG:** … Kein Schließen-Button konfiguriert … |
| N1.3 | Nachversuch erfolgreich | … konnte die Klappe … **geschlossen** werden |
| N1.4 | Nachversuch fehlgeschlagen / Servicefehler | **WARNUNG:** Schließen … **fehlgeschlagen** |

### 9.2 Vollzugsprüfung

| ID | Situation | Zu prüfender Meldungsinhalt (Auszug) |
|----|-----------|--------------------------------------|
| N2.1 | Erwarteter Zustand erreicht | Klappe … wurde **geöffnet** / **geschlossen** |
| N2.2 | Nicht erreicht / Button-Aufruf fehlgeschlagen | Klappe … konnte **nicht** geöffnet/geschlossen werden … Zustand … |

### 9.3 Störung (Scheduler, ca. 45 s)

| ID | Situation | Zu prüfender Meldungsinhalt (Auszug) |
|----|-----------|--------------------------------------|
| N2b.1 | Status oder Zustand wechselt auf Text mit **Störung** | **STÖRUNG:** Klappe … |
| N2b.2 | Option **Benachrichtigung bei Störung** aus | Kein Störungs-Push (andere Meldungen unverändert) |

### 9.4 Notify-Empfänger und Test

| ID | Test | Schritte | Erwartung |
|----|------|----------|-----------|
| N3.1 | Empfänger leer | Keine Notify-Ziele eintragen, sonst auslösbares Ereignis erzeugen | **Keine** Benachrichtigung; **Scheduler-Logik** läuft weiter, soweit sinnvoll |
| N3.2 | Empfänger gesetzt | Gültige `notify`-Ziele eintragen | Meldungen kommen beim konfigurierten Dienst an |
| N3.3 | Testbutton | **Testbutton** in der UI (Sicherheit/Notify) | Testbenachrichtigung wird zugestellt |

---

## 10. Abgrenzung und Dokumentation

| ID | Test | Erwartung |
|----|------|-----------|
| T10.1 | Add-on ersetzt keine Hardware-Not-Aus | Dokumentation/Realität: physische Sicherheit bleibt maßgeblich |
| T10.2 | Entity-Namen | Setup-Entities stimmen mit HA-Gerätenamen überein (keine „stummen“ Fehler) |

---

## Protokollvorlage (kurz)

| Test-ID | Datum | Version Add-on | Ergebnis | Bemerkung |
|---------|-------|----------------|----------|-----------|
| T… | | | OK / NOK | |

---

*Abgeleitet aus: `Bedienungsanleitung.md` — HK Addon.*
