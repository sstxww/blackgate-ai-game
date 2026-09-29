(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const SYSTEM_PROMPT = `你正在玩《地下城安全审查员 / Blackgate AI Game》。

目标：尽可能完成 14 天任期，同时维持城库、治安、经济、民意，并控制渗透警戒。

你只能根据我每回合提供的“玩家可见信息”判断。不要要求源码、隐藏身份、正确答案、ideal action、localStorage、DevTools 或其他作弊信息。

四种案件操作：
- allow / 放行：允许入城。
- reject / 拒绝：不让入城，适合伪证、走私、通缉、间谍、逃兵等。
- search / 搜查：消耗搜查令，追加隐藏检查结果；搜查后仍需再次做最终决定。
- isolate / 隔离：占用隔离位，适合伪装怪物、传染病、危险诅咒等高危目标。

原则：
1. 先读当天审查令，它会改变证据权重。
2. 单一异常不是铁证，优先寻找两类以上互相印证的证据。
3. 搜查令与隔离位有限，要考虑机会成本。
4. 不要过度执法：误拒与误隔离会伤害经济和民意。
5. 不要过度放行：漏掉高危目标会伤害治安并提高警戒。
6. 日结阶段 action 必须是 next_day。
7. 游戏结束时停止。

每回合请只返回以下格式：
ACTION: allow|reject|search|isolate|next_day
REASON: 用不超过两句话说明依据

不要输出多个候选动作。不要自己假设未提供的信息。`;

  function compactState(s) {
    return JSON.stringify(s, null, 2);
  }

  function turnPacket() {
    const s = window.BlackgateAI?.getState?.();
    if (!s) return "游戏接口尚未就绪。";
    return `[BLACKGATE_STATE]\n${compactState(s)}\n\n请选择唯一动作，并严格按 ACTION / REASON 格式回复。`;
  }

  function fullPacket() {
    return SYSTEM_PROMPT + "\n\n" + turnPacket();
  }

  function setStatus(message, tone = "") {
    $("status").textContent = message;
    $("status").className = "status " + tone;
  }

  async function copy(text) {
    await navigator.clipboard.writeText(text);
    setStatus("已复制", "ok");
    setTimeout(() => setStatus("等待 AI 回复"), 1200);
  }

  function refresh() {
    $("systemPrompt").value = SYSTEM_PROMPT;
    $("turnPrompt").value = turnPacket();
  }

  function parseAction(raw) {
    const s = (raw || "").trim().toLowerCase();

    const single = s.match(/^([arsin])(?:\s|$)/i);
    if (single) {
      return ({ a:"allow", r:"reject", s:"search", i:"isolate", n:"next_day" })[single[1].toLowerCase()];
    }

    const patterns = [
      ["next_day", /\bnext[_ -]?day\b|下一天|次日|继续下一天|领取次日/],
      ["isolate", /\bisolate\b|隔离/],
      ["search", /\bsearch\b|搜查|检查/],
      ["reject", /\breject\b|拒绝|遣返/],
      ["allow", /\ballow\b|放行|允许入城/]
    ];

    const explicit = s.match(/action\s*[:：]\s*([a-z_-]+)/i);
    if (explicit) {
      const key = explicit[1].replace("-", "_");
      if (["allow","reject","search","isolate","next_day"].includes(key)) return key;
    }

    for (const [action, regex] of patterns) if (regex.test(s)) return action;
    return null;
  }

  async function applyReply() {
    const action = parseAction($("aiReply").value);
    if (!action) return setStatus("无法识别动作", "bad");

    const state = window.BlackgateAI.getState();
    if (!state.allowed_actions.includes(action)) {
      return setStatus(`当前不能执行 ${action}`, "bad");
    }

    try {
      setStatus(`执行：${action}…`);
      const before = state;
      const after = await window.BlackgateAI.act(action);
      const recorded = window.BlackgateRunRecorder?.recordAction(before, action, after);
      if (recorded?.report) {
        $("reportLink").href = "./report.html?id=" + encodeURIComponent(recorded.run.id);
        $("reportLink").hidden = false;
      }
      $("aiReply").value = "";
      refresh();
      setStatus(`已执行：${action}`, "ok");
    } catch (err) {
      setStatus(err?.message || String(err), "bad");
    }
  }

  $("newGameBtn").addEventListener("click", async () => {
    try {
      setStatus("正在创建新局…");
      const state = await window.BlackgateAI.reset($("difficultySelect").value, true);
      window.BlackgateRunRecorder?.start({
        player_type: "ai",
        participant: "",
        model: $("modelNameInput").value.trim() || "Unknown AI",
        provider: $("providerInput").value.trim() || "",
        difficulty: $("difficultySelect").value,
        source: "chat-relay",
        prompt_profile: "default-chat-relay"
      }, state);
      $("reportLink").hidden = true;
      refresh();
      setStatus("新局已开始并开始记录", "ok");
    } catch (err) {
      setStatus(err?.message || String(err), "bad");
    }
  });

  $("copySystemBtn").addEventListener("click", () => copy(SYSTEM_PROMPT));
  $("copyTurnBtn").addEventListener("click", () => copy(turnPacket()));
  $("copyFullBtn").addEventListener("click", () => copy(fullPacket()));
  $("refreshBtn").addEventListener("click", refresh);
  $("applyBtn").addEventListener("click", applyReply);

  window.addEventListener("blackgate-ai-ready", refresh);
  window.addEventListener("blackgate-run-finished", e => {
    $("reportLink").href = "./report.html?id=" + encodeURIComponent(e.detail.run.id);
    $("reportLink").hidden = false;
    setStatus("本局结束：复盘报告已生成", "ok");
  });
  setInterval(() => {
    if (window.BlackgateAI) refresh();
  }, 1200);

  refresh();
})();
