# Update zu Git (ha-addon-hk-app)

Kurzanleitung, damit Home Assistant das Add-on per **Version** und **Tag** als Update erkennt.

## Versionsquellen (immer zusammen anheben)

| Datei | Feld |
|--------|------|
| `hk_addon/config.yaml` | `version: "X.Y.Z"` — **maßgeblich für den HA Add-on Store** |
| `hk_addon/app/package.json` | `"version": "X.Y.Z"` |
| `CHANGELOG.md` | neuen Abschnitt `## [X.Y.Z] – JJJJ-MM-TT` |

- **patch** (0.2.8 → 0.2.9): Bugfixes, kleine Features  
- **minor** / **major**: bei größeren Änderungen bewusst wählen  

## Git-Remote

- **`ha-addon`** → `https://github.com/The88ers/ha-addon-hk-app.git` (Branch **`main`** für den Store)

Lokaler Arbeitsbranch kann z. B. `release/v0.2.8` heißen; gepusht wird auf `ha-addon` **main**:

```bash
cd "…\Projektordner Hühnerklappe"
git add hk_addon/config.yaml hk_addon/app/package.json CHANGELOG.md
git commit -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push ha-addon HEAD:main
git push ha-addon vX.Y.Z
```

Ohne Annotated Tag erkennt der Supervisor Updates ggf. nicht zuverlässig — **`git tag -a`** verwenden.

## Nach dem Push in Home Assistant

1. **Einstellungen → Add-ons → Add-on Store** → Repository aktualisieren („Nach Updates suchen“ / Aktualisieren).  
2. Add-on **HK Addon** → **Aktualisieren**.  
3. Wenn sich `Dockerfile` oder App-Code stark geändert hat: ggf. **Neu erstellen** (Rebuild).

## Monorepo (optional)

Remote **`monorepo`** zeigt auf `huehnerklappe-projekt` — nur nutzen, wenn dieser Ordner dort mitgeführt werden soll; der **HA Store** nutzt **`ha-addon-hk-app`** (`ha-addon`).
