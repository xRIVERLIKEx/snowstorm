# Cleverlike copy of Snowstorm

This is a fork of [Snowstorm](https://github.com/JannisX11/snowstorm) by JannisX11, licensed under the GNU GPL v3.0 or later (see `LICENSE`).

Our only changes:

1. **`cleverlike-bridge.js`** (new, GPL-3.0-or-later). When Snowstorm is embedded in another page, that page can ask for the current particle (JSON + picture) or send a particle in. It only answers the page that embeds it, and only when asked.
   Since bridge 1.0.1 it also works around a Snowstorm 3.3.x bug: picking a Quick Setup sprite (Ball, Leaves, Sparkle…) threw an error (`Cannot read properties of undefined (reading 'target')` in `Input.change`) and the preview kept the missing-texture picture. The workaround does nothing once Snowstorm fixes this.
   Since bridge 1.1.0 the embedding page can also read and set single Snowstorm boxes (for example Motion → Offset) and highlight a box so students can see where a value goes. Used by the Particle Packer's Motion Lab.
   Since bridge 1.1.1: the highlight is drawn inside the row (tags X / Y / Z on three-part boxes, in the preview's axis colours); the lab can draw a numbered block column and a target star in the 3D preview (`showGuide`); and when Snowstorm opened in its narrow phone layout (no 3D preview) because its frame was under 720 px wide at load, it switches back to the normal layout once the frame is 560 px or wider.
   Since bridge 1.1.2: the lab's target can be an outline picture (fit the particle in like a puzzle piece) that turns green when reached, the lab can point at things in the preview with an arrow and a word, rows can show a short explanation bubble, and `getJson` lets the lab notice changes outside the current step and put the particle back.
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
| `getFields` (1.1.0) | `ids` (Snowstorm input ids) | `fields` `{id: value}` |
| `setFields` (1.1.0) | `fields` `[[id, value], …]`, applied in order | `fields` |
| `showField` (1.1.0) | `field` (input id), `axis?` (0/1/2); `field: null` clears | opens that tab and highlights the row (and that box): `shown`, `label` |
| `showGuide` (1.1.1) | `ruler?` (blocks), `star?` (height), `frame?`; `{}` clears | draws a numbered block column and a target star in the preview |
| `showGuide` (1.1.2) | also `targetImage` (PNG data URL), `targetSize`, `hit`, `pointer {at: "emitter"\|"block"\|[x,y,z], label, size}` | outline target, green when hit; an arrow with a word |
| `showField` (1.1.2) | also `note` (text, `**bold**` allowed) | a small explanation bubble under the row |
| `getJson` (1.1.2) | – | `json` (the particle file as text, no picture) |

Input ids are Snowstorm's own, e.g. `particle_motion_mode` (`dynamic`/`parametric`/`static`) and `particle_motion_relative_position` (`["x", "y", "z"]`, Molang text).

Every request: `{ source: "cleverlike", bridge: "snowstorm", v: 1, id, type, ... }`. Replies: `{ source: "cleverlike-snowstorm-bridge", v: 1, id, type: "result" | "error", ... }`. On start the bridge also sends `{ type: "ready" }`.

`texture.kind`: `custom` (a picture to put in the pack, as `dataUrl`), `vanilla` (Minecraft already has it: `textures/particle/particles`, `flame_atlas`, `soul`, `campfire_smoke`), or `none` (a path with no picture).
