(() => {
  "use strict";

  const frame = document.getElementById("gameFrame");
  const VERSION = "1.0.0";
  const ACTIONS = Object.freeze({
    start: "#startBtn",
    continue: "#continueBtn",
    allow: "#allowBtn",
    reject: "#rejectBtn",
    search: "#searchBtn",
    isolate: "#isolateBtn",
    next_day: "#nextDayBtn"
  });

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function doc() {
    try { return frame.contentDocument || null; }
    catch { return null; }
  }

  function text(d, selector) {
    const el = d && d.querySelector(selector);
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function texts(d, selector) {
    return d ? [...d.querySelectorAll(selector)].map(el => el.textContent.replace(/\s+/g, " ").trim()).filter(Boolean) : [];
  }

  function active(d, id) {
    const el = d && d.getElementById(id);
    return !!el && el.classList.contains("active");
  }

  function disabled(d, selector) {
    const el = d && d.querySelector(selector);
    return !el || !!el.disabled;
  }

  function numericText(d, selector) {
    const raw = text(d, selector);
    const n = Number(raw.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function threatValue(d) {
    const width = d && d.querySelector("#threatBar")?.style?.width;
    if (!width) return null;
    const n = Number.parseFloat(width);
    return Number.isFinite(n) ? n : null;
  }

  function permit(d) {
    const out = {};
    const dl = d && d.querySelector("#permitFields");
    if (!dl) return out;
    const nodes = [...dl.children];
    for (let i = 0; i < nodes.length - 1; i += 2) {
      if (nodes[i].tagName === "DT" && nodes[i + 1].tagName === "DD") {
        out[nodes[i].textContent.trim()] = nodes[i + 1].textContent.trim();
      }
    }
    return out;
  }

  function currentPhase(d) {
    if (!d) return "loading";
    if (active(d, "startOverlay")) return "start";
    if (active(d, "dayOverlay")) {
      return /结束任期/.test(text(d, "#nextDayBtn")) ? "finished" : "report";
    }
    return "case";
  }

  function getState() {
    const d = doc();
    if (!d || !d.body) {
      return { spec: "blackgate-ai/1", adapter_version: VERSION, phase: "loading" };
    }

    const phase = currentPhase(d);
    const state = {
      spec: "blackgate-ai/1",
      adapter_version: VERSION,
      phase,
      day: numericText(d, "#dayText"),
      case_counter: text(d, "#caseCounter"),
      resources: {
        gold: numericText(d, "#goldStat"),
        security: numericText(d, "#securityStat"),
        economy: numericText(d, "#economyStat"),
        public: numericText(d, "#publicStat"),
        threat: threatValue(d),
        threat_label: text(d, "#threatStat"),
        searches: numericText(d, "#searchStat"),
        isolation_slots: numericText(d, "#cellStat")
      },
      directives: texts(d, "#directives .directive"),
      news: texts(d, "#newsFeed .news-item"),
      quota: {
        processed: text(d, "#processedQuota"),
        pressure: text(d, "#pressureText"),
        pending_events: numericText(d, "#pendingEvents")
      },
      allowed_actions: Object.entries(ACTIONS)
        .filter(([, selector]) => !disabled(d, selector))
        .map(([name]) => name)
    };

    if (phase === "case") {
      state.case = {
        id: text(d, "#caseId").replace(/^CASE\s+/, ""),
        name: text(d, "#npcName"),
        tags: texts(d, "#identityTags span"),
        status: text(d, "#riskStamp"),
        speech: text(d, "#npcSpeech"),
        document: {
          status: text(d, "#docStatus"),
          serial: text(d, "#serialCode"),
          seal: text(d, "#sealMark"),
          fields: permit(d)
        },
        statements: texts(d, "#statements .statement"),
        declared_items: texts(d, "#itemsList .item-chip"),
        search_result: text(d, "#searchReveal"),
        records: texts(d, "#recordsList .record-row"),
        relations: texts(d, "#relationsList .relation-row"),
        inspector_notes: texts(d, "#clueBoard .clue")
      };
    }

    if (phase === "report" || phase === "finished") {
      state.report = {
        title: text(d, "#reportTitle"),
        stats: texts(d, "#reportStats .report-stat"),
        delayed_events: texts(d, "#eventReport .event-line"),
        audit: texts(d, "#auditReport .audit-line"),
        comment: text(d, "#reportComment")
      };
    }

    return state;
  }

  async function waitForReady(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (doc()?.getElementById("startBtn")) return true;
      await sleep(20);
    }
    throw new Error("Game iframe did not become ready in time.");
  }

  async function act(action) {
    await waitForReady();
    const d = doc();
    const selector = ACTIONS[action];
    if (!selector) throw new Error("Unknown action: " + action);

    const button = d.querySelector(selector);
    if (!button) throw new Error("Action control not found: " + action);
    if (button.disabled) throw new Error("Action is currently disabled: " + action);

    button.click();

    if (["allow", "reject", "isolate"].includes(action)) await sleep(380);
    else await sleep(30);

    return getState();
  }

  async function setDifficulty(level) {
    await waitForReady();
    if (!["easy", "normal", "hard"].includes(level)) {
      throw new Error("Difficulty must be easy, normal, or hard.");
    }
    const d = doc();
    if (!active(d, "startOverlay")) {
      throw new Error("Difficulty can only be selected on the start screen.");
    }
    const button = d.querySelector('[data-difficulty="' + level + '"]');
    if (!button) throw new Error("Difficulty control not found.");
    button.click();
    await sleep(20);
    return getState();
  }

  async function reset(level = "normal", autoStart = true) {
    await waitForReady();
    const w = frame.contentWindow;
    w.localStorage.removeItem("blackgate_inspector_save_v1");
    w.location.reload();
    await waitForReady();
    await setDifficulty(level);
    if (autoStart) return act("start");
    return getState();
  }

  window.BlackgateAI = Object.freeze({
    version: VERSION,
    getState,
    act,
    setDifficulty,
    reset,
    waitForReady
  });

  frame.addEventListener("load", () => {
    window.dispatchEvent(new CustomEvent("blackgate-ai-ready"));
  });
})();
