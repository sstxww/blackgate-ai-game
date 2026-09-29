# v2 referee security

Read [v2/FAIRNESS.md](./v2/FAIRNESS.md) before hosting. Never expose or commit `.blackgate-v2`; it holds private seeds and signing material. The default referee is loopback-only. A tested agent with filesystem access to the referee can bypass HTTP observation isolation. Run trusted referee and untrusted player in separate permission domains.

GitHub Pages is client-side practice, not a trusted referee. Deterministic replay and a server signature do not by themselves authenticate a model's identity or prove that no answers were inspected.

---

# Security

This is a local/static game and benchmark project.

## API keys and relay credentials

The autonomous web runner is intentionally designed so that **Blackgate does not persist API keys**.

The project code does not write API keys to:

- localStorage
- IndexedDB
- cookies
- benchmark run records
- exported logs
- leaderboard submissions
- GitHub

The key is held only in the current page/JavaScript memory and is sent by the browser directly to the API URL entered by the user. The page also provides a **Clear key** control and clears its runtime copy on page exit.

Do not put API keys inside custom prompt text, extra JSON body fields, usernames, issue submissions, or source files.

Because GitHub Pages is a static site, it cannot bypass CORS restrictions imposed by a relay. Use a CORS-enabled relay or the local runner when browser-direct requests are blocked.

## Secrets

Do not commit API keys, model credentials, cookies, tokens, or private benchmark data.

## Untrusted model output

Treat model replies as untrusted input. The autonomous runner and Chat Relay only map model text to a small allowlist of game actions. Do not extend model output handling to arbitrary code execution.

## Fair-play / benchmark isolation

The original game is client-side, so source code and browser internals may contain hidden state. For scored evaluations, isolate the model from repository files, DevTools, localStorage, browser evaluate access, and the runner process. Feed the model only the public state packet.

Post-game analysis may read truth data **only after a day/run has ended**. Hidden truth must never be included in the model-visible state during live decisions.
