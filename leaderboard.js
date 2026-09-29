(() => {
  "use strict";
  const $ = id => document.getElementById(id);

  function esc(s){return String(s ?? "").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function num(v){return Number.isFinite(v) ? v : "—";}

  function sortRuns(a,b){
    return (b.days ?? 0)-(a.days ?? 0) || (b.score ?? -1)-(a.score ?? -1) || (b.avg_accuracy ?? -1)-(a.avg_accuracy ?? -1);
  }

  function row(entry, rank, source){
    return `<article class="row">
      <div class="rank">#${rank}</div>
      <div class="model"><b><a href="./model.html?name=${encodeURIComponent(entry.model || entry.participant || "Unknown")}">${esc(entry.model || entry.participant || "Unknown")}</a></b><small>${esc(entry.provider || source || "")}</small></div>
      <div class="cell">存活 <b>${num(entry.days)}</b><small>天</small></div>
      <div class="cell">分数 <b>${num(entry.score)}</b><small>/100</small></div>
      <div class="cell">准确率 <b>${num(entry.avg_accuracy)}</b><small>%</small></div>
      <div class="cell">样本 <b>${Number.isFinite(entry.samples) ? entry.samples : (source === "community" || source === "本机" ? 1 : "—")}</b><small>局</small></div>
      <div class="cell"><span class="status">${esc(entry.status || source || "")}</span></div>
      <div class="style">${(entry.style || []).map(x=>"<span>"+esc(x)+"</span>").join("")}<small>${esc(entry.note || "")}</small></div>
    </article>`;
  }

  async function loadJson(path, fallback){
    try { const r=await fetch(path,{cache:"no-store"}); if(!r.ok) throw 0; return await r.json(); }
    catch { return fallback; }
  }

  async function init(){
    const [official,community,profiles] = await Promise.all([
      loadJson("./data/leaderboard.json",{entries:[],disclaimer:""}),
      loadJson("./data/community-runs.json",{runs:[]}),
      loadJson("./data/model-profiles.json",{profiles:[]})
    ]);

    $("officialDisclaimer").textContent = official.disclaimer || "";
    $("officialRows").innerHTML = official.entries?.length
      ? official.entries.map((x,i)=>row(x,x.rank || i+1,"实验记录")).join("")
      : '<div class="empty">暂无实验榜数据</div>';

    const cruns=(community.runs || []).slice().sort(sortRuns);
    $("communityRows").innerHTML = cruns.length
      ? cruns.map((x,i)=>row(x,i+1,"community")).join("")
      : '<div class="empty">还没有社区公开成绩。完成一局后可从复盘页一键提交。</div>';

    const localRuns=window.BlackgateRunRecorder.runs().map(run=>{
      const report=run.postmortem;
      if(!report) return null;
      return {...window.BlackgateReport.leaderboardEntry(run,report),status:"local",samples:1};
    }).filter(Boolean).sort(sortRuns);
    $("localRows").innerHTML = localRuns.length
      ? localRuns.map((x,i)=>row(x,i+1,"本机")).join("")
      : '<div class="empty">这台浏览器还没有完成记录。</div>';

    $("profileRows").innerHTML = (profiles.profiles || []).map(p=>`<article class="profile">
      <h3>#${p.rank ?? "—"} · ${esc(p.model)}</h3>
      <div class="meta">样本：${p.sample_count ?? 0} · 置信度：${esc(p.confidence)} · ${esc(p.status)}</div>
      <h4>观察到的决策风格</h4><ul>${(p.observed_style||["等待数据"]).map(x=>"<li>"+esc(x)+"</li>").join("")}</ul>
      <h4>优势</h4><ul>${(p.observed_strengths||["等待数据"]).map(x=>"<li>"+esc(x)+"</li>").join("")}</ul>
      <h4>风险</h4><ul>${(p.observed_risks||["等待数据"]).map(x=>"<li>"+esc(x)+"</li>").join("")}</ul>
      <p class="meta">${esc(p.note || "")}</p>
    </article>`).join("");

    document.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",()=>{
      document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===btn));
      document.querySelectorAll(".panel").forEach(x=>x.classList.toggle("active",x.id===btn.dataset.tab));
    }));
  }
  init();
})();
