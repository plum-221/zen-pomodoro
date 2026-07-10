// plant.js — 可复用的 SVG 生长植物。整株从很小一直往上延展、抽高、长大。
// 用法：const plant = new Plant(svgElement); plant.setGrowth(0..1); plant.gust(); plant.wither();
(function (global) {
  const NS = "http://www.w3.org/2000/svg";
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const easeOut = (x) => 1 - Math.pow(1 - x, 2);

  const STAGES = [
    [0, "萌芽"], [0.15, "抽茎"], [0.35, "展叶"],
    [0.55, "繁茂"], [0.78, "含苞"], [0.95, "绽放"],
  ];
  function stageName(g) {
    let n = "萌芽";
    for (const [th, name] of STAGES) if (g >= th) n = name;
    return n;
  }

  const BASE_Y = 470;          // 土面
  const MIN_H = 52;            // 萌芽时的最小高度（保证待机也看得见一小株）
  const MAX_H = 360;           // 完全长成的高度

  class Plant {
    constructor(svg) {
      this.svg = svg;
      svg.setAttribute("viewBox", "0 0 400 500");
      svg.setAttribute("preserveAspectRatio", "xMidYMax meet");
      svg.innerHTML = `
        <defs>
          <linearGradient id="stemGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="var(--stem-a)"/>
            <stop offset="1" stop-color="var(--stem-b)"/>
          </linearGradient>
          <linearGradient id="leafGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="var(--leaf-b)"/>
            <stop offset="1" stop-color="var(--leaf-a)"/>
          </linearGradient>
          <radialGradient id="soilGrad" cx="50%" cy="0%" r="80%">
            <stop offset="0" stop-color="var(--soil-a)"/>
            <stop offset="1" stop-color="var(--soil-b)"/>
          </radialGradient>
        </defs>
        <ellipse cx="200" cy="472" rx="150" ry="26" fill="url(#soilGrad)"/>
        <ellipse cx="200" cy="466" rx="120" ry="16" fill="var(--soil-a)" opacity=".55"/>
        <g id="plantGroup">
          <path id="stemPath" fill="none" stroke="url(#stemGrad)" stroke-linecap="round"/>
          <g id="leavesG"></g>
          <g id="flowerG"></g>
        </g>`;
      this.plant = svg.querySelector("#plantGroup");
      this.stem = svg.querySelector("#stemPath");
      this.leavesG = svg.querySelector("#leavesG");
      this.flowerG = svg.querySelector("#flowerG");

      // 叶子：f = 在当前茎上的位置（0 底 1 顶），appear = 开始冒出的生长值
      const leafDefs = [
        { f: 0.34, side: -1, size: 0.75, appear: 0.0 },   // 子叶
        { f: 0.5, side: 1, size: 0.75, appear: 0.02 },    // 子叶
        { f: 0.44, side: -1, size: 1.0, appear: 0.16 },
        { f: 0.58, side: 1, size: 1.1, appear: 0.32 },
        { f: 0.70, side: -1, size: 1.05, appear: 0.48 },
        { f: 0.82, side: 1, size: 0.9, appear: 0.64 },
        { f: 0.90, side: -1, size: 0.75, appear: 0.78 },
      ];
      this.leaves = leafDefs.map((d, i) => {
        const g = document.createElementNS(NS, "g");
        const blade = document.createElementNS(NS, "path");
        blade.setAttribute("d", "M0,0 C 12,-8 14,-30 0,-44 C -14,-30 -12,-8 0,0 Z");
        blade.setAttribute("fill", "url(#leafGrad)");
        const rib = document.createElementNS(NS, "path");
        rib.setAttribute("d", "M0,-2 C 1,-16 1,-30 0,-42");
        rib.setAttribute("stroke", "rgba(255,255,255,.45)");
        rib.setAttribute("stroke-width", "1.3");
        rib.setAttribute("fill", "none");
        g.appendChild(blade); g.appendChild(rib);
        this.leavesG.appendChild(g);
        return { ...d, g, phase: i * 1.3 };
      });

      for (let i = 0; i < 6; i++) {
        const p = document.createElementNS(NS, "ellipse");
        p.setAttribute("cx", "0"); p.setAttribute("cy", "-9");
        p.setAttribute("rx", "6"); p.setAttribute("ry", "11");
        p.setAttribute("fill", "var(--petal)");
        p.setAttribute("transform", `rotate(${i * 60})`);
        this.flowerG.appendChild(p);
      }
      this.core = document.createElementNS(NS, "circle");
      this.core.setAttribute("r", "6");
      this.core.setAttribute("fill", "var(--petal-core)");
      this.flowerG.appendChild(this.core);

      this.growth = 0; this.target = 0;
      this.wa = 0; this.wv = 0; this.wilt = 0;
      this.last = performance.now();
      this.onStage = null; this._stage = "";
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    setGrowth(v) { this.target = clamp(v, 0, 1); }
    gust() { this.wv += (Math.random() > 0.5 ? 1 : -1) * 7; }
    wither() { this.wilt = 1; this.gust(); }
    stageName() { return stageName(this.growth); }

    _stemPath(H, bend) {
      const tipY = BASE_Y - H;
      return `M200,${BASE_Y} C ${200 - bend},${BASE_Y - H * 0.4} ${200 + bend},${BASE_Y - H * 0.75} 200,${tipY}`;
    }

    _loop(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;

      this.growth += (this.target - this.growth) * Math.min(1, dt * 2.2);
      this.wilt += (0 - this.wilt) * Math.min(1, dt * 0.8);
      const g = this.growth;

      const breeze = Math.sin(now / 1300) * 0.05 + Math.sin(now / 430) * 0.015;
      this.wv += (-(this.wa - breeze) * 11 - this.wv * 3.4) * dt;
      this.wa += this.wv * dt;

      // 整株的高度随生长真实往上延展
      const H = MIN_H + easeOut(g) * (MAX_H - MIN_H);
      const bend = 12 * (0.4 + 0.6 * g);
      this.stem.setAttribute("d", this._stemPath(H, bend + this.wilt * 6));
      this.stem.setAttribute("stroke-width", 3 + g * 4.5);
      const L = this.stem.getTotalLength();

      this.plant.setAttribute("transform",
        `rotate(${this.wa * 46 + this.wilt * 4} 200 ${BASE_Y})`);

      // 叶子跟着整株一起平滑长大，位置随茎往上移
      const overall = 0.5 + easeOut(g) * 0.8;
      for (const lf of this.leaves) {
        const appear = clamp((g - lf.appear) / 0.2, 0, 1);
        if (appear <= 0) { lf.g.style.display = "none"; continue; }
        lf.g.style.display = "";
        const pt = this.stem.getPointAtLength(clamp(lf.f, 0, 1) * L);
        const s = easeOut(appear) * lf.size * overall * (1 - 0.22 * this.wilt);
        const base = lf.side * 50 + lf.side * 16 * this.wilt;
        const sway = this.wa * 70 * (0.4 + lf.f) + Math.sin(now / 650 + lf.phase) * 3.2 * appear;
        lf.g.setAttribute("transform",
          `translate(${pt.x},${pt.y}) rotate(${base + sway}) scale(${lf.side * Math.abs(s)},${Math.abs(s)})`);
      }

      // 顶端开花
      const bloom = clamp((g - 0.82) / 0.18, 0, 1);
      if (bloom <= 0) { this.flowerG.style.display = "none"; }
      else {
        this.flowerG.style.display = "";
        const tip = this.stem.getPointAtLength(0.995 * L);
        const s = easeOut(bloom) * overall * (1 - 0.15 * this.wilt);
        const spin = Math.sin(now / 1400) * 4 + this.wa * 30;
        this.flowerG.setAttribute("transform",
          `translate(${tip.x},${tip.y}) rotate(${spin}) scale(${s})`);
        this.core.setAttribute("r", 6 * s);
      }

      const st = stageName(g);
      if (st !== this._stage) { this._stage = st; if (this.onStage) this.onStage(st); }

      requestAnimationFrame(this._loop);
    }
  }

  Plant.stageName = stageName;
  global.Plant = Plant;
})(window);
