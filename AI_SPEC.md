# v2 protocol

The new independent referee uses **blackgate-world/2**, port 8788 and revisioned JSON actions. See [v2 Chinese API manual](./v2/README.md#api-与重放) and [fairness boundary](./v2/FAIRNESS.md). It is not a drop-in replacement for the classic DOM adapter below.

Run classic tools with `npm run start:classic` (port 8787). The following retained specification describes **classic v1 only**.

---

# Blackgate AI Interface v1

This repository keeps the original game files unchanged and adds an external AI-facing adapter.

## Fastest interface

Run the local runner, then an AI only needs two endpoints:

- `GET /api/state`
- `POST /api/action` with `{"action":"allow"}`

Other actions are `reject`, `search`, `isolate`, and `next_day`.

The runner also records the run for post-game analysis:

- `GET /api/report` — latest postmortem when a run is finished, or current run status while it is still running.
- `GET /api/runs` — completed runs stored by the current runner browser profile.

Start a clean run with:

```http
POST /api/new
Content-Type: application/json

{"difficulty":"normal","model":"GPT-5.6 Pro","provider":"OpenAI","prompt_profile":"default"}
```

## State contract

The API returns only information visible to a normal player at that moment.

```json
{
  "spec": "blackgate-ai/1",
  "phase": "case",
  "day": 1,
  "case_counter": "1 / 12",
  "resources": {
    "gold": 120,
    "security": 72,
    "economy": 68,
    "public": 64,
    "threat": 10,
    "threat_label": "低",
    "searches": 4,
    "isolation_slots": 3
  },
  "directives": [],
  "case": {
    "id": "BG-0101-...",
    "name": "...",
    "tags": [],
    "speech": "...",
    "document": {
      "status": "表面有效",
      "serial": "...",
      "seal": "...",
      "fields": {}
    },
    "statements": [],
    "declared_items": [],
    "search_result": "",
    "records": [],
    "relations": [],
    "inspector_notes": []
  },
  "allowed_actions": ["allow", "reject", "search", "isolate"]
}
```

When `phase` is `report`, the response contains the visible day-end report and `next_day` becomes available. When the campaign is over, `phase` becomes `finished`.

## Browser-only interface

If you already control a browser, open `/ai/agent.html` and call:

```js
await window.BlackgateAI.waitForReady();
const s = window.BlackgateAI.getState();
await window.BlackgateAI.act("search");
await window.BlackgateAI.act("allow");
```

You can also call:

```js
await window.BlackgateAI.reset("normal", true);
```

## Benchmark fairness

The original game is a client-side game. Its source code and browser storage necessarily contain internal state.

For a serious model benchmark:

1. Run the browser/runner outside the model sandbox.
2. Give the model only the JSON from `/api/state`.
3. Accept from the model only one of the documented actions.
4. Do not give the model filesystem, DevTools, page-evaluate, localStorage, or repository access during a scored run.
5. Use the same difficulty and controlled seeds/case set when comparing models.

The adapter itself intentionally does not return hidden archetype, ideal action, internal danger score, or unearned search information.
