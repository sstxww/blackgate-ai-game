const base = process.env.BLACKGATE_API || "http://127.0.0.1:8787";

async function state() {
  return (await fetch(base + "/api/state")).json();
}

async function act(action) {
  return (await fetch(base + "/api/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action })
  })).json();
}

// Replace this with your model call.
// The model should receive only the object returned by /api/state.
function chooseAction(s) {
  if (s.phase === "report") return "next_day";
  if (s.phase === "finished") return null;
  if (s.phase !== "case") return "start";

  const notes = JSON.stringify(s.case?.inspector_notes || []);
  if ((s.resources?.searches ?? 0) > 0 && /矛盾|异常|重合|无法核验|过期/.test(notes)) {
    return "search";
  }
  return "allow";
}

let s = await state();
for (;;) {
  const action = chooseAction(s);
  if (!action) break;
  console.log(`day=${s.day} case=${s.case?.id || "-"} action=${action}`);
  s = await act(action);
}

console.log(JSON.stringify(s, null, 2));
