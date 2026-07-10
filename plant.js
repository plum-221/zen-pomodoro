// plant.js — 可复用的 SVG 生长植物。纯原生，无依赖。
// 用法：const plant = new Plant(svgElement); plant.setGrowth(0..1); plant.gust(); plant.wither();
(function (global) {
  const NS = "http://www.w3.org/2000/svg";
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const easeOutBack = (x) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };

  const STAGES = [
    [0, "萌芽"], [0.15, "抽茎"], [0.35, "展叶"],
    [0.55, "繁茂"], [0.78, "含苞"], [0.95, "绽放"],
  ];
  function stageName(g) {
    let n = "萌芽";
    for (const [th, name] of STAGES) if (g >= th) n = name;
    return n;
  }

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
          <path id="stemPath" d="M200,470 C 194,395 212,330 200,262 C 190,205 208,150 200,86"
                fill="none" stroke="url(#stemGrad)" stroke-width="7"
                stroke-linecap="round" pathLength="1"/>
          <g id="leavesG"></g>
          <g id="flowerG"></g>
        </g>`;
      this.plant = svg.querySelector("#plantGroup");
      this.stem = svg.querySelector("#stemPath");
      this.leavesG = svg.querySelector("#leavesG");
      this.flowerG = svg.querySelector("#flowerG");
      this.L = this.stem.getTotalLength();
      this.stem.style.strokeDasharray = this.L;

      const leafDefs = [
        // 两片子叶：一开始就有，构成可见的“小萌芽”
        { t: 0.028, side: -1, size: 0.5 }, { t: 0.05, side: 1, size: 0.5 },
        { t: 0.20, side: -1, size: 1.0 }, { t: 0.34, side: 1, size: 1.1 },
        { t: 0.48, side: -1, size: 1.15 }, { t: 0.60, side: 1, size: 1.05 },
        { t: 0.72, side: -1, size: 0.9 }, { t: 0.82, side: 1, size: 0.8 },
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

      this.growth = 0;      // 当前显示的生长值
      this.target = 0;      // 目标生长值（平滑过渡）
      this.wa = 0; this.wv = 0;   // 风力弹簧
      this.wilt = 0;              // 蔫萎程度 0..1
      this.last = performance.now();
      this.onStage = null;        // 阶段变化回调
      this._stage = "";
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    setGrowth(v) { this.target = clamp(v, 0, 1); }
    gust() { this.wv += (Math.random() > 0.5 ? 1 : -1) * 7; }
    wither() { this.wilt = 1; this.gust(); }
    stageName() { return stageName(this.growth); }

    _loop(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;

      this.growth += (this.target - this.growth) * Math.min(1, dt * 2.2);
      this.wilt += (0 - this.wilt) * Math.min(1, dt * 0.8);

      const breeze = Math.sin(now / 1300) * 0.05 + Math.sin(now / 430) * 0.015;
      this.wv += (-(this.wa - breeze) * 11 - this.wv * 3.4) * dt;
      this.wa += this.wv * dt;

      // shown：即使 growth=0，也保留极短一截茎，让萌芽一直可见（别太高）
      const shown = 0.05 + 0.95 * this.growth;

      this.plant.setAttribute("transform",
        `rotate(${this.wa * 46 + this.wilt * 4} 200 470)`);
      this.stem.style.strokeDashoffset = this.L * (1 - shown);

      for (const lf of this.leaves) {
        const unf = clamp((shown - lf.t) / 0.14, 0, 1);
        if (unf <= 0) { lf.g.style.display = "none"; continue; }
        lf.g.style.display = "";
        const pt = this.stem.getPointAtLength(clamp(lf.t, 0, 1) * this.L);
        const s = easeOutBack(unf) * lf.size * (1 - 0.22 * this.wilt);
        const base = lf.side * 52 + lf.side * 16 * this.wilt;
        const sway = this.wa * 70 * (0.4 + lf.t) + Math.sin(now / 650 + lf.phase) * 3.2 * unf;
        lf.g.setAttribute("transform",
          `translate(${pt.x},${pt.y}) rotate(${base + sway}) scale(${lf.side * Math.abs(s)},${Math.abs(s)})`);
      }

      const bloom = clamp((shown - 0.9) / 0.1, 0, 1);
      if (bloom <= 0) { this.flowerG.style.display = "none"; }
      else {
        this.flowerG.style.display = "";
        const tip = this.stem.getPointAtLength(0.995 * this.L);
        const s = easeOutBack(bloom) * (1 - 0.15 * this.wilt);
        const spin = Math.sin(now / 1400) * 4 + this.wa * 30;
        this.flowerG.setAttribute("transform",
          `translate(${tip.x},${tip.y}) rotate(${spin}) scale(${s})`);
        this.core.setAttribute("r", 6 * s);
      }

      const st = stageName(this.growth);
      if (st !== this._stage) { this._stage = st; if (this.onStage) this.onStage(st); }

      requestAnimationFrame(this._loop);
    }
  }

  Plant.stageName = stageName;
  global.Plant = Plant;
})(window);
