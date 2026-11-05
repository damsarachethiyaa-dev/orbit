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
function show(view, keepFilter) {
  triggerHaptic();
  if (typeof exitSelect === "function" && selMode) exitSelect();
  if (view === "library" && !keepFilter) libFilter = { type: "all" };
  if (view !== "library") vaultUnlocked = false;      // the vault locks again as soon as you leave it
  curView = view;
  if (view !== "settings") lastTab = view;
  document.body.dataset.view = view;
  $$(".nav-btn").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + view));
  const main = $(".main"); if (main) main.scrollTop = 0;
  moveDockInd();
  if (view === "library") loadLib();
  if (view === "collections") loadCollections();
  if (view === "settings") loadSettings();
  if (view === "search") setTimeout(() => { const i = $("#searchInput"); if (i && !i.value) i.focus(); }, 60);
}
function moveDockInd() {
  const on = document.querySelector(".dock-pill .nav-btn.on"), ind = $("#dockInd");
  if (!on) { ind.style.opacity = 0; return; }
  let n = 0;
  const step = () => { ind.style.opacity = 1; ind.style.width = on.offsetWidth + "px"; ind.style.transform = `translateX(${on.offsetLeft}px)`; if (++n < 22) requestAnimationFrame(step); };
  step();
}
$("#nav").addEventListener("click", e => { const b = e.target.closest(".nav-btn"); if (b) show(b.dataset.view); });

const pClose = $("#pClose");
if (pClose) pClose.onclick = () => { triggerHaptic(); $("#preview").hidden = true; info = null; };

/* ---------------- fetch link info ---------------- */
const urlEl = $("#url");
let info = null, fetching = false;

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
      $("#shareRow").hidden = true;
      const count = d.count || (d.imageUrls ? d.imageUrls.length : 1);
      $("#quality").innerHTML = `<option value="image">Original Resolution</option>`;
      $("#quality").disabled = false;
      $("#dl").innerHTML = `<span>${count > 1 ? `Download All Photos (${count})` : "Download Photo"}</span>${svg(I.dl)}`;
    } else {
      $("#seg").hidden = false;
      $("#dl").innerHTML = `<span>Download</span>${svg(I.dl)}`;
      $("#shareReady").checked = cfg.share_ready !== false;
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
    if (cfg && cfg.auto_download) {
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
  $("#shareRow").hidden = kind === "audio" || !!(info && info.isImage);
}

/* Quality choices come from the formats the site really offers; the hint says what will happen to the codec. */
function renderQualityOptions(keep) {
  if (!info || info.isImage) return;
  const share = $("#shareReady").checked;
  const hs = info.heights || [], top = hs[0] || 0, h264 = info.h264Max || 0;
  const opts = [];
  if (!hs.length) opts.push(["best", "Original quality"]);
  else if (share && h264) opts.push(["best", `Best · ${h264}p H.264`]);
  else if (!share) opts.push(["best", `Maximum · ${top}p${info.maxCodec ? " " + info.maxCodec : ""}`]);
  else opts.push(["best", "Best available"]);
  [2160, 1440, 1080, 720, 480].forEach(h => {
    if (!hs.some(x => x >= h)) return;
    const label = h === 2160 ? "4K (2160p)" : h + "p";
    opts.push([String(h), share && h264 && h > h264 ? `${label} · converted to H.264` : label]);
  });
  if (info.imageUrls && info.imageUrls.length > 0) opts.push(["photo", `Photos only (${info.imageUrls.length})`]);
  const prevVal = keep || $("#quality").value;
  $("#quality").innerHTML = opts.map(o => `<option value="${o[0]}">${esc(o[1])}</option>`).join("");
  if (opts.some(o => o[0] === prevVal)) $("#quality").value = prevVal;

  const modern = ["VP9", "AV1", "HEVC"].includes(info.maxCodec || "");
  $("#shareHint").textContent = share
    ? (h264 && top > h264
        ? `H.264 reaches ${h264}p on this video. Higher resolutions are converted to H.264 after download, which takes longer.`
        : "H.264 + AAC. Plays in WeChat, WhatsApp and Telegram.")
    : (modern ? `Original ${info.maxCodec} file. Some chat apps cannot play it.` : "Original file, no conversion.");
}
$("#shareReady").addEventListener("change", () => { triggerHaptic(); renderQualityOptions(); });
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
      imageUrls: isImage ? (info.imageUrls || []) : [],
      quality,
      shareReady: $("#shareReady").checked,
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
  if (ACTIVE.includes(j.state)) return b("cancel", "Cancel", I.x, "danger sq");
  const isImg = j.isImage || j.quality === "image" || j.quality === "photo";
  if (j.state === "done") return b("open", isImg ? "Open" : "Play", I.play, "primary") + b("share", "Share", I.share) + b("dismiss", "", I.x, "sq");
  if (j.quality === "convert") return b("dismiss", "", I.x, "sq");
  return b("retry", "Retry", I.retry, "primary") + b("dismiss", "", I.x, "sq");
}
function queueSub(j, isImg) {
  const pct = Math.round(j.percent || 0);
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
  if (noticesChanged) { noticesChanged = false; loadNotices(); }
  $("#qEmpty").hidden = list.length > 0;
  $("#clearDone").hidden = !list.some(j => !ACTIVE.includes(j.state));
}
let polling = false;
async function poll() {
  if (polling || document.hidden) return; polling = true;
  try { renderQueue(await api("/api/jobs")); } catch {} finally { polling = false; }
}
setInterval(poll, 800); poll();

$("#queue").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  triggerHaptic();
  const id = b.closest("li").dataset.id;
  try {
    const li = b.closest("li");
    const title = li.querySelector(".q-title")?.textContent || "Media";
    const act = b.dataset.act;
    if (act === "cancel") await api("/api/cancel/" + id, {});
    if (act === "dismiss") await api("/api/dismiss/" + id, {});
    if (act === "retry") { await api("/api/retry/" + id, {}); toast("Trying again"); }
    if (act === "open") openInAppPlayer(id, title, "video");
    if (act === "share") { await api("/api/share/" + id, {}); return; }
  } catch (err) { toast(err.message || "That file isn't there any more"); }
  poll();
});
$("#clearDone").onclick = async () => {
  triggerHaptic();
  for (const [id, li] of rows) if (!li.classList.contains("downloading") && !li.classList.contains("processing")) await api("/api/dismiss/" + id, {});
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
const siteOf = e => e.device ? "This phone" : (String(e.site || "").trim() || "Other");
const onAndroid = !!window.OrbitAndroid;
const streamUrl = id => onAndroid ? "https://orbit.local/stream/" + id : "/api/stream/" + id;
const thumbUrl = (id, s) => onAndroid ? `https://orbit.local/thumb/${id}?s=${s || 384}` : streamUrl(id);
const longDur = s => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const fmtDay = t => { const d = new Date(t * 1000); return d.toLocaleDateString("en-US", d.getFullYear() === new Date().getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }); };
const fmtClock = t => new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const yearOf = e => new Date((e.t || 0) * 1000).getFullYear();
const NOTE_ICO = '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const QBANDS = { 2160: ["4K", e => e.height >= 2160], 1080: ["1080p", e => e.height >= 1080 && e.height < 2160], 720: ["720p", e => e.height >= 720 && e.height < 1080], sd: ["SD", e => e.height > 0 && e.height < 720] };

function filterTitle(f) {
  return ({ fav: "Favorites", video: "Videos", photo: "Photos", audio: "Audio", share: "Share-ready", vault: "Vault", recent: "Recent", trash: "Trash", downloads: "Orbit downloads", onthisday: "On this day" })[f.type]
    || (f.type === "site" || f.type === "bucket" ? f.val : f.type === "by" ? `${f.val} ${f.year}` : f.type === "q" ? QBANDS[f.val][0] : "Photos");
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
    case "by": return list.filter(e => e.bucket === f.val && yearOf(e) === f.year);
    case "downloads": return list.filter(e => !e.device);
    case "q": return list.filter(QBANDS[f.val][1]);
    case "recent": return list.slice(0, 60);
    case "onthisday": return list.filter(e => { const d = new Date(e.t * 1000); return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear(); });
  }
  return list;
}

/* ----- data ----- */
function mergeLib() { libAll = historyAll.concat(deviceAll).sort((a, b) => (b.t || 0) - (a.t || 0)); updateStatus(lastActive); }
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
    if (viewer.hidden && !selMode) { if (curView === "library") renderLib(); if (curView === "collections") loadCollections(); }
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

/* ----- grid: only the cells near the screen exist, so even 50,000 items scroll at full speed ----- */
const mainEl = $(".main"), gridEl = $("#lib");
let gridLayout = [], gridRows = 1, cellSize = 100, rowFirst = [];
const gridCells = new Map();
const GAP = 2;
function computeGrid(n) {
  const out = new Array(n), used = new Set(), key = (c, r) => r * 4 + c;
  let r = 0, c = 0; rowFirst = []; gridRows = 0;
  for (let i = 0; i < n; i++) {
    while (used.has(key(c, r))) { c++; if (c > 3) { c = 0; r++; } }
    const big = i % 23 === 9 && c < 3 && !used.has(key(c + 1, r));
    used.add(key(c, r));
    if (big) { used.add(key(c + 1, r)); used.add(key(c, r + 1)); used.add(key(c + 1, r + 1)); }
    out[i] = { c, r, big };
    gridRows = Math.max(gridRows, r + (big ? 2 : 1));
    if (rowFirst[r] === undefined) rowFirst[r] = i;
    c++; if (c > 3) { c = 0; r++; }
  }
  return out;
}
function layoutGrid() {
  const W = gridEl.clientWidth || mainEl.clientWidth;
  cellSize = (W - GAP * 3) / 4;
  gridEl.style.height = (gridRows * (cellSize + GAP)) + "px";
}
function cellNode(i) {
  const e = libView[i], g = gridLayout[i], li = document.createElement("li");
  const size = g.big ? cellSize * 2 + GAP : cellSize;
  li.className = `cell${e.exists ? "" : " gone"}${sel.has(e.id) ? " sel" : ""}`;
  li.dataset.id = e.id; li.dataset.i = i;
  li.style.cssText = `width:${size}px;height:${size}px;transform:translate3d(${g.c * (cellSize + GAP)}px,${g.r * (cellSize + GAP)}px,0)`;
  const k = kindOf(e);
  li.innerHTML = thumbBox(e, g.big ? 768 : 384).replace(' loading="lazy"', "")
    + (k !== "photo" ? `<span class="cell-dur">${e.dur ? `<em>${longDur(e.dur)}</em>` : ""}<i><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg></i></span>` : "")
    + (favs.has(e.id) ? '<span class="cell-fav"><svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg></span>' : "")
    + (e.exists ? "" : '<span class="cell-gone">Missing</span>')
    + '<span class="cell-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>';
  return li;
}
function renderWindow() {
  if (curView !== "library" || gridEl.hidden || !libView.length) return;
  const top = mainEl.scrollTop - (gridEl.getBoundingClientRect().top - mainEl.getBoundingClientRect().top + mainEl.scrollTop);
  const rowH = cellSize + GAP, h = mainEl.clientHeight;
  const r0 = Math.max(0, Math.floor((top - 500) / rowH) - 1), r1 = Math.ceil((top + h + 500) / rowH);
  let a = rowFirst[r0]; if (a === undefined) a = libView.length;
  let b = libView.length;
  for (let r = r1 + 1; r < rowFirst.length; r++) if (rowFirst[r] !== undefined) { b = rowFirst[r]; break; }
  const want = new Set();
  for (let i = a; i < b; i++) want.add(i);
  for (const [i, li] of gridCells) if (!want.has(i)) { li.remove(); gridCells.delete(i); }
  for (const i of want) if (!gridCells.has(i)) { const li = cellNode(i); gridEl.appendChild(li); gridCells.set(i, li); }
}
let scrollTick = false;
mainEl.addEventListener("scroll", () => {
  if (scrollTick) return; scrollTick = true;
  requestAnimationFrame(() => { scrollTick = false; renderWindow(); fsOnScroll(); });
}, { passive: true });
addEventListener("resize", () => { if (curView === "library" && libView.length) { gridCells.forEach(li => li.remove()); gridCells.clear(); layoutGrid(); renderWindow(); } if (!viewer.hidden) syncPlayerRect(); });

/* ----- fast scroll handle, as in Google Photos ----- */
const fsEl = $("#fastScroll"), fsDate = $("#fsDate");
let fsHide = null, fsDrag = false;
function fsPlace() {
  const max = mainEl.scrollHeight - mainEl.clientHeight;
  const track = mainEl.clientHeight - 170;
  fsEl.style.transform = `translateY(${(max > 0 ? mainEl.scrollTop / max : 0) * track}px)`;
}
function fsOnScroll() {
  if (curView !== "library" || libView.length < 40) { fsEl.classList.remove("on"); return; }
  fsPlace();
  fsEl.classList.add("on");
  clearTimeout(fsHide);
  if (!fsDrag) fsHide = setTimeout(() => fsEl.classList.remove("on"), 1400);
}
fsEl.addEventListener("pointerdown", e => { fsDrag = true; fsEl.setPointerCapture(e.pointerId); fsEl.classList.add("drag"); clearTimeout(fsHide); triggerHaptic(); e.preventDefault(); });
fsEl.addEventListener("pointermove", e => {
  if (!fsDrag) return;
  const r = mainEl.getBoundingClientRect(), track = mainEl.clientHeight - 170;
  const p = Math.max(0, Math.min(1, (e.clientY - r.top - 32) / track));
  mainEl.scrollTop = p * (mainEl.scrollHeight - mainEl.clientHeight);
  const rowH = cellSize + GAP, top = mainEl.scrollTop;
  let row = Math.max(0, Math.floor((top - gridEl.offsetTop) / rowH));
  while (row > 0 && rowFirst[row] === undefined) row--;
  const it = libView[rowFirst[row] || 0];
  if (it && it.t) fsDate.textContent = new Date(it.t * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" });
});
const fsEnd = () => { fsDrag = false; fsEl.classList.remove("drag"); fsHide = setTimeout(() => fsEl.classList.remove("on"), 1400); };
fsEl.addEventListener("pointerup", fsEnd); fsEl.addEventListener("pointercancel", fsEnd);

/* ----- memories ----- */
function renderMemories(list) {
  const box = $("#memories"), cards = [], now = new Date();
  if (!list.length) { box.hidden = true; box.innerHTML = ""; return; }
  const otd = list.filter(e => { const d = new Date(e.t * 1000); return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear(); });
  if (otd.length) cards.push({ a: "On this day", b: `${now.getFullYear() - yearOf(otd[0])} year${now.getFullYear() - yearOf(otd[0]) > 1 ? "s" : ""} ago`, f: { type: "onthisday" }, cover: otd[0] });
  const dl = list.filter(e => !e.device);
  if (dl.length) cards.push({ a: "Orbit", b: "Downloads", f: { type: "downloads" }, cover: dl[0] });
  const fv = list.filter(e => favs.has(e.id));
  if (fv.length) cards.push({ a: "Your", b: "favorites", f: { type: "fav" }, cover: fv[0] });
  const by = new Map();
  list.forEach(e => { if (!e.bucket) return; const k = e.bucket + "|" + yearOf(e); if (!by.has(k)) by.set(k, []); by.get(k).push(e); });
  [...by.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6).forEach(([k, items]) => {
    const [bucket, year] = k.split("|");
    cards.push({ a: bucket, b: year, f: { type: "by", val: bucket, year: +year }, cover: items[0] });
  });
  if (!cards.length) cards.push({ a: "Recent", b: "", f: { type: "recent" }, cover: list[0] });
  box.hidden = false;
  box.innerHTML = cards.map((c, i) => {
    return `<button type="button" class="mem" data-i="${i}" style="--i:${Math.min(i, 5)}">${thumbBox(c.cover, 768)}
      <span class="mem-label"><b>${esc(c.a)}</b>${c.b ? `<b>${esc(c.b)}</b>` : ""}</span></button>`;
  }).join("");
  box._cards = cards;
}
$("#memories").addEventListener("click", e => {
  const b = e.target.closest(".mem"); if (!b) return;
  triggerHaptic(); openFilter($("#memories")._cards[+b.dataset.i].f);
});

function renderLib() {
  const f = libFilter, isVault = f.type === "vault";
  $("#filterBar").hidden = f.type === "all";
  $("#filterTitle").textContent = filterTitle(f);
  $("#permCard").hidden = !(f.type === "all" && mediaPerm !== "full" && onAndroid);
  if (mediaPerm === "partial") { $("#permTitle").textContent = "Orbit sees only the photos you picked"; $("#permSub").textContent = "Allow all to see everything on this phone."; $("#permBtn").textContent = "Manage"; }
  else { $("#permTitle").textContent = "See the photos and videos on this phone"; $("#permSub").textContent = "Orbit needs permission to show your gallery. Nothing leaves your phone."; $("#permBtn").textContent = "Allow"; }
  gridCells.forEach(li => li.remove()); gridCells.clear();
  const lock = $("#vaultLockScreen");
  if (isVault && !vaultUnlocked) {
    lock.hidden = false; gridEl.hidden = true; $("#libCount").textContent = "Locked"; $("#libEmpty").hidden = true; $("#memories").hidden = true;
    const hasPin = !!localStorage.getItem("orbit_vault_pin");
    $("#vaultLockTitle").textContent = hasPin ? "Private vault" : "Create a vault PIN";
    $("#vaultLockDesc").textContent = hasPin ? "Enter your 4-digit PIN. Vault items are hidden from the phone gallery." : "Choose a 4-digit PIN to protect videos and photos you hide.";
    return;
  }
  lock.hidden = true; gridEl.hidden = false;
  const list = applyFilter(libAll);
  libView = list;
  $("#libCount").textContent = `${list.length} item${list.length === 1 ? "" : "s"}`;
  $("#libClear").hidden = true;
  if (f.type === "all") renderMemories(list); else $("#memories").hidden = true;
  gridLayout = computeGrid(list.length);
  layoutGrid();
  renderWindow();
  const empty = !list.length;
  $("#libEmpty").hidden = !empty;
  if (empty) {
    const t = { all: ["Your photos will show up here", "Everything on this phone and everything you download shows here."], fav: ["No favorites yet", "Tap the star on any photo or video to find it here."], vault: ["Your vault is empty", "Use Add to, then Private vault, to hide items from the phone gallery."], trash: ["Trash is empty", "Items you remove stay here for 30 days, then Android deletes them."] }[f.type] || ["Nothing here yet", "Items that match will show up here."];
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
function enterSelect(id) { selMode = true; document.body.classList.add("selecting"); $("#tbNormal").hidden = true; $("#tbSelect").hidden = false; if (id) sel.add(id); updateSelUi(); }
function exitSelect() { selMode = false; sel.clear(); document.body.classList.remove("selecting"); $("#tbNormal").hidden = false; $("#tbSelect").hidden = true; gridCells.forEach(c => c.classList.remove("sel")); }
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

let pressT = null, pressX = 0, pressY = 0, longFired = false;
gridEl.addEventListener("pointerdown", e => {
  const c = e.target.closest(".cell"); if (!c) return;
  longFired = false; pressX = e.clientX; pressY = e.clientY;
  clearTimeout(pressT);
  pressT = setTimeout(() => { longFired = true; triggerHaptic(); if (!selMode) enterSelect(c.dataset.id); else toggleSel(c.dataset.id); }, 450);
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
async function loadCollections() {
  await refreshHistory();
  const list = libAll.filter(e => !e.vault);
  const rank = n => /^camera$/i.test(n) ? 0 : /^orbit$/i.test(n) ? 1 : 2;
  const buckets = groupBy(list.filter(e => e.device), e => e.bucket).sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length);
  const dl = list.filter(e => !e.device);
  let dev = buckets.map(([s, items]) => coverCard(s, items.length, items[0], `data-f="bucket" data-v="${esc(s)}"`));
  if (dl.length) dev.splice(buckets.length && rank(buckets[0][0]) === 0 ? 1 : 0, 0, coverCard("Downloads", dl.length, dl[0], 'data-f="downloads"'));
  $("#siteRail").innerHTML = dev.join("") || `<div class="rail-note">${mediaPerm === "none" ? "Allow access on the Photos tab to see your phone's folders." : "Nothing here yet."}</div>`;
  const types = [["video", "Videos", e => kindOf(e) === "video"], ["photo", "Photos", e => kindOf(e) === "photo"], ["audio", "Audio", e => kindOf(e) === "audio"], ["share", "Share-ready", e => e.share_ready === true]];
  const vaultCard = `<button type="button" class="dev-card lock-card" data-filter="vault"><div class="thumb empty-t">${'<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'}</div><span class="dc-label"><b>Vault</b></span></button>`;
  const albums = vaultCard + types.map(([t, n, fn]) => { const items = list.filter(fn); return items.length ? coverCard(n, items.length, items[0], `data-f="${t}"`) : ""; }).join("")
    + groupBy(dl, siteOf).sort((a, b) => b[1].length - a[1].length).map(([s, items]) => coverCard(s, items.length, items[0], `data-f="site" data-v="${esc(s)}"`)).join("");
  $("#albumRail").innerHTML = albums || '<div class="rail-note">Albums appear when you have items to group.</div>';
  const q = Object.entries(QBANDS).map(([k, [label, fn]]) => { const items = list.filter(e => kindOf(e) === "video" && fn(e)); return items.length ? { k, label, items } : null; }).filter(Boolean);
  $("#qualRail").previousElementSibling.hidden = !q.length;
  $("#qualRail").hidden = !q.length;
  $("#qualRail").innerHTML = q.map(o => `<button type="button" class="circ" data-f="q" data-v="${o.k}">${thumbBox(o.items[0], 384)}<span class="circ-label">${o.label}</span></button>`).join("");
  const shots = buckets.find(([n]) => /screenshot/i.test(n));
  $("#pinShots").dataset.v = shots ? shots[0] : "Screenshots";
}
$("#v-collections").addEventListener("click", e => {
  const b = e.target.closest("[data-f],[data-filter]"); if (!b) return;
  triggerHaptic();
  const t = b.dataset.f || b.dataset.filter;
  openFilter(t === "site" || t === "q" || t === "bucket" ? { type: t, val: b.dataset.v } : { type: t });
});
$("#pinAdd").onclick = () => { triggerHaptic(); show("download"); };
$("#viewAllSites").onclick = e => {
  const rail = $("#siteRail"); rail.classList.toggle("wrap");
  e.target.textContent = rail.classList.contains("wrap") ? "Show less" : "View all";
};

/* ----- top bar ----- */
$("#btnAvatar").onclick = () => show("settings");
$("#settingsBack").onclick = () => show(lastTab);
$("#rowQuality").onclick = () => {
  triggerHaptic();
  const cur = $("#setQuality").value;
  openMenu(`<div class="sheet-handle"></div><div class="m-title">Default quality</div>${Object.keys(QNAMES).sort((a, b) => (b === "best") - (a === "best") || (a === "audio") - (b === "audio") || b - a).map(k => `<button type="button" class="m-item radio ${k === cur ? "cur" : ""}" data-k="${k}"><i></i>${QNAMES[k]}</button>`).join("")}`, "sheet-menu", async k => {
    try { applySettings(await api("/api/settings", { default_quality: k })); toast("Default quality: " + QNAMES[k]); } catch (err) { toast("Couldn't save: " + err.message); }
  });
};
$("#btnAdd").onclick = () => { show("download"); setTimeout(() => urlEl.focus(), 80); };
$("#statusChip").onclick = () => show("download");
let lastJobs = [], updateReady = false, lastActive = 0;
function updateStatus(active) {
  lastActive = active;
  const n = libAll.filter(e => !e.vault).length;
  $("#scText").textContent = active ? `Downloading ${active}` : `${n.toLocaleString("en-US")} item${n === 1 ? "" : "s"}`;
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
$("#btnBell").onclick = async () => {
  triggerHaptic();
  await loadNotices();
  const active = lastJobs.filter(j => ACTIVE.includes(j.state));
  const liveHtml = active.map(j => `<button type="button" class="n-row" data-k="create"><span class="n-dot ${esc(j.state)}"></span><span class="n-copy"><b>${esc(j.title || "Download")}</b><small>${esc(queueSub(j, j.isImage || j.quality === "image"))}</small></span></button>`).join("");
  const listHtml = notices.slice(0, 40).map((n, i) => `<button type="button" class="n-row ${n.read ? "" : "unread"}" data-k="n${i}"><span class="n-dot ${esc(n.state)}"></span><span class="n-copy"><b>${esc(n.title)}</b><small>${esc(n.body)}</small><small class="n-time">${esc(agoText(n.t))}</small></span></button>`).join("");
  const has = active.length || notices.length || updateReady;
  openMenu(`<div class="sheet-handle"></div>
    <div class="m-title n-head"><span>Notifications</span>${notices.length ? '<button type="button" class="n-clear" data-k="clear">Clear all</button>' : ""}</div>
    ${noticesOn ? "" : '<button type="button" class="n-update warn" data-k="perm"><b>Alerts are off</b><small>Tap to allow Orbit notifications in Android settings</small></button>'}
    ${updateReady ? '<button type="button" class="n-update" data-k="update"><b>Orbit update available</b><small>Tap to download and install</small></button>' : ""}
    ${liveHtml}${listHtml}
    ${has ? "" : '<div class="n-empty">No notifications yet. Finished and failed downloads show up here.</div>'}
    <button type="button" class="m-item" data-k="check"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg>Check for updates</button>`, "sheet-menu", async k => {
    if (k === "update") { $("#updateBanner").hidden = false; if (/Install|Restart/.test($("#ubBtn").textContent)) applyUpdate(); else startUpdate(); }
    if (k === "check") checkUpdate(true);
    if (k === "perm") api("/api/notices/settings", {}).catch(() => {});
    if (k === "create") show("download");
    if (k === "clear") { await api("/api/notices/clear", {}); await loadNotices(); toast("Notifications cleared"); }
    if (k[0] === "n" && k !== "clear") {
      const n = notices[+k.slice(1)]; if (!n) return;
      if (n.state === "done") openInAppPlayer(n.id); else show("download");
    }
  });
  if (notices.some(n => !n.read)) { await api("/api/notices/read", {}).catch(() => {}); notices.forEach(n => { n.read = true; }); paintBell(); }
};

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
  if ($("#setShareReady")) {
    $("#setShareReady").checked = s.share_ready !== false;
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
if ($("#setShareReady")) {
  $("#setShareReady").onchange = async e => {
    try {
      applySettings(await api("/api/settings", { share_ready: e.target.checked }));
      toast(e.target.checked ? "Videos will be saved share-ready (H.264)" : "Videos keep their original codec");
    } catch (err) {
      e.target.checked = !e.target.checked;
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
let menuPick = null, menuResolve = null;
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
  if (r) { closeMenu(r.dataset.r === "1"); return; }
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
function setNeighbour(sel, e) {
  const img = $(sel + " img");
  if (e && kindOf(e) !== "audio") { if (img.dataset.id !== e.id) { img.dataset.id = e.id; img.src = thumbUrl(e.id, 768); } img.style.visibility = ""; }
  else { img.removeAttribute("data-id"); img.style.visibility = "hidden"; }
}
function showItem(i, delayNative) {
  vIdx = Math.max(0, Math.min(vList.length - 1, i));
  const e = vCur = vList[vIdx];
  if (!e) { closeViewer(); return; }
  const k = kindOf(e);
  resetZoom();
  vPages.style.transform = "";
  if (Native) Native.playerOffset(0, 0);
  $("#playerTitle").textContent = e.title || "";
  $("#vDateMain").textContent = e.t ? fmtDay(e.t) : "Saved";
  $("#vDateSub").textContent = e.t ? fmtClock(e.t) : "";
  $("#vErr").hidden = true;
  viewer.dataset.kind = k;
  viewer.classList.toggle("in-trash", !!e.trashed);
  $("#vDateSub").textContent = e.trashed && e.expires ? `Deleted forever in ${Math.max(0, Math.ceil((e.expires - Date.now() / 1000) / 86400))} days` : $("#vDateSub").textContent;
  $("#vAudio").hidden = k !== "audio";
  setNeighbour("#pgPrev", vList[vIdx - 1]);
  setNeighbour("#pgNext", vList[vIdx + 1]);
  vPoster.hidden = k === "audio";
  if (k !== "audio") {
    vPoster.src = thumbUrl(e.id, 384);       // already decoded for the grid, so the picture is there instantly
    const hi = new Image(); hi.onload = () => { if (vCur === e) vPoster.src = hi.src; }; hi.src = thumbUrl(e.id, 768);
  }
  vPhoto.hidden = true; vPhoto.removeAttribute("src");
  if (k === "photo") {
    if (Native) Native.playerStop();
    vPhoto.onload = () => { if (vCur === e) { vPhoto.hidden = false; vPoster.hidden = true; } };
    vPhoto.onerror = () => { if (vCur === e && vPoster.naturalWidth === 0) $("#vErr").hidden = false; };
    vPhoto.src = /\.gif$/i.test(e.title || "") ? streamUrl(e.id) : thumbUrl(e.id, 2400);
  } else {
    Object.assign(vS, { playing: true, pos: 0, dur: (e.dur || 0) * 1000, rate: 1, t0: performance.now(), muted: false, scrub: false });
    setIco("#vPlayIco", PAUSE_P); setIco("#vVolIco", VOL_P);
    paintSeek(true);
    const start = () => { if (Native && vCur === e) { Native.playerOpen(e.id, k === "audio"); syncPlayerRect(); } };
    if (delayNative) setTimeout(start, 240); else start();
    startSeekLoop();
  }
  paintFav();
}
function heroTransform(rect) {
  const s = stage.getBoundingClientRect(), k = rect.width / s.width;
  return `translate3d(${rect.left + rect.width / 2 - s.left - s.width / 2}px,${rect.top + rect.height / 2 - s.top - s.height / 2}px,0) scale(${k})`;
}
function openViewer(list, idx, fromRect) {
  if (!list || !list[idx]) return;
  vList = list.slice();
  viewer.hidden = false; viewer.classList.remove("hide-ui", "closing");
  document.body.classList.add("viewing"); document.documentElement.classList.add("viewing");
  if (Native) Native.viewerOpen(true);
  showItem(idx, !!fromRect);
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
    viewer.hidden = true; viewer.classList.remove("closing", "hero", "hero-bars");
    vPages.style.transition = ""; vPages.style.transform = ""; vPages.style.opacity = "";
    vPhoto.removeAttribute("src"); vPoster.removeAttribute("src"); resetZoom();
    if (libDirty && curView === "library") { libDirty = false; renderLib(); }
  }, 205);
  return true;
}
/* The queue's Play button still calls this. */
async function openInAppPlayer(id) {
  triggerHaptic();
  const list = await refreshHistory();
  const one = list.find(x => x.id === id);
  if (!one) return toast("That file isn't there any more");
  const pool = list.filter(e => !!e.vault === !!one.vault);
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
  if (ev.ev === "first") { vPoster.hidden = true; return; }
  if (ev.ev === "error") { vPoster.hidden = false; $("#vErr").hidden = false; return; }
  if (ev.ev === "state") {
    vS.playing = ev.playing; vS.pos = ev.pos; if (ev.dur) vS.dur = ev.dur; vS.rate = ev.rate || 1; vS.t0 = performance.now();
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
$("#vVol").onclick = () => { vS.muted = !vS.muted; if (Native) Native.playerMuted(vS.muted); setIco("#vVolIco", vS.muted ? MUTE_P : VOL_P); };
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
  vPages.style.transform = `translate3d(${dx}px,${dy}px,0)`;
  if (Native && isPlayable(vCur) && kindOf(vCur) === "video") Native.playerOffset(dx * devicePixelRatio, dy * devicePixelRatio);
}
function animateTo(dx0, dy0, dx1, dy1, done) {
  const t0 = performance.now(), D = 190;
  const step = now => {
    const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3);
    moveTo(dx0 + (dx1 - dx0) * e, dy0 + (dy1 - dy0) * e);
    if (p < 1) requestAnimationFrame(step); else if (done) done();
  };
  requestAnimationFrame(step);
}
stage.addEventListener("touchstart", e => {
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
    g.mode = zoom > 1 ? "pan" : Math.abs(dx) > Math.abs(dy) ? "page" : dy > 0 ? "down" : "none";
  }
  if (g.mode === "pan") { panX = g.px + dx; panY = g.py + dy; clampPan(); applyZoom(); }
  else if (g.mode === "page") {
    const edge = (dx > 0 && vIdx === 0) || (dx < 0 && vIdx === vList.length - 1);
    g.dx = edge ? dx * 0.25 : dx; moveTo(g.dx, 0);
  } else if (g.mode === "down") { g.dy = dy; moveTo(0, dy); viewer.classList.add("dragging"); }
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
      animateTo(cur.dx, 0, -go * W, 0, () => showItem(target));
    } else animateTo(cur.dx, 0, 0, 0);
  } else if (cur.mode === "down") {
    viewer.classList.remove("dragging");
    if (cur.dy > 120) closeViewer(); else animateTo(0, cur.dy, 0, 0);
  } else if (!cur.mode) {
    const now = performance.now();
    if (kindOf(vCur || {}) === "photo") {
      if (now - lastTap < 280) {
        clearTimeout(tapTimer); lastTap = 0;
        if (zoom > 1) resetZoom(); else { zoom = 2.5; applyZoom(); }
      } else { lastTap = now; tapTimer = setTimeout(() => viewer.classList.toggle("hide-ui"), 285); }
    } else viewer.classList.toggle("hide-ui");
  }
}, { passive: true });

/* ----- bottom actions ----- */
$("#vRestore").onclick = async () => { if (!vCur) return; const e = vCur; triggerHaptic(); if (await restoreItems([e])) afterRemoved(e.id); };
$("#vPurge").onclick = async () => { if (!vCur) return; const e = vCur; triggerHaptic(); if (await purgeItems([e])) afterRemoved(e.id); };
$("#vShare").onclick = async () => { if (!vCur) return; triggerHaptic(); try { await api("/api/share/" + vCur.id, {}); } catch (err) { toast(err.message || "Couldn't share"); } };
$("#vConvert").onclick = () => {
  if (!vCur) return;
  if (kindOf(vCur) !== "video") return toast("Only videos can be converted");
  openSheet(vCur.id, vCur.title);
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
    ${mi("vault", ICO.lock, e.vault ? "Restore to gallery" : "Private vault")}`, "sheet-menu", k => {
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
    ${mi("open", ICO.open, "Open with another app")}
    ${e.url ? mi("again", ICO.redo, "Download again") : ""}
    ${mi("vault", ICO.lock, e.vault ? "Restore to gallery" : "Move to private vault")}</div>`, "pop", key => {
    if (key === "info") showDetails();
    if (key === "speed") openMenu(`<div class="sheet-handle"></div><div class="m-title">Playback speed</div>${[0.5, 1, 1.25, 1.5, 2].map(s => `<button type="button" class="m-item ${vS.rate === s ? "cur" : ""}" data-k="${s}">${s === 1 ? "Normal" : s + "x"}</button>`).join("")}`, "sheet-menu", v => { vS.pos = curMs(); vS.t0 = performance.now(); vS.rate = +v; if (Native) Native.playerRate(+v); toast("Speed " + v + "x"); });
    if (key === "open") api("/api/open/" + e.id, {}).catch(err => toast(err.message || "Couldn't open"));
    if (key === "again") { closeViewer(); show("download"); urlEl.value = e.url; fetchInfo(); }
    if (key === "vault") vaultToggle(e);
  });
};

/* the Android back button / swipe-back goes through here first */
window.orbitBack = () => {
  if (!menuBackdrop.hidden) { closeMenu(false); return true; }
  if (!$("#sheet").hidden) { closeSheet(); return true; }
  if (!viewer.hidden) { closeViewer(); return true; }
  if (selMode) { exitSelect(); return true; }
  if (curView === "settings") { show(lastTab); return true; }
  if (curView === "library" && libFilter.type !== "all") { $("#filterBack").click(); return true; }
  if (curView !== "library") { show("library"); return true; }
  return false;
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

function checkVaultPin() {
  const savedPin = localStorage.getItem("orbit_vault_pin");
  if (!savedPin) {
    // First time setup
    localStorage.setItem("orbit_vault_pin", vaultEnteredPin);
    vaultUnlocked = true;
    toast("Vault PIN created successfully!");
    vaultEnteredPin = "";
    updateVaultPinDots();
    loadLib();
  } else if (vaultEnteredPin === savedPin) {
    vaultUnlocked = true;
    toast("Private Vault unlocked");
    vaultEnteredPin = "";
    updateVaultPinDots();
    loadLib();
  } else {
    toast("Incorrect PIN. Please try again.");
    vaultEnteredPin = "";
    updateVaultPinDots();
  }
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

searchForm?.addEventListener("submit", e => { e.preventDefault(); triggerHaptic(); if (aiMode) aiSend(searchInput.value); else runSearch(searchInput.value); });
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
let aiMode = false, aiHasKey = false, aiModel = "", aiBusy = false, aiHistory = [], aiLibSets = [];
const SPARK = '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>';
function paintSearchMode() {
  $$("#searchSeg button").forEach(b => b.classList.toggle("on", (b.dataset.mode === "ai") === aiMode));
  $("#searchInput").placeholder = aiMode ? "Ask for any video or song" : "Search videos or songs";
  const needKey = aiMode && !aiHasKey;
  $("#aiNoKey").hidden = !needKey;
  $("#aiThread").hidden = !aiMode;
  $("#searchForm").hidden = needKey; $("#searchChips").hidden = needKey || (aiMode && aiHistory.length > 0);
  $("#searchResults").hidden = aiMode;
  $("#searchEmpty").hidden = aiMode || $("#searchResults").children.length > 0;
  $("#searchSkeleton").hidden = true;
}
async function refreshAiStatus() {
  try { const s = await api("/api/ai/status"); aiHasKey = !!s.hasKey; aiModel = s.model || ""; } catch {}
  $("#aiKeyInfo").textContent = aiHasKey ? `Added · ${aiModel || "ready"} · stored only on this phone` : "Not added. Needed for Ask AI.";
  paintSearchMode();
}
$("#searchSeg").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  triggerHaptic(); aiMode = b.dataset.mode === "ai"; paintSearchMode();
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
  $("#searchChips").hidden = true;
  aiAdd(esc(q), "me");
  const wait = aiAdd(`<span class="ai-spark">${SPARK}</span><span class="ai-dots"><i></i><i></i><i></i></span>`, "ai");
  aiHistory.push({ role: "user", text: q });
  try {
    const r = await api("/api/ai/chat", { messages: aiHistory.slice(-10) });
    aiHistory.push({ role: "model", text: r.reply || "" });
    wait.innerHTML = `<span class="ai-spark">${SPARK}</span><div class="ai-text">${esc(r.reply || "")}</div>`;
    const kw = (r.keywords || []).map(k => String(k).toLowerCase()).filter(k => k.length > 2);
    const local = kw.length ? libAll.filter(e => !e.vault && kw.some(k => String(e.title || "").toLowerCase().includes(k))).slice(0, 10) : [];
    if (local.length) {
      aiLibSets.push(local);
      aiAdd(`<h4 class="ai-sub">Already on this phone</h4><div class="hrail ai-lib">${local.map((e, i) => `<button type="button" class="ai-thumb" data-set="${aiLibSets.length - 1}" data-i="${i}">${thumbBox(e, 384)}</button>`).join("")}</div>`, "block");
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
function closeSheet() { sheet.hidden = true; $("#sheetBody").innerHTML = ""; }
$("#sheetClose").addEventListener("click", closeSheet);
sheet.addEventListener("click", e => { if (e.target === sheet) closeSheet(); });

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
      await api("/api/convert/" + id, { mode: opt.dataset.mode });
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
  refreshAiStatus();
  moveDockInd();
  loadNotices();
  loadSettings();
  loadDevice().then(() => { deviceSig = mediaPerm + ":" + deviceAll.length + ":" + (deviceAll[0] ? deviceAll[0].id : ""); loadLib(); });
  loadLib();
  if (params.get("url")) { show("download"); urlEl.value = params.get("url"); fetchInfo(); }
  else if (params.has("shared")) { show("download"); toast("Download started in background"); }
  else if (!params.has("shot")) checkClip();
}
boot();
