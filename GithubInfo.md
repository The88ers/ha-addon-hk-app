# GitHub – Kurzinfos (Projekt HA ADDON HK APP)

## Repository

| | |
|---|---|
| **URL** | https://github.com/The88ers/ha-addon-hk-app |
| **Konto** | The88ers |
| **Sichtbarkeit** | privat |
| **Standard-Branch** | `main` |
| **Remote** | `origin` |

## GitHub CLI (`gh`) unter Windows

Auf diesem Rechner liegt die ausführbare Datei hier (falls `gh` im Terminal „nicht gefunden“ wird):

```
C:\Program Files\GitHub CLI\gh.exe
```

**Optional:** Ordner `C:\Program Files\GitHub CLI` zur Umgebungsvariable **PATH** hinzufügen, dann reicht der Befehl `gh` überall.

### Anmeldung prüfen

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth status
```

### Neues Remote-Repo (nur falls von vorn; hier schon erledigt)

```powershell
gh repo create <name> --private --source=. --remote=origin --push
```

## Tägliche Arbeit mit Git

Im Projektordner:

```powershell
git add .
git commit -m "Kurze Beschreibung der Änderung"
git push
```

Erstes Mal auf einem neuen Rechner: `git clone https://github.com/The88ers/ha-addon-hk-app.git`

## Git-Benutzer (Commits)

Für sinnvolle Commit-Metadaten (einmalig global):

```powershell
git config --global user.name "Dein Name"
git config --global user.email "deine@email"
```

GitHub-Noreply-Adresse (wenn du die private E-Mail nicht nutzen willst):  
`DEINUSERNAME@users.noreply.github.com` (unter GitHub → Settings → Emails einsehbar).

Nur für **dieses** Repo (ohne `--global`) geht ebenfalls – dann nur im jeweiligen Ordner `git config user.name` / `user.email`.

## Hinweis: Benutzername mit Umlaut

`%LOCALAPPDATA%` kann in manchen Skriptumgebungen falsch aufgelöst werden. Wenn `gh` unter `…\AppData\Local\Programs\GitHub CLI\` nicht gefunden wird, den Pfad unter **Program Files** oben verwenden.

## Automation / anderer Agent (Push)

GitHub erteilt keine separaten „Agenten-Rechten“. Push funktioniert dort, wo **du** schon mit `gh auth login` oder SSH/HTTPS angemeldet bist. Tokens nicht ins Repo oder in Chats legen.
