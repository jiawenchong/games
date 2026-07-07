/* ============================================================
   盛世天下 · 女帝篇 — 音效 (WebAudio 合成,無外部資源)
   ============================================================ */
'use strict';

const AUDIO = (() => {
  let ctx = null;
  let enabled = true;
  try { enabled = localStorage.getItem('shengshi_sound') !== '0'; } catch (e) {}
  let master = null;
  let bgmTimer = null;

  function unlock() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /* 古箏式撥弦:三角波 + 快速衰減 + 輕微顫音 */
  function pluck(freq, when, dur, vol) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime + (when || 0);
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc2.type = 'sine';
    osc.frequency.value = freq;
    osc2.frequency.value = freq * 2.005;   // 泛音
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    osc2.connect(g2); g2.connect(g);
    osc.connect(g);
    g.connect(master);
    const d = dur || 0.9;
    const v = vol || 0.22;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.start(t); osc.stop(t + d + 0.05);
    osc2.start(t); osc2.stop(t + d + 0.05);
  }

  /* 鑼:噪音 + 低頻正弦膨脹 */
  function gongAt(freq, dur, vol) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.82, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.1);
    // 金屬泛音
    [2.76, 5.4, 8.9].forEach((m, i) => {
      const o = ctx.createOscillator(); const gg = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq * m;
      gg.gain.setValueAtTime(0, t);
      gg.gain.linearRampToValueAtTime(vol * 0.18 / (i + 1), t + 0.015);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.7);
      o.connect(gg); gg.connect(master);
      o.start(t); o.stop(t + dur);
    });
  }

  /* 五聲音階 (宮商角徵羽, D 調) */
  const SCALE = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99];

  function click()  { unlock(); pluck(SCALE[3], 0, 0.35, 0.14); }
  function flip()   { unlock(); pluck(SCALE[1], 0, 0.5, 0.16); pluck(SCALE[4], 0.07, 0.5, 0.12); }
  function stamp()  { unlock(); pluck(SCALE[0] / 2, 0, 0.4, 0.3); pluck(SCALE[0], 0.03, 0.6, 0.18); }
  function gong()   { unlock(); gongAt(196, 2.2, 0.25); }
  function gongLow(){ unlock(); gongAt(130, 3.0, 0.3); }
  function victory() {
    unlock();
    [0, 1, 2, 4, 5, 7].forEach((n, i) => pluck(SCALE[n % SCALE.length], i * 0.16, 1.1, 0.2));
    setTimeout(() => gongAt(220, 2.5, 0.22), 900);
  }

  /* 背景樂:緩慢隨機五聲琶音 */
  function startBgm() {
    if (bgmTimer || !enabled) return;
    unlock();
    if (!ctx) return;
    const loop = () => {
      if (!enabled) return;
      const base = Math.floor(Math.random() * 4);
      const pattern = [base, base + 2, base + 4, base + 2];
      pattern.forEach((n, i) => pluck(SCALE[n % SCALE.length] / 2, i * 0.85 + Math.random() * 0.1, 2.2, 0.05));
    };
    loop();
    bgmTimer = setInterval(loop, 4200);
  }
  function stopBgm() { clearInterval(bgmTimer); bgmTimer = null; }

  function toggle() {
    enabled = !enabled;
    try { localStorage.setItem('shengshi_sound', enabled ? '1' : '0'); } catch (e) {}
    if (!enabled) stopBgm(); else startBgm();
    return enabled;
  }

  return { unlock, click, flip, stamp, gong, gongLow, victory, startBgm, stopBgm, toggle,
           get enabled() { return enabled; } };
})();
