const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;

/* ======================= services ======================= */
// [name, category, accent colour, url pattern used for detection]
const SERVICES = [
  ["YouTube", "Video", "#ff3d3d", /youtube\.com|youtu\.be/],
  ["YouTube Shorts", "Video", "#ff3d3d", /youtube\.com\/shorts/],
  ["Vimeo", "Video", "#1ab7ea", /vimeo\.com/],
  ["Dailymotion", "Video", "#2a7bff", /dailymotion\.com|dai\.ly/],
  ["Rumble", "Video", "#85c742", /rumble\.com/],
  ["Odysee", "Video", "#ef1970", /odysee\.com/],
  ["BitChute", "Video", "#ef4137", /bitchute\.com/],
  ["PeerTube", "Video", "#f1680d", /peertube/],
  ["Streamable", "Video", "#0f90fa", /streamable\.com/],
  ["Loom", "Video", "#625df5", /loom\.com/],
  ["Wistia", "Video", "#54bbff", /wistia/],
  ["Archive.org", "Video", "#cccccc", /archive\.org/],
  ["Bilibili", "Video", "#00a1d6", /bilibili\.com|b23\.tv/],
  ["Niconico", "Video", "#d6d6d6", /nicovideo\.jp/],
  ["TikTok", "Social", "#25f4ee", /tiktok\.com/],
  ["Instagram", "Social", "#e1306c", /instagram\.com/],
  ["Facebook", "Social", "#1877f2", /facebook\.com|fb\.watch/],
  ["X / Twitter", "Social", "#e7e9ea", /(?:^|\.|\/)(?:x|twitter)\.com/],
  ["Reddit", "Social", "#ff4500", /reddit\.com|redd\.it/],
  ["Threads", "Social", "#e7e9ea", /threads\.net/],
  ["Bluesky", "Social", "#1185fe", /bsky\.app/],
  ["Pinterest", "Social", "#e60023", /pinterest\./],
  ["Tumblr", "Social", "#5a7fa8", /tumblr\.com/],
  ["LinkedIn", "Social", "#0a66c2", /linkedin\.com/],
  ["Snapchat", "Social", "#fffc00", /snapchat\.com/],
  ["VK", "Social", "#0077ff", /vk\.com|vkvideo/],
  ["OK.ru", "Social", "#ee8208", /ok\.ru/],
  ["Weibo", "Social", "#e6162d", /weibo\./],
  ["Douyin", "Social", "#fe2c55", /douyin\.com/],
  ["Kuaishou", "Social", "#ff6a00", /kuaishou\.com/],
  ["Likee", "Social", "#ff4f8b", /likee\./],
  ["Imgur", "Social", "#1bb76e", /imgur\.com/],
  ["9GAG", "Social", "#d6d6d6", /9gag\.com/],
  ["Telegram", "Social", "#2aabee", /t\.me\//],
  ["Twitch", "Live & Gaming", "#9146ff", /twitch\.tv/],
  ["Kick", "Live & Gaming", "#53fc18", /kick\.com/],
  ["Medal", "Live & Gaming", "#f5c518", /medal\.tv/],
  ["Trovo", "Live & Gaming", "#19d66b", /trovo\.live/],
  ["SoundCloud", "Music & Audio", "#ff5500", /soundcloud\.com/],
  ["Bandcamp", "Music & Audio", "#1da0c3", /bandcamp\.com/],
  ["Mixcloud", "Music & Audio", "#5000ff", /mixcloud\.com/],
  ["Audiomack", "Music & Audio", "#ffa200", /audiomack\.com/],
  ["Apple Podcasts", "Music & Audio", "#b150e2", /podcasts\.apple\.com/],
  ["Podbean", "Music & Audio", "#7ec34b", /podbean\.com/],
  ["Substack", "Music & Audio", "#ff6719", /substack\.com/],
  ["BBC", "News & TV", "#e8e8e8", /bbc\.co/],
  ["CNN", "News & TV", "#cc0000", /cnn\.com/],
  ["NBC News", "News & TV", "#fccc12", /nbcnews\.com/],
  ["CBS News", "News & TV", "#3b8bff", /cbsnews\.com/],
  ["Reuters", "News & TV", "#ff8000", /reuters\.com/],
  ["Bloomberg", "News & TV", "#7d5cff", /bloomberg\.com/],
  ["Arte", "News & TV", "#fa481c", /arte\.tv/],
  ["ZDF", "News & TV", "#fa7d19", /zdf\.de/],
  ["ARD", "News & TV", "#0066cc", /ardmediathek|ard\.de/],
  ["France.tv", "News & TV", "#1a6dff", /france\.tv/],
  ["RTVE", "News & TV", "#e62e2e", /rtve\.es/],
  ["NHK", "News & TV", "#cfcfcf", /nhk\.or\.jp/],
  ["TED", "Learning", "#e62b1e", /ted\.com/],
  ["Khan Academy", "Learning", "#14bf96", /khanacademy\.org/],
  ["MIT OCW", "Learning", "#a31f34", /ocw\.mit\.edu/],
  ["Vimeo Showcase", "Learning", "#1ab7ea", /vimeo\.com\/showcase/],
  ["Nebula", "Learning", "#3e8bff", /nebula\.tv/],
];
const CATS = ["All", ...new Set(SERVICES.map(s => s[1]))];
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// brand icons (Simple Icons, CC0) in /icons; services without one get a monogram
const ICON = {
  "YouTube": "youtube", "YouTube Shorts": "youtubeshorts", "Vimeo": "vimeo", "Vimeo Showcase": "vimeo", "Dailymotion": "dailymotion",
  "Rumble": "rumble", "Odysee": "odysee", "PeerTube": "peertube", "Loom": "loom", "Wistia": "wistia", "Archive.org": "internetarchive",
  "Bilibili": "bilibili", "Niconico": "niconico", "TikTok": "tiktok", "Douyin": "tiktok", "Instagram": "instagram", "Facebook": "facebook",
  "X / Twitter": "x", "Reddit": "reddit", "Threads": "threads", "Bluesky": "bluesky", "Pinterest": "pinterest", "Tumblr": "tumblr",
  "LinkedIn": "linkedin", "Snapchat": "snapchat", "VK": "vk", "OK.ru": "odnoklassniki", "Weibo": "sinaweibo", "Kuaishou": "kuaishou",
  "Imgur": "imgur", "9GAG": "9gag", "Telegram": "telegram", "Twitch": "twitch", "Kick": "kick", "SoundCloud": "soundcloud",
  "Bandcamp": "bandcamp", "Mixcloud": "mixcloud", "Audiomack": "audiomack", "Apple Podcasts": "applepodcasts", "Substack": "substack",
  "CNN": "cnn", "NBC News": "nbc", "CBS News": "cbs", "ZDF": "zdf", "TED": "ted", "Khan Academy": "khanacademy", "Nebula": "nebula",
};
const ico = name => ICON[name]
  ? `<b class="ico" style="--i:url(/icons/${ICON[name]}.svg)"></b>`
  : `<b class="ico mono-ico">${esc(name.replace(/[^A-Za-z0-9 ]/g, "").split(" ").map(w => w[0]).join("").slice(0, 3) || name[0])}</b>`;

// marquee rows
const half = Math.ceil(SERVICES.length / 2);
[[$("#mq1"), SERVICES.slice(0, half)], [$("#mq2"), SERVICES.slice(half)]].forEach(([el, list]) => {
  const html = list.map(s => `<span class="mq" style="--c:${s[2]}">${ico(s[0])}${esc(s[0])}</span>`).join("");
  el.innerHTML = html + html; // duplicated for a seamless loop
});
$("#miniChips").innerHTML = SERVICES.filter((_, i) => i % 5 === 0).slice(0, 10)
  .map(s => `<span style="--c:${s[2]}">${ico(s[0])}${esc(s[0])}</span>`).join("") + `<span>+1000 more</span>`;

// directory with tabs + search
let activeCat = "All";
$("#tabs").innerHTML = CATS.map(c => {
  const n = c === "All" ? SERVICES.length : SERVICES.filter(s => s[1] === c).length;
  return `<button class="tab${c === "All" ? " on" : ""}" role="tab" data-cat="${c}">${c}<small>${n}</small></button>`;
}).join("");
function renderServices() {
  const q = $("#svcQ").value.trim().toLowerCase();
  const list = SERVICES.filter(s => (activeCat === "All" || s[1] === activeCat) && s[0].toLowerCase().includes(q));
  $("#svcGrid").innerHTML = list.length
    ? list.map((s, i) => `<div class="svc" style="--c:${s[2]};animation-delay:${Math.min(i, 24) * 22}ms">${ico(s[0])}<span>${esc(s[0])}</span><em>${esc(s[1].split(" ")[0])}</em></div>`).join("")
    : `<p class="svc-empty">No featured match. Paste the link anyway; Orbit supports 1000+ sites.</p>`;
  $("#svcCount").textContent = `${list.length} of ${SERVICES.length} featured services`;
  bindSpot($$(".svc"));
}
$("#tabs").addEventListener("click", e => {
  const b = e.target.closest(".tab"); if (!b) return;
  $$(".tab").forEach(t => t.classList.toggle("on", t === b));
  activeCat = b.dataset.cat; renderServices();
});
$("#svcQ").addEventListener("input", renderServices);

/* ======================= downloader ======================= */
const urlEl = $("#url"), errEl = $("#error"), loadEl = $("#loading"), cardEl = $("#card");
const fetchBtn = $("#fetch"), dlBtn = $("#dl"), qualityEl = $("#quality"), detEl = $("#detected");
let currentUrl = "";

const fmtTime = s => {
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60);
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
};
const showError = msg => { errEl.textContent = msg || ""; errEl.hidden = !msg; };
async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function detect() {
  const v = urlEl.value.trim();
  const hit = v && [...SERVICES].reverse().find(s => s[3].test(v)); // reverse so "Shorts" beats "YouTube"
  detEl.textContent = !v ? "Waiting for a link" : hit ? "● " + hit[0] + " detected" : /^https?:\/\//i.test(v) ? "● Link ready" : "Keep typing…";
  detEl.classList.toggle("found", !!hit || /^https?:\/\//i.test(v));
}
urlEl.addEventListener("input", detect);

async function fetchInfo(e) {
  e && e.preventDefault();
  detect();
  const url = urlEl.value.trim();
  if (!url) return;
  showError(""); cardEl.hidden = true; $("#progress").hidden = true;
  loadEl.hidden = false; fetchBtn.disabled = true; fetchBtn.firstElementChild.textContent = "Reading";
  try {
    const d = await api("/api/info", { url });
    currentUrl = url;
    $("#thumb").src = d.thumbnail || "";
    $("#title").textContent = d.title || "Untitled video";
    $("#site").textContent = d.site || "";
    $("#dur").textContent = fmtTime(d.duration);
    $("#sub").textContent = [d.uploader, d.heights && d.heights[0] ? "up to " + d.heights[0] + "p" : ""].filter(Boolean).join("  /  ");
    const hs = d.heights || [], opts = [["best", "Best available"]];
    [2160, 1440, 1080, 720, 480].forEach(h => { if (hs.some(x => x >= h)) opts.push([String(h), h === 2160 ? "4K (2160p)" : h + "p"]); });
    opts.push(["audio", "Audio only (MP3)"]);
    qualityEl.innerHTML = opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join("");
    cardEl.hidden = false;
  } catch (err) { showError(err.message); }
  finally { loadEl.hidden = true; fetchBtn.disabled = false; fetchBtn.firstElementChild.textContent = "Fetch"; }
}
$("#form").addEventListener("submit", fetchInfo);

$("#paste").addEventListener("click", async () => {
  try { urlEl.value = (await navigator.clipboard.readText()).trim(); fetchInfo(); }
  catch { urlEl.focus(); showError("Clipboard access was blocked. Press Ctrl+V in the box instead."); }
});
urlEl.addEventListener("paste", () => setTimeout(() => /^https?:\/\//i.test(urlEl.value.trim()) && fetchInfo(), 0));
$$("[data-sample]").forEach(b => b.addEventListener("click", () => { urlEl.value = b.dataset.sample; fetchInfo(); }));

dlBtn.addEventListener("click", async () => {
  const prog = $("#progress"), fill = $("#fill"), stat = $("#pstat");
  dlBtn.disabled = true; prog.hidden = false; prog.classList.remove("done");
  fill.style.width = "0"; stat.textContent = "Starting…"; showError("");
  try {
    const { id } = await api("/api/download", { url: currentUrl, quality: qualityEl.value });
    for (;;) {
      await new Promise(r => setTimeout(r, 600));
      const s = await api("/api/status/" + id);
      fill.style.width = s.percent + "%";
      if (s.state === "downloading") stat.textContent = `Downloading ${s.percent}%  ${s.speed}  ${s.eta ? "ETA " + s.eta : ""}`;
      if (s.state === "processing") stat.textContent = "Merging and finishing…";
      if (s.state === "error") throw new Error(s.error || "Download failed.");
      if (s.state === "done") {
        prog.classList.add("done");
        if (s.saved_to) {
          // Windows app: the file is already in Downloads\Orbit
          stat.textContent = "✓ Saved to " + s.saved_to + "  ";
          const b = document.createElement("button");
          b.type = "button"; b.className = "chip"; b.textContent = "Show in folder";
          b.onclick = () => api("/api/reveal/" + id, {});
          stat.appendChild(b);
        } else {
          stat.textContent = "✓ Done. Your file is saving.";
          const a = Object.assign(document.createElement("a"), { href: "/api/file/" + id, download: s.file });
          document.body.appendChild(a); a.click(); a.remove();
          addHistory($("#title").textContent, id);
        }
        break;
      }
    }
  } catch (err) { showError(err.message); prog.hidden = true; }
  finally { dlBtn.disabled = false; }
});

/* history, per browser; files expire server side after an hour */
function loadHistory() { try { return JSON.parse(localStorage.getItem("orbit-history") || "[]"); } catch { return []; } }
function addHistory(title, id) {
  const h = [{ title, id, t: Date.now() }, ...loadHistory()].slice(0, 6);
  try { localStorage.setItem("orbit-history", JSON.stringify(h)); } catch {}
  renderHistory();
}
function renderHistory() {
  const h = loadHistory().filter(x => Date.now() - x.t < 3600e3);
  $("#history").hidden = !h.length;
  $("#hlist").innerHTML = h.map(x => `<li><span>${esc(x.title)}</span><a href="/api/file/${x.id}" download>Again ↓</a></li>`).join("");
}
renderHistory();

/* ======================= hero text ======================= */
const WORDS = ["ANYTHING.", "SHORTS.", "REELS.", "CLIPS.", "PODCASTS.", "STREAMS.", "MUSIC."];
const rot = $("#rotator");
if (!reduceMotion) {
  let wi = 0;
  setTimeout(() => setInterval(() => {
    rot.classList.remove("swap"); rot.classList.add("out");
    setTimeout(() => { wi = (wi + 1) % WORDS.length; rot.textContent = WORDS[wi]; rot.classList.replace("out", "swap"); }, 380);
  }, 2600), 1400);
}

// example card in the hero: loops through a few sample downloads
(() => {
  const demos = [["YOUTUBE", "Sunset timelapse.mp4", "4K · MP4"], ["TIKTOK", "Street dance clip.mp4", "1080p · MP4"],
    ["SOUNDCLOUD", "Late night mix.mp3", "192 kbps · MP3"], ["VIMEO", "Short film trailer.mp4", "1440p · MP4"], ["REDDIT", "Funny cat moment.mp4", "720p · MP4"]];
  let i = 0, p = 0;
  const step = () => {
    p += 1.6 + Math.random() * 2.4;
    if (p >= 100) {
      $("#demoPct").textContent = "✓ Saved";
      setTimeout(() => { i = (i + 1) % demos.length; p = 0; show(); requestAnimationFrame(loop); }, 1400);
      $("#demoFill").style.width = "100%";
      return false;
    }
    $("#demoFill").style.width = p + "%"; $("#demoPct").textContent = Math.floor(p) + "%";
    return true;
  };
  const show = () => { const d = demos[i]; $("#demoSite").textContent = d[0]; $("#demoTitle").textContent = d[1]; $("#demoQ").textContent = d[2]; };
  let last = 0;
  function loop(t) { if (t - last > 90) { last = t; if (!step()) return; } requestAnimationFrame(loop); }
  show(); if (!reduceMotion) requestAnimationFrame(loop);
})();

/* ======================= scroll effects ======================= */
const io = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  e.target.classList.add("in"); io.unobserve(e.target);
  const n = e.target.querySelector("[data-count]"); if (n) countUp(n);
}), { threshold: .15, rootMargin: "0px 0px -40px 0px" });
$$(".reveal").forEach(el => {
  const sibs = [...el.parentElement.children].filter(c => c.classList.contains("reveal"));
  el.style.transitionDelay = Math.min(sibs.indexOf(el), 5) * 90 + "ms";
  io.observe(el);
});

function countUp(el) {
  const to = +el.dataset.count, suf = el.dataset.suffix || "", t0 = performance.now(), dur = 1600;
  const tick = t => {
    const k = Math.min(1, (t - t0) / dur), v = Math.round(to * (1 - Math.pow(1 - k, 4)));
    el.textContent = v.toLocaleString() + suf;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// manifesto: words light up as you scroll
const KEYS = ["orbit", "link", "file", "watermark", "limits"];
const mt = $("#mtext");
mt.innerHTML = mt.textContent.split(/\s+/).map(w => `<span class="w${KEYS.includes(w.toLowerCase().replace(/\W/g, "")) ? " key" : ""}">${w}</span>`).join(" ");
const words = $$(".big .w"), mSec = $("#manifesto"), steps = $("#steps"), stepEls = $$(".step"), nav = $("#nav");
const sections = $$("main section[id]"), navLinks = $$(".links a");

function onScroll() {
  const y = scrollY, H = document.documentElement.scrollHeight - innerHeight;
  $("#sbar").style.transform = `scaleX(${H > 0 ? y / H : 0})`;
  nav.classList.toggle("scrolled", y > 20);

  const r = mSec.getBoundingClientRect(), total = r.height - innerHeight;
  const p = Math.min(1, Math.max(0, -r.top / total)) * 1.12;
  words.forEach((w, i) => w.classList.toggle("on", i / words.length < p));

  const sr = steps.getBoundingClientRect();
  const sp = Math.min(1, Math.max(0, (innerHeight * .75 - sr.top) / (sr.height + innerHeight * .2)));
  $("#stepsFill").style.transform = `scaleX(${sp})`;
  stepEls.forEach((s, i) => s.classList.toggle("lit", sp >= i / 2 - .02));

  let cur = "";
  sections.forEach(s => { if (s.getBoundingClientRect().top < innerHeight * .4) cur = s.id; });
  navLinks.forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + cur));
}
addEventListener("scroll", onScroll, { passive: true }); onScroll();

/* ======================= pointer effects ======================= */
function bindSpot(els) {
  els.forEach(el => {
    if (el._spot) return; el._spot = 1;
    el.addEventListener("pointermove", e => {
      const b = el.getBoundingClientRect();
      el.style.setProperty("--mx", e.clientX - b.left + "px");
      el.style.setProperty("--my", e.clientY - b.top + "px");
    });
  });
}
bindSpot($$(".spot"));
renderServices();

if (finePointer && !reduceMotion) {
  // magnetic buttons
  $$(".magnetic").forEach(el => {
    el.addEventListener("pointermove", e => {
      const b = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - b.left - b.width / 2) * .22}px,${(e.clientY - b.top - b.height / 2) * .3}px)`;
    });
    el.addEventListener("pointerleave", () => { el.style.transform = ""; });
  });
  // tilt on bento tiles
  $$(".tile").forEach(el => {
    el.addEventListener("pointermove", e => {
      const b = el.getBoundingClientRect(), x = (e.clientX - b.left) / b.width - .5, y = (e.clientY - b.top) / b.height - .5;
      el.style.transform = `perspective(900px) rotateX(${-y * 5}deg) rotateY(${x * 6}deg) translateY(-2px)`;
    });
    el.addEventListener("pointerleave", () => { el.style.transform = ""; });
  });
  // cursor glow
  const glow = $(".cursor-glow");
  addEventListener("pointermove", e => { glow.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; });
} else $(".cursor-glow").style.display = "none";

/* ======================= misc ======================= */
$$("[data-focus]").forEach(a => a.addEventListener("click", () => setTimeout(() => urlEl.focus({ preventScroll: true }), 600)));
const burger = $("#burger"), links = $("#links");
burger.addEventListener("click", () => { const o = links.classList.toggle("open"); burger.setAttribute("aria-expanded", o); });
links.addEventListener("click", () => { links.classList.remove("open"); burger.setAttribute("aria-expanded", false); });
$("#yr").textContent = new Date().getFullYear();

/* ======================= stars + black hole ======================= */
// gaussian-ish offsets: most particles hug the event horizon, a few drift far out as dust
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / .58;
function makeParts(n) {
  return Array.from({ length: n }, () => {
    let u = gauss(); if (Math.random() < .08) u = 1.5 + Math.random() * 3.5;
    return { a: Math.random() * 6.283, u, s: .12 + Math.random() * .35, z: Math.random() < .82 ? 1 : 1.8, al: .3 + Math.random() * .7 };
  });
}
// R: horizon radius, W: width of the particle band, stroke: solid ring thickness (as a fraction of R)
function drawHole(g, cx, cy, R, W, parts, t, dpr, stroke = 0) {
  const halo = R + W * 4.5;
  const gl = g.createRadialGradient(cx, cy, R * .95, cx, cy, halo);
  gl.addColorStop(0, "rgba(255,255,255,.22)"); gl.addColorStop(.25, "rgba(255,255,255,.06)"); gl.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gl; g.beginPath(); g.arc(cx, cy, halo, 0, 6.283); g.fill();
  g.fillStyle = "#000"; g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.fill();
  g.strokeStyle = "#fff"; g.lineWidth = stroke ? R * stroke : Math.max(dpr, R * .012);
  g.beginPath(); g.arc(cx, cy, R + (stroke ? R * stroke / 2 : 0), 0, 6.283); g.stroke();
  g.fillStyle = "#fff";
  const base = R + (stroke ? R * stroke / 2 : 0);
  for (const p of parts) {
    const rr = base + p.u * W;
    if (rr < R * .9) continue;
    const a = p.a + t * p.s * Math.pow(base / rr, 1.5);
    const sz = p.z * dpr;
    g.globalAlpha = p.al * Math.max(0, 1 - Math.abs(p.u) / 5);
    g.fillRect(cx + Math.cos(a) * rr - sz / 2, cy + Math.sin(a) * rr - sz / 2, sz, sz);
  }
  g.globalAlpha = 1;
}

(() => {
  const c = $("#stars"), g = c.getContext("2d");
  let w, h, dpr, stars = [], shooting = [], mx = 0, my = 0, tmx = 0, tmy = 0, px = -9999, py = -9999;
  const portalParts = makeParts(2600);
  function build() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = c.width = innerWidth * dpr; h = c.height = innerHeight * dpr;
    const n = Math.round(innerWidth * innerHeight / 2600);
    stars = Array.from({ length: n }, () => {
      const z = Math.random() ** 2;   // most stars far and faint, like fine dust
      return { x: Math.random() * w, y: Math.random() * h, z, r: (.3 + z * 1.1) * dpr, tw: Math.random() * 6.28, ts: .5 + Math.random() * 2 };
    });
  }
  addEventListener("resize", build); build();
  addEventListener("pointermove", e => { tmx = e.clientX / innerWidth - .5; tmy = e.clientY / innerHeight - .5; px = e.clientX * dpr; py = e.clientY * dpr; });

  // small particle "O" letters
  const rings = $$(".o-ring").map(el => {
    const cv = document.createElement("canvas"); el.appendChild(cv);
    return { el, cv, g: cv.getContext("2d"), parts: makeParts(520) };
  });

  const ease = k => k * k * (3 - 2 * k);
  let t = 0;
  function frame() {
    t += .016;
    mx += (tmx - mx) * .05; my += (tmy - my) * .05;
    g.clearRect(0, 0, w, h);

    // where are the black holes this frame?
    const holes = [];
    const mr = mSec.getBoundingClientRect(), span = mr.height + innerHeight;
    const q = (innerHeight - mr.top) / span, diag = Math.hypot(w, h) * .62;
    if (q > 0 && q < 1) {
      // grow until the screen is swallowed, stay inside while the manifesto reads, then collapse
      const R = q < .3 ? diag * ease(q / .3) ** 2 : q < .7 ? diag : diag * (1 - ease((q - .7) / .3));
      if (R > 1) holes.push({ x: w / 2, y: h / 2, R, W: Math.min(R * .16, 70 * dpr), parts: portalParts });
    }

    // stars, bent outward around each hole (cheap gravitational lensing)
    const sy = scrollY * dpr, near = [];
    for (const s of stars) {
      s.x -= (.03 + s.z * .16) * dpr; if (s.x < -4) s.x += w + 8;
      let x = s.x - mx * 40 * s.z * dpr;
      let y = (s.y - sy * (.04 + s.z * .2) - my * 30 * s.z * dpr) % h; if (y < 0) y += h;
      let hidden = false;
      for (const H of holes) {
        const dx = x - H.x, dy = y - H.y, d = Math.hypot(dx, dy) || 1;
        if (d < H.R * 3.2) { const f = 1 + Math.min(2.5, (H.R * H.R * .9) / (d * d)); x = H.x + dx * f; y = H.y + dy * f; }
        if (d < H.R) hidden = true;
      }
      if (hidden) continue;
      const a = (.3 + .7 * Math.abs(Math.sin(t * s.ts + s.tw))) * (.25 + s.z * .75);
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.fillRect(x - s.r / 2, y - s.r / 2, s.r, s.r);
      if (s.z > .5 && Math.abs(x - px) < 150 * dpr && Math.abs(y - py) < 150 * dpr) near.push([x, y]);
    }
    // faint constellation lines around the cursor
    g.lineWidth = .6 * dpr;
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const d = Math.hypot(near[i][0] - near[j][0], near[i][1] - near[j][1]);
      if (d < 100 * dpr) { g.strokeStyle = `rgba(255,255,255,${(1 - d / (100 * dpr)) * .3})`; g.beginPath(); g.moveTo(near[i][0], near[i][1]); g.lineTo(near[j][0], near[j][1]); g.stroke(); }
    }
    // shooting stars
    if (Math.random() < .005 && shooting.length < 2)
      shooting.push({ x: Math.random() * w * .8 + w * .2, y: Math.random() * h * .4, vx: -(9 + Math.random() * 7) * dpr, vy: (4 + Math.random() * 3) * dpr, life: 1 });
    shooting = shooting.filter(s => s.life > 0);
    for (const s of shooting) {
      s.x += s.vx; s.y += s.vy; s.life -= .018;
      const gr = g.createLinearGradient(s.x, s.y, s.x - s.vx * 12, s.y - s.vy * 12);
      gr.addColorStop(0, `rgba(255,255,255,${s.life})`); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.strokeStyle = gr; g.lineWidth = 1.3 * dpr;
      g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - s.vx * 12, s.y - s.vy * 12); g.stroke();
    }

    for (const H of holes) drawHole(g, H.x, H.y, H.R, H.W, H.parts, t, dpr);

    // particle O letters (only when on screen)
    for (const r of rings) {
      const b = r.cv.getBoundingClientRect();
      if (b.bottom < 0 || b.top > innerHeight || !b.width) continue;
      const W2 = Math.round(b.width * dpr), H2 = Math.round(b.height * dpr);
      if (r.cv.width !== W2 || r.cv.height !== H2) { r.cv.width = W2; r.cv.height = H2; }
      r.g.clearRect(0, 0, W2, H2);
      const R = W2 * .2;   // letter is 1/1.7 of the canvas; inner hole ~ 40% of the letter
      drawHole(r.g, W2 / 2, H2 / 2, R, R * .1, r.parts, t * 1.4, dpr * .8, .42);
    }

    if (!reduceMotion) requestAnimationFrame(frame);
  }
  frame();
})();
