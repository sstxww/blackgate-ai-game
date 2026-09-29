import fs from "node:fs";

const body = process.env.ISSUE_BODY || "";
const actor = process.env.ISSUE_USER || "unknown";
const issue = Number(process.env.ISSUE_NUMBER || 0);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const match = body.match(/```blackgate-run\s*([\s\S]*?)```/i);
if (!match) fail("No blackgate-run JSON block found.");

let entry;
try { entry = JSON.parse(match[1]); }
catch { fail("Invalid JSON payload."); }

const allowedDifficulty = new Set(["easy","normal","hard"]);
const allowedTypes = new Set(["ai","human"]);
const safe = s => String(s ?? "").replace(/[<>\r\n]/g, " ").trim().slice(0, 100);

if (entry.schema !== "blackgate-leaderboard/1") fail("Unsupported schema.");
if (!entry.run_id || safe(entry.run_id).length < 8) fail("Missing run_id.");
if (!allowedDifficulty.has(entry.difficulty)) fail("Invalid difficulty.");
if (!allowedTypes.has(entry.player_type)) fail("Invalid player_type.");
if (!Number.isInteger(entry.days) || entry.days < 1 || entry.days > 14) fail("Invalid days.");
if (!Number.isInteger(entry.score) || entry.score < 0 || entry.score > 100) fail("Invalid score.");
if (!Number.isFinite(entry.avg_accuracy) || entry.avg_accuracy < 0 || entry.avg_accuracy > 100) fail("Invalid accuracy.");
if (!Number.isInteger(entry.cases) || entry.cases < 1 || entry.cases > 500) fail("Invalid cases.");
if (!Number.isInteger(entry.searches) || entry.searches < 0 || entry.searches > 500) fail("Invalid searches.");

const resources = entry.final_resources || {};
for (const k of ["security","economy","public","threat"]) {
  if (!Number.isFinite(resources[k]) || resources[k] < 0 || resources[k] > 100) fail("Invalid resource: " + k);
}
if (!Number.isFinite(resources.gold) || resources.gold < -10000 || resources.gold > 10000) fail("Invalid gold.");

const path = "data/community-runs.json";
const doc = JSON.parse(fs.readFileSync(path, "utf8"));
if (!Array.isArray(doc.runs)) doc.runs = [];

if (doc.runs.some(x => x.run_id === entry.run_id)) {
  console.log("Duplicate run; nothing to add.");
  process.exit(0);
}

const cleaned = {
  run_id: safe(entry.run_id),
  participant: safe(entry.participant),
  model: safe(entry.model) || "Unknown",
  provider: safe(entry.provider),
  player_type: entry.player_type,
  difficulty: entry.difficulty,
  days: entry.days,
  score: entry.score,
  avg_accuracy: Number(entry.avg_accuracy.toFixed(1)),
  cases: entry.cases,
  searches: entry.searches,
  style: Array.isArray(entry.style) ? entry.style.map(safe).filter(Boolean).slice(0, 6) : [],
  final_resources: {
    gold: Number(resources.gold),
    security: Number(resources.security),
    economy: Number(resources.economy),
    public: Number(resources.public),
    threat: Number(resources.threat)
  },
  completed: !!entry.completed,
  source: safe(entry.source),
  ended_at: safe(entry.ended_at),
  status: "community-self-reported",
  submitted_by: safe(actor),
  github_issue: issue
};

doc.runs.push(cleaned);
doc.runs.sort((a,b) => (b.days-a.days) || (b.score-a.score) || (b.avg_accuracy-a.avg_accuracy));
doc.updated_at = new Date().toISOString();
fs.writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
console.log("Added run", cleaned.run_id);
