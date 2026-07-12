"use strict";
/* ============================================================
 * 開源風洞 · 介面、渲染與互動
 * ============================================================ */

/* ---------- 解析度設定 ---------- */
const RESOLUTIONS = {
  low:  { xdim: 160, ydim: 64  },
  mid:  { xdim: 240, ydim: 96  },
  high: { xdim: 320, ydim: 128 },
};

/* ---------- 色帶 ---------- */
function hexToRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
/** 由漸層色標建立 256 級查找表 */
function makePalette(stops) {
  const rgb = stops.map(hexToRgb);
  const pal = new Uint8ClampedArray(256 * 3);
  const seg = stops.length - 1;
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * seg;
    const k = Math.min(seg - 1, Math.floor(t));
    const f = t - k;
    for (let c = 0; c < 3; c++) {
      pal[i * 3 + c] = rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f;
    }
  }
  return pal;
}
const PAL_SPEED = makePalette(['#0a1233', '#15409c', '#1e8fc9', '#43d3a5', '#e8e14b', '#f08a2d', '#d63b2f']);
const PAL_DIVERGE = makePalette(['#0d3a8f', '#3a77d9', '#a9c6f5', '#101828', '#f0a893', '#e05a3a', '#9c1f14']);
const BARRIER_RGB = [232, 226, 205];

/* ---------- 全域狀態 ---------- */
let sim;
let running = true;
let stepsPerFrame = 8;
let displayMode = 'curl';   // speed | curl | density
let contrast = 1;
let brushErase = false;
let brushSize = 4;
let showTracers = true;
let tracersX, tracersY;
const N_TRACERS = 1200;

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const off = document.createElement('canvas');
const offCtx = off.getContext('2d');
let img;

const $ = id => document.getElementById(id);

/* ---------- 初始化 ---------- */
function setup(resKey) {
  const { xdim, ydim } = RESOLUTIONS[resKey];
  if (!sim) sim = new LBM(xdim, ydim);
  else sim.resize(xdim, ydim);
  off.width = xdim; off.height = ydim;
  img = offCtx.createImageData(xdim, ydim);
  // 依容器寬度決定顯示大小,維持格點長寬比
  fitCanvas();
  initTracers();
  applyPreset($('preset').value);
}

function fitCanvas() {
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth;
  const h = Math.round(w * sim.ydim / sim.xdim);
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  canvas.style.height = h + 'px';
}

function initTracers() {
  tracersX = new Float32Array(N_TRACERS);
  tracersY = new Float32Array(N_TRACERS);
  for (let i = 0; i < N_TRACERS; i++) respawnTracer(i, true);
}
function respawnTracer(i, anywhere) {
  tracersX[i] = anywhere ? 1 + Math.random() * (sim.xdim - 2) : 1 + Math.random() * 4;
  tracersY[i] = 1 + Math.random() * (sim.ydim - 2);
}
function moveTracers(substeps) {
  const { xdim, ydim, ux, uy, barrier } = sim;
  for (let i = 0; i < N_TRACERS; i++) {
    let x = tracersX[i], y = tracersY[i];
    const gi = Math.round(x) + Math.round(y) * xdim;
    x += ux[gi] * substeps;
    y += uy[gi] * substeps;
    if (x >= xdim - 1 || x < 1 || y < 1 || y >= ydim - 1 || barrier[Math.round(x) + Math.round(y) * xdim]) {
      respawnTracer(i, false);
    } else {
      tracersX[i] = x; tracersY[i] = y;
    }
  }
}

/* ---------- 障礙物預設 ---------- */
function applyPreset(name) {
  const { xdim, ydim } = sim;
  sim.clearBarriers();
  const cx = Math.round(xdim * 0.25), cy = Math.round(ydim / 2);
  const r = Math.max(4, Math.round(ydim / 9));
  if (name === 'cylinder') {
    sim.paint(cx, cy, r, false);
  } else if (name === 'plate') {
    for (let y = cy - r * 2; y <= cy + r * 2; y++) sim.paint(cx, y, 1.2, false);
  } else if (name === 'wing') {
    // 簡化翼型:上緣圓弧、下緣近平,略帶攻角
    const chord = Math.round(xdim * 0.22);
    for (let k = 0; k <= chord; k++) {
      const t = k / chord;
      const thick = r * 1.1 * (1 - t) * Math.sqrt(Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.02)));
      const camber = -t * r * 0.9;               // 攻角:後緣下垂
      const yC = cy + camber;
      for (let y = Math.round(yC - thick); y <= Math.round(yC + thick * 0.35); y++) {
        sim.paint(cx - Math.round(chord * 0.3) + k, y, 0.8, false);
      }
    }
  } else if (name === 'buildings') {
    // 兩棟建築間的縫隙風(文丘里效應)
    const w = Math.round(xdim * 0.05), gap = Math.round(ydim * 0.18);
    const h1 = Math.round(ydim / 2 - gap / 2), h2t = Math.round(ydim / 2 + gap / 2);
    for (let x = cx; x < cx + w; x++) {
      for (let y = 1; y <= h1; y++) sim.paint(x, y, 0.8, false);
      for (let y = h2t; y < ydim - 1; y++) sim.paint(x, y, 0.8, false);
    }
  } // 'empty' 則保持全空
  sim.initFluid();
  initTracers();
}

/* ---------- 渲染 ---------- */
function render() {
  const { xdim, ydim, rho, ux, uy, curl, barrier } = sim;
  const data = img.data;
  const n = xdim * ydim;
  if (displayMode === 'curl') sim.computeCurl();
  const u0 = sim.u0;
  for (let i = 0; i < n; i++) {
    // 畫布 y 向下、格點 y 向上,翻轉一下
    const x = i % xdim, y = (i / xdim) | 0;
    const p = (x + (ydim - 1 - y) * xdim) * 4;
    if (barrier[i]) {
      data[p] = BARRIER_RGB[0]; data[p + 1] = BARRIER_RGB[1]; data[p + 2] = BARRIER_RGB[2]; data[p + 3] = 255;
      continue;
    }
    let t;
    let pal = PAL_SPEED;
    if (displayMode === 'speed') {
      t = Math.sqrt(ux[i] * ux[i] + uy[i] * uy[i]) / (2 * u0) * contrast;
    } else if (displayMode === 'curl') {
      pal = PAL_DIVERGE;
      t = 0.5 + curl[i] * (2.5 / u0) * contrast * 0.25;
    } else {
      pal = PAL_DIVERGE;
      t = 0.5 + (rho[i] - 1) * 6 * contrast;
    }
    let k = (t * 255) | 0;
    if (k < 0) k = 0; else if (k > 255) k = 255;
    data[p] = pal[k * 3]; data[p + 1] = pal[k * 3 + 1]; data[p + 2] = pal[k * 3 + 2]; data[p + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  if (showTracers) {
    const sx = canvas.width / xdim, sy = canvas.height / ydim;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const s = Math.max(1.5, sx * 0.35);
    for (let i = 0; i < N_TRACERS; i++) {
      ctx.fillRect(tracersX[i] * sx, (ydim - 1 - tracersY[i]) * sy, s, s);
    }
  }
}

/* ---------- 主迴圈 ---------- */
let lastT = performance.now(), fpsSmooth = 0;
function frame(now) {
  if (running) {
    for (let s = 0; s < stepsPerFrame; s++) sim.step();
    if (showTracers) moveTracers(stepsPerFrame);
    if (sim.diverged()) {
      sim.initFluid();
      toast('數值發散,流場已自動重置 — 試著調低風速或調高黏滯度');
    }
  }
  render();
  const dt = now - lastT; lastT = now;
  fpsSmooth = fpsSmooth * 0.9 + (1000 / dt) * 0.1;
  updateReadout();
  requestAnimationFrame(frame);
}

function updateReadout() {
  $('fps').textContent = fpsSmooth.toFixed(0);
  const L = sim.barrierHeight();
  const re = L > 0 ? (sim.u0 * L / sim.viscosity) : 0;
  $('re').textContent = re > 0 ? re.toFixed(0) : '—';
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ---------- 滑鼠 / 觸控繪製障礙物 ---------- */
function canvasToGrid(ev) {
  const rect = canvas.getBoundingClientRect();
  const pt = ev.touches ? ev.touches[0] : ev;
  const gx = (pt.clientX - rect.left) / rect.width * sim.xdim;
  const gy = sim.ydim - 1 - (pt.clientY - rect.top) / rect.height * sim.ydim;
  return [gx, gy];
}
let drawing = false;
function pointerDown(ev) { drawing = true; pointerMove(ev); }
function pointerMove(ev) {
  if (!drawing) return;
  ev.preventDefault();
  const [gx, gy] = canvasToGrid(ev);
  sim.paint(gx, gy, brushSize, brushErase);
}
function pointerUp() { drawing = false; }

canvas.addEventListener('mousedown', pointerDown);
canvas.addEventListener('mousemove', pointerMove);
window.addEventListener('mouseup', pointerUp);
canvas.addEventListener('touchstart', pointerDown, { passive: false });
canvas.addEventListener('touchmove', pointerMove, { passive: false });
window.addEventListener('touchend', pointerUp);

/* ---------- 控制項 ---------- */
$('speed').addEventListener('input', e => {
  sim.u0 = +e.target.value;
  $('speed-val').textContent = sim.u0.toFixed(3);
});
$('visc').addEventListener('input', e => {
  sim.viscosity = +e.target.value;
  $('visc-val').textContent = sim.viscosity.toFixed(3);
});
$('steps').addEventListener('input', e => {
  stepsPerFrame = +e.target.value;
  $('steps-val').textContent = stepsPerFrame;
});
$('contrast').addEventListener('input', e => {
  contrast = +e.target.value;
  $('contrast-val').textContent = contrast.toFixed(1);
});
$('brush').addEventListener('input', e => {
  brushSize = +e.target.value;
  $('brush-val').textContent = brushSize;
});
$('mode').addEventListener('change', e => { displayMode = e.target.value; });
$('preset').addEventListener('change', e => applyPreset(e.target.value));
$('res').addEventListener('change', e => setup(e.target.value));
$('tracers').addEventListener('change', e => { showTracers = e.target.checked; });
$('tool-draw').addEventListener('click', () => setTool(false));
$('tool-erase').addEventListener('click', () => setTool(true));
function setTool(erase) {
  brushErase = erase;
  $('tool-draw').classList.toggle('active', !erase);
  $('tool-erase').classList.toggle('active', erase);
}
$('btn-pause').addEventListener('click', () => {
  running = !running;
  $('btn-pause').textContent = running ? '⏸ 暫停' : '▶ 繼續';
});
$('btn-reset').addEventListener('click', () => { sim.initFluid(); initTracers(); });
$('btn-clear').addEventListener('click', () => { sim.clearBarriers(); sim.initFluid(); initTracers(); $('preset').value = 'empty'; });

window.addEventListener('resize', fitCanvas);

/* ---------- 啟動 ---------- */
setup($('res').value);
setTool(false);
requestAnimationFrame(frame);
