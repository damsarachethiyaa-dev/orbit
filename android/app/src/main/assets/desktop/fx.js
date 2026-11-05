/* Orbit: small visual helpers. The app works the same if this file fails to load. */
(() => {
  const main = document.querySelector(".main");
  const top = document.getElementById("topbar");
  if (main && top) {
    let tick = false;
    main.addEventListener("scroll", () => {
      if (tick) return; tick = true;
      requestAnimationFrame(() => { top.classList.toggle("scrolled", main.scrollTop > 4); tick = false; });
    }, { passive: true });
  }
})();
