// Isolated browser-API doubles: never signs in or calls the live database.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../chat-waves.js', import.meta.url), 'utf8');
function harness(options = {}) {
  const events = () => {
    const handlers = new Map();
    return { handlers, addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); }, removeEventListener(name, fn) { handlers.get(name)?.delete(fn); }, fire(name, event = {}) { for (const fn of [...handlers.get(name) || []]) fn(event); } };
  };
  const stats = { contexts: 0, draws: 0, lost: 0, shaders: new Set(), programs: new Set(), buffers: new Set(), vaos: new Set(), sources: [], uniforms: new Map(), writes: [] };
  const frames = new Map(), observers = [], items = new Map(options.still ? [['space.chat-waves.v1', 'still']] : []);
  let frameId = 0, liveHost;
  function element(extra = {}) {
    return { ...events(), dataset: {}, attributes: {}, children: [], parentElement: null, isConnected: true, clientWidth: 1200, clientHeight: 650,
      setAttribute(key, value) { this.attributes[key] = value; },
      prepend(child) { child.remove(); child.parentElement = this; child.isConnected = this.isConnected; this.children.unshift(child); },
      remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; this.isConnected = false; },
      ...extra };
  }
  const root = element({ querySelector() { return liveHost; } });
  function newHost(width = 1200, height = 650) {
    const next = element({ parentElement: root, clientWidth: width, clientHeight: height });
    // Existing message children must survive background work unchanged.
    next.children.push(element({ id: 'dmStream', parentElement: next, textContent: 'private message', scrollTop: 231 }));
    return next;
  }
  liveHost = newHost(options.width, options.height);
  const button = element({ disabled: false });
  const doc = { ...events(), hidden: false, documentElement: element({ dataset: { theme: 'light' } }),
    querySelector(selector) { return selector === '#content' ? root : null; },
    querySelectorAll() { return [button]; },
    createElement() { const canvas = element({ width: 300, height: 150 }); canvas.getContext = () => { stats.contexts++; if (options.webglThrows) throw Error('disabled'); return options.noWebgl ? null : gl; }; return canvas; } };
  const reduced = { ...events(), matches: !!options.reduced }, small = { matches: !!options.small };
  const window = { ...events(), devicePixelRatio: 3, matchMedia(query) { return query.includes('reduced-motion') ? reduced : small; } };
  const connection = { ...events(), saveData: !!options.saveData };
  const gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader() { const item = {}; stats.shaders.add(item); return item; }, shaderSource(item, text) { stats.sources.push(text); }, compileShader() {}, getShaderParameter() { return !options.compileFails; }, deleteShader(item) { stats.shaders.delete(item); },
    createProgram() { const item = {}; stats.programs.add(item); return item; }, attachShader() {}, bindAttribLocation() {}, linkProgram() {}, getProgramParameter() { return !options.linkFails; }, deleteProgram(item) { stats.programs.delete(item); },
    createBuffer() { const item = {}; stats.buffers.add(item); return item; }, deleteBuffer(item) { stats.buffers.delete(item); },
    createVertexArray() { const item = {}; stats.vaos.add(item); return item; }, deleteVertexArray(item) { stats.vaos.delete(item); },
    bindVertexArray() {}, bindBuffer() {}, bufferData() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, useProgram() {},
    getUniformLocation(program, name) { return name; }, uniform1f(name, value) { stats.uniforms.set(name, value); }, uniform2f(name, ...value) { stats.uniforms.set(name, value); }, uniform3fv(name, value) { stats.uniforms.set(name, [...value]); },
    viewport(x, y, width, height) { stats.viewport = [width, height]; }, clearColor() {}, clear() {},
    drawArrays() { if (options.drawThrows) throw Error('context gone'); stats.draws++; },
    getExtension() { return { loseContext() { stats.lost++; } }; }
  };
  function Observer(kind) { return class { constructor(callback) { this.kind = kind; this.callback = callback; this.targets = new Set(); observers.push(this); } observe(target) { this.targets.add(target); } disconnect() { this.targets.clear(); } }; }
  const context = vm.createContext({ window, document: doc, navigator: { connection, hardwareConcurrency: options.cores ?? 8, deviceMemory: options.memory ?? 8 },
    localStorage: { getItem(key) { if (options.blockStorage) throw Error('private'); return items.get(key) ?? null; }, setItem(key, value) { if (options.blockStorage) throw Error('private'); stats.writes.push([key, value]); items.set(key, value); } },
    requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: Observer('resize'), IntersectionObserver: Observer('intersection'), MutationObserver: Observer('theme'), console });
  vm.runInContext(source, context, { filename: 'chat-waves.js' });
  const api = window.SpaceChatWaves;
  const sync = () => api.sync(root);
  const step = now => { const current = [...frames]; frames.clear(); for (const [, fn] of current) fn(now); };
  const click = () => doc.fire('click', { target: { closest() { return button; } }, preventDefault() {} });
  const swap = () => { liveHost.isConnected = false; liveHost = newHost(); sync(); return liveHost; };
  return { api, stats, frames, observers, items, doc, window, reduced, small, connection, button, root, get host() { return liveHost; }, sync, step, click, swap };
}
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
test('The module stays idle until a conversation is rendered', () => {
  const h = harness(); assert.equal(h.stats.contexts, 0); assert.equal(h.frames.size, 0); assert.match(h.api.control(), /Pause animated chat background/);
});
test('A decorative canvas leaves message content and scroll position intact', () => {
  const h = harness(), message = h.host.children[0]; h.sync(); h.step(0);
  assert.equal(h.host.children[1], message); assert.equal(message.textContent, 'private message'); assert.equal(message.scrollTop, 231);
  assert.equal(h.host.children[0].attributes['aria-hidden'], 'true'); assert.equal(h.stats.draws, 1);
});
test('Refreshing or switching conversations reuses one WebGL context and frame loop', () => {
  const h = harness(); h.sync(); const canvas = h.host.children[0]; h.sync(); h.swap(); h.step(0);
  assert.equal(h.stats.contexts, 1); assert.equal(h.frames.size, 1); assert.equal(h.host.children[0], canvas); assert.equal(h.host.dataset.waveState, 'animated');
});
test('Pausing persists the choice and releases all rendering resources', () => {
  const h = harness(); h.sync(); h.click();
  assert.equal(h.items.get('space.chat-waves.v1'), 'still'); assert.equal(h.host.dataset.waveState, 'still'); assert.equal(h.frames.size, 0);
  for (const key of ['shaders', 'programs', 'buffers', 'vaos']) assert.equal(h.stats[key].size, 0, key);
  assert.equal(h.host.children.length, 1); assert.equal(h.button.attributes['aria-pressed'], 'false');
});
test('Resuming animates without reloading the conversation', () => {
  const h = harness({ still: true }), message = h.host.children[0]; h.sync(); assert.equal(h.stats.contexts, 0); h.click(); h.step(0);
  assert.equal(h.stats.draws, 1); assert.equal(h.host.children[1], message); assert.equal(h.items.get('space.chat-waves.v1'), 'animated');
});
for (const options of [{ reduced: true }, { saveData: true }, { cores: 2 }, { memory: 2 }]) test(`Resource preference ${JSON.stringify(options)} uses still wallpaper without a WebGL allocation`, () => {
  const h = harness(options); h.sync(); h.click(); assert.equal(h.stats.contexts, 0); assert.equal(h.frames.size, 0); assert.equal(h.button.disabled, true); assert.equal(h.host.dataset.waveState, 'still');
});
test('Changing reduced motion immediately stops and safely resumes animation', () => {
  const h = harness(); h.sync(); h.reduced.matches = true; h.reduced.fire('change'); assert.equal(h.frames.size, 0); assert.equal(h.host.dataset.waveState, 'still');
  h.reduced.matches = false; h.reduced.fire('change'); h.step(0); assert.equal(h.stats.draws, 1); assert.equal(h.button.disabled, false);
});
test('Turning on data saving releases an already running wallpaper', () => {
  const h = harness(); h.sync(); h.connection.saveData = true; h.connection.fire('change'); assert.equal(h.frames.size, 0); assert.equal(h.host.children.length, 1);
});
for (const options of [{ noWebgl: true }, { webglThrows: true }, { compileFails: true }, { linkFails: true }]) test(`WebGL failure ${JSON.stringify(options)} leaves the chat usable with a still background`, () => {
  const h = harness(options), message = h.host.children[0]; assert.doesNotThrow(h.sync); assert.equal(h.host.dataset.waveState, 'unavailable'); assert.equal(h.host.children[0], message); assert.equal(h.frames.size, 0);
  for (const key of ['shaders', 'programs', 'buffers', 'vaos']) assert.equal(h.stats[key].size, 0, key);
});
test('WebGL context loss stops rendering and removes the failed canvas', () => {
  const h = harness(); h.sync(); let prevented = false; h.host.children[0].fire('webglcontextlost', { preventDefault() { prevented = true; } });
  assert(prevented); assert.equal(h.frames.size, 0); assert.equal(h.host.dataset.waveState, 'unavailable'); assert.equal(h.host.children.length, 1);
});
test('A rendering error cannot propagate into the chat application', () => {
  const h = harness({ drawThrows: true }); h.sync(); assert.doesNotThrow(() => h.step(0)); assert.equal(h.host.dataset.waveState, 'unavailable'); assert.equal(h.frames.size, 0);
});
test('Hidden tabs stop immediately and resume without a large time jump', () => {
  const h = harness(); h.sync(); h.step(0); h.doc.hidden = true; h.doc.fire('visibilitychange'); assert.equal(h.frames.size, 0);
  h.doc.hidden = false; h.doc.fire('visibilitychange'); h.step(100000); assert.equal(h.stats.uniforms.get('uTime'), 0); assert.equal(h.stats.draws, 2);
});
test('Offscreen conversations stop; intersection events from an old conversation are ignored', () => {
  const h = harness(); h.sync(); const observer = h.observers.find(o => o.kind === 'intersection'), old = h.host;
  observer.callback([{ target: h.host, isIntersecting: false }]); assert.equal(h.frames.size, 0);
  h.swap(); observer.callback([{ target: old, isIntersecting: false }]); assert.equal(h.frames.size, 1);
});
test('Leaving chat releases observers, animation frames and GPU objects', () => {
  const h = harness(); h.sync(); h.api.sync(null); assert.equal(h.frames.size, 0); assert.equal(h.stats.lost, 1);
  assert(h.observers.every(o => o.targets.size === 0)); assert.equal(h.doc.handlers.get('visibilitychange').size, 0);
});
test('Theme changes update shader colors without allocating another context', () => {
  const h = harness(); h.sync(); h.step(0); const light = h.stats.uniforms.get('uHorizon');
  h.doc.documentElement.dataset.theme = 'dark'; h.observers.find(o => o.kind === 'theme').callback([]); h.step(50);
  assert.notDeepEqual(h.stats.uniforms.get('uHorizon'), light); assert.equal(h.stats.contexts, 1);
});
test('Pixel and frame budgets remain bounded on a large high-DPR desktop', () => {
  const h = harness({ width: 4000, height: 2200 }); h.sync(); for (let now = 0; now <= 1000; now += 5) h.step(now);
  const [width, height] = h.stats.viewport; assert(width * height <= 321000); assert(h.stats.draws <= 25); assert.equal(h.stats.uniforms.get('uSteps'), 56);
});
test('Narrow screens use the smaller pixel, ray and frame budgets', () => {
  const h = harness({ width: 740, height: 1000, small: true }); h.sync(); for (let now = 0; now <= 1000; now += 5) h.step(now);
  const [width, height] = h.stats.viewport; assert(width * height <= 181000); assert(h.stats.draws <= 19); assert.equal(h.stats.uniforms.get('uSteps'), 40);
});
test('Storage denial still allows the background to be paused', () => {
  const h = harness({ blockStorage: true }); h.sync(); assert.doesNotThrow(h.click); assert.equal(h.host.dataset.waveState, 'still');
});
test('Changing the preference in another tab updates this conversation', () => {
  const h = harness(); h.sync(); h.window.fire('storage', { key: 'space.chat-waves.v1', newValue: 'still' }); assert.equal(h.frames.size, 0); assert.equal(h.host.dataset.waveState, 'still');
});
test('Page cache exit releases resources and returning can recreate the wallpaper', () => {
  const h = harness(); h.sync(); h.window.fire('pagehide'); assert.equal(h.frames.size, 0); h.window.fire('pageshow'); h.step(0); assert.equal(h.stats.draws, 1);
});

test('Shared drawing holds wallpaper resources without changing its saved preference', () => {
  const h=harness();h.sync();h.api.hold('shared-glow',true);assert.equal(h.stats.contexts,1);assert.equal(h.frames.size,0);assert.equal(h.items.size,0);assert.equal(h.button.disabled,true);h.click();assert.equal(h.items.size,0);h.api.hold('shared-glow',false);assert.equal(h.stats.contexts,2);assert.equal(h.button.disabled,false);
});
test('Releasing shared drawing respects a previously paused wallpaper', () => {
  const h=harness({still:true});h.sync();h.api.hold('shared-glow',true);h.api.hold('shared-glow',false);assert.equal(h.stats.contexts,0);assert.equal(h.items.get('space.chat-waves.v1'),'still');
});

let passed = 0;
for (const [name, fn] of tests) { try { fn(); passed++; console.log('PASS', name); } catch (error) { console.error('FAIL', name, error); process.exitCode = 1; } }
console.log(`${passed}/${tests.length} chat wave checks passed`);
