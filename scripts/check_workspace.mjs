// Offline regression checks: mocked DOM and database; no live requests.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
function deferred(){let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve};}
function node(overrides={}){return {id:'',dataset:{},style:{},isConnected:true,hidden:false,textContent:'',innerHTML:'',value:'',scrollHeight:400,scrollTop:400,clientHeight:300,classList:{add(){},remove(){},toggle(){},contains(){return false;}},querySelector(){return null;},querySelectorAll(){return [];},closest(){return null;},setAttribute(){},getAttribute(){return null;},removeAttribute(){},focus(){},remove(){},close(){this.open=false;},showModal(){this.open=true;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},...overrides};}
function harness({localItems=new Map(),sessionItems=new Map(),location:initialLocation={hash:'#messages'}}={}){
  const requests=[],queued=[],elements=new Map(),timers=new Map();let timerId=0;
  function from(table){
    const call={table,ops:[]}; requests.push(call);
    const builder=new Proxy({}, {get(_,method){
      if(method==='then')return(resolve,reject)=>Promise.resolve(queued.shift()??{data:[],count:0,error:null}).then(resolve,reject);
      return(...args)=>{call.ops.push([method,...args]);return builder;};
    }});
    return builder;
  }
  const rpcQueued=[],rpcCalls=[];
  const db={from,storage:{from},rpc(name,args){rpcCalls.push({name,args});return Promise.resolve(rpcQueued.shift()??{data:[],error:null});}};
  const storage=items=>({getItem(key){return items.get(key)??null;},setItem(key,value){items.set(key,value);},removeItem(key){items.delete(key);}});
  let clientOptions;
  const context=vm.createContext({console,URL,crypto:globalThis.crypto,Blob,Date,Map,Set,Promise,setTimeout(callback,delay=0){const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);},setInterval(){return 1;},clearInterval(){},sessionStorage:storage(sessionItems),localStorage:storage(localItems),createClient(_url,_key,options){clientOptions=options;return db;},window:{INNOVATEX_CONFIG:{supabaseUrl:'https://qa.supabase.co',supabaseAnonKey:'fake'},addEventListener(){}},navigator:{},location:initialLocation,history:{replaceState(){}},document:{hidden:false,activeElement:null,querySelector(selector){return elements.get(selector)??null;},querySelectorAll(){return [];},getElementById(id){return elements.get('#'+id)??null;},addEventListener(){},documentElement:{dataset:{theme:'light'}}}});
  const source=fs.readFileSync(root+'/app.js','utf8').replace(/^import .*\n/,'').replace(/\ninit\(\);\s*$/,'');
  vm.runInContext(source,context,{filename:'app.js'});
  const run=code=>vm.runInContext(code,context);
  const exec=(code,args)=>{context.qaArgs=args;return run(code);};
  const renderOriginal=run('render');
  run("session={user:{id:'self'}};sessionStartedAt=Date.now();lastSessionActivityAt=sessionStartedAt;me={id:'self',full_name:'Tester',role:'member',membership_status:'approved'};dmReady=true;page='messages';cache={profiles:[me,{id:'a',full_name:'Alice',membership_status:'approved',role:'member'},{id:'b',full_name:'Bob',membership_status:'approved',role:'teacher'}],direct_messages:[],direct_message_reads:[],notifications:[]};render=()=>{};dmShowThreadUpdate=()=>{};refreshUnreadCounts=async()=>{};refreshInboxUnreadCount=async()=>{};");
  elements.set('#toast',node());elements.set('#dmBody',node());elements.set('#modal',node({open:false}));elements.set('#modalContent',node());
  const fireTimers=delay=>{for(const [id,timer]of [...timers])if(timer.delay===delay&&timers.has(id)){timers.delete(id);timer.callback();}};
  return {run,exec,requests,queued,rpcQueued,rpcCalls,elements,context,db,timers,fireTimers,clientOptions,localItems,sessionItems,renderOriginal};
}
const tests=[];
function test(name,fn){tests.push({name,fn});}
const message=(id,sender_id='a',recipient_id='self',body='hello',created_at='2026-10-01T08:00:00Z')=>({id,sender_id,recipient_id,body,created_at});
function composer(peer,text){const input=node({value:text});const send=node();const form=node({id:'dmComposer',dataset:{peer},elements:{body:input},querySelector(s){return s==='[type=submit]'?send:null;}});return {form,input,send,event:{target:form,preventDefault(){}}};}
function action(h,dataset){return h.exec('actions(qaArgs)',{target:{closest(){return node({dataset});}},preventDefault(){}});}

function loginHarness({reducedMotion=false,play=()=>Promise.resolve(),realLearningPath=false,harnessOptions={}}={}){
  const h=harness(harnessOptions),stats={opens:0,closes:0,plays:0,pauses:0,focused:0,workspaceFocused:0};
  const dialog=node({open:false,show(){this.open=true;stats.opens++;},showModal(){throw Error("Welcome must not block the workspace");},close(){this.open=false;stats.closes++;}});
  const video=node({currentTime:0,pause(){stats.pauses++;},play(){stats.plays++;return play();}}),still=node({hidden:true});
  h.elements.set('#loginWelcome',dialog);h.elements.set('#loginWelcomeVideo',video);h.elements.set('#loginWelcomeStill',still);h.elements.set('#loginWelcomeSkip',node({focus(){stats.focused++;}}));
  h.elements.set('#content',node({focus(options){stats.workspaceFocused++;stats.workspaceFocusOptions=options;}}));
  for(const id of ['imageViewer','memberAlert','adminAlert','sidebar','menuBtn'])h.elements.set('#'+id,node({open:false}));
  h.context.window.matchMedia=()=>({matches:reducedMotion});
  h.context.history.replaceState=(_state,_title,hash)=>{h.context.location.hash=hash;};
  h.context.FormData=function(form){return form.entries;};
  h.db.channel=()=>({on(){return this;},subscribe(){return this;}});h.db.removeChannel=async()=>{};h.db.auth={signOut:async()=>({error:null}),startAutoRefresh:async()=>{},stopAutoRefresh:async()=>{}};
  h.run("session=null;me=null;page='home';location.hash='#home';hydrateOwnApplicationReason=async()=>{};refresh=async()=>{};touchPresence=async()=>{};loadPublic=async()=>{};");
  if(!realLearningPath)h.run('loadOwnLearningPath=async()=>{}');
  return {...h,dialog,video,still,stats};
}
const loginSession=id=>({user:{id,email:id+'@example.test'}});
const loginProfile=(id='self',overrides={})=>({id,full_name:'Tester',role:'member',membership_status:'approved',...overrides});
function verifyForm(code='12345678'){
  const submit=node(),form=node({id:'editor',dataset:{kind:'verify'},entries:[['code',code]],querySelector(selector){return selector==='[type=submit]'?submit:null;}});
  return {event:{target:form,preventDefault(){}},submit};
}

test('A stalled course lookup cannot keep a valid OTP submission waiting',async()=>{
  const h=loginHarness({realLearningPath:true}),slow=deferred(),form=verifyForm();h.run("pendingEmail='self@example.test'");
  h.queued.push({data:loginProfile(),error:null},slow.promise);
  h.db.auth.verifyOtp=async()=>({data:{session:loginSession('self')},error:null});
  let finished=false;const signing=h.exec('submit(qaArgs)',form.event).then(()=>{finished=true;});
  for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(finished,true,'Verified sign-in must not wait for the course service');
  assert.equal(form.submit.disabled,false);assert.equal(h.run('authReady'),true);assert.equal(h.run('workspaceLoading'),false);assert.equal(h.run('clubAccess()'),true);
  slow.resolve({data:{tracks:['Controls and Automation']},error:null});await signing;
});
test('A thrown profile request leaves a retryable account check without granting access',async()=>{
  const h=loginHarness();h.context.console={...console,error(){}};h.db.from=()=>{throw Error('Network unavailable');};
  await h.exec('signedIn(qaArgs,true)',loginSession('self'));
  assert.equal(h.run('workspaceLoading'),false);assert.equal(h.run('workspaceHydrating'),false);assert.equal(h.run('authReady'),true);assert.equal(h.run('clubAccess()'),false);assert(h.run('workspaceLoadError').includes('retry'));
});
test('An account-check timeout ends the spinner and ignores a late profile response',async()=>{
  const h=loginHarness(),slow=deferred();h.context.console={...console,error(){}};h.queued.push(slow.promise);
  const signing=h.exec('signedIn(qaArgs,true)',loginSession('self'));for(let i=0;i<5;i++)await Promise.resolve();h.fireTimers(15000);await signing;
  assert.equal(h.run('workspaceLoading'),false);assert.equal(h.run('clubAccess()'),false);assert(h.run('workspaceLoadError').includes('retry'));
  slow.resolve({data:loginProfile(),error:null});for(let i=0;i<5;i++)await Promise.resolve();assert.equal(h.run('me'),null);assert.equal(h.stats.opens,0);
});
test('A rejected course service cannot undo a verified account',async()=>{
  const h=loginHarness({realLearningPath:true});h.context.console={...console,error(){}};h.queued.push({data:loginProfile(),error:null});
  const from=h.db.from;h.db.from=table=>{if(table==='member_learning_paths')throw Error('Learning service unavailable');return from(table);};
  await h.exec('signedIn(qaArgs,true)',loginSession('self'));for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(h.run('authReady'),true);assert.equal(h.run('clubAccess()'),true);assert.equal(h.run('learningChoicesReady'),false);assert.equal(h.run('workspaceHydrating'),false);
});
test('Unavailable course tables do not block existing accounts or force empty course setup',async()=>{
  const h=loginHarness({realLearningPath:true});h.queued.push({data:loginProfile(),error:null},{data:null,error:{code:'PGRST205',message:'Table not found'}});
  await h.exec('signedIn(qaArgs,true)',loginSession('self'));for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(h.run('clubAccess()'),true);assert.equal(h.run('learningSelectionRequired()'),false);assert.equal(h.run('workspaceHydrating'),false);
});
test('A course lookup timeout opens the existing workspace and ignores its late result',async()=>{
  const h=loginHarness({realLearningPath:true}),slow=deferred();h.queued.push({data:loginProfile(),error:null},slow.promise);
  await h.exec('signedIn(qaArgs,true)',loginSession('self'));for(let i=0;i<10;i++)await Promise.resolve();h.fireTimers(8000);for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(h.run('workspaceHydrating'),false);assert.equal(h.run('learningChoicesReady'),false);assert.equal(h.run('clubAccess()'),true);
  slow.resolve({data:{tracks:['Controls and Automation']},error:null});for(let i=0;i<10;i++)await Promise.resolve();assert.equal(h.run('ownLearningTracks.length'),0);
});
test('Deferred course setup still sends approved members without choices to My learning',async()=>{
  const h=loginHarness({realLearningPath:true});h.queued.push({data:loginProfile(),error:null},{data:null,error:null});
  await h.exec('signedIn(qaArgs,true)',loginSession('self'));for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(h.run('learningSelectionRequired()'),true);assert.equal(h.context.location.hash,'#courses');assert.equal(h.run('workspaceHydrating'),false);
});
test('A stalled first page load offers a workspace retry without asking for another OTP',async()=>{
  const h=loginHarness(),slow=deferred();h.context.console={...console,error(){}};h.context.slowPage=()=>slow.promise;h.run('refresh=()=>slowPage()');h.queued.push({data:loginProfile(),error:null});
  await h.exec('signedIn(qaArgs,true)',loginSession('self'));for(let i=0;i<10;i++)await Promise.resolve();h.fireTimers(20000);for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(h.run('workspaceHydrating'),false);assert.equal(h.run('session.user.id'),'self');assert.equal(h.run("workspacePageLoads.get('home').status"),'error');assert(h.run("workspaceSkeleton('home',{error:true})").includes('data-action="retryPage"'));assert.equal(h.run('pendingEmail'),'');
  slow.resolve();
});
test('A checked account can retry a failed profile request using its verified session',async()=>{
  const h=loginHarness();h.context.console={...console,error(){}};h.queued.push({data:null,error:{message:'Network unavailable'}});
  await h.exec('signedIn(qaArgs,true)',loginSession('self'));assert(h.run('workspaceLoadError'));
  h.queued.push({data:loginProfile(),error:null});await action(h,{action:'retryWorkspace'});
  assert.equal(h.run('workspaceLoadError'),'');assert.equal(h.run('clubAccess()'),true);assert.equal(h.run('authReady'),true);
});
test('Sign-in loads the current page without preloading unrelated tools',async()=>{
  const h=loginHarness(),calls=[];h.context.hydratePage=mode=>{calls.push(mode);return Promise.resolve();};h.run('refresh=mode=>hydratePage(mode)');h.queued.push({data:loginProfile(),error:null});
  await h.exec('signedIn(qaArgs,true)',loginSession('self'));for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(h.run('workspaceHydrating'),false);assert.equal(h.run('clubAccess()'),true);assert.equal(h.run('workspaceLoadError'),'');assert.deepEqual(calls,['page']);
});

test('Interactive OTP verification shows the logo once despite a delayed SIGNED_IN callback',async()=>{
  const h=loginHarness(),verified=loginSession('self'),form=verifyForm();h.run("pendingEmail='self@example.test'");h.queued.push({data:loginProfile(),error:null});
  h.db.auth.verifyOtp=async()=>{h.exec("handleAuthStateChange('SIGNED_IN',qaArgs)",verified);return {data:{session:verified},error:null};};
  await h.exec('submit(qaArgs)',form.event);h.fireTimers(0);
  assert.equal(h.stats.opens,1);assert.equal(h.stats.plays,1);assert.equal(h.run('authGeneration'),1);assert.equal(h.run('loginWelcomePendingOwner'),null);assert.equal(form.submit.disabled,false);assert.equal(h.requests.filter(r=>r.table==='profiles').length,1);
});
test('Invalid OTP verification never opens or arms the logo intro',async()=>{
  const h=loginHarness(),form=verifyForm();h.db.auth.verifyOtp=async()=>({data:null,error:{message:'Incorrect code'}});h.context.console={...console,error(){}};
  await h.exec('submit(qaArgs)',form.event);assert.equal(h.stats.opens,0);assert.equal(h.run('loginWelcomePendingOwner'),null);assert.equal(h.run('session'),null);assert.equal(form.submit.disabled,false);
});
test('Restoring a session and refreshing the same account never replay the login logo',async()=>{
  const h=loginHarness(),restored=loginSession('self');h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs)',restored);
  assert.equal(h.stats.opens,0);h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs)',restored);assert.equal(h.stats.opens,0);
});
test('TOKEN_REFRESHED and repeated SIGNED_IN events preserve the current workspace',async()=>{
  const h=loginHarness(),current=loginSession('self');h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs,true)',current);h.run('dismissLoginWelcome()');
  const generation=h.run('authGeneration');h.exec("handleAuthStateChange('TOKEN_REFRESHED',qaArgs);handleAuthStateChange('SIGNED_IN',qaArgs)",current);h.fireTimers(0);
  assert.equal(h.run('authGeneration'),generation);assert.equal(h.stats.opens,1);assert.equal(h.dialog.open,false);
});
test('The winning same-account hydration shows an armed intro once',async()=>{
  const h=loginHarness(),slow=deferred(),current=loginSession('self');h.queued.push(slow.promise);const first=h.exec('signedIn(qaArgs,true)',current);
  h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs)',current);assert.equal(h.stats.opens,1);
  slow.resolve({data:loginProfile(),error:null});await first;assert.equal(h.stats.opens,1);assert.equal(h.run('loginWelcomePendingOwner'),null);
});
test('Signing out while profile hydration is pending cancels the welcome',async()=>{
  const h=loginHarness(),slow=deferred();h.queued.push(slow.promise);const login=h.exec('signedIn(qaArgs,true)',loginSession('self'));
  await h.run('signOut()');slow.resolve({data:loginProfile(),error:null});await login;
  assert.equal(h.stats.opens,0);assert.equal(h.run('session'),null);assert.equal(h.run('loginWelcomePendingOwner'),null);
});
test('Sign out immediately closes a running intro before authentication cleanup finishes',async()=>{
  const h=loginHarness(),slow=deferred();h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs,true)',loginSession('self'));h.db.auth.signOut=()=>slow.promise;
  const leaving=h.run('signOut()');assert.equal(h.dialog.open,false);assert.equal(h.video.onended,null);assert.equal(h.video.onerror,null);assert.equal(h.run('loginWelcomePendingOwner'),null);
  slow.resolve({error:null});await leaving;assert.equal(h.run('session'),null);
});
test('A replacement account cannot inherit the previous account welcome',async()=>{
  const h=loginHarness(),slow=deferred();h.queued.push(slow.promise);const first=h.exec('signedIn(qaArgs,true)',loginSession('self'));
  h.queued.push({data:loginProfile('other'),error:null});await h.exec('signedIn(qaArgs)',loginSession('other'));slow.resolve({data:loginProfile(),error:null});await first;
  assert.equal(h.stats.opens,0);assert.equal(h.run('session.user.id'),'other');assert.equal(h.run('loginWelcomePendingOwner'),null);
});
test('Failed profile hydration clears the intro instead of replaying it during a later refresh',async()=>{
  const h=loginHarness(),current=loginSession('self');h.context.console={...console,error(){}};h.queued.push({data:null,error:{message:'Profile unavailable'}});await h.exec('signedIn(qaArgs,true)',current);
  assert.equal(h.stats.opens,0);assert.equal(h.run('loginWelcomePendingOwner'),null);h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs)',current);assert.equal(h.stats.opens,0);
});
for(const [status,role,expected]of [['pending','member','#application'],['approved','investor','#investor-portal']])test(`The welcome preserves ${role==='investor'?'investor':'pending application'} routing`,async()=>{
  const h=loginHarness();h.run("page='projects';location.hash='#projects'");h.queued.push({data:loginProfile('self',{role,membership_status:status}),error:null});await h.exec('signedIn(qaArgs,true)',loginSession('self'));
  assert.equal(h.stats.opens,1);assert.equal(h.context.location.hash,expected);h.run('dismissLoginWelcome()');assert.equal(h.context.location.hash,expected);
});
test('The welcome preserves an approved member protected-page destination',async()=>{
  const h=loginHarness();h.run("pendingProtectedPage='courses'");h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs,true)',loginSession('self'));
  assert.equal(h.context.location.hash,'#courses');assert.equal(h.run('pendingProtectedPage'),'');h.run('dismissLoginWelcome()');assert.equal(h.context.location.hash,'#courses');
});
test('An ended intro briefly shows the final logo and then returns to the workspace',()=>{
  const h=loginHarness();h.exec('session=qaArgs;showLoginWelcome()',loginSession('self'));h.video.onended();assert.equal(h.video.hidden,true);assert.equal(h.still.hidden,false);assert.equal(h.dialog.open,true);h.fireTimers(400);assert.equal(h.dialog.open,false);
});
for(const failure of ['media error','play rejected','play throws'])test(`The intro falls back to the still logo when ${failure}`,async()=>{
  const h=loginHarness({play:failure==='play rejected'?()=>Promise.reject(Error('Playback blocked')):failure==='play throws'?()=>{throw Error('Playback unsupported');}:()=>Promise.resolve()});h.exec('session=qaArgs;showLoginWelcome()',loginSession('self'));
  if(failure==='media error')h.video.onerror();await Promise.resolve();assert.equal(h.still.hidden,false);assert.equal(h.video.hidden,true);h.fireTimers(1100);assert.equal(h.dialog.open,false);
});
test('Reduced motion displays a still logo without attempting video playback',()=>{
  const h=loginHarness({reducedMotion:true});h.exec('session=qaArgs;showLoginWelcome()',loginSession('self'));assert.equal(h.stats.plays,0);assert.equal(h.still.hidden,false);assert.equal(h.video.hidden,true);h.fireTimers(1100);assert.equal(h.dialog.open,false);
});
test('Dismissing the welcome stops playback and ignores late media callbacks',()=>{
  const h=loginHarness();h.exec('session=qaArgs;showLoginWelcome()',loginSession('self'));const ended=h.video.onended,error=h.video.onerror;h.run('dismissLoginWelcome()');ended();error();h.fireTimers(4200);h.fireTimers(1100);
  assert.equal(h.dialog.open,false);assert.equal(h.stats.opens,1);assert.equal(h.video.onended,null);assert.equal(h.video.onerror,null);assert.equal(h.video.currentTime,0);assert.equal(h.run('loginWelcomeOwner'),null);assert.equal(h.run('loginWelcomeTimer'),null);assert.equal(h.stats.workspaceFocused,0,'A nonmodal welcome must not steal focus');
});
test('Late callbacks from an earlier same-account intro cannot interrupt its replacement',()=>{
  const h=loginHarness();h.exec('session=qaArgs;showLoginWelcome()',loginSession('self'));const oldEnded=h.video.onended,oldError=h.video.onerror;h.run('dismissLoginWelcome();showLoginWelcome()');oldEnded();oldError();
  assert.equal(h.dialog.open,true);assert.equal(h.video.hidden,false);assert.equal(h.still.hidden,true);assert.equal(h.stats.opens,2);
});
test('A stalled nonmodal welcome automatically dismisses',()=>{
  const h=loginHarness({play:()=>new Promise(()=>{})});h.exec('session=qaArgs;showLoginWelcome()',loginSession('self'));h.fireTimers(4200);assert.equal(h.still.hidden,false);h.fireTimers(400);assert.equal(h.dialog.open,false);
});
test('A queued SIGNED_IN event cannot restore a session after a newer SIGNED_OUT event',()=>{
  const h=loginHarness();let calls=0;h.context.authSpy=()=>calls++;h.run('signedIn=async(newSession)=>{authSpy();session=newSession;}');h.exec("handleAuthStateChange('SIGNED_IN',qaArgs);handleAuthStateChange('SIGNED_OUT',null)",loginSession('self'));h.fireTimers(0);
  assert.equal(calls,0);assert.equal(h.run('session'),null);
});
test('When multiple account events are queued only the latest account is hydrated',()=>{
  const h=loginHarness(),calls=[];h.context.authSpy=id=>calls.push(id);h.run('signedIn=async(newSession)=>{authSpy(newSession?.user.id);session=newSession;}');h.exec("handleAuthStateChange('SIGNED_IN',qaArgs)",loginSession('self'));h.exec("handleAuthStateChange('SIGNED_IN',qaArgs)",loginSession('other'));h.fireTimers(0);
  assert.deepEqual(calls,['other']);assert.equal(h.run('session.user.id'),'other');
});
test('Starting sign out cancels an older queued account event before auth cleanup completes',async()=>{
  const h=loginHarness(),slow=deferred();h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs)',loginSession('self'));
  h.exec("handleAuthStateChange('SIGNED_IN',qaArgs)",loginSession('other'));h.db.auth.signOut=()=>slow.promise;const leaving=h.run('signOut()');h.fireTimers(0);
  assert.equal(h.run('session'),null);assert.equal(h.requests.filter(r=>r.table==='profiles').length,1);slow.resolve({error:null});await leaving;assert.equal(h.run('session'),null);
});

test('Conversation rows escape user content and order messages chronologically',()=>{
  const h=harness();
  h.exec("cache.direct_messages=qaArgs;activePeerId='a';dmThreadPeer=null;",[message('later','self','a','<img src=x onerror=alert(1)>','2026-10-01T08:02:00Z'),message('first')]);
  const markup=h.run("dmStreamMarkup(cache.profiles[1],cache.direct_messages)");
  assert(markup.includes('&lt;img'));assert(!markup.includes('<img src=x'));assert(markup.indexOf('data-message-id="first"')<markup.indexOf('data-message-id="later"'));
});
test('Thread loading requests only the current conversation and a bounded latest batch',async()=>{
  const h=harness();h.run("activePeerId='a';dmThreadPeer='a'");h.queued.push({data:[message('latest')],count:101,error:null});await h.run('loadDmThread(false)');
  const call=h.requests.find(x=>x.table==='direct_messages');
  assert.deepEqual(call.ops.find(op=>op[0]==='range').slice(1),[0,49]);assert.deepEqual(call.ops.filter(op=>op[0]==='in').map(op=>[op[1],Array.from(op[2])]),[['sender_id',['self','a']],['recipient_id',['self','a']]]);
  assert.equal(h.run('dmThreadRows[0].id'),'latest');
});
test('A stale older-page response never changes the new conversation state',async()=>{
  const h=harness(),pending=deferred();h.run("activePeerId='a';dmThreadPeer='a';dmPage=2;");h.queued.push(pending.promise);const prior=h.run('loadDmThread(false)');
  h.run("activePeerId='b';dmThreadPeer='b';dmPage=1;dmThreadRows=[{id:'new-thread'}];dmRequest++;dmThreadLoading=false;");pending.resolve({data:[message('old')],count:1,error:null});await prior;
  assert.equal(h.run('dmPage'),1);assert.equal(h.run('dmThreadRows[0].id'),'new-thread');
});
test('Per-peer drafts survive opening a second conversation',()=>{
  const h=harness();h.run("dmDraftFor('a').text='unfinished Alice';dmDraftFor('b').text='unfinished Bob';activePeerId='a';");
  const markup=h.run('messages()');assert(markup.includes('unfinished Alice'));assert.equal(h.run("dmDraftFor('b').text"),'unfinished Bob');
});
test('A duplicate send is blocked while the first message is pending',async()=>{
  const h=harness(),pending=deferred(),c=composer('a','one message');h.run("activePeerId='a';dmThreadPeer='a';");h.queued.push(pending.promise);const one=h.exec('submit(qaArgs)',c.event);await h.exec('submit(qaArgs)',c.event);
  assert.equal(h.requests.filter(x=>x.ops.some(op=>op[0]==='insert')).length,1);pending.resolve({data:message('sent','self','a','one message'),error:null});await one;assert.equal(h.run("dmSendingPeers.has('a')"),false);
});
test('Send completion respects the original recipient after switching peers',async()=>{
  const h=harness(),pending=deferred(),c=composer('a','for Alice');h.run("activePeerId='a';dmThreadPeer='a';");h.queued.push(pending.promise);const sending=h.exec('submit(qaArgs)',c.event);h.run("activePeerId='b';dmThreadPeer='b';dmThreadRows=[{id:'b-history'}];");pending.resolve({data:message('sent','self','a','for Alice'),error:null});await sending;
  const record=h.requests.find(x=>x.table==='direct_messages').ops.find(op=>op[0]==='insert')[1];assert.equal(record.recipient_id,'a');assert.equal(h.run('dmThreadRows[0].id'),'b-history');assert.equal(h.run("dmLatestMessages.get('a').id"),'sent');
});
test('A draft written in a replacement composer during send is preserved',async()=>{
  const h=harness(),pending=deferred(),c=composer('a','old draft');h.run("activePeerId='a';dmThreadPeer='a';");h.queued.push(pending.promise);const sending=h.exec('submit(qaArgs)',c.event);
  c.form.isConnected=false;h.run("dmDraftFor('a').text='new draft typed after navigating back';");pending.resolve({data:message('sent','self','a','old draft'),error:null});await sending;
  assert.equal(h.run("dmDraftFor('a').text"),'new draft typed after navigating back');
});
test('Failed send leaves draft intact and unlocks the composer',async()=>{
  const h=harness(),c=composer('a','unsent body');h.run("activePeerId='a';dmThreadPeer='a';");h.queued.push({data:null,error:{message:'network interrupted'}});await h.exec('submit(qaArgs)',c.event);
  assert.equal(h.run("dmDraftFor('a').text"),'unsent body');assert.equal(c.send.disabled,false);assert.equal(h.elements.get('#toast').textContent,'network interrupted');
});
test('Optional DM capability failures preserve base messaging',async()=>{
  const h=harness();h.queued.push({data:null,error:{message:'reply column absent'}},{data:null,error:{message:'reactions absent'}});h.rpcQueued.push({data:null,error:{message:'RPC absent'}});
  await h.run('loadDmCapabilities()');assert.equal(h.run('dmReady'),true);assert.equal(h.run('dmRepliesReady||dmReactionsReady||dmInboxReady'),false);
  h.run("activePeerId='a';dmThreadPeer='a';");h.queued.push({data:[message('message-on-old-schema')],count:1,error:null});h.rpcQueued.push({data:null,error:{message:'receipt RPC absent'}});await h.run('loadDmThread(false)');
  assert.equal(h.run('dmThreadError'),'');assert.equal(h.run('dmThreadRows[0].id'),'message-on-old-schema');
});
test('A capability response from a previous account cannot alter the new account',async()=>{
  const h=harness(),pending=deferred();h.queued.push({data:[],error:null},{data:[],error:null});h.rpcQueued.push(pending.promise);const loading=h.run('loadDmCapabilities()');h.run("session={user:{id:'other'}};me={id:'other',role:'member',membership_status:'approved'};");pending.resolve({data:[{peer_id:'secret',message_id:'secret-message',sender_id:'self',body:'old account'}],error:null});await loading;
  assert.equal(h.run('dmUpgradeChecked'),false);assert.equal(h.run("dmLatestMessages.has('secret')"),false);
});
test('The private inbox loads peer previews missing from the global recent-message cache',async()=>{
  const h=harness();h.queued.push({data:[],error:null},{data:[],error:null});h.rpcQueued.push({data:[{peer_id:'private-peer',message_id:'old-private-message',sender_id:'private-peer',body:'older conversation',created_at:'2026-09-01T10:00:00Z'}],error:null});await h.run('loadDmCapabilities()');
  assert.equal(h.run("dmLatestMessages.get('private-peer').recipient_id"),'self');assert.equal(h.run("dmLatestMessages.get('private-peer').id"),'old-private-message');assert(h.run('messages()').includes('data-id="private-peer"'));
});
test('Inbox continuation uses a bounded server offset and merges without dropping prior peers',async()=>{
  const h=harness();h.run("dmInboxReady=true;dmInboxOffset=100;dmLatestMessages.set('prior',{id:'prior-message',sender_id:'prior',recipient_id:'self',created_at:'2026-09-01T00:00:00Z'});");h.rpcQueued.push({data:[{peer_id:'older',message_id:'older-message',sender_id:'self',body:'old',created_at:'2026-08-01T00:00:00Z'}],error:null});await h.run('loadDmInbox(false)');
  assert.deepEqual(JSON.parse(JSON.stringify(h.rpcCalls[0])),{name:'club_dm_inbox',args:{p_limit:100,p_offset:100}});assert.equal(h.run('dmInboxOffset'),101);assert.equal(h.run('dmInboxMore'),false);assert.equal(h.run("dmLatestMessages.has('prior')&&dmLatestMessages.has('older')"),true);
});
test('Reply parent loading stays within the current participant pair',async()=>{
  const h=harness(),reply={...message('reply'),reply_to_id:'parent'};h.run("activePeerId='a';dmThreadPeer='a';dmRepliesReady=true;");h.queued.push({data:[reply],count:1,error:null},{data:[message('parent','self','a','original')],error:null});await h.run('loadDmThread(false)');
  const parent=h.requests.filter(x=>x.table==='direct_messages')[1];assert.deepEqual(parent.ops.filter(op=>op[0]==='in').map(op=>[op[1],Array.from(op[2])]),[['id',['parent']],['sender_id',['self','a']],['recipient_id',['self','a']]]);assert.equal(h.run("dmReplyRows.get('parent').body"),'original');
});
test('Migrated threads load reactions without failing the conversation',async()=>{
  const h=harness();h.run("activePeerId='a';dmThreadPeer='a';dmReactionsReady=true;");h.queued.push({data:[message('with-reaction')],count:1,error:null},{data:[{message_id:'with-reaction',user_id:'a',emoji:'👍'}],count:1,error:null});
  await h.run('loadDmThread(false)');assert.equal(h.run('dmThreadError'),'');assert.equal(h.run('dmReactionRows[0]?.emoji'),'👍');
});
test('Earlier history uses a timestamp-and-ID cursor while keeping latest messages',async()=>{
  const h=harness();h.exec("activePeerId='a';dmThreadPeer='a';dmThreadRows=qaArgs;dmTotal=80;",[message('latest','self','a','latest','2026-10-01T08:00:00Z'),message('cursor','a','self','older','2026-10-01T07:00:00Z')]);h.queued.push({data:[message('earliest','a','self','first','2026-10-01T06:00:00Z')],count:1,error:null});await h.run('loadDmThread(false,true)');
  const q=h.requests.find(x=>x.table==='direct_messages');assert.equal(q.ops.find(op=>op[0]==='or')[1],'created_at.lt.2026-10-01T07:00:00Z,and(created_at.eq.2026-10-01T07:00:00Z,id.lt.cursor)');assert.deepEqual(Array.from(h.run('dmThreadRows.map(m=>m.id)')),['latest','cursor','earliest']);assert.equal(h.run('dmHasMore'),false);
});
test('Read positions are never marked while hidden or away from the latest messages',async()=>{
  const h=harness();h.elements.set('#dmStream',node({dataset:{peer:'a'},scrollTop:0,scrollHeight:800,clientHeight:200}));h.exec("activePeerId='a';dmThreadPeer='a';dmThreadRows=qaArgs;",[message('unread')]);
  await h.run("markDmRead('a')");assert.equal(h.requests.length,0);
  h.elements.get('#dmStream').scrollTop=800;h.context.document.hidden=true;await h.run("markDmRead('a')");assert.equal(h.requests.length,0);
});
test('A newly arrived notice prevents marking messages not covered by loaded history',async()=>{
  const h=harness();h.elements.set('#dmStream',node({dataset:{peer:'a'}}));h.exec("activePeerId='a';dmThreadPeer='a';dmThreadRows=qaArgs;cache.notifications=[{id:'new',kind:'direct_message',target_id:'a',read_at:null}];dmThreadCoveredNotices.set('a',new Set());",[message('unread')]);
  await h.run("markDmRead('a')");assert.equal(h.requests.length,0);
});
test('Marking a read position is scoped to caller and current conversation',async()=>{
  const h=harness();h.elements.set('#dmStream',node({dataset:{peer:'a'}}));h.exec("activePeerId='a';dmThreadPeer='a';dmThreadRows=qaArgs;dmThreadCoveredNotices.set('a',new Set());",[message('unread')]);
  h.queued.push({error:null},{error:null});await h.run("markDmRead('a')");
  const call=h.requests.find(x=>x.table==='direct_message_reads'),position=call.ops.find(op=>op[0]==='upsert')[1];assert.equal(position.user_id,'self');assert.equal(position.peer_id,'a');assert.equal(h.run("cache.direct_message_reads[0].peer_id"),'a');
});

test('Chats shows actual conversations while Find members lists approved club peers',()=>{
  const h=harness();h.exec("cache.direct_messages=qaArgs;cache.profiles.push({id:'pending',full_name:'Pending secret',role:'member',membership_status:'pending'},{id:'investor',full_name:'Investor secret',role:'investor',membership_status:'approved'});",[message('history')]);
  let markup=h.run('messages()');assert(markup.includes('data-id="a"'));assert(!markup.includes('data-id="b"'));action(h,{action:'setDmListView',view:'people'});markup=h.run('messages()');assert(markup.includes('data-id="b"'));assert(!markup.includes('Pending secret'));assert(!markup.includes('Investor secret'));
});
test('Search matches literal wildcard and backslash characters in one scoped conversation',async()=>{
  const h=harness();h.run("activePeerId='a';dmSearchOpen=true;");h.queued.push({data:[message('match')],error:null});const form=node({dataset:{peer:'a'},elements:{query:{value:String.raw`100%_x\y`}}});await h.exec('searchDmConversation(qaArgs)',form);
  const q=h.requests.find(x=>x.table==='direct_messages');assert.equal(q.ops.find(op=>op[0]==='ilike')[2],String.raw`%100\%\_x\\y%`);assert.equal(q.ops.find(op=>op[0]==='limit')[1],50);assert.deepEqual(q.ops.filter(op=>op[0]==='in').map(op=>[op[1],Array.from(op[2])]),[['sender_id',['self','a']],['recipient_id',['self','a']]]);assert.equal(h.run('dmSearchRows[0].id'),'match');
});
test('Stale search results cannot overwrite a second conversation',async()=>{
  const h=harness(),pending=deferred();h.run("activePeerId='a';dmSearchOpen=true;");h.queued.push(pending.promise);const loading=h.exec('searchDmConversation(qaArgs)',node({dataset:{peer:'a'},elements:{query:{value:'old'}}}));h.run("activePeerId='b';dmSearchRequest++;dmSearchRows=[];dmSearchBusy=false;");pending.resolve({data:[message('private-old')],error:null});await loading;assert.equal(h.run('dmSearchRows.length'),0);assert.equal(h.run('dmSearchBusy'),false);
});
test('Reply quotes escape parent text and gracefully handle an unavailable parent',()=>{
  const h=harness();h.exec("dmReplyRows.set('parent',qaArgs);",message('parent','a','self','<script>untrusted</script>'));let quote=h.run("dmQuoteMarkup({reply_to_id:'parent'},cache.profiles[1])");assert(quote.includes('&lt;script&gt;'));assert(!quote.includes('<script>'));quote=h.run("dmQuoteMarkup({reply_to_id:'missing'},cache.profiles[1])");assert(quote.includes('Message unavailable'));
});
test('Read status is based on this peer receipt and only applies to outgoing messages',()=>{
  const h=harness();h.run("dmReceiptsReady=true;dmPeerReceipts.set('a','2026-10-01T08:00:01Z');");h.context.qaMessage=message('outgoing','self','a');let markup=h.run('dmMessageMarkup(qaMessage,cache.profiles[1])');assert(markup.includes('aria-label="Read"'));h.context.qaMessage=message('incoming');markup=h.run('dmMessageMarkup(qaMessage,cache.profiles[1])');assert(!markup.includes('aria-label="Read"'));h.run('dmReceiptsReady=false');h.context.qaMessage=message('outgoing','self','a');markup=h.run('dmMessageMarkup(qaMessage,cache.profiles[1])');assert(markup.includes('aria-label="Sent"'));
});
test('A reply sends its exact parent ID and clears the submitted reply draft',async()=>{
  const h=harness(),c=composer('a','my reply');h.run("activePeerId='a';dmThreadPeer='a';dmRepliesReady=true;dmDraftFor('a').reply={id:'parent',sender_id:'a',recipient_id:'self',body:'original'};");h.queued.push({data:{...message('reply','self','a','my reply'),reply_to_id:'parent'},error:null});await h.exec('submit(qaArgs)',c.event);
  assert.equal(h.requests.find(x=>x.table==='direct_messages').ops.find(op=>op[0]==='insert')[1].reply_to_id,'parent');assert.equal(h.run("dmDraftFor('a').reply"),null);
});
test('A new reply target selected during pending send survives completion',async()=>{
  const h=harness(),pending=deferred(),c=composer('a','my reply');h.run("activePeerId='a';dmThreadPeer='a';dmRepliesReady=true;dmDraftFor('a').reply={id:'old-parent'};");h.queued.push(pending.promise);const sending=h.exec('submit(qaArgs)',c.event);h.run("dmDraftFor('a').reply={id:'new-parent'};");pending.resolve({data:message('reply','self','a','my reply'),error:null});await sending;assert.equal(h.run("dmDraftFor('a').reply.id"),'new-parent');
});
test('Emoji inserts at the selected text and respects composer length',()=>{
  const h=harness(),input=node({value:'hello XYZ world',selectionStart:6,selectionEnd:9});h.elements.set('#dmBody',input);h.run("activePeerId='a'");action(h,{action:'insertDmEmoji',emoji:'👍'});assert.equal(input.value,'hello 👍 world');assert.equal(h.run("dmDraftFor('a').text"),'hello 👍 world');input.value='x'.repeat(3000);input.selectionStart=3000;input.selectionEnd=3000;action(h,{action:'insertDmEmoji',emoji:'👍'});assert.equal(input.value.length,3000);
});
test('Reaction updates affect only the caller and toggling the same emoji removes it',async()=>{
  const h=harness();h.exec("activePeerId='a';dmThreadPeer='a';dmReactionsReady=true;dmThreadRows=[qaArgs];dmReactionRows=[{message_id:'react',user_id:'a',emoji:'👍'}];",message('react'));h.queued.push({error:null});await h.run("setDmReaction('react','👍')");let record=h.requests.find(x=>x.table==='direct_message_reactions').ops.find(op=>op[0]==='insert')[1];assert.equal(record.user_id,'self');assert.equal(h.run('dmReactionRows.length'),2);
  h.queued.push({error:null});await h.run("setDmReaction('react','👍')");const call=h.requests.filter(x=>x.table==='direct_message_reactions')[1];assert.deepEqual(call.ops.filter(op=>op[0]==='eq').map(op=>op.slice(1)),[['message_id','react'],['user_id','self']]);assert.equal(h.run('dmReactionRows.length'),1);assert.equal(h.run('dmReactionRows[0].user_id'),'a');
});
test('Invalid and unavailable reaction actions do not write to the database',async()=>{
  const h=harness();h.exec("activePeerId='a';dmThreadPeer='a';dmThreadRows=[qaArgs];",message('react'));await h.run("setDmReaction('react','👍')");assert.equal(h.requests.length,0);h.run('dmReactionsReady=true');await h.run("setDmReaction('react','invalid')");await h.run("setDmReaction('missing','👍')");assert.equal(h.requests.length,0);
});
for(const role of ['guest','pending','member','teacher','founder','investor','admin'])test(`Workspace search enforces ${role} destinations and content visibility`,()=>{
  const h=harness();h.run("cache.courses=[{id:'workshop',title:'Sensor project',category:'Electronics',description:'Calibration'}];cache.projects=[{id:'build',title:'Robot build',status:'planning',summary:'Stepper motors'}];cache.events=[{id:'meeting',title:'Robot demo',starts_at:'2026-10-02T10:00:00Z'}];cache.documents=[{id:'manual',title:'Sensor manual'}];cache.news_posts=[{id:'published',title:'Published technology',status:'published'},{id:'pending-news',title:'Pending article',status:'pending'}];cache.profiles.push({id:'pending-member',full_name:'Pending applicant',role:'member',membership_status:'pending'},{id:'investor-member',full_name:'Investor Person',role:'investor',membership_status:'approved'});");
  if(role==='guest')h.run('session=null;me=null;');else if(role==='pending')h.run("me.membership_status='pending'");else h.exec('me.role=qaArgs;',role);
  const keys=Array.from(h.run('workspaceSearchItems().map(r=>r.key)'));
  assert(keys.includes('page:home'));assert(keys.includes('page:privacy'));assert(!keys.includes('member:pending-member'));assert(!keys.includes('member:investor-member'));assert(!keys.includes('news:pending-news'));
  const club=['member','teacher','founder','admin'].includes(role);assert.equal(keys.includes('page:messages'),club);assert.equal(keys.includes('course:workshop'),club);assert.equal(keys.includes('project:build'),club);assert.equal(keys.includes('member:a'),club);
  assert.equal(keys.includes('page:teaching'),['teacher','admin'].includes(role));assert.equal(keys.includes('page:founder-room'),['founder','admin'].includes(role));assert.equal(keys.includes('page:finance'),role==='admin');assert.equal(keys.includes('page:finance-review'),false);assert.equal(keys.includes('page:investor-portal'),['investor','admin'].includes(role));assert.equal(keys.includes('page:application'),role==='pending');
  if(club)assert(keys.includes('news:published'),'Published technology news must be searchable');
});
test('Workspace search matches terms across record content and bounds result count',()=>{
  const h=harness();h.run("cache.projects=[{id:'build',title:'Robot prototype',status:'planning',summary:'Stepper motors and sensors'}];");assert.equal(h.run("workspaceSearchMatches('ROBOT sensors')[0].key"),'project:build');assert.equal(h.run("workspaceSearchMatches('robot lunar').length"),0);h.run("cache.projects=Array.from({length:70},(_,i)=>({id:String(i),title:'Bench sensor '+i,summary:'calibration'}));");assert.equal(h.run("workspaceSearchMatches('sensor').length"),30);
});
test('A stale administrator search result cannot navigate after losing the role',()=>{
  const h=harness();h.run("me.role='admin'");assert(h.run("workspaceSearchItems().some(r=>r.key==='page:finance')"));h.run("me.role='member'");const prior=h.context.location.hash;action(h,{action:'workspaceResult',key:'page:finance'});assert.equal(h.context.location.hash,prior);
});
test('DM hashes support browser Back to the conversation list and reject malformed peer IDs',()=>{
  const h=harness(),peer='11111111-1111-1111-1111-111111111111';h.run("setSidebarOpen=()=>{};loadDmThread=async()=>{};authReady=true;");h.context.location.hash='#messages/'+peer;h.run('route()');assert.equal(h.run('activePeerId'),peer);h.context.location.hash='#messages';h.run('route()');assert.equal(h.run('activePeerId'),null);h.context.location.hash='#messages/not-an-id';h.run('route()');assert.equal(h.run('activePeerId'),null);assert.equal(h.run('page'),'messages');
});
test('Sending from a thread with earlier history retains all loaded messages',async()=>{
  const h=harness(),c=composer('a','newest');h.exec("activePeerId='a';dmThreadPeer='a';dmThreadRows=qaArgs;dmTotal=80;dmHasMore=true;",Array.from({length:70},(_,i)=>message('history-'+i,'a','self','history','2026-09-01T08:00:00Z')));h.queued.push({data:message('new','self','a','newest'),error:null});await h.exec('submit(qaArgs)',c.event);assert.equal(h.run('dmThreadRows.length'),71);assert.equal(h.run('dmThreadRows[0].id'),'new');assert.equal(h.run("dmThreadRows.some(m=>m.id==='history-69')"),true);
});
test('Concurrent reaction requests for one message do not produce duplicate writes',async()=>{
  const h=harness(),pending=deferred();h.exec("activePeerId='a';dmThreadPeer='a';dmReactionsReady=true;dmThreadRows=[qaArgs];",message('react'));h.queued.push(pending.promise,{error:null});const first=h.run("setDmReaction('react','👍')");const second=h.run("setDmReaction('react','👍')");pending.resolve({error:null});await Promise.all([first,second]);assert.equal(h.requests.filter(x=>x.table==='direct_message_reactions').length,1);
});
test('Workspace result markup safely escapes labels and metadata',()=>{
  const h=harness();h.elements.set('#workspaceSearchResults',node());h.elements.set('#workspaceSearchStatus',node());h.run("cache.projects=[{id:'unsafe\"id',title:'<img onerror=alert(1)>',status:'<script>x</script>',summary:'lookup'}];updateWorkspaceSearch('lookup');");const markup=h.elements.get('#workspaceSearchResults').innerHTML;assert(markup.includes('&lt;img'));assert(markup.includes('&lt;script&gt;'));assert(!markup.includes('<img onerror'));assert(!markup.includes('<script>'));assert(markup.includes('unsafe&quot;id'));
});
test('Document search result invokes the existing authorized download action',async()=>{
  const h=harness();h.run("cache.documents=[{id:'manual',title:'Sensor manual'}];downloadDocument=async id=>{globalThis.openedDocument=id;};");await action(h,{action:'workspaceResult',key:'document:manual'});assert.equal(h.run('openedDocument'),'manual');
});
test('Event search result opens the matching calendar details',()=>{
  const h=harness();h.exec('cache.events=[qaArgs];',{id:'event',title:'Workshop showcase',description:'Bring your builds',starts_at:new Date(Date.now()+3600000).toISOString(),ends_at:new Date(Date.now()+7200000).toISOString()});action(h,{action:'workspaceResult',key:'event:event'});assert(h.elements.get('#modalContent').innerHTML.includes('Workshop showcase'));assert.equal(h.elements.get('#modal').open,true);
});
test('Course search opens the relevant catalog or the enrolled classroom',()=>{
  const h=harness();h.run("cache.courses=[{id:'course',title:'Bench build',category:'Electronics'}];cache.course_enrollments=[];");action(h,{action:'workspaceResult',key:'course:course'});assert.equal(h.run('courseView'),'explore');assert.equal(h.context.location.hash,'#courses');h.run("cache.course_enrollments=[{course_id:'course',learner_id:'self',status:'enrolled'}];");action(h,{action:'workspaceResult',key:'course:course'});assert.equal(h.run('courseView'),'mine');assert.equal(h.run('activeCourseId'),'course');
});
for(const role of ['member','teacher','founder','admin'])test(`Personal home prioritizes the ${role} role and authorized agenda`,()=>{
  const h=harness(),future=new Date(Date.now()+3600000).toISOString();h.exec("me.role=qaArgs.role;courseReady=true;coursePlanningReady=true;cache.events=[{id:'event',title:'Club showcase',starts_at:qaArgs.future}];cache.courses=[{id:'mine',title:'Enrolled workshop',category:'Electronics',starts_at:qaArgs.future},{id:'assigned',title:'Assigned teaching workshop',category:'Electronics',instructor_id:'self',starts_at:qaArgs.future}];cache.course_enrollments=[{course_id:'mine',learner_id:'self',status:'enrolled'}];cache.founder_meetings=[{id:'private',title:'Private founders meeting',starts_at:qaArgs.future}];cache.project_tasks=[{id:'own',title:'My task',assignee_id:'self',status:'open',due_at:qaArgs.future},{id:'other',title:'Another member task',assignee_id:'a',status:'open',due_at:qaArgs.future}];",{role,future});
  const markup=h.run('home()');assert(markup.includes('Welcome back'));assert(markup.includes('Enrolled workshop'));assert(markup.includes('My task'));assert(!markup.includes('Another member task'));assert.equal(markup.includes('Assigned teaching workshop'),['teacher','admin'].includes(role),'Former teaching assignments must not create inaccessible member agenda rows');assert.equal(markup.includes('Private founders meeting'),['founder','admin'].includes(role));assert.equal(markup.includes('ADMINISTRATOR · APPLICATIONS'),role==='admin');assert.equal(markup.includes('TEACHER · PROJECT REVIEWS'),role==='teacher');assert.equal(markup.includes('FOUNDER · NEXT MEETING'),role==='founder');
});
test('Founder teaching enablement adds the appropriate review priority',()=>{
  const h=harness();h.run("me.role='founder';me.founder_teaching_enabled=true;");assert(h.run('home()').includes('TEACHING LEAD · REVIEWS'));h.run('me.founder_teaching_enabled=false');assert(!h.run('home()').includes('TEACHING LEAD · REVIEWS'));
});
test('Investor and guest home exclude private club agenda and priorities',()=>{
  const h=harness();h.run("cache.founder_meetings=[{id:'private',title:'Secret founder call',starts_at:new Date(Date.now()+3600000).toISOString()}];me.role='investor'");let markup=h.run('home()');assert(markup.includes('Investor portal'));assert(!markup.includes('Secret founder call'));assert(!markup.includes('Your agenda'));h.run('session=null;me=null');markup=h.run('home()');assert(!markup.includes('Secret founder call'));assert(!markup.includes('Your agenda'));assert(!markup.includes('ADMINISTRATOR'));
});
test('Agenda keeps overdue own tasks, drops past events, limits rows, and escapes recent content',()=>{
  const h=harness();h.exec("cache.events=qaArgs.events;cache.project_tasks=qaArgs.tasks;cache.activity_posts=qaArgs.posts;",{events:[{id:'old',title:'Past event hidden',starts_at:new Date(Date.now()-7200000).toISOString()},...Array.from({length:6},(_,i)=>({id:'e'+i,title:'Future '+i,starts_at:new Date(Date.now()+(i+1)*3600000).toISOString()}))],tasks:[{id:'late',title:'Late own task',assignee_id:'self',status:'open',due_at:new Date(Date.now()-3600000).toISOString()},{id:'done',title:'Done task hidden',assignee_id:'self',status:'done',due_at:new Date(Date.now()-3600000).toISOString()}],posts:[{id:'post',title:'<script>unsafe</script>',body:'<img onerror=alert(1)>',author_id:'a',created_at:new Date().toISOString()}]});
  const markup=h.run("homeAgendaMarkup('self',new Set(),[])");assert(markup.includes('Late own task'));assert(markup.includes('Past due'));assert(!markup.includes('Past event hidden'));assert(!markup.includes('Done task hidden'));assert.equal((markup.match(/class="home-agenda-item"/g)||[]).length,5);assert(markup.includes('&lt;script&gt;'));assert(markup.includes('&lt;img'));assert(!markup.includes('<script>'));
});
test('Agenda task and meeting actions respect caller visibility and role',()=>{
  const h=harness();h.exec("cache.project_tasks=[qaArgs.task];cache.founder_meetings=[qaArgs.meeting];",{task:{id:'task',title:'Own deadline',assignee_id:'self',project_id:'project',due_at:new Date(Date.now()+3600000).toISOString()},meeting:{id:'private',title:'Private leadership call',starts_at:new Date(Date.now()+3600000).toISOString()}});action(h,{action:'calendarItem',kind:'task',id:'task'});assert(h.elements.get('#modalContent').innerHTML.includes('Own deadline'));h.elements.get('#modalContent').innerHTML='';action(h,{action:'calendarItem',kind:'meeting',id:'private'});assert.equal(h.elements.get('#modalContent').innerHTML,'');h.run("me.role='founder'");action(h,{action:'calendarItem',kind:'meeting',id:'private'});assert(h.elements.get('#modalContent').innerHTML.includes('Private leadership call'));
});
test('Read receipts and alert updates cannot advance beyond the displayed thread snapshot',async()=>{
  const h=harness(),inboundAt=new Date(Date.now()-600000).toISOString(),displayedAt=new Date(Date.now()-500000).toISOString();h.elements.set('#dmStream',node({dataset:{peer:'a'}}));h.exec("activePeerId='a';dmThreadPeer='a';dmThreadRows=qaArgs;cache.notifications=[{id:'covered',user_id:'self',kind:'direct_message',target_id:'a',created_at:qaArgs[1].created_at,read_at:null}];dmThreadCoveredNotices.set('a',new Set(['covered']));",[message('newest-displayed','self','a','sent',displayedAt),message('newest-inbound','a','self','received',inboundAt)]);h.queued.push({error:null},{error:null});await h.run("markDmRead('a')");
  const position=h.requests.find(x=>x.table==='direct_message_reads').ops.find(op=>op[0]==='upsert')[1];assert(new Date(position.last_read_at)<=new Date(displayedAt),'Receipt skips messages arriving after the displayed snapshot');assert(new Date(position.last_read_at)>=new Date(inboundAt),'Displayed incoming messages are marked read');const alert=h.requests.find(x=>x.table==='notifications');const bound=alert?.ops.find(op=>op[0]==='lte'&&op[1]==='created_at');if(bound)assert(new Date(bound[2])<=new Date(displayedAt),'Notification read boundary must be no newer than the displayed snapshot');
});
for(const replacementPhoto of [false,true])test(`Pending photo send unlocks replacement composer and ${replacementPhoto?'retains a new selection':'clears its submitted selection'}`,async()=>{
  const h=harness(),pending=deferred(),c=composer('a','caption'),submitted={name:'old.png',type:'image/png',size:100},next={name:'new.png',type:'image/png',size:100},send=node({disabled:true}),picker=node({value:replacementPhoto?'new.png':'old.png'});let removed=false;const preview=node({remove(){removed=true;}}),current=node({querySelector(selector){return selector==='.dm-image-preview'?preview:selector==='[name=dm_image]'?picker:null;}});
  h.elements.set('#dmComposer',current);h.elements.set('#dmComposer [type=submit]',send);h.exec("activePeerId='a';dmThreadPeer='a';mediaReady=true;dmDraftFor('a').file=qaArgs;dmDraftFor('a').url='blob:submitted';uploadClubImage=async()=> 'self/image.png';hydrateMedia=async()=>false;",submitted);h.queued.push(pending.promise);const sending=h.exec('submit(qaArgs)',c.event);await Promise.resolve();c.form.isConnected=false;c.send.isConnected=false;if(replacementPhoto)h.exec("dmDraftFor('a').file=qaArgs;dmDraftFor('a').url='blob:replacement';",next);pending.resolve({data:{...message('photo','self','a','caption'),image_path:'self/image.png'},error:null});await sending;
  assert.equal(send.disabled,false);assert.equal(removed,!replacementPhoto);assert.equal(picker.value,replacementPhoto?'new.png':'');assert.equal(h.run("dmDraftFor('a').file"),replacementPhoto?next:null);assert.equal(h.run("dmSendingPeers.has('a')"),false);
});

// Navigation fixtures use the actual sidebar markup, so moved links stay covered.
function navigationHarness(){
  const h=harness(),html=fs.readFileSync(root+'/index.html','utf8');
  const navHtml=html.slice(html.indexOf('<nav id="nav"'),html.indexOf('</nav>',html.indexOf('<nav id="nav"')));
  const links=new Map();
  for(const match of navHtml.matchAll(/<a\s+[^>]*data-page="([^"]+)"[^>]*>/g)){
    const attributes=new Map(),classes=new Set();
    const link=node({dataset:{page:match[1]},hidden:/\shidden(?:\s|>)/.test(match[0]),setAttribute(key,value){attributes.set(key,value);},removeAttribute(key){attributes.delete(key);},getAttribute(key){return attributes.get(key)??null;},classList:{toggle(key,on){if(on)classes.add(key);else classes.delete(key);},contains(key){return classes.has(key);}}});
    links.set(match[1],link);
  }
  const sections=new Map();
  for(const match of navHtml.matchAll(/<details\s+([^>]*data-nav-group="([^"]+)"[^>]*)>([\s\S]*?)<\/details>/g)){
    const children=[...match[3].matchAll(/data-page="([^"]+)"/g)].map(m=>links.get(m[1]));
    sections.set(match[2],node({dataset:{navGroup:match[2]},open:/\bopen\b/.test(match[1]),querySelectorAll(){return children;}}));
  }
  h.elements.set('#nav',node({querySelectorAll(selector){return selector==='a[data-page]'?[...links.values()]:[...sections.values()];}}));
  h.elements.set('#workspaceLabel',node());h.run("page='home';sidebarContext='';sidebarPage='';");
  return {...h,links,sections};
}
for(const role of ['guest','pending','member','teacher','founder','investor','admin'])test(`Organized sidebar preserves ${role} permissions and every allowed destination`,()=>{
  const h=navigationHarness();
  if(role==='guest')h.run('session=null;me=null;');else if(role==='pending')h.run("me.membership_status='pending'");else h.exec('me.role=qaArgs;',role);
  h.run('updateWorkspaceNavigation()');
  const expected=Array.from(h.run("workspaceSearchItems().filter(r=>r.key.startsWith('page:')).map(r=>r.page)")).sort();
  const actual=[...h.links].filter(([_,link])=>!link.hidden).map(([id])=>id).sort();
  assert.deepEqual(actual,expected);
  assert.equal(h.links.get('finance').hidden,role!=='admin');
  assert.equal(h.links.get('investors').hidden,!['admin','founder'].includes(role));
  assert.equal(h.links.has('finance-review'),false);assert.equal(h.links.get('officers').hidden,role!=='admin');
  for(const section of h.sections.values())assert.equal(section.hidden,!section.querySelectorAll().some(link=>!link.hidden));
  assert.equal(h.links.get('home').getAttribute('aria-current'),'page');
});
test('Navigation opens the current section while respecting a manual collapse during background refresh',()=>{
  const h=navigationHarness();h.run('updateWorkspaceNavigation()');
  assert.equal(h.sections.get('learning').open,true);assert.equal(h.sections.get('community').open,false);
  h.run("page='channels';updateWorkspaceNavigation()");assert.equal(h.sections.get('community').open,true);assert.equal(h.links.get('channels').getAttribute('aria-current'),'page');assert.equal(h.links.get('home').getAttribute('aria-current'),null);
  h.sections.get('community').open=false;h.run('updateWorkspaceNavigation()');assert.equal(h.sections.get('community').open,false);
  h.run("page='home';updateWorkspaceNavigation();page='feed';updateWorkspaceNavigation()");assert.equal(h.sections.get('community').open,true);
});
test('Role changes update groups and remove teaching, finance and investor shortcuts immediately',()=>{
  const h=navigationHarness();h.run("me.role='admin';updateWorkspaceNavigation()");assert.equal(h.sections.get('administration').open,true);assert.equal(h.links.get('finance').hidden,false);
  h.run("me.role='member';updateWorkspaceNavigation()");assert.equal(h.sections.get('administration').hidden,true);assert.equal(h.sections.get('administration').open,false);assert.equal(h.sections.get('leadership').hidden,true);assert.equal(h.links.get('teaching').hidden,true);
  h.run("me.role='founder';me.founder_teaching_enabled=true;updateWorkspaceNavigation()");assert.equal(h.links.get('teaching').hidden,false);assert.equal(h.sections.get('leadership').open,true);
  h.run("me.founder_teaching_enabled=false;updateWorkspaceNavigation()");assert.equal(h.links.get('teaching').hidden,true);
});
test('Renamed pages remain discoverable using familiar search terms',()=>{
  const h=harness();
  for(const [term,id,title] of [['Inbox','notifications','Notifications'],['Channels','channels','Team chat'],['Courses','courses','My learning'],['Document library','library','Shared files']]){
    const result=h.exec("workspaceSearchMatches(qaArgs.term).find(r=>r.key==='page:'+qaArgs.id)",{term,id});assert(result);assert.equal(result.label,title);
  }
});
test('A new member gets one learning starting point instead of four empty work cards',()=>{
  const h=harness();h.run("page='home';courseReady=true;cache.courses=[];cache.course_enrollments=[];cache.course_submissions=[];cache.project_tasks=[];cache.events=[];");
  const markup=h.run('home()');assert(markup.includes('Start with a practical workshop'));assert(!markup.includes('No feedback yet'));assert(!markup.includes('No tasks assigned'));assert.equal((markup.match(/class="home-focus-card /g)||[]).length,0);
});
test('Home workshops and feedback open the exact enrolled classroom and appropriate tab',()=>{
  const h=harness(),future=new Date(Date.now()+3600000).toISOString();
  h.exec("courseReady=true;cache.courses=[{id:'build',title:'My build',starts_at:qaArgs}];cache.course_enrollments=[{course_id:'build',learner_id:'self',status:'completed'}];cache.course_submissions=[{course_id:'build',learner_id:'self',review_status:'accepted',teacher_feedback:'Well tested.',reviewed_at:qaArgs}];",future);
  const feedback=h.run('personalHome()');assert(feedback.includes('data-id="build" data-view="feedback"'));assert(feedback.includes('Read teacher feedback'));
  action(h,{action:'focusCourse',id:'build',view:'feedback'});assert.equal(h.run('activeCourseId'),'build');assert.equal(h.run('courseDetailView'),'feedback');assert.equal(h.run('courseView'),'mine');
  h.run("cache.course_enrollments[0].status='enrolled'");assert(h.run('personalHome()').includes('data-id="build" data-view="overview"'));
  action(h,{action:'focusCourse',id:'build',view:'invalid'});assert.equal(h.run('courseDetailView'),'overview');
  h.run('cache.course_enrollments=[]');action(h,{action:'focusCourse',id:'build',view:'feedback'});assert.equal(h.run('courseView'),'explore');assert.equal(h.run('courseDetailView'),'overview');assert(!h.run('personalHome()').includes('Read teacher feedback'));
});
test('Home direct-message count excludes channel messages and opens the correct inbox',()=>{
  const h=harness();h.run("page='home';unreadCountsReady=true;unreadCounts={channels:{general:9},direct_total:2,direct_messages:{},direct_peers:[]};");
  const markup=h.run('home()');assert(markup.includes('<a href="#messages"><small>Unread direct messages</small><strong>2</strong>'));assert(!markup.includes('<strong>11</strong>'));
});
test('Learner views direct teachers to Teaching studio without duplicate publishing controls',()=>{
  const h=harness();h.run("page='courses';me.role='teacher';courseReady=true;courseView='mine';cache.courses=[];cache.course_enrollments=[];");
  const markup=h.run('courses()');assert(markup.includes('Teaching studio →'));assert(!markup.includes('data-action="courseForm"'));assert(!markup.includes('data-action="learningForm"'));assert(markup.includes('Browse workshops'));
});
test('Page guides distinguish private messages from team chat and stay out of investor and guest views',()=>{
  const h=harness();assert(h.run("pageGuide('messages')").includes('href="#channels"'));assert(h.run("pageGuide('channels')").includes('href="#messages"'));
  h.run("me.role='investor'");assert.equal(h.run("pageGuide('messages')"),'');h.run('session=null;me=null;');assert.equal(h.run("pageGuide('library')"),'');
});

// Calendar dates use local calendar days; stored event instants retain their timezone.
function calendarHarness(){
  const h=harness();h.run("page='calendar';calendarSelected=new Date(2026,9,1,12);calendarMonth=new Date(2026,9,1);calendarView='month';courseReady=true;coursePlanningReady=true;calendarPreferences={weekStart:1,compact:false,kinds:Object.keys(calendarKinds),mine:false,track:'all',response:'all',online:false,hidePast:false};cache.events=[];cache.founder_meetings=[];cache.project_tasks=[];cache.courses=[];cache.course_enrollments=[];cache.course_completions=[];cache.event_rsvps=[];cache.founder_meeting_rsvps=[];");
  h.context.location.href='https://example.test/SPACE/#calendar';h.context.history.replaceState=(_state,_title,hash)=>{h.context.location.hash=hash;};return h;
}
const calEvent=(id,start='2026-10-01T10:00:00',end='2026-10-01T11:00:00',extra={})=>({id,title:'Workshop '+id,starts_at:start,ends_at:end,...extra});
test('Calendar accepts real dates and rejects normalized invalid days and out-of-range years',()=>{
  const h=calendarHarness();assert(h.run("calendarParseDay('2028-02-29')"));for(const bad of ['2026-02-29','2026-04-31','2026-13-01','2026-00-01','2026-10-00','2026-10-32','1899-01-01','2101-01-01','2026-1-1','bad'])assert.equal(h.exec('calendarParseDay(qaArgs)',bad),null,bad);
});
test('Calendar month and year changes clamp the date instead of skipping short months',()=>{
  const h=calendarHarness();assert.equal(h.run("calendarDayKey(calendarShiftMonth(new Date(2028,0,31,12),1))"),'2028-02-29');assert.equal(h.run("calendarDayKey(calendarShiftMonth(new Date(2028,1,29,12),12))"),'2029-02-28');h.run("calendarSelected=new Date(2026,11,31,12);calendarMove(1)");assert.equal(h.run('calendarDayKey(calendarSelected)'),'2027-01-31');
});
test('Week boundaries honor Monday or Sunday and cross year boundaries correctly',()=>{
  const h=calendarHarness();h.run("calendarSelected=new Date(2027,0,1,12);calendarView='week';");assert.equal(h.run('calendarDayKey(calendarRange().start)'),'2026-12-28');assert.equal(h.run('calendarDayKey(calendarRange().end)'),'2027-01-04');h.run('calendarPreferences.weekStart=0');assert.equal(h.run('calendarDayKey(calendarRange().start)'),'2026-12-27');
});
test('Day and agenda navigation use calendar days across daylight saving changes',()=>{
  const h=calendarHarness();h.run("calendarView='day';calendarSelected=new Date(2026,2,8,12);calendarMove(1)");assert.equal(h.run('calendarDayKey(calendarSelected)'),'2026-03-09');h.run("calendarView='agenda';calendarSelected=new Date(2026,2,1,12)");assert.equal(h.run('calendarDayKey(calendarRange().end)'),'2026-03-31');
});
test('Multi-day events occupy every covered date and stop at an exclusive midnight end',()=>{
  const h=calendarHarness();h.exec('cache.events=[qaArgs]',calEvent('camp','2026-10-01T10:00:00','2026-10-03T00:00:00'));
  for(const [day,count]of [[1,1],[2,1],[3,0]])assert.equal(h.exec('calendarBetween(calendarEntries(),new Date(2026,9,qaArgs),new Date(2026,9,qaArgs+1)).length',day),count);
});
test('Month view includes 42 selectable dates and handles overflow dates without blanks',()=>{
  const h=calendarHarness();const markup=h.run('calendarPage()');assert.equal((markup.match(/class="cal-date"/g)||[]).length,42);assert(markup.includes('data-date="2026-09-28"'));assert(markup.includes('<span>Mon</span>'));action(h,{action:'calendarDay',date:'2026-09-28'});assert.equal(h.run('calendarSelected.getMonth()'),8);const previous=h.run('calendarDayKey(calendarSelected)');action(h,{action:'calendarDay',date:'2026-02-31'});assert.equal(h.run('calendarDayKey(calendarSelected)'),previous);
});
for(const role of ['guest','pending','investor','member','teacher','founder','admin'])test(`Calendar sources and exported entries honor ${role} permissions`,()=>{
  const h=calendarHarness();h.run("cache.events=[{id:'event',title:'Club event',starts_at:'2026-10-01T10:00:00'}];cache.founder_meetings=[{id:'private',title:'Founder-only agenda',starts_at:'2026-10-01T12:00:00'}];cache.courses=[{id:'joined',title:'Joined workshop',starts_at:'2026-10-01T09:00:00'},{id:'own',title:'My teaching workshop',instructor_id:'self',starts_at:'2026-10-01T09:00:00'},{id:'other',title:'Other teacher workshop',instructor_id:'someone',starts_at:'2026-10-01T09:00:00'}];cache.course_enrollments=[{course_id:'joined',learner_id:'self'}];");
  if(role==='guest')h.run('session=null;me=null');else if(role==='pending')h.run("me.membership_status='pending'");else h.exec('me.role=qaArgs',role);
  const ids=Array.from(h.run('calendarEntries().map(item=>item.id)'));const club=['member','teacher','founder','admin'].includes(role);assert.equal(ids.includes('event'),club);assert.equal(ids.includes('private'),['founder','admin'].includes(role));assert.equal(ids.includes('joined'),club);assert.equal(ids.includes('own'),['teacher','admin'].includes(role));assert.equal(ids.includes('other'),role==='admin');const exportText=h.run('calendarIcs(calendarEntries())');assert.equal(exportText.includes('Founder-only agenda'),['founder','admin'].includes(role));
});
test('Completed learner workshops and done project tasks do not leave stale deadlines',()=>{
  const h=calendarHarness();h.run("cache.courses=[{id:'done',title:'Complete',starts_at:'2026-10-01T09:00:00',submission_due_at:'2026-10-01T11:00:00'}];cache.course_enrollments=[{course_id:'done',learner_id:'self',status:'completed'}];cache.project_tasks=[{id:'done-task',title:'Done task',status:'done',due_at:'2026-10-01T11:00:00'},{id:'open-task',title:'Open task',status:'open',due_at:'2026-10-01T11:00:00'}]");const keys=Array.from(h.run('calendarEntries().map(calendarKey)'));assert(!keys.includes('course_due:done'));assert(!keys.includes('task:done-task'));assert(keys.includes('task:open-task'));h.run("me.role='admin'");assert(h.run("calendarEntries().some(item=>item.kind==='course_due')"));
});
test('Personal filters keep assigned tasks, enrolled courses and accepted attendance',()=>{
  const h=calendarHarness();h.run("calendarPreferences.mine=true;cache.events=[{id:'yes',title:'Going',starts_at:'2026-10-01T10:00:00'},{id:'no',title:'Unanswered',starts_at:'2026-10-01T11:00:00'}];cache.event_rsvps=[{event_id:'yes',user_id:'self',response:'going'}];cache.project_tasks=[{id:'mine',title:'Own task',assignee_id:'self',status:'open',due_at:'2026-10-01T10:00:00'},{id:'other',title:'Other task',assignee_id:'a',status:'open',due_at:'2026-10-01T10:00:00'}]");assert.deepEqual(Array.from(h.run('calendarFilteredEntries().map(item=>item.id)')),['yes','mine']);
});
test('Search and category, track, attendance, online and future filters compose correctly',()=>{
  const h=calendarHarness();h.exec('cache.events=qaArgs',[calEvent('online',undefined,undefined,{title:'Robot build',location:'Online'}),calEvent('hall',undefined,undefined,{title:'Robot build',location:'Club room'})]);h.run("calendarSearch='robot';calendarPreferences.online=true");assert.deepEqual(Array.from(h.run('calendarFilteredEntries().map(item=>item.id)')),['online']);h.run("calendarPreferences.response='going';cache.event_rsvps=[{event_id:'online',user_id:'self',response:'going'}]");assert.equal(h.run('calendarFilteredEntries().length'),1);h.run("calendarPreferences.kinds=['task']");assert.equal(h.run('calendarFilteredEntries().length'),0);h.run("calendarPreferences.kinds=Object.keys(calendarKinds);calendarPreferences.response='all';calendarPreferences.online=false;calendarSearch='';calendarPreferences.track='AI and Machine Learning'");assert.equal(h.run('calendarFilteredEntries().length'),0);
  h.exec('cache.events=qaArgs',[calEvent('past',new Date(Date.now()-7200000).toISOString(),new Date(Date.now()-3600000).toISOString()),calEvent('ongoing',new Date(Date.now()-3600000).toISOString(),new Date(Date.now()+3600000).toISOString())]);h.run("calendarPreferences.track='all';calendarPreferences.hidePast=true");assert.deepEqual(Array.from(h.run('calendarFilteredEntries().map(item=>item.id)')),['ongoing']);
});
test('Conflict warnings ignore touching endpoints, deadlines and unrelated sessions',()=>{
  const h=calendarHarness();h.exec('cache.events=qaArgs',[calEvent('a'),calEvent('b','2026-10-01T10:30:00','2026-10-01T11:30:00'),calEvent('touch','2026-10-01T11:30:00','2026-10-01T12:30:00'),calEvent('unanswered','2026-10-01T10:20:00','2026-10-01T10:50:00')]);h.run("cache.event_rsvps=['a','b','touch'].map(event_id=>({event_id,user_id:'self',response:'going'}));cache.project_tasks=[{id:'due',title:'Due',assignee_id:'self',status:'open',due_at:'2026-10-01T10:20:00'}]");assert.deepEqual(Array.from(h.run('calendarConflicts(calendarEntries())')).sort(),['event:a','event:b']);
});
test('Agenda pagination is bounded while view exports and printable lists include every matching record',()=>{
  const h=calendarHarness();h.run("calendarView='agenda';cache.events=Array.from({length:65},(_,i)=>({id:'item-'+i,title:'Event '+i,starts_at:'2026-10-01T10:00:00',ends_at:'2026-10-01T11:00:00'}));calendarDownload=items=>{globalThis.exportedItems=items;};");const markup=h.run('calendarPage()');const list=markup.slice(markup.indexOf('<div class="cal-list-board">'),markup.indexOf('<aside class="cal-agenda">'));assert.equal((list.match(/class="cal-agenda-item cal-entry/g)||[]).length,30);h.elements.set('#calendarPrintList',node());h.run('prepareCalendarPrint()');assert.equal((h.elements.get('#calendarPrintList').innerHTML.match(/<article><strong>Event /g)||[]).length,65);action(h,{action:'calendarExport'});assert.equal(h.run('exportedItems.length'),65);action(h,{action:'calendarPage',offset:'1'});assert.equal(h.run('calendarAgendaPage'),1);action(h,{action:'calendarPage',offset:'1'});assert.equal(h.run('calendarAgendaPage'),2);action(h,{action:'calendarPage',offset:'1'});assert.equal(h.run('calendarAgendaPage'),2);
});
test('Calendar event details use valid fallback end times for missing or invalid ends',()=>{
  const h=calendarHarness();for(const ends_at of [null,'invalid','2026-09-30T10:00:00']){h.exec('qaEvent=qaArgs',calEvent('missing','2026-10-01T10:00:00Z',ends_at));assert.equal(h.run('calendarEnd(qaEvent).toISOString()'),'2026-10-01T11:00:00.000Z');assert(h.run('calendarIcs([qaEvent])').includes('DTEND:20261001T110000Z'));}
});
test('ICS exports escape newlines and fold Unicode lines within 75 UTF-8 bytes',()=>{
  const h=calendarHarness();h.exec('qaEvent=qaArgs',calEvent('unicode','2026-10-01T10:00:00Z',null,{title:'Robot 🤖 '.repeat(30),description:'Line one\r\nBEGIN:VEVENT\nText, with; slashes\\'}));const output=h.run('calendarIcs([qaEvent])');assert.equal((output.match(/\r\nBEGIN:VEVENT\r\n/g)||[]).length,1);assert(output.includes('\\nBEGIN:VEVENT\\n'));for(const line of output.split('\r\n'))assert(Buffer.byteLength(line,'utf8')<=75);assert(output.endsWith('END:VCALENDAR\r\n'));
});
test('Calendar markup and exports never execute member-supplied HTML',()=>{
  const h=calendarHarness();h.exec('cache.events=[qaArgs]',calEvent('unsafe"id',undefined,undefined,{title:'<script>run()</script>',description:'<img onerror=run()>',location:'<svg onload=run()>'}));const markup=h.run('calendarPage()');assert(markup.includes('&lt;script&gt;'));assert(!markup.includes('<script>'));assert(markup.includes('unsafe&quot;id'));h.run("calendarItem('event','unsafe\"id')");const detail=h.elements.get('#modalContent').innerHTML;assert(!detail.includes('<img onerror'));assert(detail.includes('&lt;img'));
});
test('Five calendar views remain usable with empty schedules and no fabricated events',()=>{
  const h=calendarHarness();for(const view of ['month','week','day','agenda','year']){h.exec('calendarView=qaArgs',view);const markup=h.run('calendarPage()');assert(markup.includes('0 matching items'));assert(!markup.includes('data-action="calendarItem"'));assert(markup.includes('calendarJump'));}
});
test('Calendar creation requires admin and prefills the selected local date',()=>{
  const h=calendarHarness();action(h,{action:'calendarCreate'});assert.equal(h.elements.get('#modal').open,false);h.run("me.role='admin'");action(h,{action:'calendarCreate'});const markup=h.elements.get('#modalContent').innerHTML;assert(markup.includes('2026-10-01T09:00'));assert(markup.includes('2026-10-01T10:00'));
});
test('Date jumps and per-view navigation update safe links and ignore invalid view values',()=>{
  const h=calendarHarness();h.exec('calendarChange(qaArgs)',node({id:'calendarMonthJump',value:'2028-02'}));assert.equal(h.run('calendarDayKey(calendarSelected)'),'2028-02-01');action(h,{action:'calendarView',view:'week'});action(h,{action:'calendarNext'});assert.equal(h.run('calendarDayKey(calendarSelected)'),'2028-02-08');assert.equal(h.context.location.hash,'#calendar/2028-02-08/week');action(h,{action:'calendarView',view:'finance'});assert.equal(h.run('calendarView'),'week');
});
test('Calendar keyboard controls work without intercepting typing or other pages',()=>{
  const h=calendarHarness();let prevented=0;const event={key:'w',target:node(),preventDefault(){prevented++;}};h.exec('calendarKeyboard(qaArgs)',event);assert.equal(h.run('calendarView'),'week');assert.equal(prevented,1);h.exec('calendarKeyboard(qaArgs)',{...event,key:'m',target:node({closest(){return {};}})});assert.equal(h.run('calendarView'),'week');h.run("page='messages'");h.exec('calendarKeyboard(qaArgs)',event);assert.equal(prevented,1);
});
test('Calendar preference storage is account-specific and rejects unrecognized options',()=>{
  const h=calendarHarness(),values=new Map();h.context.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};h.run("calendarView='week';calendarPreferences.compact=true;saveCalendarPreferences()");assert(values.has('space.calendar.self'));h.run("calendarView='day';loadCalendarPreferences()");assert.equal(h.run('calendarView'),'week');h.run("session.user.id='other';loadCalendarPreferences()");assert.equal(h.run('calendarView'),'month');assert.equal(h.run('calendarPreferences.compact'),false);values.set('space.calendar.other',JSON.stringify({view:'admin',weekStart:6,kinds:['event','secret'],track:'secret',response:'admin'}));h.run('loadCalendarPreferences()');assert.equal(h.run('calendarView'),'month');assert.deepEqual(Array.from(h.run('calendarPreferences.kinds')),['event']);assert.equal(h.run('calendarPreferences.weekStart'),1);
});
test('Sign-in opens the authorized shell before page and full refresh requests finish',async()=>{
  const h=loginHarness(),pending=deferred(),calls=[];h.context.recordRefresh=mode=>{calls.push(mode);return pending.promise;};h.run('refresh=mode=>recordRefresh(mode)');h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs,true)',loginSession('self'));for(let i=0;i<10;i++)await Promise.resolve();assert.equal(h.run('authReady'),true);assert.equal(h.run('workspaceLoading'),false);assert.equal(h.dialog.open,true);assert.equal(h.stats.focused,0);assert.equal(h.run('workspaceHydrating'),true);assert.deepEqual(calls,['page']);h.run('authGeneration++');pending.resolve();await Promise.resolve();await Promise.resolve();assert.deepEqual(calls,['page'],'Superseded sign-in must not start another refresh');
});
test('Pending profile validation immediately clears previous private records and capabilities',async()=>{
  const h=loginHarness(),pending=deferred();h.run("session={user:{id:'old'}};me={id:'old',role:'admin',membership_status:'approved'};cache={finance_entries:[{id:'private'}]};financeReady=true;courseReady=true");h.queued.push(pending.promise);const signing=h.exec('signedIn(qaArgs)',loginSession('self'));assert.equal(h.run('me'),null);assert.equal(h.run('Object.keys(cache).length'),0);assert.equal(h.run('financeReady'),false);assert.equal(h.run('courseReady'),false);assert.equal(h.run('workspaceLoading'),true);pending.resolve({data:loginProfile(),error:null});await signing;assert.equal(h.run('me.id'),'self');
});
test('Failed profile checks show a retry state without giving approved account access',async()=>{
  const h=loginHarness();h.context.console={...console,error(){}};h.queued.push({data:null,error:{message:'Offline'}});await h.exec('signedIn(qaArgs,true)',loginSession('self'));assert.equal(h.run('approved()'),false);assert.equal(h.run('workspaceLoading'),false);assert(h.run('workspaceLoadError'));assert.equal(h.stats.opens,0);
});
test('A late course capability response cannot restore flags after an account changes',async()=>{
  const h=harness(),probe=deferred();h.run("page='courses';courseReady=true;loadOwnOfficerAccess=async()=>{};detectWorkspaceCapabilities=async()=>{};hydrateOwnApplicationReason=async()=>{};readRecords=async()=>[];detectFounderPortraits=async()=>{};hydrateMedia=async()=>{};refreshUnreadCounts=async()=>{};");h.queued.push({data:{id:'self',role:'member',membership_status:'approved'},error:null},{data:[],error:null},probe.promise,probe.promise,probe.promise);const loading=h.run('refresh()');for(let i=0;i<100;i++)await Promise.resolve();assert(h.requests.some(call=>call.ops.some(op=>op[0]==='select'&&op[1]==='submission_due_at')));h.run("authGeneration++;session={user:{id:'other'}};me={id:'other',role:'member',membership_status:'approved'};cache={};courseReady=false;coursePlanningReady=false;courseLifecycleReady=false;courseSeenReady=false");probe.resolve({error:null});await loading;assert.equal(h.run('coursePlanningReady'),false);assert.equal(h.run('courseLifecycleReady'),false);assert.equal(h.run('courseSeenReady'),false);assert.equal(h.run('Object.keys(cache).length'),0);
});

test('Signed media URLs from an old account do not repopulate a new account cache',async()=>{
  const h=harness(),pending=deferred();h.run("mediaReady=true;cache.profiles=[{id:'self',avatar_path:'self/photo.png'}];mediaUrls.clear()");h.queued.push(pending.promise);const loading=h.run('hydrateMedia()');h.run("authGeneration++;session={user:{id:'other'}};cache={};mediaUrls.clear()");pending.resolve({data:[{path:'self/photo.png',signedUrl:'https://example.test/private-photo'}],error:null});assert.equal(await loading,false);assert.equal(h.run('mediaUrls.size'),0);
});

test('Calendar date links preserve their date and view across sign-in',async()=>{
  const h=loginHarness();h.run("authReady=true;setSidebarOpen=()=>{};signInDialog=()=>{};location.hash='#calendar/2028-02-29/week';route()");assert.equal(h.run('pendingProtectedPage'),'calendar/2028-02-29/week');assert.equal(h.context.location.hash,'#home');h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs)',loginSession('self'));assert.equal(h.context.location.hash,'#calendar/2028-02-29/week');assert.equal(h.run('calendarDayKey(calendarSelected)'),'2028-02-29');assert.equal(h.run('calendarView'),'week');
});

test('Sessions without an end time do not invent a displayed duration or an overlap warning',()=>{
  const h=calendarHarness();h.exec('cache.events=qaArgs',[calEvent('unknown','2026-10-01T23:30:00',null),calEvent('other','2026-10-01T23:45:00','2026-10-02T00:15:00')]);h.run("cache.event_rsvps=['unknown','other'].map(event_id=>({event_id,user_id:'self',response:'going'}))");assert(h.run('calendarItemTime(calendarEntries()[0])').includes('duration not set'));assert.equal(h.run('calendarConflicts(calendarEntries()).size'),0);assert.equal(h.run("calendarBetween(calendarEntries().filter(i=>i.id==='unknown'),new Date(2026,9,2),new Date(2026,9,3)).length"),0);
});

function directoryHarness(){
  const h=harness(),now=Date.now();h.run("page='members';avatarReady=true;enhancedReady=true;me.skills='Python, Robotics';me.profile_visibility='club'");
  h.exec('cache.profiles=qaArgs',[h.run('me'),{id:'a',full_name:'Álice Build',handle:'alice',headline:'Build useful robots',programme:'Engineering',skills:'python, CAD, Robotics',availability:'available',role:'member',membership_status:'approved',profile_visibility:'club',created_at:new Date(now-86400000).toISOString(),last_seen_at:new Date(now-1000).toISOString(),email:'PRIVATE_EMAIL_MARKER',join_reason:'PRIVATE_APPLICATION_MARKER'},{id:'b',full_name:'Bob Mentor',skills:'Electronics, CAD',availability:'busy',role:'teacher',membership_status:'approved',created_at:'2025-01-01T12:00:00Z'},{id:'lead',full_name:'Founder Lead',skills:'Automation',role:'founder',founder_teaching_enabled:true,membership_status:'approved'},{id:'private',full_name:'PRIVATE_PROFILE_MARKER',skills:'HIDDEN_SKILL_MARKER',role:'member',profile_visibility:'private',membership_status:'approved'},{id:'pending',full_name:'PENDING_PROFILE_MARKER',role:'member',membership_status:'pending'},{id:'suspended',full_name:'SUSPENDED_PROFILE_MARKER',role:'member',membership_status:'suspended'},{id:'investor',full_name:'INVESTOR_PROFILE_MARKER',role:'investor',membership_status:'approved'}]);
  return h;
}
test('Directory cards show approved visible peers without private application or contact fields',()=>{
  const h=directoryHarness(),markup=h.run('members()');for(const secret of ['PRIVATE_EMAIL_MARKER','PRIVATE_APPLICATION_MARKER','PRIVATE_PROFILE_MARKER','HIDDEN_SKILL_MARKER','PENDING_PROFILE_MARKER','SUSPENDED_PROFILE_MARKER','INVESTOR_PROFILE_MARKER'])assert(!markup.includes(secret),secret);
  assert.equal((markup.match(/data-member-id=/g)||[]).length,4);assert(markup.includes('member-card'));assert(markup.includes('data-action="openDm"'));assert(markup.includes('data-action="memberSave"'));assert(!markup.includes('class="card person"'));
});
test('Private profiles are visible to their owner and admin, but hidden from teachers and profile search',()=>{
  const h=directoryHarness();h.run("me.role='teacher'");assert(!h.run('directoryPeople().some(p=>p.id===\'private\')'));assert(!h.run('workspaceSearchItems().some(p=>p.id===\'private\')'));h.run("me.profile_visibility='private'");assert(h.run('directoryPeople().some(p=>p.id===\'self\')'));h.run("me.role='admin'");assert(h.run('directoryPeople().some(p=>p.id===\'private\')'));assert(!h.run('directoryPeople().some(p=>p.id===\'investor\')'));
});
for(const role of ['guest','pending','investor'])test(`Directory interactions and profiles require approved club access: ${role}`,()=>{
  const h=directoryHarness();if(role==='guest')h.run('session=null;me=null');else if(role==='pending')h.run("me.membership_status='pending'");else h.run("me.role='investor'");
  assert.equal(h.run('directoryResults().length'),0);assert(h.run('members()').includes('Member access required'));action(h,{action:'memberDiscover'});action(h,{action:'memberSave',id:'a'});action(h,{action:'memberProfile',id:'a'});action(h,{action:'memberCompletion'});assert.equal(h.elements.get('#modal').open,false);assert.equal(h.run('memberSavedIds.size'),0);
});
test('Search matches normalized names, handles, background and multiple interest terms',()=>{
  const h=directoryHarness();for(const query of ['alice','@alice','engineering']){h.exec('ensureMemberDirectory();memberDirectory.search=qaArgs',query);assert.deepEqual(Array.from(h.run('directoryResults().map(p=>p.id)')),['a']);}h.run("memberDirectory.search='robot python'");assert.deepEqual(Array.from(h.run('directoryResults().map(p=>p.id)')),['a','self']);h.run("memberDirectory.search='no-match'");assert.equal(h.run('directoryResults().length'),0);
});
test('Teaching lead, availability and skill filters combine and reject unknown filter values',()=>{
  const h=directoryHarness();h.exec('memberDirectoryChange(qaArgs)',node({value:'leads',dataset:{memberSetting:'role'}}));assert.deepEqual(Array.from(h.run('directoryResults().map(p=>p.id)')).sort(),['b','lead']);h.exec('memberDirectoryChange(qaArgs)',node({value:'admin-secret',dataset:{memberSetting:'role'}}));assert.equal(h.run('memberDirectory.role'),'leads');h.run("memberDirectory.role='all'");h.exec('memberDirectoryChange(qaArgs)',node({value:'available',dataset:{memberSetting:'presence'}}));h.exec('memberDirectoryChange(qaArgs)',node({value:'python',dataset:{memberSetting:'skill'}}));assert.deepEqual(Array.from(h.run('directoryResults().map(p=>p.id)')),['a']);
});
test('Online first, name, newest and shared-interest sorting use real profile data',()=>{
  const h=directoryHarness();h.run('ensureMemberDirectory()');assert.equal(h.run('directoryResults()[0].id'),'a');h.run("memberDirectory.sort='name'");assert.deepEqual(Array.from(h.run('directoryResults().map(p=>p.id)')),['a','b','lead','self']);h.run("memberDirectory.sort='newest'");assert.equal(h.run('directoryResults()[0].id'),'a');h.run("memberDirectory.sort='shared'");assert.equal(h.run('directoryResults()[0].id'),'a');
});
test('Skill parsing deduplicates delimiters and caps values, while shared interests exclude self',()=>{
  const h=directoryHarness();assert.deepEqual(Array.from(h.exec('memberSkills(qaArgs)',{skills:' Python,python; Robotics\nCAD , , '})),['Python','Robotics','CAD']);assert.equal(h.exec('memberSkills(qaArgs)',{skills:Array.from({length:30},(_,i)=>'Skill'+i).join(',')}).length,16);assert.equal(h.run('memberSharedSkills(me).length'),0);assert.equal(h.run('memberSharedSkills(cache.profiles[1]).length'),2);assert(!h.run('directorySkillCounts(directoryPeople()).some(s=>s.label===\'HIDDEN_SKILL_MARKER\')'));
});
test('Fresh presence and new-member labels ignore invalid, old and future timestamps',()=>{
  const h=directoryHarness();for(const last_seen_at of [undefined,'bad',new Date(Date.now()+120000).toISOString(),new Date(Date.now()-66000).toISOString()])assert.equal(h.exec('memberOnline(qaArgs)',{last_seen_at}),false);assert.equal(h.exec('memberNew(qaArgs)',{created_at:new Date(Date.now()+86400000).toISOString()}),false);assert.equal(h.run('memberNew(cache.profiles[1])'),true);assert.equal(h.run('memberNew(cache.profiles[2])'),false);
});
test('Saved members and display preferences persist per account without storing profile fields',()=>{
  const h=directoryHarness(),values=new Map();h.context.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  action(h,{action:'memberSave',id:'a'});action(h,{action:'memberView',view:'list'});action(h,{action:'memberDensity'});const saved=JSON.parse(values.get('space.members.self'));assert.deepEqual(saved,{view:'list',compact:true,saved:['a']});h.run('resetMemberDirectory();ensureMemberDirectory()');assert.equal(h.run('memberSavedIds.has(\'a\')'),true);assert.equal(h.run('memberDirectory.view'),'list');h.run("session.user.id='other';ensureMemberDirectory()");assert.equal(h.run('memberSavedIds.size'),0);assert.equal(h.run('memberDirectory.view'),'grid');assert.equal(h.run('memberDirectory.compact'),false);
});
test('Bookmarks never expose newly private or removed profiles and cannot save hidden members or self',()=>{
  const h=directoryHarness();action(h,{action:'memberSave',id:'a'});action(h,{action:'memberSave',id:'private'});action(h,{action:'memberSave',id:'self'});assert.equal(h.run('memberSavedIds.size'),1);action(h,{action:'memberGroup',group:'saved'});assert.equal(h.run('directoryResults().length'),1);h.run("cache.profiles.find(p=>p.id==='a').profile_visibility='private'");assert.equal(h.run('directoryResults().length'),0);assert(!h.run('members()').includes('Álice Build'));
});
test('Malformed device preferences are ignored and storage failure preserves session choices',()=>{
  const h=directoryHarness();h.context.localStorage={getItem:()=>'{broken',setItem(){throw Error('blocked');}};h.run('ensureMemberDirectory()');assert.equal(h.run('memberDirectory.view'),'grid');action(h,{action:'memberSave',id:'a'});assert.equal(h.run('memberSavedIds.has(\'a\')'),true);assert(h.elements.get('#toast').textContent.includes('Device storage'));
});
test('Shared interests and newcomer groups match actual dates and listed skills',()=>{
  const h=directoryHarness();action(h,{action:'memberGroup',group:'shared'});assert.deepEqual(Array.from(h.run('directoryResults().map(p=>p.id)')),['a']);action(h,{action:'memberGroup',group:'new'});assert.deepEqual(Array.from(h.run('directoryResults().map(p=>p.id)')),['a']);action(h,{action:'memberGroup',group:'private'});assert.equal(h.run('memberDirectory.group'),'new');
});
test('Random member discovery respects filters, excludes self and sends no messages',()=>{
  const h=directoryHarness();h.run("ensureMemberDirectory();memberDirectory.skill='python'");action(h,{action:'memberDiscover'});assert(h.elements.get('#modalContent').innerHTML.includes('Álice Build'));assert.equal(h.requests.length,0);assert.equal(h.context.location.hash,'#messages');h.run("memberDirectory.search='Tester'");h.elements.get('#modal').open=false;action(h,{action:'memberDiscover'});assert.equal(h.elements.get('#modal').open,false);
});
test('Numbered directory pagination renders 24 cards, uses filtered totals and bounds page requests',()=>{
  const h=directoryHarness();h.exec('cache.profiles=qaArgs',Array.from({length:55},(_,i)=>({id:'m'+i,full_name:'Member '+String(i).padStart(2,'0'),role:'member',membership_status:'approved',skills:i<2?'Python':'CAD'})));
  assert.equal((h.run('members()').match(/data-member-id=/g)||[]).length,24);action(h,{action:'memberPage',page:'2'});assert.equal(h.run('memberDirectoryPage'),2);assert.equal((h.run('members()').match(/data-member-id=/g)||[]).length,7);action(h,{action:'memberPage',page:'3'});assert.equal(h.run('memberDirectoryPage'),2);action(h,{action:'memberSkill',skill:'Python'});assert.equal(h.run('memberDirectoryPage'),0);assert.equal(h.run('directoryResults().length'),2);assert(!h.run('members()').includes('class="member-pager"'));
});
test('Individual filters can be cleared and reset retains device display preferences',()=>{
  const h=directoryHarness();h.run("ensureMemberDirectory();memberDirectory.search='alice';memberDirectory.presence='online';memberDirectory.view='list';memberDirectory.compact=true");action(h,{action:'memberClearFilter',filter:'search'});assert.equal(h.run('memberDirectory.search'),'');assert.equal(h.run('memberDirectory.presence'),'online');action(h,{action:'memberReset'});assert.equal(h.run('memberDirectory.presence'),'all');assert.equal(h.run('memberDirectory.view'),'list');assert.equal(h.run('memberDirectory.compact'),true);
});
test('Search debounce does not render after navigating away or changing account',()=>{
  const h=directoryHarness();let renders=0;h.context.qaRender=()=>renders++;h.run('render=qaRender');h.exec('memberDirectorySearch(qaArgs)',node({value:'Alice'}));h.run("page='calendar'");h.fireTimers(180);assert.equal(renders,0);h.run("page='members'");h.exec('memberDirectorySearch(qaArgs)',node({value:'Bob'}));h.run("session.user.id='other'");h.fireTimers(180);assert.equal(renders,0);
});
test('Directory keyboard shortcuts avoid typing, dialogs and other pages',()=>{
  const h=directoryHarness();let focused=0,prevented=0;h.elements.set('#memberSearch',node({focus(){focused++;}}));const event={key:'/',target:node(),preventDefault(){prevented++;}};assert.equal(h.exec('memberDirectoryKeyboard(qaArgs)',event),true);assert.equal(focused,1);assert.equal(h.exec('memberDirectoryKeyboard(qaArgs)',{...event,target:node({closest(){return {};}})}),false);h.run('ensureMemberDirectory();memberDirectory.search="Alice"');h.exec('memberDirectoryKeyboard(qaArgs)',{...event,key:'Escape',target:node({id:'memberSearch'})});assert.equal(h.run('memberDirectory.search'),'');h.elements.get('#modal').open=true;assert.equal(h.exec('memberDirectoryKeyboard(qaArgs)',event),false);assert.equal(prevented,2);
});
test('Profile completion counts available fields and only opens the signed-in account checklist',()=>{
  const h=directoryHarness();action(h,{action:'memberCompletion'});let markup=h.elements.get('#modalContent').innerHTML;assert(markup.includes('1 of 5'));assert(markup.includes('Update photo'));h.run("avatarReady=false;dmReady=false;enhancedReady=false");assert.equal(h.run('memberProfileCompletion().percent'),100);
});
test('Profile details escape member-supplied text and never reveal hidden profile content',()=>{
  const h=directoryHarness();h.run("cache.profiles[1].full_name='<img src=x onerror=bad>';cache.profiles[1].skills='Python, <script>bad</script>';cache.profiles[1].bio='<svg onload=bad>'");action(h,{action:'memberProfile',id:'a'});const markup=h.elements.get('#modalContent').innerHTML;assert(!markup.includes('<img src=x'));assert(!markup.includes('<script>bad'));assert(!markup.includes('<svg onload'));assert(markup.includes('&lt;svg onload=bad&gt;'));assert(markup.includes('member-profile-skills'));h.elements.get('#modal').open=false;action(h,{action:'memberProfile',id:'private'});assert.equal(h.elements.get('#modal').open,false);
});
test('Profile photo actions reject cached private, pending and investor profiles',()=>{
  const h=directoryHarness(),opened=[];h.context.qaOpen=id=>opened.push(id);h.run("openImageViewer=qaOpen;cache.profiles.forEach(p=>p.avatar_path=p.id+'/photo.png')");for(const id of ['private','pending','investor'])action(h,{action:'viewProfilePhoto',id});assert.equal(opened.length,0);action(h,{action:'viewProfilePhoto',id:'a'});assert.deepEqual(opened,['a/photo.png']);
});
test('Profile links require approved access, valid IDs and public-to-club visibility',async()=>{
  const h=directoryHarness(),id='12345678-1234-1234-1234-123456789abc',copied=[];h.context.location.origin='https://example.test';h.context.location.pathname='/club/';h.context.navigator.clipboard={writeText:async value=>{copied.push(value);}};h.exec("cache.profiles[1].id=qaArgs",id);action(h,{action:'memberCopyLink',id});await Promise.resolve();assert.deepEqual(copied,['https://example.test/club/#members/'+id]);h.run("cache.profiles[1].profile_visibility='private';me.role='admin'");action(h,{action:'memberCopyLink',id});assert.equal(copied.length,1);
});
test('Linked profiles open once after loading and private links reveal no details',()=>{
  const h=directoryHarness(),id='12345678-1234-1234-1234-123456789abc';h.exec('cache.profiles[1].id=qaArgs;location.hash="#members/"+qaArgs',id);h.run('openLinkedMemberProfile()');assert(h.elements.get('#modal').open);h.elements.get('#modal').open=false;h.run('openLinkedMemberProfile()');assert.equal(h.elements.get('#modal').open,false);h.run('memberLinkedProfile=null;cache.profiles[1].profile_visibility="private";openLinkedMemberProfile()');assert.equal(h.elements.get('#modal').open,false);assert(h.elements.get('#toast').textContent.includes('unavailable or private'));
});
test('Member profile links preserve the protected destination across email sign-in',async()=>{
  const h=loginHarness(),id='12345678-1234-1234-1234-123456789abc';h.exec("authReady=true;setSidebarOpen=()=>{};signInDialog=()=>{};location.hash='#members/'+qaArgs;route()",id);assert.equal(h.run('pendingProtectedPage'),'members/'+id);h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs)',loginSession('self'));assert.equal(h.context.location.hash,'#members/'+id);
});

test('Remembered authentication survives startup without clearing other projects or preferences',()=>{
 const localItems=new Map([['sb-qa-auth-token','remembered'],['sb-other-auth-token','other'],['innovatex.theme','dark']]);const h=harness({localItems});
 assert.equal(h.clientOptions.auth.storage.getItem('sb-qa-auth-token'),'remembered');assert.equal(localItems.get('sb-other-auth-token'),'other');assert.equal(localItems.get('innovatex.theme'),'dark');assert.equal(h.clientOptions.auth.autoRefreshToken,true);assert.equal(h.clientOptions.auth.persistSession,true);
});
test('A current tab sign-in is migrated to durable storage, while existing durable credentials win',()=>{
 const localItems=new Map([['sb-qa-auth-token','newer']]),sessionItems=new Map([['sb-qa-auth-token','old'],['sb-qa-auth-token-user','user'],['space.auth.tab-clock.v1','old-clock']]);const h=harness({localItems,sessionItems});
 assert.equal(h.clientOptions.auth.storage.getItem('sb-qa-auth-token'),'newer');assert.equal(localItems.get('sb-qa-auth-token-user'),'user');assert.equal(sessionItems.has('sb-qa-auth-token'),false);assert.equal(sessionItems.has('space.auth.tab-clock.v1'),false);
 const tab=new Map([['sb-qa-auth-token','current-tab']]),fresh=harness({sessionItems:tab});assert.equal(fresh.clientOptions.auth.storage.getItem('sb-qa-auth-token'),'current-tab');
});
test('Unavailable durable storage keeps authentication in memory without throwing',()=>{
 const h=harness();h.context.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 h.clientOptions.auth.storage.setItem('test','temporary');assert.equal(h.clientOptions.auth.storage.getItem('test'),'temporary');h.clientOptions.auth.storage.removeItem('test');assert.equal(h.clientOptions.auth.storage.getItem('test'),null);
});
function sessionHarness(options={}){
  const h=loginHarness(options),stats={stopped:0,started:0,signouts:[],prompts:0,renders:0};let now=1000000;
  h.context.Date=class extends Date{static now(){return now;}};
  h.db.auth={startAutoRefresh:async()=>{stats.started++;},stopAutoRefresh:async()=>{stats.stopped++;},signOut:async options=>{stats.signouts.push(options);return {error:null};}};
  h.context.qaPrompt=()=>{stats.prompts++;};h.context.qaRender=()=>{stats.renders++;};h.run('signInDialog=qaPrompt;render=qaRender');
  const login=async(id='self',interactive=true,profile={})=>{h.queued.push({data:loginProfile(id,profile),error:null});await h.exec('signedIn(qaArgs.session,qaArgs.interactive)',{session:loginSession(id),interactive});};
  return {...h,stats,setNow:value=>{now=value;},getNow:()=>now,login};
}
test('Remembered sign-in has no app-imposed inactivity or eight-hour cutoff',async()=>{
 const h=sessionHarness();await h.login();for(const elapsed of [31*60000,9*3600000,30*86400000]){h.setNow(1000000+elapsed);assert.equal(h.run('checkSessionExpiry()'),false);assert.equal(h.run('session.user.id'),'self');}assert.equal(h.stats.signouts.length,0);
});
test('Explicit sign-out clears private UI immediately while server revocation is pending',async()=>{
 const h=sessionHarness();await h.login();const pending=deferred();h.db.auth.signOut=()=>pending.promise;h.run("cache.secret=['private'];mediaUrls.set('secret',{url:'signed'});authPersistentStorage.setItem(authStorageKey,'token')");const signing=h.run('signOut()');
 assert.equal(h.run('session'),null);assert.equal(h.run('me'),null);assert.equal(h.run('cache.secret'),undefined);assert.equal(h.run('mediaUrls.size'),0);assert(h.localItems.has('sb-qa-auth-token-space-signed-out'));
 pending.resolve({error:null});await signing;assert.equal(h.localItems.has('sb-qa-auth-token'),false);
});
test('A failed revocation still removes remembered credentials and blocks delayed auth events',async()=>{
 const h=sessionHarness();await h.login();h.context.console={...console,error(){}};h.db.auth.signOut=async()=>({error:{message:'offline'}});h.run("authPersistentStorage.setItem(authStorageKey,'token')");await h.run('signOut()');h.exec("handleAuthStateChange('TOKEN_REFRESHED',qaArgs)",loginSession('self'));h.fireTimers(0);assert.equal(h.run('session'),null);assert.equal(h.localItems.has('sb-qa-auth-token'),false);
});
test('A fresh interactive sign-in works after explicit sign-out',async()=>{
 const h=sessionHarness();await h.login();await h.run('signOut()');await h.login('self',true);assert.equal(h.run('sessionEnding'),false);assert.equal(h.run('session.user.id'),'self');assert.equal(h.localItems.has('sb-qa-auth-token-space-signed-out'),false);
});
test('A pending profile read cannot restore an explicitly signed-out account',async()=>{
 const h=sessionHarness(),profile=deferred();h.queued.push(profile.promise);const signing=h.exec('signedIn(qaArgs)',loginSession('self'));await h.run('signOut()');profile.resolve({data:loginProfile(),error:null});await signing;assert.equal(h.run('session'),null);assert.equal(h.run('me'),null);
});
test('Old editor submits cannot write after explicit sign-out',async()=>{
 const h=sessionHarness();await h.login();await h.run('signOut()');const before=h.requests.length;let prevented=0;await h.exec('submit(qaArgs)',{target:{id:'editor',dataset:{kind:'projectEdit'}},preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(h.requests.length,before);
});
test('Page exit hides private content without discarding remembered authentication',()=>{
 const source=fs.readFileSync(root+'/app.js','utf8');assert(source.includes("window.addEventListener('pagehide',()=>{if(!session)return;dismissLoginWelcome()"));assert(!source.includes('SESSION_IDLE_MS'));assert(!source.includes('persistSessionClock'));assert(source.includes('You stay signed in on this browser until you sign out.'));
});

function learningHarness(role='member'){
  const h=loginHarness();
  h.run(`session={user:{id:'self',email:'self@example.test'}};sessionStartedAt=Date.now();lastSessionActivityAt=sessionStartedAt;me={id:'self',full_name:'Student One',role:'${role}',application_type:'member',membership_status:'approved'};learningChoicesReady=true;learningHubReady=true;ownLearningTracks=['Controls and Automation','Software and Programming'];courseReady=true;coursePlanningReady=true;learningReady=true;courseLifecycleReady=true;courseSeenReady=true;route=()=>{};refresh=async()=>{};loadAdminApplicationPages=async()=>{};cache={profiles:[me,{id:'learner',full_name:'Learner One',role:'member',membership_status:'approved'}],courses:[{id:'c1',title:'Controller lab',category:'Controls and Automation',instructor_id:'self',status:'active',created_at:'2026-10-01'},{id:'c2',title:'Programming lab',category:'Software and Programming',instructor_id:'other-teacher',status:'active',created_at:'2026-10-02'}],course_enrollments:[{course_id:'c1',learner_id:'self',status:'enrolled'},{course_id:'c1',learner_id:'learner',status:'enrolled'}],course_roster:[{course_id:'c1',learner_id:'learner',full_name:'Learner One',status:'enrolled'}],teaching_track_assignments:[{teacher_id:'self',track:'Controls and Automation'}],learning_track_roster:[{learner_id:'learner',full_name:'Learner One',track:'Controls and Automation'}],classroom_assignments:[{id:'a1',course_id:'c1',title:'Test three setpoints',kind:'practical',instructions:'Build a controller and record the results for three different setpoints.',due_at:'2026-11-01T12:00:00Z',created_at:'2026-10-01'},{id:'personal',course_id:'c1',title:'Personal revision',kind:'assignment',learner_id:'learner',instructions:'Improve your controller and record the new response in three trials.',created_at:'2026-10-01'},{id:'other',course_id:'c2',title:'Other teacher work',kind:'project',instructions:'This is work for another class and teacher.',created_at:'2026-10-01'}],classroom_assignment_submissions:[],course_submissions:[],course_completions:[],learning_materials:[],notifications:[],events:[],project_tasks:[]};`);
  return h;
}
function learningForm(kind,entries,id='editor'){
  const send=node(),form=node({id,dataset:{kind},entries,matches(){return false;},querySelector(selector){return selector==='[type=submit]'?send:null;}});
  return {event:{target:form,preventDefault(){}},send};
}
test('Course selection offers all four courses as independent checkboxes',()=>{
  const h=learningHarness(),markup=h.run('learningPathForm(true)');assert.equal((markup.match(/name="learning_tracks"/g)||[]).length,4);assert.equal((markup.match(/ checked/g)||[]).length,2);assert(markup.includes('type="checkbox"'));assert(!markup.includes('type="radio"'));
});
test('New approved members must choose courses while upgraded teachers keep their studio',()=>{
  const h=learningHarness();h.run('ownLearningTracks=[]');assert.equal(h.run('learningSelectionRequired()'),true);assert(h.run('courses()').includes('Save courses and open my dashboard'));h.run("me.role='teacher'");assert.equal(h.run('learningSelectionRequired()'),false);
});
test('New applicant forms include course choices without exposing other applicants',()=>{
  const h=learningHarness();h.run("me.membership_status='pending';me.application_reason='I want to build and learn practical engineering.'");const markup=h.run('application()');assert(markup.includes('Choose the courses you want to learn'));assert.equal((markup.match(/name="learning_tracks"/g)||[]).length,4);
});
test('Saving multiple selected courses sends the complete array to the protected RPC',async()=>{
  const h=learningHarness(),form=learningForm('learningPath',[['learning_tracks','Controls and Automation'],['learning_tracks','Software and Programming']],'learningPathForm');await h.exec('submit(qaArgs)',form.event);assert.equal(h.rpcCalls[0].name,'set_my_learning_tracks');assert.deepEqual(Array.from(h.rpcCalls[0].args.p_tracks),['Controls and Automation','Software and Programming']);assert.equal(form.send.disabled,false);
});
test('An empty course choice is rejected before a database mutation',async()=>{
  const h=learningHarness(),form=learningForm('learningPath',[],'learningPathForm');h.context.console={...console,error(){}};await h.exec('submit(qaArgs)',form.event);assert.equal(h.rpcCalls.length,0);assert(h.elements.get('#toast').textContent.includes('Choose at least one'));
});
test('A learning-path response from a signed-out account cannot restore old choices',async()=>{
  const h=harness(),pending=deferred();h.queued.push(pending.promise);const loading=h.run('loadOwnLearningPath()');h.run('session=null;authGeneration++;ownLearningTracks=[]');pending.resolve({data:{tracks:['Controls and Automation']},error:null});await loading;assert.equal(h.run('ownLearningTracks.length'),0);assert.equal(h.run('learningChoicesReady'),false);
});
test('Student classwork excludes another class and personal tasks for someone else',()=>{
  const h=learningHarness();assert.deepEqual(Array.from(h.run('classworkForStudent().map(a=>a.id)')),['a1']);const markup=h.run("studentClassworkPanel('c1')");assert(markup.includes('Test three setpoints'));assert(!markup.includes('Personal revision'));assert(!markup.includes('Other teacher work'));
});
test('Classwork history displays feedback and allows revisions without removing prior attempts',()=>{
  const h=learningHarness();h.run("cache.classroom_assignment_submissions=[{id:'s1',assignment_id:'a1',learner_id:'self',details:'I tested three setpoints and measured the response.',review_status:'revision_requested',teacher_feedback:'Compare your overshoot in each trial.',created_at:'2026-10-03'}]");const markup=h.run("studentClassworkPanel('c1')");assert(markup.includes('Compare your overshoot'));assert(markup.includes('Submit an improved attempt'));h.run("cache.classroom_assignment_submissions[0].review_status='accepted'");assert(!h.run("studentClassworkPanel('c1')").includes('data-action="classworkSubmitForm"'));
});
test('Teacher student cards include course-choice cohorts and legacy enrolled students once',()=>{
  const h=learningHarness('teacher');h.run("cache.course_roster.push({course_id:'c1',learner_id:'old',full_name:'Existing Student',status:'enrolled'})");const markup=h.run('teachingStudentsPanel()');assert.equal((markup.match(/<h3>Learner One<\/h3>/g)||[]).length,1);assert(markup.includes('Existing Student'));assert(markup.includes('Assign work'));
});
test('Teachers can filter and page student rosters with bounded card sizes',()=>{
  const h=learningHarness('teacher');h.exec('cache.learning_track_roster=qaArgs',Array.from({length:55},(_,i)=>({learner_id:'student'+i,full_name:'Student '+String(i).padStart(2,'0'),track:'Controls and Automation'})));h.run('cache.course_roster=[]');assert.equal((h.run('teachingStudentsPanel()').match(/learning-student-card/g)||[]).length,24);h.run('teachingStudentPage=2');assert.equal((h.run('teachingStudentsPanel()').match(/learning-student-card/g)||[]).length,7);h.run("teachingStudentSearch='Student 01'");assert.equal((h.run('teachingStudentsPanel()').match(/learning-student-card/g)||[]).length,1);
});
test('Teacher classwork queues exclude classes belonging to other teachers',()=>{
  const h=learningHarness('teacher');h.run("cache.classroom_assignment_submissions=[{id:'s1',assignment_id:'a1',learner_id:'learner',details:'A complete result for the controls exercise.',review_status:'submitted',created_at:'2026-10-04'},{id:'s2',assignment_id:'other',learner_id:'learner',details:'PRIVATE OTHER CLASS RESULT',review_status:'submitted',created_at:'2026-10-04'}]");const markup=h.run('teacherClassworkPanel()');assert(markup.includes('A complete result'));assert(!markup.includes('PRIVATE OTHER CLASS RESULT'));assert(markup.includes('Mark as seen'));assert(markup.includes('Give feedback'));
});
test('Teaching navigation exposes Students and Classwork while preserving existing review tools',()=>{
  const h=learningHarness('teacher');const markup=h.run('teaching()');assert(markup.includes('teaching-tab-students'));assert(markup.includes('teaching-tab-classwork'));assert(markup.includes('teaching-tab-reviews'));action(h,{action:'teachingTab',tab:'classwork'});assert.equal(h.run('teachingTab'),'classwork');
});
test('Assignment publishing targets an enrolled student in the teachers own open class',async()=>{
  const h=learningHarness('teacher'),form=learningForm('classwork',[['course_id','c1'],['learner_id','learner'],['title','A personal practical'],['kind','practical'],['instructions','Build a controller and measure the step response for three setpoints.'],['due_at','2026-11-01T10:00'],['resource_url','https://example.test/slides']]);await h.exec('submit(qaArgs)',form.event);assert.equal(h.rpcCalls[0].name,'publish_classroom_assignment');assert.equal(h.rpcCalls[0].args.p_learner,'learner');assert.equal(h.rpcCalls[0].args.p_course,'c1');
});
test('Cross-course classwork publishing is rejected in the browser before the RPC',async()=>{
  const h=learningHarness('teacher');h.context.console={...console,error(){}};const form=learningForm('classwork',[['course_id','c2'],['title','Not my class'],['kind','project'],['instructions','This is a valid length of instructions for a different class.']]);await h.exec('submit(qaArgs)',form.event);assert.equal(h.rpcCalls.length,0);
});
test('A student sends classwork through a scoped submission RPC',async()=>{
  const h=learningHarness(),form=learningForm('classworkSubmission',[['assignment_id','a1'],['details','I measured all three responses and compared the settling times.'],['evidence_url','https://example.test/results']]);await h.exec('submit(qaArgs)',form.event);assert.equal(h.rpcCalls[0].name,'submit_classroom_assignment');assert.equal(h.rpcCalls[0].args.p_assignment,'a1');
});
test('Teacher feedback requires the assigned class and another student',async()=>{
  const h=learningHarness('teacher');h.run("cache.classroom_assignment_submissions=[{id:'s1',assignment_id:'a1',learner_id:'learner',review_status:'submitted'}]");const form=learningForm('classworkReview',[['submission_id','s1'],['decision','revision_requested'],['feedback','Please repeat the test with a smaller step input.']]);await h.exec('submit(qaArgs)',form.event);assert.equal(h.rpcCalls[0].name,'review_classroom_assignment');assert.equal(h.rpcCalls[0].args.p_decision,'revision_requested');
});
test('Role management is administrator-only and uses the approved account directory',()=>{
  const h=learningHarness('teacher');h.run("approvedAccountRows=[{id:'target',full_name:'Another account',role:'member',membership_status:'approved'}];accountRoleForm('target')");assert.equal(h.elements.get('#modal').open,false);h.run("me.role='admin';accountRoleForm('target')");assert(h.elements.get('#modalContent').innerHTML.includes('name="next_role"'));assert(h.elements.get('#modalContent').innerHTML.includes('Teaching courses'));h.elements.get('#modal').open=false;h.run("accountRoleForm('self')");assert.equal(h.elements.get('#modal').open,false);
});
test('Administrators assign multiple teaching courses with a role change',async()=>{
  const h=learningHarness('admin'),form=learningForm('accountRole',[['user_id','learner'],['next_role','teacher'],['note','Please lead the practical workshops.'],['teaching_tracks','Controls and Automation'],['teaching_tracks','AI & Machine Learning']]);await h.exec('submit(qaArgs)',form.event);assert.equal(h.rpcCalls[0].name,'space_assign_account_role');assert.deepEqual(Array.from(h.rpcCalls[0].args.p_tracks),['Controls and Automation','AI & Machine Learning']);
});
test('Teaching-course authorization controls publishing choices independently of profile interests',()=>{
  const h=learningHarness('teacher');assert.deepEqual(Array.from(h.run('allowedTeachingTracks()')),['Controls and Automation']);h.run("teacherProfile={track:'AI & Machine Learning'}");assert.deepEqual(Array.from(h.run('allowedTeachingTracks()')),['Controls and Automation']);h.run("cache.teaching_track_assignments=[]");action(h,{action:'courseForm'});assert(h.elements.get('#toast').textContent.includes('administrator'));
});
test('New dashboards escape names, assignment instructions and feedback',()=>{
  const h=learningHarness('teacher');h.run("cache.learning_track_roster[0].full_name='<script>bad</script>';cache.course_roster=[];cache.classroom_assignments[0].instructions='<img src=x onerror=bad>';cache.classroom_assignment_submissions=[{id:'s',assignment_id:'a1',learner_id:'self',details:'A valid description of my practical work.',review_status:'revision_requested',teacher_feedback:'<svg onload=bad>',created_at:'2026-10-01'}]");assert(!h.run('teachingStudentsPanel()').includes('<script>bad'));const markup=h.run("studentClassworkPanel('c1')");assert(!markup.includes('<img src=x'));assert(!markup.includes('<svg onload'));assert(markup.includes('&lt;svg onload=bad&gt;'));
});
test('Student Home and calendar include assigned classwork without exposing personal work for others',()=>{
  const h=learningHarness();const home=h.run('personalHome()');assert(home.includes('YOUR NEXT CLASSWORK'));const entries=Array.from(h.run('calendarEntries()'));assert(entries.some(e=>e.assignment_id==='a1'));assert(!entries.some(e=>e.assignment_id==='personal'));assert.equal(h.exec('calendarPersonal(qaArgs)',entries.find(e=>e.assignment_id==='a1')),true);
});
test('Role dashboard entry points match each approved account capability',()=>{
  const h=learningHarness();assert(h.run('roleDashboardIntro()').includes('STUDENT DASHBOARD'));h.run("me.role='teacher'");assert(h.run('roleDashboardIntro()').includes('TEACHER DASHBOARD'));h.run("me.role='founder';me.founder_teaching_enabled=true");assert(h.run('roleDashboardIntro()').includes('FOUNDER DASHBOARD'));h.run("me.role='admin'");assert(h.run('roleDashboardIntro()').includes('ADMINISTRATOR DASHBOARD'));
});

function dataHarness(target='home',{role='member',tables={},errors={}}={}){
  const h=harness(),requests=[];h.context.console={...console,error(){}};
  const profile=loginProfile('self',{role,application_type:'member'});
  h.exec("me=qaArgs;authReady=true;page='"+target+"';cache={};hydrateOwnApplicationReason=async()=>{};detectFounderPortraits=async()=>{};hydrateMedia=async()=>{};loadDmCapabilities=async()=>{};loadAdminApplicationPages=async()=>{};loadFeedPage=async()=>{};loadChannelHistory=async()=>{};",profile);
  h.db.from=table=>{
    const call={table,ops:[]};requests.push(call);let builder;
    builder=new Proxy({}, {get(_,method){
      if(method==='then')return(resolve,reject)=>Promise.resolve().then(()=>{
        if(errors[table])throw errors[table];
        if(table==='profiles'&&call.ops.some(op=>op[0]==='single'))return {data:profile,error:null};
        let rows=tables[table]||[];
        for(const [op,column,value] of call.ops){if(op==='in')rows=rows.filter(row=>value.includes(row[column]));if(op==='eq')rows=rows.filter(row=>row[column]===value);}
        const count=rows.length,range=call.ops.find(op=>op[0]==='range'),limit=call.ops.find(op=>op[0]==='limit');
        if(range)rows=rows.slice(range[1],range[2]+1);if(limit)rows=rows.slice(0,limit[1]);
        return {data:rows,count,error:null};
      }).then(resolve,reject);
      return(...args)=>{call.ops.push([method,...args]);return builder;};
    }});return builder;
  };
  return {...h,requests,profile};
}
const flush=async(count=100)=>{for(let i=0;i<count;i++)await Promise.resolve();};
test('Dataset batches never exceed six active tasks and retain failed positions',async()=>{
  const h=harness();let active=0,max=0;h.context.poolTask=async value=>{active++;max=Math.max(max,active);await Promise.resolve();active--;if(value===11)throw Error('One failed batch');return value*2;};
  const results=await h.run('settledMapLimit(Array.from({length:2000},(_,i)=>i),6,poolTask)');
  assert(max<=6);assert.equal(results.length,2000);assert.equal(results[11].status,'rejected');assert.equal(results[1999].value,3998);
});
test('Home loads page records without inventory, finance, audits or the full member directory',async()=>{
  const h=dataHarness('home');await h.run('refresh()');
  for(const table of ['inventory_items','finance_entries','audit_events','investor_inquiries','documents','topics'])assert(!h.requests.some(r=>r.table===table),table);
  assert(!h.requests.some(r=>r.table==='profiles'&&r.ops.some(op=>op[0]==='range')));assert(h.requests.some(r=>r.table==='courses'));assert.equal(h.run('profilesComplete'),false);
});
test('Opening Inventory loads its records without fetching learning and feed tables',async()=>{
  const h=dataHarness('inventory');await h.run('refresh()');assert(h.requests.some(r=>r.table==='inventory_items'));
  for(const table of ['courses','learning_materials','classroom_assignments','project_tasks'])assert(!h.requests.some(r=>r.table===table),table);
});
test('A complete profile cache avoids repeated directory downloads on other pages',async()=>{
  const h=dataHarness('news');await h.run('refresh()');const count=h.requests.filter(r=>r.table==='profiles'&&r.ops.some(op=>op[0]==='range')).length;assert.equal(count,1);
  await h.run('refresh()');assert.equal(h.requests.filter(r=>r.table==='profiles'&&r.ops.some(op=>op[0]==='range')).length,count);
});
test('Course-choice reads stay scoped to the signed-in account even for an administrator',async()=>{
  const h=dataHarness('home',{role:'admin'});await h.run('refresh()');const query=h.requests.find(r=>r.table==='member_learning_paths');assert(query.ops.some(op=>op[0]==='eq'&&op[1]==='user_id'&&op[2]==='self'));
});
test('Complete record retrieval includes 2,505 rows in bounded stable pages',async()=>{
  const profiles=Array.from({length:2505},(_,i)=>({id:'member-'+i,created_at:'2026-10-01',full_name:'Member '+i}));
  const h=dataHarness('members',{tables:{profiles}}),rows=await h.run("readRecords('profiles')");assert.equal(rows.length,2505);assert.equal(new Set(rows.map(r=>r.id)).size,2505);assert.equal(rows.at(-1).id,'member-2504');
  const pages=h.requests.flatMap(r=>r.ops.filter(op=>op[0]==='range'));assert.equal(pages.length,6);assert(pages.every(op=>op[2]-op[1]===499));
});
test('Duplicate background loads share one request for the same account and page',async()=>{
  const h=loginHarness(),slow=deferred();let calls=0;h.context.pageJob=()=>{calls++;return slow.promise;};h.run("session={user:{id:'self'}};me={id:'self',role:'member',membership_status:'approved'};authReady=true;refresh=()=>pageJob()");
  const first=h.run('refreshVisiblePage()'),second=h.run('refreshVisiblePage()');await flush(10);assert.equal(calls,1);slow.resolve();await Promise.all([first,second]);assert.equal(h.run('workspacePageRequests.size'),0);
});
test('A slow request updates its loading state after three seconds without clearing cached records',async()=>{
  const h=loginHarness(),slow=deferred();h.context.pageJob=()=>slow.promise;h.run("session={user:{id:'self'}};me={id:'self',role:'member',membership_status:'approved'};authReady=true;cache={events:[{id:'saved'}]};refresh=()=>pageJob()");
  const loading=h.run('refreshVisiblePage()');h.fireTimers(3000);assert.equal(h.run("workspacePageLoads.get('home').slow"),true);assert.equal(h.run('cache.events[0].id'),'saved');slow.resolve();await loading;
});
test('Offline refresh, presence and alert polls make no database calls',async()=>{
  const h=dataHarness('members');h.context.navigator.onLine=false;await h.run('refreshVisiblePage();touchPresence();refreshChat();refreshAdminAlerts();refreshInboxUnreadCount()');assert.equal(h.requests.length,0);assert.equal(h.run("workspacePageLoads.get('members').status"),'offline');
});
test('Automatic retries back off after an error while an explicit retry remains available',async()=>{
  const h=loginHarness();h.context.console={...console,error(){}};let calls=0;h.context.failPage=()=>{calls++;throw Error('Offline service');};h.run("session={user:{id:'self'}};me={id:'self',role:'member',membership_status:'approved'};authReady=true;refresh=()=>failPage()");
  await h.run('refreshVisiblePage()');await h.run('refreshVisiblePage()');assert.equal(calls,1);assert(h.run("workspacePageLoads.get('home').retryAt")>Date.now());await h.run('refreshVisiblePage({force:true})');assert.equal(calls,2);
});
test('A page load captures its destination before another page is opened',async()=>{
  const h=dataHarness('home');const loading=h.run('refreshVisiblePage()');h.run("page='inventory'");await loading;assert(!h.requests.some(r=>r.table==='inventory_items'));assert(h.requests.some(r=>r.table==='courses'));
});
test('Failed table refreshes preserve previously loaded data and report the failure',async()=>{
  const h=dataHarness('events',{errors:{events:Error('Connection interrupted')}});h.run("cache.events=[{id:'saved',title:'Workshop'}]");const result=await h.run('refresh()');assert.equal(h.run('cache.events[0].id'),'saved');assert(result.failures.includes('events'));
});
test('A late page response cannot restore data or network status after sign-out',async()=>{
  const h=loginHarness(),slow=deferred();h.context.pageJob=()=>slow.promise;h.run("session={user:{id:'self'}};me={id:'self',role:'member',membership_status:'approved'};authReady=true;refresh=()=>pageJob()");const loading=h.run('refreshVisiblePage()');h.run('authGeneration++;session=null;me=null;cache={};clearWorkspaceLoads()');slow.resolve();await loading;assert.equal(h.run('workspacePageLoads.size'),0);assert.equal(h.run('Object.keys(cache).length'),0);
});
test('Skeletons reflect chat and list layouts and stop animating when loading fails',()=>{
  const h=harness();assert(h.run("workspaceSkeleton('messages')").includes('skeleton-chat'));assert(h.run("workspaceSkeleton('notifications')").includes('skeleton-list'));const failed=h.run("workspaceSkeleton('members',{error:true})");assert(failed.includes('aria-busy="false"'));assert(failed.includes('retryPage'));assert(!failed.includes('page-skeleton'));assert(h.run("workspaceSkeleton('members',{offline:true})").includes('Reconnect'));
  assert(fs.readFileSync(root+'/styles.css','utf8').includes('.page-skeleton i,.skeleton-avatar{animation:none}'));
});
test('A complete CSV includes 2,505 members and their private application answers',async()=>{
  const profiles=Array.from({length:2505},(_,i)=>({id:'member-'+i,full_name:i===0?'=SUM(1,2)':'Member '+i,created_at:'2026-10-01',role:'member'}));
  const answers=profiles.map((p,i)=>({user_id:p.id,reason:'Application '+i})),h=dataHarness('admin',{role:'admin',tables:{profiles,application_answers:answers}}),blobs=[];let downloads=0;
  h.context.URL=class extends URL{static createObjectURL(blob){blobs.push(blob);return 'blob:fixture';}static revokeObjectURL(){}};h.context.document.createElement=()=>({click(){downloads++;}});h.run('applicationAnswersReady=true');await h.run("exportCsv('profiles')");
  assert.equal(downloads,1);const csv=await blobs[0].text();assert.equal(csv.trim().split(/\r?\n/).length,2506);assert(csv.includes('Member 2504'));assert(csv.includes('Application 2504'));assert(csv.includes("\"'=SUM(1,2)\""));assert.equal(h.requests.filter(r=>r.table==='profiles').length,6);
});
test('Course notifications wait for enrollment data before choosing the classroom and feedback tab',async()=>{
  const h=learningHarness();h.run("cache.notifications=[{id:'n',read_at:'2026-10-14',target_type:'course',target_id:'new-class',title:'Classwork feedback: build'}];cache.course_enrollments=[];openWorkspaceDestination=async()=>{cache.course_enrollments=[{course_id:'new-class',learner_id:'self'}];return true;}");
  await h.run("openNotification('n')");assert.equal(h.run('activeCourseId'),'new-class');assert.equal(h.run('courseView'),'mine');assert.equal(h.run('courseDetailView'),'classwork');
});
test('Project notifications wait for the destination data before opening a project',async()=>{
  const h=learningHarness();let opened='';h.context.captureProject=id=>{opened=id;};h.run("cache.notifications=[{id:'n',read_at:'2026-10-14',target_type:'project',target_id:'p-new'}];openWorkspaceDestination=async()=>true;projectDetail=id=>captureProject(id)");await h.run("openNotification('n')");assert.equal(opened,'p-new');
});
test('The real workspace renderer shows skeletons and replaces them with retry content on failure',()=>{
  const h=harness();for(const id of ['authButton','connectionLabel','accountBadge','pageCrumb','guestSidebarCta','onlineBadge','dmBadge','content'])h.elements.set('#'+id,node());
  h.run("authReady=true;updateWorkspaceNavigation=()=>{};updateInboxIndicators=()=>{};updateAdminAlertControls=()=>{};workspacePageLoads.set('messages',{status:'loading',hadData:false,slow:true})");h.renderOriginal();assert(h.elements.get('#content').innerHTML.includes('skeleton-chat'));assert(h.elements.get('#content').innerHTML.includes('Still loading'));
  h.run("workspacePageLoads.get('messages').status='error'");h.renderOriginal();assert(h.elements.get('#content').innerHTML.includes('retryPage'));assert(!h.elements.get('#content').innerHTML.includes('page-skeleton'));
});
function startupGuardSource(){const match=fs.readFileSync(root+'/index.html','utf8').match(/<script id="spaceStartupGuard">([\s\S]*?)<\/script>/);assert(match,'An inline guard must work even before external scripts download');return match[1];}
test('A startup module that cannot download gets a reload action instead of an endless skeleton',()=>{
  const placeholder=node(),listeners=new Map();let timeout,reloads=0,click;
  placeholder.querySelector=()=>({addEventListener(_event,handler){click=handler;}});
  const context=vm.createContext({document:{querySelector:()=>placeholder,addEventListener(name,handler){listeners.set(name,handler);}},location:{reload(){reloads++;}},setTimeout(fn,ms){assert.equal(ms,12000);timeout=fn;}});
  vm.runInContext(startupGuardSource(),context);timeout();assert(placeholder.innerHTML.includes('Reload SPACE'));assert(!placeholder.innerHTML.includes('page-skeleton'));click();assert.equal(reloads,1);
  placeholder.innerHTML='pending';listeners.get('error')({target:{matches:()=>true}});assert(placeholder.innerHTML.includes('Reload SPACE'));
});
test('The startup recovery guard cannot replace a workspace that is already initialized',()=>{
  const placeholder=node({innerHTML:'private workspace'});let timeout;
  const context=vm.createContext({document:{querySelector:()=>placeholder,addEventListener(){}},location:{},setTimeout(fn){timeout=fn;}});
  vm.runInContext(startupGuardSource(),context);placeholder.isConnected=false;timeout();assert.equal(placeholder.innerHTML,'private workspace');
});
function officeHarness(role='member',positions=[]){const h=learningHarness(role);h.exec('officerReady=true;officerAccessChecked=true;ownOfficerRoles=qaArgs;financeAdminReady=true;financeReady=true;financeApprovalsReady=true;cache.officer_assignments=[];cache.officer_work_items=[];cache.officer_work_events=[];cache.finance_entries=[];cache.finance_reviews=[];cache.finance_receipts=[];',positions);return h;}
test('An explicit sign-out marker prevents credentials returning on reload',()=>{
 const localItems=new Map([['sb-qa-auth-token','old'],['sb-qa-auth-token-space-signed-out','1']]),sessionItems=new Map([['sb-qa-auth-token','tab-old']]);harness({localItems,sessionItems});assert.equal(localItems.has('sb-qa-auth-token'),false);assert.equal(sessionItems.has('sb-qa-auth-token'),false);assert.equal(localItems.get('sb-qa-auth-token-space-signed-out'),'1');
});
test('Storage reads do not resurrect tokens deleted by another browser tab',()=>{
 const h=harness();h.clientOptions.auth.storage.setItem('sb-qa-auth-token','value');h.localItems.delete('sb-qa-auth-token');assert.equal(h.clientOptions.auth.storage.getItem('sb-qa-auth-token'),null);
});
test('Assigned offices open workspaces without granting finance management or removing teaching',()=>{
 const h=officeHarness('teacher',['secretary','events_coordinator']);assert.equal(h.run('officerAccess()'),true);assert.equal(h.run('teacher()'),true);assert.equal(h.run('financeReportAccess()'),false);assert(h.run('officePage()').includes('Secretary'));assert(h.run('finance()').includes('Administrator access required'));assert(h.run('personalHome()').includes('#office'));
});
test('Treasurers see approved reports with no recording, approval or month-close controls',()=>{
 const h=officeHarness('member',['treasurer']);h.run("financeReport={month:'2026-09-01',opening_balance:0,income:100,expense:20,closing_balance:80,approved_count:0,categories:[],review:null};");const markup=h.run('financeReportsPage()');assert(markup.includes('read-only access'));assert(!markup.includes('data-action="closeFinanceMonthForm"'));assert(!markup.includes('data-action="reviewFinance"'));assert(!markup.includes('Record transaction'));assert(h.run('finance()').includes('Administrator access required'));
});
test('Only administrators can open the role editor and all offices can be removed',async()=>{
 const h=officeHarness('admin');h.run("officerRoleForm('learner')");assert.equal((h.elements.get('#modalContent').innerHTML.match(/name="positions"/g)||[]).length,7);assert(h.elements.get('#modalContent').innerHTML.includes('existing member access'));await h.exec('submit(qaArgs)',learningForm('officerRoles',[['user_id','learner'],['note','Handing over responsibilities']]).event);assert.equal(h.rpcCalls[0].name,'space_set_officer_roles');assert.deepEqual(Array.from(h.rpcCalls[0].args.p_roles),[]);const member=officeHarness();member.run("officerRoleForm('learner')");assert.equal(member.elements.get('#modalContent').innerHTML,'');
});
test('Multiple officer selections are sent as additive roles to the database RPC',async()=>{
 const h=officeHarness('admin');await h.exec('submit(qaArgs)',learningForm('officerRoles',[['user_id','learner'],['positions','secretary'],['positions','treasurer'],['note','First club committee']]).event);assert.deepEqual(Array.from(h.rpcCalls[0].args.p_roles),['secretary','treasurer']);assert.equal(h.requests.filter(r=>r.ops.some(o=>o[0]==='update')).length,0);
});
test('Officers save work through the permission-checked RPC and cannot submit admin feedback',async()=>{
 const h=officeHarness('member',['secretary']);await h.exec('submit(qaArgs)',learningForm('officerWork',[['assignment','self|secretary'],['kind','minutes'],['title','Club decisions'],['body','Owners and workshop dates agreed.'],['status','submitted'],['feedback','Attempted self review']]).event);assert.equal(h.rpcCalls[0].name,'save_officer_work');assert.equal(h.rpcCalls[0].args.p_feedback,'');assert.equal(h.rpcCalls[0].args.p_assignee,'self');
});
test('Office cards only show the current officer work and escape all user-authored text',()=>{
 const h=officeHarness('member',['secretary']);h.exec('cache.officer_work_items=qaArgs',[{id:'mine',assignee_id:'self',position:'secretary',title:'<script>bad()</script>',body:'Safe notes <img src=x>',status:'submitted',updated_at:'2026-10-01'},{id:'other',assignee_id:'learner',position:'secretary',title:'Private other work',body:'Confidential work',status:'todo',updated_at:'2026-10-01'}]);const markup=h.run('officePage()');assert(markup.includes('&lt;script&gt;'));assert(markup.includes('&lt;img'));assert(!markup.includes('Private other work'));assert(!markup.includes('<script>bad'));
});
test('Removing all officer assignments clears cached work and approved reports',async()=>{
 const h=officeHarness('member',['treasurer']);h.run("cache.officer_work_items=[{id:'private'}];cache.officer_work_events=[{id:'private'}];financeReport={closing_balance:10};financeReportRows=[{id:'private'}]");h.queued.push({data:[],error:null});await h.run('loadOwnOfficerAccess()');assert.equal(h.run('officerAccess()'),false);assert.equal(h.run('financeReportAccess()'),false);assert.equal(h.run('cache.officer_work_items'),undefined);assert.equal(h.run('financeReport'),null);assert.equal(h.run('financeReportRows.length'),0);
});
test('A late finance report from an older month cannot overwrite the selected report',async()=>{
 const h=officeHarness('member',['treasurer']),slow=deferred();h.rpcQueued.push(slow.promise,{data:[],error:null});const loading=h.run('loadFinanceMonthReport()');h.run("financeMonth='2025-01';financeReport={month:'2025-01-01'}");slow.resolve({data:{month:'2026-09-01'},error:null});await loading;assert.equal(h.run('financeReport.month'),'2025-01-01');
});
test('Finance report requests only use approved report RPCs with bounded pages',async()=>{
 const h=officeHarness('member',['treasurer']);h.rpcQueued.push({data:{approved_count:0},error:null},{data:[],error:null});await h.run('loadFinanceMonthReport()');assert.deepEqual(h.rpcCalls.map(c=>c.name),['finance_month_report','finance_report_entries']);assert.equal(h.rpcCalls[1].args.p_limit,50);assert.equal(h.requests.length,0);
});
test('Pending financial entries cannot be approved from the UI before a receipt is attached',()=>{
 const h=officeHarness('admin');h.exec('cache.finance_entries=qaArgs',[{id:'entry',entry_type:'income',category:'Gift',amount:10,description:'Test gift',occurred_on:'2026-09-01',created_at:'2026-09-01',created_by:'self',voucher_number:3}]);let markup=h.run('financeEntryRow(cache.finance_entries[0])');assert(/data-decision="approved"[^>]*disabled/.test(markup));h.run("cache.finance_receipts=[{id:'receipt',entry_id:'entry',file_name:'receipt.pdf'}]");markup=h.run('financeEntryRow(cache.finance_entries[0])');assert(!/data-decision="approved"[^>]*disabled/.test(markup));assert(markup.includes('1 receipt(s)')); 
});
test('Invalid receipt types and oversized files never reach private storage',async()=>{
 const h=officeHarness('admin');for(const file of [{name:'bad.html',type:'text/html',size:10},{name:'large.pdf',type:'application/pdf',size:10485761}])await assert.rejects(()=>h.exec("uploadFinanceReceipt('entry',qaArgs)",file));assert.equal(h.requests.length,0);
});

function advancedHarness(role='member',positions=[]){const h=officeHarness(role,positions);h.run("advancedReady=true;advancedChecked=true;pushSettingsCard=()=>'';loadAdvancedDmAssets=async()=>{};for(const table of Object.values(advancedTables).flat())cache[table]=[];cache.course_completions=[];cache.finance_monthly_reviews=[];cache.space_class_sessions=[];cache.space_course_lessons=[];cache.space_practical_grades=[];cache.space_grade_history=[];");return h;}
test('Classroom tools distinguish teacher controls from student lesson progress',()=>{const h=advancedHarness();h.exec('cache.space_course_lessons=qaArgs',[{id:'lesson',course_id:'c1',position:1,title:'Build <script>bad</script>',outcome:'Measure the response.',instructions:'Compare <img src=x> trial results.'}]);const markup=h.run('classroomWorkspace()');assert(markup.includes('Mark lesson finished'));assert(markup.includes('&lt;script&gt;'));assert(!markup.includes('spaceLessonForm'));const t=advancedHarness('teacher');assert(t.run('classroomWorkspace()').includes('spaceLessonForm'));});
test('Gradebook calculates the practical rubric and protects peer assessment visibility',()=>{const h=advancedHarness();h.run("advancedTab='grades';cache.classroom_assignment_submissions=[{id:'mine',assignment_id:'a1',learner_id:'self',review_status:'accepted',created_at:'2026-10-01'},{id:'other',assignment_id:'a1',learner_id:'learner',review_status:'accepted',created_at:'2026-10-01'}];cache.space_practical_grades=[{id:'g1',submission_id:'mine',course_id:'c1',learner_id:'self',demonstration:90,testing:80,explanation:70,feedback:'Safe <img src=x>'},{id:'g2',submission_id:'other',course_id:'c1',learner_id:'learner',demonstration:0,testing:0,explanation:0,feedback:'Private peer feedback'}]");const markup=h.run('classroomWorkspace()');assert(markup.includes('82 / 100'));assert(markup.includes('&lt;img'));assert(!markup.includes('Private peer feedback'));assert(!markup.includes('spaceGradeForm'));});
test('Certificate sharing requires an own completion and defaults to private',()=>{const h=advancedHarness();h.run("spaceFormAction('spaceCertificateForm','',{dataset:{course:'c1'}})");assert.equal(h.elements.get('#modalContent').innerHTML,'');h.run("cache.course_completions=[{id:'done',course_id:'c1',learner_id:'self'}];spaceFormAction('spaceCertificateForm','',{dataset:{course:'c1'}})");const markup=h.elements.get('#modalContent').innerHTML;assert(markup.includes('name="public"'));assert(!/name="public" checked/.test(markup));});
test('A completed course certificate sends an explicit privacy choice to the RPC',async()=>{const h=advancedHarness();await h.exec('submit(qaArgs)',learningForm('spaceCertificate',[['course','c1'],['public','on']]).event);assert.equal(h.rpcCalls[0].name,'space_issue_certificate');assert.equal(h.rpcCalls[0].args.p_public,true);});
test('Home action centre excludes other members work and links directly to the right workspace',()=>{const h=advancedHarness();h.run("cache.space_meeting_actions=[{id:'one',meeting_id:'meeting',assignee_id:'self',title:'Prepare a prototype',status:'todo',due_at:'2030-10-01'},{id:'two',meeting_id:'meeting',assignee_id:'learner',title:'Private other action',status:'todo'}]");const markup=h.run('advancedMyDay()');assert(markup.includes('Prepare a prototype'));assert(markup.includes('#meeting-room/meeting'));assert(!markup.includes('Private other action'));});
test('Members read meeting minutes without secretary editing or attendance controls',()=>{const h=advancedHarness();h.run("cache.space_meetings=[{id:'meeting',title:'Club meeting',starts_at:'2026-10-01',agenda:'Plan the next build.',minutes:'Agreed owners and dates.',status:'completed'}]");const markup=h.run('advancedMeetingWorkspace()');assert(markup.includes('Agreed owners and dates.'));assert(!markup.includes('spaceMeetingForm'));assert(!markup.includes('spaceMeetingAttendance'));assert(!markup.includes('Revision history'));});
test('Project boards expose four accessible status choices and only assigned team controls',()=>{const h=advancedHarness();h.run("cache.projects=[{id:'p1',owner_id:'learner',title:'Workshop robot'}];cache.project_members=[];cache.project_tasks=[{id:'task',project_id:'p1',title:'Measure the motor',status:'review',assignee_id:'learner'}];cache.space_project_updates=[]");let markup=h.run('advancedProjectWorkspace()');assert(markup.includes('To review'));assert(!markup.includes('data-space-task='));h.run("cache.project_tasks[0].assignee_id='self'");markup=h.run('advancedProjectWorkspace()');assert(markup.includes('data-space-task="task"'));assert(markup.includes('value="in_progress"'));});
test('An event at capacity offers the waiting list; a confirmed member can cancel',()=>{const h=advancedHarness();h.exec('cache.events=qaArgs',[{id:'event',title:'Demo day',starts_at:new Date(Date.now()+3600000).toISOString(),ends_at:new Date(Date.now()+7200000).toISOString(),location:'Lab'}]);h.run("spaceEventSummaries.set('event',{capacity:1,confirmed:1,waiting:2})");let markup=h.run('advancedEvents()');assert(markup.includes('Join waiting list'));assert(!markup.includes('spaceEventForm'));h.run("cache.space_event_registrations=[{event_id:'event',user_id:'self',status:'confirmed'}]");markup=h.run('advancedEvents()');assert(markup.includes('Cancel my place'));});
test('Notification category filters preserve the inbox while excluding unrelated categories',()=>{const h=advancedHarness();h.run("enhancedReady=true;advancedNotificationFilter='learning';cache.notifications=[{id:'learning',kind:'course_grade',title:'Practical score ready',created_at:'2026-10-01'},{id:'private',kind:'direct_message',title:'A private hello',created_at:'2026-10-01'}]");const markup=h.run('advancedNotifications()');assert(markup.includes('Practical score ready'));assert(!markup.includes('A private hello'));assert(markup.includes('Notification preferences'));h.run("advancedPreferences.muted_categories=['learning']");assert.equal(h.run("advancedAlertAllowed({kind:'course_grade'})"),false);assert.equal(h.run("advancedAlertAllowed({kind:'direct_message'})"),true);});
test('Notification preferences submit only supported categories and explicit channel choices',async()=>{const h=advancedHarness();await h.exec('submit(qaArgs)',learningForm('',[['category','messages'],['category','office'],['popups','on']],'spaceNotificationPreferences').event);const call=h.rpcCalls[0];assert.equal(call.name,'space_save_notification_preferences');assert.deepEqual(Array.from(call.args.p_muted),['learning','projects','events','club']);assert.equal(call.args.p_popups,true);assert.equal(call.args.p_push,false);});
test('Shared file filters are paginated and never render unescaped document titles',()=>{const h=advancedHarness();h.run("communityReady=true;cache.documents=[{id:'doc1',title:'Controller <img src=x>',file_type:'application/pdf',file_size:20,author_id:'self',created_at:'2026-10-01'},{id:'doc2',title:'Robot slides',file_type:'application/presentation',file_size:20,author_id:'self',created_at:'2026-10-01'}];advancedFileType='pdf'");const markup=h.run('advancedLibrary()');assert(markup.includes('Controller &lt;img'));assert(!markup.includes('Robot slides'));assert(markup.includes('1 matching files'));});
test('Private file selection accepts documents and rejects active HTML or oversized files',()=>{const h=advancedHarness();assert.equal(h.exec('validateDmFile(qaArgs).mime',{name:'report.pdf',size:20,type:'application/pdf'}),'application/pdf');for(const file of [{name:'script.html',size:20},{name:'report.pdf',size:10485761},{name:'empty.txt',size:0}])assert.throws(()=>h.exec('validateDmFile(qaArgs)',file));});
test('An interrupted message retry reuses its request token and preserves the draft',async()=>{const h=advancedHarness(),f=composer('a','Hello build team');h.run("activePeerId='a';loadDmThread=async()=>{}");h.rpcQueued.push({error:{message:'Network interrupted'}},{data:message('sent','self','a','Hello build team'),error:null});await h.exec('sendAdvancedDm(qaArgs)',f.form);assert.equal(h.run("dmDraftFor('a').text"),'Hello build team');await h.exec('sendAdvancedDm(qaArgs)',f.form);assert.equal(h.rpcCalls[0].name,'space_send_dm');assert.equal(h.rpcCalls[0].args.p_token,h.rpcCalls[1].args.p_token);assert.equal(h.run("dmDraftFor('a').text"),'');});
test('Advanced sends keep their original recipient and preserve a new draft during the request',async()=>{const h=advancedHarness(),slow=deferred(),f=composer('a','Original message');h.run("activePeerId='a';loadDmThread=async()=>{}");h.rpcQueued.push(slow.promise);const sending=h.exec('sendAdvancedDm(qaArgs)',f.form);h.run("activePeerId='b';dmDraftFor('a').text='New draft';dmDraftFor('a').token=null");slow.resolve({data:message('sent','self','a','Original message'),error:null});await sending;assert.equal(h.rpcCalls[0].args.p_peer,'a');assert.equal(h.run("dmDraftFor('a').text"),'New draft');});
test('Late shared-file responses cannot cross into another conversation',async()=>{const h=advancedHarness(),slow=deferred();h.run("activePeerId='a';loadAdvancedDmAssets=undefined");// Restore the real loader rather than the convenience stub in advancedHarness.
 const src=fs.readFileSync(root+'/app.js','utf8'),start=src.indexOf('async function loadAdvancedDmAssets('),end=src.indexOf('\nfunction spaceDmTools',start);h.run(src.slice(start,end));h.rpcQueued.push(slow.promise);const loading=h.run('loadAdvancedDmAssets()');h.run("activePeerId='b'");slow.resolve({data:{pins:[],files:[{id:'private-a'}],total:1},error:null});await loading;assert.equal(h.run('dmAssets.files.length'),0);});
test('Text drafts survive only for their owner and authentication forms are excluded',()=>{const h=advancedHarness();h.run("dmDraftFor('a').text='Saved private draft';spaceSaveDmDraft('a',dmDraftFor('a'))");assert.equal(h.run("spaceReadDmDraft('a').text"),'Saved private draft');h.run("session.user.id='another'");assert.equal(h.run("spaceReadDmDraft('a').text"),undefined);h.run("spaceClearDrafts('self')");assert.equal([...h.sessionItems.keys()].some(k=>k.startsWith('space.draft.self.')),false);assert.equal(h.exec('spaceDraftKey(qaArgs)',{dataset:{kind:'verify'}}),'');});
test('Finance follow-up controls stay absent from treasurer and founder views',()=>{for(const role of ['member','founder']){const h=advancedHarness(role,['treasurer']);h.run("financeReport={review:{id:'review',difference:10}};");assert.equal(h.run('advancedFinanceFollowupPanel()'),'');}const h=advancedHarness('admin');h.run("financeReport={review:{id:'review',difference:10}};");assert(h.run('advancedFinanceFollowupPanel()').includes('Review needs follow-up'));});
test('Missing advanced tables show setup guidance while existing learning and finance remain usable',()=>{const h=advancedHarness('admin');h.run('advancedReady=false');assert(h.run('classroomWorkspace()').includes('upgrade_advanced_platform.sql'));assert(h.run('finance()').includes('Transaction ledger'));assert(h.run('courses()').includes('My learning'));});
test('Scoped advanced queries use the selected course and paginate beyond the default row limit',async()=>{const h=advancedHarness();h.queued.push({data:[{id:'one'}],count:2,error:null},{data:[{id:'two'}],count:2,error:null});const rows=await h.run("readAdvancedRows('space_practical_grades',{eq:{course_id:'c1'}})");assert.equal(rows.length,2);for(const call of h.requests)assert(call.ops.some(op=>op[0]==='eq'&&op[1]==='course_id'&&op[2]==='c1'));assert(h.requests[1].ops.some(op=>op[0]==='range'&&op[1]===1));});

test('File messages outside the shared-files preview keep a direct download control',()=>{const h=advancedHarness();h.run("activePeerId='a';dmAssets={peer:'a',pins:[],files:[],total:250}");const markup=h.exec('spaceDmFileMarkup(qaArgs)',{id:'older-file',has_document:true});assert(markup.includes('spaceDmMessageFile'));assert(markup.includes('older-file'));assert.equal(h.exec('spaceDmFileMarkup(qaArgs)',{id:'plain',has_document:false}),'');});
test('The paginated member directory fetches 24 rows while retaining complete server counts',async()=>{
 const h=directoryHarness();h.run("page='members';memberDirectoryPage=1;ensureMemberDirectory()");
 const rows=Array.from({length:24},(_,n)=>({id:'row-'+n,full_name:'Remote '+n,role:'member',membership_status:'approved',skills:'Robotics'}));
 h.rpcQueued.push({data:{rows,total:2505,offset:24,stats:{all:2505,online:20,new:30,shared:40,saved:2},skills:[{label:'Robotics',count:1800}]},error:null});await h.run('loadMemberDirectory()');
 const call=h.rpcCalls.at(-1);assert.equal(call.name,'space_member_directory');assert.equal(call.args.p_limit,24);assert.equal(h.run('memberRemote.rows.length'),24);const html=h.run('members()');assert.equal((html.match(/data-member-id=/g)||[]).length,24);assert(html.includes('25–48 of 2505'));assert(html.includes('Page 2 of 105'));assert(!h.requests.some(r=>r.table==='profiles'&&r.ops.some(op=>op[0]==='range')));
});
test('Directory filters and bookmarks go to the server instead of filtering a partial page',async()=>{
 const h=directoryHarness(),id='12345678-1234-1234-1234-123456789abc';h.exec("ensureMemberDirectory();memberDirectory.search='python robotics';memberDirectory.role='leads';memberDirectory.group='saved';memberDirectory.sort='shared';memberSavedIds.add(qaArgs);memberDirectoryPage=3",id);
 h.rpcQueued.push({data:{rows:[],total:0,offset:0,stats:{},skills:[]},error:null});await h.run('loadMemberDirectory()');const a=h.rpcCalls.at(-1).args;assert.equal(a.p_search,'python robotics');assert.equal(a.p_role,'leads');assert.equal(a.p_group,'saved');assert.equal(a.p_offset,72);assert.deepEqual(Array.from(a.p_saved),[id]);
});
test('An old member search cannot overwrite a newer search or another account',async()=>{
 const h=directoryHarness(),slow=deferred();h.rpcQueued.push(slow.promise);const old=h.run('loadMemberDirectory()');h.run("memberDirectory.search='new query'");h.rpcQueued.push({data:{rows:[],total:7,offset:0,stats:{all:100},skills:[]},error:null});await h.run('loadMemberDirectory()');slow.resolve({data:{rows:[],total:99,offset:0,stats:{},skills:[]},error:null});await old;assert.equal(h.run('memberRemote.total'),7);
 const late=deferred();h.rpcQueued.push(late.promise);const loading=h.run('loadMemberDirectory()');h.run("authGeneration++;session={user:{id:'other'}};resetMemberDirectory()");late.resolve({data:{rows:[],total:300,offset:0,stats:{},skills:[]},error:null});await loading;assert.equal(h.run('memberRemote.ready'),false);
});
test('A missing directory function offers migration guidance without downloading all profiles',async()=>{
 const h=directoryHarness();h.rpcQueued.push({error:{code:'PGRST202',message:'Could not find the function public.space_member_directory'}});await h.run('loadMemberDirectory()');assert(h.run('members()').includes('upgrade_directory_learning_performance.sql'));assert.equal(h.requests.length,0);
});
test('Student record reads include the learner filter while teacher and admin reads retain their scope',async()=>{
 for(const role of ['member','teacher','admin']){const h=dataHarness('classroom',{role});for(const table of ['course_enrollments','course_submissions','course_completions','classroom_assignment_submissions'])await h.exec('readRecords(qaArgs)',table);for(const r of h.requests)assert.equal(r.ops.some(op=>op[0]==='eq'&&op[1]==='learner_id'&&op[2]==='self'),role==='member');}
});
test('Student classroom loading does not retrieve the complete member directory',async()=>{
 const h=dataHarness('classroom',{tables:{courses:[{id:'course',instructor_id:'teacher'}]}});await h.run('refresh()');assert(!h.requests.some(r=>r.table==='profiles'&&r.ops.some(op=>op[0]==='range')));assert(h.requests.some(r=>r.table==='profiles'&&r.ops.some(op=>op[0]==='in'&&op[1]==='id')));
});

test('Signing out in another tab clears this tab immediately and ignores unrelated storage',async()=>{
 const h=sessionHarness();await h.login();h.exec('handleAuthStorageChange(qaArgs)',{key:'other-app',newValue:'1'});assert.equal(h.run('session.user.id'),'self');h.exec('handleAuthStorageChange(qaArgs)',{key:'sb-qa-auth-token-space-signed-out',newValue:'1'});assert.equal(h.run('session'),null);assert.equal(h.run('sessionEnding'),true);
});
test('Opening a role notification does not wait for a slow read-status write',async()=>{
 const h=harness(),slow=deferred();h.queued.push(slow.promise);h.run("let openedRole=null;updateInboxIndicators=()=>{};setSidebarOpen=()=>{};commerce={openRole:async id=>{openedRole=id;}};cache.notifications=[{id:'notice',target_type:'role_change',target_id:'role-note',title:'Role updated',read_at:null}];");
 const button=node();await h.exec("openNotification('notice',qaArgs)",button);assert.equal(h.run('openedRole'),'role-note');assert.equal(button.disabled,false);assert.equal(h.requests.length,1);assert(h.requests[0].ops.some(x=>x[0]==='eq'&&x[1]==='user_id'&&x[2]==='self'));slow.resolve({error:null});
});
test('An unavailable notification destination restores its Open button and reports the failure',async()=>{
 const h=harness();h.context.console={...console,error(){}};h.run("setSidebarOpen=()=>{};commerce={openRole:async()=>{throw Error('Role notice unavailable');}};cache.notifications=[{id:'notice',target_type:'role_change',target_id:'role-note',read_at:'already'}];");const button=node({textContent:'Open →'});await h.exec("openNotification('notice',qaArgs)",button);assert.equal(button.disabled,false);assert.equal(button.textContent,'Open →');assert.equal(h.elements.get('#toast').textContent,'Role notice unavailable');
});
test('New members can open the shop and product alerts before selecting learning courses',async()=>{
 const h=harness();h.run("learningChoicesReady=true;ownLearningTracks=[];authReady=true;workspaceHydrating=true;setSidebarOpen=()=>{};location.hash='#shop/product-one';route();");assert.equal(h.run('page'),'shop');h.run("cache.notifications=[{id:'new-product',target_type:'shop_product',target_id:'product-two',read_at:'already'}];");await h.exec("openNotification('new-product',qaArgs)",node({textContent:'Open →'}));assert.equal(h.context.location.hash,'#shop/product-two');assert.equal(h.run('page'),'shop');
});
// Password authentication keeps existing account IDs and approval boundaries.
function authForm(kind='login',entries=[],mode='signin'){
 const button=node({disabled:false}),feedback=node({hidden:true});
 const form=node({id:'editor',dataset:{kind,authMode:mode},entries,querySelector(selector){return selector==='[type=submit]'?button:selector==='[data-auth-feedback]'?feedback:null;}});
 return {button,feedback,form,event:{target:form,preventDefault(){}}};
}
function passwordHarness(){const h=loginHarness();Object.assign(h.context.location,{origin:'https://turkson225.github.io',pathname:'/Turk-Innovation-CLUB/'});return h;}
test('Email/password sign-in keeps the existing account and exact password, without sending an OTP',async()=>{
 const h=passwordHarness(),calls=[],password='  My existing password  ',form=authForm('login',[['email',' SELF@EXAMPLE.TEST '],['password',password]]);
 h.db.auth.signInWithPassword=async args=>{calls.push(args);return {data:{session:loginSession('self')},error:null};};h.db.auth.signInWithOtp=()=>{throw Error('OTP login is forbidden');};
 h.queued.push({data:loginProfile(),error:null});await h.exec('submit(qaArgs)',form.event);
 assert.equal(calls.length,1);assert.equal(calls[0].email,'self@example.test');assert.equal(calls[0].password,password);assert.equal(h.run('session.user.id'),'self');assert.equal(h.stats.opens,1);assert.equal(form.button.disabled,false);
 assert(!JSON.stringify([...h.localItems,...h.sessionItems]).includes(password));
});
test('Wrong passwords stay visible in the open auth form and never grant workspace access',async()=>{
 const h=passwordHarness(),form=authForm('login',[['email','self@example.test'],['password','wrong']]);h.db.auth.signInWithPassword=async()=>({data:{session:null},error:{message:'Invalid login credentials'}});
 await h.exec('submit(qaArgs)',form.event);assert.equal(h.run('session'),null);assert.equal(h.stats.opens,0);assert.equal(form.feedback.textContent,'Invalid login credentials');assert.equal(form.feedback.hidden,false);assert.equal(form.button.disabled,false);
});
test('A duplicate password submit cannot create two sign-in requests',async()=>{
 const h=passwordHarness(),pending=deferred(),form=authForm('login',[['email','self@example.test'],['password','password']]);let calls=0;h.db.auth.signInWithPassword=()=>{calls++;return pending.promise;};
 const first=h.exec('submit(qaArgs)',form.event);await h.exec('submit(qaArgs)',form.event);assert.equal(calls,1);pending.resolve({data:{session:null},error:{message:'Try again'}});await first;assert.equal(form.button.disabled,false);
});
test('Signup sends a password and an application choice, never an authoritative role',async()=>{
 const h=passwordHarness(),form=authForm('login',[['email',' TEACHER@EXAMPLE.TEST '],['password','a unique password'],['password_confirm','a unique password'],['application_type','teacher']],'signup'),calls=[];
 h.db.auth.signUp=async args=>{calls.push(args);return {data:{user:{id:'applicant'},session:null},error:null};};await h.exec('submit(qaArgs)',form.event);
 assert.equal(calls[0].email,'teacher@example.test');assert.equal(calls[0].password,'a unique password');assert.equal(calls[0].options.data.application_type,'teacher');assert.equal(calls[0].options.data.role,undefined);assert.equal(h.run('session'),null);assert.equal(h.run('pendingAuthMode'),'signup');assert.equal(h.sessionItems.get('innovatex.pendingType'),'teacher');assert(h.elements.get('#modalContent').innerHTML.includes('data-kind="verify"'));assert(!JSON.stringify([...h.localItems,...h.sessionItems]).includes('a unique password'));
});
test('Signup rejects a short password and mismatched confirmation before creating an account',async()=>{
 for(const [password,confirmation]of [['short','short'],['long enough','different']]){const h=passwordHarness(),form=authForm('login',[['email','self@example.test'],['password',password],['password_confirm',confirmation]],'signup');h.db.auth.signUp=()=>{throw Error('Must not create an account');};await h.exec('submit(qaArgs)',form.event);assert.match(form.feedback.textContent,/8 characters|do not match/);assert.equal(h.run('session'),null);}
});
test('Signup choices cannot request an administrator role',async()=>{
 const h=passwordHarness(),form=authForm('login',[['email','self@example.test'],['password','long enough'],['password_confirm','long enough'],['application_type','admin']],'signup');let sent;h.db.auth.signUp=async args=>{sent=args;return {data:{session:null},error:null};};await h.exec('submit(qaArgs)',form.event);assert.equal(sent.options.data.application_type,'member');assert.equal(sent.options.data.role,undefined);
});
test('Unverified password login opens verification without overwriting the application type',async()=>{
 const h=passwordHarness(),form=authForm('login',[['email','self@example.test'],['password','long enough']]);h.db.auth.signInWithPassword=async()=>({data:{session:null},error:{code:'email_not_confirmed'}});await h.exec('submit(qaArgs)',form.event);assert(h.elements.get('#modalContent').innerHTML.includes('Verify your email'));assert.equal(h.sessionItems.has('innovatex.pendingType'),false);assert.equal(h.run('session'),null);
});
test('A pending teacher signup retains its selection after an unverified password attempt',async()=>{
 const h=passwordHarness(),form=authForm('login',[['email','self@example.test'],['password','long enough']]);h.run("rememberSignup('self@example.test','teacher')");h.db.auth.signInWithPassword=async()=>({data:{session:null},error:{code:'email_not_confirmed'}});await h.exec('submit(qaArgs)',form.event);assert.equal(h.sessionItems.get('innovatex.pendingType'),'teacher');
});
test('Resending signup verification uses resend and cannot silently create another account',async()=>{
 const h=passwordHarness(),calls=[];h.run("rememberSignup('self@example.test','founder')");h.db.auth.resend=async args=>{calls.push(args);return {error:null};};await h.run('requestCode(pendingEmail)');assert.equal(calls[0].type,'signup');assert.equal(calls[0].email,'self@example.test');assert.equal(h.sessionItems.get('innovatex.pendingType'),'founder');assert.equal(h.run('session'),null);
});
test('A stale sign-in code does not replace the email/password sign-in screen',()=>{
 const h=passwordHarness();h.run("pendingEmail='old@example.test';pendingAuthMode='signin';signInDialog('signin')");const html=h.elements.get('#modalContent').innerHTML;assert(html.includes('type="password"'));assert(html.includes('autocomplete="current-password"'));assert(!html.includes('data-kind="verify"'));
});
test('Existing-account recovery requests use the dedicated reset URL and a neutral response',async()=>{
 const h=passwordHarness(),form=authForm('passwordResetRequest',[['email',' SELF@EXAMPLE.TEST ']]),calls=[];h.db.auth.resetPasswordForEmail=async(email,options)=>{calls.push({email,options});return {error:null};};await h.exec('submit(qaArgs)',form.event);assert.equal(calls[0].email,'self@example.test');assert.equal(calls[0].options.redirectTo,'https://turkson225.github.io/Turk-Innovation-CLUB/reset-password.html');assert(h.elements.get('#modalContent').innerHTML.includes('If an account can receive'));assert.equal(h.run('session'),null);
});
test('Password recovery remains available after explicit sign-out',async()=>{
 const h=passwordHarness(),form=authForm('passwordResetRequest',[['email','self@example.test']]);h.run('sessionEnding=true');let called=false;h.db.auth.resetPasswordForEmail=async()=>{called=true;return {error:null};};await h.exec('submit(qaArgs)',form.event);assert.equal(called,true);assert.equal(h.run('session'),null);
});
test('Password authentication still enforces pending application access',async()=>{
 const h=passwordHarness(),form=authForm('login',[['email','self@example.test'],['password','long enough']]);h.db.auth.signInWithPassword=async()=>({data:{session:loginSession('self')},error:null});h.queued.push({data:loginProfile('self',{membership_status:'pending'}),error:null});await h.exec('submit(qaArgs)',form.event);assert.equal(h.run('clubAccess()'),false);assert.equal(h.run('admin()'),false);assert.equal(h.run('me.membership_status'),'pending');
});
test('Cross-tab sign-out cancels a delayed password response before account hydration',async()=>{
 const h=passwordHarness(),pending=deferred(),form=authForm('login',[['email','self@example.test'],['password','long enough']]);h.db.auth.signInWithPassword=()=>pending.promise;
 const signing=h.exec('submit(qaArgs)',form.event);h.exec('handleAuthStorageChange(qaArgs)',{key:'sb-qa-auth-token-space-signed-out',newValue:'1'});pending.resolve({data:{session:loginSession('self')},error:null});await signing;assert.equal(h.run('session'),null);assert.equal(h.stats.opens,0);assert.equal(h.requests.filter(r=>r.table==='profiles').length,0);assert.match(form.feedback.textContent,/cancelled/);
});
test('Root recovery callbacks redirect with their fragment before creating a workspace auth client',async()=>{
 let redirected='';const hash='#access_token=recovery-token&refresh_token=refresh&type=recovery';const h=harness({location:{origin:'https://turkson225.github.io',pathname:'/Turk-Innovation-CLUB/',hash,replace(url){redirected=url;}}});assert.equal(h.clientOptions,undefined);await h.run('init()');assert.equal(redirected,'https://turkson225.github.io/Turk-Innovation-CLUB/reset-password.html'+hash);assert.equal(h.requests.length,0);
});
test('Normal signup callbacks are identified before routing and token hydration',()=>{
 const h=harness({location:{hash:'#access_token=signup-token&refresh_token=refresh&type=signup'}});assert.equal(h.run('startupAuthCallback'),true);assert.equal(h.run('startupRecovery'),false);assert(h.clientOptions.auth.detectSessionInUrl);
});
test('Password authentication works again after deliberate sign-out and clears the remembered marker',async()=>{
 const h=passwordHarness(),form=authForm('login',[['email','self@example.test'],['password','long enough']]);h.run("sessionEnding=true;authPersistentStorage.setItem(SIGNED_OUT_KEY,'1')");h.db.auth.signInWithPassword=async()=>({data:{session:loginSession('self')},error:null});h.queued.push({data:loginProfile(),error:null});await h.exec('submit(qaArgs)',form.event);assert.equal(h.run('sessionEnding'),false);assert.equal(h.localItems.has('sb-qa-auth-token-space-signed-out'),false);assert.equal(h.run('session.user.id'),'self');
});
test('A recovery auth event never hydrates the workspace while its redirect is queued',async()=>{
 const h=passwordHarness();h.context.URLSearchParams=URLSearchParams;let redirected='';h.context.location.replace=url=>{redirected=url;};const recovered={...loginSession('self'),access_token:'recovery-access',refresh_token:'recovery-refresh'};
 h.exec("handleAuthStateChange('PASSWORD_RECOVERY',qaArgs)",recovered);await h.exec('signedIn(qaArgs)',recovered);assert.equal(h.run('session'),null);assert.equal(h.requests.filter(r=>r.table==='profiles').length,0);h.fireTimers(0);const target=new URL(redirected);assert.equal(target.pathname,'/Turk-Innovation-CLUB/reset-password.html');assert(target.hash.includes('type=recovery'));assert.equal(h.stats.opens,0);
});
test('Password auth and reset fields never enter the workspace autosave path',()=>{
 const h=passwordHarness();for(const kind of ['login','verify','passwordResetRequest'])assert.equal(h.exec('spaceDraftKey(qaArgs)',{dataset:{kind}}),'');
});
test('A certificate notification opens the fresh certificate directly without relying on classroom cache',async()=>{
 const h=harness();h.run("setSidebarOpen=()=>{};let openedCertificate='';certification={open:async id=>{openedCertificate=id;}};cache.notifications=[{id:'certificate-notice',target_type:'certificate',target_id:'award',read_at:'already'}];");await h.exec("openNotification('certificate-notice',qaArgs)",node({textContent:'Open'}));assert.equal(h.run('openedCertificate'),'award');
});
const separateLocation=()=>({origin:'https://turkson225.github.io',pathname:'/Turk-Innovation-CLUB/',search:'?account=separate',hash:'#home'});
test('Admin, teacher and member sessions use independent storage and Supabase broadcast keys',async()=>{
 const localItems=new Map(),admin=sessionHarness({harnessOptions:{localItems}}),teacher=sessionHarness({harnessOptions:{localItems,location:separateLocation()}}),member=sessionHarness({harnessOptions:{localItems,location:separateLocation()}});
 admin.run('refreshAdminAlerts=async()=>{};updateAdminAlertControls=()=>{}');
 const accounts=[[admin,'administrator','admin'],[teacher,'instructor','teacher'],[member,'learner','member']];
 for(const [h,id,role]of accounts){h.clientOptions.auth.storage.setItem(h.clientOptions.auth.storageKey,JSON.stringify(loginSession(id)));await h.login(id,true,{role});}
 assert.equal(new Set(accounts.map(([h])=>h.clientOptions.auth.storageKey)).size,3);assert.equal(admin.run('admin()'),true);assert.equal(teacher.run('teacher()'),true);assert.equal(member.run('teacher()'),false);assert.equal(member.run('admin()'),false);
 for(const [h,id]of accounts){assert.equal(JSON.parse(h.clientOptions.auth.storage.getItem(h.clientOptions.auth.storageKey)).user.id,id);assert.equal(h.run('session.user.id'),id);}
 assert.equal(JSON.parse(localItems.get('sb-qa-auth-token')).user.id,'administrator');assert.equal(localItems.size,1);
});
test('A separate account tab starts empty and never imports the remembered main account',()=>{
 const localItems=new Map([['sb-qa-auth-token','main-credentials']]),sessionItems=new Map([['sb-qa-auth-token','copied-old-main']]),h=harness({localItems,sessionItems,location:separateLocation()});
 assert.equal(h.clientOptions.auth.storage.getItem(h.clientOptions.auth.storageKey),null);assert.equal(localItems.get('sb-qa-auth-token'),'main-credentials');assert.equal(sessionItems.get('sb-qa-auth-token'),'copied-old-main');assert.equal(h.run('separateAccountTab'),true);
});
test('Refreshing a separate tab restores its account with a fresh broadcast channel',()=>{
 const localItems=new Map(),sessionItems=new Map(),first=harness({localItems,sessionItems,location:separateLocation()});first.clientOptions.auth.storage.setItem(first.clientOptions.auth.storageKey,'teacher-credentials');
 const refreshed=harness({localItems,sessionItems,location:separateLocation()});assert.notEqual(refreshed.clientOptions.auth.storageKey,first.clientOptions.auth.storageKey);assert.equal(refreshed.clientOptions.auth.storage.getItem(refreshed.clientOptions.auth.storageKey),'teacher-credentials');assert.equal(localItems.size,0);
});
test('Duplicate tabs can choose different accounts without a shared broadcast channel',()=>{
 const first=harness({location:separateLocation()});first.clientOptions.auth.storage.setItem(first.clientOptions.auth.storageKey,'teacher');const duplicate=harness({sessionItems:new Map(first.sessionItems),location:separateLocation()});
 assert.notEqual(first.clientOptions.auth.storageKey,duplicate.clientOptions.auth.storageKey);duplicate.clientOptions.auth.storage.setItem(duplicate.clientOptions.auth.storageKey,'member');assert.equal(first.clientOptions.auth.storage.getItem(first.clientOptions.auth.storageKey),'teacher');assert.equal(duplicate.clientOptions.auth.storage.getItem(duplicate.clientOptions.auth.storageKey),'member');
});
test('A routing refresh keeps separate account mode even when a URL query is missing',()=>{
 const sessionItems=new Map(),first=harness({sessionItems,location:separateLocation()});first.clientOptions.auth.storage.setItem(first.clientOptions.auth.storageKey,'teacher');const refreshed=harness({sessionItems,location:{hash:'#courses'}});assert.equal(refreshed.run('separateAccountTab'),true);assert.equal(refreshed.clientOptions.auth.storage.getItem(refreshed.clientOptions.auth.storageKey),'teacher');
});
test('Signing out of a separate account clears only its own tokens and private workspace',async()=>{
 const localItems=new Map([['sb-qa-auth-token','main-token']]),first=sessionHarness({harnessOptions:{localItems,location:separateLocation()}}),second=harness({localItems,location:separateLocation()});first.clientOptions.auth.storage.setItem(first.clientOptions.auth.storageKey,'teacher-token');second.clientOptions.auth.storage.setItem(second.clientOptions.auth.storageKey,'member-token');await first.login('instructor');await first.run('signOut()');
 assert.equal(first.run('session'),null);assert.equal(first.clientOptions.auth.storage.getItem(first.clientOptions.auth.storageKey),null);assert.equal(second.clientOptions.auth.storage.getItem(second.clientOptions.auth.storageKey),'member-token');assert.equal(localItems.get('sb-qa-auth-token'),'main-token');assert.equal(first.stats.signouts[0].scope,'local');
 const refreshed=harness({localItems,sessionItems:first.sessionItems,location:separateLocation()});assert.equal(refreshed.clientOptions.auth.storage.getItem(refreshed.clientOptions.auth.storageKey),null);
});
test('Main account sign-out events do not sign out a separate teacher account',async()=>{
 const h=sessionHarness({harnessOptions:{location:separateLocation()}});await h.login('instructor');h.exec('handleAuthStorageChange(qaArgs)',{key:'sb-qa-auth-token-space-signed-out',newValue:'1'});assert.equal(h.run('session.user.id'),'instructor');assert.equal(h.run('sessionEnding'),false);
});
test('Separate account storage falls back to memory if tab storage becomes unavailable',()=>{
 const h=harness({location:separateLocation()});h.context.sessionStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};const storage=h.clientOptions.auth.storage,key=h.clientOptions.auth.storageKey;storage.setItem(key,'teacher');assert.equal(storage.getItem(key),'teacher');assert.equal(h.localItems.size,0);storage.removeItem(key);assert.equal(storage.getItem(key),null);
});
test('The Accounts menu escapes identity text and opens a clean, independent tab without an opener',()=>{
 const h=harness({location:separateLocation()});h.run("session.user.email='<script>@example.test';me.full_name='<script>Name</script>';accountsDialog()");const html=h.elements.get('#modalContent').innerHTML;assert(html.includes('&lt;script&gt;Name'));assert(!html.includes('<script>'));assert(html.includes('?account=separate#home'));assert(html.includes('target="_blank" rel="noopener noreferrer"'));assert(!/access_token|refresh_token/.test(html));assert(html.includes('Return to my main account'));
});
test('Switching this tab preserves the main login and cancels late work before navigation',()=>{
 let target='';const localItems=new Map([['sb-qa-auth-token','main-token']]),h=harness({localItems,location:{...separateLocation(),search:'',assign:url=>{target=url;}}});let stopped=0,signouts=0;h.db.auth={stopAutoRefresh:async()=>{stopped++;},signOut:async()=>{signouts++;}};h.run('changeAccountTab(true)');assert.equal(localItems.get('sb-qa-auth-token'),'main-token');assert.equal(target,'https://turkson225.github.io/Turk-Innovation-CLUB/?account=separate#home');assert.equal(stopped,1);assert.equal(signouts,0);assert.equal(h.run('sessionEnding'),true);assert.equal(h.sessionItems.get('sb-qa-auth-token-space-separate-mode'),'1');
});
test('Returning to the main account removes only this tab’s preview credentials',()=>{
 let target='';const localItems=new Map([['sb-qa-auth-token','main-token']]),h=harness({localItems,location:{...separateLocation(),assign:url=>{target=url;}}});h.db.auth={stopAutoRefresh:async()=>{}};h.clientOptions.auth.storage.setItem(h.clientOptions.auth.storageKey,'teacher');h.run('changeAccountTab(false)');h.clientOptions.auth.storage.setItem(h.clientOptions.auth.storageKey,'late-teacher-response');assert.equal(target,'https://turkson225.github.io/Turk-Innovation-CLUB/#home');assert.equal(h.sessionItems.has('sb-qa-auth-token-space-separate-mode'),false);assert.equal(h.sessionItems.has('sb-qa-auth-token-space-tab-session'),false);assert.equal(localItems.get('sb-qa-auth-token'),'main-token');
});
test('An email confirmation callback preserves an existing main account',()=>{
 const localItems=new Map([['sb-qa-auth-token','main-token']]),h=harness({localItems,location:{hash:'#access_token=new-user&refresh_token=new-refresh&type=signup'}});assert.equal(h.run('separateAccountTab'),true);assert.equal(h.clientOptions.auth.storage.getItem(h.clientOptions.auth.storageKey),null);assert.equal(localItems.get('sb-qa-auth-token'),'main-token');assert.equal(h.sessionItems.get('sb-qa-auth-token-space-separate-mode'),'1');
});
test('Separate accounts do not change or unsubscribe the main account’s device alerts',async()=>{
 const h=sessionHarness({harnessOptions:{location:separateLocation()}});h.run('let previewPushCalls=0;window.InnovateXPush={authChanged:async()=>{previewPushCalls++;},unsubscribe:async()=>{previewPushCalls++;},state:()=>{previewPushCalls++;return {};},subscribe:async()=>{previewPushCalls++;}}');await h.login('instructor');assert.match(h.run('pushSettingsCard()'),/main SPACE account/);await h.run('togglePushNotifications()');await h.run('signOut()');assert.equal(h.run('previewPushCalls'),0);
});
test('Separate account sign-in explains tab lifetime and keeps the remembered browser session unchanged',()=>{
 const h=harness({location:separateLocation()});h.run("signInDialog('signin')");assert(h.elements.get('#modalContent').innerHTML.includes('closing the tab ends this separate session'));assert.equal(h.clientOptions.auth.autoRefreshToken,true);assert.equal(h.clientOptions.auth.persistSession,true);
});
async function pushClickFixture(includeMain){
 const handlers=new Map(),calls=[],base='https://turkson225.github.io/Turk-Innovation-CLUB/',preview={url:base+'?account=separate#notifications',navigate:async()=>{calls.push('preview navigate');},focus:async()=>{calls.push('preview focus');}},main={url:base+'#home',navigate:async function(url){calls.push('main navigate '+url);return this;},focus:async()=>{calls.push('main focus');}};
 const context=vm.createContext({URL,console,self:{registration:{scope:base},addEventListener:(name,callback)=>handlers.set(name,callback),clients:{matchAll:async()=>includeMain?[preview,main]:[preview],openWindow:async url=>{calls.push('open '+url);}}}});vm.runInContext(fs.readFileSync(root+'/sw.js','utf8'),context);let task;handlers.get('notificationclick')({notification:{data:{url:base+'#notifications'},close(){}},waitUntil:promise=>{task=promise;}});await task;return calls;
}
test('A device notification opens the main account rather than a separate preview tab',async()=>{
 const calls=await pushClickFixture(true);assert(calls.some(call=>call.startsWith('main navigate ')));assert(calls.includes('main focus'));assert(!calls.some(call=>call.startsWith('preview')));
});
test('A device notification opens a new main-account tab when only previews are open',async()=>{
 assert.deepEqual(await pushClickFixture(false),['open https://turkson225.github.io/Turk-Innovation-CLUB/#notifications']);
});
test('A completed learning course exposes its own certificate download action',()=>{
 const h=harness();h.run("cache.course_completions=[{course_id:'learning-course',learner_id:'self',completed_at:'2026-10-16',assessed_by:'teacher'}];");const html=h.exec('courseFeedback(qaArgs)',{id:'learning-course'});assert(html.includes('data-action="certificateCourse"'));assert(html.includes('data-id="learning-course"'));
});
let failed=0;
for(const t of tests){try{await t.fn();console.log('PASS',t.name);}catch(e){failed++;console.log('FAIL',t.name,'\n',e.stack);}}
console.log(`${tests.length-failed}/${tests.length} checks passed`);
process.exitCode=failed?1:0;

