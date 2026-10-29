/* Smooth scrolling, a thread that draws itself down the page, and scroll-linked type.
   Uses $, $$ and reduceMotion from app.js. */
(() => {
  /* ---------- smooth inertial scroll ---------- */
  if (!reduceMotion && window.Lenis) {
    document.documentElement.style.scrollBehavior = "auto";
    const lenis = new Lenis({ lerp: .09 });
    const raf = t => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    document.addEventListener("click", e => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute("href"), el = id === "#top" ? 0 : document.querySelector(id);
      if (el === null) return;
      e.preventDefault();
      lenis.scrollTo(el, { offset: el ? -80 : 0, duration: 1.4 });
    });
  }

  /* ---------- the thread ---------- */
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.classList.add("thread"); svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<defs><filter id="thGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <path class="th-ghost"/><path class="th-line" filter="url(#thGlow)"/><g class="th-nodes"></g>
    <g class="th-head"><circle class="th-ring" r="14"/><circle class="dot" r="5" filter="url(#thGlow)"/></g>`;
  document.body.appendChild(svg);
  const ghost = svg.querySelector(".th-ghost"), line = svg.querySelector(".th-line");
  const nodesG = svg.querySelector(".th-nodes"), head = svg.querySelector(".th-head");
  let samples = [], nodes = [], L = 0, cur = 0;

  function build() {
    const W = document.documentElement.clientWidth;
    const docH = $(".foot").getBoundingClientRect().bottom + scrollY;  // not scrollHeight: the svg itself would feed into that
    svg.setAttribute("width", W); svg.setAttribute("height", docH); svg.setAttribute("viewBox", `0 0 ${W} ${docH}`);
    const gut = Math.max(14, Math.min(64, (W - 1240) / 2 * .5));
    const pos = el => el.getBoundingClientRect().top + scrollY;

    const hero = $(".hero");
    let px = W / 2, py = pos(hero) + hero.offsetHeight - 30;
    let d = `M ${px} ${py}`;
    const wps = $$("[data-thread]").map((el, i) => {
      const side = i % 2 ? "r" : "l";
      return { x: side === "l" ? gut : W - gut, y: pos(el) + 46, side, label: el.dataset.thread, loop: el.hasAttribute("data-loop") };
    });
    for (const w of wps) {
      const dy = w.y - py;
      d += ` C ${px} ${py + dy * .55} ${w.x} ${w.y - dy * .55} ${w.x} ${w.y}`;
      if (w.loop) {
        const r = 28, k = w.side === "l" ? 1 : -1;   // little loop towards the content
        d += ` a ${r} ${r} 0 1 ${w.side === "l" ? 1 : 0} ${2 * r * k} 0 a ${r} ${r} 0 1 ${w.side === "l" ? 1 : 0} ${-2 * r * k} 0`;
      }
      px = w.x; py = w.y;
    }
    const end = $(".cta .big-pill"), eb = end.getBoundingClientRect();
    const ex = eb.left + eb.width / 2, ey = eb.top + scrollY - 14, dy = ey - py;
    d += ` C ${px} ${py + dy * .55} ${ex} ${ey - dy * .55} ${ex} ${ey}`;
    ghost.setAttribute("d", d); line.setAttribute("d", d);

    L = line.getTotalLength();
    line.style.strokeDasharray = L;
    samples = [];
    for (let l = 0; l <= L; l += 6) { const p = line.getPointAtLength(l); samples.push([l, p.x, p.y]); }

    nodesG.innerHTML = "";
    nodes = wps.map(w => {
      const g = document.createElementNS(NS, "g"); g.classList.add("th-node");
      const tx = w.side === "l" ? w.x + 16 : w.x - 16;
      g.innerHTML = `<circle cx="${w.x}" cy="${w.y}" r="5"/><text x="${tx}" y="${w.y + 4}" text-anchor="${w.side === "l" ? "start" : "end"}">${w.label.toUpperCase()}</text>`;
      nodesG.appendChild(g);
      const s = samples.find(s => s[2] >= w.y - 1) || samples[samples.length - 1];
      return { g, l: s[0] };
    });
  }

  function lengthAtViewport() {
    const target = scrollY + innerHeight * .62;
    let i = 0;
    while (i < samples.length - 1 && samples[i + 1][2] <= target) i++;
    return samples.length ? samples[i][0] : 0;
  }

  /* ---------- scroll-linked type ---------- */
  const headline = $(".headline"), titles = $$(".sec-title");
  function typeFx() {
    const p = Math.min(1, scrollY / (innerHeight * .9));
    headline.style.filter = p > .01 ? `blur(${(p * 10).toFixed(1)}px)` : "";
    headline.style.opacity = 1 - p * .75;
    headline.style.transform = `translateY(${-p * 90}px) scale(${1 - p * .05})`;
    for (const t of titles) {
      const r = t.getBoundingClientRect();
      if (r.bottom < -100 || r.top > innerHeight + 100) continue;
      const q = (r.top + r.height / 2) / innerHeight - .5;
      t.querySelectorAll(".thin").forEach(e => { e.style.transform = `translateX(${q * -90}px)`; });
      t.querySelectorAll(".bold").forEach(e => { e.style.transform = `translateX(${q * 90}px)`; });
    }
  }

  function frame() {
    if (samples.length) {
      const target = lengthAtViewport();
      cur = reduceMotion ? target : cur + (target - cur) * .12;
      line.style.strokeDashoffset = L - cur;
      const p = line.getPointAtLength(cur);
      head.setAttribute("transform", `translate(${p.x} ${p.y})`);
      head.style.opacity = cur > 4 ? 1 : 0;
      for (const n of nodes) n.g.classList.toggle("on", cur >= n.l - 2);
    }
    if (!reduceMotion) typeFx();
    requestAnimationFrame(frame);
  }

  let t;
  const rebuild = () => { clearTimeout(t); t = setTimeout(build, 120); };
  addEventListener("resize", rebuild);
  new ResizeObserver(rebuild).observe($("main"));
  document.fonts && document.fonts.ready.then(rebuild);
  addEventListener("load", rebuild);
  build();
  requestAnimationFrame(frame);
})();
