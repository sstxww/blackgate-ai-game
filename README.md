# Blackgate AI Game · 地下城安全审查员 AI 版

A public AI-playable edition of **《地下城安全审查员》**.

The goal of this repository is simple: keep the existing human game intact, while adding a fast machine interface so AI models can play without screenshots, OCR, mouse coordinates, or UI hunting.

## Original game stays unchanged

The gameplay files copied from the existing desktop game are kept as-is:

- `index.html`
- `game.js`
- `data.js`
- `styles.css`
- `rules.css`
- `rules.js`

AI support lives beside the game, not inside those files.

## Two ways for AI to play

### 1. HTTP API — recommended

```bash
npm install
npx playwright install chromium
npm start
```

Then:

```bash
curl http://127.0.0.1:8787/api/state
```

Submit one action:

```bash
curl -X POST http://127.0.0.1:8787/api/action \
  -H "content-type: application/json" \
  -d "{\"action\":\"search\"}"
```

Available gameplay actions:

```text
allow
reject
search
isolate
next_day
```

Start a clean benchmark run:

```bash
curl -X POST http://127.0.0.1:8787/api/new \
  -H "content-type: application/json" \
  -d "{\"difficulty\":\"normal\"}"
```

### 2. Browser JS API

Serve the repository with any static HTTP server and open:

```text
/ai/agent.html
```

Then:

```js
const state = window.BlackgateAI.getState();
await window.BlackgateAI.act("search");
await window.BlackgateAI.act("allow");
```

## Why this is faster for AI

Normal computer-use flow:

```text
screenshot -> vision/OCR -> locate controls -> click -> screenshot again
```

AI mode:

```text
JSON state -> model decision -> one action -> next JSON state
```

This makes the game useful for model-vs-model decision benchmarks and high-volume evaluation.

## Fair-play rule

A scored AI should only see the JSON returned by the AI API. Do not give the competing model access to the repository, browser DevTools, localStorage, or the runner process, because the original game is client-side and those surfaces can contain hidden internal state.

See [AI_SPEC.md](./AI_SPEC.md) for the full contract.

## Example agent

After the API is running:

```bash
npm run agent:example
```

The included example is intentionally simple. Replace its `chooseAction()` function with a call to the model you want to benchmark.

## Design principle

**Same game. Same visible evidence. Faster interface. No hidden answer in the API response.**
