import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const id='60d4600e-3993-46ea-9b5b-4e698d2512fe';
const timestamp='2026-11-20T15:30:00Z';
const settings={recipient:'ops@example.invalid',enabled:true,categories:['alerts','security'],revision:2};
const job={id,first_at:timestamp,sent_at:timestamp,state:'sent',severity:'high',category:'alerts',title:'<img src=x>',resource:'Club announcements',attempts:2,occurrences:4,
 history:[{attempt:1,finished_at:timestamp,outcome:'retry',code:'smtp_temporary'},{attempt:2,finished_at:timestamp,outcome:'sent'}]};
const data=(jobs=[job])=>({settings,jobs,queue:{waiting:2,attention:1},worker:{sender_ready:true,last_poll_at:timestamp}});
const e=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const copied=v=>JSON.parse(JSON.stringify(v));
function harness(){
 const window={},hooks={},results=[],calls=[],live={id:'user-1',generation:1,admin:true,approved:true};
 const panel={outerHTML:'',querySelector:()=>({focus(){}})};
 const document={querySelector:()=>panel,addEventListener:(kind,fn)=>{hooks[kind]=fn;}};
 class FormData {constructor(form){this.f=form;}get(k){return this.f.data[k]??null;}getAll(k){return this.f.data[k]??[];}}
 vm.runInNewContext(read('space-admin-email.js'),{window,document,Date,FormData});
 const ui=window.SpaceAdminMail.create({get:()=>live,esc:e,deadline:run=>run(),
  db:{rpc(name,args){calls.push({name,args:copied(args)});return Promise.resolve(results.shift());}}});
 const click=kind=>hooks.click({target:{closest:()=>({closest:()=>panel,dataset:{adminMailAction:kind}})}});
 const submit=values=>hooks.submit({preventDefault(){},target:{matches:()=>true,data:values}});
 return {ui,live,results,calls,panel,click,submit};
}
const tick=()=>new Promise(r=>setImmediate(r));
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS',name);}
await check('Only verified administrator state can request preferences or see records',async()=>{
 const h=harness();h.live.admin=false;await h.ui.load();
 assert.equal(h.calls.length,0);assert.equal(h.ui.view(),'');
});
await check('Preferences, audit state, attempts and UTC timestamps are legible and escaped',async()=>{
 const h=harness();h.results.push({data:data()});await h.ui.load();
 const html=h.ui.view();
 assert.match(html,/ops@example.invalid/);assert.match(html,/Service status/);
 assert.match(html,/Accepted by mail server/);assert.match(html,/Temporary mail server rejection/);
 assert.match(html,/2026-11-20 15:30:00 UTC/);assert.match(html,/4 grouped events/);
 assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img/);
});
await check('An address change asks for matching confirmation before saving',async()=>{
 const h=harness();h.results.push({data:data()});await h.ui.load();
 h.submit({recipient:'new@example.invalid',confirm:'typo@example.invalid',enabled:'on',category:['alerts']});await tick();
 assert.equal(h.calls.length,1);assert.match(h.panel.outerHTML,/Re-enter the new email address/);
 h.results.push({data:null},{data:{...data(),settings:{...settings,recipient:'new@example.invalid',revision:3}}});
 h.submit({recipient:'new@example.invalid',confirm:'new@example.invalid',enabled:'on',category:['alerts','unexpected']});await tick();
 assert.deepEqual(h.calls[1],{name:'space_admin_mail_save',args:{p_recipient:'new@example.invalid',p_enabled:true,p_categories:['alerts'],p_revision:2}});
 assert.match(h.panel.outerHTML,/settings saved/);
});
await check('Test mail uses only the saved settings and queues once per click',async()=>{
 const h=harness();h.results.push({data:data()});await h.ui.load();
 let resolve;h.results.push(new Promise(r=>{resolve=r;}),{data:data()});
 h.click('test');h.click('test');resolve({data:id});await tick();
 assert.equal(h.calls.filter(c=>c.name==='space_admin_mail_test').length,1);
 assert.deepEqual(h.calls.find(c=>c.name==='space_admin_mail_test').args,{});
 assert.match(h.panel.outerHTML,/Test queued/);
});
await check('An expired MFA change and an unavailable migration show actionable instructions',async()=>{
 const h=harness();h.results.push({data:data()});await h.ui.load();
 h.results.push({error:{code:'42501',details:'SPACE_ADMIN_MFA_RECENT_REQUIRED',message:'PRIVATE'}});
 h.submit({recipient:settings.recipient,enabled:'on',category:['alerts']});await tick();
 assert.match(h.panel.outerHTML,/Verify your authenticator again/);assert.doesNotMatch(h.panel.outerHTML,/PRIVATE/);
 h.ui.reset();h.results.push({error:{code:'PGRST202'}});await h.ui.load();assert.match(h.ui.view(),/Apply the administrator email migration/);
});
await check('Pagination uses an exact keyset cursor and accounts cannot inherit another audit',async()=>{
 const h=harness();h.results.push({data:data(Array.from({length:26},()=>job))});await h.ui.load();
 let resolve;h.results.push(new Promise(r=>{resolve=r;}));h.click('older');
 assert.deepEqual(h.calls[1].args,{p_before:timestamp,p_id:id});
 h.live.generation++;h.live.id='replacement';h.live.admin=false;h.ui.reset();
 resolve({data:data()});await tick();assert.equal(h.ui.view(),'');
});
await check('Settings only attach to System health and frontend deployment includes both assets',async()=>{
 const html=read('index.html'),flow=read('.github/workflows/pages.yml'),guidance=read('club-guidance.js');
 assert(html.indexOf('src="space-admin-email.js')<html.indexOf('src="club-guidance.js'));
 assert.match(flow,/cp space-admin-email.js space-admin-email.css _site/);
 assert.match(guidance,/adminMail\?\.load\(\)/);assert.match(guidance,/adminMail\?\.reset\(\)/);
});
console.log(count+' administrator email UI checks passed.');
