import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const ignored=new Set(['node_modules','.git','.site','.blackgate-v2','.scratch','data','reports']);
const files=[];
function visit(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){if(ignored.has(d.name))continue;const p=path.join(dir,d.name);if(d.isDirectory())visit(p);else if(/\.(?:m?js)$/.test(d.name))files.push(p);}}
visit('.');
for(const p of files){const out=spawnSync(process.execPath,['--check',p],{stdio:'inherit'});if(out.status!==0)process.exit(out.status||1);}
console.log(`Syntax checks passed: ${files.length} JavaScript modules.`);
