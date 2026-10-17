/*
 * SPACE chat wallpaper: adapted from the user-supplied React Bits GradientWaves.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
 * Source and full license: https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, and distribute the Software as part of an
 * application, website, or product, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * Commons Clause Restriction: You may use this Software, including for any
 * commercial purpose, so long as you do not sell, sublicense, or redistribute
 * the components themselves-whether alone, in a bundle, or as a ported version.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * SPACE adapts the rendering lifecycle without adding a React dependency.
 */
(() => {
'use strict';
const MAX_SWELLS = 4;
const CAMERA_HEIGHT = 30;
const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uClock;
uniform float uAmplitude;
uniform float uWaveScale;
uniform float uWaveRatio;
uniform float uSwell;
uniform float uTurbulence;
uniform float uHeight;
uniform float uTilt;
uniform float uZoom;
uniform vec2 uLook;
uniform float uFogDepth;
uniform float uBrightness;
uniform float uOpacity;
uniform float uGrain;
uniform vec3 uHorizon;
uniform vec3 uWave;
uniform vec3 uCrest;
uniform vec3 uBackground;
uniform float uOpaque;
uniform float uLight;
uniform vec3 uSun;
uniform float uRelief;
uniform float uSheen;
uniform float uSteps;
uniform float uStride;
uniform vec3 uIntro;
uniform vec3 uSwells[${MAX_SWELLS}];
uniform float uSwellWidth;
out vec4 outColor;

const float FAR = 4000.0;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 surface(vec2 xy) {
  vec2 freq = vec2(uWaveScale / 7.0, (uWaveScale * uWaveRatio) / 3.0);
  vec4 tc = vec4(uTime / 0.130, uTime / 0.810, uTime / 0.200, uTime / 0.710);
  float a = xy.x + tc.x;
  float swellPhase = (xy.y + a) / 20.0 + tc.y;
  float bend = uSwell * cos(swellPhase) / 20.0;
  float mx = a + uSwell * sin(swellPhase);
  float crossPhase = xy.x / 23.0 + tc.w;
  float my = xy.y - tc.z + uTurbulence * cos(crossPhase);
  float twist = -uTurbulence * sin(crossPhase) / 23.0;
  float cx = cos(mx * freq.x);
  float cy = cos(my * freq.y);
  float rise = 1.0;
  if (uIntro.z > 0.0) rise = mix(1.0, smoothstep(uIntro.y * 0.45, uIntro.y * 1.6, xy.x), uIntro.z);
  float amp = uAmplitude * rise;
  float h = (sin(mx * freq.x) + sin(my * freq.y)) * amp + uHeight;
  float dx = amp * (freq.x * cx * (1.0 + bend) + freq.y * cy * twist);
  float dy = amp * (freq.x * cx * bend + freq.y * cy);
  for (int k = 0; k < ${MAX_SWELLS}; k++) {
    vec3 sw = uSwells[k];
    if (sw.z <= 0.0) continue;
    float u = (xy.x - sw.x) / uSwellWidth;
    float v = (xy.y - sw.y) / (uSwellWidth * 3.5);
    float bump = sw.z * exp(-u * u - v * v);
    h += bump;
    dx += bump * (-2.0 * u / uSwellWidth);
    dy += bump * (-2.0 * v / (uSwellWidth * 3.5));
  }
  return vec3(h, dx, dy);
}

float march(vec3 origin, vec3 dir) {
  float dist = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps) break;
    float gap = origin.z + dist * dir.z - surface(origin.xy + dist * dir.xy).x;
    if (abs(gap) < 0.002 * dist + 0.01) break;
    dist += uStride * gap;
    if (!(abs(dist) < FAR)) return FAR;
  }
  return dist;
}

void main() {
  float c;
  float s;
  float vfov = (3.14159 / 2.3) / max(uZoom, 0.05);
  vec3 cam = vec3(0.0, 0.0, ${CAMERA_HEIGHT.toFixed(1)});
  vec2 uv = gl_FragCoord.xy / uResolution - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  uv.y *= -1.0;

  vec3 dir = vec3(0.0, 0.0, -1.0);
  float ulen = length(uv);
  float xrot = vfov * ulen;
  c = cos(xrot);
  s = sin(xrot);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
  dir = mat3(nuv.x, -nuv.y, 0.0, nuv.y, nuv.x, 0.0, 0.0, 0.0, 1.0) * dir;
  c = cos(uTilt + uLook.y);
  s = sin(uTilt + uLook.y);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;
  c = cos(uLook.x);
  s = sin(uLook.x);
  dir = mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0) * dir;

  float dist = march(cam, dir);
  vec3 pos = cam + dist * dir;
  vec3 field = surface(pos.xy);
  vec3 view = -dir;

  float crest = clamp((field.x - uHeight) / max(2.0 * uAmplitude, 0.001) * 0.5 + 0.5, 0.0, 1.0);
  vec3 body = mix(uWave, uCrest, smoothstep(0.45, 1.0, crest) * 0.5);
  vec3 normal = normalize(vec3(-field.yz * (1.0 + 1.5 * uRelief), 1.0));
  float diffuse = clamp(dot(normal, uSun) * 0.5 + 0.5, 0.0, 1.0);
  float lightness = mix(1.0, diffuse * diffuse * (3.0 - 2.0 * diffuse), uRelief);
  float sheen = pow(clamp(dot(normal, normalize(uSun + view)), 0.0, 1.0), 14.0) * uSheen * (0.4 + 0.6 * uRelief);
  float rim = pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), 3.0);

  vec3 col;
  float alpha;
  float haze = 1.0 - exp(-dist / (uFogDepth * 5.0));
  float fade = 1.0 - smoothstep(0.35, 1.0, haze);
  if (uLight < 0.5) {
    vec3 lit = mix(uHorizon * 0.18, body, lightness) + uCrest * sheen;
    lit = mix(lit, uHorizon, rim * 0.15 * uRelief);
    col = mix(lit, uHorizon, smoothstep(0.0, 1.0, haze)) * 0.85 * uBrightness;
    alpha = fade;
  } else {
    vec3 hue = mix(uHorizon, body, 0.35 + 0.65 * lightness);
    float density = mix(0.16, 0.9, 1.0 - lightness);
    density *= 1.0 - clamp(sheen, 0.0, 1.0) * 0.85;
    density *= 1.0 - 0.5 * smoothstep(0.0, 1.0, haze);
    col = hue;
    alpha = fade * clamp(density * uBrightness, 0.0, 1.0);
  }

  float reveal = uIntro.x;
  col = clamp(col, 0.0, 1.0);
  float grain = (hash(gl_FragCoord.xy + fract(uClock) * 64.0) - 0.5) * uGrain;
  alpha = clamp(alpha * (1.0 + grain), 0.0, 1.0) * reveal * uOpacity;
  if (uOpaque > 0.5) {
    outColor = vec4(mix(uBackground, col, alpha), 1.0);
  } else {
    outColor = vec4(col * alpha, alpha);
  }
}`;


const KEY = 'space.chat-waves.v1';
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const small = window.matchMedia?.('(max-width: 740px)');
let enabled = true, renderer = null, host = null, unsupported = false;
try { enabled = localStorage.getItem(KEY) !== 'still'; } catch {}
const restricted = () => !!(reduced?.matches || navigator.connection?.saveData || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) || (navigator.deviceMemory && navigator.deviceMemory <= 2));
const mayAnimate = () => enabled && !restricted() && !unsupported;
const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 6c3-4 6 4 9 0s6 4 9 0M3 12c3-4 6 4 9 0s6 4 9 0M3 18c3-4 6 4 9 0s6 4 9 0"/></svg>';
function label() {
  if (reduced?.matches) return 'Still chat background: reduced motion is enabled on your device';
  if (unsupported) return 'Still chat background: animation is unavailable on this device';
  if (restricted()) return 'Still chat background: saving device resources';
  return enabled ? 'Pause animated chat background' : 'Animate chat background';
}
function controls() {
  document.querySelectorAll('[data-chat-wave-toggle]').forEach(button => {
    button.setAttribute('aria-label', label());
    button.setAttribute('title', label());
    button.setAttribute('aria-pressed', String(mayAnimate()));
    button.disabled = restricted() || unsupported;
  });
}
function release() {
  renderer?.destroy();
  renderer = null;
}
function sync(root = document) {
  const next = root?.querySelector?.('[data-chat-waves]') || null;
  host = next;
  if (!host || !mayAnimate()) {
    release();
    if (host) host.dataset.waveState = unsupported ? 'unavailable' : 'still';
  } else {
    try {
      if (renderer) renderer.moveTo(host);
      else renderer = createRenderer(host);
      host.dataset.waveState = 'animated';
    } catch {
      release();
      unsupported = true;
      host.dataset.waveState = 'unavailable';
    }
  }
  controls();
}
function refresh() { sync(host?.isConnected ? host.parentElement : document.querySelector('#content')); }
function createRenderer(initialHost) {
  const canvas = document.createElement('canvas');
  canvas.className = 'chat-wave-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  if (!gl) throw new Error('WebGL unavailable');
  let program = null, buffer = null, vao = null, vertex = null, fragment = null;
  let container = initialHost, visible = true, destroyed = false, raf = 0, last = null, drawnAt = null, clock = 0;
  let sizes, visibility, theme;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    raf = 0;
    sizes?.disconnect(); visibility?.disconnect(); theme?.disconnect();
    document.removeEventListener('visibilitychange', visibilityChanged);
    canvas.removeEventListener('webglcontextlost', lost);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (vao) gl.deleteVertexArray(vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  }
  function lost(event) {
    event.preventDefault();
    unsupported = true;
    destroy();
    renderer = null;
    if (host) host.dataset.waveState = 'unavailable';
    controls();
  }
  function visibilityChanged() {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = null; }
    else wake();
  }
  function wake() {
    if (destroyed || raf || !visible || document.hidden || !container.isConnected || !mayAnimate()) return;
    last = null;
    drawnAt = null;
    raf = requestAnimationFrame(tick);
  }
  function compile(type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Shader unavailable');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Shader compilation failed'); }
    return shader;
  }
  const uniforms = {};
  function draw() {
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height) return;
    // Decorative rendering stays below 320k pixels and 24fps; never use full DPR.
    const mobile = !!small?.matches;
    const ratio = Math.min(window.devicePixelRatio || 1, mobile ? 0.75 : 1, Math.sqrt((mobile ? 180000 : 320000) / (width * height)));
    const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    gl.useProgram(program); gl.bindVertexArray(vao); gl.viewport(0, 0, w, h);
    const f = (name, value) => gl.uniform1f(uniforms[name], value);
    const v = (name, value) => gl.uniform3fv(uniforms[name], value);
    const dark = document.documentElement.dataset.theme === 'dark';
    gl.uniform2f(uniforms.uResolution, w, h);
    f('uTime', clock * 0.18); f('uClock', clock);
    f('uAmplitude', 1.8); f('uWaveScale', 0.9); f('uWaveRatio', 0.9);
    f('uSwell', 25); f('uTurbulence', 28); f('uHeight', 5.5);
    f('uTilt', 64 * Math.PI / 180); f('uZoom', 1);
    gl.uniform2f(uniforms.uLook, 0, 0);
    f('uFogDepth', 15); f('uBrightness', 1); f('uOpacity', dark ? 0.62 : 0.48); f('uGrain', 0.04);
    v('uHorizon', dark ? [0.12, 0.2, 0.42] : [0.118, 0.227, 0.541]);
    v('uWave', dark ? [0.2, 0.53, 0.76] : [0.22, 0.741, 0.973]);
    v('uCrest', [0.878, 0.949, 1]); v('uBackground', [0, 0, 0]);
    f('uOpaque', 0); f('uLight', dark ? 0 : 1);
    const angle = 150 * Math.PI / 180, elevation = 0.52;
    v('uSun', [Math.cos(elevation) * Math.cos(angle), Math.cos(elevation) * Math.sin(angle), Math.sin(elevation)]);
    f('uRelief', 1); f('uSheen', 0.15); f('uSteps', mobile ? 40 : 56); f('uStride', 0.9);
    v('uIntro', [1, 3, 0]); v('uSwells', new Float32Array(MAX_SWELLS * 3)); f('uSwellWidth', 8);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function tick(now) {
    raf = 0;
    if (destroyed || !visible || document.hidden || !container.isConnected || !mayAnimate()) return;
    const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.1);
    last = now; clock += dt;
    try {
      if (drawnAt === null || now - drawnAt >= 1000 / (small?.matches ? 18 : 24)) { draw(); drawnAt = now; }
    } catch { lost({preventDefault(){}}); return; }
    raf = requestAnimationFrame(tick);
  }
  function moveTo(next) {
    if (container === next && canvas.parentElement === next) { wake(); return; }
    sizes?.disconnect(); visibility?.disconnect();
    container = next; visible = true;
    container.prepend(canvas);
    sizes?.observe(container); visibility?.observe(container);
    wake();
  }
  try {
    vertex = compile(gl.VERTEX_SHADER, VERTEX); fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    program = gl.createProgram(); if (!program) throw new Error('Program unavailable');
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.bindAttribLocation(program, 0, 'aPosition'); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed');
    gl.deleteShader(vertex); vertex = null; gl.deleteShader(fragment); fragment = null;
    const names = ['uResolution','uTime','uClock','uAmplitude','uWaveScale','uWaveRatio','uSwell','uTurbulence','uHeight','uTilt','uZoom','uLook','uFogDepth','uBrightness','uOpacity','uGrain','uHorizon','uWave','uCrest','uBackground','uOpaque','uLight','uSun','uRelief','uSheen','uSteps','uStride','uIntro','uSwells','uSwellWidth'];
    names.forEach(name => { uniforms[name] = gl.getUniformLocation(program, name === 'uSwells' ? 'uSwells[0]' : name); });
    vao = gl.createVertexArray(); buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error('Buffer unavailable');
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { drawnAt = null; wake(); }) : null;
    visibility = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      const entry = entries.find(item => item.target === container); if (!entry) return;
      visible = entry.isIntersecting;
      if (visible) wake(); else { cancelAnimationFrame(raf); raf = 0; last = null; }
    }) : null;
    theme = typeof MutationObserver === 'function' ? new MutationObserver(() => { drawnAt = null; wake(); }) : null;
    theme?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    document.addEventListener('visibilitychange', visibilityChanged);
    canvas.addEventListener('webglcontextlost', lost);
    container.prepend(canvas); sizes?.observe(container); visibility?.observe(container); wake();
    return { moveTo, destroy };
  } catch (error) { destroy(); throw error; }
}
window.SpaceChatWaves = {
  sync,
  control() { return `<button type="button" class="dm-icon-button chat-wave-toggle" data-chat-wave-toggle aria-pressed="${mayAnimate()}" aria-label="${label()}" title="${label()}" ${restricted() || unsupported ? 'disabled' : ''}>${icon}</button>`; }
};
document.addEventListener('click', event => {
  if (!event.target.closest?.('[data-chat-wave-toggle]') || restricted() || unsupported) return;
  event.preventDefault(); enabled = !enabled;
  try { localStorage.setItem(KEY, enabled ? 'animated' : 'still'); } catch {}
  refresh();
});
reduced?.addEventListener?.('change', refresh);
navigator.connection?.addEventListener?.('change', refresh);
window.addEventListener('storage', event => { if (event.key === KEY) { enabled = event.newValue !== 'still'; refresh(); } });
window.addEventListener('pagehide', release);
window.addEventListener('pageshow', refresh);
})();
