/* Orbit motion helpers: tap ripples, direction-aware screen transitions, scroll-aware top bar.
   Purely visual; the app works the same if this file fails to load. */
(() => {
  const main = document.querySelector(".main");
  const topbar = document.querySelector(".app-topbar");
  const nav = document.getElementById("nav");
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const RIPPLE = ".solid,.btn-fetch,.ghost-btn,.iconbtn,.chip,.paste,.lib-act-btn,.sheet-app,.sheet-opt,.q-chip,.speed-pill,.pin-num,.seg button,.lib-seg-btn,.theme-chip,.link-btn";

  if (!reduce) {
    document.addEventListener("pointerdown", e => {
      const t = e.target.closest(RIPPLE);
      if (!t || t.disabled) return;
      t.classList.add("fx");
      const r = t.getBoundingClientRect();
      const d = Math.max(r.width, r.height) * 1.7;
      const s = document.createElement("span");
      s.className = "ripple";
      s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
      t.appendChild(s);
      s.addEventListener("animationend", () => s.remove());
    }, { passive: true });
  }

  // Screens slide in from the side of the tab you tapped.
  const order = ["download", "library", "search", "settings"];
  if (nav && main) {
    nav.addEventListener("click", e => {
      const b = e.target.closest(".nav-btn");
      if (!b) return;
      const cur = nav.querySelector(".nav-btn.on");
      const from = cur ? order.indexOf(cur.dataset.view) : 0;
      const to = order.indexOf(b.dataset.view);
      main.dataset.dir = to >= from ? "next" : "prev";
      main.scrollTop = 0;
    }, true);
  }

  // Top bar gains a frosted background once content scrolls under it.
  if (main && topbar) {
    let ticking = false;
    main.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        topbar.classList.toggle("scrolled", main.scrollTop > 6);
        ticking = false;
      });
    }, { passive: true });
  }
})();
