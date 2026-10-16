// Offline security and behavior checks; no accounts or live emails are created.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('reset-password.js',root),'utf8').replace(/^import .*\n/,'').replace(/\ninitRecovery\(\);\s*$/,'');
const tests=[],test=(name,run)=>tests.push({name,run});
const session=id=>({user:{id,email:id+'@example.test'},access_token:'test-token',refresh_token:'test-refresh'});
const recoveryKey='space-password-recovery-qa',workspaceKey='sb-qa-auth-token';
function harness({currentSession=null,event=null,hash='',tab=new Map(),local=new Map(),blocked=false}={}){
  const nodes=new Map(),calls=[],history=[];let listener,now=100000;
  const storage=items=>({getItem(key){if(blocked)throw Error('Storage blocked');return items.get(key)??null;},setItem(key,value){if(blocked)throw Error('Storage blocked');items.set(key,String(value));},removeItem(key){if(blocked)throw Error('Storage blocked');items.delete(key);}});
  const tabStorage=storage(tab),localStorage=storage(local);
  function node(id){if(!nodes.has(id))nodes.set(id,{hidden:id==='recoveryCodeForm'||id==='newPasswordForm',textContent:'',value:'',disabled:false,addEventListener(){},focus(){},reset(){this.wasReset=true;}});return nodes.get(id);}
  const api={
    onAuthStateChange(fn){listener=fn;},
    async getSession(){calls.push({method:'getSession'});if(event){const next=event;event=null;listener(next,currentSession);}return {data:{session:currentSession},error:null};},
    async verifyOtp(args){calls.push({method:'verifyOtp',args});currentSession=session('recovering');listener('PASSWORD_RECOVERY',currentSession);return {data:{session:currentSession},error:null};},
    async updateUser(args){calls.push({method:'updateUser',args});return {data:{user:currentSession?.user},error:null};},
    async signOut(args){calls.push({method:'signOut',args,tokenPresent:tab.has(recoveryKey)});currentSession=null;return {error:null};}
  };
  let options;
  const location={hash,search:'',pathname:'/Turk-Innovation-CLUB/reset-password.html'};
  const context=vm.createContext({console,URL,Map,JSON,Date:class extends Date{static now(){return now;}},sessionStorage:tabStorage,localStorage,window:{INNOVATEX_CONFIG:{supabaseUrl:'https://qa.supabase.co',supabaseAnonKey:'fake'},sessionStorage:tabStorage,localStorage},location,history:{replaceState(...args){history.push(args);location.hash='';}},document:{querySelector(selector){return node(selector.slice(1));},getElementById:node,querySelectorAll(){return [];}},FormData:class{constructor(form){this.data=new Map(form.entries);}get(key){return this.data.get(key);}},createClient(_url,_key,config){options=config;return {auth:api};}});
  vm.runInContext(source,context,{filename:'reset-password.js'});
  const run=code=>vm.runInContext(code,context),exec=(code,args)=>{context.qaArgs=args;return run(code);};
  const form=(entries=[])=>{const button={disabled:false},target={entries,hidden:false,querySelector(){return button;},reset(){this.wasReset=true;}};return {event:{target,preventDefault(){}},target,button};};
  return {run,exec,api,nodes,node,calls,history,tab,local,form,location,get options(){return options;},setSession:value=>{currentSession=value;},setNow:value=>{now=value;},emit:(event,value)=>listener(event,value)};
}

test('Recovery uses a separate tab-scoped client and never consumes the workspace session',async()=>{
 const local=new Map([[workspaceKey,JSON.stringify(session('already-signed-in'))]]),h=harness({local});await h.run('initRecovery()');assert.equal(h.options.auth.storageKey,recoveryKey);assert.equal(h.options.auth.autoRefreshToken,false);assert.equal(h.node('newPasswordForm').hidden,true);assert.equal(h.node('recoveryCodeForm').hidden,false);assert(local.has(workspaceKey));assert.equal(h.run('recoveryUserId'),'');
});
test('A recovery URL flag alone cannot authorize a password change',async()=>{
 const h=harness({hash:'#type=recovery'});await h.run('initRecovery()');assert.equal(h.node('newPasswordForm').hidden,true);assert.equal(h.run('recoveryUserId'),'');assert.equal(h.history.at(-1)[2],h.location.pathname);
});
test('A verified recovery event enables the password form and removes URL tokens',async()=>{
 const h=harness({hash:'#access_token=private&refresh_token=private&type=recovery',currentSession:session('recovering'),event:'PASSWORD_RECOVERY'});await h.run('initRecovery()');assert.equal(h.node('newPasswordForm').hidden,false);assert.equal(h.node('recoveryCodeForm').hidden,true);assert.equal(h.run('recoveryUserId'),'recovering');assert.equal(h.location.hash,'');assert(!JSON.stringify(h.history).includes('private'));
});
test('An ordinary SIGNED_IN session on the recovery page is rejected',async()=>{
 const h=harness({currentSession:session('ordinary'),event:'SIGNED_IN'});await h.run('initRecovery()');assert.equal(h.node('newPasswordForm').hidden,true);assert.equal(h.run('recoveryUserId'),'');
});
test('A numeric reset code verifies the existing email using the recovery type',async()=>{
 const h=harness();await h.run('initRecovery()');const form=h.form([['email',' RECOVERING@EXAMPLE.TEST '],['code','12345678']]);await h.exec('verifyRecoveryCode(qaArgs)',form.event);const call=h.calls.find(c=>c.method==='verifyOtp');assert.equal(call.args.email,'recovering@example.test');assert.equal(call.args.token,'12345678');assert.equal(call.args.type,'recovery');assert.equal(h.run('recoveryUserId'),'recovering');assert.equal(form.target.wasReset,true);assert.equal(form.button.disabled,false);
});
test('Invalid numeric input never sends a recovery request',async()=>{
 const h=harness();await h.run('initRecovery()');await h.exec('verifyRecoveryCode(qaArgs)',h.form([['email','self@example.test'],['code','not-a-code']]).event);assert(!h.calls.some(c=>c.method==='verifyOtp'));assert.equal(h.run('recoveryUserId'),'');
});
test('An expired reset code leaves the password form unavailable',async()=>{
 const h=harness();await h.run('initRecovery()');h.api.verifyOtp=async()=>({data:{session:null},error:{message:'Token has expired'}});const form=h.form([['email','self@example.test'],['code','12345678']]);await h.exec('verifyRecoveryCode(qaArgs)',form.event);assert.match(h.node('resetStatus').textContent,/expired/);assert.equal(h.node('newPasswordForm').hidden,true);assert.equal(form.button.disabled,false);
});
test('Password validation rejects short or mismatched values without an update',async()=>{
 for(const [password,confirmation]of [['short','short'],['a long password','another password']]){const h=harness({currentSession:session('recovering'),event:'PASSWORD_RECOVERY'});await h.run('initRecovery()');await h.exec('savePassword(qaArgs)',h.form([['password',password],['password_confirm',confirmation]]).event);assert(!h.calls.some(c=>c.method==='updateUser'));assert.match(h.node('resetStatus').textContent,/8 characters|do not match/);}
});
test('A password cannot be updated from a session that belongs to a different user',async()=>{
 const h=harness({currentSession:session('recovering'),event:'PASSWORD_RECOVERY'});await h.run('initRecovery()');h.setSession(session('different'));await h.exec('savePassword(qaArgs)',h.form([['password','new password'],['password_confirm','new password']]).event);assert(!h.calls.some(c=>c.method==='updateUser'));assert.equal(h.node('newPasswordForm').hidden,true);assert.equal(h.run('recoveryUserId'),'');
});
test('Expired recovery authorization requires a new reset email',async()=>{
 const h=harness({currentSession:session('recovering'),event:'PASSWORD_RECOVERY'});await h.run('initRecovery()');h.setNow(100000+21*60*1000);await h.exec('savePassword(qaArgs)',h.form([['password','new password'],['password_confirm','new password']]).event);assert(!h.calls.some(c=>c.method==='updateUser'));assert.equal(h.run('recoveryUserId'),'');
});
test('Saving preserves the exact password, signs out, and clears only matching workspace tokens',async()=>{
 const local=new Map([[workspaceKey,JSON.stringify(session('recovering'))]]),tab=new Map([[recoveryKey,JSON.stringify(session('recovering'))]]),h=harness({local,tab,currentSession:session('recovering'),event:'PASSWORD_RECOVERY'});await h.run('initRecovery()');const password='  new unique password  ',form=h.form([['password',password],['password_confirm',password]]);await h.exec('savePassword(qaArgs)',form.event);
 const updated=h.calls.find(c=>c.method==='updateUser'),signedOut=h.calls.find(c=>c.method==='signOut');assert.equal(updated.args.password,password);assert.equal(Object.keys(updated.args).length,1);assert.equal(signedOut.args.scope,'global');assert.equal(signedOut.tokenPresent,true,'Token must remain available until server revocation');assert.equal(local.has(workspaceKey),false);assert(local.has(workspaceKey+'-space-signed-out'));assert.equal(tab.has(recoveryKey),false);assert.equal(tab.has(recoveryKey+'-verified'),false);assert.equal(form.target.wasReset,true);assert.equal(form.target.hidden,true);assert.equal(h.node('resetTitle').textContent,'Password saved');assert(!JSON.stringify([...tab,...local]).includes(password));
});
test('Resetting an account preserves a different account’s workspace session',async()=>{
 const saved=JSON.stringify(session('other')),local=new Map([[workspaceKey,saved]]),h=harness({local,currentSession:session('recovering'),event:'PASSWORD_RECOVERY'});await h.run('initRecovery()');await h.exec('savePassword(qaArgs)',h.form([['password','new password'],['password_confirm','new password']]).event);assert.equal(local.get(workspaceKey),saved);assert.equal(local.has(workspaceKey+'-space-signed-out'),false);
});
test('A failed password update can be retried without falsely reporting success',async()=>{
 const h=harness({currentSession:session('recovering'),event:'PASSWORD_RECOVERY'});await h.run('initRecovery()');h.api.updateUser=async()=>({error:{message:'Password is too common'}});const form=h.form([['password','new password'],['password_confirm','new password']]);await h.exec('savePassword(qaArgs)',form.event);assert.match(h.node('resetStatus').textContent,/too common/);assert.equal(form.button.disabled,false);assert.equal(form.target.hidden,false);assert(!h.calls.some(c=>c.method==='signOut'));
});
test('Reload restores a matching verified recovery without extending its time limit',async()=>{
 const until=100000+5*60*1000,tab=new Map([[recoveryKey+'-verified',JSON.stringify({userId:'recovering',until})]]),h=harness({tab,currentSession:session('recovering')});await h.run('initRecovery()');assert.equal(h.node('newPasswordForm').hidden,false);assert.equal(JSON.parse(tab.get(recoveryKey+'-verified')).until,until);
});
test('A verified marker for a different user cannot restore recovery',async()=>{
 const tab=new Map([[recoveryKey+'-verified',JSON.stringify({userId:'other',until:900000})]]),h=harness({tab,currentSession:session('recovering')});await h.run('initRecovery()');assert.equal(h.node('newPasswordForm').hidden,true);assert.equal(tab.has(recoveryKey+'-verified'),false);
});
test('Blocked browser storage still permits recovery in the current page',async()=>{
 const h=harness({blocked:true,currentSession:session('recovering'),event:'PASSWORD_RECOVERY'});await h.run('initRecovery()');assert.equal(h.node('newPasswordForm').hidden,false);await h.exec('savePassword(qaArgs)',h.form([['password','new password'],['password_confirm','new password']]).event);assert.equal(h.node('resetTitle').textContent,'Password saved');
});
test('Recovery page, templates and deploy workflow include the complete reset path',()=>{
 const html=fs.readFileSync(new URL('reset-password.html',root),'utf8'),template=fs.readFileSync(new URL('supabase/email-password-reset-template.html',root),'utf8'),workflow=fs.readFileSync(new URL('.github/workflows/pages.yml',root),'utf8'),worker=fs.readFileSync(new URL('sw.js',root),'utf8');
 assert(html.includes('name="referrer" content="no-referrer"'));assert(html.includes('autocomplete="new-password"'));assert(template.includes('{{ .Token }}'));assert(template.includes('{{ .ConfirmationURL }}'));assert(template.includes('TURK INNOVATION CLUB'));assert(workflow.includes('cp index.html reset-password.html reset-password.js'));assert(!worker.includes("'reset-password.html'"));
});
let failed=0;for(const entry of tests){try{await entry.run();console.log('PASS',entry.name);}catch(error){failed++;console.error('FAIL',entry.name,error);}}
console.log(`${tests.length-failed}/${tests.length} password recovery checks passed`);process.exitCode=failed?1:0;
