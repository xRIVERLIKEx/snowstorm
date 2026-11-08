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
(function () {
	'use strict';
	if (window.parent === window) return; // not embedded: nothing to do

	var BRIDGE_VERSION = '1.0.0';
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
