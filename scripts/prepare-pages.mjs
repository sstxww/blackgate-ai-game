import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
// Only tracked web assets and documentation are deployable. Private runtime files,
// signing keys, active sessions and server implementations can never enter Pages.
const output=path.resolve('.site');await fs.rm(output,{recursive:true,force:true});await fs.mkdir(output,{recursive:true});
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
let count=0;
for(const file of files){
  if(file.split('/').some(p=>p.startsWith('.')))continue;
  if(/^(?:runner|scripts|examples)\//.test(file))continue;
  if(/^v2\/(?:tests|scripts|server\.mjs)/.test(file))continue;
  if(!/\.(?:html|css|m?js|json|jsonl|svg|png|jpe?g|md|txt)$/.test(file))continue;
  const target=path.join(output,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(file,target);count++;
}
// Public legacy /v2/ URL now enters the same two-mode arena. Source v2 UI and
// game modules stay untouched for parallel mechanics development.
await fs.writeFile(path.join(output,'v2','index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=../challenge.html"><title>地下城挑战</title></head><body><a href="../challenge.html">进入人类 / AI 挑战</a></body></html>`);
await fs.writeFile(path.join(output,'.nojekyll'),'');
console.log(`Prepared ${count} tracked public files in .site. No private runtime directory is deployable.`);
