# Entity-Nomenklatur — Add-on-Baseline

## Verbindliche Referenz (Projektroot)

Alle Regeln, Tabellen und die **Status-Ausnahme** (`sensor.hkN_status_hkN`) stehen in:

**`../HOME ASSISTANT ENTITÄTEN.md`** (eine Ebene über diesem `hk_addon/`-Ordner; im Projektroot „Projektordner Hühnerklappe“).

Diese Datei hier ist nur der **Einstieg für Entwickler** und verweist auf die Baseline.

## Prüfung & Auto-Reparatur im Add-on

Die Logik in `app/www/liquid-glass-app.js` leitet Standard-IDs aus **`buildKlappeEntityDefaults(klappeId)`** ab und nutzt dieselben Muster in **`_buildEntityRepairCandidates`**. Änderungen an der Nomenklatur: zuerst **`HOME ASSISTANT ENTITÄTEN.md`** anpassen, dann Defaults und Reparatur-Kandidaten im Code synchron halten.

## Neue oder zusätzliche Klappen (HK4, …)

1. ESPHome-Gerätenamen und HA-IDs gemäß **`HOME ASSISTANT ENTITÄTEN.md`** (Schema `hkN_hkN_*`, Ausnahme Status).
2. Im Code: für die neue Klappen-ID `d` die Defaults über **`buildKlappeEntityDefaults('d')`** erzeugen und in **`getDefaultKlappenConfig()`** eintragen (Namen, Zentrale-Button, leere Felder wie bei HK2/HK3 nur dort, wo noch kein Gerät existiert).
3. Keine manuell erfundenen Kurz-IDs — immer mit der `.md` abgleichen.
