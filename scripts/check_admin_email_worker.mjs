// Exercise the deployed handler and its mail formats without network or mail credentials.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync(new URL('../supabase/functions/send-admin-notification-emails/index.ts',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replaceAll('export function','function').replace('export default','const worker=');
const compiled=stripTypeScriptTypes(source)+'\nglobalThis.exportsForTest={worker,messageFor,siteUrl,smtpFailure};';
const id='5b63bcc5-ea03-4d7d-a9ab-567f5b6ffb2b';
const event={id,recipient:'ops@example.invalid',category:'service_status',severity:'high',title:'Approval queue delay',
 resource:'Approval email',summary:'<script> No raw data',recommendation:'Review the queue.',route:'system-health',
 first_at:'2026-11-20T12:00:20Z',last_at:'2026-11-20T12:05:00Z',occurrences:4,observed_count:7};
const json=v=>JSON.parse(JSON.stringify(v));
function environment({sender=true,result,finishAccepted=true}={}){
 const calls=[],messages=[],logs=[],claims=[{id,token:'token'},null];
 let auth,transport;
 const ctx={supabaseAdmin:{async rpc(name,args){
  calls.push([name,args]);
  if(name==='space_admin_mail_poll')return {data:null};
  if(name==='space_admin_mail_claim')return {data:claims.shift()};
  if(name==='space_admin_mail_start')return {data:event};
  if(name==='space_admin_mail_finish')return {data:finishAccepted};
  throw Error('Unexpected RPC');
 }}};
 const scope=vm.createContext({URL,Response,AbortSignal,Deno:{env:{get:k=>sender?{APPROVAL_SMTP_EMAIL:'sender@example.invalid',APPROVAL_SMTP_APP_PASSWORD:'synthetic_app_password'}[k]:undefined}},
  withSupabase(opts,handler){auth=opts.auth;return req=>handler(req,ctx);},
  nodemailer:{createTransport(opts){transport=opts;return {sendMail:async m=>{messages.push(m);if(result)throw result;return {accepted:[event.recipient]};},close(){}};}},
  console:{error:(...a)=>logs.push(a),warn:(...a)=>logs.push(a)}});
 vm.runInContext(compiled,scope);
 return {...scope.exportsForTest,calls,messages,logs,auth,transport:()=>transport};
}
const request=(method='POST',args={})=>({method,...args});
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS',name);}
await check('Subjects, timestamps, counts, action and fixed HTTPS link are included, with escaped HTML',()=>{
 const w=environment();
 const mail=w.messageFor(event,w.siteUrl('https://space.example.invalid/workspace/'));
 assert.match(mail.subject,/\[SPACE\]\[HIGH\]\[Service status\] Approval queue delay/);
 assert.match(mail.text,/2026-11-20 12:00:20 UTC/);assert.match(mail.text,/Observed count: 7/);
 assert.match(mail.text,/Recommended action: Review the queue/);
 assert.match(mail.html,/&lt;script&gt;/);assert.doesNotMatch(mail.html,/<script>/);
 assert.match(mail.text,/https:\/\/space.example.invalid\/workspace\/#system-health/);
 assert(mail.messageId.includes(id));
});
await check('Envelope rejects an external route, recipient injection, unsafe URL and subject breaks',()=>{
 const w=environment(),url=w.siteUrl('https://space.example.invalid/');
 for(const v of [{route:'https://evil.invalid'},{recipient:'test@example.invalid,second@example.invalid'},{title:'Title\nBcc: other@example.invalid'}])
  assert.throws(()=>w.messageFor({...event,...v},url),/Invalid mail event/);
 for(const u of ['http://space.example.invalid/','https://user:secret@space.example.invalid/','https://space.example.invalid/#outside'])
  assert.throws(()=>w.siteUrl(u),/Invalid site address/);
});
await check('Only confirmed temporary or pre-message transport failures retry',()=>{
 const w=environment();
 const expect=(input,outcome,code)=>assert.deepEqual(json(w.smtpFailure(input)),{outcome,code});
 expect({responseCode:451,command:'DATA'},'retry','smtp_temporary');
 expect({code:'ECONNECTION',command:'CONN'},'retry','transport_before_message');
 expect({responseCode:535,code:'EAUTH'},'failed','sender_rejected');
 expect({responseCode:550},'failed','smtp_rejected');
 expect({code:'ETIMEDOUT',command:'DATA'},'uncertain','smtp_timeout');
 expect({message:'secret must not leak'},'uncertain','confirmation_missing');
});
await check('Worker requires the named key and cannot accept a destination or message from the request',async()=>{
 const w=environment();
 assert.equal(w.auth,'secret:admin_notification_worker');
 assert.equal((await w.worker.fetch(request('GET'))).status,405);assert.equal(w.calls.length,0);
 const response=await w.worker.fetch(request('POST',{json:()=>{throw Error('Must not read untrusted request body');}}));
 assert.equal(response.status,200);assert.equal(w.messages.length,1);assert.equal(w.messages[0].to,event.recipient);
 assert.deepEqual(w.calls.map(r=>r[0]),['space_admin_mail_poll','space_admin_mail_claim','space_admin_mail_start','space_admin_mail_finish','space_admin_mail_claim']);
 assert.equal(w.calls[3][1].p_outcome,'sent');assert.equal(w.transport().secure,true);
 assert.equal(w.transport().disableUrlAccess,true);assert.equal(w.transport().disableFileAccess,true);
});
await check('Missing sender settings are visible without reserving or dispatching mail',async()=>{
 const w=environment({sender:false});
 assert.equal((await w.worker.fetch(request())).status,503);
 assert.equal(w.calls.length,1);assert.equal(w.calls[0][1].p_sender_ready,false);assert.equal(w.messages.length,0);
});
await check('Raw provider responses stay out of persisted diagnostics and ambiguous acceptance is not resent',async()=>{
 const failure=environment({result:{code:'ETIMEDOUT',command:'DATA',message:'PRIVATE sender secret'}});
 const r=await failure.worker.fetch(request());assert.equal(r.status,200);
 assert.equal(failure.calls[3][1].p_outcome,'uncertain');assert(!JSON.stringify(failure.logs).includes('PRIVATE'));
 const lost=environment({finishAccepted:false});await lost.worker.fetch(request());
 assert.equal(lost.messages.length,1);assert(lost.logs.some(row=>row[0].includes('not recorded')));
});
console.log(count+' administrator email worker checks passed.');
