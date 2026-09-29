# Contributing

Thanks for helping make Blackgate AI Game a useful open benchmark.

## Principles

1. **Do not change the original game semantics casually.** The point is to preserve the same decision game while improving AI access, tooling, evaluation, and documentation.
2. **Never expose hidden truth through the player API.** No archetype, ideal action, hidden danger score, or unearned search result should appear in the AI-visible state.
3. **Reproducibility over anecdotes.** Model comparisons should use controlled conditions and report difficulty, seed/case pack, model name, prompt, and run count.
4. **Keep Chat Relay universal.** A user should be able to play with a normal chat model without Codex, API keys, or computer-use tooling.

## Good first contributions

- Fixed-seed benchmark packs
- Result/replay exporters
- Additional language translations
- Accessibility improvements
- Model adapters
- Tournament scripts
- Better metrics and visualizations

## Pull requests

Please include:
- What changed
- Why it is needed
- Whether original gameplay files changed
- How you tested it
- Any benchmark compatibility impact
