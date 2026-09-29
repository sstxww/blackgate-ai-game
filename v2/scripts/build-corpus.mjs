import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {makeWorld,VERSION,CONTENT_VERSION} from '../content.mjs';
import {LANGUAGE,MOTIVATIONS} from '../language.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data');
await fs.mkdir(root,{recursive:true});
const manifest={version:VERSION,content_version:CONTENT_VERSION,purpose:'Public development examples, NOT held-out evaluation seeds. Generated entities are not hand-authored independent questions.',
  worlds:8,people:0,networks:0,edges:0,bytes:0,authored_evidence_phrasings:Object.values(LANGUAGE).reduce((n,p)=>n+p.normal.length+p.anomaly.length,0),authored_motivations:MOTIVATIONS.length,files:[]};
for(let i=0;i<manifest.worlds;i++) {
  const seed='public-development-corpus-v2-'+i,w=makeWorld(seed),file=`development-${String(i).padStart(2,'0')}.jsonl`;
  const rows=[{type:'metadata',version:VERSION,content_version:CONTENT_VERSION,seed,purpose:manifest.purpose,manifest:w.manifest,truth_commitment:w.truthCommit},
    ...w.people.map(value=>({type:'person',value})),...w.networks.map(value=>({type:'network',value})),
    ...w.edges.map(value=>({type:'edge',value})),...w.disasters.map(value=>({type:'crisis',value}))];
  const body=rows.map(r=>JSON.stringify(r)).join('\n')+'\n',bytes=Buffer.byteLength(body);
  await fs.writeFile(path.join(root,file),body);
  manifest.people+=w.people.length;manifest.networks+=w.networks.length;manifest.edges+=w.edges.length;manifest.bytes+=bytes;
  manifest.files.push({file,sha256:createHash('sha256').update(body).digest('hex'),bytes,records:rows.length});
}
await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
