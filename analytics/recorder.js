(() => {
  "use strict";

  const ACTIVE_KEY = "blackgate_active_run_v1";
  const RUNS_KEY = "blackgate_runs_v1";
  const MAX_RUNS = 80;

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function ensureDay(run, day, state) {
    let row = run.days.find(x => x.day === day);
    if (!row) {
      row = {
        day,
        started_resources: clone(state?.resources || {}),
        decisions: [],
        report: null
      };
      run.days.push(row);
    }
    return row;
  }

  function parseAccuracy(comment) {
    const m = String(comment || "").match(/准确率约为\s*(\d+(?:\.\d+)?)%/);
    return m ? Number(m[1]) : null;
  }

  function start(meta = {}, state = {}) {
    const now = new Date().toISOString();
    const run = {
      schema: "blackgate-run/1",
      id: (crypto.randomUUID ? crypto.randomUUID() : "run-" + Date.now() + "-" + Math.random().toString(36).slice(2)),
      started_at: now,
      ended_at: null,
      meta: {
        player_type: meta.player_type || "ai",
        participant: meta.participant || "",
        model: meta.model || "Unknown",
        provider: meta.provider || "",
        difficulty: meta.difficulty || "normal",
        source: meta.source || "web",
        prompt_profile: meta.prompt_profile || ""
      },
      days: []
    };
    ensureDay(run, state.day || 1, state);
    writeJSON(ACTIVE_KEY, run);
    return clone(run);
  }

  function active() {
    return readJSON(ACTIVE_KEY, null);
  }

  function postgameFullAudit() {
    try {
      const frame = document.getElementById("gameFrame");
      const raw = frame?.contentWindow?.localStorage?.getItem("blackgate_inspector_save_v1");
      const internal = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(internal?.decisions)) return [];
      return internal.decisions.map(x => ({
        case_id: x.caseId || "",
        name: x.name || "",
        action: x.action || "",
        correct: !!x.correct,
        ideal: x.ideal || "",
        truth: x.truth || "",
        searched: !!x.searched
      }));
    } catch {
      return [];
    }
  }

  function captureReport(run, state) {
    if (!state || !["report","finished"].includes(state.phase)) return;
    const day = ensureDay(run, state.day || 1, state);
    if (day.report && day.report.title === state.report?.title && day.report.full_audit?.length) return;
    const fullAudit = postgameFullAudit();
    const exactAccuracy = fullAudit.length
      ? Math.round(fullAudit.filter(x => x.correct).length / fullAudit.length * 1000) / 10
      : null;
    day.report = {
      title: state.report?.title || "",
      stats: clone(state.report?.stats || []),
      delayed_events: clone(state.report?.delayed_events || []),
      audit: clone(state.report?.audit || []),
      full_audit: clone(fullAudit),
      comment: state.report?.comment || "",
      accuracy: exactAccuracy ?? parseAccuracy(state.report?.comment),
      end_resources: clone(state.resources || {})
    };
  }

  function recordAction(before, action, after) {
    let run = active();
    if (!run) {
      run = start({
        player_type: "unknown",
        model: "Unlabeled run",
        source: "web"
      }, before || after || {});
    }

    const dayNumber = before?.day || after?.day || 1;
    const day = ensureDay(run, dayNumber, before || after || {});
    const c = before?.case || {};

    day.decisions.push({
      ts: new Date().toISOString(),
      day: dayNumber,
      case_id: c.id || "",
      name: c.name || "",
      action,
      searched_before: c.status === "已搜查" || !!c.search_result,
      resources_before: clone(before?.resources || {}),
      resources_after: clone(after?.resources || {}),
      visible_flags: clone(c.inspector_notes || []),
      directives: clone(before?.directives || [])
    });

    captureReport(run, before);
    captureReport(run, after);

    if (after?.phase === "finished") {
      run.ended_at = new Date().toISOString();
      const report = window.BlackgateReport?.analyze(run, after) || null;
      run.postmortem = report;
      saveFinished(run);
      localStorage.removeItem(ACTIVE_KEY);
      window.dispatchEvent(new CustomEvent("blackgate-run-finished", { detail: { run: clone(run), report: clone(report) } }));
      return { run: clone(run), report: clone(report) };
    }

    if (action === "next_day" && after?.day) ensureDay(run, after.day, after);
    writeJSON(ACTIVE_KEY, run);
    return { run: clone(run), report: null };
  }

  function saveFinished(run) {
    const list = readJSON(RUNS_KEY, []);
    const next = [run, ...list.filter(x => x.id !== run.id)].slice(0, MAX_RUNS);
    writeJSON(RUNS_KEY, next);
  }

  function runs() {
    return readJSON(RUNS_KEY, []);
  }

  function get(id) {
    if (!id || id === "latest") return runs()[0] || null;
    return runs().find(x => x.id === id) || null;
  }

  function clearActive() {
    localStorage.removeItem(ACTIVE_KEY);
  }

  window.BlackgateRunRecorder = Object.freeze({
    start, active, recordAction, runs, get, clearActive,
    storage_keys: { active: ACTIVE_KEY, runs: RUNS_KEY }
  });
})();
