// Orbit shared AI server (Cloudflare Worker).
// Holds the Gemini API key as a secret, so it never ships inside the app.
// Every install gets a small daily allowance, and a global cap limits the total spend.

const MAX_BODY_BYTES = 64 * 1024;
const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash"];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function bump(env, key, ttlSeconds) {
  const n = parseInt((await env.LIMITS.get(key)) || "0", 10) + 1;
  await env.LIMITS.put(key, String(n), { expirationTtl: ttlSeconds });
  return n;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/generate") return json({ error: "Not found" }, 404);

    const install = request.headers.get("X-Orbit-Install") || "";
    if (!/^[0-9a-f-]{36}$/.test(install)) return json({ error: "Bad request" }, 400);

    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "Too large" }, 413);

    let payload;
    try { payload = JSON.parse(text); } catch { return json({ error: "Bad request" }, 400); }
    // Only what Orbit's AI helper sends, so the key can't be used for anything else.
    const clean = {
      systemInstruction: payload.systemInstruction,
      contents: payload.contents,
      generationConfig: payload.generationConfig,
    };
    if (!Array.isArray(clean.contents) || !clean.contents.length) return json({ error: "Bad request" }, 400);

    const day = new Date().toISOString().slice(0, 10);
    const perInstall = parseInt(env.DAILY_PER_INSTALL || "20", 10);
    const perDay = parseInt(env.DAILY_TOTAL || "1000", 10);
    if ((await bump(env, `i:${day}:${install}`, 172800)) > perInstall) return json({ error: "Daily limit reached" }, 429);
    if ((await bump(env, `all:${day}`, 172800)) > perDay) return json({ error: "Daily limit reached" }, 429);

    const models = (env.MODELS ? env.MODELS.split(",") : FALLBACK_MODELS).map((m) => m.trim()).filter(Boolean);
    let last = 502;
    for (const model of models) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify(clean),
      });
      if (res.ok) return new Response(await res.text(), { headers: { "Content-Type": "application/json" } });
      last = res.status;
      if (![404, 429, 500, 503].includes(res.status)) break;
    }
    return json({ error: "AI service unavailable" }, last === 429 ? 503 : 502);
  },
};
