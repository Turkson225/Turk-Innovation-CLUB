import fs from 'node:fs';
import {contentSecurityPolicy} from '../security-policy.js';
const pages=['index.html','reset-password.html','certificate.html','offline.html','about/index.html','founders/index.html'];
for(const name of pages){
 const file=new URL('../'+name,import.meta.url);let html=fs.readFileSync(file,'utf8');
 const meta='<meta http-equiv="Content-Security-Policy" content="'+contentSecurityPolicy.replaceAll('&','&amp;').replaceAll('"','&quot;')+'">';
 html=html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/gi,'');
 html=html.replace(/(<meta charset="utf-8">)/i,'$1\n  '+meta);
 if(!html.includes('name="referrer"'))html=html.replace(meta,meta+'\n  <meta name="referrer" content="no-referrer">');
 fs.writeFileSync(file,html);
}
console.log('Updated static CSP and referrer policy on six entry pages.');
