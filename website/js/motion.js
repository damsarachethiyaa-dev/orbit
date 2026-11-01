/* ==========================================================================
   Orbit Windows App — Official Animation & Interactive Engine
   Animation Engine & Features from http://127.0.0.1:5000/
   Lenis Inertial Scroll, The Glowing Thread, Scroll-Linked Typography,
   Illuminated Manifesto, Inverted Step Fill, Spotlight Radial & 3D Tilt
   ========================================================================== */

(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;

  /* ======================= Wordmark Auto-Fitting ======================= */
  function fitWordmark() {
    $$('[data-fit]').forEach(el => {
      el.style.fontSize = '100px';
      const parent = el.parentElement;
      const pad = parseFloat(getComputedStyle(parent).paddingLeft) * 2;
      const containerWidth = parent.clientWidth - pad;
      const naturalWidth = el.scrollWidth;
      if (naturalWidth > 0) {
        el.style.fontSize = (100 * containerWidth / naturalWidth) + 'px';
      }
    });
  }
  document.fonts.ready.then(fitWordmark);
  window.addEventListener('resize', fitWordmark);
  fitWordmark();

  /* ======================= Lenis Smooth Inertial Scrolling ======================= */
  let lenis = null;
  if (!reduceMotion && window.Lenis) {
    document.documentElement.style.scrollBehavior = 'auto';
    lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.5,
    });
    window.lenis = lenis;

    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const el = id === '#top' ? 0 : document.querySelector(id);
      if (el === null && id !== '#top') return;
      e.preventDefault();
      lenis.scrollTo(el === 0 ? 0 : el, { offset: el ? -80 : 0, duration: 1.2 });
    });
  }

  /* ======================= The Glowing Thread (from http://127.0.0.1:5000/) ======================= */
  const NS = 'http://www.w3.org/2000/svg';
  const threadSvg = document.createElementNS(NS, 'svg');
  threadSvg.classList.add('thread');
  threadSvg.setAttribute('aria-hidden', 'true');
  threadSvg.innerHTML = `
    <path class="th-ghost"/>
    <path class="th-line"/>
    <g class="th-nodes"></g>
    <g class="th-head"><circle class="th-ring" r="14"/><circle class="dot" r="5"/></g>
  `;
  document.body.appendChild(threadSvg);

  const thGhost = threadSvg.querySelector('.th-ghost');
  const thLine = threadSvg.querySelector('.th-line');
  const thNodesG = threadSvg.querySelector('.th-nodes');
  const thHead = threadSvg.querySelector('.th-head');
  let thSamples = [], thNodes = [], thTotalLength = 0, thCur = 0;

  function buildThread() {
    const W = document.documentElement.clientWidth;
    const foot = $('.foot') || $('.footer');
    const docH = foot ? foot.getBoundingClientRect().bottom + window.scrollY : document.documentElement.scrollHeight;

    threadSvg.setAttribute('width', W);
    threadSvg.setAttribute('height', docH);
    threadSvg.setAttribute('viewBox', `0 0 ${W} ${docH}`);

    const gut = Math.max(16, Math.min(64, (W - 1240) / 2 * 0.5));
    const pos = el => el.getBoundingClientRect().top + window.scrollY;

    const hero = $('.hero');
    let px = W / 2, py = hero ? pos(hero) + hero.offsetHeight - 40 : 200;
    let d = `M ${px} ${py}`;

    const waypoints = $$('[data-thread]').map((el, i) => {
      const side = i % 2 ? 'r' : 'l';
      return {
        x: side === 'l' ? gut : W - gut,
        y: pos(el) + 48,
        side,
        label: el.dataset.thread,
        loop: el.hasAttribute('data-loop')
      };
    });

    for (const w of waypoints) {
      const dy = w.y - py;
      d += ` C ${px} ${py + dy * 0.55} ${w.x} ${w.y - dy * 0.55} ${w.x} ${w.y}`;
      if (w.loop) {
        const r = 26, k = w.side === 'l' ? 1 : -1;
        d += ` a ${r} ${r} 0 1 ${w.side === 'l' ? 1 : 0} ${2 * r * k} 0 a ${r} ${r} 0 1 ${w.side === 'l' ? 1 : 0} ${-2 * r * k} 0`;
      }
      px = w.x; py = w.y;
    }

    const end = $('.cta .big-pill') || $('.closing .btn-primary');
    if (end) {
      const eb = end.getBoundingClientRect();
      const ex = eb.left + eb.width / 2;
      const ey = eb.top + window.scrollY - 14;
      const ctaBox = $('.cta-box');
      if (ctaBox) {
        const cb = ctaBox.getBoundingClientRect();
        const boxTop = cb.top + window.scrollY;
        // Travel down along the margin outside the card past the text
        const midY = boxTop + cb.height * 0.7;
        const dy1 = midY - py;
        d += ` C ${px} ${py + dy1 * 0.5} ${px} ${midY - dy1 * 0.2} ${px} ${midY}`;
        // Then curve smoothly inwards to dock onto the button from the side/top
        const dy2 = ey - midY;
        d += ` C ${px} ${midY + dy2 * 0.75} ${ex + 180} ${ey - 24} ${ex} ${ey}`;
      } else {
        const dy = ey - py;
        d += ` C ${px} ${py + dy * 0.55} ${ex} ${ey - dy * 0.55} ${ex} ${ey}`;
      }
    }

    thGhost.setAttribute('d', d);
    thLine.setAttribute('d', d);

    thTotalLength = thLine.getTotalLength();
    thLine.style.strokeDasharray = thTotalLength;
    thSamples = [];
    for (let l = 0; l <= thTotalLength; l += 6) {
      const pt = thLine.getPointAtLength(l);
      thSamples.push([l, pt.x, pt.y]);
    }

    thNodesG.innerHTML = '';
    thNodes = waypoints.map(w => {
      const g = document.createElementNS(NS, 'g');
      g.classList.add('th-node');
      const tx = w.side === 'l' ? w.x + 16 : w.x - 16;
      g.innerHTML = `<circle cx="${w.x}" cy="${w.y}" r="5"/><text x="${tx}" y="${w.y + 4}" text-anchor="${w.side === 'l' ? 'start' : 'end'}">${w.label.toUpperCase()}</text>`;
      thNodesG.appendChild(g);
      const s = thSamples.find(s => s[2] >= w.y - 1) || thSamples[thSamples.length - 1];
      return { g, l: s ? s[0] : 0 };
    });
  }

  function getThreadPointFast(l) {
    if (!thSamples.length) return { x: 0, y: 0 };
    const idx = Math.min(thSamples.length - 1, Math.max(0, Math.floor(l / 6)));
    const nextIdx = Math.min(thSamples.length - 1, idx + 1);
    const frac = (l - idx * 6) / 6;
    const a = thSamples[idx], b = thSamples[nextIdx];
    return {
      x: a[1] + (b[1] - a[1]) * frac,
      y: a[2] + (b[2] - a[2]) * frac
    };
  }

  function threadLengthAtViewport() {
    const target = window.scrollY + window.innerHeight * 0.62;
    let i = 0;
    while (i < thSamples.length - 1 && thSamples[i + 1][2] <= target) i++;
    return thSamples.length ? thSamples[i][0] : 0;
  }

  /* ======================= Scroll-Linked Typography & Parallax ======================= */
  const topWordmark = $('.wordmark');
  let titles = [];
  function refreshTitles() {
    titles = $$('.sec-title').map(t => ({
      el: t,
      thins: [...t.querySelectorAll('.thin')],
      bolds: [...t.querySelectorAll('.bold')]
    }));
  }
  refreshTitles();

  function scrollTypeParallax() {
    const y = window.scrollY;
    const vh = window.innerHeight;
    const p = Math.min(1, y / (vh * 0.9));

    if (topWordmark) {
      topWordmark.style.opacity = (1 - p * 0.85).toFixed(3);
      topWordmark.style.transform = `translate3d(0, ${(-p * 50).toFixed(1)}px, 0)`;
    }

    for (const t of titles) {
      const r = t.el.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) continue;
      const q = (r.top + r.height / 2) / vh - 0.5;
      const tx = (q * -80).toFixed(1);
      const bx = (q * 80).toFixed(1);
      for (let i = 0; i < t.thins.length; i++) t.thins[i].style.transform = `translate3d(${tx}px,0,0)`;
      for (let i = 0; i < t.bolds.length; i++) t.bolds[i].style.transform = `translate3d(${bx}px,0,0)`;
    }
  }

  /* ======================= Illuminated Manifesto on Scroll ======================= */
  const KEYS = ["orbit", "link", "file", "watermark", "limits", "pc", "private", "yours", "local"];
  const mText = $('#mtext');
  if (mText) {
    mText.innerHTML = mText.textContent.split(/\s+/).map(w => {
      const clean = w.toLowerCase().replace(/\W/g, "");
      return `<span class="w${KEYS.includes(clean) ? ' key' : ''}">${w}</span>`;
    }).join(' ');
  }
  const mWords = $$('.big .w');
  const mSec = $('#manifesto');

  function updateManifestoLighting() {
    if (mSec && mWords.length) {
      const r = mSec.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      const p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) * 1.15 : 0;
      mWords.forEach((w, i) => w.classList.toggle('on', i / mWords.length < p));
    }
  }

  /* ======================= How-It-Works Step Progress Fill ======================= */
  const stepsSec = $('#steps');
  const stepEls = $$('.step');
  const stepsFill = $('#stepsFill');

  function updateStepProgress() {
    if (stepsSec) {
      const sr = stepsSec.getBoundingClientRect();
      const sp = Math.min(1, Math.max(0, (window.innerHeight * 0.75 - sr.top) / (sr.height + window.innerHeight * 0.2)));
      if (stepsFill) stepsFill.style.transform = `scaleX(${sp})`;
      stepEls.forEach((s, i) => s.classList.toggle('lit', sp >= i / 2 - 0.02));
    }
  }

  /* ======================= Nav & Progress Bar ======================= */
  const sbar = $('#sbar');
  const nav = $('#nav');
  const navLinks = $$('.nav__links a');
  const trackedSections = $$('main section[id]');

  function updateNavScroll() {
    const y = window.scrollY;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll > 0 && sbar) {
      sbar.style.transform = `scaleX(${Math.min(1, y / maxScroll)})`;
    }
    if (nav) {
      nav.classList.toggle('is-solid', y > 40);
    }
    let cur = '';
    for (let i = 0; i < trackedSections.length; i++) {
      if (trackedSections[i].getBoundingClientRect().top < window.innerHeight * 0.45) {
        cur = trackedSections[i].id;
      }
    }
    navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
  }

  /* ======================= Main Animation RAF Loop ======================= */
  function onAnimationFrame(time) {
    if (lenis) {
      lenis.raf(time);
    }
    if (thSamples.length) {
      const target = threadLengthAtViewport();
      thCur = reduceMotion ? target : thCur + (target - thCur) * 0.12;
      thLine.style.strokeDashoffset = thTotalLength - thCur;
      const pt = getThreadPointFast(thCur);
      thHead.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
      thHead.style.opacity = thCur > 6 ? '1' : '0';
      for (const n of thNodes) n.g.classList.toggle('on', thCur >= n.l - 2);
    }
    if (!reduceMotion) {
      scrollTypeParallax();
      updateManifestoLighting();
      updateStepProgress();
    }
    requestAnimationFrame(onAnimationFrame);
  }

  /* ======================= Cascading Reveal & Count-Up ======================= */
  function countUp(el) {
    const to = +el.dataset.count;
    const suf = el.dataset.suffix || '';
    const t0 = performance.now();
    const dur = 1400;
    const tick = t => {
      const k = Math.min(1, (t - t0) / dur);
      const v = Math.round(to * (1 - Math.pow(1 - k, 4)));
      el.textContent = v.toLocaleString() + suf;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        revealObserver.unobserve(e.target);
        const countEl = e.target.querySelector('[data-count]');
        if (countEl) countUp(countEl);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

  $$('.reveal').forEach(el => {
    const sibs = [...el.parentElement.children].filter(c => c.classList.contains('reveal'));
    el.style.transitionDelay = Math.min(sibs.indexOf(el), 6) * 80 + 'ms';
    revealObserver.observe(el);
  });

  // Hero elements trigger immediately
  $$('.hero .reveal').forEach((el, i) => {
    el.style.transitionDelay = (i * 90 + 60) + 'ms';
    requestAnimationFrame(() => el.classList.add('in'));
  });

  /* ======================= Card Spotlight Radial (.spot from http://127.0.0.1:5000/) ======================= */
  function bindSpotlights(els) {
    els.forEach(el => {
      if (el._spotBound) return;
      el._spotBound = true;
      let rect = null;
      el.addEventListener('pointerenter', () => { rect = el.getBoundingClientRect(); }, { passive: true });
      el.addEventListener('pointermove', e => {
        if (!rect) rect = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
        el.style.setProperty('--my', (e.clientY - rect.top) + 'px');
      }, { passive: true });
      el.addEventListener('pointerleave', () => { rect = null; }, { passive: true });
    });
  }
  bindSpotlights($$('.spot'));

  /* ======================= Magnetic Buttons & 3D Tilt ======================= */
  if (finePointer && !reduceMotion) {
    $$('.magnetic, .btn-primary, .nav__cta, .wt-btn, .pill').forEach(el => {
      let b = null;
      el.addEventListener('pointerenter', () => { b = el.getBoundingClientRect(); }, { passive: true });
      el.addEventListener('pointermove', e => {
        if (!b) b = el.getBoundingClientRect();
        const dx = (e.clientX - b.left - b.width / 2) * 0.22;
        const dy = (e.clientY - b.top - b.height / 2) * 0.26;
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      });
      el.addEventListener('pointerleave', () => {
        b = null;
        el.style.transform = '';
      });
    });

    // 3D perspective tilt on cards
    $$('.plan, .trio > div, .exp__shot, .cta-box').forEach(el => {
      let b = null;
      el.addEventListener('pointerenter', () => { b = el.getBoundingClientRect(); }, { passive: true });
      el.addEventListener('pointermove', e => {
        if (!b) b = el.getBoundingClientRect();
        const x = (e.clientX - b.left) / b.width - 0.5;
        const y = (e.clientY - b.top) / b.height - 0.5;
        el.style.transform = `perspective(900px) rotateX(${-y * 4}deg) rotateY(${x * 5}deg) translateY(-3px)`;
      }, { passive: true });
      el.addEventListener('pointerleave', () => {
        b = null;
        el.style.transform = '';
      });
    });
  }

  /* ======================= Cursor Glow ======================= */
  const glow = $('.cursor-glow');
  let gx = -9999, gy = -9999, gticking = false;
  if (!reduceMotion && glow) {
    window.addEventListener('pointermove', e => {
      gx = e.clientX; gy = e.clientY;
      if (!gticking) {
        gticking = true;
        requestAnimationFrame(() => {
          glow.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
          gticking = false;
        });
      }
    }, { passive: true });
  } else if (glow) {
    glow.style.display = 'none';
  }

  /* ======================= Headline Rotating Word ======================= */
  const rot = $('#rotator');
  const WORDS = ["ANYTHING.", "IN 4K.", "INSTANTLY.", "LOSSLESS.", "OFFLINE.", "ON WINDOWS."];
  if (!reduceMotion && rot) {
    let wi = 0;
    setInterval(() => {
      rot.classList.remove('swap');
      rot.classList.add('out');
      setTimeout(() => {
        wi = (wi + 1) % WORDS.length;
        rot.textContent = WORDS[wi];
        rot.classList.remove('out');
        rot.classList.add('swap');
      }, 400);
    }, 3200);
  }

  /* ======================= Interactive Stars & Constellations ======================= */
  (() => {
    const c = $('#stars');
    if (!c || reduceMotion) return;
    const g = c.getContext('2d');
    let w, h, dpr, stars = [], shooting = [], mx = 0, my = 0, tmx = 0, tmy = 0, px = -9999, py = -9999;

    function build() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = c.width = innerWidth * dpr;
      h = c.height = innerHeight * dpr;
      const n = Math.round(innerWidth * innerHeight / 3200);
      stars = Array.from({ length: n }, () => {
        const z = Math.random() ** 2;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          z,
          r: (0.3 + z * 1.1) * dpr,
          tw: Math.random() * 6.28,
          ts: 0.5 + Math.random() * 2
        };
      });
    }
    window.addEventListener('resize', build, { passive: true });
    build();

    window.addEventListener('pointermove', e => {
      tmx = e.clientX / innerWidth - 0.5;
      tmy = e.clientY / innerHeight - 0.5;
      px = e.clientX * dpr;
      py = e.clientY * dpr;
    }, { passive: true });

    // Subtle, elegant particle "O" letters
    const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.58;
    function makeORingParts(n) {
      return Array.from({ length: n }, () => {
        let u = gauss();
        if (Math.random() < 0.1) u = 0.9 + Math.random() * 1.4;
        return {
          a: Math.random() * 6.283,
          u,
          s: 0.25 + Math.random() * 0.5,
          sz: 0.8 + Math.random() * 0.9,
          al: 0.2 + Math.random() * 0.45
        };
      });
    }

    const rings = $$('.o-ring').map(el => {
      const cv = document.createElement('canvas');
      el.appendChild(cv);
      return { el, cv, g: cv.getContext('2d'), parts: makeORingParts(280), vis: true };
    });

    if ('IntersectionObserver' in window) {
      const ringObs = new IntersectionObserver(es => es.forEach(e => {
        const r = rings.find(x => x.el === e.target);
        if (r) r.vis = e.isIntersecting;
      }));
      rings.forEach(r => ringObs.observe(r.el));
    }

    let t = 0;
    function renderFrame() {
      t += 0.016;
      mx += (tmx - mx) * 0.05;
      my += (tmy - my) * 0.05;
      g.clearRect(0, 0, w, h);

      const sy = window.scrollY * dpr;
      const near = [];

      // Stars
      for (const s of stars) {
        s.x -= (0.03 + s.z * 0.16) * dpr;
        if (s.x < -4) s.x += w + 8;
        let x = s.x - mx * 40 * s.z * dpr;
        let y = (s.y - sy * (0.04 + s.z * 0.2) - my * 30 * s.z * dpr) % h;
        if (y < 0) y += h;

        const a = (0.3 + 0.7 * Math.abs(Math.sin(t * s.ts + s.tw))) * (0.25 + s.z * 0.75);
        g.fillStyle = `rgba(255,255,255,${a})`;
        g.fillRect(x - s.r / 2, y - s.r / 2, s.r, s.r);

        if (s.z > 0.45 && near.length < 6 && Math.abs(x - px) < 120 * dpr && Math.abs(y - py) < 120 * dpr) {
          near.push([x, y]);
        }
      }

      // Constellations around cursor
      if (near.length > 1) {
        g.lineWidth = 0.65 * dpr;
        for (let i = 0; i < near.length; i++) {
          for (let j = i + 1; j < near.length; j++) {
            const dist = Math.hypot(near[i][0] - near[j][0], near[i][1] - near[j][1]);
            if (dist < 110 * dpr) {
              g.strokeStyle = `rgba(255, 255, 255, ${(1 - dist / (110 * dpr)) * 0.25})`;
              g.beginPath();
              g.moveTo(near[i][0], near[i][1]);
              g.lineTo(near[j][0], near[j][1]);
              g.stroke();
            }
          }
        }
      }

      // Shooting stars
      if (Math.random() < 0.006 && shooting.length < 2) {
        shooting.push({
          x: Math.random() * w * 0.8 + w * 0.2,
          y: Math.random() * h * 0.4,
          vx: -(9 + Math.random() * 7) * dpr,
          vy: (4 + Math.random() * 3) * dpr,
          life: 1
        });
      }
      shooting = shooting.filter(s => s.life > 0);
      for (const s of shooting) {
        s.x += s.vx;
        s.y += s.vy;
        s.life -= 0.018;
        const gr = g.createLinearGradient(s.x, s.y, s.x - s.vx * 12, s.y - s.vy * 12);
        gr.addColorStop(0, `rgba(255,255,255,${s.life})`);
        gr.addColorStop(0.5, `rgba(255,255,255,${s.life * 0.4})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.strokeStyle = gr;
        g.lineWidth = 1.4 * dpr;
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(s.x - s.vx * 12, s.y - s.vy * 12);
        g.stroke();
      }

      // Render subtle cosmic "O" rings
      for (const r of rings) {
        if (!r.vis) continue;
        const elW = r.el.clientWidth || 40;
        const elH = r.el.clientHeight || 40;
        const W2 = Math.round(elW * 1.8 * dpr);
        const H2 = Math.round(elH * 1.8 * dpr);
        if (W2 && (r.cv.width !== W2 || r.cv.height !== H2)) {
          r.cv.width = W2;
          r.cv.height = H2;
        }
        const rg = r.g;
        rg.clearRect(0, 0, W2, H2);

        const cx = W2 / 2, cy = H2 / 2;
        const R = W2 * 0.21;
        const strokeWidth = R * 0.44;
        const base = R + strokeWidth / 2;

        // 1. Soft corona
        const halo = base + strokeWidth * 1.4;
        const gl = rg.createRadialGradient(cx, cy, R * 0.9, cx, cy, halo);
        gl.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
        gl.addColorStop(0.4, 'rgba(255, 255, 255, 0.04)');
        gl.addColorStop(1, 'rgba(0, 0, 0, 0)');
        rg.fillStyle = gl;
        rg.beginPath();
        rg.arc(cx, cy, halo, 0, 6.283);
        rg.fill();

        // 2. Black hole core
        rg.fillStyle = '#000000';
        rg.beginPath();
        rg.arc(cx, cy, R, 0, 6.283);
        rg.fill();

        // 3. Crisp white Letter "O" ring
        rg.strokeStyle = '#ffffff';
        rg.lineWidth = strokeWidth;
        rg.beginPath();
        rg.arc(cx, cy, base, 0, 6.283);
        rg.stroke();

        // 4. Shimmer orbiting the ring
        const flareAngle = t * 2.2;
        const trailLen = 1.1;
        const trailGrad = rg.createLinearGradient(
          cx + Math.cos(flareAngle) * base, cy + Math.sin(flareAngle) * base,
          cx + Math.cos(flareAngle - trailLen) * base, cy + Math.sin(flareAngle - trailLen) * base
        );
        trailGrad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
        trailGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.35)');
        trailGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

        rg.strokeStyle = trailGrad;
        rg.lineWidth = strokeWidth * 0.45;
        rg.lineCap = 'round';
        rg.beginPath();
        rg.arc(cx, cy, base, flareAngle - trailLen, flareAngle);
        rg.stroke();

        // 5. Stardust particles
        const Wb = strokeWidth * 0.95;
        rg.fillStyle = '#ffffff';
        for (const p of r.parts) {
          const rr = base + p.u * Wb;
          if (rr < R * 0.88) continue;
          const a = p.a + t * p.s * Math.pow(base / rr, 1.4);
          const sz = p.sz * dpr;
          rg.globalAlpha = p.al * Math.max(0, 1 - Math.abs(p.u) / 2.8);
          rg.fillRect(cx + Math.cos(a) * rr - sz / 2, cy + Math.sin(a) * rr - sz / 2, sz, sz);
        }
        rg.globalAlpha = 1;
      }

      requestAnimationFrame(renderFrame);
    }
    renderFrame();
  })();

  /* ======================= Walkthrough Showcase Switcher ======================= */
  const wtBtns = $$('.wt-btn');
  const slides = $$('.showcase-slide');
  wtBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const step = btn.dataset.step;
      wtBtns.forEach(b => b.classList.toggle('is-active', b === btn));
      slides.forEach(s => s.classList.toggle('is-active', s.dataset.slide === step));
    });
  });

  /* ======================= Experience Capabilities Tabs ======================= */
  const expBtns = $$('#expTabs button');
  const expPanels = $$('.exp__panel');
  expBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      expBtns.forEach(b => b.setAttribute('aria-selected', b === btn));
      expPanels.forEach((p, idx) => p.classList.toggle('is-active', idx === +btn.dataset.i));
    });
  });

  /* ======================= Lightbox Modal ======================= */
  const lightbox = $('#lightbox');
  const lbImg = $('#lightboxImg');
  const lbCap = $('#lightboxCap');
  const lbClose = $('#lightboxClose');

  function openLightbox(src, caption) {
    if (!lightbox || !lbImg) return;
    lbImg.src = src;
    if (lbCap) lbCap.textContent = caption || '';
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
  }

  if (lbClose) lbClose.addEventListener('click', closeLightbox);
  if (lightbox) {
    lightbox.addEventListener('click', e => {
      if (e.target === lightbox) closeLightbox();
    });
  }
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLightbox();
  });

  $$('[data-lightbox]').forEach(el => {
    el.addEventListener('click', () => {
      const src = el.getAttribute('data-lightbox') || el.src;
      const cap = el.getAttribute('data-caption') || el.alt || 'Orbit Screenshot';
      openLightbox(src, cap);
    });
  });

  /* ======================= Mobile Navigation Drawer ======================= */
  const navToggle = $('#navToggle');
  const navMobile = $('#navMobile');

  function toggleMobileMenu(forceClose = false) {
    if (!navToggle || !navMobile) return;
    const shouldOpen = forceClose ? false : !navMobile.classList.contains('is-open');
    navToggle.classList.toggle('is-active', shouldOpen);
    navToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    navMobile.classList.toggle('is-open', shouldOpen);
    navMobile.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  }

  if (navToggle) {
    navToggle.addEventListener('click', e => {
      e.stopPropagation();
      toggleMobileMenu();
    });
  }

  if (navMobile) {
    navMobile.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        toggleMobileMenu(true);
      });
    });
  }

  document.addEventListener('click', e => {
    if (navMobile && navMobile.classList.contains('is-open')) {
      if (!navMobile.contains(e.target) && !navToggle.contains(e.target)) {
        toggleMobileMenu(true);
      }
    }
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') toggleMobileMenu(true);
  });

  /* ======================= Dynamic GitHub Release Version Sync ======================= */
  (function initReleaseAutoSync() {
    const REPO = 'damsarachethiyaa-dev/orbit';
    const CACHE_KEY = 'orbit_latest_release';
    const CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache

    function applyRelease(data) {
      if (!data || !data.tag_name) return;
      const rawTag = String(data.tag_name).trim();
      const version = /^v/i.test(rawTag) ? rawTag : ('v' + rawTag);

      // 1. Update marked version elements
      $$('[data-orbit-version]').forEach(el => {
        el.textContent = `Download Free (${version})`;
      });

      // Fallback for any elements matching the version pattern
      $$('a[download] span').forEach(el => {
        if (/Download Free \(v[0-9.]+\)/i.test(el.textContent)) {
          el.textContent = `Download Free (${version})`;
        }
      });

      // 2. Update footer link
      $$('[data-orbit-footer-version]').forEach(el => {
        el.textContent = `Download ${version}`;
      });
      $$('footer a').forEach(el => {
        if (/Download v[0-9.]+/i.test(el.textContent)) {
          el.textContent = `Download ${version}`;
        }
      });

      // 3. Update download URLs if assets are present
      if (Array.isArray(data.assets)) {
        const exeAsset = data.assets.find(a => a.name && a.name.toLowerCase().endsWith('.exe'));
        if (exeAsset && exeAsset.browser_download_url) {
          $$('a[download*="Orbit-Setup"], a[download="Orbit-Setup.exe"]').forEach(a => {
            a.href = exeAsset.browser_download_url;
            a.setAttribute('download', exeAsset.name);
          });
        }
      }
    }

    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Date.now() - parsed.timestamp < CACHE_TTL && parsed.data) {
          applyRelease(parsed.data);
          return;
        }
      }
    } catch (e) {}

    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        applyRelease(data);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (e) {}
      })
      .catch(() => {
        // Fallback: retains existing HTML version
      });
  })();

  /* ======================= Download Toast Notification ======================= */
  const dlToast = $('#dl-toast');
  $$('a[download]').forEach(link => {
    link.addEventListener('click', () => {
      if (!dlToast) return;
      dlToast.classList.add('is-active');
      setTimeout(() => dlToast.classList.remove('is-active'), 5000);
    });
  });

  /* ======================= Window Listeners & Rebuild ======================= */
  window.addEventListener('scroll', updateNavScroll, { passive: true });
  updateNavScroll();

  let rebuildTimer;
  function rebuildAll() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      buildThread();
      refreshTitles();
    }, 120);
  }
  window.addEventListener('resize', rebuildAll, { passive: true });
  window.addEventListener('load', rebuildAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(rebuildAll);

  buildThread();
  requestAnimationFrame(onAnimationFrame);
})();
