/* Smooth scrolling, a thread that draws itself down the page, and scroll-linked type.
   Uses $, $$ and reduceMotion from app.js. */
(() => {
  /* ---------- smooth inertial scroll (local Lenis) ---------- */
  let lenis = null;
  if (!reduceMotion && window.Lenis) {
    document.documentElement.style.scrollBehavior = "auto";
    lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.5,
    });
    document.addEventListener("click", e => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute("href");
      if (!id) return;
      const el = id === "#top" ? 0 : document.querySelector(id);
      if (el === null && id !== "#top") return;
      e.preventDefault();
      lenis.scrollTo(el === 0 ? 0 : el, { offset: el ? -80 : 0, duration: 1.2 });
    });
  }

  /* ---------- the thread ---------- */
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.classList.add("thread"); svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path class="th-ghost"/><path class="th-line"/><g class="th-nodes"></g>
    <g class="th-head"><circle class="th-ring" r="14"/><circle class="dot" r="5"/></g>`;
  document.body.appendChild(svg);
  const ghost = svg.querySelector(".th-ghost"), line = svg.querySelector(".th-line");
  const nodesG = svg.querySelector(".th-nodes"), head = svg.querySelector(".th-head");
  let samples = [], nodes = [], L = 0, cur = 0;

  function build() {
    const W = document.documentElement.clientWidth;
    const foot = $(".foot");
    const docH = foot ? foot.getBoundingClientRect().bottom + window.scrollY : document.documentElement.scrollHeight;
    svg.setAttribute("width", W); svg.setAttribute("height", docH); svg.setAttribute("viewBox", `0 0 ${W} ${docH}`);
    const gut = Math.max(14, Math.min(64, (W - 1240) / 2 * .5));
    const pos = el => el.getBoundingClientRect().top + window.scrollY;

    const hero = $(".hero");
    let px = W / 2, py = hero ? pos(hero) + hero.offsetHeight - 30 : 200;
    let d = `M ${px} ${py}`;
    const wps = $$("[data-thread]").map((el, i) => {
      const side = i % 2 ? "r" : "l";
      return { x: side === "l" ? gut : W - gut, y: pos(el) + 46, side, label: el.dataset.thread, loop: el.hasAttribute("data-loop") };
    });
    for (const w of wps) {
      const dy = w.y - py;
      d += ` C ${px} ${py + dy * .55} ${w.x} ${w.y - dy * .55} ${w.x} ${w.y}`;
      if (w.loop) {
        const r = 28, k = w.side === "l" ? 1 : -1;
        d += ` a ${r} ${r} 0 1 ${w.side === "l" ? 1 : 0} ${2 * r * k} 0 a ${r} ${r} 0 1 ${w.side === "l" ? 1 : 0} ${-2 * r * k} 0`;
      }
      px = w.x; py = w.y;
    }
    const end = $(".cta .big-pill");
    if (end) {
      const eb = end.getBoundingClientRect();
      const ex = eb.left + eb.width / 2, ey = eb.top + window.scrollY - 14, dy = ey - py;
      d += ` C ${px} ${py + dy * .55} ${ex} ${ey - dy * .55} ${ex} ${ey}`;
    }
    ghost.setAttribute("d", d); line.setAttribute("d", d);

    L = line.getTotalLength();
    line.style.strokeDasharray = L;
    samples = [];
    for (let l = 0; l <= L; l += 6) {
      const p = line.getPointAtLength(l);
      samples.push([l, p.x, p.y]);
    }

    nodesG.innerHTML = "";
    nodes = wps.map(w => {
      const g = document.createElementNS(NS, "g"); g.classList.add("th-node");
      const tx = w.side === "l" ? w.x + 16 : w.x - 16;
      g.innerHTML = `<circle cx="${w.x}" cy="${w.y}" r="5"/><text x="${tx}" y="${w.y + 4}" text-anchor="${w.side === "l" ? "start" : "end"}">${w.label.toUpperCase()}</text>`;
      nodesG.appendChild(g);
      const s = samples.find(s => s[2] >= w.y - 1) || samples[samples.length - 1];
      return { g, l: s ? s[0] : 0 };
    });
  }

  function getPointFast(l) {
    if (!samples.length) return { x: 0, y: 0 };
    const idx = Math.min(samples.length - 1, Math.max(0, Math.floor(l / 6)));
    const nextIdx = Math.min(samples.length - 1, idx + 1);
    const frac = (l - idx * 6) / 6;
    const a = samples[idx], b = samples[nextIdx];
    return {
      x: a[1] + (b[1] - a[1]) * frac,
      y: a[2] + (b[2] - a[2]) * frac
    };
  }

  function lengthAtViewport() {
    const target = window.scrollY + window.innerHeight * .62;
    let i = 0;
    while (i < samples.length - 1 && samples[i + 1][2] <= target) i++;
    return samples.length ? samples[i][0] : 0;
  }

  /* ---------- scroll-linked type ---------- */
  const headline = $(".headline");
  let titles = [];
  function refreshTitles() {
    titles = $$(".sec-title").map(t => ({
      el: t,
      thins: [...t.querySelectorAll(".thin")],
      bolds: [...t.querySelectorAll(".bold")]
    }));
  }
  refreshTitles();

  function typeFx() {
    const y = window.scrollY;
    const vh = window.innerHeight;
    const p = Math.min(1, y / (vh * .9));
    if (headline) {
      headline.style.opacity = (1 - p * .75).toFixed(3);
      headline.style.transform = `translate3d(0, ${(-p * 90).toFixed(1)}px, 0) scale(${(1 - p * .05).toFixed(3)})`;
      headline.style.filter = p > .01 ? `blur(${(p * 8).toFixed(1)}px)` : "";
    }
    for (const t of titles) {
      const r = t.el.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) continue;
      const q = (r.top + r.height / 2) / vh - .5;
      const tx = (q * -90).toFixed(1);
      const bx = (q * 90).toFixed(1);
      for (let i = 0; i < t.thins.length; i++) t.thins[i].style.transform = `translate3d(${tx}px,0,0)`;
      for (let i = 0; i < t.bolds.length; i++) t.bolds[i].style.transform = `translate3d(${bx}px,0,0)`;
    }
  }

  function frame(time) {
    if (lenis) {
      lenis.raf(time);
    }
    if (samples.length) {
      const target = lengthAtViewport();
      cur = reduceMotion ? target : cur + (target - cur) * .12;
      line.style.strokeDashoffset = L - cur;
      const p = getPointFast(cur);
      head.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      head.style.opacity = cur > 4 ? "1" : "0";
      for (const n of nodes) n.g.classList.toggle("on", cur >= n.l - 2);
    }
    if (!reduceMotion) typeFx();
    requestAnimationFrame(frame);
  }

  let t;
  const rebuild = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      build();
      refreshTitles();
    }, 120);
  };
  window.addEventListener("resize", rebuild, { passive: true });
  const main = $("main");
  if (main) new ResizeObserver(rebuild).observe(main);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(rebuild);
  window.addEventListener("load", rebuild);

  build();
  requestAnimationFrame(frame);
})();
