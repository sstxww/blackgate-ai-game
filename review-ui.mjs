import {buildReview} from './review-analysis.mjs';
const el=(tag,value='',className='')=>{const n=document.createElement(tag);n.textContent=value;n.className=className;return n;};
export function renderReview(container,envelope){
  const review=buildReview(envelope);container.replaceChildren();
  const hero=el('div','','review-hero');
  const heading=el('div');heading.append(el('p','BEHAVIOR AT THE GATE / 本局决策画像','review-kicker'),el('h3',review.psychology.headline),el('p','看它如何求证、承压、更新判断，也看这种倾向在何时有利、何时吃亏。','review-muted'));
  const stamp=el('div','','review-stamp');stamp.append(el('strong',String(review.sample_size)),el('span','个已处置案件'),el('small','仅描述本局 · 不代表稳定人格'));
  hero.append(heading,stamp);container.append(hero);
  const grid=el('div','','review-metrics');for(const m of review.metrics){const card=el('article','','review-metric');card.append(el('span',m.label),el('strong',m.value),el('small',m.note));grid.append(card);}container.append(grid);
  const psych=el('section','','psychology-overview');psych.id='psychologyOverview';
  psych.append(el('h3','八个决策心理维度'),el('p','这是本局行为原型，不是人类人格量表。每个判断都给出样本、依据及另一面。','review-muted'));
  const psychGrid=el('div','','psych-grid');
  for(const d of review.psychology.dimensions){
    const card=el('article','','psych-card');card.dataset.dimension=d.id;
    card.append(el('span',d.label,'review-kicker'),el('h4',d.finding),el('p',d.question),el('small',d.support+' · n='+d.sample_size));
    const evidence=el('details','','psych-evidence');evidence.append(el('summary','查看依据与两面性'));
    evidence.append(el('p',d.observation),el('p','可能优势：'+d.benefit),el('p','可能代价：'+d.cost),el('p','评价边界：'+d.limit,'review-muted'));card.append(evidence);psychGrid.append(card);
  }
  psych.append(psychGrid);container.append(psych);
  const toolbar=el('div','','review-toolbar'),toggle=el('button','展开全部章节');toggle.type='button';toggle.setAttribute('aria-expanded','false');
  const exportButton=el('button','导出画像 JSON');exportButton.type='button';exportButton.id='downloadBehavior';
  exportButton.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(review,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='blackgate-behavior-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  toolbar.append(toggle,exportButton);container.append(toolbar);
  const nav=el('nav','','review-nav');nav.setAttribute('aria-label','复盘章节');container.append(nav);
  const content=el('div','','review-chapters');const panels=[];
  for(const section of review.sections){
    const panel=el('details','','review-chapter');panel.id='review-'+section.id;panel.open=['identity','style','situations','strengths','weaknesses','next'].includes(section.id);panels.push(panel);
    panel.append(el('summary',section.title));const body=el('div','','review-body');
    for(const p of section.paragraphs)body.append(el('p',p));
    if(section.id==='situations'){
      const grid=el('div','','psych-situations');
      for(const s of review.psychology.scenarios){
        const card=el('article','','psych-situation');card.dataset.scenario=s.id;
        card.append(el('h4',s.title+' · '+s.finding),el('small',s.support+' · n='+s.sample_size),el('p','情境：'+s.trigger),el('p',s.observation),el('p',s.interpretation),el('p',s.outcomes,'review-outcome'),el('p','案例：'+s.examples),el('p',s.limit,'review-muted'));grid.append(card);
      }body.append(grid);
    }else if(section.items.length){const list=el('ul');for(const item of section.items)list.append(el('li',item));body.append(list);}panel.append(body);content.append(panel);
    const link=el('a',section.title.split(' / ')[1]);link.href='#'+panel.id;link.addEventListener('click',()=>{panel.open=true;});nav.append(link);
  }
  toggle.addEventListener('click',()=>{const open=!panels.every(x=>x.open);for(const p of panels)p.open=open;toggle.textContent=open?'折叠全部章节':'展开全部章节';toggle.setAttribute('aria-expanded',String(open));});
  container.append(content,el('h3',String(review.sections.length+1).padStart(2,'0')+' / 关键决策：当时看见什么，后来发生什么'),el('p',review.case_note,'review-muted'));
  const cases=el('div','','review-cases');
  for(const c of review.cases){
    const card=el('details','','review-case');card.append(el('summary',c.title+' · '+c.action));
    const body=el('div','','review-body');body.append(el('p',c.outcome+'；当时 P(危险)：'+(c.probability??'未提供'),'review-outcome'),el('h4','当时公开理由'),el('p',c.reason),el('h4','当时可见证据'));
    for(const fact of c.visible)body.append(el('p',fact));if(!c.visible.length)body.append(el('p','没有可见证据快照，不据此猜测。'));
    body.append(el('small','引用 ID：'+(c.evidence.join(' / ')||'未引用')));card.append(body);cases.append(card);
  }
  if(!review.cases.length)cases.append(el('p','没有足够的已标记案件可展示。'));container.append(cases);
  return review;
}

export function announceReview(envelope){
  if(envelope.metadata?.participant_type!=='ai')return;
  const previous=document.getElementById('reviewReady');if(previous){previous.close();previous.remove();}
  const dialog=el('dialog','','review-dialog');dialog.id='reviewReady';dialog.setAttribute('aria-labelledby','reviewReadyTitle');
  const title=el('h2','挑战结束，复盘已生成');title.id='reviewReadyTitle';
  dialog.append(el('p','AFTER ACTION REVIEW','review-kicker'),title,el('p',`本局生存 ${envelope.report.days_survived}/42 天。决策心理画像、十类情境反应、优缺点与关键案例已经整理完成。`));
  const open=el('button','查看详细复盘');open.type='button';open.id='openDetailedReview';open.autofocus=true;open.addEventListener('click',()=>dialog.close());
  dialog.append(open,el('small','本地生成，不额外调用模型。不自动上传成绩、日志或密钥。'));
  dialog.addEventListener('close',()=>{const report=document.getElementById('postmortem');if(report){report.tabIndex=-1;report.focus({preventScroll:true});report.scrollIntoView({behavior:'auto',block:'start'});}});
  document.body.append(dialog);dialog.showModal();
}
