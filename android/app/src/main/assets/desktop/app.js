/* Real system bar sizes from Android, since the app draws behind them. */
window.setSafeInsets = (top, bottom, left, right) => {
  const r = document.documentElement.style;
  r.setProperty("--safe-top", top + "px"); r.setProperty("--safe-bottom", bottom + "px");
  r.setProperty("--safe-left", left + "px"); r.setProperty("--safe-right", right + "px");
  if (typeof measureGrid === "function") { try { measureGrid(); } catch {} }
};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------------- brand icons (files in /icons) ---------------- */
const BRANDS = {
  youtube: ["youtube", "#ff3d3d"], tiktok: ["tiktok", "#25f4ee"], instagram: ["instagram", "#e1306c"], facebook: ["facebook", "#1877f2"],
  twitter: ["x", "#e7e9ea"], x: ["x", "#e7e9ea"], vimeo: ["vimeo", "#1ab7ea"], reddit: ["reddit", "#ff4500"], twitch: ["twitch", "#9146ff"],
  soundcloud: ["soundcloud", "#ff5500"], dailymotion: ["dailymotion", "#2a7bff"], bilibili: ["bilibili", "#00a1d6"], pinterest: ["pinterest", "#e60023"],
  tumblr: ["tumblr", "#5a7fa8"], linkedin: ["linkedin", "#0a66c2"], snapchat: ["snapchat", "#fffc00"], vk: ["vk", "#0077ff"], telegram: ["telegram", "#2aabee"],
  imgur: ["imgur", "#1bb76e"], rumble: ["rumble", "#85c742"], odysee: ["odysee", "#ef1970"], kick: ["kick", "#53fc18"], bandcamp: ["bandcamp", "#1da0c3"],
  mixcloud: ["mixcloud", "#5000ff"], threads: ["threads", "#e7e9ea"], bluesky: ["bluesky", "#1185fe"], loom: ["loom", "#625df5"], ted: ["ted", "#e62b1e"],
  xiaohongshu: ["xiaohongshu", "#ff2442"], xhs: ["xiaohongshu", "#ff2442"], red: ["xiaohongshu", "#ff2442"],
  douyin: ["douyin", "#010101"], kuaishou: ["kuaishou", "#ff4400"], kwai: ["kuaishou", "#ff4400"],
};
const BRAND_KEYS = Object.keys(BRANDS).sort((a, b) => b.length - a.length);
const BRAND_DOMAINS = [
  [/^(?:.+\.)?(?:tiktok\.com|tiktokcdn\.com|muscdn\.com)$/, "tiktok"],
  [/^(?:.+\.)?(?:instagram\.com|cdninstagram\.com)$/, "instagram"],
  [/^(?:.+\.)?(?:youtube\.com|youtu\.be|ytimg\.com)$/, "youtube"],
  [/^(?:.+\.)?(?:facebook\.com|fb\.watch)$/, "facebook"],
  [/^(?:.+\.)?(?:twitter\.com|x\.com|twimg\.com)$/, "twitter"],
  [/^(?:.+\.)?pinterest\.com$/, "pinterest"],
  [/^(?:.+\.)?reddit\.com$/, "reddit"],
  [/^(?:.+\.)?vimeo\.com$/, "vimeo"],
];
function brand(site, url = "", thumb = "") {
  const k = String(site || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const hit = BRAND_KEYS.find(b => b.length <= 2 ? k === b : k.startsWith(b));   // short keys must match exactly ("x" is not "xvideos")
  if (hit) return BRANDS[hit];
  for (const source of [url, thumb]) {
    try {
      const host = new URL(source).hostname.toLowerCase();
      const domain = BRAND_DOMAINS.find(([pattern]) => pattern.test(host));
      if (domain) return BRANDS[domain[1]];
    } catch {}
  }
  return null;
}
const icoStyle = (site, url, thumb) => { const b = brand(site, url, thumb); return b ? `--i:url(/icons/${b[0]}.svg);` : "--i:url(/desktop/video.svg);"; };
const icoHtml = (site, url, thumb) => `<span class="ico" role="img" aria-label="${esc(site || "Media")}" style="${icoStyle(site, url, thumb)}"></span>`;

/* ---------------- helpers ---------------- */
const fmtTime = s => { if (!s) return ""; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60); return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const fmtSize = b => !b ? "" : b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB";
const QLABEL = { best: "Best", 2160: "4K", 1440: "1440p", 1080: "1080p", 720: "720p", 480: "480p", audio: "MP3" };
const baseName = p => String(p || "").split(/[\\/]/).filter(Boolean).pop() || "";
async function api(path, body, method) {
  if (window.OrbitAndroid && typeof window.OrbitAndroid.callApi === "function") {
    const m = method || (body !== undefined ? "POST" : "GET");
    const b = body !== undefined ? JSON.stringify(body) : "";
    const raw = await new Promise(resolve => {
      const cb = "__orbit_cb_" + Math.random().toString(36).slice(2) + "_" + Date.now();
      window[cb] = resJson => { delete window[cb]; resolve(resJson); };
      window.OrbitAndroid.callApi(cb, path, m, b);
    });
    const data = JSON.parse(raw || "{}");
    if (data && data.__error) throw new Error(data.__error);
    return data;
  }
  const r = await fetch(path, body !== undefined || method
    ? { method: method || "POST", headers: { "Content-Type": "application/json", "X-Orbit": "1" }, body: body !== undefined ? JSON.stringify(body) : undefined }
    : { headers: { "X-Orbit": "1" } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); }
function triggerHaptic() {
  try {
    if (window.OrbitAndroid && typeof window.OrbitAndroid.haptic === "function") {
      window.OrbitAndroid.haptic();
    } else if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  } catch {}
}

const showError = m => {
  const card = $("#error");
  if (!m) { card.hidden = true; return; }
  let clean = String(m || "").trim();
  if (clean.includes("No video formats found") || clean.includes("No video stream found")) {
    clean = "No downloadable stream found. This video or reel might be private, restricted, or DRM protected.";
  } else if (clean.toLowerCase().includes("login") || clean.toLowerCase().includes("sign in")) {
    clean = "This video is restricted or from a private account.";
  } else if (clean.includes("; please report")) {
    clean = clean.split("; please report")[0];
  }
  const t = $("#errorText");
  if (t) t.textContent = clean;
  else card.textContent = clean;
  card.hidden = false;
};
const svg = d => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const I = { play: "M8 5l11 7-11 7z", folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zm-12 0V7a5 5 0 0 1 10 0v4", compress: "M4 14h6v6m10-10h-6V4m0 6 7-7M10 14l-7 7", share: "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z", x: "M6 6l12 12M18 6L6 18", trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3", dl: "M12 3v12m0 0l-4-4m4 4l4-4M4 20h16", retry: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" };
const ACTIVE = ["queued", "downloading", "processing"];

/* ---------------- views ---------------- */
let cfg = { default_quality: "best", save_dir: "" };
let curView = "library", lastTab = "library";
const viewScroll = {};
function show(view, keepFilter) {
  triggerHaptic();
  if (typeof exitSelect === "function" && selMode) exitSelect();
  const same = view === curView, main = $(".main");
  viewScroll[curView] = main.scrollTop;
  const hadFilter = libFilter.type !== "all";
  if (view === "library" && !keepFilter) libFilter = { type: "all" };
  if (view !== "library") { vaultUnlocked = false; vaultAskedAuth = false; vaultResetting = false; vaultNewPin = ""; }      // the vault locks again as soon as you leave it
  curView = view;
  if (!["settings", "search", "photosview", "notices"].includes(view)) lastTab = view;
  if (view !== "library") { apStop(); datePill.classList.remove("on"); }
  dockFlip(() => {
    document.body.dataset.view = view;
    $$(".nav-btn").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  });
  $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + view));
  main.scrollTop = same || keepFilter || (view === "library" && hadFilter) ? 0 : (viewScroll[view] || 0);
  if (view === "library") loadLib();
  if (view === "collections") loadCollections();
  if (view === "settings") loadSettings();
  if (view === "notices") openNotices();
  if (view === "search") setTimeout(() => { const i = $("#searchInput"); if (i && !i.value) i.focus(); }, 60);
}
const DOCK_EASE = "cubic-bezier(.2,.9,.25,1)", DOCK_MS = 280;
const calmMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
let indX = 0, indW = 0;
function placeDockInd() {
  const on = document.querySelector(".dock-pill .nav-btn.on"), ind = $("#dockInd");
  if (!on) { ind.style.opacity = 0; indW = 0; return null; }
  indX = on.offsetLeft; indW = on.offsetWidth;
  ind.style.opacity = 1; ind.style.width = indW + "px"; ind.style.transform = `translate3d(${indX}px,0,0)`;
  return on;
}
const moveDockInd = placeDockInd;
/* The pill's layout changes once, instantly; everything you see moving is a compositor animation of that change. */
function dockFlip(apply) {
  const btns = $$(".dock-pill .nav-btn"), from = btns.map(b => b.offsetLeft), oldX = indX, oldW = indW, ind = $("#dockInd");
  apply();
  const on = placeDockInd();
  if (calmMotion) return;
  btns.forEach((b, i) => { const dx = from[i] - b.offsetLeft; if (dx) b.animate([{ transform: `translate3d(${dx}px,0,0)` }, { transform: "none" }], { duration: DOCK_MS, easing: DOCK_EASE }); });
  if (on && oldW) {
    ind.animate([{ transform: `translate3d(${oldX}px,0,0) scaleX(${oldW / indW})` }, { transform: `translate3d(${indX}px,0,0) scaleX(1)` }], { duration: DOCK_MS, easing: DOCK_EASE });
    const icon = on.querySelector(".nav-icon-wrap");
    if (icon) icon.animate([{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: DOCK_EASE });
  }
}
$("#nav").addEventListener("click", e => { const b = e.target.closest(".nav-btn"); if (b) show(b.dataset.view); });

const pClose = $("#pClose");
if (pClose) pClose.onclick = () => { triggerHaptic(); $("#preview").hidden = true; info = null; };

/* ---------------- fetch link info ---------------- */
const urlEl = $("#url");
let info = null, fetching = false, singleOnly = false;
let plItems = [], plUrl = "";
function openPlaylistPicker(p, url) {
  const usable = p.items.filter(x => x.title && x.title !== "null" && !/^\[(private|deleted)/i.test(x.title));
  const hiddenCount = p.items.length - usable.length;
  plItems = usable.map(x => ({ ...x, on: true, site: String(p.site || "").replace(/Tab$/, "") })); plUrl = url;
  $("#sheetTitle").textContent = p.title || "Playlist";
  $("#sheetSub").textContent = hiddenCount ? `Choose what to download. ${hiddenCount} private or removed ${hiddenCount === 1 ? "item is" : "items are"} hidden.` : "Choose what to download";
  $("#sheetBody").innerHTML = `<div class="pl-bar"><button type="button" class="link-btn" id="plAll">Select none</button>${/[?&]v=/.test(url) ? '<button type="button" class="link-btn" id="plOne">Only this video</button>' : ""}</div>
    <div class="pl-list">${plItems.map((x, i) => `<button type="button" class="pl-row on" data-pl="${i}"><span class="pl-thumb">${x.thumb ? `<img alt="" loading="lazy" src="${esc(x.thumb)}">` : ""}${x.duration ? `<span class="dur">${longDur(x.duration)}</span>` : ""}</span><span class="pl-name">${esc(x.title)}</span><i class="pl-check"></i></button>`).join("")}</div>
    <button type="button" class="solid pl-go" id="plGo">Download ${plItems.length}</button>`;
  sheet.hidden = false;
}
function plPaint() {
  const n = plItems.filter(x => x.on).length;
  $("#plGo").textContent = `Download ${n}`; $("#plGo").disabled = !n;
  $("#plAll").textContent = n ? "Select none" : "Select all";
}
function wirePlaylist() {
  $("#sheetBody").addEventListener("click", async e => {
    const row = e.target.closest("[data-pl]");
    if (row) { const it = plItems[+row.dataset.pl]; it.on = !it.on; row.classList.toggle("on", it.on); plPaint(); return; }
    if (e.target.id === "plAll") { const anyOn = plItems.some(x => x.on); plItems.forEach(x => { x.on = !anyOn; }); $$("#sheetBody .pl-row").forEach(r => r.classList.toggle("on", !anyOn)); plPaint(); return; }
    if (e.target.id === "plOne") { closeSheet(); singleOnly = true; urlEl.value = plUrl.replace(/([?&])list=[^&]*&?/, "$1").replace(/[?&]$/, ""); fetchInfo(); return; }
    if (e.target.id === "plGo") {
      const picked = plItems.filter(x => x.on);
      closeSheet(); urlEl.value = "";
      for (const x of picked) { try { await api("/api/download", { url: x.url, title: x.title, thumb: x.thumb, site: x.site, quality: cfg.default_quality || "best" }); } catch {} }
      toast(`${picked.length} added to the queue`); poll();
    }
  });
}

function normalizeUrl(v) {
  if (!v) return "";
  const match = String(v).match(/https?:\/\/[^\s]+/i);
  if (match) return match[0].replace(/[.,;!?\]\)>]+$/, "");
  v = v.trim().split(/\s+/)[0] || "";
  if (v && !/^https?:\/\//i.test(v) && /^[\w-]+(\.[\w-]+)+/.test(v)) v = "https://" + v;
  return v;
}
async function fetchInfo(e) {
  e && e.preventDefault();
  if (fetching) return;
  const url = normalizeUrl(urlEl.value);
  if (!url) return;
  urlEl.value = url; showError(""); $("#preview").hidden = true; $("#clip").hidden = true;
  fetching = true; $("#skeleton").hidden = false; $("#fetch").disabled = true;
  try {
    if (/[?&]list=|\/playlist\b|\/sets\/|\/album\//i.test(url) && !singleOnly) {
      const p = await api("/api/playlist", { url }).catch(() => null);
      if (p && p.items && p.items.length > 1) { openPlaylistPicker(p, url); return; }
    }
    singleOnly = false;
    const d = await api("/api/info", { url });
    info = { ...d, url };
    const isImage = d.type === "image";
    info.isImage = isImage;
    $("#pThumb").src = d.thumbnail || "";
    $("#pTitle").textContent = d.title || (isImage ? "Photo" : "Untitled video");
    $("#pSite").textContent = d.site || (isImage ? "Photo" : "Video");
    $("#pIco").style.cssText = icoStyle(d.site);
    $("#pDur").textContent = isImage ? (d.count ? `${d.count} photo${d.count > 1 ? "s" : ""}` : "Photo") : fmtTime(d.duration);
    $("#pSub").textContent = [d.uploader, isImage ? "Original High-Res" : (d.heights && d.heights[0] ? "up to " + d.heights[0] + "p" : "")].filter(Boolean).join("  /  ");

    if (isImage) {
      $("#seg").hidden = true;
      $("#qualityHint").hidden = true;
      const count = d.count || (d.imageUrls ? d.imageUrls.length : 1);
      $("#quality").innerHTML = `<option value="image">Original Resolution</option>`;
      $("#quality").disabled = false;
      $("#dl").innerHTML = `<span>${count > 1 ? `Download All Photos (${count})` : "Download Photo"}</span>${svg(I.dl)}`;
      info.picked = new Set((d.imageUrls || []).map((_, i) => i));
      const pick = $("#pPick");
      pick.hidden = !(d.imageUrls && d.imageUrls.length > 1);
      pick.innerHTML = pick.hidden ? "" : d.imageUrls.map((u, i) => `<button type="button" class="pp on" data-pp="${i}"><img alt="" loading="lazy" src="${esc(u)}"><i></i></button>`).join("");
    } else {
      $("#seg").hidden = false;
      $("#pPick").hidden = true;
      $("#dl").innerHTML = `<span>Download</span>${svg(I.dl)}`;
      renderQualityOptions(cfg.default_quality);
      setKind(d.audioOnly || cfg.default_quality === "audio" ? "audio" : "video");
      if (d.audioOnly) {          // no video track exists, so don't offer one
        $("#seg").hidden = true;
        $("#quality").innerHTML = '<option value="audio">MP3, best quality</option>';
        $("#dl").innerHTML = `<span>Download MP3</span>${svg(I.dl)}`;
      }
    }
    $("#preview").hidden = false;

    // Automatic download if enabled in Settings
    // A post with several photos waits, so you can choose which ones to keep.
    if (cfg && cfg.auto_download && !(isImage && (info.imageUrls || []).length > 1)) {
      toast(isImage ? "Auto-downloading photo..." : "Auto-downloading video...");
      setTimeout(() => {
        if ($("#dl") && !$("#dl").disabled) {
          $("#dl").click();
        }
      }, 400);
    }
  } catch (err) { showError(err.message); }
  finally { fetching = false; $("#skeleton").hidden = true; $("#fetch").disabled = false; }
}
$("#form").addEventListener("submit", fetchInfo);

function setKind(kind) {
  $$("#seg button").forEach(b => b.classList.toggle("on", b.dataset.kind === kind));
  $("#quality").disabled = kind === "audio";
  $("#qualityHint").hidden = kind === "audio" || !!(info && info.isImage);
}

/* Quality choices come from the formats the site really offers. Nothing is re-compressed at download. */
function renderQualityOptions(keep) {
  if (!info || info.isImage) return;
  const hs = info.heights || [], top = hs[0] || 0;
  const opts = [];
  if (!hs.length) opts.push(["best", "Original quality"]);
  else opts.push(["best", `Maximum · ${top}p`]);
  [2160, 1440, 1080, 720, 480].forEach(h => {
    if (!hs.some(x => x >= h)) return;
    opts.push([String(h), h === 2160 ? "4K (2160p)" : h + "p"]);
  });
  if (info.imageUrls && info.imageUrls.length > 0) opts.push(["photo", `Photos only (${info.imageUrls.length})`]);
  const prevVal = keep || $("#quality").value;
  $("#quality").innerHTML = opts.map(o => `<option value="${o[0]}">${esc(o[1])}</option>`).join("");
  if (opts.some(o => o[0] === prevVal)) $("#quality").value = prevVal;
}
$("#seg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setKind(b.dataset.kind); });

/* ---------------- clipboard, paste and drop ---------------- */
let lastClip = "";
const asUrl = t => {
  if (!t) return "";
  const m = String(t).match(/https?:\/\/[^\s]+/i);
  if (m) return m[0].replace(/[.,;!?\]\)>]+$/, "");
  const w = String(t).trim().split(/\s+/)[0];
  return /^https?:\/\/\S+$/i.test(w) ? w : "";
};
async function checkClip() {
  try {
    const u = asUrl((await api("/api/clipboard")).text);
    if (u && u !== lastClip && u !== urlEl.value.trim()) { lastClip = u; $("#clipUrl").textContent = u; $("#clip").hidden = false; showFloatingBubble(u); }
  } catch {}
}
window.checkClip = checkClip;
addEventListener("focus", checkClip);
$("#clipUse").onclick = () => { urlEl.value = lastClip; $("#clip").hidden = true; fetchInfo(); };
$("#clipX").onclick = () => { $("#clip").hidden = true; };
$("#paste").onclick = async () => {
  try {
    const t = (await api("/api/clipboard")).text;
    if (!t) return toast("Clipboard is empty");
    urlEl.value = t; fetchInfo();
  } catch { toast("Couldn't read the clipboard"); }
};
addEventListener("paste", e => {
  if (document.activeElement === urlEl) { setTimeout(() => asUrl(urlEl.value) && fetchInfo(), 0); return; }
  const u = asUrl(e.clipboardData && e.clipboardData.getData("text"));
  if (u) { show("download"); urlEl.value = u; fetchInfo(); }
});
let dragDepth = 0;
addEventListener("dragenter", e => { e.preventDefault(); dragDepth++; document.body.classList.add("drop"); });
addEventListener("dragover", e => e.preventDefault());
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("drop"); } });
addEventListener("drop", e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("drop");
  const u = asUrl(e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"));
  if (u) { show("download"); urlEl.value = u; fetchInfo(); } else toast("That isn't a web link");
});

/* ---------------- start a download ---------------- */
$("#pPick").addEventListener("click", e => {
  const b = e.target.closest("[data-pp]"); if (!b || !info) return;
  const i = +b.dataset.pp;
  if (info.picked.has(i)) info.picked.delete(i); else info.picked.add(i);
  b.classList.toggle("on", info.picked.has(i));
  const n = info.picked.size;
  $("#dl").disabled = !n;
  $("#dl").querySelector("span").textContent = n === 1 ? "Download 1 Photo" : `Download ${n} Photos`;
});
$("#dl").onclick = async () => {
  if (!info) return;
  const isImage = info.isImage || info.type === "image" || $("#quality").value === "photo" || $("#quality").value === "image";
  const kind = $("#seg .on") ? $("#seg .on").dataset.kind : "video";
  const quality = isImage ? "image" : (kind === "audio" ? "audio" : $("#quality").value);
  $("#dl").disabled = true;
  try {
    await api("/api/download", {
      url: info.url,
      directUrl: isImage ? (info.directUrl || info.thumbnail || "") : (info.directUrl || ""),
      imageUrls: isImage ? (info.imageUrls || []).filter((_, i) => !info.picked || info.picked.has(i)) : [],
      quality,
      type: isImage ? "image" : "video",
      title: info.title,
      site: info.site,
      thumb: info.thumbnail
    });
    toast("Added to queue");
    info = null; $("#preview").hidden = true; urlEl.value = ""; urlEl.focus();
    poll();
  } catch (err) { showError(err.message); }
  finally { $("#dl").disabled = false; }
};

/* ---------------- queue ---------------- */
const rows = new Map(), prev = {};
let noticesChanged = false;
function actions(j) {
  const b = (act, label, ic, cls = "") => `<button class="iconbtn ${cls}" data-act="${act}" title="${label || "Remove"}" aria-label="${label || "Remove"}">${svg(ic)}${label ? `<span>${label}</span>` : ""}</button>`;
  const canPause = j.state === "downloading" && !j.isImage && j.quality !== "convert";
  if (j.state === "paused") return b("resume", "Resume", I.play, "primary sq") + b("cancel", "Cancel", I.x, "danger sq");
  if (ACTIVE.includes(j.state)) return (canPause ? b("pause", "Pause", "M9 5v14M15 5v14", "sq") : "") + b("cancel", "Cancel", I.x, "danger sq");
  const isImg = j.isImage || j.quality === "image" || j.quality === "photo";
  if (j.state === "done") return b("open", isImg ? "Open" : "Play", I.play, "primary") + b("share", "Share", I.share) + (j.url ? b("more", "More", "M12 5v.01M12 12v.01M12 19v.01", "sq") : "") + b("dismiss", "", I.x, "sq");
  if (j.quality === "convert") return b("dismiss", "", I.x, "sq");
  return b("retry", "Retry", I.retry, "primary") + (j.url ? b("copy", "Copy link", "M9 9h11v11H9zM5 15V4h11", "sq") : "") + b("dismiss", "", I.x, "sq");
}
function queueSub(j, isImg) {
  const pct = Math.round(j.percent || 0);
  if (j.state === "paused") return `${j.stage || "Paused"}  ·  ${pct}%`;
  if (j.state === "queued") return j.stage || "Waiting to start…";
  if (j.state === "downloading") return j.stage || `${pct}%  ·  ${j.speed || (isImg ? "saving" : "starting")}${j.eta ? "  ·  ETA " + j.eta : ""}`;
  if (j.state === "processing") return j.stage || "Merging and finishing…";
  if (j.state === "done") return `Saved  ·  ${fmtSize(j.size)}${j.stage ? "  ·  " + j.stage : ""}`;
  if (j.state === "cancelled") return "Cancelled";
  return j.error || "Failed";
}
function renderQueue(list) {
  const ul = $("#queue"), ids = new Set(list.map(j => j.id));
  for (const [id, li] of rows) if (!ids.has(id)) { li.remove(); rows.delete(id); }
  list.forEach((j, i) => {
    let li = rows.get(j.id);
    if (!li) {
      li = document.createElement("li"); li.dataset.id = j.id;
      li.innerHTML = `${icoHtml(j.site, j.url, j.thumb)}<div class="q-main"><p class="q-title"></p><p class="q-sub mono"></p><div class="bar"><i></i></div></div><div class="q-act"></div>`;
      rows.set(j.id, li);
    }
    li.className = "q " + j.state;
    li.querySelector(".ico").style.cssText = icoStyle(j.site, j.url, j.thumb);
    li.querySelector(".ico").setAttribute("aria-label", j.site || "Media");
    const isConvert = j.quality === "convert";
    li.querySelector(".q-title").textContent = (isConvert ? "Converting · " : "") + (j.title || "Downloading…");
    const isImg = j.isImage || j.quality === "image" || j.quality === "photo";
    li.querySelector(".q-sub").textContent = queueSub(j, isImg);
    li.querySelector(".bar i").style.width = (j.state === "queued" ? 0 : j.percent) + "%";
    const act = li.querySelector(".q-act");
    if (act.dataset.state !== j.state) { act.innerHTML = actions(j); act.dataset.state = j.state; }
    if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
    if (prev[j.id] && prev[j.id] !== "done" && j.state === "done") toast((isConvert ? "Converted: " : "Saved: ") + (j.title || j.file));
    if (prev[j.id] && prev[j.id] !== "error" && j.state === "error") toast(j.error || "A download failed");
    if (prev[j.id] && prev[j.id] !== j.state && !ACTIVE.includes(j.state)) noticesChanged = true;
    prev[j.id] = j.state;
  });
  const active = list.filter(j => ACTIVE.includes(j.state)).length;
  $("#qBadge").hidden = !active; $("#qBadge").textContent = active;
  lastJobs = list; updateStatus(active);
  if (curView === "notices") paintLiveNotices();
  if (noticesChanged) { noticesChanged = false; loadNotices().then(() => { if (curView === "notices") openNotices(); }); }
  $("#qEmpty").hidden = list.length > 0;
  $("#clearDone").hidden = !list.some(j => !ACTIVE.includes(j.state));
}
let polling = false;
async function poll() {
  if (polling || document.hidden) return; polling = true;
  try { renderQueue(await api("/api/jobs")); } catch {} finally { polling = false; }
}
let pollSkip = 0;
setInterval(() => { if (lastActive || curView === "download" || curView === "notices" || ++pollSkip % 4 === 0) poll(); }, 800); poll();

$("#queue").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  triggerHaptic();
  const id = b.closest("li").dataset.id;
  try {
    const li = b.closest("li");
    const title = li.querySelector(".q-title")?.textContent || "Media";
    const act = b.dataset.act;
    const job = lastJobs.find(x => x.id === id);
    if (act === "pause") await api("/api/pause/" + id, {});
    if (act === "resume") await api("/api/resume/" + id, {});
    if (act === "copy" && job) { await api("/api/copy", { text: job.url }); toast("Link copied"); }
    if (act === "more" && job) {
      openMenu(`<div class="sheet-handle"></div><div class="m-title">${esc(job.title || "Download")}</div>${mi("again", ICO.redo, "Download again")}${mi("copy", '<path d="M9 9h11v11H9zM5 15V4h11"/>', "Copy link")}`, "sheet-menu", k => {
        if (k === "copy") api("/api/copy", { text: job.url }).then(() => toast("Link copied"));
        if (k === "again") { urlEl.value = job.url; fetchInfo(); mainEl.scrollTop = 0; }
      });
      return;
    }
    if (act === "cancel") await api("/api/cancel/" + id, {});
    if (act === "dismiss") await api("/api/dismiss/" + id, {});
    if (act === "retry") { await api("/api/retry/" + id, {}); toast("Trying again"); }
    if (act === "open") openInAppPlayer(id, title, "video");
    if (act === "share") { await shareChecked(id); return; }
  } catch (err) { toast(err.message || "That file isn't there any more"); }
  poll();
});
$("#clearDone").onclick = async () => {
  triggerHaptic();
  for (const [id, li] of rows) if (!li.classList.contains("downloading") && !li.classList.contains("processing") && !li.classList.contains("paused")) await api("/api/dismiss/" + id, {});
  poll();
};

/* ---------------- library (Photos) ---------------- */
let historyAll = [], deviceAll = [], trashAll = [], libAll = [], libView = [];
let libFilter = { type: "all" }, filterFrom = "library", mediaPerm = "none", deviceSig = "";
const favs = new Set((() => { try { return JSON.parse(localStorage.getItem("orbit_favs") || "[]"); } catch { return []; } })());
const saveFavs = () => { try { localStorage.setItem("orbit_favs", JSON.stringify([...favs])); } catch {} };
const isPhotoE = e => e.quality === "image" || e.quality === "photo";
const isAudioE = e => e.quality === "audio";
const kindOf = e => isPhotoE(e) ? "photo" : isAudioE(e) ? "audio" : "video";
const siteOf = e => e.device ? "Earlier downloads" : (String(e.site || "").trim() || "Other");
const onAndroid = !!window.OrbitAndroid;
const streamUrl = id => onAndroid ? "https://orbit.local/stream/" + id : "/api/stream/" + id;
const thumbUrl = (id, s) => onAndroid ? `https://orbit.local/thumb/${id}?s=${s || 384}` : streamUrl(id);
const longDur = s => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const fmtDay = t => { const d = new Date(t * 1000); return d.toLocaleDateString("en-US", d.getFullYear() === new Date().getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }); };
const fmtClock = t => new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const yearOf = e => new Date((e.t || 0) * 1000).getFullYear();
const NOTE_ICO = '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const QBANDS = { 2160: ["4K", e => e.height >= 2160], 1080: ["1080p", e => e.height >= 1080 && e.height < 2160], 720: ["720p", e => e.height >= 720 && e.height < 1080], sd: ["SD", e => e.height > 0 && e.height < 720] };

const monthKey = e => { const d = new Date((e.t || 0) * 1000); return d.getFullYear() + "-" + d.getMonth(); };
const monthName = k => { const [y, m] = k.split("-").map(Number); return new Date(y, m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };
function filterTitle(f) {
  return ({ fav: "Favorites", video: "Videos", photo: "Photos", audio: "Audio", share: "Share-ready", vault: "Vault", recent: "Recent", trash: "Trash", "site-device": "Earlier downloads", downloads: "Downloads", onthisday: "On this day" })[f.type]
    || (f.type === "album" ? (albums.find(a => a.id === f.val) || {}).name || "Album" : f.type === "month" ? monthName(f.val) : f.type === "site" || f.type === "bucket" ? f.val : f.type === "by" ? `${f.val} ${f.year}` : f.type === "q" ? QBANDS[f.val][0] : "Photos");
}
function applyFilter(list) {
  const f = libFilter;
  if (f.type === "trash") return trashAll;
  if (f.type === "vault") return list.filter(e => e.vault);
  list = list.filter(e => !e.vault);
  const now = new Date();
  switch (f.type) {
    case "fav": return list.filter(e => favs.has(e.id));
    case "video": case "photo": case "audio": return list.filter(e => kindOf(e) === f.type);
    case "share": return list.filter(e => e.share_ready === true);
    case "site": return list.filter(e => !e.device && siteOf(e) === f.val);
    case "bucket": return list.filter(e => e.bucket === f.val);
    case "month": return list.filter(e => monthKey(e) === f.val);
    case "album": { const al = albums.find(a => a.id === f.val), ids = new Set(al ? al.items : []); return list.filter(e => ids.has(e.id)); }
    case "by": return list.filter(e => e.bucket === f.val && yearOf(e) === f.year);
    case "downloads": return list.filter(e => !e.device);
    case "site-device": return list.filter(e => e.device);
    case "q": return list.filter(QBANDS[f.val][1]);
    case "recent": return list.slice(0, 60);
    case "onthisday": return list.filter(e => { const d = new Date(e.t * 1000); return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear(); });
  }
  return list;
}

/* ----- data ----- */
function mergeLib() { libAll = historyAll.filter(e => kindOf(e) !== "audio").concat(deviceAll).sort((a, b) => (b.t || 0) - (a.t || 0)); itemCount = libAll.reduce((n, e) => n + (e.vault ? 0 : 1), 0); updateStatus(lastActive); }
async function refreshHistory() {
  try { historyAll = (await api("/api/history")).map(e => ({ ...e, dur: (e.dur || 0) / 1000 })); } catch {}
  mergeLib();
  return libAll;
}
async function loadDevice() {
  try { mediaPerm = (await api("/api/media/permission")).state || "none"; } catch { mediaPerm = "none"; }
  if (mediaPerm !== "none") {
    try {
      const rows = await api("/api/media/list");
      deviceAll = rows.map(rowToItem);
    } catch {}
  } else deviceAll = [];
  mergeLib();
  const sig = mediaPerm + ":" + deviceAll.length + ":" + (deviceAll[0] ? deviceAll[0].id : "");
  const changed = sig !== deviceSig; deviceSig = sig;
  return changed;
}
const rowToItem = r => ({ id: r[0], title: r[1], t: r[2], size: r[3], height: Math.min(r[4], r[5]), dur: (r[6] || 0) / 1000, bucket: r[7], expires: r[8], device: true, exists: true, quality: r[0][2] === "i" ? "image" : "best", trashed: r[8] !== undefined });
async function loadTrash() { try { trashAll = (await api("/api/media/trashed")).map(rowToItem); } catch { trashAll = []; } }
async function loadLib() { await refreshHistory(); if (libFilter.type === "trash") await loadTrash(); renderLib(); }
window.onOrbitResume = async () => {
  loadNotices();
  if (await loadDevice()) {
    if (viewer.hidden && !selMode) { if (curView === "library") renderLib(true); if (curView === "collections") loadCollections(); }
  }
};
$("#permBtn").onclick = () => { triggerHaptic(); api("/api/media/request", {}).catch(() => {}); };

/* ----- thumbnails ----- */
const thumbBox = (e, s) => `<div class="thumb ${kindOf(e)}">${kindOf(e) === "audio" ? NOTE_ICO : `<img class="t-img" alt="" decoding="async" loading="lazy" src="${thumbUrl(e.id, s)}" data-remote="${esc(e.thumb || "")}">`}</div>`;
document.addEventListener("load", e => { if (e.target.classList && e.target.classList.contains("t-img")) e.target.classList.add("in"); }, true);
document.addEventListener("error", e => {
  const t = e.target; if (!t.classList || !t.classList.contains("t-img")) return;
  const r = t.dataset.remote; if (r && t.src !== r) t.src = r; else t.style.visibility = "hidden";
}, true);

/* ----- grid: a fixed pool of recycled cells, positioned without layout, so scrolling never rebuilds anything ----- */
const mainEl = $(".main"), gridEl = $("#lib");
let gridLayout = [], gridRows = 1, cellSize = 100, rowFirst = [], gridTop = 0, maxScroll = 0, viewH = 0;
const gridCells = new Map(), cellPool = [];
const GAP = 2, OVERSCAN = 900, CELLS_PER_FRAME = 24, FAST_PX_PER_MS = 3.2;
let gridCols = 4, rangeA = 0, rangeB = -1, pendingRaf = 0, lastScrollY = 0, lastScrollT = 0, scrollSpeed = 0, settleT = 0;
/* Same three views as Google Photos' "Photos view". Pinching moves between them. */
const LAYOUTS = { comfortable: { w: 160, min: 3, label: "Comfortable" }, day: { w: 120, min: 4, label: "Day" }, month: { w: 96, min: 5, label: "Month" } };
const LAYOUT_ORDER = ["comfortable", "day", "month"];
let layoutName = "day", featureOn = true;
try { if (LAYOUTS[localStorage.getItem("orbit_layout")]) layoutName = localStorage.getItem("orbit_layout"); featureOn = localStorage.getItem("orbit_feature") !== "false"; } catch {}
let datesOn = false, rowTops = null, gridHeads = [];
try { datesOn = localStorage.getItem("orbit_dates") === "true"; } catch {}
const rowY = r => rowTops ? (rowTops[r] !== undefined ? rowTops[r] : rowTops[rowTops.length - 1]) : r * (cellSize + GAP);
function rowAtY(y) {
  if (!rowTops) return Math.floor(y / (cellSize + GAP));
  let lo = 0, hi = rowTops.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rowTops[m] <= y) lo = m; else hi = m - 1; }
  return y < 0 ? Math.floor(y / (cellSize + GAP)) : lo;
}
const colsFor = w => Math.max(LAYOUTS[layoutName].min, Math.round(w / LAYOUTS[layoutName].w));
const idHash = s => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
function tileUrl(e, g) {
  const px = cellSize * g.s * (devicePixelRatio || 1);
  return thumbUrl(e.id, px <= 360 ? 360 : px <= 480 ? 480 : px <= 640 ? 640 : 768) + "&c=1";
}
/* Mixed sizes: mostly single tiles, with featured 2x2 and 3x3 tiles. Videos are preferred, as in Google Photos.
   Choices come from each item's id, so the layout stays the same between visits. */
function computeGrid(n) {
  gridCols = colsFor(gridEl.clientWidth || mainEl.clientWidth);
  const cols = gridCols, out = new Array(n), used = new Set(), key = (c, r) => r * cols + c;
  const free = (c, r, s) => { for (let y = r; y < r + s; y++) for (let x = c; x < c + s; x++) if (x >= cols || used.has(key(x, y))) return false; return true; };
  const gapVideo = Math.round(cols * 2.5), gapAny = cols * 6;
  let r = 0, c = 0, since = cols, lastDay = null; rowFirst = []; gridRows = 0; gridHeads = [];
  const monthly = layoutName === "month";
  for (let i = 0; i < n; i++) {
    if (datesOn) {
      const d = new Date((libView[i].t || 0) * 1000), day = monthly ? d.getFullYear() + "-" + d.getMonth() : d.toDateString();
      if (day !== lastDay) {
        if (lastDay !== null) { r = gridRows; c = 0; }
        lastDay = day;
        gridHeads.push({ r, label: monthly ? d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) : dayLabel(libView[i].t) });
      }
    }
    while (used.has(key(c, r))) { c++; if (c >= cols) { c = 0; r++; } }
    const e = libView[i], h = idHash(String(e.id));
    let s = 1, at = c;
    if (featureOn && (since >= gapAny || (since >= gapVideo && kindOf(e) === "video"))) {
      const want = cols >= 4 && h % 3 === 0 ? 3 : 2;
      const side = c === 0 && h % 2 ? cols - want : c;       // start of a row: sometimes sit on the right, singles fill the left
      if (free(side, r, want)) { s = want; at = side; }
      else if (free(c, r, 2)) { s = 2; at = c; }
    }
    for (let y = r; y < r + s; y++) for (let x = at; x < at + s; x++) used.add(key(x, y));
    since = s > 1 ? 0 : since + 1;
    out[i] = { c: at, r, s };
    gridRows = Math.max(gridRows, r + s);
    if (rowFirst[r] === undefined) rowFirst[r] = i;
    if (at === c) { c += s; if (c >= cols) { c = 0; r++; } }
  }
  return out;
}
function measureGrid() {
  const m = mainEl.getBoundingClientRect();
  gridTop = gridEl.getBoundingClientRect().top - m.top + mainEl.scrollTop;
  viewH = mainEl.clientHeight;
  maxScroll = Math.max(0, mainEl.scrollHeight - viewH);
}
function layoutGrid() {
  const W = gridEl.clientWidth || mainEl.clientWidth;
  cellSize = (W - GAP * (gridCols - 1)) / gridCols;
  gridEl.querySelectorAll(".g-head").forEach(n => n.remove());
  rowTops = null;
  if (gridHeads.length) {
    const HEAD = 44, heads = new Set(gridHeads.map(g => g.r));
    rowTops = []; let y = 0;
    for (let r = 0; r <= gridRows; r++) { if (heads.has(r)) y += HEAD; rowTops[r] = y; y += cellSize + GAP; }
    const frag = document.createDocumentFragment();
    gridHeads.forEach(g => { const li = document.createElement("li"); li.className = "g-head"; li.textContent = g.label; li.style.transform = `translate(0,${rowTops[g.r] - HEAD}px)`; frag.appendChild(li); });
    gridEl.appendChild(frag);
  }
  gridEl.style.height = rowY(gridRows) + "px";
  gridEl.dataset.layout = layoutName;
  measureGrid();
  ensurePool(Math.ceil((viewH + OVERSCAN * 2) / (cellSize + GAP) + 2) * gridCols);
}
/* Three elements per cell; icons, checkmarks and badges are CSS, so style work stays small while scrolling. */
function makeCell() {
  const li = document.createElement("li");
  const img = document.createElement("img"); img.className = "t-img in"; img.alt = ""; img.decoding = "async";
  const dur = document.createElement("span"); dur.className = "cell-dur";
  li.append(img, dur);
  li._img = img; li._dur = dur;
  gridEl.appendChild(li);
  return li;
}
function ensurePool(count) {
  const frag = count - cellPool.length - gridCells.size;
  for (let i = 0; i < frag; i++) { const li = makeCell(); li.style.display = "none"; cellPool.push(li); }
}
function loadCellImage(li) {
  const u = li._want;
  if (!u || li._src === u) return;
  li._src = u; li._img.style.visibility = ""; li._img.src = u;
}
function bindCell(li, i) {
  const e = libView[i], g = gridLayout[i], k = kindOf(e), size = cellSize * g.s + GAP * (g.s - 1);
  const cls = "cell " + k + (e.exists ? "" : " gone") + (sel.has(e.id) ? " sel" : "") + (favs.has(e.id) ? " fav" : "");
  if (li.className !== cls) li.className = cls;
  li.dataset.id = e.id; li.dataset.i = i;
  if (li._size !== size) { li._size = size; li.style.width = size + "px"; li.style.height = size + "px"; }
  li.style.transform = `translate(${g.c * (cellSize + GAP)}px,${rowY(g.r)}px)`;
  li.style.display = "";
  li._img.dataset.remote = e.thumb || "";
  const label = k === "photo" ? "" : (e.dur ? longDur(e.dur) : k === "audio" ? "MP3" : " ");
  if (li._label !== label) { li._label = label; li._dur.textContent = label; }
  if (k === "audio") { li._want = ""; if (li._src) { li._src = ""; li._img.removeAttribute("src"); } return; }
  const want = tileUrl(e, g);
  li._want = want;
  if (li._src !== want) { li._src = ""; li._img.removeAttribute("src"); }
  if (scrollSpeed < FAST_PX_PER_MS) loadCellImage(li);
}
function renderWindow(force) {
  if (curView !== "library" || gridEl.hidden || !libView.length) return;
  const rowH = cellSize + GAP, top = mainEl.scrollTop - gridTop;
  const visFirst = rowAtY(top), visLast = rowAtY(top + viewH) + 1;
  if (!force && visFirst >= rangeA + 2 && visLast <= rangeB - 2) return;      // still well inside what's already built
  const margin = Math.ceil(OVERSCAN / rowH);
  rangeA = Math.max(0, visFirst - margin); rangeB = visLast + margin;
  let a = rowFirst[rangeA]; if (a === undefined) a = libView.length;
  let b = libView.length;
  for (let r = rangeB + 1; r < rowFirst.length; r++) if (rowFirst[r] !== undefined) { b = rowFirst[r]; break; }
  for (const [i, li] of gridCells) if (i < a || i >= b) {
    if (li === apCell) apStop();
    gridCells.delete(i); li.style.display = "none"; cellPool.push(li);
  }
  fillCells(a, b);
}
function fillCells(a, b) {
  cancelAnimationFrame(pendingRaf);
  const rowH = cellSize + GAP, start = Math.max(a, rowFirst[Math.max(0, rowAtY(mainEl.scrollTop - gridTop))] || a);
  let budget = CELLS_PER_FRAME, more = false;
  const put = i => { if (gridCells.has(i)) return; if (budget-- <= 0) { more = true; return; } const li = cellPool.pop() || makeCell(); bindCell(li, i); gridCells.set(i, li); };
  for (let i = start; i < b && !more; i++) put(i);      // what's on screen and below first
  for (let i = start - 1; i >= a && !more; i--) put(i);
  if (more) pendingRaf = requestAnimationFrame(() => fillCells(a, b));
}
function flushImages() { gridCells.forEach(loadCellImage); }
/* During a fast fling, what's on screen still fills in, a few per frame; only off-screen tiles wait. */
function loadVisibleImages(limit) {
  const s = cellSize + GAP, y = mainEl.scrollTop - gridTop;
  for (const [i, li] of gridCells) {
    if (limit <= 0) return;
    if (li._src === li._want) continue;
    const t = rowY(gridLayout[i].r) - y;
    if (t > -s * 2 && t < viewH) { loadCellImage(li); limit--; }
  }
}
function resetGrid() {
  cancelAnimationFrame(pendingRaf);
  apStop();
  gridCells.forEach(li => { li.style.display = "none"; cellPool.push(li); });
  gridCells.clear(); rangeA = 0; rangeB = -1;
}
let scrollTick = false;
mainEl.addEventListener("scroll", () => {
  if (scrollTick) return; scrollTick = true;
  requestAnimationFrame(now => {
    scrollTick = false;
    const y = mainEl.scrollTop, dt = now - lastScrollT;
    if (dt > 0 && dt < 100) scrollSpeed = Math.abs(y - lastScrollY) / dt; else scrollSpeed = 0;
    lastScrollY = y; lastScrollT = now;
    prefetchGen++;      // scrolling takes priority over fetching ahead
    renderWindow();
    fsOnScroll();
    paintDatePill();
    if (scrollSpeed < FAST_PX_PER_MS) flushImages(); else loadVisibleImages(2);
    clearTimeout(settleT);
    settleT = setTimeout(() => { scrollSpeed = 0; flushImages(); measureGrid(); apPick(); setTimeout(prefetchAhead, 200); }, 140);
  });
}, { passive: true });
addEventListener("resize", () => {
  moveDockInd();
  if (!viewer.hidden) { syncPlayerRect(); requestAnimationFrame(syncPlayerRect); paintSeek(true); }
  if (curView !== "library" || !libView.length) return;
  const top0 = mainEl.scrollTop - gridTop, row0 = top0 > 0 ? rowAtY(top0) : -1;
  let anchor = -1;
  if (row0 >= 0) for (let r = row0; r < rowFirst.length; r++) if (rowFirst[r] !== undefined) { anchor = rowFirst[r]; break; }
  resetGrid();
  gridLayout = computeGrid(libView.length);
  layoutGrid();
  if (anchor >= 0 && gridLayout[anchor]) mainEl.scrollTop = gridTop + rowY(gridLayout[anchor].r);
  renderWindow(true);
});

/* ----- keep recently seen thumbnails decoded, so scrolling back never goes through the bridge again ----- */
const thumbKeep = new Map();
document.addEventListener("load", e => {
  const t = e.target;
  if (!t.parentNode || t.parentNode.tagName !== "LI" || !t.classList.contains("t-img")) return;
  const u = t.currentSrc || t.src;
  if (thumbKeep.has(u)) { const k = thumbKeep.get(u); thumbKeep.delete(u); thumbKeep.set(u, k); return; }
  const keep = new Image(); keep.src = u; thumbKeep.set(u, keep);
  if (thumbKeep.size > 620) thumbKeep.delete(thumbKeep.keys().next().value);
}, true);

/* While the list is still, quietly fetch what's next, so a fling lands on pictures that are already in memory. */
let prefetchGen = 0;
function prefetchAhead() {
  const gen = ++prefetchGen;
  if (curView !== "library" || !libView.length || !viewer.hidden) return;
  const s = cellSize + GAP;
  let r = Math.max(0, rowAtY(mainEl.scrollTop - gridTop));
  while (r > 0 && rowFirst[r] === undefined) r--;
  const start = rowFirst[r] || 0, order = [];
  for (let d = 0; d < 260 && order.length < 300; d++) {
    if (start + d < libView.length) order.push(start + d);
    if (d % 3 === 0 && start - d >= 0 && d) order.push(start - d);
  }
  let at = 0, running = 0;
  const next = () => {
    while (gen === prefetchGen && running < 3 && at < order.length) {
      const i = order[at++], e = libView[i], g = gridLayout[i];
      if (!e || !g || kindOf(e) === "audio") continue;
      const u = tileUrl(e, g);
      if (thumbKeep.has(u)) continue;
      const im = new Image(); running++;
      im.decoding = "async";
      im.onload = im.onerror = () => {
        running--;
        if (im.naturalWidth) { thumbKeep.set(u, im); if (thumbKeep.size > 620) thumbKeep.delete(thumbKeep.keys().next().value); }
        if (gen === prefetchGen) setTimeout(next, 16);
      };
      im.src = u;
    }
  };
  next();
}

/* ----- floating date pill while scrolling, as in Google Photos ----- */
const datePill = $("#datePill");
let pillHide = 0, pillDay = "";
function dayLabel(t) {
  if (!t) return "";
  const d = new Date(t * 1000), now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", d.getFullYear() === now.getFullYear() ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
function paintDatePill() {
  const top = mainEl.scrollTop - gridTop;
  if (curView !== "library" || top < 10 || libView.length < 12) { datePill.classList.remove("on"); return; }
  let row = rowAtY(top);
  while (row > 0 && rowFirst[row] === undefined) row--;
  const it = libView[rowFirst[row] || 0];
  const label = layoutName === "month" && it && it.t ? new Date(it.t * 1000).toLocaleDateString("en-US", { month: "long", year: new Date(it.t * 1000).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : dayLabel(it && it.t);
  if (label !== pillDay) { pillDay = label; datePill.textContent = label; }
  datePill.classList.add("on");
  clearTimeout(pillHide);
  pillHide = setTimeout(() => datePill.classList.remove("on"), 1500);
}

/* ----- large video tiles play silently in place, one at a time ----- */
const apVideo = document.createElement("video");
apVideo.className = "t-auto"; apVideo.muted = true; apVideo.defaultMuted = true; apVideo.loop = true; apVideo.playsInline = true; apVideo.preload = "auto";
apVideo.setAttribute("muted", ""); apVideo.setAttribute("playsinline", "");
let apCell = null, apId = "", apEnabled = true; const apFailed = new Set();
try { apEnabled = localStorage.getItem("orbit_autoplay") !== "false"; } catch {}
apVideo.addEventListener("playing", () => apVideo.classList.add("on"));
apVideo.addEventListener("error", () => { if (apId && apVideo.getAttribute("src")) { apFailed.add(apId); apStop(); apPick(); } });
function apStop() {
  if (!apCell) return;
  apVideo.classList.remove("on");
  apVideo.pause(); apVideo.removeAttribute("src"); apVideo.load();
  apVideo.remove();
  apCell = null; apId = "";
}
function apPick() {
  if (!apEnabled || curView !== "library" || viewer.hidden === false || selMode || document.hidden || gridEl.hidden) { apStop(); return; }
  const rowH = cellSize + GAP, y = mainEl.scrollTop - gridTop;
  let best = null, bestShare = 0.55;
  for (const [i, li] of gridCells) {
    const g = gridLayout[i], e = libView[i];
    if (g.s < 2 || kindOf(e) !== "video" || apFailed.has(e.id) || !e.exists) continue;
    const top = rowY(g.r) - y, h = cellSize * g.s + GAP * (g.s - 1);
    const share = (Math.min(viewH - 80, top + h) - Math.max(0, top)) / h;
    if (share > bestShare) { bestShare = share; best = li; }
  }
  if (best === apCell) return;
  apStop();
  if (!best) return;
  apCell = best; apId = best.dataset.id;
  best.appendChild(apVideo);
  apVideo.src = streamUrl(apId);
  apVideo.play().catch(() => {});
}
document.addEventListener("visibilitychange", () => { if (document.hidden) apStop(); else apPick(); });

/* ----- pinch the grid to move between Comfortable, Day and Month ----- */
let pz = null, pzRaf = 0;
const touchDist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
function changeLayout(name, keep) {
  layoutName = name;
  try { localStorage.setItem("orbit_layout", name); } catch {}
  $("#photosViewInfo").textContent = LAYOUTS[name].label;
  $$("#layoutPick button").forEach(b => b.classList.toggle("on", b.dataset.layout === name));
  if (curView !== "library" || !libView.length) { renderedSig = ""; return; }
  resetGrid();
  gridLayout = computeGrid(libView.length);
  layoutGrid();
  if (keep && gridLayout[keep.i]) mainEl.scrollTop = Math.max(0, gridTop + rowY(gridLayout[keep.i].r) + keep.frac * cellSize - keep.y);
  renderedSig = "";
  measureGrid();
  renderWindow(true);
  flushImages();
  fsOnScroll();
}
mainEl.addEventListener("touchstart", e => {
  if (e.touches.length !== 2 || pz || curView !== "library" || selMode || gridEl.hidden || libView.length < 2) return;
  const t = e.touches, m = mainEl.getBoundingClientRect();
  const cx = (t[0].clientX + t[1].clientX) / 2 - m.left, cy = (t[0].clientY + t[1].clientY) / 2 - m.top;
  const gy = mainEl.scrollTop - gridTop + cy, rowH = cellSize + GAP;
  let row = Math.max(0, rowAtY(gy));
  while (row > 0 && rowFirst[row] === undefined) row--;
  pz = { d0: touchDist(t), s: 1, cx, cy, gy, i: rowFirst[row] || 0, rowY: rowY(row) };
  clearTimeout(pressT); apStop();
  mainEl.style.overflowY = "hidden";
  gridEl.getAnimations().forEach(a => a.cancel());
  gridEl.style.willChange = "transform";
  gridEl.style.transformOrigin = `${cx}px ${gy}px`;
}, { passive: true });
mainEl.addEventListener("touchmove", e => {
  if (!pz || e.touches.length !== 2) return;
  const lvl = LAYOUT_ORDER.indexOf(layoutName);
  pz.s = Math.max(lvl === LAYOUT_ORDER.length - 1 ? 0.92 : 0.6, Math.min(lvl === 0 ? 1.08 : 1.7, touchDist(e.touches) / pz.d0));
  if (!pzRaf) pzRaf = requestAnimationFrame(() => { pzRaf = 0; if (pz) gridEl.style.transform = `scale(${pz.s})`; });
}, { passive: true });
function endPinch() {
  if (!pz) return;
  const p = pz; pz = null;
  cancelAnimationFrame(pzRaf); pzRaf = 0;
  mainEl.style.overflowY = "";
  const lvl = LAYOUT_ORDER.indexOf(layoutName);
  const next = p.s > 1.14 ? lvl - 1 : p.s < 0.88 ? lvl + 1 : lvl;
  const clean = () => { gridEl.style.transform = ""; gridEl.style.transformOrigin = ""; gridEl.style.willChange = ""; apPick(); setTimeout(prefetchAhead, 300); };
  if (next === lvl || next < 0 || next >= LAYOUT_ORDER.length) {
    const back = gridEl.animate([{ transform: `scale(${p.s})` }, { transform: "none" }], { duration: 170, easing: "cubic-bezier(.2,.9,.25,1)" });
    gridEl.style.transform = "";
    back.onfinish = clean; back.oncancel = clean;
    return;
  }
  triggerHaptic();
  const oldCell = cellSize;
  gridEl.style.transform = "";
  changeLayout(LAYOUT_ORDER[next], { i: p.i, y: p.cy, frac: (p.gy - p.rowY) / oldCell });
  const ny = gridLayout[p.i] ? rowY(gridLayout[p.i].r) + (p.gy - p.rowY) * cellSize / oldCell : 0;
  gridEl.style.transformOrigin = `${p.cx}px ${ny}px`;
  const anim = gridEl.animate([{ transform: `scale(${p.s * oldCell / cellSize})`, opacity: 0.55 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.2,.9,.25,1)" });
  anim.onfinish = clean; anim.oncancel = clean;
}
mainEl.addEventListener("touchend", e => { if (pz && e.touches.length < 2) endPinch(); }, { passive: true });
mainEl.addEventListener("touchcancel", () => endPinch(), { passive: true });

/* ----- fast scroll handle, as in Google Photos ----- */
const fsEl = $("#fastScroll"), fsDate = $("#fsDate");
let fsHide = null, fsDrag = false, fsOn = false;
function fsPlace() {
  const track = viewH - 170;
  fsEl.style.transform = `translate3d(0,${(maxScroll > 0 ? mainEl.scrollTop / maxScroll : 0) * track}px,0)`;
}
function fsOnScroll() {
  if (curView !== "library" || libView.length < 40) { if (fsOn) { fsOn = false; fsEl.classList.remove("on"); } return; }
  fsPlace();
  if (!fsOn) { fsOn = true; fsEl.classList.add("on"); }
  clearTimeout(fsHide);
  if (!fsDrag) fsHide = setTimeout(() => { fsOn = false; fsEl.classList.remove("on"); }, 1400);
}
fsEl.addEventListener("pointerdown", e => { fsDrag = true; fsEl.setPointerCapture(e.pointerId); fsEl.classList.add("drag"); clearTimeout(fsHide); triggerHaptic(); e.preventDefault(); });
fsEl.addEventListener("pointermove", e => {
  if (!fsDrag) return;
  const r = mainEl.getBoundingClientRect(), track = viewH - 170;
  const p = Math.max(0, Math.min(1, (e.clientY - r.top - 32) / track));
  mainEl.scrollTop = p * maxScroll;
  const rowH = cellSize + GAP, top = mainEl.scrollTop;
  let row = Math.max(0, rowAtY(top - gridTop));
  while (row > 0 && rowFirst[row] === undefined) row--;
  const it = libView[rowFirst[row] || 0];
  if (it && it.t) fsDate.textContent = new Date(it.t * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" });
});
const fsEnd = () => { fsDrag = false; fsEl.classList.remove("drag"); fsHide = setTimeout(() => { fsOn = false; fsEl.classList.remove("on"); }, 1400); };
fsEl.addEventListener("pointerup", fsEnd); fsEl.addEventListener("pointercancel", fsEnd);

/* ----- memories ----- */
function renderMemories(list) {
  const box = $("#memories"), cards = [], now = new Date();
  if (!list.length) { box.hidden = true; box.innerHTML = ""; return; }
  const otd = list.filter(e => { const d = new Date(e.t * 1000); return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear(); });
  if (otd.length) cards.push({ a: "On this day", b: `${now.getFullYear() - yearOf(otd[0])} year${now.getFullYear() - yearOf(otd[0]) > 1 ? "s" : ""} ago`, f: { type: "onthisday" }, cover: otd[0] });
  const fv = list.filter(e => favs.has(e.id));
  if (fv.length) cards.push({ a: "Your", b: "favorites", f: { type: "fav" }, cover: fv[0] });
  groupBy(list.filter(e => !e.device), siteOf).sort((a, b) => b[1].length - a[1].length).slice(0, 4).forEach(([site, items]) => cards.push({ a: site, b: `${items.length} saved`, f: { type: "site", val: site }, cover: items[0] }));
  groupBy(list, monthKey).slice(0, 6).forEach(([k, items]) => { const [y, m] = k.split("-").map(Number); cards.push({ a: new Date(y, m, 1).toLocaleDateString("en-US", { month: "long" }), b: String(y), f: { type: "month", val: k }, cover: items[0] }); });
  box.hidden = false;
  box.innerHTML = cards.map((c, i) => `<button type="button" class="mem" data-i="${i}" style="--i:${Math.min(i, 5)}">${thumbBox(c.cover, 512)}
      <span class="mem-label"><b>${esc(c.a)}</b>${c.b ? `<b>${esc(c.b)}</b>` : ""}</span></button>`).join("");
  box._cards = cards;
}
$("#memories").addEventListener("click", e => {
  const b = e.target.closest(".mem"); if (!b) return;
  triggerHaptic(); openFilter($("#memories")._cards[+b.dataset.i].f);
});

let renderedSig = "";
function renderLib(force) {
  const f = libFilter, isVault = f.type === "vault";
  $("#filterBar").hidden = f.type === "all";
  $("#filterTitle").textContent = filterTitle(f);
  $("#albumMenu").hidden = f.type !== "album";
  $("#permCard").hidden = !(f.type === "all" && mediaPerm !== "full" && onAndroid);
  if (mediaPerm === "partial") { $("#permTitle").textContent = "Orbit sees only the items you picked"; $("#permSub").textContent = "Allow all to see every video and photo you downloaded earlier."; $("#permBtn").textContent = "Manage"; }
  else { $("#permTitle").textContent = "Show your earlier downloads"; $("#permSub").textContent = "Orbit needs permission to find videos and photos it saved before. It only looks in its own folders."; $("#permBtn").textContent = "Allow"; }
  const lock = $("#vaultLockScreen");
  if (isVault && !vaultUnlocked) {
    resetGrid(); renderedSig = "";
    lock.hidden = false; gridEl.hidden = true; $("#libCount").textContent = "Locked"; $("#libEmpty").hidden = true; $("#memories").hidden = true;
    paintVaultLock();
    if (vaultHasPin && vaultCanAuth && !vaultAskedAuth && !vaultResetting) { vaultAskedAuth = true; api("/api/vault/auth", { purpose: "unlock" }).catch(() => {}); }
    return;
  }
  lock.hidden = true; gridEl.hidden = false;
  const list = applyFilter(libAll);
  const sig = [f.type, f.val, f.year, list.length, list[0] && list[0].id, list[list.length - 1] && list[list.length - 1].id, favs.size, featureOn, datesOn, colsFor(gridEl.clientWidth || mainEl.clientWidth)].join("|");
  if (!force && sig === renderedSig) { measureGrid(); renderWindow(true); flushImages(); if (selMode) updateSelUi(); setTimeout(apPick, 300); return; }
  renderedSig = sig;
  resetGrid();
  libView = list;
  $("#libCount").textContent = `${list.length} item${list.length === 1 ? "" : "s"}`;
  $("#libClear").hidden = true;
  if (f.type === "all") renderMemories(list); else $("#memories").hidden = true;
  gridLayout = computeGrid(list.length);
  layoutGrid();
  renderWindow(true);
  setTimeout(apPick, 500);
  setTimeout(prefetchAhead, 900);
  const empty = !list.length;
  $("#libEmpty").hidden = !empty;
  if (empty) {
    const t = { all: ["Your downloads will show up here", "Videos and photos you download with Orbit appear here."], fav: ["No favorites yet", "Tap the star on any photo or video to find it here."], vault: ["Your vault is empty", "Use Add to, then Private vault, to hide items from the phone gallery."], trash: ["Trash is empty", "Items you remove stay here for 30 days, then Android deletes them."] }[f.type] || ["Nothing here yet", "Items that match will show up here."];
    $("#libEmptyTitle").textContent = t[0]; $("#libEmptySub").textContent = t[1];
    $("#libEmptyBtn").hidden = f.type !== "all";
  }
  if (selMode) updateSelUi();
}
function openFilter(f) { filterFrom = curView; libFilter = f; show("library", true); }
$("#filterBack").onclick = () => { triggerHaptic(); if (filterFrom === "collections") show("collections"); else { libFilter = { type: "all" }; vaultUnlocked = false; renderLib(); mainEl.scrollTop = 0; } };
$("#libEmptyBtn").onclick = () => show("download");

/* ----- removing and hiding (shared by selection and viewer) ----- */
let mediaResolve = null;
window.onMediaRequest = ok => { if (mediaResolve) { const r = mediaResolve; mediaResolve = null; r(ok); } };
const waitMediaRequest = () => new Promise(r => { mediaResolve = r; });
/* Device items go to the phone's trash (Android asks to confirm); Orbit's own files are deleted after our dialog. */
async function restoreItems(items) {
  try {
    const r = await api("/api/media/restore", { ids: items.map(e => e.id) });
    if (r.done || (r.pending && await waitMediaRequest())) { await loadDevice(); await refreshHistory(); await loadTrash(); toast(`${items.length} restored`); return true; }
  } catch (err) { toast(err.message || "Couldn't restore"); }
  return false;
}
async function purgeItems(items) {
  try {
    const r = await api("/api/media/purge", { ids: items.map(e => e.id) });
    if (r.done || (r.pending && await waitMediaRequest())) { await loadTrash(); toast(`${items.length} deleted forever`); return true; }
  } catch (err) { toast(err.message || "Couldn't delete"); }
  return false;
}
async function removeItems(items) {
  const own = items.filter(e => !e.device), dev = items.filter(e => e.device);
  if (own.length && !await confirmDialog(`Delete ${own.length} download${own.length > 1 ? "s" : ""}?`, "The files will be removed from your device. This can't be undone.", "Delete")) return [];
  const gone = [];
  for (const e of own) { try { const r = await api("/api/history/" + e.id, undefined, "DELETE"); if (r.pending) await waitMediaRequest(); gone.push(e.id); } catch (err) { toast(err.message || "Couldn't delete"); } }
  if (dev.length) {
    try {
      const r = await api("/api/media/trash", { ids: dev.map(e => e.id) });
      if (r.done || (r.pending && await waitMediaRequest())) dev.forEach(e => gone.push(e.id));
    } catch (err) { toast(err.message || "Couldn't move to trash"); }
  }
  if (gone.length) {
    gone.forEach(id => favs.delete(id)); saveFavs();
    await loadDevice(); await refreshHistory();
  }
  return gone;
}
async function vaultItems(items, restore) {
  const own = items.filter(e => !e.device), dev = items.filter(e => e.device);
  let n = 0;
  for (const e of own) { try { await api(`/api/vault/${restore ? "restore" : "hide"}/` + e.id, {}, "POST"); n++; } catch (err) { toast("Vault: " + err.message); } }
  if (dev.length) {
    toast("Copying to the vault…");
    try {
      const r = await api("/api/media/vault", { ids: dev.map(e => e.id) });
      n += r.moved || 0;
      if (r.pending) await waitMediaRequest();
    } catch (err) { toast("Vault: " + err.message); }
  }
  await loadDevice(); await refreshHistory();
  if (n) toast(restore ? "Restored to gallery" : "Moved to private vault");
  return n;
}

/* ----- selection mode (long-press) ----- */
let selMode = false; const sel = new Set();
const selItems = () => (libFilter.type === "trash" ? trashAll : libAll).filter(e => sel.has(e.id));
function updateSelUi() {
  $("#selCount").textContent = sel.size + " selected";
  gridCells.forEach(c => c.classList.toggle("sel", sel.has(c.dataset.id)));
}
function enterSelect(id) { apStop(); selMode = true; document.body.classList.add("selecting"); $("#tbNormal").hidden = true; $("#tbSelect").hidden = false; if (id) sel.add(id); updateSelUi(); }
function exitSelect() { setTimeout(apPick, 200); selMode = false; sel.clear(); document.body.classList.remove("selecting"); $("#tbNormal").hidden = false; $("#tbSelect").hidden = true; gridCells.forEach(c => c.classList.remove("sel")); }
function toggleSel(id) { sel.has(id) ? sel.delete(id) : sel.add(id); if (!sel.size) exitSelect(); else updateSelUi(); }
$("#selClose").onclick = () => { triggerHaptic(); exitSelect(); };
$("#selShare").onclick = async () => {
  triggerHaptic();
  try { await api("/api/share-many", { ids: [...sel] }); } catch (err) { toast(err.message || "Couldn't share"); }
};
$("#selVault").onclick = async () => {
  const restore = libFilter.type === "vault", items = selItems(); triggerHaptic();
  if (libFilter.type === "trash") { await restoreItems(items); exitSelect(); renderLib(); return; }
  await vaultItems(items, restore); exitSelect(); renderLib();
};
$("#selDelete").onclick = async () => {
  const items = selItems(); triggerHaptic();
  if (libFilter.type === "trash") { await purgeItems(items); exitSelect(); renderLib(); return; }
  const gone = await removeItems(items);
  if (gone.length) toast(`${gone.length} removed`);
  exitSelect(); renderLib();
};

let pressT = null, pressX = 0, pressY = 0, longFired = false, dragSel = null;
gridEl.addEventListener("touchmove", e => {
  if (!dragSel || !e.touches[0]) return;
  const t = e.touches[0], el = document.elementFromPoint(t.clientX, t.clientY), cell = el && el.closest && el.closest(".cell");
  const m = mainEl.getBoundingClientRect();
  if (t.clientY < m.top + 80) mainEl.scrollTop -= 14; else if (t.clientY > m.bottom - 120) mainEl.scrollTop += 14;
  if (!cell) return;
  const i = +cell.dataset.i;
  if (i === dragSel.last) return;
  dragSel.last = i;
  sel.clear(); dragSel.base.forEach(id => sel.add(id));
  for (let k = Math.min(dragSel.a, i); k <= Math.max(dragSel.a, i); k++) if (libView[k]) sel.add(libView[k].id);
  triggerHaptic(); updateSelUi();
}, { passive: true });
const endDragSel = () => { if (dragSel) { dragSel = null; mainEl.style.overflowY = ""; } };
gridEl.addEventListener("touchend", endDragSel, { passive: true });
gridEl.addEventListener("touchcancel", endDragSel, { passive: true });
gridEl.addEventListener("pointerdown", e => {
  const c = e.target.closest(".cell"); if (!c) return;
  longFired = false; pressX = e.clientX; pressY = e.clientY;
  clearTimeout(pressT);
  pressT = setTimeout(() => {
    longFired = true; triggerHaptic();
    if (!selMode) enterSelect(c.dataset.id); else toggleSel(c.dataset.id);
    if (!selMode) return;
    dragSel = { a: +c.dataset.i, base: new Set(sel), last: +c.dataset.i };
    mainEl.style.overflowY = "hidden";
  }, 450);
}, { passive: true });
const cancelPress = () => clearTimeout(pressT);
gridEl.addEventListener("pointermove", e => { if (Math.abs(e.clientX - pressX) > 9 || Math.abs(e.clientY - pressY) > 9) cancelPress(); }, { passive: true });
gridEl.addEventListener("pointerup", cancelPress, { passive: true });
gridEl.addEventListener("pointercancel", cancelPress, { passive: true });
gridEl.addEventListener("contextmenu", e => e.preventDefault());
gridEl.addEventListener("click", e => {
  const c = e.target.closest(".cell"); if (!c) return;
  if (longFired) { longFired = false; return; }
  triggerHaptic();
  if (selMode) { toggleSel(c.dataset.id); return; }
  openViewer(libView, +c.dataset.i, c.getBoundingClientRect());
});

async function clearLib() {
  triggerHaptic();
  if (!await confirmDialog("Clear download list?", "The list of past downloads is cleared. The files stay on your device.", "Clear")) return;
  await api("/api/history", undefined, "DELETE"); loadLib(); toast("Library cleared");
}
$("#libClear").onclick = clearLib; $("#setClear").onclick = clearLib;

/* ----- your own albums ----- */
let albums = [];
async function loadAlbums() { try { albums = (await api("/api/albums")).albums || []; } catch { albums = []; } }
const saveAlbums = () => { collSig = ""; return api("/api/albums", { albums }).catch(err => toast(err.message)); };
function promptDialog(title, value, okLabel) {
  return new Promise(res => {
    menuResolve = ok => res(ok ? promptValue.trim() : "");
    openMenu(`<div class="dlg-t">${esc(title)}</div><div class="field dlg-field"><input id="dlgInput" type="text" maxlength="60" value="${esc(value || "")}"></div><div class="dlg-b"><button type="button" data-r="0">Cancel</button><button type="button" data-r="1" class="strong">${esc(okLabel || "OK")}</button></div>`, "dlg");
    setTimeout(() => { const i = $("#dlgInput"); if (i) { i.focus(); i.select(); } }, 60);
  });
}
async function newAlbum(ids) {
  const name = await promptDialog("New album", "", "Create");
  if (!name) return null;
  const al = { id: "a" + Date.now().toString(36), name, items: ids || [], t: Date.now() };
  albums.unshift(al); await saveAlbums();
  toast(`Album "${name}" created`);
  return al;
}
function addToAlbumMenu(ids, onDone) {
  openMenu(`<div class="sheet-handle"></div><div class="m-title">Add to album</div>${mi("new", '<path d="M12 5v14M5 12h14"/>', "New album")}${albums.map((a, i) => mi("a" + i, '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M7 2.5h10"/>', a.name)).join("")}`, "sheet-menu", async k => {
    if (k === "new") { const al = await newAlbum(ids); if (al && onDone) onDone(); return; }
    const al = albums[+k.slice(1)]; if (!al) return;
    const set = new Set(al.items); ids.forEach(x => set.add(x)); al.items = [...set];
    await saveAlbums(); toast(`Added to ${al.name}`); if (onDone) onDone();
  });
}
$("#albumMenu").onclick = () => {
  const al = albums.find(a => a.id === libFilter.val); if (!al) return;
  openMenu(`<div class="sheet-handle"></div><div class="m-title">${esc(al.name)}</div>${mi("rename", '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>', "Rename album")}${mi("delete", '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', "Delete album")}`, "sheet-menu", async k => {
    if (k === "rename") { const n = await promptDialog("Rename album", al.name, "Save"); if (n) { al.name = n; await saveAlbums(); $("#filterTitle").textContent = n; } }
    if (k === "delete") {
      if (!await confirmDialog("Delete this album?", "Only the album is removed. Your videos and photos stay.", "Delete")) return;
      albums = albums.filter(a => a !== al); await saveAlbums(); show("collections");
    }
  });
};
$("#selAlbum").onclick = () => { triggerHaptic(); addToAlbumMenu([...sel], () => { exitSelect(); }); };

/* ----- collections ----- */
function coverCard(label, count, cover, attrs) {
  return `<button type="button" class="dev-card" ${attrs}>
    ${cover ? thumbBox(cover, 512) : '<div class="thumb empty-t"></div>'}
    <span class="dc-label"><b>${esc(label)}</b>${count != null ? `<small>${count}</small>` : ""}</span>
  </button>`;
}
function groupBy(list, keyFn) {
  const m = new Map();
  list.forEach(e => { const k = keyFn(e); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(e); });
  return [...m.entries()];
}
let collSig = "";
async function loadCollections() {
  await refreshHistory();
  const list = libAll.filter(e => !e.vault);
  const csig = [list.length, list[0] && list[0].id, mediaPerm, JSON.stringify(albums)].join("|");
  if (csig === collSig) return;
  collSig = csig;
  const sources = groupBy(list, siteOf).sort((a, b) => b[1].length - a[1].length);
  $("#siteRail").innerHTML = sources.map(([s, items]) => coverCard(s, items.length, items[0], items[0].device ? 'data-f="device"' : `data-f="site" data-v="${esc(s)}"`)).join("")
    || '<div class="rail-note">Sources appear here after your first download.</div>';
  const types = [["video", "Videos", e => kindOf(e) === "video"], ["photo", "Photos", e => kindOf(e) === "photo"], ["share", "Share-ready", e => e.share_ready === true]];
  const byId = new Map(list.map(e => [e.id, e]));
  const mine = albums.map(a => { const items = a.items.map(id => byId.get(id)).filter(Boolean); return coverCard(a.name, items.length, items[0], `data-f="album" data-v="${esc(a.id)}"`); }).join("");
  const auto = types.map(([t, n, fn]) => { const items = list.filter(fn); return items.length ? coverCard(n, items.length, items[0], `data-f="${t}"`) : ""; }).join("");
  $("#albumRail").innerHTML = `<button type="button" class="dev-card new-album" id="newAlbumCard"><div class="thumb empty-t"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div><span class="dc-label"><b>New album</b></span></button>` + mine + auto;
  const q = Object.entries(QBANDS).map(([k, [label, fn]]) => { const items = list.filter(e => kindOf(e) === "video" && fn(e)); return items.length ? { k, label, items } : null; }).filter(Boolean);
  $("#qualRail").previousElementSibling.hidden = !q.length;
  $("#qualRail").hidden = !q.length;
  $("#qualRail").innerHTML = q.map(o => `<button type="button" class="circ" data-f="q" data-v="${o.k}">${thumbBox(o.items[0], 384)}<span class="circ-label">${o.label}</span></button>`).join("");
}
$("#v-collections").addEventListener("click", e => {
  if (e.target.closest("#newAlbumCard")) { triggerHaptic(); newAlbum([]).then(al => { if (al) loadCollections(); }); return; }
  const b = e.target.closest("[data-f],[data-filter]"); if (!b) return;
  triggerHaptic();
  const t = b.dataset.f || b.dataset.filter;
  openFilter(t === "site" || t === "q" || t === "bucket" || t === "album" ? { type: t, val: b.dataset.v } : t === "device" ? { type: "site-device" } : { type: t });
});
$("#pinAdd").onclick = () => { triggerHaptic(); show("download"); };
$("#viewAllSites").onclick = e => {
  const rail = $("#siteRail"); rail.classList.toggle("wrap");
  e.target.textContent = rail.classList.contains("wrap") ? "Show less" : "View all";
};

/* ----- top bar ----- */
$("#btnAvatar").onclick = () => show("settings");
$("#settingsBack").onclick = () => show(lastTab);
let pvFrom = "library";
const openPhotosView = () => { pvFrom = curView; show("photosview"); };
$("#gridMore").onclick = openPhotosView;
$("#rowPhotosView").onclick = openPhotosView;
$("#pvBack").onclick = () => show(pvFrom);
$("#searchBack").onclick = () => show(lastTab);
$("#layoutPick").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  triggerHaptic(); changeLayout(b.dataset.layout);
});
$("#setDates").checked = datesOn;
$("#setDates").onchange = e => { datesOn = e.target.checked; triggerHaptic(); try { localStorage.setItem("orbit_dates", datesOn); } catch {} renderedSig = ""; };
if (window.OrbitAndroid && window.OrbitAndroid.getPipAuto) $("#setPip").checked = window.OrbitAndroid.getPipAuto();
$("#setPip").onchange = e => { triggerHaptic(); if (window.OrbitAndroid) window.OrbitAndroid.setPipAuto(e.target.checked); };
$("#setFeature").checked = featureOn;
$("#setFeature").onchange = e => { featureOn = e.target.checked; triggerHaptic(); try { localStorage.setItem("orbit_feature", featureOn); } catch {} renderedSig = ""; };
$("#photosViewInfo").textContent = LAYOUTS[layoutName].label;
$$("#layoutPick button").forEach(b => b.classList.toggle("on", b.dataset.layout === layoutName));
$("#setAutoplay").checked = apEnabled;
$("#setAutoplay").onchange = e => {
  apEnabled = e.target.checked; triggerHaptic();
  try { localStorage.setItem("orbit_autoplay", apEnabled); } catch {}
  toast(apEnabled ? "Videos autoplay in the grid" : "Autoplay off");
  apPick();
};
$("#rowQuality").onclick = () => {
  triggerHaptic();
  const cur = $("#setQuality").value;
  openMenu(`<div class="sheet-handle"></div><div class="m-title">Default quality</div>${Object.keys(QNAMES).sort((a, b) => (b === "best") - (a === "best") || (a === "audio") - (b === "audio") || b - a).map(k => `<button type="button" class="m-item radio ${k === cur ? "cur" : ""}" data-k="${k}"><i></i>${QNAMES[k]}</button>`).join("")}`, "sheet-menu", async k => {
    try { applySettings(await api("/api/settings", { default_quality: k })); toast("Default quality: " + QNAMES[k]); } catch (err) { toast("Couldn't save: " + err.message); }
  });
};
$("#btnAdd").onclick = () => { show("download"); setTimeout(() => urlEl.focus(), 80); };
$("#statusChip").onclick = () => show("download");
let lastJobs = [], updateReady = false, lastActive = 0, itemCount = 0, chipText = "";
function updateStatus(active) {
  lastActive = active;
  const text = active ? `Downloading ${active}` : `${itemCount.toLocaleString("en-US")} item${itemCount === 1 ? "" : "s"}`;
  if (text === chipText) return;
  chipText = text;
  $("#scText").textContent = text;
  $("#scIdle").toggleAttribute("hidden", !!active); $("#scBusy").toggleAttribute("hidden", !active);
  $("#statusChip").classList.toggle("busy", !!active);
}
/* ----- notifications: live downloads plus the saved history written by the download service ----- */
let notices = [], noticesOn = true, lastUnread = -1;
const agoText = t => {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return "Just now"; if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " hr ago"; if (s < 604800) return Math.floor(s / 86400) + " d ago";
  return fmtDay(t);
};
async function loadNotices() {
  try { const r = await api("/api/notices"); notices = r.items || []; noticesOn = r.enabled !== false; } catch { return; }
  paintBell();
  $("#notifInfo").textContent = noticesOn ? "On. Android alerts you when a download finishes or fails." : "Off in Android settings. Tap to turn on.";
}
function paintBell() {
  const unread = notices.filter(n => !n.read).length + (updateReady ? 1 : 0);
  const el = $("#bellDot");
  el.hidden = !unread; el.textContent = unread > 9 ? "9+" : unread;
  if (lastUnread >= 0 && unread > lastUnread) { const b = $("#btnBell"); b.classList.remove("ring"); void b.offsetWidth; b.classList.add("ring"); }
  lastUnread = unread;
}
$("#rowNotif").onclick = () => { triggerHaptic(); api("/api/notices/settings", {}).catch(() => {}); };
const N_ICON = { done: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', error: '<path d="M12 6v7M12 17.5v.01"/>', cancelled: '<path d="M7 7l10 10M17 7L7 17"/>', live: '<path d="M12 5v11m0 0l-4-4m4 4l4-4"/>' };
function noticeThumb(id, remote, state) {
  const local = state === "done" && id ? thumbUrl(id, 360) + "&c=1" : "";
  const src = local || remote || "";
  return `<span class="n-thumb">${src ? `<img class="t-img in" alt="" decoding="async" src="${esc(src)}" data-remote="${esc(remote || "")}">` : ""}<i class="n-badge ${state === "done" ? "done" : state === "error" ? "error" : "live"}"><svg viewBox="0 0 24 24">${N_ICON[state] || N_ICON.live}</svg></i></span>`;
}
function noticeGroup(t) {
  const d = new Date(t * 1000), now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : "Earlier";
}
function paintLiveNotices() {
  const box = $("#nLive"), active = lastJobs.filter(j => ACTIVE.includes(j.state));
  box.hidden = !active.length;
  $("#nEmpty").hidden = !!active.length || !!notices.length || updateReady;
  if (!active.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<h4 class="n-sec">Downloading</h4>` + active.map(j => {
    const pct = j.state === "queued" ? 0 : Math.round(j.percent || 0);
    return `<div class="n-card live" data-open="download">${noticeThumb("", j.thumb, "live")}<span class="n-copy"><b>${esc(j.title || "Download")}</b><small>${esc(queueSub(j, j.isImage || j.quality === "image"))}</small><span class="n-bar"><i style="width:${pct}%"></i></span></span></div>`;
  }).join("");
}
function paintNotices() {
  paintLiveNotices();
  let html = "", group = "";
  if (!noticesOn) html += `<button type="button" class="n-banner warn" data-act="perm"><b>Alerts are off</b><small>Tap to allow Orbit notifications in Android settings</small></button>`;
  if (updateReady) html += `<button type="button" class="n-banner" data-act="update"><b>Orbit update available</b><small>Tap to download and install</small></button>`;
  notices.slice(0, 60).forEach((n, i) => {
    const g = noticeGroup(n.t);
    if (g !== group) { group = g; html += `<h4 class="n-sec">${g}</h4>`; }
    const acts = n.state === "error" && n.url ? `<span class="n-acts"><span class="n-act" data-na="retry">Try again</span><span class="n-act" data-na="copy">Copy link</span></span>` : "";
    html += `<div role="button" tabindex="0" class="n-card ${n.state}" data-i="${i}">${noticeThumb(n.id, n.thumb, n.state)}<span class="n-copy"><b>${esc(n.title)}</b><small>${esc(n.body)}</small>${acts}</span><span class="n-time">${esc(agoText(n.t))}${n.read ? "" : '<i class="n-dot"></i>'}</span></div>`;
  });
  $("#nList").innerHTML = html;
  $("#nClear").hidden = !notices.length;
}
$("#btnBell").onclick = () => show("notices");
$("#nBack").onclick = () => show(lastTab);
$("#nClear").onclick = async () => { triggerHaptic(); await api("/api/notices/clear", {}); await loadNotices(); paintNotices(); toast("Notifications cleared"); };
$("#nList").addEventListener("click", e => {
  const act = e.target.closest("[data-act]");
  if (act) {
    triggerHaptic();
    if (act.dataset.act === "perm") api("/api/notices/settings", {}).catch(() => {});
    if (act.dataset.act === "update") { $("#updateBanner").hidden = false; if (/Install|Restart/.test($("#ubBtn").textContent)) applyUpdate(); else startUpdate(); show("library"); }
    return;
  }
  const c = e.target.closest("[data-i]"); if (!c) return;
  const n = notices[+c.dataset.i]; if (!n) return;
  triggerHaptic();
  const na = e.target.closest("[data-na]");
  if (na) {
    if (na.dataset.na === "copy") api("/api/copy", { text: n.url }).then(() => toast("Link copied"));
    if (na.dataset.na === "retry") api("/api/download", { url: n.url, title: n.title, thumb: n.thumb || "", site: "", quality: cfg.default_quality || "best" }).then(() => { toast("Trying again"); poll(); }).catch(err => toast(err.message));
    return;
  }
  if (n.state === "done") openInAppPlayer(n.id); else show("download");
});
$("#nLive").addEventListener("click", e => { if (e.target.closest(".n-card")) show("download"); });
async function openNotices() {
  await loadNotices(); paintNotices();
  if (notices.some(n => !n.read)) { await api("/api/notices/read", {}).catch(() => {}); notices.forEach(n => { n.read = true; }); paintBell(); }
}

/* ---------------- settings ---------------- */
const QNAMES = { best: "Best available", 2160: "4K (2160p)", 1440: "1440p", 1080: "1080p", 720: "720p", 480: "480p", audio: "Audio only (MP3)" };
function applySettings(s) {
  cfg = s;
  $("#setPath").textContent = s.save_dir;
  if (window.OrbitAndroid) {
    $("#setChange").hidden = true;
    $("#setOpen").hidden = true;
  }
  const q = s.default_quality || "best";
  $("#setQuality").value = q;
  $("#setQualityVal").textContent = QNAMES[q] || q;
  $$("#setQualityGrid .q-chip").forEach(c => {
    c.classList.toggle("on", c.dataset.val === q || (q === "2160" && c.dataset.val === "best"));
  });
  if ($("#setAutoDownload")) {
    $("#setAutoDownload").checked = Boolean(s.auto_download);
  }
}
async function checkBatteryOpt() {
  const card = $("#setBatteryCard");
  const btn = $("#btnBatteryOpt");
  const desc = $("#setBatteryDesc");
  if (!btn) return;
  try {
    const res = await api("/api/battery/status");
    if (res && res.ignored) {
      btn.hidden = true;
      if (desc) desc.textContent = "Unrestricted. Android won't pause downloads when you leave Orbit.";
    } else {
      btn.hidden = false;
      if (desc) desc.textContent = "Android may pause downloads when you leave Orbit. Allow unrestricted battery use.";
      btn.onclick = async () => {
        triggerHaptic();
        await api("/api/battery/request", {});
        setTimeout(checkBatteryOpt, 2000);
      };
    }
  } catch (_) {
    if (card) card.style.display = "none";
  }
}

async function loadSettings() {
  try {
    const s = await api("/api/settings");
    applySettings(s);
    checkBatteryOpt();
    if ($("#aAppVer")) $("#aAppVer").textContent = "v" + (s.version || "1.0.4");
    $("#aVer").textContent = s.yt_dlp; $("#aFf").textContent = s.ffmpeg ? "Ready" : "Missing";
    if ($("#aFfSub")) $("#aFfSub").textContent = s.ffmpeg_version ? "FFmpeg " + s.ffmpeg_version : "FFmpeg";
    if ($("#aBuild")) $("#aBuild").textContent = s.build || "Release build";
    if (s.has_update) {
      if ($("#setUpdateInfo")) $("#setUpdateInfo").textContent = `Update available: ${s.latest_version} (Current: v${s.version})`;
      if ($("#setUpdateNow")) $("#setUpdateNow").hidden = false;
    } else {
      if ($("#setUpdateInfo")) $("#setUpdateInfo").textContent = `Orbit v${s.version} — You are on the latest version`;
      if ($("#setUpdateNow")) $("#setUpdateNow").hidden = true;
    }
  } catch {}
}
if ($("#setAutoDownload")) {
  $("#setAutoDownload").onchange = async e => {
    try {
      applySettings(await api("/api/settings", { auto_download: e.target.checked }));
      toast(e.target.checked ? "Automatic download enabled" : "Automatic download disabled");
    } catch (err) {
      toast("Couldn't update setting: " + err.message);
    }
  };
}
$("#setQuality").onchange = async e => { try { applySettings(await api("/api/settings", { default_quality: e.target.value })); toast("Default quality saved"); } catch {} };

const qGrid = $("#setQualityGrid");
if (qGrid) {
  qGrid.addEventListener("click", async e => {
    const chip = e.target.closest(".q-chip");
    if (!chip) return;
    triggerHaptic();
    const val = chip.dataset.val;
    try {
      applySettings(await api("/api/settings", { default_quality: val }));
      const label = chip.querySelector(".q-res")?.textContent || val;
      toast(`Default quality set to ${label}`);
    } catch (err) {
      toast("Couldn't update quality: " + err.message);
    }
  });
}
$("#setChange").onclick = async () => {
  let dir = null;
  if (window.pywebview && pywebview.api && pywebview.api.choose_folder) dir = await pywebview.api.choose_folder(cfg.save_dir);
  else dir = prompt("Save folder:", cfg.save_dir);
  if (!dir) return;
  try { applySettings(await api("/api/settings", { save_dir: dir })); toast("Save folder updated"); } catch (err) { toast(err.message); }
};
const openFolder = () => window.OrbitAndroid
  ? toast("Find Orbit media in your phone's Pictures, Movies or Music folders")
  : api("/api/open-folder", {}).catch(() => toast("Couldn't open the folder"));
$("#setOpen").onclick = openFolder;

/* ---------------- in-app auto updater ---------------- */
let updatePoll = null;

async function checkUpdate(manual = false) {
  try {
    if (manual) toast("Checking for updates...");
    const data = await api("/api/update/check");
    renderUpdate(data, manual);
  } catch (err) {
    if (manual) toast("Update check failed: " + err.message);
  }
}

function renderUpdate(data, manual = false) {
  updateReady = !!data.has_update; paintBell();
  const b = $("#updateBanner");
  const sInfo = $("#setUpdateInfo");
  const sBtn = $("#setUpdateNow");

  if (data.has_update) {
    $("#ubTitle").textContent = `Orbit ${data.latest_version} is available!`;
    $("#ubMeta").textContent = data.release_name || "A new release is ready to download.";
    b.hidden = false;
    if (sInfo) sInfo.textContent = `Update available: ${data.latest_version} (Current: v${data.current_version})`;
    if (sBtn) sBtn.hidden = false;
  } else {
    b.hidden = true;
    if (sInfo) sInfo.textContent = `Orbit v${data.current_version} — You are on the latest version`;
    if (sBtn) sBtn.hidden = true;
    if (manual) toast("You're on the latest version of Orbit!");
  }
}

async function startUpdate() {
  const btn = $("#ubBtn");
  const meter = $("#ubMeter");
  const stat = $("#ubStat");
  const fill = $("#ubFill");
  const sBtn = $("#setUpdateNow");

  btn.disabled = true;
  btn.textContent = "Downloading...";
  if (sBtn) { sBtn.disabled = true; sBtn.textContent = "Downloading..."; }
  meter.hidden = false;

  try {
    await api("/api/update/download", {}, "POST");
    clearInterval(updatePoll);
    updatePoll = setInterval(async () => {
      try {
        const s = await api("/api/update/status");
        if (s.downloading) {
          const pct = Math.max(2, s.download_percent || 0);
          fill.style.width = pct + "%";
          stat.textContent = pct + "%";
          const speedTxt = s.download_speed ? `Downloading (${s.download_speed})` : "Downloading...";
          btn.textContent = speedTxt;
          if (sBtn) { sBtn.textContent = `${pct}%`; }
        } else if (s.ready_to_install) {
          clearInterval(updatePoll);
          fill.style.width = "100%";
          stat.textContent = "100%";
          btn.disabled = false;
          const instTxt = window.OrbitAndroid ? "Install Update" : "Restart & Install";
          btn.textContent = instTxt;
          if (sBtn) { sBtn.disabled = false; sBtn.textContent = instTxt; }
          toast("Update downloaded! Click to install.");
        } else if (s.error) {
          clearInterval(updatePoll);
          btn.disabled = false;
          btn.textContent = "Retry Update";
          if (sBtn) { sBtn.disabled = false; sBtn.textContent = "Retry"; }
          toast("Update failed: " + s.error);
        }
      } catch (e) {
        clearInterval(updatePoll);
      }
    }, 300);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Update Now";
    if (sBtn) { sBtn.disabled = false; sBtn.textContent = "Update"; }
    meter.hidden = true;
    toast("Could not start update: " + err.message);
  }
}

async function applyUpdate() {
  const btn = $("#ubBtn");
  const sBtn = $("#setUpdateNow");
  btn.disabled = true;
  const opTxt = window.OrbitAndroid ? "Opening Installer..." : "Restarting...";
  btn.textContent = opTxt;
  if (sBtn) { sBtn.disabled = true; sBtn.textContent = opTxt; }
  try {
    toast(window.OrbitAndroid ? "Opening package installer..." : "Restarting Orbit to apply update...");
    await api("/api/update/apply", {}, "POST");
    if (window.OrbitAndroid) {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Install Update";
        if (sBtn) { sBtn.disabled = false; sBtn.textContent = "Install Update"; }
      }, 3000);
    }
  } catch (err) {
    btn.disabled = false;
    const retryTxt = window.OrbitAndroid ? "Install Update" : "Restart & Install";
    btn.textContent = retryTxt;
    if (sBtn) { sBtn.disabled = false; sBtn.textContent = retryTxt; }
    toast("Failed: " + err.message);
  }
}

$("#ubBtn").addEventListener("click", () => {
  const t = $("#ubBtn").textContent;
  if (t.includes("Restart") || t.includes("Install")) {
    applyUpdate();
  } else {
    startUpdate();
  }
});

$("#ubClose").addEventListener("click", () => {
  $("#updateBanner").hidden = true;
});

const sCheck = $("#setCheckUpdate");
if (sCheck) sCheck.addEventListener("click", () => checkUpdate(true));

const sUpdateNow = $("#setUpdateNow");
if (sUpdateNow) sUpdateNow.addEventListener("click", () => {
  const t = sUpdateNow.textContent;
  if (t.includes("Restart") || t.includes("Install")) {
    applyUpdate();
  } else {
    $("#updateBanner").hidden = false;
    startUpdate();
  }
});

/* ---------------- start up ---------------- */
// optional deep links: #library / #settings open a screen, ?url=... fetches a link,
// ?shot turns off the clipboard prompt (used for README screenshots)
/* Tapping an Android notification lands here. */
window.onOrbitNotification = (id, view) => {
  loadNotices();
  if (view === "download") { if (!viewer.hidden) closeViewer(); show("download"); return; }
  if (id) openInAppPlayer(id);
};

window.onOrbitShareLink = sharedUrl => {
  const u = normalizeUrl(String(sharedUrl || ""));
  if (u) {
    show("download");
    urlEl.value = u;
    fetchInfo();
  }
};

// Background check for updates 2.5s after launch
setTimeout(() => checkUpdate(false), 2500);


/* ==========================================================================
   Themes, in-app player, private vault, search and share sheet
   ========================================================================== */

/* ---------------- 1. Themes & Accent Palette ---------------- */
let currentAccent = localStorage.getItem("orbit_accent") || "blue";
if (currentAccent !== "blue" && currentAccent !== "white") currentAccent = "blue";
let isAmoled = localStorage.getItem("orbit_amoled") !== "false";   // true AMOLED black unless switched off

function applyThemeColors() {
  document.documentElement.dataset.accent = currentAccent;
  if (isAmoled) document.documentElement.dataset.theme = "amoled";
  else delete document.documentElement.dataset.theme;

  const amoledCheck = $("#setAmoled");
  if (amoledCheck) amoledCheck.checked = isAmoled;

  $$("#paletteGrid .theme-chip").forEach(c => {
    c.classList.toggle("on", c.dataset.accent === currentAccent);
  });
}
applyThemeColors();

const palGrid = $("#paletteGrid");
if (palGrid) {
  palGrid.addEventListener("click", e => {
    const chip = e.target.closest(".theme-chip");
    if (!chip) return;
    triggerHaptic();
    currentAccent = chip.dataset.accent;
    localStorage.setItem("orbit_accent", currentAccent);
    applyThemeColors();
    toast("Accent: " + (chip.querySelector(".theme-label")?.textContent || currentAccent));
  });
}

const amoledToggle = $("#setAmoled");
if (amoledToggle) {
  amoledToggle.addEventListener("change", e => {
    triggerHaptic();
    isAmoled = e.target.checked;
    localStorage.setItem("orbit_amoled", isAmoled);
    applyThemeColors();
    toast(isAmoled ? "True black on" : "True black off");
  });
}

/* ---------------- 2. Menus, dialogs and the photo / video viewer ---------------- */
const menuBackdrop = $("#menuBackdrop"), menuEl = $("#menu");
let menuPick = null, menuResolve = null, promptValue = "";
function openMenu(html, cls, onPick) {
  menuEl.className = "menu " + (cls || "");
  menuEl.innerHTML = html;
  menuPick = onPick || null;
  menuBackdrop.hidden = false;
  requestAnimationFrame(() => menuBackdrop.classList.add("on"));
}
function closeMenu(result) {
  if (menuBackdrop.hidden) return false;
  menuBackdrop.classList.remove("on"); menuBackdrop.hidden = true; menuEl.innerHTML = "";
  if (menuResolve) { const r = menuResolve; menuResolve = null; r(!!result); }
  menuPick = null;
  return true;
}
menuBackdrop.addEventListener("click", e => {
  if (e.target === menuBackdrop) { closeMenu(false); return; }
  const r = e.target.closest("[data-r]");
  if (r) { const inp = $("#dlgInput"); promptValue = inp ? inp.value : ""; closeMenu(r.dataset.r === "1"); return; }
  const k = e.target.closest("[data-k]");
  if (k) { triggerHaptic(); const pick = menuPick, key = k.dataset.k; closeMenu(false); if (pick) pick(key); }
});
function confirmDialog(title, text, okLabel) {
  return new Promise(res => {
    menuResolve = res;
    openMenu(`<div class="dlg-t">${esc(title)}</div><p class="dlg-p">${esc(text)}</p><div class="dlg-b"><button type="button" data-r="0">Cancel</button><button type="button" data-r="1" class="strong">${esc(okLabel || "OK")}</button></div>`, "dlg");
  });
}
const ICO = {
  info: '<path d="M12 11v6M12 7.5v.01"/><circle cx="12" cy="12" r="9"/>',
  speed: '<path d="M12 14l4-5"/><path d="M4.9 19a9 9 0 1 1 14.2 0"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  redo: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
};
const mi = (k, ic, label) => `<button type="button" class="m-item" data-k="${k}"><svg viewBox="0 0 24 24">${ic}</svg>${esc(label)}</button>`;

const viewer = $("#playerModal"), vPhoto = $("#vPhoto"), vPoster = $("#vPoster"), vPages = $("#vPages"), stage = $("#vStage");
const Native = window.OrbitAndroid || null;
let vList = [], vIdx = 0, vCur = null;
const vS = { playing: false, pos: 0, dur: 0, rate: 1, t0: 0, muted: false, scrub: false, scrubMs: 0 };
const setIco = (id, path) => { const el = $(id); if (el) el.innerHTML = path; };
const PAUSE_P = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>', PLAY_P = '<path d="M8 5l11 7-11 7z"/>';
const VOL_P = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/>';
const MUTE_P = '<path d="M3 9v6h4l5 5V4L7 9H3zm13 .4l-1.4 1.4 2.1 2.1-2.1 2.1 1.4 1.4 2.1-2.1 2.1 2.1 1.4-1.4-2.1-2.1 2.1-2.1-1.4-1.4-2.1 2.1z"/>';

let libDirty = false;
function paintFav() { $("#vFav").classList.toggle("on", !!(vCur && favs.has(vCur.id))); }
function syncPlayerRect() {
  if (!Native || !Native.playerRect) return;
  const r = stage.getBoundingClientRect(), d = devicePixelRatio || 1;
  Native.playerRect(Math.round(r.left * d), Math.round(r.top * d), Math.round(r.width * d), Math.round(r.height * d));
}
const isPlayable = e => e && kindOf(e) !== "photo";
const posterUrl = e => kindOf(e) === "video" ? thumbUrl(e.id, 768) + "&first=1" : thumbUrl(e.id, 768);
function setNeighbour(sel, e) {
  const img = $(sel + " img");
  if (e && kindOf(e) !== "audio") { if (img.dataset.id !== e.id) { img.dataset.id = e.id; img.src = posterUrl(e); } img.style.visibility = ""; }
  else { img.removeAttribute("data-id"); img.style.visibility = "hidden"; }
}
let vGen = 0, uiTouched = false, uiTimer = 0;
/* Moving to another item never shows a blank or the old video:
   the next picture is decoded first, the old video surface is removed, and only then does anything change on screen. */
function showItem(i, o) {
  o = o || {};
  const gen = ++vGen;
  vIdx = Math.max(0, Math.min(vList.length - 1, i));
  const e = vCur = vList[vIdx];
  if (!e) { closeViewer(); return; }
  const k = kindOf(e), hiUrl = k === "audio" ? "" : posterUrl(e);
  const apply = () => {
    if (gen !== vGen) return;
    resetZoom();
    if (Native) { Native.playerStop(); Native.playerOffset(0, 0); }
    vPages.style.transform = ""; vPages.style.willChange = "";
    $("#playerTitle").textContent = e.title || "";
    $("#vDateMain").textContent = e.t ? fmtDay(e.t) : "Saved";
    $("#vDateSub").textContent = e.trashed && e.expires ? `Deleted forever in ${Math.max(0, Math.ceil((e.expires - Date.now() / 1000) / 86400))} days` : (e.t ? fmtClock(e.t) : "");
    $("#vErr").hidden = true;
    viewer.dataset.kind = k;
    viewer.classList.toggle("in-trash", !!e.trashed);
    $("#vAudio").hidden = k !== "audio";
    vPhoto.hidden = true;
    vPoster.hidden = k === "audio";
    if (k !== "audio") {
      const first = o.low || hiUrl;
      if (vPoster.getAttribute("src") !== first) vPoster.src = first;
      if (first !== hiUrl && k === "photo") { const hi = new Image(); hi.src = hiUrl; hi.decode().then(() => { if (gen === vGen && !vPoster.hidden) vPoster.src = hiUrl; }).catch(() => {}); }
    }
    setNeighbour("#pgPrev", vList[vIdx - 1]);
    setNeighbour("#pgNext", vList[vIdx + 1]);
    if (k === "photo") {
      /* The original file, untouched, whenever the browser can show it. HEIC and the like are converted at up to 4096 px. */
      const name = String(e.device ? e.title : e.file || "");
      const src = /\.(jpe?g|png|webp|gif|bmp)$/i.test(name) ? streamUrl(e.id) : thumbUrl(e.id, 4096);
      const full = new Image(); full.src = src;
      full.decode().then(() => {
        if (gen !== vGen) return;
        vPhoto.src = src; vPhoto.hidden = false;
        requestAnimationFrame(() => { if (gen === vGen) vPoster.hidden = true; });
      }).catch(() => { if (gen === vGen && !vPoster.naturalWidth) $("#vErr").hidden = false; });
    } else {
      Object.assign(vS, { playing: true, pos: 0, dur: (e.dur || 0) * 1000, rate: 1, t0: performance.now(), scrub: false });
      setIco("#vPlayIco", PAUSE_P); setIco("#vVolIco", vS.muted ? MUTE_P : VOL_P);
      paintSeek(true);
      const start = () => { if (Native && gen === vGen) {
        Native.playerOpen(e.id, k === "audio"); if (vS.muted) Native.playerMuted(true); syncPlayerRect();
        const saved = posMap[e.id];
        if (saved > 5000 && (!e.dur || saved < e.dur * 1000 - 8000)) { Native.playerSeek(saved, false); vS.pos = saved; vS.t0 = performance.now(); toast("Resuming from " + longDur(saved / 1000)); }
      } };
      if (o.delayNative) setTimeout(start, 240); else start();
      startSeekLoop();
    }
    paintFav();
  };
  if (o.swipe && hiUrl) {
    const next = new Image(); next.src = hiUrl;
    Promise.race([next.decode().catch(() => {}), new Promise(r => setTimeout(r, 160))]).then(apply);
  } else apply();
}
function heroTransform(rect) {
  const s = stage.getBoundingClientRect(), k = rect.width / s.width;
  return `translate3d(${rect.left + rect.width / 2 - s.left - s.width / 2}px,${rect.top + rect.height / 2 - s.top - s.height / 2}px,0) scale(${k})`;
}
function openViewer(list, idx, fromRect) {
  if (!list || !list[idx]) return;
  apStop();
  vList = list.slice();
  viewer.hidden = false; viewer.classList.remove("hide-ui", "closing");
  document.body.classList.add("viewing"); document.documentElement.classList.add("viewing");
  if (Native) Native.viewerOpen(true);
  uiTouched = false; clearTimeout(uiTimer);
  if (kindOf(list[idx]) === "video") {         // video opens immersive, as in Google Photos; the bars come back on their own
    viewer.classList.add("hide-ui");
    uiTimer = setTimeout(() => { if (!uiTouched) viewer.classList.remove("hide-ui"); }, 2600);
  }
  const lowCell = fromRect ? gridEl.querySelector(`.cell[data-id="${CSS.escape(list[idx].id)}"]`) : null;
  showItem(idx, { delayNative: !!fromRect, low: lowCell && lowCell._src ? lowCell._src : "" });
  if (fromRect) {
    viewer.classList.add("hero");
    vPages.style.transition = "none"; vPages.style.transform = heroTransform(fromRect);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      vPages.style.transition = "transform .26s cubic-bezier(.2,.9,.25,1)"; vPages.style.transform = "";
      viewer.classList.remove("hero-bars");
      setTimeout(() => { vPages.style.transition = ""; viewer.classList.remove("hero"); }, 270);
    }));
    viewer.classList.add("hero-bars");
  }
}
function closeViewer() {
  if (viewer.hidden || viewer.classList.contains("closing")) return false;
  backGestureCommit();
  triggerHaptic();
  if (Native) Native.playerClose();
  const e = vCur;
  let rect = null;
  if (e && curView === "library") {
    const cell = gridEl.querySelector(`.cell[data-id="${CSS.escape(e.id)}"]`);
    if (cell) { const r = cell.getBoundingClientRect(), m = mainEl.getBoundingClientRect(); if (r.bottom > m.top && r.top < m.bottom) rect = r; }
  }
  vCur = null;
  document.body.classList.remove("viewing"); document.documentElement.classList.remove("viewing");
  viewer.classList.add("closing");
  if (!vPhoto.hidden && vPhoto.naturalWidth) vPoster.hidden = true; else if (e && kindOf(e) !== "audio") vPoster.hidden = false;
  vPages.style.transition = "transform .2s cubic-bezier(.3,0,.2,1), opacity .2s";
  vPages.style.transform = rect ? heroTransform(rect) : "scale(.92)";
  vPages.style.opacity = rect ? "1" : "0";
  setTimeout(() => {
    viewer.hidden = true; viewer.classList.remove("closing", "hero", "hero-bars", "back-drag");
    viewer.style.background = ""; viewer.style.transition = "";
    vPages.style.transition = ""; vPages.style.transform = ""; vPages.style.opacity = "";
    vPhoto.removeAttribute("src"); vPoster.removeAttribute("src"); resetZoom();
    if (libDirty && curView === "library") { libDirty = false; renderLib(true); }
    else apPick();
  }, 205);
  return true;
}
/* The queue's Play button still calls this. */
async function openInAppPlayer(id) {
  triggerHaptic();
  const list = await refreshHistory();
  const one = list.find(x => x.id === id) || historyAll.find(x => x.id === id);
  if (!one) return toast("That file isn't there any more");
  const pool = list.filter(e => !!e.vault === !!one.vault);
  if (!pool.includes(one)) return openViewer([one], 0);      // an MP3 opens on its own; it isn't part of the photo library
  openViewer(pool, pool.indexOf(one));
}
$("#playerCloseBtn").onclick = closeViewer;
$("#vFav").onclick = () => {
  if (!vCur) return; triggerHaptic();
  if (favs.has(vCur.id)) { favs.delete(vCur.id); toast("Removed from favorites"); } else { favs.add(vCur.id); toast("Added to favorites"); }
  saveFavs(); paintFav(); libDirty = true;
  const star = $("#vFav"); star.classList.remove("pop"); void star.offsetWidth; star.classList.add("pop");
};

/* ----- native player events and the seek bar ----- */
window.orbitPlayerEvent = ev => {
  if (viewer.hidden) return;
  if (ev.ev === "first") { const g = vGen; requestAnimationFrame(() => requestAnimationFrame(() => { if (g === vGen && vCur && kindOf(vCur) !== "photo") vPoster.hidden = true; })); return; }
  if (ev.ev === "error") { vPoster.hidden = false; $("#vErr").hidden = false; return; }
  if (ev.ev === "state") {
    vS.playing = ev.playing; vS.pos = ev.pos;
    if (vCur && ev.dur > 60000 && kindOf(vCur) !== "photo") {
      if (ev.ended) savePos(vCur.id, null);
      else if (ev.pos > 5000 && performance.now() - posSavedAt > 3000) { posSavedAt = performance.now(); savePos(vCur.id, ev.pos); }
    } if (ev.dur) vS.dur = ev.dur; vS.rate = ev.rate || 1; vS.t0 = performance.now();
    $("#vSpin").hidden = !ev.buffering;
    setIco("#vPlayIco", ev.playing || ev.buffering ? PAUSE_P : PLAY_P);
    if (ev.ended) { viewer.classList.remove("hide-ui"); setIco("#vPlayIco", PLAY_P); }
  }
};
const seekEl = $("#vSeek");
let seekRaf = 0, lastSec = -1;
function curMs() {
  if (vS.scrub) return vS.scrubMs;
  const p = vS.playing ? vS.pos + (performance.now() - vS.t0) * vS.rate : vS.pos;
  return vS.dur ? Math.min(p, vS.dur) : p;
}
function paintSeek(force) {
  const ms = curMs(), p = vS.dur ? ms / vS.dur : 0, w = seekEl.clientWidth || 1;
  const x = p * w, gap = 7;
  $("#vSeekFill").style.width = Math.max(0, x - gap) + "px";
  const rest = $("#vSeekRest");
  rest.style.left = Math.min(w, x + gap) + "px";
  $("#vSeekKnob").style.transform = `translate3d(${x - 2}px,0,0)`;
  const sec = Math.floor(ms / 1000);
  if (force || sec !== lastSec) { lastSec = sec; $("#vTime").textContent = `${longDur(ms / 1000)} / ${longDur(vS.dur / 1000)}`; }
}
function startSeekLoop() {
  cancelAnimationFrame(seekRaf);
  const loop = () => {
    if (viewer.hidden || !isPlayable(vCur)) return;
    if (!viewer.classList.contains("hide-ui")) paintSeek();
    seekRaf = requestAnimationFrame(loop);
  };
  seekRaf = requestAnimationFrame(loop);
}
$("#vPlay").onclick = () => {
  triggerHaptic(); if (!Native) return;
  if (vS.playing) { Native.playerPause(); vS.pos = curMs(); vS.playing = false; setIco("#vPlayIco", PLAY_P); }
  else { Native.playerPlay(); setIco("#vPlayIco", PAUSE_P); }
};
/* Tap: mute or unmute, and show the slider. The slider sets the phone's media volume, same as the volume keys. */
const volPop = $("#vVolPop"), volFill = $("#vVolFill");
let volHide = 0, volDrag = false;
const paintVol = () => {
  const lvl = Native && Native.getMediaVolume ? Native.getMediaVolume() : 1;
  volFill.style.transform = `scaleY(${vS.muted ? 0 : lvl})`;
  setIco("#vVolIco", vS.muted || lvl === 0 ? MUTE_P : VOL_P);
};
const showVolPop = () => { paintVol(); volPop.classList.add("on"); clearTimeout(volHide); volHide = setTimeout(() => { if (!volDrag) volPop.classList.remove("on"); }, 2600); };
$("#vVol").onclick = () => {
  triggerHaptic();
  vS.muted = !vS.muted;
  if (Native) Native.playerMuted(vS.muted);
  showVolPop();
};
const volAt = y => {
  const r = volPop.getBoundingClientRect(), lvl = Math.max(0, Math.min(1, (r.bottom - 10 - y) / (r.height - 20)));
  if (Native && Native.setMediaVolume) Native.setMediaVolume(lvl);
  if (vS.muted && lvl > 0) { vS.muted = false; if (Native) Native.playerMuted(false); }
  paintVol();
};
volPop.addEventListener("pointerdown", e => { volDrag = true; volPop.setPointerCapture(e.pointerId); volAt(e.clientY); clearTimeout(volHide); });
volPop.addEventListener("pointermove", e => { if (volDrag) volAt(e.clientY); });
const volEnd = () => { if (!volDrag) return; volDrag = false; showVolPop(); };
volPop.addEventListener("pointerup", volEnd); volPop.addEventListener("pointercancel", volEnd);
let lastScrubSend = 0;
const seekMs = clientX => { const r = seekEl.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * vS.dur; };
seekEl.addEventListener("pointerdown", e => { seekEl.setPointerCapture(e.pointerId); vS.scrub = true; vS.scrubMs = seekMs(e.clientX); seekEl.classList.add("drag"); paintSeek(true); });
seekEl.addEventListener("pointermove", e => {
  if (!vS.scrub) return;
  vS.scrubMs = seekMs(e.clientX); paintSeek(true);
  const now = performance.now();
  if (Native && now - lastScrubSend > 70) { lastScrubSend = now; Native.playerSeek(vS.scrubMs, true); }
});
const endSeek = () => {
  if (!vS.scrub) return;
  if (Native) Native.playerSeek(vS.scrubMs, false);
  vS.pos = vS.scrubMs; vS.t0 = performance.now(); vS.scrub = false;
  seekEl.classList.remove("drag"); paintSeek(true);
};
seekEl.addEventListener("pointerup", endSeek); seekEl.addEventListener("pointercancel", endSeek);

/* ----- gestures: tap, double-tap zoom, pinch, pan, swipe between items, swipe down to close ----- */
let zoom = 1, panX = 0, panY = 0;
const zoomTarget = () => vPhoto.hidden ? vPoster : vPhoto;
function applyZoom() { zoomTarget().style.transform = zoom > 1 ? `translate3d(${panX}px,${panY}px,0) scale(${zoom})` : ""; }
function resetZoom() { zoom = 1; panX = panY = 0; vPhoto.style.transform = ""; vPoster.style.transform = ""; }
function clampPan() {
  const r = stage.getBoundingClientRect(), mx = r.width * (zoom - 1) / 2, my = r.height * (zoom - 1) / 2;
  panX = Math.max(-mx, Math.min(mx, panX)); panY = Math.max(-my, Math.min(my, panY));
}
let g = null, lastTap = 0, tapTimer = null;
const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
function moveTo(dx, dy) {
  if (!vPages.style.willChange) vPages.style.willChange = "transform";
  vPages.style.transform = `translate3d(${dx}px,${dy}px,0)`;
  if (Native && isPlayable(vCur) && kindOf(vCur) === "video") Native.playerOffset(dx * devicePixelRatio, dy * devicePixelRatio);
}
function animateTo(dx0, dy0, dx1, dy1, done) {
  const t0 = performance.now(), D = 190;
  const step = now => {
    const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3);
    moveTo(dx0 + (dx1 - dx0) * e, dy0 + (dy1 - dy0) * e);
    if (p < 1) requestAnimationFrame(step); else { if (done) done(); else vPages.style.willChange = ""; }
  };
  requestAnimationFrame(step);
}
stage.addEventListener("touchstart", e => {
  if (e.target.closest(".v-overlay") || viewer.classList.contains("editing")) { g = null; return; }     // play, volume and the seek bar are not taps on the picture
  if (e.touches.length === 2 && kindOf(vCur || {}) === "photo") { g = { pinch: true, d0: dist(e.touches), z0: zoom }; return; }
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  g = { x: t.clientX, y: t.clientY, px: panX, py: panY, mode: null, t: performance.now() };
}, { passive: true });
stage.addEventListener("touchmove", e => {
  if (!g) return;
  e.preventDefault();
  if (g.pinch) {
    if (e.touches.length < 2) return;
    zoom = Math.max(1, Math.min(6, g.z0 * dist(e.touches) / g.d0)); clampPan(); applyZoom(); return;
  }
  const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
  if (!g.mode) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    g.mode = zoom > 1 ? "pan" : Math.abs(dx) > Math.abs(dy) ? "page" : dy > 0 ? "down" : "up";
  }
  if (g.mode === "pan") { panX = g.px + dx; panY = g.py + dy; clampPan(); applyZoom(); }
  else if (g.mode === "page") {
    const edge = (dx > 0 && vIdx === 0) || (dx < 0 && vIdx === vList.length - 1);
    g.dx = edge ? dx * 0.25 : dx; moveTo(g.dx, 0);
  } else if (g.mode === "down") { g.dy = dy; moveTo(0, dy); viewer.classList.add("dragging"); }
  else if (g.mode === "up") { g.dy = dy; moveTo(0, dy * 0.3); }
}, { passive: false });
stage.addEventListener("touchend", e => {
  if (!g) return;
  const cur = g;
  if (cur.pinch) { if (e.touches.length === 0) { g = null; if (zoom <= 1.02) resetZoom(); } return; }
  g = null;
  if (cur.mode === "page") {
    const W = stage.clientWidth + 16, fast = Math.abs(cur.dx) > 40 && performance.now() - cur.t < 220;
    const go = (Math.abs(cur.dx) > W * 0.28 || fast) ? (cur.dx < 0 ? 1 : -1) : 0;
    const target = vIdx + go;
    if (go && target >= 0 && target < vList.length) {
      if (Native && isPlayable(vCur)) Native.playerPause();
      animateTo(cur.dx, 0, -go * W, 0, () => showItem(target, { swipe: true }));
    } else animateTo(cur.dx, 0, 0, 0);
  } else if (cur.mode === "down") {
    viewer.classList.remove("dragging");
    if (cur.dy > 120) closeViewer(); else animateTo(0, cur.dy, 0, 0);
  } else if (cur.mode === "up") {
    animateTo(0, (cur.dy || 0) * 0.3, 0, 0);
    if ((cur.dy || 0) < -70) showDetails();
  } else if (!cur.mode) {
    const now = performance.now(), pt = e.changedTouches[0], box = stage.getBoundingClientRect();
    const toggle = () => { uiTouched = true; viewer.classList.toggle("hide-ui"); };
    if (now - lastTap < 280) {
      clearTimeout(tapTimer); lastTap = 0;
      if (kindOf(vCur || {}) === "photo") {
        const img = zoomTarget();
        img.classList.add("zooming"); setTimeout(() => img.classList.remove("zooming"), 230);
        if (zoom > 1) resetZoom();
        else { zoom = 2.5; panX = (box.width / 2 - (pt.clientX - box.left)) * (zoom - 1); panY = (box.height / 2 - (pt.clientY - box.top)) * (zoom - 1); clampPan(); applyZoom(); }
      } else {
        const fx = (pt.clientX - box.left) / box.width;
        if (fx < 0.4) skipBy(-10000); else if (fx > 0.6) skipBy(10000); else toggle();
      }
    } else { lastTap = now; tapTimer = setTimeout(toggle, 285); }
  }
}, { passive: true });

function skipBy(ms) {
  if (!Native || !vS.dur) return;
  triggerHaptic();
  const to = Math.max(0, Math.min(vS.dur - 200, curMs() + ms));
  Native.playerSeek(to, false);
  vS.pos = to; vS.t0 = performance.now();
  const el = $("#vSkip");
  el.textContent = ms < 0 ? "−10 s" : "+10 s";
  el.className = "v-skip " + (ms < 0 ? "left" : "right");
  void el.offsetWidth; el.classList.add("on");
  paintSeek(true);
}

/* ----- remember where you stopped in longer videos ----- */
let posMap = {}; try { posMap = JSON.parse(localStorage.getItem("orbit_pos") || "{}"); } catch {}
let posSavedAt = 0;
function savePos(id, ms) {
  if (ms === null) delete posMap[id]; else posMap[id] = Math.round(ms);
  const keys = Object.keys(posMap); if (keys.length > 300) delete posMap[keys[0]];
  try { localStorage.setItem("orbit_pos", JSON.stringify(posMap)); } catch {}
}

/* ----- trim ----- */
let trim = null, trimSeekAt = 0;
function paintTrim() {
  const w = 100 / (vS.dur || 1);
  $("#tStart").style.left = trim.a * w + "%"; $("#tEnd").style.left = trim.b * w + "%";
  $("#tRange").style.left = trim.a * w + "%"; $("#tRange").style.width = (trim.b - trim.a) * w + "%";
  $("#tInfo").textContent = `${longDur(trim.a / 1000)} – ${longDur(trim.b / 1000)}  ·  ${longDur((trim.b - trim.a) / 1000)} long`;
}
function openTrim() {
  if (!vS.dur) return toast("Wait for the video to load");
  if (Native) Native.playerPause();
  trim = { a: 0, b: vS.dur, drag: null };
  viewer.classList.add("editing", "trimming"); viewer.classList.remove("hide-ui");
  paintTrim();
}
const closeEdit = () => { viewer.classList.remove("editing", "trimming", "cropping"); trim = null; if (crop) { vPhoto.style.transform = ""; crop = null; } };
const tBar = $("#tBar");
tBar.addEventListener("pointerdown", e => {
  if (!trim) return;
  tBar.setPointerCapture(e.pointerId);
  const r = tBar.getBoundingClientRect(), ms = (e.clientX - r.left) / r.width * vS.dur;
  trim.drag = Math.abs(ms - trim.a) < Math.abs(ms - trim.b) ? "a" : "b";
});
tBar.addEventListener("pointermove", e => {
  if (!trim || !trim.drag) return;
  const r = tBar.getBoundingClientRect(), ms = Math.max(0, Math.min(vS.dur, (e.clientX - r.left) / r.width * vS.dur));
  if (trim.drag === "a") trim.a = Math.min(ms, trim.b - 1000); else trim.b = Math.max(ms, trim.a + 1000);
  trim.a = Math.max(0, trim.a); trim.b = Math.min(vS.dur, trim.b);
  paintTrim();
  const now = performance.now();
  if (Native && now - trimSeekAt > 90) { trimSeekAt = now; Native.playerSeek(trim[trim.drag], true); }
});
tBar.addEventListener("pointerup", () => { if (trim && trim.drag && Native) Native.playerSeek(trim[trim.drag], false); if (trim) trim.drag = null; });
$("#tCancel").onclick = () => { closeEdit(); if (Native) Native.playerPlay(); };
$("#tSave").onclick = async () => {
  if (!trim || !vCur) return;
  const e = vCur, a = Math.round(trim.a), b = Math.round(trim.b);
  try { await api("/api/trim/" + e.id, { start: a, end: b, title: e.title || "Video" }); toast("Trimming in the background"); closeEdit(); libDirty = true; poll(); }
  catch (err) { toast(err.message); }
};

/* ----- crop and rotate ----- */
let crop = null;
function cropBounds() {
  const s = stage.getBoundingClientRect(), turned = crop.rot % 180 !== 0;
  const w = turned ? vPhoto.naturalHeight : vPhoto.naturalWidth, h = turned ? vPhoto.naturalWidth : vPhoto.naturalHeight;
  const k = Math.min(s.width / w, s.height / h), dw = w * k, dh = h * k;
  return { x: (s.width - dw) / 2, y: (s.height - dh) / 2, w: dw, h: dh, k };
}
function paintCrop() {
  const b = cropBounds(), s = stage.getBoundingClientRect();
  const k0 = Math.min(s.width / vPhoto.naturalWidth, s.height / vPhoto.naturalHeight);
  vPhoto.style.transform = crop.rot ? `rotate(${crop.rot}deg) scale(${b.k / k0})` : "";
  const box = $("#cropBox");
  box.style.left = b.x + crop.x * b.w + "px"; box.style.top = b.y + crop.y * b.h + "px";
  box.style.width = crop.w * b.w + "px"; box.style.height = crop.h * b.h + "px";
}
function openCrop() {
  if (vPhoto.hidden || !vPhoto.naturalWidth) return toast("Wait for the photo to load");
  resetZoom();
  crop = { x: 0.08, y: 0.08, w: 0.84, h: 0.84, rot: 0, drag: null };
  viewer.classList.add("editing", "cropping"); viewer.classList.remove("hide-ui");
  paintCrop();
}
const cropBox = $("#cropBox");
cropBox.addEventListener("pointerdown", e => {
  if (!crop) return;
  cropBox.setPointerCapture(e.pointerId);
  crop.drag = { h: e.target.dataset.h || "move", sx: e.clientX, sy: e.clientY, x: crop.x, y: crop.y, w: crop.w, h0: crop.h };
});
cropBox.addEventListener("pointermove", e => {
  const d = crop && crop.drag; if (!d) return;
  const b = cropBounds(), dx = (e.clientX - d.sx) / b.w, dy = (e.clientY - d.sy) / b.h, MIN = 0.08;
  if (d.h === "move") { crop.x = Math.max(0, Math.min(1 - d.w, d.x + dx)); crop.y = Math.max(0, Math.min(1 - d.h0, d.y + dy)); }
  else {
    let l = d.x, t = d.y, r = d.x + d.w, bt = d.y + d.h0;
    if (d.h.includes("l")) l = Math.max(0, Math.min(r - MIN, l + dx));
    if (d.h.includes("r")) r = Math.min(1, Math.max(l + MIN, r + dx));
    if (d.h.includes("t")) t = Math.max(0, Math.min(bt - MIN, t + dy));
    if (d.h.includes("b")) bt = Math.min(1, Math.max(t + MIN, bt + dy));
    crop.x = l; crop.y = t; crop.w = r - l; crop.h = bt - t;
  }
  paintCrop();
});
cropBox.addEventListener("pointerup", () => { if (crop) crop.drag = null; });
$("#cRotate").onclick = () => { if (!crop) return; triggerHaptic(); crop.rot = (crop.rot + 90) % 360; crop.x = 0.08; crop.y = 0.08; crop.w = 0.84; crop.h = 0.84; paintCrop(); };
$("#cCancel").onclick = closeEdit;
$("#cSave").onclick = async () => {
  if (!crop || !vCur) return;
  const e = vCur, btn = $("#cSave");
  btn.disabled = true;
  try {
    await api("/api/edit/crop", { id: e.id, title: e.title || "Photo", x: crop.x, y: crop.y, w: crop.w, h: crop.h, rot: crop.rot });
    toast("Saved as a new photo"); closeEdit(); libDirty = true;
    await refreshHistory();
  } catch (err) { toast(err.message || "Couldn't save"); }
  btn.disabled = false;
};

/* ----- bottom actions ----- */
$("#vRestore").onclick = async () => { if (!vCur) return; const e = vCur; triggerHaptic(); if (await restoreItems([e])) afterRemoved(e.id); };
$("#vPurge").onclick = async () => { if (!vCur) return; const e = vCur; triggerHaptic(); if (await purgeItems([e])) afterRemoved(e.id); };
$("#vShare").onclick = async () => { if (!vCur) return; triggerHaptic(); try { await shareChecked(vCur.id); } catch (err) { toast(err.message || "Couldn't share"); } };
$("#vConvert").onclick = () => {
  if (!vCur) return;
  const k = kindOf(vCur);
  if (k === "photo") return openCrop();
  if (k !== "video") return toast("MP3 files can't be edited here");
  openMenu(`<div class="sheet-handle"></div><div class="m-title">Edit</div>${mi("trim", '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 8l12 10M8 16L20 6"/>', "Trim video")}${mi("conv", '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>', "Convert or send a smaller copy")}`, "sheet-menu", key => {
    if (key === "trim") openTrim();
    if (key === "conv") openSheet(vCur.id, vCur.title);
  });
};
function afterRemoved(id) {
  libDirty = true;
  const i = vList.findIndex(x => x.id === id);
  if (i >= 0) vList.splice(i, 1);
  if (!vList.length) closeViewer(); else showItem(Math.min(i, vList.length - 1));
}
async function vaultToggle(e) {
  const restore = !!e.vault; triggerHaptic();
  if (await vaultItems([e], restore)) afterRemoved(e.id);
}
$("#vAddTo").onclick = () => {
  if (!vCur) return; const e = vCur;
  openMenu(`<div class="sheet-handle"></div><div class="m-title">Add to</div>
    ${mi("fav", ICO.star, favs.has(e.id) ? "Remove from favorites" : "Favorites")}
    ${mi("album", '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M7 2.5h10"/>', "Album")}
    ${mi("vault", ICO.lock, e.vault ? "Restore to gallery" : "Private vault")}`, "sheet-menu", k => {
    if (k === "album") addToAlbumMenu([e.id]);
    if (k === "fav") { favs.has(e.id) ? favs.delete(e.id) : favs.add(e.id); saveFavs(); paintFav(); libDirty = true; toast(favs.has(e.id) ? "Added to favorites" : "Removed from favorites"); }
    if (k === "vault") vaultToggle(e);
  });
};
$("#vTrash").onclick = async () => {
  if (!vCur) return; const e = vCur; triggerHaptic();
  const gone = await removeItems([e]);
  if (gone.includes(e.id)) { toast(e.device ? "Moved to trash" : "Deleted"); afterRemoved(e.id); }
};
function showDetails() {
  if (!vCur) return; const e = vCur, k = kindOf(e);
  const row = (a, b) => b ? `<div class="d-row"><span>${esc(a)}</span><b>${esc(b)}</b></div>` : "";
  openMenu(`<div class="sheet-handle"></div><div class="m-title">Details</div>
    ${row("Name", e.title)}${row("Taken", e.t ? fmtDay(e.t) + ", " + fmtClock(e.t) : "")}${row(e.device ? "Folder" : "Source", e.device ? e.bucket : siteOf(e))}
    ${row("Type", k === "photo" ? "Photo" : k === "audio" ? "Audio (MP3)" : "Video")}
    ${row("Size", fmtSize(e.size))}${row("Resolution", e.height ? e.height + "p" : "")}${row("Length", e.dur ? longDur(e.dur) : "")}${row("Codec", e.codec)}
    ${row("Location", e.vault ? "Private vault" : "On this phone")}
    ${e.url ? `<div class="d-row link"><span>Link</span><b>${esc(e.url)}</b></div>` : ""}`, "sheet-menu");
}
$("#vDate").onclick = showDetails;
$("#vMore").onclick = () => {
  if (!vCur) return; const e = vCur, k = kindOf(e);
  openMenu(`<div class="pop-list">
    ${mi("info", ICO.info, "Details")}
    ${k !== "photo" ? mi("speed", ICO.speed, "Playback speed") : ""}
    ${k === "video" && Native && Native.playerPip ? mi("pip", '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1"/>', "Small window") : ""}
    ${e.url ? mi("copy", '<path d="M9 9h11v11H9zM5 15V4h11"/>', "Copy link") : ""}
    ${mi("open", ICO.open, "Open with another app")}
    ${e.url ? mi("again", ICO.redo, "Download again") : ""}
    ${mi("vault", ICO.lock, e.vault ? "Restore to gallery" : "Move to private vault")}</div>`, "pop", key => {
    if (key === "info") showDetails();
    if (key === "pip") Native.playerPip();
    if (key === "copy") api("/api/copy", { text: e.url }).then(() => toast("Link copied"));
    if (key === "speed") openMenu(`<div class="sheet-handle"></div><div class="m-title">Playback speed</div>${[0.5, 1, 1.25, 1.5, 2].map(s => `<button type="button" class="m-item ${vS.rate === s ? "cur" : ""}" data-k="${s}">${s === 1 ? "Normal" : s + "x"}</button>`).join("")}`, "sheet-menu", v => { vS.pos = curMs(); vS.t0 = performance.now(); vS.rate = +v; if (Native) Native.playerRate(+v); toast("Speed " + v + "x"); });
    if (key === "open") api("/api/open/" + e.id, {}).catch(err => toast(err.message || "Couldn't open"));
    if (key === "again") { closeViewer(); show("download"); urlEl.value = e.url; fetchInfo(); }
    if (key === "vault") vaultToggle(e);
  });
};

/* the Android back button / swipe-back goes through here first */
window.orbitBack = () => {
  if (!menuBackdrop.hidden) { closeMenu(false); return true; }
  if (viewer.classList.contains("editing")) { const wasTrim = !!trim; closeEdit(); if (wasTrim && Native) Native.playerPlay(); return true; }
  if (!$("#sheet").hidden) { closeSheet(); return true; }
  if (!viewer.hidden) { closeViewer(); return true; }
  if (selMode) { exitSelect(); return true; }
  if (curView === "photosview") { backFade(() => show(pvFrom)); return true; }
  if (curView === "settings" || curView === "search" || curView === "notices") { backFade(() => show(lastTab)); return true; }
  if (curView === "library" && libFilter.type !== "all") { backFade(() => $("#filterBack").click()); return true; }
  if (curView !== "library") { backFade(() => show("library")); return true; }
  return false;
};

/* Going back between pages fades through, as Google Photos does: the old page goes quickly, the new one comes in. */
function backFade(go) {
  const old = $(".view.on");
  if (!old || calmMotion) { go(); return; }
  old.style.transition = "opacity 75ms linear"; old.style.opacity = "0";
  setTimeout(() => {
    old.style.transition = ""; old.style.opacity = "";
    go();
    const now = $(".view.on");
    if (now && now.animate) now.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, easing: "ease-out" });
  }, 75);
}

/* Android only offers its back-to-home preview when the app has nothing left to close. */
const canGoBack = () => !menuBackdrop.hidden || !$("#sheet").hidden || !viewer.hidden || selMode || curView !== "library" || libFilter.type !== "all";
let backEnabled = null;
function syncBack() {
  const on = canGoBack();
  if (on !== backEnabled && Native && Native.setBackEnabled) { backEnabled = on; Native.setBackEnabled(on); }
}
new MutationObserver(syncBack).observe(document.body, { attributes: true, attributeFilter: ["class", "data-view"] });
[viewer, $("#sheet"), menuBackdrop, $("#filterBar")].forEach(el => new MutationObserver(syncBack).observe(el, { attributes: true, attributeFilter: ["hidden"] }));
syncBack();

/* The viewer follows the back swipe: the picture shrinks and slides with the finger while the page shows through behind it. */
let backDrag = null, backDragAnim = 0;
const vTopEl = $("#vTop"), vBottomEl = $("#vBottom");
function backDragPaint(p) {
  if (!backDrag || !backDrag.shown) return;
  const s = 1 - 0.34 * p, dx = backDrag.dir * 0.125 * p * innerWidth, a = Math.max(0, 0.95 - 1.6 * p);
  vPages.style.transform = `translate3d(${dx}px,0,0) scale(${s})`;
  viewer.style.background = `rgba(0,0,0,${a})`;
  vTopEl.style.opacity = vBottomEl.style.opacity = String(a);
}
function backDragReveal() {
  backDrag.shown = true;
  viewer.classList.add("back-drag");
  document.body.classList.remove("viewing"); document.documentElement.classList.remove("viewing");
  vPages.style.willChange = "transform";
}
function backDragClear() {
  viewer.classList.remove("back-drag");
  viewer.style.background = "";
  vTopEl.style.opacity = vBottomEl.style.opacity = "";
  vPages.style.transform = ""; vPages.style.willChange = "";
}
function backGestureCommit() {
  backDragAnim++;
  const b = backDrag; backDrag = null;
  if (!b || !b.shown) return;
  vTopEl.style.opacity = vBottomEl.style.opacity = "";
  viewer.style.transition = "background .2s";
  viewer.style.background = "rgba(0,0,0,0)";
}
window.orbitBackSnap = url => {
  if (!backDrag || backDrag.kind !== "video" || backDrag.shown || !url) return;
  vPoster.src = url; vPoster.hidden = false;
  const go = () => { if (backDrag && !backDrag.shown) { backDragReveal(); backDragPaint(backDrag.p); } };
  if (vPoster.decode) vPoster.decode().then(go, go); else go();
};
window.orbitBackGesture = (phase, p, edge) => {
  if (phase === "start") {
    backDragAnim++; backDrag = null;
    if (viewer.hidden || viewer.classList.contains("closing") || viewer.classList.contains("editing") || !menuBackdrop.hidden || !$("#sheet").hidden || !vCur) return;
    const kind = kindOf(vCur);
    backDrag = { dir: edge === 1 ? -1 : 1, p: p || 0, shown: false, kind, playing: false };
    if (kind === "video" && Native && isPlayable(vCur)) {
      backDrag.playing = vS.playing;
      if (vS.playing) Native.playerPause();
      Native.playerSnapshot();
    } else { backDragReveal(); backDragPaint(backDrag.p); }
  } else if (phase === "move") {
    if (backDrag) { backDrag.p = p; backDragPaint(p); }
  } else if (phase === "cancel") {
    const b = backDrag; if (!b) return;
    const finish = () => {
      if (backDrag !== b) return;
      backDrag = null;
      if (b.shown) {
        backDragClear();
        document.body.classList.add("viewing"); document.documentElement.classList.add("viewing");
        if (b.kind === "video") vPoster.hidden = true;
      }
      if (b.playing && Native) Native.playerPlay();
    };
    if (!b.shown) { finish(); return; }
    const token = ++backDragAnim, from = b.p, t0 = performance.now();
    const step = now => {
      if (token !== backDragAnim) return;
      const t = Math.min(1, (now - t0) / 180), e = 1 - Math.pow(1 - t, 3);
      backDragPaint(from * (1 - e));
      if (t < 1) requestAnimationFrame(step); else finish();
    };
    requestAnimationFrame(step);
  }
};

/* ---------------- 4. Private Vault (PIN Locked + .nomedia) ---------------- */
let vaultUnlocked = false;
let vaultEnteredPin = "";
const vaultLockScreen = $("#vaultLockScreen");

function updateVaultPinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = $("#pdot" + i);
    if (dot) dot.classList.toggle("filled", i < vaultEnteredPin.length);
  }
}

/* The PIN lives in Android as a salted hash. Fingerprint or the phone's own lock opens the vault and resets a forgotten PIN. */
let vaultHasPin = false, vaultCanAuth = false, vaultNewPin = "", vaultAskedAuth = false;
async function refreshVaultState() {
  try {
    let s = await api("/api/vault/pin/status");
    let old = null; try { old = localStorage.getItem("orbit_vault_pin"); } catch {}
    if (old) {
      if (!s.hasPin) { await api("/api/vault/pin/set", { pin: old }); s = await api("/api/vault/pin/status"); }
      try { localStorage.removeItem("orbit_vault_pin"); } catch {}
    }
    vaultHasPin = !!s.hasPin; vaultCanAuth = !!s.auth;
  } catch {}
}
function paintVaultLock() {
  const creating = !vaultHasPin || vaultResetting;
  $("#vaultLockTitle").textContent = creating ? (vaultNewPin ? "Enter the PIN again" : "Choose a vault PIN") : "Private vault";
  $("#vaultLockDesc").textContent = creating ? "Pick 4 digits. Vault items are hidden from the phone gallery." : "Enter your PIN, or use your fingerprint.";
  $("#vaultBio").hidden = creating || !vaultCanAuth;
  $("#vaultForgot").hidden = creating || !vaultCanAuth;
}
let vaultResetting = false;
function vaultOpened() { vaultEnteredPin = ""; updateVaultPinDots(); vaultUnlocked = true; vaultResetting = false; vaultNewPin = ""; vaultAskedAuth = false; loadLib(); }
window.onVaultAuth = (ok, purpose) => {
  if (!ok) return;
  if (purpose === "reset") { vaultResetting = true; vaultNewPin = ""; vaultEnteredPin = ""; updateVaultPinDots(); paintVaultLock(); toast("Choose a new PIN"); }
  else { toast("Private Vault unlocked"); vaultOpened(); }
};
$("#vaultBio").onclick = () => { triggerHaptic(); api("/api/vault/auth", { purpose: "unlock" }).catch(() => {}); };
$("#vaultForgot").onclick = () => { triggerHaptic(); api("/api/vault/auth", { purpose: "reset" }).catch(() => {}); };
async function checkVaultPin() {
  const pin = vaultEnteredPin;
  vaultEnteredPin = ""; updateVaultPinDots();
  if (!vaultHasPin || vaultResetting) {
    if (!vaultNewPin) { vaultNewPin = pin; paintVaultLock(); return; }
    if (vaultNewPin !== pin) { vaultNewPin = ""; paintVaultLock(); toast("Those didn't match. Try again."); return; }
    try { await api("/api/vault/pin/set", { pin }); vaultHasPin = true; toast("Vault PIN saved"); vaultOpened(); } catch (err) { toast(err.message); }
    return;
  }
  const r = await api("/api/vault/pin/verify", { pin }).catch(() => ({ ok: false }));
  if (r.ok) { toast("Private Vault unlocked"); vaultOpened(); }
  else toast(r.wait ? `Too many tries. Wait ${r.wait} seconds.` : "Incorrect PIN");
}

$("#pinPad")?.addEventListener("click", e => {
  const b = e.target.closest(".pin-num");
  if (!b) return;
  triggerHaptic();
  const n = b.dataset.n;
  if (n === "C") {
    vaultEnteredPin = "";
    updateVaultPinDots();
  } else if (n === "X") {
    vaultEnteredPin = vaultEnteredPin.slice(0, -1);
    updateVaultPinDots();
  } else if (vaultEnteredPin.length < 4) {
    vaultEnteredPin += n;
    updateVaultPinDots();
    if (vaultEnteredPin.length === 4) {
      setTimeout(checkVaultPin, 100);
    }
  }
});

async function toggleVaultItem(id, currentVaultStatus) {
  triggerHaptic();
  try {
    const action = currentVaultStatus ? "restore" : "hide";
    await api(`/api/vault/${action}/` + id, {}, "POST");
    toast(currentVaultStatus ? "Restored to Gallery" : "Moved to Private Vault");
    loadLib();
  } catch (e) {
    toast("Vault action: " + e.message);
  }
}

/* ---------------- 5. Search (results come straight from YouTube) ---------------- */
const searchForm = $("#searchForm");
const searchInput = $("#searchInput");
const searchResults = $("#searchResults");

function searchEmpty(title, sub) {
  const box = $("#searchEmpty");
  box.hidden = false;
  box.querySelector("p").textContent = title;
  box.querySelector(".empty-sub").textContent = sub;
}

const srCardHtml = v => `
        <li class="sr-card">
          <div class="sr-thumb"><img src="${esc(v.thumb)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ""}</div>
          <div class="sr-info">
            <h4 class="sr-title">${esc(v.title)}</h4>
            <p class="sr-meta">${esc(v.uploader || "YouTube")}</p>
            <div class="sr-actions" data-url="${esc(v.url)}" data-title="${esc(v.title)}" data-thumb="${esc(v.thumb)}">
              <button type="button" class="ghost-btn primary" data-act="dl">${svg(I.dl)}<span>Download</span></button>
              <button type="button" class="ghost-btn" data-act="mp3"><span>MP3</span></button>
              <button type="button" class="ghost-btn" data-act="opts"><span>Options</span></button>
            </div>
          </div>
        </li>`;

async function runSearch(query) {
  const q = String(query || "").trim();
  if (!q) return;
  searchInput.value = q;
  searchInput.blur();
  $("#searchEmpty").hidden = true;
  $("#searchChips").hidden = true; $("#tryLabel").hidden = true;
  searchResults.innerHTML = "";
  $("#searchSkeleton").hidden = false;
  $("#searchGo").disabled = true;
  try {
    const r = await api("/api/search", { query: q });
    const list = r.results || [];
    if (!list.length) {
      searchEmpty("No results", "Try different keywords, or paste a link on the Download tab.");
    } else {
      searchResults.innerHTML = list.map(srCardHtml).join("");
    }
  } catch (err) {
    searchEmpty("Search failed", err.message || "Check your connection and try again.");
  } finally {
    $("#searchSkeleton").hidden = true;
    $("#searchGo").disabled = false;
  }
}

searchForm?.addEventListener("submit", e => { e.preventDefault(); triggerHaptic(); if (libMode) { searchInput.blur(); runLibSearch(); } else if (aiMode) aiSend(searchInput.value); else runSearch(searchInput.value); });
let libSearchSet = [], libSearchT = 0;
function runLibSearch() {
  const box = $("#libResults"), words = searchInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) { box.innerHTML = '<p class="lib-hint">Type a title or a source, like TikTok.</p>'; return; }
  libSearchSet = libAll.filter(e => !e.vault && words.every(w => (String(e.title || "") + " " + siteOf(e)).toLowerCase().includes(w))).slice(0, 120);
  box.innerHTML = libSearchSet.length
    ? `<p class="lib-hint">${libSearchSet.length} result${libSearchSet.length === 1 ? "" : "s"}</p><div class="lib-grid">` + libSearchSet.map((e, i) => `<button type="button" class="lib-hit" data-i="${i}">${thumbBox(e, 360)}<span>${esc(e.title || "")}</span></button>`).join("") + "</div>"
    : '<p class="lib-hint">Nothing in your downloads matches that.</p>';
}
searchInput?.addEventListener("input", () => { if (!libMode) return; clearTimeout(libSearchT); libSearchT = setTimeout(runLibSearch, 140); });
$("#libResults").addEventListener("click", e => { const b = e.target.closest(".lib-hit"); if (b) { triggerHaptic(); openViewer(libSearchSet, +b.dataset.i, b.getBoundingClientRect()); } });
$("#searchChips")?.addEventListener("click", e => {
  const c = e.target.closest(".chip");
  if (c) { triggerHaptic(); if (aiMode) aiSend(c.dataset.q); else runSearch(c.dataset.q); }
});
const onResultClick = async e => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const box = btn.closest(".sr-actions");
  const { url, title, thumb } = box.dataset;
  triggerHaptic();
  if (btn.dataset.act === "opts") {
    show("download");
    urlEl.value = url;
    fetchInfo();
    return;
  }
  btn.disabled = true;
  try {
    await api("/api/download", { url, title, thumb, site: "YouTube", quality: btn.dataset.act === "mp3" ? "audio" : "best" });
    btn.querySelector("span").textContent = "Queued";
    toast("Added to the download queue");
    poll();
  } catch (err) {
    btn.disabled = false;
    toast(err.message || "Couldn't start the download");
  }
};
searchResults?.addEventListener("click", onResultClick);
$("#aiThread").addEventListener("click", onResultClick);

/* ---------------- AI helper: Gemini turns your words into searches; every result is a real YouTube hit ---------------- */
let libMode = false, aiMode = false, aiHasKey = false, aiModel = "", aiBusy = false, aiHistory = [], aiLibSets = [];
const SPARK = '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>';
function paintSearchMode() {
  $$("#searchSeg button").forEach(b => b.classList.toggle("on", b.dataset.mode === (libMode ? "library" : aiMode ? "ai" : "search")));
  $("#searchInput").placeholder = libMode ? "Search your downloads" : aiMode ? "Search or ask" : "Search YouTube";
  $("#libResults").hidden = !libMode;
  if (libMode) {
    $("#aiNoKey").hidden = true; $("#aiThread").hidden = true; $("#searchResults").hidden = true; $("#searchForm").hidden = false;
    $("#searchChips").hidden = true; $("#tryLabel").hidden = true; $("#searchEmpty").hidden = true; $("#searchSkeleton").hidden = true;
    runLibSearch();
    return;
  }
  $("#tryLabel").textContent = aiMode ? "Try asking" : "Try searching";
  const needKey = aiMode && !aiHasKey;
  $("#aiNoKey").hidden = !needKey;
  $("#aiThread").hidden = !aiMode;
  const usedChips = aiMode ? aiHistory.length > 0 : $("#searchResults").children.length > 0;
  $("#searchForm").hidden = needKey; $("#searchChips").hidden = needKey || usedChips; $("#tryLabel").hidden = needKey || usedChips;
  $("#searchResults").hidden = aiMode;
  $("#searchEmpty").hidden = true;
  $("#searchSkeleton").hidden = true;
}
async function refreshAiStatus() {
  let own = false, shared = false;
  try { const s = await api("/api/ai/status"); aiHasKey = !!s.hasKey; aiModel = s.model || ""; own = !!s.ownKey; shared = !!s.shared; } catch {}
  $("#aiKeyInfo").textContent = own ? `Added · ${aiModel || "ready"} · stored only on this phone` : shared ? "Using Orbit's shared AI. Add your own key to avoid the daily limit." : "Not added. Needed for Ask AI.";
  paintSearchMode();
}
$("#searchSeg").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  triggerHaptic(); libMode = b.dataset.mode === "library"; aiMode = b.dataset.mode === "ai"; paintSearchMode();
  try { localStorage.setItem("orbit_search_mode", b.dataset.mode); } catch {}
});
function openAiKeySheet() {
  triggerHaptic();
  openMenu(`<div class="sheet-handle"></div><div class="m-title">Gemini API key</div>
    <p class="ai-key-note">Your key is checked with Google, stored only on this phone and used only for Ask AI requests. Google may bill you for usage on paid keys.</p>
    <div class="field ai-key-field"><input id="aiKeyInput" type="password" placeholder="Paste your API key" spellcheck="false" autocomplete="off"></div>
    <p class="ai-key-err" id="aiKeyErr" hidden></p>
    <div class="ai-key-btns">
      <a class="ghost-btn" href="https://aistudio.google.com/apikey">Get a key</a>
      ${aiHasKey ? '<button type="button" class="ghost-btn danger" id="aiKeyRemove">Remove</button>' : ""}
      <button type="button" class="solid" id="aiKeySave">Save</button>
    </div>`, "sheet-menu");
  $("#aiKeySave").onclick = async () => {
    const btn = $("#aiKeySave"), err = $("#aiKeyErr");
    btn.disabled = true; btn.textContent = "Checking…"; err.hidden = true;
    try { await api("/api/ai/key", { key: $("#aiKeyInput").value }); closeMenu(false); await refreshAiStatus(); toast("Gemini key saved"); }
    catch (x) { err.textContent = x.message || "That key didn't work."; err.hidden = false; btn.disabled = false; btn.textContent = "Save"; }
  };
  const rm = $("#aiKeyRemove");
  if (rm) rm.onclick = async () => { await api("/api/ai/key/remove", {}); closeMenu(false); await refreshAiStatus(); toast("Gemini key removed"); };
}
let aiLibOn = true; try { aiLibOn = localStorage.getItem("orbit_ai_lib") !== "false"; } catch {}
$("#setAiLib").checked = aiLibOn;
$("#setAiLib").onchange = e => { aiLibOn = e.target.checked; triggerHaptic(); try { localStorage.setItem("orbit_ai_lib", aiLibOn); } catch {} };
$("#rowAccounts").onclick = async () => {
  triggerHaptic();
  const sites = (await api("/api/accounts").catch(() => ({ sites: [] }))).sites || [];
  openMenu(`<div class="sheet-handle"></div><div class="m-title">Site accounts</div><p class="ai-key-note">Sign in with your own account to download what it can see. Passwords go only to the site. Orbit keeps the login cookies privately on this phone and uses them only for downloads.</p>${sites.map(s => `<button type="button" class="m-item acct" data-k="${s.signedIn ? "out" : "in"}:${s.key}"><span class="acct-name">${esc(s.name)}</span><span class="acct-state ${s.signedIn ? "on" : ""}">${s.signedIn ? "Signed in · Sign out" : "Sign in"}</span></button>`).join("")}`, "sheet-menu", async k => {
    const [act, key] = k.split(":");
    if (act === "in") await api("/api/accounts/signin", { key }).catch(err => toast(err.message));
    if (act === "out") { await api("/api/accounts/signout", { key }).catch(err => toast(err.message)); toast("Signed out"); }
  });
};
$("#rowAiKey").onclick = openAiKeySheet; $("#aiAddKey").onclick = openAiKeySheet;
function aiAdd(html, cls) {
  const d = document.createElement("div"); d.className = "ai-msg " + cls; d.innerHTML = html;
  $("#aiThread").appendChild(d);
  requestAnimationFrame(() => mainEl.scrollTo({ top: mainEl.scrollHeight, behavior: "smooth" }));
  return d;
}
async function aiSend(text) {
  const q = String(text || "").trim();
  if (!q || aiBusy) return;
  aiBusy = true; searchInput.value = ""; searchInput.blur(); $("#searchGo").disabled = true;
  $("#searchChips").hidden = true; $("#tryLabel").hidden = true;
  aiAdd(esc(q), "me");
  const wait = aiAdd(`<span class="ai-spark">${SPARK}</span><span class="ai-dots"><i></i><i></i><i></i></span>`, "ai");
  aiHistory.push({ role: "user", text: q });
  try {
    const pool = libAll.filter(e => !e.vault).slice(0, 250);
    const r = await api("/api/ai/chat", { messages: aiHistory.slice(-10), library: aiLibOn ? pool.map(e => `${e.title || ""} (${siteOf(e)})`) : [] });
    aiHistory.push({ role: "model", text: r.reply || "" });
    wait.innerHTML = `<span class="ai-spark">${SPARK}</span><div class="ai-text">${esc(r.reply || "")}</div>`;
    const kw = (r.keywords || []).map(k => String(k).toLowerCase()).filter(k => k.length > 2);
    const byNumber = aiLibOn ? (r.matches || []).map(n => pool[n]).filter(Boolean) : [];
    const local = (byNumber.length ? byNumber : kw.length ? libAll.filter(e => !e.vault && kw.some(k => String(e.title || "").toLowerCase().includes(k))) : []).slice(0, 12);
    if (local.length) {
      aiLibSets.push(local);
      aiAdd(`<h4 class="ai-sub">Already in your downloads</h4><div class="hrail ai-lib">${local.map((e, i) => `<button type="button" class="ai-thumb" data-set="${aiLibSets.length - 1}" data-i="${i}">${thumbBox(e, 384)}</button>`).join("")}</div>`, "block");
    }
    const list = r.results || [];
    if (list.length) aiAdd(`<h4 class="ai-sub">From YouTube</h4><ul class="search-results flush">${list.map(srCardHtml).join("")}</ul>`, "block");
    else if ((r.queries || []).length) aiAdd(esc(r.searchError ? "YouTube search failed: " + r.searchError : "YouTube returned nothing for that. Try different words."), "ai note");
  } catch (err) {
    aiHistory.pop();
    wait.className = "ai-msg ai note";
    wait.textContent = err.message || "The AI helper couldn't answer. Check your connection and try again.";
  } finally { aiBusy = false; $("#searchGo").disabled = false; }
}
$("#aiThread").addEventListener("click", e => {
  const t = e.target.closest(".ai-thumb"); if (!t) return;
  triggerHaptic(); openViewer(aiLibSets[+t.dataset.set], +t.dataset.i, t.getBoundingClientRect());
});

/* ---------------- 6. Share & convert sheet ---------------- */
const sheet = $("#sheet");
wirePlaylist();
function closeSheet() { sheet.hidden = true; $("#sheetBody").innerHTML = ""; }
$("#sheetClose").addEventListener("click", closeSheet);
sheet.addEventListener("click", e => { if (e.target === sheet) closeSheet(); });

/* Full-quality files can be VP9, AV1 or HEVC, which some apps can't play. Offer a compatible copy only when it matters. */
async function shareChecked(id) {
  const item = libAll.find(x => x.id === id) || (await refreshHistory()).find(x => x.id === id);
  if (!item || kindOf(item) !== "video" || item.share_ready !== false || !item.codec) return api("/api/share/" + id, {});
  const what = [item.codec, item.height ? item.height + "p" : ""].filter(Boolean).join(" · ");
  openMenu(`<div class="sheet-handle"></div><div class="m-title">${esc(what)}</div><p class="ai-key-note">Some apps, like WhatsApp, may not play this format.</p>${mi("orig", ICO.share || '<path d="M12 3v12M8 7l4-4 4 4M5 13v7h14v-7"/>', "Send the original")}${mi("copy", '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>', "Make a copy that plays everywhere")}`, "sheet-menu", async k => {
    try {
      if (k === "orig") await api("/api/share/" + id, {});
      if (k === "copy") { await api("/api/convert/" + id, { mode: "share", title: item.title || "" }); toast("Making a copy in the background. Your original stays as it is."); poll(); }
    } catch (err) { toast(err.message || "That didn't work"); }
  });
}

async function openSheet(id, title) {
  triggerHaptic();
  let item = null, apps = {};
  item = libAll.find(x => x.id === id) || (await refreshHistory()).find(x => x.id === id) || null;
  try { apps = await api("/api/apps"); } catch {}
  const isVideo = !!item && kindOf(item) === "video";

  $("#sheetTitle").textContent = "Send or convert";
  $("#sheetSub").textContent = (item && item.title) || title || "";

  let note = "";
  if (isVideo) {
    if (item.share_ready === true) {
      note = `<div class="sheet-note ok">${esc([item.codec, item.height ? item.height + "p" : ""].filter(Boolean).join(" · "))} · plays in WeChat, WhatsApp and Telegram.</div>`;
    } else if (item.codec) {
      note = `<div class="sheet-note warn">${esc([item.codec, item.height ? item.height + "p" : ""].filter(Boolean).join(" · "))} · some chat apps cannot play this. Make a share-ready copy first.</div>`;
    } else {
      note = `<div class="sheet-note">Format not checked. If a chat app cannot play this file, make a share-ready copy below.</div>`;
    }
  }
  const targets = [["wechat", "WeChat", "com.tencent.mm"], ["whatsapp", "WhatsApp", "com.whatsapp"], ["telegram", "Telegram", "org.telegram.messenger"]]
    .filter(t => apps[t[0]]);
  const appBtns = targets.map(t => `<button type="button" class="sheet-app" data-pkg="${t[2]}">${t[1]}</button>`).join("")
    + `<button type="button" class="sheet-app more" data-pkg="">More apps</button>`;
  const convert = isVideo ? `
    <div class="sheet-sep">Make a copy</div>
    <button type="button" class="sheet-opt" data-mode="share" ${item.share_ready === true ? "disabled" : ""}>
      <b>Share-ready (H.264 + AAC)</b>
      <small>${item.share_ready === true ? "This video already plays everywhere." : "Same resolution, high quality. Can take several minutes on a phone."}</small>
    </button>
    <button type="button" class="sheet-opt" data-mode="chat">
      <b>Smaller copy for chats</b>
      <small>Up to 720p with a lower bitrate, for apps that limit file size.</small>
    </button>` : "";
  $("#sheetBody").innerHTML = note + `<div class="sheet-apps">${appBtns}</div>` + convert;
  $("#sheetBody").dataset.id = id;
  sheet.hidden = false;
}

$("#sheetBody").addEventListener("click", async e => {
  const id = $("#sheetBody").dataset.id;
  const app = e.target.closest(".sheet-app");
  const opt = e.target.closest(".sheet-opt");
  triggerHaptic();
  try {
    if (app) {
      closeSheet();
      await api("/api/share/" + id, app.dataset.pkg ? { pkg: app.dataset.pkg } : {});
    } else if (opt && !opt.disabled) {
      closeSheet();
      await api("/api/convert/" + id, { mode: opt.dataset.mode, title: (libAll.find(e => e.id === id) || {}).title || "" });
      toast("Converting in the background");
      show("download");
      poll();
    }
  } catch (err) {
    toast(err.message || "That didn't work");
  }
});

/* ---------------- 7. Floating Quick Download Bubble ---------------- */
const floatBubble = $("#floatBubble");
const floatBubbleText = $("#floatBubbleText");
let lastBubbleUrl = "";

function showFloatingBubble(url) {
  if (!floatBubble || !url || url === lastBubbleUrl) return;
  lastBubbleUrl = url;
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (floatBubbleText) floatBubbleText.textContent = `Download: ${host}`;
  floatBubble.hidden = false;
  setTimeout(() => { if (floatBubble) floatBubble.hidden = true; }, 7000);
}

floatBubble?.addEventListener("click", () => {
  triggerHaptic();
  floatBubble.hidden = true;
  if (lastBubbleUrl) {
    show("download");
    urlEl.value = lastBubbleUrl;
    fetchInfo();
  }
});

/* ---------------- boot (runs once everything above is defined) ---------------- */
function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has("shot")) removeEventListener("focus", checkClip);
  if (["#library", "#settings", "#collections"].includes(location.hash)) show(location.hash.slice(1));
  aiMode = (() => { try { return localStorage.getItem("orbit_search_mode") !== "search"; } catch { return true; } })();
  try { if (localStorage.getItem("orbit_search_mode") === "library") { libMode = true; aiMode = false; } } catch {}
  refreshVaultState(); loadAlbums();
  refreshAiStatus();
  moveDockInd();
  loadNotices();
  loadSettings();
  loadDevice().then(() => { deviceSig = mediaPerm + ":" + deviceAll.length + ":" + (deviceAll[0] ? deviceAll[0].id : ""); loadLib(); });
  loadLib();
  if (params.get("open") || params.get("view")) setTimeout(() => window.onOrbitNotification(params.get("open"), params.get("view")), 300);
  if (params.get("url")) { show("download"); urlEl.value = params.get("url"); fetchInfo(); }
  else if (params.has("shared")) { show("download"); toast("Download started in background"); }
  else if (!params.has("shot")) checkClip();
}
boot();
