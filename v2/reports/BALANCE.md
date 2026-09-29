# v2 开发校准实测

版本 2.0.0 / world-2026-09-29.1。生成时间：2026-09-29T09:07:18.202Z。72 局，8 个公开开发种子。

**不是任何真实 AI 模型的成绩，更不是正式排行榜。**

|策略|通关|平均存活|最差存活|平均分|平均漏放率|平均无辜强制率|
|---|---:|---:|---:|---:|---:|---:|
|allow|0/8|13.63|11|46.16|100%|0%|
|reject|0/8|23.38|23|45.07|0%|100%|
|isolate|0/8|12|12|48.05|0%|100%|
|paperwork|0/8|18.75|16|50.5|65.66%|22.47%|
|any-anomaly|0/8|31.75|21|56.62|23.14%|47.12%|
|any-anomaly-reactive|1/8|34.63|24|56.02|23.76%|47.22%|
|evidence|1/8|32.38|23|61|31.7%|27.33%|
|memory|1/8|34.5|24|63.08|26.74%|27.51%|
|oracle（读取隐藏身份的可行性对照）|8/8|42|42|94.72|0%|0%|

## 解释边界

- These are transparent heuristic programs, not Astra, Pro, Jev or human experimental scores.
- The privileged oracle reads hidden identities and is ONLY a mechanical feasibility control. It must never appear on a player leaderboard.
- An observation-only baseline completing a seed shows a feasible non-cheating policy, not an optimal policy.
- Eight seeds provide wide uncertainty intervals. No claim about model ceilings or universal exploit resistance is supported.
- These development seeds are public and were used during development; new private evaluation seeds are required for model comparisons.

完整逐局结果、95% Wilson 区间与源码 SHA-256 见 [balance.json](./balance.json)。
