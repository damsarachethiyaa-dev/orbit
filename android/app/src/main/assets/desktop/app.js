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
};
const BRAND_KEYS = Object.keys(BRANDS).sort((a, b) => b.length - a.length);
function brand(site) {
  const k = String(site || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const hit = BRAND_KEYS.find(b => b.length <= 2 ? k === b : k.startsWith(b));   // short keys must match exactly ("x" is not "xvideos")
  return hit ? BRANDS[hit] : null;
}
const icoStyle = site => { const b = brand(site); return b ? `--i:url(/icons/${b[0]}.svg);--c:${b[1]}` : "--i:url(/desktop/video.svg);--c:#9aa0a6"; };
const icoHtml = site => `<span class="ico" style="${icoStyle(site)}"></span>`;

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
const I = { play: "M8 5l11 7-11 7z", folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", x: "M6 6l12 12M18 6L6 18", trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" };

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
    $("#pThumb").src = d.thumbnail || "";
    $("#pTitle").textContent = d.title || "Untitled video";
    $("#pSite").textContent = d.site || "Video";
    $("#pIco").style.cssText = icoStyle(d.site);
    $("#pDur").textContent = fmtTime(d.duration);
    $("#pSub").textContent = [d.uploader, d.heights && d.heights[0] ? "up to " + d.heights[0] + "p" : ""].filter(Boolean).join("  /  ");
    const hs = d.heights || [], opts = [["best", "Best available"]];
    [2160, 1440, 1080, 720, 480].forEach(h => { if (hs.some(x => x >= h)) opts.push([String(h), h === 2160 ? "4K (2160p)" : h + "p"]); });
    $("#quality").innerHTML = opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join("");
    const dq = cfg.default_quality;
    if (dq === "audio") setKind("audio"); else { setKind("video"); if (opts.some(o => o[0] === dq)) $("#quality").value = dq; }
    $("#preview").hidden = false;
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
const asUrl = t => { const w = String(t || "").trim().split(/\s+/)[0]; return /^https?:\/\/\S+$/i.test(w) ? w : ""; };
async function checkClip() {
  try {
    const u = asUrl((await api("/api/clipboard")).text);
    if (u && u !== lastClip && u !== urlEl.value.trim()) { lastClip = u; $("#clipUrl").textContent = u; $("#clip").hidden = false; }
  } catch {}
}
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
  const kind = $("#seg .on").dataset.kind, quality = kind === "audio" ? "audio" : $("#quality").value;
  $("#dl").disabled = true;
  try {
    await api("/api/download", { url: info.url, quality, title: info.title, site: info.site, thumb: info.thumbnail });
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
  if (j.state === "done") return b("open", "Play", I.play, "primary") + b("show", "Folder", I.folder) + b("dismiss", "", I.x, "sq");
  return b("dismiss", "", I.x, "sq");
}
function renderQueue(list) {
  const ul = $("#queue"), ids = new Set(list.map(j => j.id));
  for (const [id, li] of rows) if (!ids.has(id)) { li.remove(); rows.delete(id); }
  list.forEach((j, i) => {
    let li = rows.get(j.id);
    if (!li) {
      li = document.createElement("li"); li.dataset.id = j.id;
      li.innerHTML = `${icoHtml(j.site)}<div class="q-main"><p class="q-title"></p><p class="q-sub mono"></p><div class="bar"><i></i></div></div><div class="q-act"></div>`;
      rows.set(j.id, li);
    }
    li.className = "q " + j.state;
    li.querySelector(".q-title").textContent = j.title || "Downloading…";
    const q = QLABEL[j.quality] || "";
    li.querySelector(".q-sub").textContent =
      j.state === "downloading" ? `${Math.round(j.percent)}%  ·  ${j.speed || "starting"}${j.eta ? "  ·  ETA " + j.eta : ""}  ·  ${q}` :
      j.state === "processing" ? "Merging and finishing…" :
      j.state === "done" ? `Saved  ·  ${fmtSize(j.size)}  ·  ${q}` :
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
    if (b.dataset.act === "open") await api("/api/open/" + id, {});
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
  $("#libCount").textContent = list.length ? `${list.length} download${list.length > 1 ? "s" : ""}` : "Saved on your device storage";
  $("#libEmpty").hidden = list.length > 0; $("#libClear").hidden = !list.length;
  $("#lib").innerHTML = list.map(e => `
    <li class="l${e.exists ? "" : " gone"}" data-id="${esc(e.id)}">
      ${e.thumb ? `<img class="thumb" src="${esc(e.thumb)}" alt="" onerror="this.style.visibility='hidden'">` : icoHtml(e.site)}
      <div class="q-main"><p class="q-title">${esc(e.title)}</p>
        <p class="q-sub mono">${esc([e.site, QLABEL[e.quality], fmtSize(e.size), new Date(e.t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }), e.exists ? "" : "File moved or deleted"].filter(Boolean).join("  ·  "))}</p></div>
      <div class="q-act">${e.exists ? `<button class="iconbtn primary" data-act="open" title="Play">${svg(I.play)}<span>Play</span></button><button class="iconbtn" data-act="show" title="Folder">${svg(I.folder)}<span>Show</span></button>` : ""}
        <button class="iconbtn sq danger" data-act="remove" title="Remove from list">${svg(I.trash)}</button></div>
    </li>`).join("");
}
$("#lib").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  triggerHaptic();
  const id = b.closest("li").dataset.id;
  try {
    if (b.dataset.act === "open") await api("/api/open/" + id, {});
    if (b.dataset.act === "show") await api("/api/reveal/" + id, {});
    if (b.dataset.act === "remove") {
      if (!confirm("Permanently delete this video from your device storage?")) return;
      await api("/api/history/" + id, undefined, "DELETE");
      toast("Video deleted from device");
      loadLib();
    }
  } catch { toast("That file isn't there any more"); loadLib(); }
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
  const q = s.default_quality || "best";
  $("#setQuality").value = q;
  $$("#setQualityGrid .q-chip").forEach(c => {
    c.classList.toggle("on", c.dataset.val === q || (q === "2160" && c.dataset.val === "best"));
  });
}
async function loadSettings() {
  try {
    const s = await api("/api/settings");
    applySettings(s);
    if ($("#aAppVer")) $("#aAppVer").textContent = "v" + (s.version || "1.0.2");
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
const openFolder = () => api("/api/open-folder", {}).catch(() => toast("Couldn't open the folder"));
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

  btn.disabled = true;
  btn.textContent = "Downloading...";
  meter.hidden = false;

  try {
    await api("/api/update/download", {}, "POST");
    clearInterval(updatePoll);
    updatePoll = setInterval(async () => {
      try {
        const s = await api("/api/update/status");
        if (s.downloading) {
          fill.style.width = (s.download_percent || 0) + "%";
          stat.textContent = (s.download_percent || 0) + "%";
          btn.textContent = s.download_speed ? `Downloading (${s.download_speed})` : "Downloading...";
        } else if (s.ready_to_install) {
          clearInterval(updatePoll);
          fill.style.width = "100%";
          stat.textContent = "100%";
          btn.disabled = false;
          btn.textContent = "Restart & Install";
          toast("Update downloaded! Click Restart to finish.");
        } else if (s.error) {
          clearInterval(updatePoll);
          btn.disabled = false;
          btn.textContent = "Retry Update";
          toast("Update failed: " + s.error);
        }
      } catch (e) {
        clearInterval(updatePoll);
      }
    }, 300);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Update Now";
    meter.hidden = true;
    toast("Could not start update: " + err.message);
  }
}

async function applyUpdate() {
  const btn = $("#ubBtn");
  btn.disabled = true;
  btn.textContent = "Restarting...";
  try {
    toast("Restarting Orbit to apply update...");
    await api("/api/update/apply", {}, "POST");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Restart & Install";
    toast("Failed to restart: " + err.message);
  }
}

$("#ubBtn").addEventListener("click", () => {
  if ($("#ubBtn").textContent.includes("Restart")) {
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
  $("#updateBanner").hidden = false;
  startUpdate();
});

/* ---------------- start up ---------------- */
// optional deep links: #library / #settings open a screen, ?url=... fetches a link,
// ?shot turns off the clipboard prompt (used for README screenshots)
const params = new URLSearchParams(location.search);
if (params.has("shot")) removeEventListener("focus", checkClip);
if (["#library", "#settings"].includes(location.hash)) show(location.hash.slice(1));
loadSettings();
urlEl.focus();
if (params.get("url")) { urlEl.value = params.get("url"); fetchInfo(); }
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
