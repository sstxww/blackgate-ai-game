(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const model=new URLSearchParams(location.search).get("name") || "";
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const avg=(arr,key)=>arr.length?arr.reduce((s,x)=>s+(Number(x[key])||0),0)/arr.length:0;
  const fmt=n=>Number.isFinite(n)?Number(n.toFixed(1)):"—";

  async function getJson(path,fallback){try{const r=await fetch(path,{cache:"no-store"});if(!r.ok)throw 0;return await r.json()}catch{return fallback}}

  function localEntries(){
    return window.BlackgateRunRecorder.runs().map(run=>{
      if(!run.postmortem)return null;
      const e=window.BlackgateReport.leaderboardEntry(run,run.postmortem);
      return {...e,status:"local",report_id:run.id,details:run.postmortem};
    }).filter(Boolean);
  }

  function commonStyles(runs){
    const m=new Map();
    runs.flatMap(x=>x.style||[]).forEach(s=>m.set(s,(m.get(s)||0)+1));
    return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([s,n])=>`${s}（${n}次）`);
  }

  function runRow(r){
    return `<article class="run">
      <div><b>${esc(r.model||"Unknown")}</b><small>${esc(r.status||r.source||"")}</small></div>
      <div>存活 <b>${r.days??"—"}</b><small>天</small></div>
      <div>分数 <b>${r.score??"—"}</b></div>
      <div>准确率 <b>${Number.isFinite(r.avg_accuracy) && r.avg_accuracy>0 ? r.avg_accuracy+"%" : "—"}</b></div>
      <div>案件 <b>${Number.isFinite(r.cases) && r.cases>0 ? r.cases : "—"}</b></div>
      <div>${(r.style||[]).map(x=>'<span class="pill">'+esc(x)+'</span>').join("")}</div>
    </article>`;
  }

  async function init(){
    if(!model){$("empty").hidden=false;return}
    $("title").textContent=model+" · 决策档案";
    $("subtitle").textContent="随着运行样本增加，这个页面会从单局观察逐步变成长期行为画像。";

    const [profiles,community,official]=await Promise.all([
      getJson("./data/model-profiles.json",{profiles:[]}),
      getJson("./data/community-runs.json",{runs:[]}),
      getJson("./data/leaderboard.json",{entries:[]})
    ]);

    const profile=(profiles.profiles||[]).find(x=>x.model.toLowerCase()===model.toLowerCase())||null;
    const publicRuns=(community.runs||[]).filter(x=>(x.model||"").toLowerCase()===model.toLowerCase());
    const local=localEntries().filter(x=>(x.model||"").toLowerCase()===model.toLowerCase());
    const officialRows=(official.entries||[]).filter(x=>(x.model||"").toLowerCase()===model.toLowerCase())
      .filter(x=>Number.isFinite(x.days)||Number.isFinite(x.score))
      .map(x=>({...x,avg_accuracy:0,cases:0,status:"official-observed"}));
    const runs=[...local,...publicRuns,...officialRows];

    if(!profile && !runs.length){$("empty").hidden=false;return}
    $("view").hidden=false;

    const bestDays=runs.length?Math.max(...runs.map(x=>x.days||0)):0;
    const bestScore=runs.length?Math.max(...runs.map(x=>x.score||0)):0;
    const avgScore=avg(runs,"score");
    const accuracyRuns=runs.filter(x=>Number.isFinite(x.avg_accuracy) && x.avg_accuracy>0);
    const avgAcc=accuracyRuns.length ? avg(accuracyRuns,"avg_accuracy") : null;
    const sampleCount=Math.max(profile?.sample_count||0,runs.length);
    $("metrics").innerHTML=[
      ["样本",sampleCount,"局"],["最好存活",bestDays,"天"],["最高分",bestScore,"/100"],["平均分",fmt(avgScore),""],["平均准确率",avgAcc===null?"—":fmt(avgAcc),avgAcc===null?"":"%"]
    ].map(([k,v,u])=>`<article class="metric"><span>${k}</span><b>${v}</b><small>${u}</small></article>`).join("");

    const styles=(profile?.observed_style||[]);
    const strengths=(profile?.observed_strengths||[]);
    const risks=(profile?.observed_risks||[]);
    $("styleList").innerHTML=(styles.length?styles:commonStyles(runs)).map(x=>"<li>"+esc(x)+"</li>").join("")||"<li>等待更多样本</li>";
    $("strengthList").innerHTML=(strengths.length?strengths:["等待更多样本"]).map(x=>"<li>"+esc(x)+"</li>").join("");
    $("riskList").innerHTML=(risks.length?risks:["等待更多样本"]).map(x=>"<li>"+esc(x)+"</li>").join("");
    $("profileNote").textContent=profile?.note||"该模型尚未形成官方长期画像。";

    const styleCounts=commonStyles(runs);
    $("aggregateGrid").innerHTML=[
      `<article class="card"><h3>常见风格标签</h3><p>${styleCounts.length?styleCounts.map(esc).join(" · "):"暂无"}</p></article>`,
      `<article class="card"><h3>长期表现</h3><p>平均存活 ${fmt(avg(runs,"days"))} 天，平均最终分 ${fmt(avgScore)}。</p></article>`,
      `<article class="card"><h3>置信度</h3><p>${sampleCount<3?"非常低：当前只能做单局观察。":sampleCount<10?"低：可以看到趋势，但仍容易受种子影响。":"正在形成稳定画像，可开始观察重复出现的行为模式。"}</p></article>`
    ].join("");

    const sorted=runs.sort((a,b)=>(b.days||0)-(a.days||0)||(b.score||0)-(a.score||0));
    $("runs").innerHTML=sorted.length?sorted.map(runRow).join(""):'<div class="empty">暂无结构化运行记录</div>';

    let interp=`当前共能关联 ${sampleCount} 个样本。Blackgate 的“模型画像”不是人格判断，而是对可观测决策行为的统计描述。`;
    if(sampleCount<3) interp+=" 目前样本极少，任何“偏保守/偏冒险”等描述都只能作为早期观察。";
    else interp+=" 后续应继续使用统一难度、固定种子和相同开局提示词，才能判断这些风格是否稳定。";
    $("interpretation").textContent=interp;
  }
  init();
})();