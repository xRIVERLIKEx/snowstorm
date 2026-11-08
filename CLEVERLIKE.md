# Cleverlike copy of Snowstorm

This is a fork of [Snowstorm](https://github.com/JannisX11/snowstorm) by JannisX11, licensed under the GNU GPL v3.0 or later (see `LICENSE`).

Our only changes:

1. **`cleverlike-bridge.js`** (new, GPL-3.0-or-later). When Snowstorm is embedded in another page, that page can ask for the current particle (JSON + picture) or send a particle in. It only answers the page that embeds it, and only when asked.
2. **`index.html`**: one `<script>` line after `dist/app.js` that loads the bridge.
3. **`CNAME` removed**, so GitHub Pages serves this copy at `https://xriverlikex.github.io/snowstorm/` instead of claiming snowstorm.app.

Everything else is Snowstorm, unchanged.

## Set it up (about 5 minutes)

1. Open https://github.com/JannisX11/snowstorm and click **Fork**. Owner: `xRIVERLIKEx`, name: `snowstorm`. Click **Create fork**.
2. In the fork, open `CNAME`, click the trash icon (**Delete file**), commit.
3. Click **Add file → Upload files**, drop in `cleverlike-bridge.js`, `index.html` and this `CLEVERLIKE.md`. Commit (it replaces `index.html`).
4. **Settings → Pages**: Source **Deploy from a branch**, Branch **master**, folder **/ (root)**. Save.
5. After a minute or two, open https://xriverlikex.github.io/snowstorm/ — Snowstorm should appear.
6. Open the Snowstorm Hand-off Test page and let the checks run.

## Keeping it up to date

When Snowstorm has a new version, open the fork on GitHub and click **Sync fork → Update branch**. Our changes are in their own file plus one line, so this normally goes through without conflicts. If GitHub reports a conflict in `index.html`, keep Snowstorm's new version and add the bridge line back after the `dist/app.js` line:

```html
<script src="./cleverlike-bridge.js" charset="utf-8"></script>
```

## Bridge messages (for our tools)

Send to the iframe with `iframe.contentWindow.postMessage(msg, "https://xriverlikex.github.io")`:

| type | send | get back |
|---|---|---|
| `ping` | – | `bridgeVersion`, `capabilities` |
| `getParticle` | – | `json`, `identifier`, `texture` |
| `loadParticle` | `json`, `textureDataUrl?` (PNG), `textureName?` | `identifier` (no picture = clears the old one) |
| `watch` | `on`, `intervalMs?` | later `{type: "changed"}` events |

Every request: `{ source: "cleverlike", bridge: "snowstorm", v: 1, id, type, ... }`. Replies: `{ source: "cleverlike-snowstorm-bridge", v: 1, id, type: "result" | "error", ... }`. On start the bridge also sends `{ type: "ready" }`.

`texture.kind`: `custom` (a picture to put in the pack, as `dataUrl`), `vanilla` (Minecraft already has it: `textures/particle/particles`, `flame_atlas`, `soul`, `campfire_smoke`), or `none` (a path with no picture).
