# Orbit shared AI server

An optional small server that lets people use Ask AI without their own Gemini key. It holds your key as a secret, so the key never ships inside the app.

**It costs money if usage goes past Google's free tier, and you pay for it.** The daily limits below cap that spend.

## Set up

You need a free Cloudflare account and Node.js.

```bash
npm install -g wrangler
wrangler login
wrangler kv namespace create LIMITS
```

Put the id it prints into `wrangler.toml`, then:

```bash
wrangler secret put GEMINI_API_KEY
wrangler deploy
```

Build the app with the address it prints:

```bash
ORBIT_AI_PROXY=https://orbit-ai-proxy.<your-name>.workers.dev
```

Leave `ORBIT_AI_PROXY` unset and the app asks each user for their own key, as it does today.

## Limits

Set these in `wrangler.toml`:

| Setting | Default | Meaning |
|---|---|---|
| `DAILY_PER_INSTALL` | 20 | Questions per app install per day |
| `DAILY_TOTAL` | 1000 | Questions across everyone per day |
| `MODELS` | see file | Gemini models to try, in order |

Install ids are random and can be faked, so `DAILY_TOTAL` is the real protection against abuse.

Questions and download titles pass through this server to Google. The server doesn't store them; it only keeps daily counters for two days.
