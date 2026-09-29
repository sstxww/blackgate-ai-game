(() => {
  "use strict";
  const frame=document.getElementById("gameFrame");
  const participant=document.getElementById("participant");
  const reportLink=document.getElementById("reportLink");
  const map={allowBtn:"allow",rejectBtn:"reject",searchBtn:"search",isolateBtn:"isolate",nextDayBtn:"next_day"};

  function difficulty(d){
    const sel=d.querySelector("[data-difficulty].selected");
    return sel?.dataset?.difficulty || "normal";
  }

  function bind(){
    const d=frame.contentDocument;
    if(!d) return;

    d.getElementById("startBtn")?.addEventListener("click",()=>{
      setTimeout(()=>{
        const s=window.BlackgateAI.getState();
        window.BlackgateRunRecorder.start({
          player_type:"human",
          participant:participant.value.trim() || "Human Player",
          model:"Human",
          provider:"Human",
          difficulty:difficulty(d),
          source:"human-online"
        },s);
      },30);
    },true);

    d.addEventListener("click",e=>{
      const action=map[e.target.closest("button")?.id];
      if(!action) return;
      const before=window.BlackgateAI.getState();
      setTimeout(()=>{
        const after=window.BlackgateAI.getState();
        const result=window.BlackgateRunRecorder.recordAction(before,action,after);
        if(result?.report){
          reportLink.href="./report.html?id="+encodeURIComponent(result.run.id);
          reportLink.hidden=false;
        }
      },["allow","reject","isolate"].includes(action)?430:80);
    },true);
  }

  frame.addEventListener("load",bind);
  window.addEventListener("blackgate-run-finished",e=>{
    reportLink.href="./report.html?id="+encodeURIComponent(e.detail.run.id);
    reportLink.hidden=false;
  });
})();
