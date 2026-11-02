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
function show(view) {
  triggerHaptic();
  $$(".nav-btn").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + view));
  if (view === "library") loadLib();
  if (view === "settings") loadSettings();
  if (view === "search") setTimeout(() => { const i = $("#searchInput"); if (i && !i.value) i.focus(); }, 60);
}
$("#nav").addEventListener("click", e => { const b = e.target.closest(".nav-btn"); if (b) show(b.dataset.view); });
addEventListener("keydown", e => { if (e.ctrlKey && "123".includes(e.key)) { e.preventDefault(); show(["download", "library", "settings"][+e.key - 1]); } });

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
      setKind(cfg.default_quality === "audio" ? "audio" : "video");
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
    prev[j.id] = j.state;
  });
  const active = list.filter(j => ACTIVE.includes(j.state)).length;
  $("#qBadge").hidden = !active; $("#qBadge").textContent = active;
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
    if (act === "share") { openSheet(id, title); return; }
  } catch (err) { toast(err.message || "That file isn't there any more"); }
  poll();
});
$("#clearDone").onclick = async () => {
  triggerHaptic();
  for (const [id, li] of rows) if (!li.classList.contains("downloading") && !li.classList.contains("processing")) await api("/api/dismiss/" + id, {});
  poll();
};

/* ---------------- library ---------------- */
async function loadLib() {
  let list = [];
  try { list = await api("/api/history"); } catch {}
  if (currentLibTab === "vault") {
    if (!vaultUnlocked) {
      if (vaultLockScreen) vaultLockScreen.hidden = false;
      $("#lib").hidden = true;
      $("#libEmpty").hidden = true;
      return;
    }
    if (vaultLockScreen) vaultLockScreen.hidden = true;
    $("#lib").hidden = false;
    list = list.filter(e => e.vault === true);
  } else {
    if (vaultLockScreen) vaultLockScreen.hidden = true;
    $("#lib").hidden = false;
    list = list.filter(e => !e.vault);
  }
  $("#libCount").textContent = list.length ? `${list.length} download${list.length > 1 ? "s" : ""}` : "Saved on your device storage";
  $("#libEmpty").hidden = list.length > 0;
  if ($("#libClear")) $("#libClear").hidden = !list.length;

  $("#lib").innerHTML = list.map(e => {
    const isPhoto = e.quality === "image" || e.quality === "photo";
    const isAudio = e.quality === "audio";
    const kind = isPhoto ? "Photo" : isAudio ? "MP3" : (e.height ? e.height + "p" : (QLABEL[e.quality] || "Video"));
    const codec = !isPhoto && !isAudio && e.codec ? e.codec : "";
    const ready = !isPhoto && !isAudio && e.share_ready === true;
    return `
    <li class="lib-card ${e.exists ? "" : "gone"}" data-id="${esc(e.id)}" data-vault="${e.vault ? "true" : "false"}" data-title="${esc(e.title)}" data-photo="${isPhoto}">
      <div class="lib-card-top" data-act="player">
        <div class="lib-card-thumb">
          ${icoHtml(e.site, e.url, e.thumb)}
          <div class="lib-play-badge">${svg(I.play)}</div>
        </div>
        <div class="lib-card-info">
          <h4 class="lib-card-title">${esc(e.title)}</h4>
          <div class="lib-card-meta">
            <span class="lib-meta-pill ${e.exists ? "saved" : "missing"}">${e.exists ? "Saved" : "Missing"}</span>
            <span class="lib-meta-tag">${fmtSize(e.size)}</span>
            <span class="lib-meta-tag">${kind}</span>
            ${codec ? `<span class="lib-meta-tag">${esc(codec)}</span>` : ""}
            ${ready ? '<span class="lib-meta-tag ok">Share-ready</span>' : ""}
            ${e.vault ? '<span class="lib-meta-tag vault">Vault</span>' : ""}
          </div>
        </div>
      </div>
      <div class="lib-card-actions">
        <button class="lib-act-btn primary" data-act="player" title="${isPhoto ? "Open" : "Play"}">
          ${svg(I.play)}
          <span>${isPhoto ? "Open" : "Play"}</span>
        </button>
        <button class="lib-act-btn" data-act="share" title="Share or convert">
          ${svg(I.share)}
          <span>Share</span>
        </button>
        <button class="lib-act-btn" data-act="vault" title="${e.vault ? "Restore to the gallery" : "Hide in the private vault"}">
          ${svg(I.lock)}
          <span>${e.vault ? "Restore" : "Vault"}</span>
        </button>
        <button class="lib-act-btn danger" data-act="remove" title="Delete file">
          ${svg(I.trash)}
          <span>Delete</span>
        </button>
      </div>
    </li>`;
  }).join("");
}

$("#lib").addEventListener("click", async e => {
  const card = e.target.closest(".lib-card, li");
  if (!card) return;
  const id = card.dataset.id;
  const title = card.dataset.title || card.querySelector(".lib-card-title, .q-title")?.textContent || "Media";
  const isVault = card.dataset.vault === "true";

  const btn = e.target.closest("[data-act]");
  const act = btn ? btn.dataset.act : null;

  // If clicked top card area -> launch In-App Player!
  if (!act) return;

  triggerHaptic();
  try {
    if (act === "player") {
      if (card.dataset.photo === "true") await api("/api/open/" + id, {});
      else openInAppPlayer(id, title, "video");
      return;
    }
    if (act === "share") {
      openSheet(id, title);
      return;
    }
    if (act === "vault") {
      toggleVaultItem(id, isVault);
      return;
    }
    if (act === "show" || act === "open") {
      await api("/api/open/" + id, {});
      return;
    }
    if (act === "remove") {
      if (!confirm("Delete this file from your device? This cannot be undone.")) return;
      await api("/api/history/" + id, undefined, "DELETE");
      toast("File deleted from device");
      loadLib();
      return;
    }
  } catch (err) {
    toast("Action error: " + (err.message || "File unavailable"));
    loadLib();
  }
});
async function clearLib() {
  triggerHaptic();
  if (!confirm("Clear the list of past downloads? The files stay on your device.")) return;
  await api("/api/history", undefined, "DELETE"); loadLib(); toast("Library cleared");
}
$("#libClear").onclick = clearLib; $("#setClear").onclick = clearLib;

/* ---------------- settings ---------------- */
function applySettings(s) {
  cfg = s;
  $("#setPath").textContent = s.save_dir;
  $("#folderName").textContent = baseName(s.save_dir) || s.save_dir;
  if (window.OrbitAndroid) {
    $("#setChange").hidden = true;
    $("#setOpen").hidden = true;
  }
  const q = s.default_quality || "best";
  $("#setQuality").value = q;
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
      btn.textContent = "Unrestricted";
      btn.classList.add("primary");
      btn.disabled = true;
      if (desc) desc.textContent = "Active: WakeLock & unrestricted background downloading enabled.";
    } else {
      btn.textContent = "Allow";
      btn.classList.remove("primary");
      btn.disabled = false;
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
$("#setOpen").onclick = openFolder; $("#openFolder").onclick = openFolder;

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
const params = new URLSearchParams(location.search);
if (params.has("shot")) removeEventListener("focus", checkClip);
if (["#library", "#settings"].includes(location.hash)) show(location.hash.slice(1));
loadSettings();
if (!params.has("shared")) urlEl.focus();
if (params.get("url")) { urlEl.value = params.get("url"); fetchInfo(); }
else if (params.has("shared")) { show("download"); toast("Download started in background"); }
else if (!params.has("shot")) checkClip();

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
let isAmoled = localStorage.getItem("orbit_amoled") === "true";

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
    toast("Theme accent set to " + (chip.querySelector(".theme-label")?.textContent || currentAccent));
  });
}

const amoledToggle = $("#setAmoled");
if (amoledToggle) {
  amoledToggle.addEventListener("change", e => {
    triggerHaptic();
    isAmoled = e.target.checked;
    localStorage.setItem("orbit_amoled", isAmoled);
    applyThemeColors();
    toast(isAmoled ? "True AMOLED Black enabled" : "Standard theme enabled");
  });
}

/* ---------------- 2. In-App Media Player Modal ---------------- */
const playerModal = $("#playerModal");
const inAppVideo = $("#inAppVideo");
const playerTitle = $("#playerTitle");
let currentPlayerId = "";

function openInAppPlayer(id, title, quality) {
  triggerHaptic();
  currentPlayerId = id;
  if (playerTitle) playerTitle.textContent = title || "Now Playing";
  const streamUrl = window.OrbitAndroid ? "https://orbit.local/stream/" + id : "/api/stream/" + id;
  if (inAppVideo) {
    inAppVideo.src = streamUrl;
    inAppVideo.playbackRate = 1.0;
    $$(".speed-pill").forEach(p => p.classList.toggle("on", p.dataset.speed === "1.0"));
    inAppVideo.play().catch(() => {});
  }
  if (playerModal) playerModal.hidden = false;
}

function closeInAppPlayer() {
  triggerHaptic();
  if (inAppVideo) {
    inAppVideo.pause();
    inAppVideo.removeAttribute("src");
    inAppVideo.load();
  }
  if (playerModal) playerModal.hidden = true;
  currentPlayerId = "";
}

$("#playerCloseBtn")?.addEventListener("click", closeInAppPlayer);
$$(".speed-pill").forEach(p => {
  p.addEventListener("click", () => {
    triggerHaptic();
    const spd = parseFloat(p.dataset.speed) || 1.0;
    if (inAppVideo) inAppVideo.playbackRate = spd;
    $$(".speed-pill").forEach(x => x.classList.toggle("on", x === p));
    toast(`Speed: ${spd}x`);
  });
});

$("#playerShareBtn")?.addEventListener("click", () => {
  if (currentPlayerId) openSheet(currentPlayerId, playerTitle ? playerTitle.textContent : "");
});


/* ---------------- 4. Private Vault (PIN Locked + .nomedia) ---------------- */
let currentLibTab = "all"; // "all" or "vault"
let vaultUnlocked = false;
let vaultEnteredPin = "";
const tabLibAll = $("#tabLibAll");
const tabLibVault = $("#tabLibVault");
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

tabLibAll?.addEventListener("click", () => {
  triggerHaptic();
  currentLibTab = "all";
  tabLibAll.classList.add("on");
  tabLibVault?.classList.remove("on");
  loadLib();
});

tabLibVault?.addEventListener("click", () => {
  triggerHaptic();
  currentLibTab = "vault";
  tabLibVault.classList.add("on");
  tabLibAll?.classList.remove("on");
  loadLib();
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
      searchResults.innerHTML = list.map(v => `
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
        </li>`).join("");
    }
  } catch (err) {
    searchEmpty("Search failed", err.message || "Check your connection and try again.");
  } finally {
    $("#searchSkeleton").hidden = true;
    $("#searchGo").disabled = false;
  }
}

searchForm?.addEventListener("submit", e => { e.preventDefault(); triggerHaptic(); runSearch(searchInput.value); });
$("#searchChips")?.addEventListener("click", e => {
  const c = e.target.closest(".chip");
  if (c) { triggerHaptic(); runSearch(c.dataset.q); }
});
searchResults?.addEventListener("click", async e => {
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
});

/* ---------------- 6. Share & convert sheet ---------------- */
const sheet = $("#sheet");
function closeSheet() { sheet.hidden = true; $("#sheetBody").innerHTML = ""; }
$("#sheetClose").addEventListener("click", closeSheet);
sheet.addEventListener("click", e => { if (e.target === sheet) closeSheet(); });

async function openSheet(id, title) {
  triggerHaptic();
  let item = null, apps = {};
  try { item = (await api("/api/history")).find(x => x.id === id) || null; } catch {}
  try { apps = await api("/api/apps"); } catch {}
  const q = item ? item.quality : "";
  const isMedia = item && q !== "image" && q !== "photo";
  const isVideo = isMedia && q !== "audio";

  $("#sheetTitle").textContent = "Share";
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
