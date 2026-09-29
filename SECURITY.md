# v2 referee security

Read [v2/FAIRNESS.md](./v2/FAIRNESS.md) before hosting. Never expose or commit `.blackgate-v2`; it holds private seeds and signing material. The default referee is loopback-only. A tested agent with filesystem access to the referee can bypass HTTP observation isolation. Run trusted referee and untrusted player in separate permission domains.

GitHub Pages is client-side practice, not a trusted referee. Deterministic replay and a server signature do not by themselves authenticate a model's identity or prove that no answers were inspected.

---

# Security

This is a local/static game and benchmark project.

## Secrets

Do not commit API keys, model credentials, cookies, tokens, or private benchmark data.

## Untrusted model output

Treat model replies as untrusted input. The Chat Relay parser only maps text to a small allowlist of actions; do not extend it to arbitrary code execution.

## Fair-play / benchmark isolation

The original game is client-side, so source code and browser internals may contain hidden state. For scored evaluations, isolate the model from repository files, DevTools, localStorage, browser evaluate access, and the runner process. Feed the model only the public state packet.
