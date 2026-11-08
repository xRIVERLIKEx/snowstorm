Claude
Created 2 files, shared a file, and 15 more steps
v2.0.1 is ready: students can now get their particle straight from Snowstorm instead of exporting and re-uploading it.

What changed from v2.0.0 (nothing else):

Snowstorm Editor: it now loads your copy of Snowstorm. Under it are a Use this particle button and a status line, which shows “✅ Connected” or, if Snowstorm can’t load, tells students to export and upload instead.
Step 2: a new Option A: From Snowstorm with a Get my particle button. Upload File and Paste Code are now Options B and C and work exactly as before.
Pictures: if the student uploaded their own picture in Snowstorm, it fills the texture slot automatically. It shows as a green “Picture from Snowstorm” card, so there’s nothing to upload.
Helpful messages: clicking the button before Step 1 says to fill out Step 1 first. Clicking it after adding a particle says to click “Add Another Particle” first.
How I checked it: I made the same particle and picture both ways in a headless browser: the new button, and the old export-and-upload. Both produced identical packs, with the pictures compared pixel by pixel because Snowstorm re-saves the PNG. I also confirmed the clear message when Snowstorm can’t load and that no page errors occur.

Not changed yet: a particle using one of Minecraft’s built-in textures still asks for an upload. That’s the next step, v2.0.2.

Please try it against your live fork:

Make a particle with your own picture.
Fill out Step 1.
Click Use this particle.
Build the pack and check that it imports in Minecraft Education.
I’ve added v2.0.0 as a working checkpoint in the project notes, along with the v2.0.1 details.


Particle packer findings
Document·MD 
Particle packer v2.0.1
Code
·HTML
everything works

Shared a file, read a file, and 11 more steps
v2.0.2 is ready. Particles that use one of Minecraft’s own particle textures no longer ask for an upload. I’ve logged v2.0.1 as a working checkpoint in the project notes.

What changed from v2.0.1 (nothing else):

No upload for built-in textures. These are the five textures Snowstorm can preview: textures/particle/particles, both flame_atlas paths, soul and campfire_smoke. The pack keeps that path as it is and adds no picture file, so Minecraft uses its own picture.
A new card in Step 3 says “✅ Minecraft texture: … Minecraft already has this texture. Nothing to upload.” It has a Use my own picture instead link, which brings back the normal upload for that texture, exactly as before.
Snowstorm’s “Get my particle” tells the two cases apart. If the student added their own picture in Snowstorm, it’s packed as in v2.0.1, even when the path is a built-in one. If not, the path is kept and nothing is packed.
Any other texture path still needs a picture, as before. That includes Snowstorm’s export default, textures/blocks/wool_colored_white, which it uses when the path is left empty.
How I checked it (headless):

A built-in-texture particle through “Get my particle” and through Upload File: no upload asked, path kept, no picture in the pack. The two packs were identical.
Use my own picture instead plus an upload: the pack was identical to v2.0.1’s.
The v2.0.1 own-picture check still matches export-and-upload.
No page errors.
Please check in Minecraft Education: make a particle with textures/particle/particles (Snowstorm’s default) and no picture of your own. Confirm it shows Minecraft’s built-in particle picture in game, not the missing-texture checkerboard.

Next is v2.0.3: each pack gets its own particle namespace.


Particle packer findings
Document·MD 
Particle packer v2.0.2
Code
·HTML
1794180782419_image.png
I have a particle selected in snowstorm but it is not showing in the preview

Edited 2 files, shared a file, and 27 more steps
Good catch. This is a bug in Snowstorm itself, not in the Packer or the bridge. I reproduced it on an unmodified copy of Snowstorm’s latest version (3.3.2, released Nov 5).

What’s happening: clicking a Quick Setup sprite (Ball, Leaves, Sparkle…) makes Snowstorm crash partway through. The step that applies the sprite picture never runs, so the preview keeps the “missing texture” squares you saw.

The fix: an updated cleverlike-bridge.js (version 1.0.1). It works around the bug in your copy of Snowstorm without changing any of Snowstorm’s own files. Once Jannis fixes it upstream, the workaround simply stops mattering.

I found and fixed a second problem along the way: Snowstorm applies sprites in a way the bridge didn’t recognize. Version 1.0.1 now treats Quick Setup sprites and pictures painted in Snowstorm’s texture editor as the student’s own picture. “Use this particle” packs them like an uploaded picture.

How I checked it:

Clicking Leaves now shows the leaves in the preview, with no error.
“Use this particle” in v2.0.2 put a picture in the pack that matches the Leaves sprite pixel for pixel.
The six hand-off checks and the v2.0.1 and v2.0.2 tests all still pass.
To update: in your fork on GitHub, upload cleverlike-bridge.js to replace the old one. That’s the only file that changed. Then reload the Packer, which keeps v2.0.2 as is.

Three things to flag:

Snowstorm’s own site. Can you try a Quick Setup sprite on snowstorm.app? If it fails there too, it’s worth reporting to Jannis; it fits naturally into the email you’re planning to send him.
Sprite licensing. Since sprites now go into student packs, ask Jannis whether that’s okay on a commercial platform. Snowstorm shows a CC icon next to the Sprite section.
Blank Identifier. When the Identifier is left blank, the particle ends up named cleverlike:particles.particle, with an odd texture file name. The original tool did the same, so I’ll handle it in v2.0.3 along with the namespace change.
I’ve updated the project notes with the bug details, bridge 1.0.1, and these open questions.


Particle packer findings
Document·MD 
Cleverlike bridge
JS



Claude is AI and can make mistakes.
Cleverlike bridge · JS
/*
 * Cleverlike bridge for Snowstorm
 * Copyright (C) 2026 Cleverlike
 *
 * This file is part of a fork of Snowstorm (https://github.com/JannisX11/snowstorm)
 * and is licensed under the GNU General Public License v3.0 or later, like Snowstorm.
 * See LICENSE in this repository.
 *
 * What it does: lets the page that embeds Snowstorm in an iframe ask for the
 * particle the student is working on, or send a particle in. It only answers
 * the page that directly embeds it (window.parent), and only when asked.
 *
 * It uses two functions Snowstorm already provides for its own sub-effect windows:
 *   window.generateFileForParentEffect()            -> particle JSON (string)
 *   window.loadFileFromParentEffect(json, imageUrl) -> load a particle (+ texture)
 *
 * Messages in (from the embedding page):
 *   { source: "cleverlike", bridge: "snowstorm", v: 1, id, type, ...args }
 *   type "ping"          -> { bridgeVersion, capabilities }
 *   type "getParticle"   -> { json, identifier, texture }
 *   type "loadParticle"  args { json, textureDataUrl?, textureName? } -> { identifier }
 *                        (no textureDataUrl = clear any picture left from the last particle)
 *   type "watch"         args { on: true|false, intervalMs? } -> later "changed" events
 * Messages out:
 *   { source: "cleverlike-snowstorm-bridge", v: 1, id, type: "result"|"error", ... }
 *   { source: "cleverlike-snowstorm-bridge", v: 1, type: "ready", bridgeVersion, capabilities }
 *   { source: "cleverlike-snowstorm-bridge", v: 1, type: "changed", identifier }
 *
 * texture = { kind: "custom",  path, name, dataUrl, width, height }  picture to pack
 *         | { kind: "vanilla", path }                               Minecraft already has it
 *         | { kind: "none",    path }                               path Minecraft may not have, no picture
 */
/*
 * Fix for a Snowstorm 3.3.x bug (applies whether embedded or not):
 * Quick Setup sprites (Ball, Leaves, Sparkle…) set number fields from code. Snowstorm's
 * Input.change() then reads e.target.value with no event, throws, and stops before the
 * sprite picture is applied, so the preview keeps the "missing texture" picture.
 * We give those calls a harmless stand-in event whose value passes the range check, so the
 * number branch changes nothing and the rest of change() runs as Snowstorm intends.
 * Once Snowstorm fixes this, the wrapper does nothing different.
 */
(function () {
	'use strict';
	function findNumberInput(node, depth) {
		if (!node || typeof node !== 'object' || depth > 4) return null;
		if (node.type === 'number' && typeof node.change === 'function') return node;
		for (var k in node) {
			if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
			var hit = findNumberInput(node[k], depth + 1);
			if (hit) return hit;
		}
		return null;
	}
	var tries = 0;
	(function patch() {
		var input = window.Data && findNumberInput(window.Data, 0);
		if (!input) { if (++tries < 300) setTimeout(patch, 100); return; }
		var proto = Object.getPrototypeOf(input);
		if (proto.__cleverlikeNumberFix) return;
		var original = proto.change;
		proto.change = function (e, node) {
			if (this.type === 'number' && !(e && e.target)) {
				var safe = typeof this.min === 'number' ? this.min : 0;
				if (typeof this.max === 'number' && safe > this.max) safe = this.max;
				e = { target: { value: String(safe) } }; // not a real Event, so Snowstorm doesn't log it as an edit
			}
			return original.call(this, e, node);
		};
		proto.__cleverlikeNumberFix = true;
	})();
})();
 
(function () {
	'use strict';
	if (window.parent === window) return; // not embedded: nothing to do
 
	var BRIDGE_VERSION = '1.0.1';
	var CAPABILITIES = ['ping', 'getParticle', 'loadParticle', 'watch'];
	var OUT = 'cleverlike-snowstorm-bridge';
	var parentOrigin = null; // learned from the first message; replies go only there
	var watchTimer = null;
	var lastSnapshot = null;
 
	function post(msg, origin) {
		msg.source = OUT;
		msg.v = 1;
		try { window.parent.postMessage(msg, origin || parentOrigin || '*'); } catch (e) { /* parent gone */ }
	}
 
	function appReady() {
		return typeof window.generateFileForParentEffect === 'function' &&
			typeof window.loadFileFromParentEffect === 'function' &&
			window.Emitter && window.Emitter.config;
	}
 
	function whenAppReady(timeoutMs) {
		return new Promise(function (resolve, reject) {
			var start = Date.now();
			(function check() {
				if (appReady()) return resolve();
				if (Date.now() - start > timeoutMs) return reject(new Error('Snowstorm did not finish starting.'));
				setTimeout(check, 100);
			})();
		});
	}
 
	function currentJsonString() {
		return window.generateFileForParentEffect();
	}
 
	function identifierOf(json) {
		try { return json.particle_effect.description.identifier || ''; } catch (e) { return ''; }
	}
 
	function texturePath(json) {
		try {
			return json.particle_effect.description.basic_render_parameters.texture || '';
		} catch (e) { return ''; }
	}
 
	function imageToPng(img) {
		return new Promise(function (resolve, reject) {
			function draw() {
				try {
					var w = img.naturalWidth, h = img.naturalHeight;
					if (!w || !h) return reject(new Error('The texture has no size.'));
					var c = document.createElement('canvas');
					c.width = w; c.height = h;
					c.getContext('2d').drawImage(img, 0, 0);
					resolve({ dataUrl: c.toDataURL('image/png'), width: w, height: h });
				} catch (e) { reject(e); }
			}
			if (img.complete && img.naturalWidth) draw();
			else {
				img.addEventListener('load', draw, { once: true });
				img.addEventListener('error', function () { reject(new Error('The texture could not be read.')); }, { once: true });
			}
		});
	}
 
	function getTexture(json) {
		var config = window.Emitter.config;
		var path = texturePath(json);
		var category = config.texture_source_category; // 'loaded' | 'built_in' | 'placeholder'
		// Quick Setup sprites and pictures painted in Snowstorm's texture editor go straight onto
		// the preview (window.tex is Snowstorm's texture editor) without changing the category.
		var tex = window.tex;
		if (tex && tex.internal_changes && tex.source) category = 'loaded';
		if (category === 'built_in') return Promise.resolve({ kind: 'vanilla', path: path });
		if (category !== 'loaded' || !config.texture || !config.texture.image) {
			return Promise.resolve({ kind: 'none', path: path });
		}
		var name = '';
		try { name = window.Data.texture.texture.inputs.image.image.name || ''; } catch (e) { /* ignore */ }
		return imageToPng(config.texture.image).then(function (png) {
			return { kind: 'custom', path: path, name: name || 'texture.png', dataUrl: png.dataUrl, width: png.width, height: png.height };
		});
	}
 
	var handlers = {
		ping: function () {
			return Promise.resolve({ bridgeVersion: BRIDGE_VERSION, capabilities: CAPABILITIES });
		},
		getParticle: function () {
			var json = JSON.parse(currentJsonString());
			return getTexture(json).then(function (texture) {
				return { json: json, identifier: identifierOf(json), texture: texture };
			});
		},
		loadParticle: function (msg) {
			var json = msg.json;
			if (typeof json === 'string') json = JSON.parse(json);
			if (!json || !json.particle_effect) throw new Error('That is not a particle file.');
			var tex = msg.textureDataUrl;
			if (tex && !/^data:image\/png;base64,/.test(tex)) throw new Error('The texture must be a PNG data URL.');
			window.loadFileFromParentEffect(JSON.stringify(json), tex || undefined);
			var imageInput = window.Data && window.Data.texture.texture.inputs.image;
			if (imageInput) {
				if (tex) imageInput.image.name = String(msg.textureName || 'texture.png').slice(0, 100);
				else if (imageInput.image.loaded) imageInput.reset(); // don't keep the previous particle's picture
			}
			lastSnapshot = null;
			return { identifier: identifierOf(json) };
		},
		watch: function (msg) {
			if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
			if (msg.on) {
				var every = Math.max(500, Math.min(10000, Number(msg.intervalMs) || 1000));
				lastSnapshot = currentJsonString() + '|' + (window.Emitter.config.texture.image.src || '').length;
				watchTimer = setInterval(function () {
					var snap;
					try { snap = currentJsonString() + '|' + (window.Emitter.config.texture.image.src || '').length; } catch (e) { return; }
					if (snap !== lastSnapshot) {
						lastSnapshot = snap;
						var id = '';
						try { id = identifierOf(JSON.parse(snap.slice(0, snap.lastIndexOf('|')))); } catch (e) { /* ignore */ }
						post({ type: 'changed', identifier: id });
					}
				}, every);
			}
			return { watching: !!watchTimer };
		}
	};
 
	window.addEventListener('message', function (event) {
		if (event.source !== window.parent) return; // only the page that embeds us
		var msg = event.data;
		if (!msg || msg.source !== 'cleverlike' || msg.bridge !== 'snowstorm') return;
		parentOrigin = event.origin === 'null' ? '*' : event.origin; // local files have origin "null"
		var origin = parentOrigin;
		var handler = handlers[msg.type];
		if (!handler) { post({ id: msg.id, type: 'error', message: 'Unknown request: ' + msg.type }, origin); return; }
		whenAppReady(15000)
			.then(function () { return handler(msg); })
			.then(function (result) {
				result = result || {};
				result.id = msg.id; result.type = 'result';
				post(result, origin);
			})
			.catch(function (err) {
				post({ id: msg.id, type: 'error', message: (err && err.message) || String(err) }, origin);
			});
	});
 
	// Say hello once Snowstorm is up, so the host page knows the bridge is here.
	whenAppReady(30000).then(function () {
		post({ type: 'ready', bridgeVersion: BRIDGE_VERSION, capabilities: CAPABILITIES }, '*');
	}).catch(function () { /* host page will time out and say so */ });
})();

