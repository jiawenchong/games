/* ============================================================
   盛世天下 · 女帝篇 — 遊戲引擎
   ============================================================ */
'use strict';

const SAVE_KEY = 'shengshi_save_v1';
const META_KEY = 'shengshi_meta_v1';
const SEASONS = ['春', '夏', '秋', '冬'];
const VICTORY_YEAR = 8;      // 達成盛世所需最少在位年數
const VICTORY_STAT = 82;     // 四維同時達標值
const MAX_YEAR = 30;         // 自然終局

let S = null;                // 當前遊戲狀態
let busy = false;            // 動畫/流程鎖
let pendingEnding = null;

/* ---------- 工具 ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = arr => arr[Math.floor(Math.random() * arr.length)];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------- 存檔 ---------- */
function saveGame() {
  if (!S || S.over) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {}
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.stats || s.over) return null;
    return s;
  } catch (e) { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

function getMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY)) || { endings: [], runs: 0 }; }
  catch (e) { return { endings: [], runs: 0 }; }
}
function setMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) {} }

/* ---------- 新遊戲狀態 ---------- */
function newState(era) {
  return {
    era,                       // 年號
    turn: 1,                   // 總回合(季)
    stats: { min: 55, wei: 45, cai: 50, jun: 45, ti: 80 },
    loyal: { xiang: 55, jiang: 55, hu: 60, wei: 65 },
    flags: {},
    seen: [],                  // 已觸發的 once 事件
    lastEvents: [],            // 近期事件id,避免重複
    log: [],
    over: false,
  };
}
const yearOf = s => Math.ceil(s.turn / 4);
const seasonOf = s => (s.turn - 1) % 4;

/* ============================================================
   畫面切換
   ============================================================ */
function showScreen(id) {
  $$('.screen').forEach(sc => sc.classList.remove('active'));
  const target = $('#' + id);
  target.classList.add('active');
}

/* ============================================================
   標題畫面
   ============================================================ */
function initTitle() {
  const save = loadSave();
  $('#btn-continue').style.display = save ? '' : 'none';
  if (save) {
    $('#btn-continue .sub').textContent = `${save.era}${yearOf(save)}年 · ${SEASONS[seasonOf(save)]}`;
  }
  const meta = getMeta();
  $('#title-endings-count').textContent = `${meta.endings.length} / ${DATA.ENDINGS.length}`;
  showScreen('screen-title');
}

/* ---------- 開局:選年號 ---------- */
function openNewGame() {
  AUDIO.unlock(); AUDIO.click();
  const box = $('#era-options');
  box.innerHTML = '';
  DATA.ERA_NAMES.forEach(name => {
    const b = el('button', 'era-btn', `<span class="era-name">${name}</span>`);
    b.addEventListener('click', () => { AUDIO.click(); startGame(name); });
    box.appendChild(b);
  });
  showScreen('screen-era');
}

function startGame(era) {
  clearSave();
  S = newState(era);
  const meta = getMeta(); meta.runs++; setMeta(meta);
  pushLog(`《${era}》元年 · 新帝登基`, 'sys');
  enterGame();
  AUDIO.gong();
  // 首回合直接觸發登基劇情
  setTimeout(() => nextPhase(), 500);
}

function continueGame() {
  AUDIO.unlock(); AUDIO.click();
  const save = loadSave();
  if (!save) { initTitle(); return; }
  S = save;
  enterGame();
  nextPhase();
}

function enterGame() {
  showScreen('screen-game');
  renderHUD(true);
  renderLog();
  AUDIO.startBgm();
}

/* ============================================================
   HUD 渲染
   ============================================================ */
function renderHUD(instant) {
  $('#hud-era').textContent = `${S.era}${cnNum(yearOf(S))}年`;
  $('#hud-season').textContent = SEASONS[seasonOf(S)] + '季';
  $('#hud-title').textContent = currentTitle();
  DATA.STATS.forEach(st => {
    const v = S.stats[st.key];
    const bar = $(`#stat-${st.key} .bar-fill`);
    const num = $(`#stat-${st.key} .stat-num`);
    bar.style.width = v + '%';
    bar.classList.toggle('danger', v <= 20);
    bar.classList.toggle('rich', v >= 80);
    num.textContent = v;
    $(`#stat-${st.key}`).classList.toggle('stat-danger', v <= 20);
  });
}

function cnNum(n) {
  const d = '零一二三四五六七八九';
  if (n <= 10) return n === 10 ? '十' : d[n];
  if (n < 20) return '十' + d[n % 10];
  if (n % 10 === 0) return d[Math.floor(n / 10)] + '十';
  return d[Math.floor(n / 10)] + '十' + d[n % 10];
}

function totalScore() {
  const { min, wei, cai, jun, ti } = S.stats;
  return min + wei + cai + jun + ti;
}
function currentTitle() {
  const score = totalScore();
  let name = DATA.TITLES[0].name;
  DATA.TITLES.forEach(t => { if (score >= t.min) name = t.name; });
  return name;
}

/* ---------- 屬性變化(含飄字動畫) ---------- */
function applyFx(fx, silent) {
  if (!fx) return;
  const changes = [];
  for (const k in fx) {
    if (!(k in S.stats)) continue;
    const before = S.stats[k];
    S.stats[k] = clamp(before + fx[k], 0, 100);
    const d = S.stats[k] - before;
    if (d !== 0) changes.push({ k, d });
  }
  if (!silent && changes.length) floatChanges(changes);
  renderHUD();
}

function applyLoyal(lo) {
  if (!lo) return;
  for (const k in lo) {
    if (!(k in S.loyal)) continue;
    S.loyal[k] = clamp(S.loyal[k] + lo[k], 0, 100);
  }
}

function floatChanges(changes) {
  changes.forEach(({ k, d }, i) => {
    const stat = DATA.STATS.find(s => s.key === k);
    const host = $(`#stat-${k}`);
    if (!host) return;
    const f = el('div', 'float-num ' + (d > 0 ? 'up' : 'down'),
      `${d > 0 ? '+' : ''}${d}`);
    f.style.animationDelay = (i * 90) + 'ms';
    host.appendChild(f);
    setTimeout(() => f.remove(), 1600 + i * 90);
  });
}

/* ============================================================
   日誌
   ============================================================ */
function pushLog(text, kind) {
  S.log.push({ t: `${S.era}${cnNum(yearOf(S))}年${SEASONS[seasonOf(S)]}`, text, kind: kind || '' });
  if (S.log.length > 120) S.log.shift();
  renderLog();
}
function renderLog() {
  const box = $('#log-list');
  box.innerHTML = '';
  [...S.log].reverse().forEach(item => {
    const row = el('div', 'log-item ' + item.kind,
      `<span class="log-time">${item.t}</span><span class="log-text">${item.text}</span>`);
    box.appendChild(row);
  });
}

/* ============================================================
   回合流程
   nextPhase → (劇情事件? / 行動選擇) → 事件 → 結果 → 結算 → nextPhase
   ============================================================ */
function nextPhase() {
  if (S.over) return;
  saveGame();
  renderHUD();

  // 劇情事件優先
  const story = pickStory();
  if (story) { presentEvent(story, true); return; }

  // 否則進入行動選擇
  presentActions();
}

function pickStory() {
  const list = DATA.STORY
    .filter(e => !S.seen.includes(e.id))
    .filter(e => { try { return e.trigger(S); } catch (err) { return false; } })
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return list[0] || null;
}

/* ---------- 行動選擇 ---------- */
function presentActions() {
  const stage = $('#stage');
  stage.innerHTML = '';
  const card = el('div', 'card action-card enter');
  card.appendChild(el('div', 'card-kicker', `${S.era}${cnNum(yearOf(S))}年 · ${SEASONS[seasonOf(S)]}季`));
  card.appendChild(el('h2', 'card-title', '本季何為?'));
  card.appendChild(el('p', 'card-text action-lead', rand([
    '晨光初透,尚儀官奉上今日的安排,等陛下示下。',
    '天色微明,宮鐘三響。新的一季,自陛下的決定開始。',
    '御案上的奏摺又高了一寸。這一季,先從何處著手?',
    '掌事女官垂手立於階下,靜候聖裁。',
  ])));
  const list = el('div', 'action-list');
  DATA.ACTIONS.forEach(a => {
    const b = el('button', 'action-btn');
    b.innerHTML = `<span class="a-icon">${a.icon}</span>
      <span class="a-body"><span class="a-name">${a.name}</span>
      <span class="a-desc">${a.desc}</span></span>
      <span class="a-hint">${a.hint}</span>`;
    b.addEventListener('click', () => doAction(a));
    list.appendChild(b);
  });
  card.appendChild(list);
  stage.appendChild(card);
  busy = false;
}

function doAction(a) {
  if (busy) return; busy = true;
  AUDIO.click();
  applyFx(a.fx);
  pushLog(`行動:${a.name}`);
  const ended = checkGameOver();
  if (ended) return;
  const ev = pickEvent(a.pool);
  setTimeout(() => {
    if (ev) presentEvent(ev, false);
    else endTurn();  // 保底
  }, 420);
}

/* ---------- 抽事件 ---------- */
function pickEvent(pool) {
  let cands = DATA.EVENTS.filter(e => {
    if (e.once && S.seen.includes(e.id)) return false;
    if (S.lastEvents.includes(e.id)) return false;
    if (e.cond && !e.cond(S)) return false;
    return e.pool === pool || e.pool === 'any';
  });
  // 同池優先
  const same = cands.filter(e => e.pool === pool);
  if (same.length && Math.random() < 0.72) cands = same;
  if (!cands.length) {
    cands = DATA.EVENTS.filter(e => !S.lastEvents.slice(-4).includes(e.id));
  }
  if (!cands.length) return null;
  const ev = rand(cands);
  S.lastEvents.push(ev.id);
  if (S.lastEvents.length > 10) S.lastEvents.shift();
  return ev;
}

/* ---------- 呈現事件卡 ---------- */
function presentEvent(ev, isStory) {
  if (ev.once || isStory) S.seen.push(ev.id);
  const stage = $('#stage');
  stage.innerHTML = '';
  const card = el('div', 'card event-card enter' + (isStory ? ' story-card' : ''));
  card.appendChild(el('div', 'card-kicker', isStory ? '⭐ 國運大事' : '事件'));
  card.appendChild(el('h2', 'card-title', `<span class="ev-icon">${ev.icon}</span>${ev.title}`));
  const txt = el('p', 'card-text');
  card.appendChild(txt);
  const choiceBox = el('div', 'choice-list');
  card.appendChild(choiceBox);
  stage.appendChild(card);
  if (isStory) AUDIO.gong(); else AUDIO.flip();

  // 打字機呈現正文,完成後亮出選項
  typewriter(txt, ev.text, () => {
    ev.choices.forEach((c, idx) => {
      const b = el('button', 'choice-btn');
      const locked = c.req && S.stats[c.req.stat] < c.req.gte;
      let inner = `<span class="c-text">${c.text}</span>`;
      if (c.req) {
        const st = DATA.STATS.find(s => s.key === c.req.stat);
        inner += `<span class="c-req ${locked ? 'lack' : 'ok'}">需${st.name} ${c.req.gte}</span>`;
      }
      b.innerHTML = inner;
      if (locked) { b.classList.add('locked'); b.disabled = true; }
      else b.addEventListener('click', () => chooseOption(ev, c));
      b.style.animationDelay = (idx * 110) + 'ms';
      choiceBox.appendChild(b);
    });
    busy = false;
  });
}

/* ---------- 打字機 ---------- */
let typeTimer = null;
function typewriter(node, text, done) {
  clearInterval(typeTimer);
  const chars = [...text];
  let i = 0;
  node.innerHTML = '';
  const cursor = el('span', 'type-cursor', '▍');
  node.appendChild(cursor);
  const finish = () => {
    clearInterval(typeTimer);
    node.innerHTML = text.replace(/\n/g, '<br>');
    node.onclick = null;
    done();
  };
  node.onclick = finish;   // 點擊跳過
  typeTimer = setInterval(() => {
    if (i >= chars.length) { finish(); return; }
    const ch = chars[i++];
    cursor.insertAdjacentHTML('beforebegin', ch === '\n' ? '<br>' : escapeHtml(ch));
  }, 22);
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 選擇處理 ---------- */
function chooseOption(ev, c) {
  if (busy) return; busy = true;
  AUDIO.stamp();

  // 隨機分支
  let outcome = c;
  if (c.rand) {
    let r = Math.random(), acc = 0;
    outcome = c.rand[c.rand.length - 1];
    for (const o of c.rand) { acc += o.p; if (r < acc) { outcome = o; break; } }
    // 繼承外層 flag
    if (c.flag && !outcome.flag) outcome = Object.assign({ flag: c.flag }, outcome);
  }

  applyFx(outcome.fx);
  applyLoyal(outcome.loyal || c.loyal);
  if (outcome.flag) S.flags[outcome.flag] = true;
  if (c.flag) S.flags[c.flag] = true;
  if (ev.after) { try { ev.after(S); } catch (e) {} }

  pushLog(`【${ev.title}】${c.text}`, 'choice');

  showResult(ev, c, outcome.result || '此事就此揭過。');
}

function showResult(ev, c, resultText) {
  const stage = $('#stage');
  stage.innerHTML = '';
  const card = el('div', 'card result-card enter');
  card.appendChild(el('div', 'card-kicker', `${ev.title} · 後續`));
  card.appendChild(el('div', 'result-choice', `「${c.text}」`));
  const txt = el('p', 'card-text');
  card.appendChild(txt);
  const btn = el('button', 'primary-btn hidden-btn', '繼續');
  card.appendChild(btn);
  stage.appendChild(card);

  typewriter(txt, resultText, () => {
    btn.classList.remove('hidden-btn');
    btn.addEventListener('click', () => {
      if (busy2()) return;
      AUDIO.click();
      endTurn();
    });
    busy = false;
  });
}
let lastClick = 0;
function busy2() { const now = Date.now(); if (now - lastClick < 250) return true; lastClick = now; return false; }

/* ---------- 回合結束 ---------- */
function endTurn() {
  if (checkGameOver()) return;

  // 忠誠低 → 隱性懲罰事件已由劇情承擔;此處做輕微漂移
  drift();

  const wasYearEnd = seasonOf(S) === 3;
  S.turn++;

  if (checkGameOver()) return;

  if (wasYearEnd) { yearReport(); return; }
  nextPhase();
}

function drift() {
  // 自然衰減,迫使玩家取捨
  const keys = ['min', 'wei', 'cai', 'jun'];
  const n = yearOf(S) >= 5 ? 3 : 2;           // 後期壓力遞增
  const shuffled = [...keys].sort(() => Math.random() - 0.5).slice(0, n);
  shuffled.forEach(k => { S.stats[k] = clamp(S.stats[k] - 2, 0, 100); });
  // 盛極而衰:過高的屬性暗生驕奢,難以維持
  keys.forEach(k => {
    if (S.stats[k] >= 80) S.stats[k] = clamp(S.stats[k] - 2, 0, 100);
  });
}

/* ---------- 年度結算 ---------- */
const LOYAL_STAT = { xiang: 'wei', jiang: 'jun', hu: 'cai', wei: 'min' };

function yearReport() {
  const y = yearOf(S) - 1; // 剛結束的年份
  // 稅收:與民心掛鉤
  const tax = Math.round(2 + S.stats.min * 0.05);
  S.stats.cai = clamp(S.stats.cai + tax, 0, 100);
  // 大臣效力:忠誠高者輔益其司,離心者拖累其司
  const loyalFx = [];
  DATA.MINISTERS.forEach(m => {
    if (S.flags[m.id + '_gone']) return;
    const v = S.loyal[m.id];
    const stKey = LOYAL_STAT[m.id];
    const st = DATA.STATS.find(s => s.key === stKey);
    if (v >= 70) { S.stats[stKey] = clamp(S.stats[stKey] + 2, 0, 100); loyalFx.push(`${m.role}盡忠 ${st.name}+2`); }
    else if (v < 30) { S.stats[stKey] = clamp(S.stats[stKey] - 3, 0, 100); loyalFx.push(`${m.role}離心 ${st.name}−3`); }
  });
  const score = totalScore();
  const tone = score >= 330 ? 'great' : score >= 250 ? 'good' : 'bad';

  const stage = $('#stage');
  stage.innerHTML = '';
  const card = el('div', 'card year-card enter');
  card.appendChild(el('div', 'card-kicker', '📯 歲末總結'));
  card.appendChild(el('h2', 'card-title', `${S.era}${cnNum(y)}年 · 歲終`));

  const rows = el('div', 'year-rows');
  rows.appendChild(el('div', 'year-row', `<span>秋賦入庫</span><strong class="up">國庫 +${tax}</strong>`));
  rows.appendChild(el('div', 'year-row', `<span>天下評議</span><strong>${currentTitle()}</strong>`));
  const loyalAvg = Math.round((S.loyal.xiang + S.loyal.jiang + S.loyal.hu + S.loyal.wei) / 4);
  rows.appendChild(el('div', 'year-row', `<span>朝臣之心</span><strong>${loyalAvg >= 70 ? '眾志成城' : loyalAvg >= 45 ? '各安其位' : '離心暗生'}</strong>`));
  if (loyalFx.length) rows.appendChild(el('div', 'year-row', `<span>臣工效力</span><strong class="loyal-fx">${loyalFx.join(' · ')}</strong>`));
  card.appendChild(rows);

  card.appendChild(el('p', 'card-text year-comment', rand(DATA.YEAR_COMMENTS[tone])));

  // 盛世進度
  const prog = victoryProgress();
  const pWrap = el('div', 'victory-progress');
  pWrap.innerHTML = `<div class="vp-label">盛世之路 <span>${prog.done}/${prog.total}</span></div>`;
  const pList = el('div', 'vp-list');
  prog.items.forEach(it => {
    pList.appendChild(el('div', 'vp-item ' + (it.ok ? 'ok' : ''), `${it.ok ? '✦' : '·'} ${it.label}`));
  });
  pWrap.appendChild(pList);
  card.appendChild(pWrap);

  const btn = el('button', 'primary-btn', `步入${S.era}${cnNum(y + 1)}年`);
  btn.addEventListener('click', () => {
    if (busy2()) return;
    AUDIO.gong();
    pushLog(`—— ${S.era}${cnNum(y)}年 畢 ——`, 'sys');
    // 勝利檢查
    if (prog.done === prog.total) { endGame('end_shengshi'); return; }
    if (yearOf(S) > MAX_YEAR) { endGame(score >= 330 ? 'end_mingjun' : 'end_pingjun'); return; }
    nextPhase();
  });
  card.appendChild(btn);
  stage.appendChild(card);
  AUDIO.gong();
  saveGame();
  busy = false;
}

function victoryProgress() {
  const items = [
    { label: `在位滿${cnNum(VICTORY_YEAR)}年(現第${cnNum(yearOf(S))}年)`, ok: yearOf(S) > VICTORY_YEAR },
    { label: `民心 ≥ ${VICTORY_STAT}`, ok: S.stats.min >= VICTORY_STAT },
    { label: `威望 ≥ ${VICTORY_STAT}`, ok: S.stats.wei >= VICTORY_STAT },
    { label: `國庫 ≥ ${VICTORY_STAT}`, ok: S.stats.cai >= VICTORY_STAT },
    { label: `軍力 ≥ ${VICTORY_STAT}`, ok: S.stats.jun >= VICTORY_STAT },
  ];
  return { items, done: items.filter(i => i.ok).length, total: items.length };
}

/* ---------- 終局 ---------- */
function checkGameOver() {
  if (S.over) return true;
  for (const st of DATA.STATS) {
    if (S.stats[st.key] <= 0) {
      const end = DATA.ENDINGS.find(e => e.stat === st.key);
      endGame(end.id);
      return true;
    }
  }
  return false;
}

function endGame(endingId) {
  S.over = true;
  clearSave();
  const ending = DATA.ENDINGS.find(e => e.id === endingId);
  const meta = getMeta();
  if (!meta.endings.includes(endingId)) meta.endings.push(endingId);
  setMeta(meta);

  const isWin = ending.type === 'win';
  const isGood = ending.type === 'good' || ending.type === 'normal';

  const screen = $('#screen-ending');
  screen.className = 'screen ending-' + ending.type;
  $('#ending-icon').textContent = ending.icon;
  $('#ending-type').textContent = isWin ? '傳奇結局' : isGood ? '終局' : '國殤';
  $('#ending-title').textContent = ending.title;
  $('#ending-years').textContent = `${S.era}年間 · 在位${cnNum(yearOf(S))}年`;

  // 統計
  const statBox = $('#ending-stats');
  statBox.innerHTML = '';
  DATA.STATS.forEach(st => {
    statBox.appendChild(el('div', 'end-stat',
      `<span>${st.icon} ${st.name}</span><strong>${S.stats[st.key]}</strong>`));
  });

  const txt = $('#ending-text');
  txt.innerHTML = '';
  showScreen('screen-ending');
  if (isWin) AUDIO.victory(); else AUDIO.gongLow();

  typewriter(txt, ending.text, () => { busy = false; });
}

/* ============================================================
   結局圖鑑
   ============================================================ */
function openGallery() {
  AUDIO.unlock(); AUDIO.click();
  const meta = getMeta();
  const box = $('#gallery-list');
  box.innerHTML = '';
  DATA.ENDINGS.forEach(e => {
    const got = meta.endings.includes(e.id);
    const item = el('div', 'gallery-item ' + (got ? 'unlocked' : 'locked-item'));
    item.innerHTML = got
      ? `<span class="g-icon">${e.icon}</span><div><div class="g-title">${e.title}</div><div class="g-sub">${e.type === 'win' ? '傳奇' : e.type === 'fail' ? '敗局' : '善終'}</div></div>`
      : `<span class="g-icon">❓</span><div><div class="g-title">???</div><div class="g-sub">尚未解鎖</div></div>`;
    box.appendChild(item);
  });
  showScreen('screen-gallery');
}

/* ============================================================
   大臣面板
   ============================================================ */
function openMinisters() {
  AUDIO.click();
  const box = $('#minister-list');
  box.innerHTML = '';
  DATA.MINISTERS.forEach(m => {
    const v = S.loyal[m.id];
    const gone = S.flags[m.id + '_gone'];
    const mood = gone ? '已離朝' : v >= 75 ? '忠心耿耿' : v >= 50 ? '恪盡職守' : v >= 30 ? '心存疑慮' : '貌合神離';
    const item = el('div', 'minister-item' + (gone ? ' m-gone' : ''));
    item.innerHTML = `<span class="m-icon">${m.icon}</span>
      <div class="m-body">
        <div class="m-name">${m.name} <small>${m.role}</small></div>
        <div class="m-intro">${m.intro}</div>
        <div class="m-loyal"><div class="m-bar"><div class="m-fill" style="width:${gone ? 0 : v}%"></div></div>
        <span class="m-mood">${mood}</span></div>
      </div>`;
    box.appendChild(item);
  });
  $('#panel-ministers').classList.add('open');
}

/* ============================================================
   綁定
   ============================================================ */
function bindUI() {
  $('#btn-new').addEventListener('click', openNewGame);
  $('#btn-continue').addEventListener('click', continueGame);
  $('#btn-gallery').addEventListener('click', openGallery);
  $('#btn-era-back').addEventListener('click', () => { AUDIO.click(); initTitle(); });
  $('#btn-gallery-back').addEventListener('click', () => { AUDIO.click(); initTitle(); });
  $('#btn-ending-back').addEventListener('click', () => { AUDIO.click(); initTitle(); });
  $('#btn-ending-new').addEventListener('click', openNewGame);

  $('#btn-ministers').addEventListener('click', openMinisters);
  $('#btn-ministers-close').addEventListener('click', () => {
    AUDIO.click(); $('#panel-ministers').classList.remove('open');
  });
  $('#panel-ministers').addEventListener('click', e => {
    if (e.target === $('#panel-ministers')) $('#panel-ministers').classList.remove('open');
  });

  $('#btn-log').addEventListener('click', () => {
    AUDIO.click(); $('#panel-log').classList.toggle('open');
  });
  $('#btn-log-close').addEventListener('click', () => {
    AUDIO.click(); $('#panel-log').classList.remove('open');
  });
  $('#panel-log').addEventListener('click', e => {
    if (e.target === $('#panel-log')) $('#panel-log').classList.remove('open');
  });

  $('#btn-sound').textContent = AUDIO.enabled ? '🔊' : '🔇';
  $('#btn-sound').addEventListener('click', () => {
    const on = AUDIO.toggle();
    $('#btn-sound').textContent = on ? '🔊' : '🔇';
  });

  $('#btn-home').addEventListener('click', () => {
    AUDIO.click();
    // 不在此處存檔:存檔點固定於每季之初,避免中途離開跳過事件
    initTitle();
  });

  // 屬性提示
  DATA.STATS.forEach(st => {
    const node = $(`#stat-${st.key}`);
    node.title = `${st.name}:${st.desc}`;
  });

  // 教學提示輪播
  let tipIdx = 0;
  const tipNode = $('#title-tip');
  const rotate = () => { tipNode.textContent = '💡 ' + DATA.TUTORIAL[tipIdx % DATA.TUTORIAL.length]; tipIdx++; };
  rotate();
  setInterval(rotate, 5000);
}

/* ---------- 建構 HUD 屬性列 ---------- */
function buildStatBar() {
  const bar = $('#stat-bar');
  DATA.STATS.forEach(st => {
    const item = el('div', 'stat-item', `
      <div class="stat-head"><span class="stat-icon">${st.icon}</span><span class="stat-name">${st.name}</span><span class="stat-num">0</span></div>
      <div class="bar-track"><div class="bar-fill"></div></div>`);
    item.id = 'stat-' + st.key;
    bar.appendChild(item);
  });
}

/* ---------- 啟動 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  buildStatBar();
  bindUI();
  initTitle();
});
