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
const I = { play: "M8 5l11 7-11 7z", folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zm-12 0V7a5 5 0 0 1 10 0v4", compress: "M4 14h6v6m10-10h-6V4m0 6 7-7M10 14l-7 7", share: "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z", x: "M6 6l12 12M18 6L6 18", trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" };

/* ---------------- views ---------------- */
let cfg = { default_quality: "best", save_dir: "" };
function show(view) {
  triggerHaptic();
  $$(".nav-btn").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + view));
  if (view === "library") loadLib();
  if (view === "settings") loadSettings();
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
      const count = d.count || (d.imageUrls ? d.imageUrls.length : 1);
      $("#quality").innerHTML = `<option value="image">Original Resolution</option>`;
      $("#quality").disabled = false;
      $("#dl").innerHTML = `<span>${count > 1 ? `Download All Photos (${count})` : "Download Photo"}</span>${svg(I.dl)}`;
    } else {
      $("#seg").hidden = false;
      $("#dl").innerHTML = `<span>Download</span>${svg(I.dl)}`;
      const hs = d.heights || [], opts = [["best", "Best available"]];
      [2160, 1440, 1080, 720, 480].forEach(h => { if (hs.some(x => x >= h)) opts.push([String(h), h === 2160 ? "4K (2160p)" : h + "p"]); });
      if (d.imageUrls && d.imageUrls.length > 0) {
        opts.push(["photo", `Photos only (${d.imageUrls.length})`]);
      }
      $("#quality").innerHTML = opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join("");
      const dq = cfg.default_quality;
      if (dq === "audio") setKind("audio"); else { setKind("video"); if (opts.some(o => o[0] === dq)) $("#quality").value = dq; }
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
  const b = (act, label, ic, cls = "") => `<button class="iconbtn ${cls}" data-act="${act}" title="${label}">${svg(ic)}${label ? `<span>${label}</span>` : ""}</button>`;
  if (j.state === "downloading" || j.state === "processing") return b("cancel", "Cancel", I.x, "danger sq");
  const isImg = j.isImage || j.quality === "image" || j.quality === "photo";
  if (j.state === "done") return b("open", isImg ? "Open" : "Play", I.play, "primary") + b("show", "Folder", I.folder) + b("dismiss", "", I.x, "sq");
  return b("dismiss", "", I.x, "sq");
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
    li.querySelector(".q-title").textContent = j.title || "Downloading…";
    const isImg = j.isImage || j.quality === "image" || j.quality === "photo";
    const q = isImg ? "Photo" : (QLABEL[j.quality] || "");
    li.querySelector(".q-sub").textContent =
      j.state === "downloading" ? `${Math.round(j.percent)}%  ·  ${j.speed || (isImg ? "saving" : "starting")}${j.eta ? "  ·  ETA " + j.eta : ""}` :
      j.state === "processing" ? "Merging and finishing…" :
      j.state === "done" ? `Saved  ·  ${fmtSize(j.size)}` :
      j.state === "cancelled" ? "Cancelled" : (j.error || "Failed");
    li.querySelector(".bar i").style.width = j.percent + "%";
    const act = li.querySelector(".q-act");
    if (act.dataset.state !== j.state) { act.innerHTML = actions(j); act.dataset.state = j.state; }
    if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
    if (prev[j.id] && prev[j.id] !== "done" && j.state === "done") toast("Saved: " + (j.title || j.file));
    if (prev[j.id] && prev[j.id] !== "error" && j.state === "error") toast("A download failed");
    prev[j.id] = j.state;
  });
  const active = list.filter(j => j.state === "downloading" || j.state === "processing").length;
  $("#qBadge").hidden = !active; $("#qBadge").textContent = active;
  $("#qEmpty").hidden = list.length > 0;
  $("#clearDone").hidden = !list.some(j => !["downloading", "processing"].includes(j.state));
}
let polling = false;
async function poll() {
  if (polling) return; polling = true;
  try { renderQueue(await api("/api/jobs")); } catch {} finally { polling = false; }
}
setInterval(poll, 800); poll();

$("#queue").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  triggerHaptic();
  const id = b.closest("li").dataset.id;
  try {
    if (b.dataset.act === "cancel") await api("/api/cancel/" + id, {});
    if (b.dataset.act === "dismiss") await api("/api/dismiss/" + id, {});
    const li = b.closest("li");
    const isVault = li.dataset.vault === "true";
    const title = li.querySelector(".q-title")?.textContent || "Media";
    if (b.dataset.act === "player") { openInAppPlayer(id, title, "video"); return; }
    if (b.dataset.act === "compress") { compressMedia(id); return; }
    if (b.dataset.act === "vault") { toggleVaultItem(id, isVault); return; }
    if (b.dataset.act === "open") await api("/api/open/" + id, {});
    if (b.dataset.act === "share") await api("/api/share/" + id, {});
    if (b.dataset.act === "show") await api("/api/reveal/" + id, {});
  } catch { toast("That file isn't there any more"); }
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
    const kind = e.quality === "image" || e.quality === "photo" ? "Photo" : (QLABEL[e.quality] || "Best");
    const isVid = kind !== "Photo" && kind !== "Audio";
    return `
    <li class="lib-card ${e.exists ? "" : "gone"}" data-id="${esc(e.id)}" data-vault="${e.vault ? "true" : "false"}" data-title="${esc(e.title)}">
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
            ${e.vault ? '<span class="lib-meta-tag vault">🔒 Vault</span>' : ""}
          </div>
        </div>
      </div>
      <div class="lib-card-actions">
        <button class="lib-act-btn primary" data-act="player" title="Play Video">
          ${svg(I.play)}
          <span>Play</span>
        </button>
        <button class="lib-act-btn" data-act="share" title="Share Media">
          ${svg(I.share)}
          <span>Share</span>
        </button>
        ${isVid ? `<button class="lib-act-btn" data-act="compress" title="Compress for WeChat / Chat Apps">
          ${svg(I.compress)}
          <span>Compress</span>
        </button>` : ""}
        <button class="lib-act-btn" data-act="vault" title="${e.vault ? "Restore to Public Gallery" : "Lock to Private Vault"}">
          ${svg(I.lock)}
          <span>${e.vault ? "Restore" : "Vault"}</span>
        </button>
        <button class="lib-act-btn danger" data-act="remove" title="Delete File">
          ${svg(I.x)}
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
  if (!act && e.target.closest(".lib-card-top")) {
    triggerHaptic();
    openInAppPlayer(id, title, "video");
    return;
  }
  if (!act) return;

  triggerHaptic();
  try {
    if (act === "player") {
      openInAppPlayer(id, title, "video");
      return;
    }
    if (act === "share") {
      await api("/api/share/" + id, {});
      return;
    }
    if (act === "compress") {
      compressMedia(id);
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
      if (!confirm("Permanently delete this file from your device storage?")) return;
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
   Orbit v1.0.17 Features: Themes, In-App Player, Vault, AI Assistant, Sniffer
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

$("#playerShareBtn")?.addEventListener("click", async () => {
  if (currentPlayerId) {
    try {
      await api("/api/share/" + currentPlayerId, {});
    } catch (e) {
      toast("Share failed: " + e.message);
    }
  }
});

$("#playerCompressBtn")?.addEventListener("click", async () => {
  if (currentPlayerId) {
    compressMedia(currentPlayerId);
  }
});

/* ---------------- 3. Compress for WeChat & Chat Apps ---------------- */
async function compressMedia(id) {
  triggerHaptic();
  toast("Compressing video for WeChat (<25MB, H.264)...");
  try {
    const res = await api("/api/compress/" + id, {}, "POST");
    toast("Video successfully compressed for WeChat!");
    loadLib();
    if (res && res.id) openInAppPlayer(res.id, res.title || "Compressed Video", "video");
  } catch (err) {
    toast("Compression note: " + (err.message || "Ready to send"));
  }
}

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

/* ---------------- 6. Real Orbit AI Assistant ---------------- */
const aiChatBox = $("#aiChatBox");
const aiInput = $("#aiInput");
const aiSendBtn = $("#aiSend");
const aiClearBtn = $("#aiClearChat");

function appendAiMessage(role, htmlContent, results = []) {
  if (!aiChatBox) return;
  const msgDiv = document.createElement("div");
  msgDiv.className = "ai-msg " + role;

  if (role === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "ai-avatar";
    avatar.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>`;
    msgDiv.appendChild(avatar);
  }

  const bubbleDiv = document.createElement("div");
  bubbleDiv.className = "ai-bubble";
  bubbleDiv.innerHTML = htmlContent;

  if (results && results.length > 0) {
    const resGrid = document.createElement("div");
    resGrid.className = "ai-result-grid";
    resGrid.innerHTML = results.map(r => `
      <div class="ai-result-card">
        <img class="ai-result-thumb" src="${esc(r.thumb)}" alt="${esc(r.title)}" onerror="this.src='/icons/youtube.svg'" loading="lazy" />
        <div class="ai-result-info">
          <div class="ai-result-title" title="${esc(r.title)}">${esc(r.title)}</div>
          <div class="ai-result-meta">
            <span>${esc(r.uploader || "YouTube")}</span>
            ${r.duration ? `<span>· ${esc(r.duration)}</span>` : ""}
          </div>
          <div class="ai-result-actions">
            <button class="ai-dl-btn primary" data-url="${esc(r.url)}" data-title="${esc(r.title)}" data-q="best">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg>
              <span>Download</span>
            </button>
            <button class="ai-dl-btn" data-url="${esc(r.url)}" data-title="${esc(r.title)}" data-q="audio">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
              <span>MP3</span>
            </button>
          </div>
        </div>
      </div>
    `).join("");
    bubbleDiv.appendChild(resGrid);
  }

  msgDiv.appendChild(bubbleDiv);
  aiChatBox.appendChild(msgDiv);
  aiChatBox.scrollTop = aiChatBox.scrollHeight;
}

async function processAiQuery(query) {
  const q = String(query || "").trim();
  if (!q) return;
  appendAiMessage("user", esc(q));
  aiChatBox.scrollTop = aiChatBox.scrollHeight;

  const thinkingMsg = document.createElement("div");
  thinkingMsg.className = "ai-msg bot";
  thinkingMsg.id = "aiThinking";
  thinkingMsg.innerHTML = `
    <div class="ai-avatar"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg></div>
    <div class="ai-bubble" style="color: var(--dim); font-style: italic;">Orbit AI is searching live...</div>
  `;
  aiChatBox.appendChild(thinkingMsg);
  aiChatBox.scrollTop = aiChatBox.scrollHeight;

  try {
    const resp = await api("/api/ai/query", { query: q });
    $("#aiThinking")?.remove();
    if (resp && resp.text) {
      appendAiMessage("bot", resp.text, resp.results || []);
    } else {
      appendAiMessage("bot", "Could not complete the search. Please try again.");
    }
  } catch (err) {
    $("#aiThinking")?.remove();
    appendAiMessage("bot", "Error connecting to Orbit AI: " + (err.message || "Network error"));
  }
  aiChatBox.scrollTop = aiChatBox.scrollHeight;
}

aiSendBtn?.addEventListener("click", () => {
  const val = aiInput?.value;
  if (!val) return;
  aiInput.value = "";
  processAiQuery(val);
});

aiInput?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    aiSendBtn?.click();
  }
});

aiClearBtn?.addEventListener("click", () => {
  triggerHaptic();
  if (aiChatBox) {
    aiChatBox.innerHTML = `
      <div class="ai-msg bot">
        <div class="ai-avatar"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg></div>
        <div class="ai-bubble">Chat cleared. Ask me to find any video, topic, or song!</div>
      </div>
    `;
  }
});

aiChatBox?.addEventListener("click", async e => {
  const sugBtn = e.target.closest(".ai-sug-chip");
  if (sugBtn) {
    triggerHaptic();
    processAiQuery(sugBtn.dataset.query);
    return;
  }

  const dlBtn = e.target.closest(".ai-dl-btn");
  if (dlBtn) {
    triggerHaptic();
    const url = dlBtn.dataset.url;
    const title = dlBtn.dataset.title;
    const quality = dlBtn.dataset.q || "best";
    if (!url) return;
    try {
      dlBtn.textContent = "Starting...";
      dlBtn.disabled = true;
      await api("/api/download", {
        url: url,
        quality: quality,
        title: title
      });
      toast("Orbit: Download started in background!");
      dlBtn.textContent = "Queued ✓";
    } catch (err) {
      toast("Download error: " + err.message);
      dlBtn.textContent = "Retry";
      dlBtn.disabled = false;
    }
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
