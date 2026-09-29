# v2 development

Run `npm run check`, `npm test` and relevant browser/calibration tests. Any engine/content change requires a version bump and freshly generated source hashes/results. Keep classic game files intact unless a change explicitly targets classic mode. New clues must have meaningful benign alternatives; do not add hidden verdict labels to live observations. Do not publish private evaluation seeds or referee keys.

Calibration policies are transparent controls, not model leaderboard entries. Public development instances are generated examples, not hand-authored independent questions.

---

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
