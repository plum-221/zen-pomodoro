// app.js — 禅意番茄钟核心逻辑。纯原生，无依赖。
(function () {
  "use strict";

  const KEY = "zenPomodoro.v1";
  const $ = (id) => document.getElementById(id);

  // ---------- 状态 ----------
  const DEFAULTS = {
    settings: { focus: 25, short: 5, long: 15, longEvery: 4, sound: true, soundName: "bell", notify: false, theme: "", customAccent: "" },
    tasks: [],
    activeTaskId: null,
    pomoCount: 0,       // 今日已完成番茄数
    day: todayStr(),    // 记录“今天”，跨天重置
    plantGrowth: 0,     // 植物生长 0..1
    cycle: 0,           // 已完成专注计数（用于长休节奏）
    session: null,      // { mode, endAt, remainingMs, running }
  };

  let state = load();
  const PLANT_BLOOM_AT = 6;   // 完成 6 个番茄，植物开满

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULTS);
      const s = Object.assign(structuredClone(DEFAULTS), JSON.parse(raw));
      s.settings = Object.assign({}, DEFAULTS.settings, s.settings || {});
      return s;
    } catch (e) { return structuredClone(DEFAULTS); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  // 跨天重置：植物与今日计数每天从头；任务的“今日数”清零，但“累计”保留可重复积累
  if (state.day !== todayStr()) {
    state.day = todayStr();
    state.pomoCount = 0;
    state.plantGrowth = 0;
    state.cycle = 0;
    state.tasks.forEach((t) => { t.completed = 0; });
    save();
  }

  // ---------- 计时器 ----------
  const MODE_LABEL = { focus: "专注时间", short: "短暂休息", long: "长休息" };
  let running = false;
  let endAt = 0;         // 目标结束时间戳（ms）
  let remainingMs = 0;   // 暂停时保存的剩余
  let mode = "focus";

  function durationMs(m) { return state.settings[m] * 60 * 1000; }

  function setMode(m, resetTimer = true) {
    mode = m;
    document.querySelectorAll(".modes button").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === m));
    $("modeLabel").textContent = MODE_LABEL[m];
    const ring = $("ring");
    ring.style.stroke = m === "focus" ? "var(--ring-focus)" : "var(--ring-break)";
    if (resetTimer) { running = false; remainingMs = durationMs(m); endAt = 0; }
    render();
  }

  function startPause() {
    if (running) {                       // 暂停
      remainingMs = Math.max(0, endAt - Date.now());
      running = false;
    } else {                             // 开始 / 继续
      if (remainingMs <= 0) remainingMs = durationMs(mode);
      endAt = Date.now() + remainingMs;
      running = true;
      if (state.settings.notify) ensureNotifyPermission();
      unlockAudio();
    }
    persistSession();
    render();
  }

  function resetTimer() {
    running = false;
    remainingMs = durationMs(mode);
    endAt = 0;
    persistSession();
    render();
  }

  function skip() { complete(true); }

  function complete(skipped) {
    running = false;
    if (mode === "focus" && !skipped) {
      state.pomoCount += 1;
      state.cycle += 1;
      state.plantGrowth = Math.min(1, state.pomoCount / PLANT_BLOOM_AT);
      plant.setGrowth(state.plantGrowth);
      const t = activeTask();
      if (t) { t.completed = (t.completed || 0) + 1; t.total = (t.total || 0) + 1; renderTasks(); }
      notify("专注完成 🌱", "植物又长了一节，休息一下吧");
      chime();
      const next = state.cycle % state.settings.longEvery === 0 ? "long" : "short";
      setMode(next);
    } else if (mode === "focus" && skipped) {
      plant.wither();
      toast("已跳过这个番茄");
      setMode("focus");
    } else {
      notify("休息结束", "开始下一段专注吧");
      chime();
      setMode("focus");
    }
    save();
    render();
  }

  function tick() {
    if (running) {
      remainingMs = endAt - Date.now();
      if (remainingMs <= 0) { remainingMs = 0; complete(false); }
    }
    render();
  }

  function persistSession() {
    state.session = running ? { mode, endAt, running: true } : { mode, remainingMs, running: false };
    save();
  }

  // ---------- 渲染 ----------
  const RING_LEN = 2 * Math.PI * 90;
  $("ring").style.strokeDasharray = RING_LEN;

  function render() {
    const total = durationMs(mode);
    const rem = running ? Math.max(0, endAt - Date.now()) : remainingMs;
    const mm = Math.floor(rem / 60000);
    const ss = Math.floor((rem % 60000) / 1000);
    $("time").textContent = String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
    const frac = total > 0 ? rem / total : 0;
    $("ring").style.strokeDashoffset = RING_LEN * (1 - frac);
    $("startBtn").textContent = running ? "暂停" : (remainingMs < total && remainingMs > 0 ? "继续" : "开始");
    $("pomoCount").textContent = state.pomoCount;
    if (document.title.indexOf("·") > -1 || running) {
      document.title = (running ? $("time").textContent + " " : "") + "禅 · 番茄钟";
    }
  }

  // ---------- 任务 ----------
  function activeTask() { return state.tasks.find((t) => t.id === state.activeTaskId) || null; }

  function addTask() {
    const name = $("taskName").value.trim();
    if (!name) return;
    const est = Math.max(1, parseInt($("taskEst").value, 10) || 1);
    const id = Date.now().toString(36);
    state.tasks.push({ id, name, est, completed: 0, total: 0, done: false });
    if (!state.activeTaskId) state.activeTaskId = id;
    $("taskName").value = ""; $("taskEst").value = "1";
    save(); renderTasks();
  }

  function renderTasks() {
    const ul = $("taskList");
    ul.innerHTML = "";
    $("emptyHint").style.display = state.tasks.length ? "none" : "block";
    state.tasks.forEach((t, i) => {
      const li = document.createElement("li");
      li.className = "task" + (t.done ? " done" : "") + (t.id === state.activeTaskId ? " active" : "");
      li.innerHTML =
        `<span class="check" title="完成"></span>
         <span class="name" title="点选为当前任务">${escapeHtml(t.name)}</span>
         <span class="pomo">今日 ${t.completed || 0}/${t.est}${(t.total || 0) > (t.completed || 0) ? " · 累计 " + t.total : ""} 🍅</span>
         <span class="ops">
           <button data-op="up" title="上移">▲</button>
           <button data-op="down" title="下移">▼</button>
           <button data-op="del" title="删除">✕</button>
         </span>`;
      li.querySelector(".check").onclick = () => { t.done = !t.done; save(); renderTasks(); };
      li.querySelector(".name").onclick = () => { state.activeTaskId = t.id; save(); renderTasks(); };
      li.querySelector(".name").ondblclick = () => renameTask(t);
      li.querySelector('[data-op="up"]').onclick = () => moveTask(i, -1);
      li.querySelector('[data-op="down"]').onclick = () => moveTask(i, 1);
      li.querySelector('[data-op="del"]').onclick = () => delTask(t.id);
      ul.appendChild(li);
    });
  }
  function renameTask(t) {
    const v = prompt("修改任务名", t.name);
    if (v && v.trim()) { t.name = v.trim(); save(); renderTasks(); }
  }
  function moveTask(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= state.tasks.length) return;
    [state.tasks[i], state.tasks[j]] = [state.tasks[j], state.tasks[i]];
    save(); renderTasks();
  }
  function delTask(id) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    if (state.activeTaskId === id) state.activeTaskId = state.tasks[0] ? state.tasks[0].id : null;
    save(); renderTasks();
  }
  function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---------- 提醒 ----------
  let audioCtx = null;
  function unlockAudio() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }
  // 一个音的通用发声器
  function tone(ctx, t0, { f, f2, dur, peak = 0.18, type = "sine" }) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // 全部现场合成，无需音频文件
  const SOUNDS = {
    bell(ctx, n) { [523.25, 659.25, 783.99].forEach((f, i) => tone(ctx, n + i * 0.08, { f, dur: 1.6, peak: 0.16 })); },
    bowl(ctx, n) { [true, false].forEach((base) => tone(ctx, n, { f: base ? 220 : 440, dur: 2.6, peak: base ? 0.16 : 0.07 })); },
    woodfish(ctx, n) { [0, 0.22].forEach((d) => tone(ctx, n + d, { f: 420, f2: 150, dur: 0.12, peak: 0.28, type: "triangle" })); },
    windchime(ctx, n) { [1046, 1318, 1568, 2093, 1760].forEach((f, i) => tone(ctx, n + i * 0.11, { f, dur: 1.1, peak: 0.09 })); },
    bird(ctx, n) { [0, 0.16].forEach((d) => tone(ctx, n + d, { f: 1900, f2: 2600, dur: 0.14, peak: 0.12 })); },
    drop(ctx, n) { tone(ctx, n, { f: 900, f2: 200, dur: 0.35, peak: 0.22 }); },
  };
  const SOUND_LIST = [["bell", "钟磬"], ["bowl", "颂钵"], ["woodfish", "木鱼"], ["windchime", "风铃"], ["bird", "鸟鸣"], ["drop", "水滴"]];

  function playSound(name) {
    if (!audioCtx) return;
    (SOUNDS[name] || SOUNDS.bell)(audioCtx, audioCtx.currentTime);
  }
  function chime() {
    if (!state.settings.sound) return;
    unlockAudio();
    playSound(state.settings.soundName || "bell");
  }
  function ensureNotifyPermission() {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }
  function notify(title, body) {
    toast(title);
    if (state.settings.notify && "Notification" in window && Notification.permission === "granted") {
      try { new Notification(title, { body, silent: true }); } catch (e) {}
    }
  }
  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // ---------- 配色主题 ----------
  function applyThemeAll() {
    const t = state.settings.theme || "";
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    applyCustomAccent(state.settings.customAccent || "");
    markSwatches();
  }
  function applyCustomAccent(color) {
    const s = document.documentElement.style;
    if (color) {
      s.setProperty("--accent", color);
      s.setProperty("--accent-soft", `color-mix(in srgb, ${color}, #fff 22%)`);
      s.setProperty("--ring-focus", color);
    } else {
      s.removeProperty("--accent"); s.removeProperty("--accent-soft"); s.removeProperty("--ring-focus");
    }
  }
  function markSwatches() {
    document.querySelectorAll("#themeSwatches .sw[data-theme]").forEach((b) =>
      b.classList.toggle("selected",
        !state.settings.customAccent && (b.dataset.theme || "") === (state.settings.theme || "")));
    const cs = document.querySelector(".sw.custom");
    if (cs) cs.classList.toggle("selected", !!state.settings.customAccent);
  }
  function pickTheme(name) {
    state.settings.theme = name; state.settings.customAccent = "";
    applyThemeAll(); save();
  }
  function pickCustom(color) {
    state.settings.customAccent = color;
    applyCustomAccent(color); markSwatches(); save();
  }

  // ---------- 设置 ----------
  function openSettings() {
    markSwatches();
    if (state.settings.customAccent) $("customAccent").value = state.settings.customAccent;
    $("cfgFocus").value = state.settings.focus;
    $("cfgShort").value = state.settings.short;
    $("cfgLong").value = state.settings.long;
    $("cfgEvery").value = state.settings.longEvery;
    $("cfgSound").checked = state.settings.sound;
    $("cfgSoundName").value = state.settings.soundName || "bell";
    $("cfgNotify").checked = state.settings.notify;
    $("settingsModal").classList.add("show");
  }
  function saveSettings() {
    const clampNum = (v, a, b, d) => Math.min(b, Math.max(a, parseInt(v, 10) || d));
    state.settings.focus = clampNum($("cfgFocus").value, 1, 120, 25);
    state.settings.short = clampNum($("cfgShort").value, 1, 60, 5);
    state.settings.long = clampNum($("cfgLong").value, 1, 60, 15);
    state.settings.longEvery = clampNum($("cfgEvery").value, 2, 10, 4);
    state.settings.sound = $("cfgSound").checked;
    state.settings.soundName = $("cfgSoundName").value;
    state.settings.notify = $("cfgNotify").checked;
    if (state.settings.notify) ensureNotifyPermission();
    save();
    $("settingsModal").classList.remove("show");
    if (!running) resetTimer(); else render();
    toast("设置已保存");
  }

  // ---------- 恢复上次会话 ----------
  const plant = new Plant($("plant"));
  plant.onStage = (name) => { $("stageName").textContent = name; };
  plant.setGrowth(state.plantGrowth);

  function restore() {
    const s = state.session;
    if (!s) { setMode("focus"); renderTasks(); return; }
    mode = s.mode || "focus";
    setMode(mode, false);
    if (s.running && s.endAt) {
      if (Date.now() < s.endAt) {                 // 还没到点 → 无缝续上
        endAt = s.endAt; running = true; remainingMs = endAt - Date.now();
        toast("已恢复上次的专注");
      } else {                                    // 离开期间已到点 → 判定完成
        running = false; remainingMs = 0;
        setTimeout(() => complete(false), 400);
      }
    } else {
      running = false;
      remainingMs = (s.remainingMs != null) ? s.remainingMs : durationMs(mode);
    }
    renderTasks();
    render();
  }

  // ---------- 绑定 ----------
  $("startBtn").onclick = startPause;
  $("resetBtn").onclick = resetTimer;
  $("skipBtn").onclick = skip;
  document.querySelectorAll(".modes button").forEach((b) =>
    b.onclick = () => { setMode(b.dataset.mode); persistSession(); });
  $("addTask").onclick = addTask;
  $("taskName").addEventListener("keydown", (e) => { if (e.key === "Enter") addTask(); });
  $("settingsBtn").onclick = openSettings;
  document.querySelectorAll("#themeSwatches .sw[data-theme]").forEach((b) =>
    b.onclick = () => pickTheme(b.dataset.theme || ""));
  $("customAccent").oninput = (e) => pickCustom(e.target.value);
  $("previewSound").onclick = () => { unlockAudio(); playSound($("cfgSoundName").value); };
  $("cfgSoundName").onchange = () => { unlockAudio(); playSound($("cfgSoundName").value); };
  $("cfgSave").onclick = saveSettings;
  $("cfgCancel").onclick = () => $("settingsModal").classList.remove("show");
  $("settingsModal").onclick = (e) => { if (e.target.id === "settingsModal") $("settingsModal").classList.remove("show"); };

  applyThemeAll();
  restore();
  setInterval(tick, 250);

  // PWA：注册 service worker（失败也不影响使用）
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
