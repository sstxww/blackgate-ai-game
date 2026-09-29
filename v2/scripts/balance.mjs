import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runSimulation} from './simulate.mjs';
import {VERSION,CONTENT_VERSION} from '../content.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const count=Number(process.env.SEEDS||8);
if(!Number.isInteger(count)||count<1||count>1000)throw Error('SEEDS must be 1–1000');
const policies=['allow','reject','isolate','paperwork','any-anomaly','any-anomaly-reactive','evidence','memory','oracle'];
const rows=[];
function interval(success,n){const z=1.96,p=success/n,den=1+z*z/n,mid=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;return [Math.max(0,mid-half),Math.min(1,mid+half)].map(x=>Math.round(x*1000)/10);}
for(let i=0;i<count;i++)for(const policy of policies) {
  const row=runSimulation({seed:'dev-balance-'+i,policy});rows.push(row);
  console.log(`${rows.length}/${count*policies.length} ${row.seed} ${policy}: days=${row.days}, score=${row.score}, completed=${row.completed}`);
}
const summary=policies.map(policy=>{
  const set=rows.filter(r=>r.policy===policy),success=set.filter(r=>r.completed).length;
  return {policy,privileged_control:policy==='oracle',n:set.length,completed:success,completion_95pct_wilson:interval(success,set.length),
    mean_days:Number((set.reduce((s,r)=>s+r.days,0)/set.length).toFixed(2)),min_days:Math.min(...set.map(r=>r.days)),max_days:Math.max(...set.map(r=>r.days)),
    mean_score:Number((set.reduce((s,r)=>s+r.score,0)/set.length).toFixed(2)),
    mean_miss_rate:Number((set.reduce((s,r)=>s+(r.miss_rate||0),0)/set.length).toFixed(2)),
    mean_innocent_coercion_rate:Number((set.reduce((s,r)=>s+(r.innocent_coercion_rate||0),0)/set.length).toFixed(2))};
});
const hashes={};for(const file of ['engine.mjs','content.mjs','random.mjs','language.mjs','scripts/simulate.mjs'])hashes[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
const result={version:VERSION,content_version:CONTENT_VERSION,generated_at:new Date().toISOString(),difficulty:'abyss',
  status:'development calibration, not held-out model evaluation',seeds_are_public:true,
  limitations:['These are transparent heuristic programs, not Astra, Pro, Jev or human experimental scores.',
    'The privileged oracle reads hidden identities and is ONLY a mechanical feasibility control. It must never appear on a player leaderboard.',
    'An observation-only baseline completing a seed shows a feasible non-cheating policy, not an optimal policy.',
    'Eight seeds provide wide uncertainty intervals. No claim about model ceilings or universal exploit resistance is supported.',
    'These development seeds are public and were used during development; new private evaluation seeds are required for model comparisons.'],
  code_sha256:hashes,summary,runs:rows};
await fs.mkdir(path.join(root,'reports'),{recursive:true});await fs.writeFile(path.join(root,'reports/balance.json'),JSON.stringify(result,null,2)+'\n');
const md=`# v2 开发校准实测\n\n版本 ${VERSION} / ${CONTENT_VERSION}。生成时间：${result.generated_at}。${rows.length} 局，${count} 个公开开发种子。\n\n**不是任何真实 AI 模型的成绩，更不是正式排行榜。**\n\n|策略|通关|平均存活|最差存活|平均分|平均漏放率|平均无辜强制率|\n|---|---:|---:|---:|---:|---:|---:|\n${summary.map(s=>`|${s.policy}${s.privileged_control?'（读取隐藏身份的可行性对照）':''}|${s.completed}/${s.n}|${s.mean_days}|${s.min_days}|${s.mean_score}|${s.mean_miss_rate}%|${s.mean_innocent_coercion_rate}%|`).join('\n')}\n\n## 解释边界\n\n${result.limitations.map(x=>'- '+x).join('\n')}\n\n完整逐局结果、95% Wilson 区间与源码 SHA-256 见 [balance.json](./balance.json)。\n`;
await fs.writeFile(path.join(root,'reports/BALANCE.md'),md);console.log(JSON.stringify(summary,null,2));
