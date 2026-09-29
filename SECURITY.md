# Security

This is a local/static game and benchmark project.

## Secrets

Do not commit API keys, model credentials, cookies, tokens, or private benchmark data.

## Untrusted model output

Treat model replies as untrusted input. The Chat Relay parser only maps text to a small allowlist of actions; do not extend it to arbitrary code execution.

## Fair-play / benchmark isolation

The original game is client-side, so source code and browser internals may contain hidden state. For scored evaluations, isolate the model from repository files, DevTools, localStorage, browser evaluate access, and the runner process. Feed the model only the public state packet.
