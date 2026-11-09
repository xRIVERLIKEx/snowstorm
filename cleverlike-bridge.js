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
 *   type "getFields"     args { ids: [inputId, ...] } -> { fields: { inputId: value } }      (1.1.0)
 *   type "setFields"     args { fields: [[inputId, value], ...] } -> { fields }             (1.1.0)
 *                        (applied in order, so set a Mode before the boxes it shows)
 *   type "showField"     args { field, axis? } -> opens that box's tab and outlines it;       (1.1.0)
 *                        field null removes the outline
 *   inputId is Snowstorm's own input id, e.g. "particle_motion_mode",
 *   "particle_motion_relative_position" (value ["x", "y", "z"]).
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

	var BRIDGE_VERSION = '1.1.0';
	var CAPABILITIES = ['ping', 'getParticle', 'loadParticle', 'watch', 'getFields', 'setFields', 'showField'];
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

	// ---- 1.1.0: single boxes (used by the Motion Lab coach) ----
	// Snowstorm keeps every box as an Input in window.Data[tab][group].inputs[key].
	function findInput(id) {
		var data = window.Data;
		for (var tab in data) {
			if (!data[tab] || typeof data[tab] !== 'object') continue;
			for (var group in data[tab]) {
				var g = data[tab][group];
				if (!g || typeof g !== 'object' || !g.inputs) continue;
				for (var key in g.inputs) {
					if (g.inputs[key] && g.inputs[key].id === id) return { input: g.inputs[key], tab: tab, group: group, key: key, groupObj: g };
				}
			}
		}
		throw new Error('Snowstorm has no box called ' + id + '.');
	}
	function plain(v) { return v instanceof Array ? v.map(function (x) { return x == null ? '' : String(x); }) : v; }
	function readField(id) {
		var f = findInput(id), v = f.input.value;
		return plain(v);
	}
	function writeField(id, value) {
		var f = findInput(id), input = f.input;
		if (input.type === 'select' || input.type === 'select_custom') {
			if (!input.options || !Object.prototype.hasOwnProperty.call(input.options, value)) throw new Error(id + ' cannot be ' + value + '.');
			input.set(value);
		} else if (input.value instanceof Array) {
			if (!(value instanceof Array) || value.length !== input.value.length) throw new Error(id + ' needs ' + input.value.length + ' values.');
			input.set(value.map(function (x) { return String(x == null ? '' : x); }));
		} else {
			input.set(input.type === 'checkbox' ? !!value : String(value == null ? '' : value));
		}
		lastSnapshot = null;
		return plain(input.value);
	}
	var STYLE_ID = 'cleverlike-bridge-style';
	function ensureStyle() {
		if (document.getElementById(STYLE_ID)) return;
		var st = document.createElement('style');
		st.id = STYLE_ID;
		st.textContent =
			'.cleverlike-hl{outline:3px solid #ffc800;outline-offset:2px;border-radius:4px;animation:cleverlike-pulse 1.2s ease-in-out 3}' +
			'.cleverlike-hl-axis{box-shadow:0 0 0 3px #ffc800 inset;border-radius:3px}' +
			'@keyframes cleverlike-pulse{50%{outline-color:#ff8a00;outline-offset:5px}}';
		document.head.appendChild(st);
	}
	function clearHighlight() {
		var old = document.querySelectorAll('.cleverlike-hl, .cleverlike-hl-axis');
		for (var i = 0; i < old.length; i++) old[i].classList.remove('cleverlike-hl', 'cleverlike-hl-axis');
	}
	function openTab(tab) {
		var sidebar = document.getElementById('sidebar');
		var vm = sidebar && sidebar.__vue__;
		if (vm && typeof vm.selectSubject === 'function') { vm.selectSubject(tab); return; }
		var keys = Object.keys(window.Data), tabs = document.querySelectorAll('.sidebar_tab'), i = keys.indexOf(tab);
		if (tabs[i]) tabs[i].click();
	}
	function showField(id, axis) {
		clearHighlight();
		if (id == null) return Promise.resolve({ shown: false });
		var f = findInput(id);
		openTab(f.tab);
		f.groupObj._folded = false;
		ensureStyle();
		return new Promise(function (resolve) {
			var tries = 0;
			(function find() {
				var li = document.getElementById(f.tab + '-' + f.group + '-' + f.key);
				if ((!li || li.offsetParent === null) && ++tries < 20) return setTimeout(find, 50);
				if (!li || li.offsetParent === null) return resolve({ shown: false });
				li.classList.add('cleverlike-hl');
				var target = li;
				if (axis != null) {
					var boxes = li.querySelectorAll('.input_vector');
					if (boxes[axis]) { boxes[axis].classList.add('cleverlike-hl-axis'); target = boxes[axis]; }
				}
				try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { target.scrollIntoView(); }
				resolve({ shown: true, tab: f.tab, label: f.input.label || '' });
			})();
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
		},
		getFields: function (msg) {
			var out = {};
			(msg.ids || []).forEach(function (id) { out[id] = readField(id); });
			return { fields: out };
		},
		setFields: function (msg) {
			var out = {};
			(msg.fields || []).forEach(function (pair) { out[pair[0]] = writeField(pair[0], pair[1]); });
			return { fields: out };
		},
		showField: function (msg) {
			return showField(msg.field == null ? null : msg.field, msg.axis == null ? null : Number(msg.axis));
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
