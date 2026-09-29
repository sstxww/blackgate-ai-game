# Blackgate Stateless Compatibility Gateway

This optional gateway exists only for API providers whose browser CORS/OPTIONS policy blocks the GitHub Pages client.

## Properties

- No database, KV, Durable Object, cache, analytics, or application logging.
- The provider API key is forwarded only in the current request and is never persisted by this code.
- Only HTTPS upstreams are allowed by default.
- Local/private/IP-literal targets are rejected by default.
- Upstream redirects are not followed, so an Authorization header is not redirected to another host.
- Browser origins are restricted with `ALLOWED_ORIGINS`.

Cloudflare and the upstream provider still operate their own infrastructure and may retain network/request metadata according to their own policies.

## Deploy to Cloudflare Workers

1. Install or run Wrangler with your own Cloudflare account.
2. From the repository root run:

```bash
npx wrangler deploy
```

3. Copy the resulting `https://...workers.dev` URL.
4. In Blackgate AI Challenge, open **连接帮助** and paste that URL into **兼容网关**.
5. Keep the original model-provider URL in **中转站 URL**. Do not replace it with the gateway URL.

No provider API key is stored as a Cloudflare secret; the user enters the key in the browser for each session.

## Request contract

The browser calls the gateway with:

- `X-Blackgate-Target`: sanitized provider base URL, such as `https://relay.example/v1`
- `X-Blackgate-Path`: provider API path, such as `/models` or `/chat/completions`
- the provider authorization header for the current request

The gateway forwards only an allowlist of API headers and returns CORS headers to the approved Blackgate origin.
