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
 *   type "showGuide"     args { star?: y, ruler?: blocks, frame?: true } -> draws helpers in the   (1.1.1)
 *                        3D preview: a column of numbered blocks next to the emitter and a target
 *                        star at height y. {} removes them. frame moves the camera so 0..ruler fits.
 *                        1.1.2: targetImage (PNG data URL, drawn pixel-sharp instead of the star),
 *                        targetSize (blocks), hit (target turns green and pulses),
 *                        pointer { at: "emitter" | "block" | [x,y,z], label } (an arrow with a word).
 *   type "showField"     1.1.2: note (text) shows a small explanation bubble under the row.
 *   type "getJson"       -> { json } the particle file only, no picture (cheap to ask often)       (1.1.2)
 *   1.1.3: loadParticle first clears Snowstorm like File > New, so boxes that aren't in the file
 *          (an empty Direction, say) don't keep old values.
 *   1.1.4: showField { focus: true } puts the cursor in that box with its text selected, and the
 *          highlight pulse starts again each time (so "find the box" visibly does something).
 *   1.1.5: a note about one box (axis given) sits under that box and its arrow points at it;
 *          a note about the whole row still points at the row's name.
 *   type "getParticles"  -> { list: [[age, x, y, z, lifetime], …] } the live particles in the preview  (1.2.0)
 *                        (at most 120), so a lesson can wait until a real particle reaches a goal.
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

	var BRIDGE_VERSION = '1.2.0';
	var CAPABILITIES = ['ping', 'getParticle', 'loadParticle', 'watch', 'getFields', 'setFields', 'showField', 'showGuide', 'guideV2', 'getJson', 'cleanLoad', 'focusField', 'getParticles'];
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
			// the whole row: soft yellow wash and a bar on the left (nothing drawn outside the row, so nothing gets cut off)
			'.cleverlike-hl{background:rgba(255,200,0,0.16)!important;box-shadow:inset 4px 0 0 #ffc800;animation:cleverlike-pulse 1s ease-in-out 3}' +
			'@keyframes cleverlike-pulse{50%{background:rgba(255,200,0,0.34)}}' +
			// the one box to type in: a ring drawn inside the box, above its contents
			'.cleverlike-hl-axis{position:relative}' +
			'.cleverlike-hl-axis::after{content:"";position:absolute;inset:0;border:3px solid #ffc800;border-radius:3px;pointer-events:none;z-index:3}' +
			// X / Y / Z tags on each box of the row, in the preview's axis colours
			'.cleverlike-axes .input_vector{position:relative}' +
			'.cleverlike-axes .input_vector::before{content:attr(data-cleverlike-axis);position:absolute;right:4px;top:50%;transform:translateY(-50%);z-index:4;pointer-events:none;' +
			'font:800 11px/1 system-ui,sans-serif;padding:3px 5px;border-radius:4px;color:#fff}' +
			'.cleverlike-axes .input_vector[data-cleverlike-axis="X"]::before{background:#d9363e}' +
			'.cleverlike-axes .input_vector[data-cleverlike-axis="Y"]::before{background:#3a9c2c}' +
			'.cleverlike-axes .input_vector[data-cleverlike-axis="Z"]::before{background:#2f6fde}' +
			'.cleverlike-hl{position:relative}' +
			'.cleverlike-note{position:absolute;left:8px;width:max-content;max-width:min(260px,calc(100% - 16px));top:calc(100% + 6px);z-index:20;background:#fff4c2;color:#1d1a10;border-radius:8px;padding:7px 10px;' +
			'font:600 12.5px/1.35 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.45);pointer-events:none}' +
			'.cleverlike-note b{font-weight:800}' +
			'.cleverlike-note::before{content:"";position:absolute;left:var(--cleverlike-arrow,22px);top:-6px;border:6px solid transparent;border-top:0;border-bottom-color:#fff4c2}';
		document.head.appendChild(st);
	}
	function clearHighlight() {
		var notes = document.querySelectorAll('.cleverlike-note');
		for (var n = 0; n < notes.length; n++) notes[n].parentNode.removeChild(notes[n]);
		var old = document.querySelectorAll('.cleverlike-hl, .cleverlike-hl-axis, .cleverlike-axes');
		for (var i = 0; i < old.length; i++) old[i].classList.remove('cleverlike-hl', 'cleverlike-hl-axis', 'cleverlike-axes');
	}
	function openTab(tab) {
		var sidebar = document.getElementById('sidebar');
		var vm = sidebar && sidebar.__vue__;
		if (vm && typeof vm.selectSubject === 'function') { vm.selectSubject(tab); return; }
		var keys = Object.keys(window.Data), tabs = document.querySelectorAll('.sidebar_tab'), i = keys.indexOf(tab);
		if (tabs[i]) tabs[i].click();
	}
	function showField(id, axis, note, focus) {
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
				void li.offsetWidth; // restart the pulse animation even if this row was highlighted a moment ago
				li.classList.add('cleverlike-hl');
				var target = li;
				var boxes = li.querySelectorAll('.input_vector');
				if (boxes.length === 3) {
					li.classList.add('cleverlike-axes');
					for (var b = 0; b < 3; b++) boxes[b].setAttribute('data-cleverlike-axis', 'XYZ'[b]);
				}
				if (axis != null && boxes[axis]) { boxes[axis].classList.add('cleverlike-hl-axis'); target = boxes[axis]; }
				if (focus && axis != null && boxes[axis]) {
					var ta = boxes[axis].querySelector('textarea, input');
					if (ta) { try { ta.focus(); ta.select(); } catch (e) { /* ignore */ } }
				}
				if (note) {
					var bubble = document.createElement('div');
					bubble.className = 'cleverlike-note';
					var parts = String(note).split('**');
					parts.forEach(function (txt, k) { if (k % 2) { var b = document.createElement('b'); b.textContent = txt; bubble.appendChild(b); } else bubble.appendChild(document.createTextNode(txt)); });
					li.appendChild(bubble);
					// under the box it's about, arrow on the box's middle; kept inside the row
					var lr = li.getBoundingClientRect();
					var aim = (axis != null && boxes[axis]) ? boxes[axis].getBoundingClientRect() : (li.querySelector('label') || li).getBoundingClientRect();
					var mid = aim.left + aim.width / 2 - lr.left, bw = bubble.offsetWidth;
					var left = Math.max(4, Math.min(lr.width - bw - 4, mid - 34));
					bubble.style.left = left + 'px';
					bubble.style.setProperty('--cleverlike-arrow', Math.max(8, Math.min(bw - 20, mid - left - 6)) + 'px');
				}
				// scroll only the sidebar's own list, never the page around it
				var sc = li.parentElement;
				while (sc && sc !== document.body && !(sc.scrollHeight > sc.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
				if (sc && sc !== document.body) {
					var r = li.getBoundingClientRect(), sr = sc.getBoundingClientRect();
					sc.scrollTop += (r.top - sr.top) - (sc.clientHeight / 2 - r.height / 2);
				}
				resolve({ shown: true, tab: f.tab, label: f.input.label || '' });
			})();
		});
	}

	// ---- 1.1.1: helpers drawn in the 3D preview (a numbered block column and a target star)
	// THREE isn't global in Snowstorm, so the classes are taken from objects already in its scene.
	var guide = null, guideCamera = null;
	function sceneRoot() { var o = window.Emitter.scene.space; while (o.parent) o = o.parent; return o; }
	function threeKit() {
		var root = sceneRoot(), kids = root.children;
		var lines = kids.filter(function (c) { return c.type === 'LineSegments'; })[0];
		var mesh = kids.filter(function (c) { return c.type === 'Mesh'; })[0];
		var group = kids.filter(function (c) { return c.type === 'Object3D'; })[0];
		var map = window.Emitter.material && window.Emitter.material.uniforms && window.Emitter.material.uniforms.map && window.Emitter.material.uniforms.map.value;
		if (!lines || !mesh || !group || !map) throw new Error('The preview is not ready.');
		return { root: root, LineSegments: lines.constructor, BufferGeometry: lines.geometry.constructor, LineMaterial: lines.material.constructor,
			Attr: lines.geometry.attributes.position.constructor, Mesh: mesh.constructor, Box: mesh.geometry.constructor,
			BasicMaterial: mesh.material.constructor, Group: group.constructor, Texture: map.constructor };
	}
	function canvasTexture(K, draw, w, h) {
		var c = document.createElement('canvas'); c.width = w; c.height = h;
		draw(c.getContext('2d'), w, h);
		var tx = new K.Texture(c); tx.needsUpdate = true; return tx;
	}
	function billboard(K, tex, size, aspect) {
		var m = new K.Mesh(new K.Box(size * (aspect || 1), size, 0.001), new K.BasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
		m.renderOrder = 999;
		m.onBeforeRender = function (renderer, scene, camera) { guideCamera = camera; this.quaternion.copy(camera.quaternion); this.updateMatrixWorld(true); };
		return m;
	}
	function clearGuide() {
		if (!guide) return;
		guide.parent && guide.parent.remove(guide);
		guide.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
		guide = null;
	}
	function showGuide(msg) {
		clearGuide();
		var blocks = Math.max(0, Math.min(16, Math.round(Number(msg.ruler) || 0)));
		var star = msg.star == null ? null : Number(msg.star);
		var pointer = msg.pointer && msg.pointer.at ? msg.pointer : null;
		if (!blocks && star == null && !pointer) return { shown: false };
		var K = threeKit();
		guide = new K.Group(); guide.name = 'cleverlike-guide';
		// the column stands just left of the emitter as seen from Snowstorm's starting camera (which looks along +x +z)
		var CX = 1.25, CZ = -1.25;
		if (blocks) {
			// block outlines: one cube per level, like a stack of Minecraft blocks
			var pts = [];
			function seg(a, b) { pts.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
			for (var i = 0; i < blocks; i++) {
				var x0 = CX - 0.5, x1 = CX + 0.5, z0 = CZ - 0.5, z1 = CZ + 0.5, y0 = i, y1 = i + 1;
				[[x0, z0], [x1, z0], [x1, z1], [x0, z1]].forEach(function (c, k, all) {
					var n = all[(k + 1) % 4];
					seg([c[0], y0, c[1]], [n[0], y0, n[1]]); seg([c[0], y1, c[1]], [n[0], y1, n[1]]); seg([c[0], y0, c[1]], [c[0], y1, c[1]]);
				});
			}
			var g = new K.BufferGeometry(); g.setAttribute('position', new K.Attr(new Float32Array(pts), 3));
			var col = new K.LineSegments(g, new K.LineMaterial({ color: 0x7fd36b, transparent: true, opacity: 0.75 }));
			guide.add(col);
			// a green line straight up from the emitter: the Y direction
			var g2 = new K.BufferGeometry(); g2.setAttribute('position', new K.Attr(new Float32Array([0, 0, 0, 0, blocks + 0.6, 0]), 3));
			guide.add(new K.LineSegments(g2, new K.LineMaterial({ color: 0x3a9c2c, transparent: true, opacity: 0.5, depthTest: false })));
			for (var j = 0; j <= blocks; j++) {
				var lab = billboard(K, canvasTexture(K, (function (txt) { return function (ctx, w, h) {
					ctx.font = 'bold 44px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
					ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(txt, w / 2, h / 2); ctx.fillStyle = '#ffffff'; ctx.fillText(txt, w / 2, h / 2);
				}; })(String(j)), 64, 64), 0.55);
				lab.position.set(CX + 0.75, j, CZ - 0.75);
				guide.add(lab);
			}
			var yl = billboard(K, canvasTexture(K, function (ctx, w, h) {
				ctx.fillStyle = '#3a9c2c'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); ctx.fill();
				ctx.font = 'bold 40px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('Y', w / 2, h / 2 + 2);
			}, 64, 64), 0.42);
			yl.position.set(0, blocks + 0.9, 0);
			guide.add(yl);
		}
		if (star != null && isFinite(star) && typeof msg.targetImage === 'string' && /^data:image\/png;base64,/.test(msg.targetImage)) {
			// the target is an outline of the particle's own picture: fit the sparkle in like a puzzle piece
			var img = new Image(), ttex = new K.Texture(img);
			ttex.magFilter = 1003; ttex.minFilter = 1003; // NearestFilter: keep pixel art sharp
			img.onload = function () { ttex.needsUpdate = true; };
			img.src = msg.targetImage;
			var size = Math.max(0.2, Math.min(4, Number(msg.targetSize) || 1));
			var tm = new K.Mesh(new K.Box(size, size, 0.001), new K.BasicMaterial({ map: ttex, transparent: true, depthTest: false, depthWrite: false }));
			tm.renderOrder = 998;
			if (msg.hit) tm.material.color.setHex(0x5be06a);
			var born = performance.now();
			tm.onBeforeRender = function (renderer, scene, camera) {
				guideCamera = camera; this.quaternion.copy(camera.quaternion);
				var sc = msg.hit ? 1 + 0.12 * Math.sin((performance.now() - born) / 120) * Math.max(0, 1 - (performance.now() - born) / 1500) : 1;
				this.scale.set(sc, sc, sc);
				this.updateMatrixWorld(true);
			};
			tm.position.set(0, star, 0);
			guide.add(tm);
		} else if (star != null && isFinite(star)) {
			var st = billboard(K, canvasTexture(K, function (ctx, w, h) {
				ctx.beginPath();
				for (var i = 0; i < 10; i++) { var a = Math.PI / 5 * i - Math.PI / 2, r = i % 2 ? w * 0.19 : w * 0.44; ctx.lineTo(w / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a)); }
				ctx.closePath(); ctx.lineWidth = 7; ctx.setLineDash([10, 7]); ctx.strokeStyle = '#ffd23f'; ctx.stroke();
			}, 128, 128), 1.6);
			st.position.set(0, star, 0);
			guide.add(st);
		}
		if (pointer) {
			var at = pointer.at === 'emitter' ? [0, 0, 0] : pointer.at === 'block' ? [CX, 0.5, CZ] : pointer.at;
			if (at instanceof Array && at.length === 3) {
				var label = String(pointer.label || '').slice(0, 40);
				var pw = 256, ph = 192;
				var ptex = canvasTexture(K, function (ctx, w, h) {
					// word on top, arrow pointing straight down to the thing
					ctx.font = 'bold 40px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
					var tw = Math.min(w - 8, ctx.measureText(label).width + 28);
					ctx.fillStyle = '#fff4c2'; ctx.beginPath();
					if (ctx.roundRect) ctx.roundRect((w - tw) / 2, 6, tw, 56, 14); else ctx.rect((w - tw) / 2, 6, tw, 56);
					ctx.fill(); ctx.fillStyle = '#1d1a10'; ctx.fillText(label, w / 2, 35);
					ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#7a5a00'; ctx.lineWidth = 4;
					ctx.beginPath(); ctx.moveTo(w / 2 - 14, 72); ctx.lineTo(w / 2 + 14, 72); ctx.lineTo(w / 2 + 14, 140); ctx.lineTo(w / 2 + 34, 140);
					ctx.lineTo(w / 2, h - 4); ctx.lineTo(w / 2 - 34, 140); ctx.lineTo(w / 2 - 14, 140); ctx.closePath(); ctx.fill(); ctx.stroke();
				}, pw, ph);
				var ph3 = Math.max(0.8, Math.min(4, Number(pointer.size) || 1.5)), pm = billboard(K, ptex, ph3, pw / ph);
				var pBorn = performance.now();
				pm.onBeforeRender = function (renderer, scene, camera) {
					guideCamera = camera; this.quaternion.copy(camera.quaternion);
					// sit just above the thing, bobbing gently so it catches the eye
					var bob = 0.12 * Math.sin((performance.now() - pBorn) / 260);
					var up = { x: 0, y: 1, z: 0 };
					this.position.set(at[0], at[1] + ph3 / 2 + 0.35 + bob, at[2]);
					this.updateMatrixWorld(true);
				};
				pm.position.set(at[0], at[1] + ph3 / 2 + 0.35, at[2]);
				guide.add(pm);
			}
		}
		sceneRoot().add(guide);
		if (msg.frame && blocks) {
			// back the camera off so the whole column fits; the student can still turn and zoom
			var tries = 0;
			(function frame() {
				if (!guideCamera) { if (++tries < 40) setTimeout(frame, 50); return; }
				// Snowstorm's camera always aims at (0, 0.8, 0), so back off until 0..blocks+1 fits (45° view)
				var d = (blocks + 0.7) * 2.45;
				guideCamera.position.set(-d * 0.69, 0.8 + d * 0.2, -d * 0.69);
			})();
		}
		return { shown: true };
	}

	// ---- 1.1.1: Snowstorm picks its phone layout once, when it loads, if it is under 720 px wide.
	// Inside our page it can load narrow (small window, page still laying out) and then stay without
	// its 3D preview even when there is plenty of room. Switch back whenever it's wide enough.
	function fixLayout() {
		var el = document.getElementById('app');
		var vm = el && el.__vue__ && (el.__vue__.portrait_view !== undefined ? el.__vue__ : el.__vue__.$children && el.__vue__.$children[0]);
		if (!vm || !vm.portrait_view || document.body.clientWidth < 560) return;
		var w = document.body.clientWidth;
		vm.portrait_view = false;
		vm.tab = 'preview';
		var saved = parseInt(localStorage.getItem('snowstorm_sidebar_width'), 10);
		vm.sidebar_width = saved ? Math.min(Math.max(saved, 160), w - 200) : Math.min(Math.max(w / 2, 160), Math.min(Math.max(180 + w * 0.2, 160), 660));
		window.Vue && window.Vue.nextTick ? window.Vue.nextTick(after) : setTimeout(after, 0);
		function after() {
			try { vm.$refs.preview.updateSize(); } catch (e) { /* ignore */ }
			try { vm.$refs.sidebar.updateSize(); } catch (e) { /* ignore */ }
			window.dispatchEvent(new Event('resize'));
		}
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
			// Snowstorm's parent-load skips File > New's reset, so values missing from the file would stay.
			// Reset first (no confirm dialog), then load.
			try { window.Emitter.config.unsupported_fields = {}; window.Emitter.config.reset(); } catch (e) { /* older Snowstorm: load anyway */ }
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
		getJson: function () { return { json: currentJsonString() }; },
		getParticles: function () {
			var r = function (n) { return Math.round(n * 1000) / 1000; };
			var list = (window.Emitter.particles || []).slice(0, 120).map(function (p) {
				return [r(p.age || 0), r(p.position.x), r(p.position.y), r(p.position.z), r(p.lifetime || 0)];
			});
			return { list: list };
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
		showGuide: function (msg) { return showGuide(msg); },
		showField: function (msg) {
			return showField(msg.field == null ? null : msg.field, msg.axis == null ? null : Number(msg.axis), msg.note ? String(msg.note).slice(0, 300) : '', !!msg.focus);
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
		fixLayout();
		window.addEventListener('resize', fixLayout);
		post({ type: 'ready', bridgeVersion: BRIDGE_VERSION, capabilities: CAPABILITIES }, '*');
	}).catch(function () { /* host page will time out and say so */ });
})();
