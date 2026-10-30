/* Hero globe: a large dotted Earth (only its top half shows) with dotted coastlines,
   orbiting debris, service satellites and animated transfers.
   Optimized for high-FPS animation and zero scroll layout thrashing.
   Uses $, ico, esc and reduceMotion from app.js. */
(async () => {
  const cv = $("#globe"), g = cv.getContext("2d"), box = $("#system"), stage = $(".hero-right"), layer = $("#sats");
  if (!cv || !g || !box || !stage || !layer) return;
  const D2R = Math.PI / 180;
  let data = { land: [], coast: [], ocean: [] };
  try {
    const j = await (await fetch("/globe.json")).json();
    data = Array.isArray(j) ? { land: j, coast: [], ocean: [] } : j;
  } catch {}
  const toPt = ([la, lo]) => [Math.cos(la * D2R), Math.sin(la * D2R), lo * D2R];
  // Subsample dense point clouds for 3x canvas rendering performance while maintaining sharp globe contours
  const land = (data.land || []).filter((_, i) => i % 2 === 0).map(toPt);
  const coast = (data.coast || []).filter((_, i) => i % 2 === 0).map(toPt);
  const ocean = (data.ocean || []).filter((_, i) => i % 3 === 0).map(toPt);

  // major cities that send and receive transfers
  const HUBS = [[40.7, -74], [34, -118.2], [19.4, -99.1], [-23.5, -46.6], [51.5, -.1], [48.9, 2.35], [52.5, 13.4], [55.75, 37.6],
    [30, 31.2], [6.5, 3.4], [-26.2, 28], [25.2, 55.3], [19, 72.8], [1.35, 103.8], [39.9, 116.4], [35.7, 139.7], [37.6, 127],
    [-33.9, 151.2], [43.7, -79.4], [41, 29], [-34.6, -58.4], [-6.2, 106.8]].map(toPt);
  const SATS = [["YouTube", "#ff3d3d"], ["TikTok", "#25f4ee"], ["Instagram", "#e1306c"], ["X / Twitter", "#e7e9ea"], ["Twitch", "#9146ff"],
    ["SoundCloud", "#ff5500"], ["Vimeo", "#1ab7ea"], ["Reddit", "#ff4500"], ["Facebook", "#1877f2"]];
  const ORBITS = [{ r: 1.13, inc: -14 * D2R, node: 15 * D2R, sp: .0034 }, { r: 1.25, inc: 26 * D2R, node: -40 * D2R, sp: -.0025 },
    { r: 1.37, inc: -5 * D2R, node: 65 * D2R, sp: .0018 }];
  const sats = SATS.map(([name, c], i) => {
    const el = document.createElement("div");
    el.className = "sat"; el.style.setProperty("--c", c);
    el.innerHTML = ico(name) + `<span>${esc(name.replace(" / Twitter", ""))}</span>`;
    layer.appendChild(el);
    return { el, c, o: ORBITS[i % 3], th: Math.floor(i / 3) * 2.094 + (i % 3) * .8, v: null };
  });

  // orbiting debris: optimized count for smooth 60fps rendering
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / .5;
  const debris = [];
  for (let i = 0; i < 800; i++) debris.push({
    r: 1.025 + Math.random() ** 2 * .34, inc: gauss() * .45, node: Math.random() * 6.28, th: Math.random() * 6.28,
    sp: (.0006 + Math.random() * .0016) * (Math.random() < .85 ? 1 : -1), s: Math.random() < .9 ? 1 : 2, a: .25 + Math.random() * .75,
  });
  for (let c = 0; c < 4; c++) {
    const base = { r: 1.05 + Math.random() * .22, inc: gauss() * .4, node: Math.random() * 6.28, th: Math.random() * 6.28, sp: .0008 + Math.random() * .0012 };
    for (let i = 0; i < 30; i++) debris.push({
      r: base.r + gauss() * .012, inc: base.inc + gauss() * .03, node: base.node + gauss() * .03, th: base.th + gauss() * .07,
      sp: base.sp, s: Math.random() < .8 ? 1 : 1.8, a: .5 + Math.random() * .5,
    });
  }

  let W, H, dpr, R, cx, cy, cut;
  function size() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const css = box.clientWidth;
    W = cv.width = css * dpr; H = cv.height = css * dpr; R = css * .36 * dpr; cx = W / 2; cy = H / 2;
    cut = (stage.clientHeight / (box.clientHeight || 1)) * H;
  }
  new ResizeObserver(size).observe(box); new ResizeObserver(size).observe(stage); size();

  // drag to spin, with inertia
  const auto = reduceMotion ? 0 : .0016;
  let rotY = -0.35, rotX = .42, vy = auto, drag = false, lx = 0, ly = 0;
  cv.addEventListener("pointerdown", e => { drag = true; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; });
  cv.addEventListener("pointermove", e => {
    if (!drag) return;
    vy = (e.clientX - lx) * .004; rotY += vy;
    rotX = Math.max(.05, Math.min(.9, rotX + (e.clientY - ly) * .003));
    lx = e.clientX; ly = e.clientY;
  }, { passive: true });
  const up = () => { drag = false; cv.style.cursor = ""; };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);

  // world space (before the X tilt) -> screen
  let cX = 1, sX = 0;
  const world = p => { const a = p[2] + rotY; return [p[0] * Math.sin(a), -p[1], p[0] * Math.cos(a)]; };
  const ringWorld = (r, inc, node, th) => {
    const x1 = Math.cos(th), y1 = -Math.sin(th) * Math.sin(inc), z1 = Math.sin(th) * Math.cos(inc), n = node + rotY;
    return [(x1 * Math.cos(n) + z1 * Math.sin(n)) * r, y1 * r, (-x1 * Math.sin(n) + z1 * Math.cos(n)) * r];
  };
  const orbitWorld = (o, th) => ringWorld(o.r, o.inc, o.node, th);
  const scr = v => { const y = v[1] * cX + v[2] * sX, z = -v[1] * sX + v[2] * cX; return [cx + v[0] * R, cy + y * R, z]; };
  const hidden = (x, y, z) => z < 0 && (x - cx) ** 2 + (y - cy) ** 2 < R * R;
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  function slerp(a, b, u) {
    const w = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    if (w < 1e-4) return a;
    const s = Math.sin(w), k1 = Math.sin((1 - u) * w) / s, k2 = Math.sin(u * w) / s;
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  }

  // transfers: city to city arcs, and beams from a service satellite down to a city
  const arcs = [], pings = [];
  let nextSpawn = 0;
  function spawn(now) {
    const b = HUBS[Math.random() * HUBS.length | 0];
    const front = sats.filter(s => s.v && s.v[2] > .2);
    if (front.length && Math.random() < .45) {
      const s = front[Math.random() * front.length | 0];
      arcs.push({ sat: s, b, t0: now, dur: 1300 + Math.random() * 700, col: s.c });
    } else {
      let a; do a = HUBS[Math.random() * HUBS.length | 0]; while (a === b);
      arcs.push({ a, b, t0: now, dur: 1800 + Math.random() * 1400, col: Math.random() < .6 ? "#0099ff" : "#ffffff" });
    }
  }
  function arcPoint(A, u) {
    const B = norm(world(A.b));
    if (A.sat) {
      const S = orbitWorld(A.sat.o, A.sat.th), rs = Math.hypot(S[0], S[1], S[2]);
      const d = slerp(norm(S), B, u), r = rs + (1 - rs) * u + Math.sin(Math.PI * u) * .05;
      return [d[0] * r, d[1] * r, d[2] * r];
    }
    const Av = norm(world(A.a)), w = Math.acos(Math.max(-1, Math.min(1, Av[0] * B[0] + Av[1] * B[1] + Av[2] * B[2])));
    const d = slerp(Av, B, u), r = 1 + Math.sin(Math.PI * u) * (.04 + .22 * w / Math.PI);
    return [d[0] * r, d[1] * r, d[2] * r];
  }

  function drawOrbits(front) {
    for (const o of ORBITS) {
      g.beginPath(); let pen = false;
      for (let i = 0; i <= 100; i++) {
        const [x, y, z] = scr(orbitWorld(o, i / 100 * 6.2832));
        if ((z >= 0) !== front || hidden(x, y, z) || y > cut) { pen = false; continue; }
        pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true;
      }
      g.strokeStyle = front ? "rgba(255,255,255,.2)" : "rgba(255,255,255,.07)";
      g.lineWidth = dpr; g.setLineDash(o === ORBITS[1] ? [3 * dpr, 6 * dpr] : []); g.stroke(); g.setLineDash([]);
    }
  }
  function drawDebris(front) {
    g.fillStyle = "#fff";
    for (const d of debris) {
      const [x, y, z] = scr(ringWorld(d.r, d.inc, d.node, d.th));
      if ((z >= 0) !== front || y > cut || hidden(x, y, z)) continue;
      const s = d.s * dpr * (front ? 1.3 : .9);
      g.globalAlpha = Math.min(1, d.a * (front ? .8 + .5 * z / d.r : .45));
      g.fillRect(x - s / 2, y - s / 2, s, s);
    }
    g.globalAlpha = 1;
  }
  function dots(list, size, alpha) {
    for (const p of list) {
      const [x, y, z] = scr(world(p));
      if (z < 0 || y > cut) continue;
      const rim = 1 - z, s = size * (.75 + z * .45) * dpr;
      g.globalAlpha = alpha * (.45 + .4 * z + .5 * rim * rim);
      g.fillRect(x - s / 2, y - s / 2, s, s);
    }
    g.globalAlpha = 1;
  }

  // IntersectionObserver to pause globe calculation completely when scrolled out of view
  let globeVisible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      globeVisible = entry.isIntersecting;
    }, { rootMargin: "150px" }).observe(stage);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!globeVisible) return; // Zero CPU/GPU work when hero is scrolled past
    if (!drag) { vy += (auto - vy) * .03; rotY += vy; }
    if (!reduceMotion) for (const d of debris) d.th += d.sp;
    cX = Math.cos(rotX); sX = Math.sin(rotX);
    g.clearRect(0, 0, W, H);

    // soft white atmosphere
    let gr = g.createRadialGradient(cx, cy, R * .97, cx, cy, R * 1.22);
    gr.addColorStop(0, "rgba(220,235,255,.24)"); gr.addColorStop(.3, "rgba(180,210,255,.07)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * 1.22, 0, 6.2832); g.fill();

    drawOrbits(false);
    drawDebris(false);

    // opaque body
    gr = g.createRadialGradient(cx, cy - R * .2, R * .1, cx, cy, R);
    gr.addColorStop(0, "#0b0d12"); gr.addColorStop(.85, "#050608"); gr.addColorStop(1, "#0e1118");
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.fill();

    g.fillStyle = "#fff";
    dots(ocean, 1, .16);
    dots(land, 1.25, .5);
    dots(coast, 1.9, 1);

    // rim light
    g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1.4 * dpr;
    g.shadowColor = "rgba(255,255,255,.8)"; g.shadowBlur = 14 * dpr;
    g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.stroke(); g.shadowBlur = 0;

    // city hubs
    HUBS.forEach((hb, i) => {
      const [x, y, z] = scr(world(hb));
      if (z < .05 || y > cut) return;
      const k = (now / 1600 + i * .37) % 1;
      g.strokeStyle = `rgba(0,153,255,${(1 - k) * .8 * z})`; g.lineWidth = dpr;
      g.beginPath(); g.arc(x, y, (2 + k * 10) * dpr * z, 0, 6.2832); g.stroke();
      g.fillStyle = `rgba(120,200,255,${.6 + .4 * z})`; g.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, 3 * dpr, 3 * dpr);
    });

    // transfers
    if (!reduceMotion && now > nextSpawn && arcs.length < 8) { spawn(now); nextSpawn = now + 300 + Math.random() * 400; }
    for (let i = arcs.length - 1; i >= 0; i--) {
      const A = arcs[i], k = (now - A.t0) / A.dur;
      if (k > 1.5) { arcs.splice(i, 1); continue; }
      const head = Math.min(1, k), tail = Math.max(0, Math.min(1, k - .45));
      const N = 24; let prev = null;
      for (let j = 0; j <= N; j++) {
        const P = scr(arcPoint(A, tail + (head - tail) * j / N));
        if (prev && !hidden(P[0], P[1], P[2]) && !hidden(prev[0], prev[1], prev[2])) {
          g.strokeStyle = A.col; g.globalAlpha = (j / N) * (k > 1 ? 1.5 - k : 1) * .9;
          g.lineWidth = (A.sat ? 1.6 : 1.3) * dpr;
          g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(P[0], P[1]); g.stroke();
        }
        prev = P;
      }
      if (k < 1) {
        const P = scr(arcPoint(A, head));
        if (!hidden(P[0], P[1], P[2])) {
          g.globalAlpha = 1; g.fillStyle = A.col; g.shadowColor = A.col; g.shadowBlur = 12 * dpr;
          g.beginPath(); g.arc(P[0], P[1], 2.4 * dpr, 0, 6.2832); g.fill(); g.shadowBlur = 0;
        }
      } else if (!A.pinged) { A.pinged = 1; pings.push({ b: A.b, t0: now, col: A.col }); }
      g.globalAlpha = 1;
    }
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i], k = (now - p.t0) / 700;
      if (k > 1) { pings.splice(i, 1); continue; }
      const [x, y, z] = scr(world(p.b));
      if (z < 0) continue;
      g.strokeStyle = p.col; g.globalAlpha = (1 - k) * z; g.lineWidth = 1.4 * dpr;
      g.beginPath(); g.arc(x, y, (3 + k * 16) * dpr, 0, 6.2832); g.stroke(); g.globalAlpha = 1;
    }

    drawDebris(true);
    drawOrbits(true);

    // satellites are HTML chips
    for (const s of sats) {
      if (!drag && !reduceMotion) s.th += s.o.sp;
      const P = scr(orbitWorld(s.o, s.th)), z = P[2] / s.o.r;
      s.v = [P[0], P[1], z];
      s.el.classList.toggle("front", z >= 0);
      s.el.style.opacity = hidden(P[0], P[1], P[2]) || P[1] > cut ? 0 : z < 0 ? .5 : 1;
      s.el.style.transform = `translate3d(${P[0] / dpr}px,${P[1] / dpr}px,0) translate(-50%,-50%) scale(${.8 + .12 * (z + 1)})`;
    }
  }
  requestAnimationFrame(frame);
})();
