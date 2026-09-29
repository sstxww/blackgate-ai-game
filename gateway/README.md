# Blackgate Stateless Compatibility Gateway

This gateway exists for model providers whose browser CORS/OPTIONS policy blocks the GitHub Pages client.

## Properties

- No application database, KV, cache, analytics SDK, or credential store.
- Provider API keys are forwarded only for the current request and are never persisted by this code.
- Only HTTPS upstreams are allowed by default.
- Local/private/IP-literal targets are rejected by default.
- Only model API paths are accepted: `/models`, `/chat/completions`, `/responses`, `/messages`, and Gemini `generateContent`.
- Upstream redirects are not followed, so an Authorization header is not redirected to another host.
- Browser origins are restricted with `ALLOWED_ORIGINS`.
- A best-effort in-memory per-client rate limit is enabled. It is abuse protection, not a billing/auth system.

The hosting platform and the upstream model provider still operate their own infrastructure and may retain network/request metadata according to their own policies.

## Recommended public deployment: Railway

The portable Node server is `gateway/server.mjs`.

Start command:

```bash
npm run start:gateway
```

Environment variables:

```text
ALLOWED_ORIGINS=https://sstxww.github.io
ALLOW_LOCALHOST=false
ALLOW_IP_TARGETS=false
RATE_LIMIT_PER_MINUTE=240
```

Railway injects `PORT`; the server listens on it automatically. After deployment, generate a public Railway domain and use that HTTPS URL as Blackgate's public gateway.

The ordinary player does **not** need a Railway account. They still enter only their own provider URL and API key in Blackgate.

## Render / VPS

The same command works on any host with Node.js 20+:

```bash
npm run start:gateway
```

Expose the service over HTTPS and set the same environment variables above.

## Cloudflare Workers alternative

The Worker implementation remains available as `gateway/worker.mjs` with `wrangler.toml`. It uses the same request contract.

## Request contract

The browser calls the gateway with:

- `X-Blackgate-Target`: sanitized provider base URL, e.g. `https://relay.example/v1`
- `X-Blackgate-Path`: allowed provider API path
- the provider authorization header for the current request

The gateway forwards only an allowlist of model-API headers and returns CORS headers to the approved Blackgate origin.
