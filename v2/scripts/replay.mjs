import fs from 'node:fs/promises';
import {replay} from '../engine.mjs';
import {verifyEnvelope} from '../server.mjs';
const [file,keyFile]=process.argv.slice(2);
if(!file){console.error('Usage: npm run replay -- report.json [trusted-public-key.pem]');process.exit(2);}
try {
  const data=JSON.parse(await fs.readFile(file,'utf8')),report=data.report||data;
  if(keyFile&&!verifyEnvelope(data,await fs.readFile(keyFile,'utf8')))throw Error('Invalid server signature under the supplied trusted key');
  console.log(JSON.stringify({...replay(report),signature_checked:!!keyFile,
    warning:'Replay proves transcript consistency, not absence of prior answer inspection. Model identity remains self-declared unless independently supervised.'},null,2));
}catch(error){console.error(error.message);process.exit(1);}
