// Offline regression checks: mocked DOM and database; no live requests.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
function deferred(){let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve};}
function node(overrides={}){return {id:'',dataset:{},style:{},isConnected:true,hidden:false,textContent:'',innerHTML:'',value:'',scrollHeight:400,scrollTop:400,clientHeight:300,classList:{add(){},remove(){},toggle(){},contains(){return false;}},querySelector(){return null;},querySelectorAll(){return [];},closest(){return null;},setAttribute(){},getAttribute(){return null;},focus(){},remove(){},close(){this.open=false;},showModal(){this.open=true;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},...overrides};}
function harness(){
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
  const storage={getItem(){return null;},setItem(){},removeItem(){}};
  const context=vm.createContext({console,URL,crypto:globalThis.crypto,Blob,Date,Map,Set,Promise,setTimeout(callback,delay=0){const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);},setInterval(){return 1;},clearInterval(){},sessionStorage:storage,localStorage:storage,createClient(){return db;},window:{INNOVATEX_CONFIG:{supabaseUrl:'https://qa.supabase.co',supabaseAnonKey:'fake'},addEventListener(){}},navigator:{},location:{hash:'#messages'},history:{replaceState(){}},document:{hidden:false,activeElement:null,querySelector(selector){return elements.get(selector)??null;},querySelectorAll(){return [];},getElementById(id){return elements.get('#'+id)??null;},addEventListener(){},documentElement:{dataset:{theme:'light'}}}});
  const source=fs.readFileSync(root+'/app.js','utf8').replace(/^import .*\n/,'').replace(/\ninit\(\);\s*$/,'');
  vm.runInContext(source,context,{filename:'app.js'});
  const run=code=>vm.runInContext(code,context);
  const exec=(code,args)=>{context.qaArgs=args;return run(code);};
  run("session={user:{id:'self'}};me={id:'self',full_name:'Tester',role:'member',membership_status:'approved'};dmReady=true;page='messages';cache={profiles:[me,{id:'a',full_name:'Alice',membership_status:'approved',role:'member'},{id:'b',full_name:'Bob',membership_status:'approved',role:'teacher'}],direct_messages:[],direct_message_reads:[],notifications:[]};render=()=>{};dmShowThreadUpdate=()=>{};refreshUnreadCounts=async()=>{};refreshInboxUnreadCount=async()=>{};");
  elements.set('#toast',node());elements.set('#dmBody',node());elements.set('#modal',node({open:false}));elements.set('#modalContent',node());
  const fireTimers=delay=>{for(const [id,timer]of [...timers])if(timer.delay===delay&&timers.has(id)){timers.delete(id);timer.callback();}};
  return {run,exec,requests,queued,rpcQueued,rpcCalls,elements,context,db,timers,fireTimers};
}
const tests=[];
function test(name,fn){tests.push({name,fn});}
const message=(id,sender_id='a',recipient_id='self',body='hello',created_at='2026-10-01T08:00:00Z')=>({id,sender_id,recipient_id,body,created_at});
function composer(peer,text){const input=node({value:text});const send=node();const form=node({id:'dmComposer',dataset:{peer},elements:{body:input},querySelector(s){return s==='[type=submit]'?send:null;}});return {form,input,send,event:{target:form,preventDefault(){}}};}
function action(h,dataset){return h.exec('actions(qaArgs)',{target:{closest(){return node({dataset});}},preventDefault(){}});}

function loginHarness({reducedMotion=false,play=()=>Promise.resolve()}={}){
  const h=harness(),stats={opens:0,closes:0,plays:0,pauses:0,focused:0,workspaceFocused:0};
  const dialog=node({open:false,show(){this.open=true;stats.opens++;},showModal(){throw Error("Welcome must not block the workspace");},close(){this.open=false;stats.closes++;}});
  const video=node({currentTime:0,pause(){stats.pauses++;},play(){stats.plays++;return play();}}),still=node({hidden:true});
  h.elements.set('#loginWelcome',dialog);h.elements.set('#loginWelcomeVideo',video);h.elements.set('#loginWelcomeStill',still);h.elements.set('#loginWelcomeSkip',node({focus(){stats.focused++;}}));
  h.elements.set('#content',node({focus(options){stats.workspaceFocused++;stats.workspaceFocusOptions=options;}}));
  for(const id of ['imageViewer','memberAlert','adminAlert','sidebar','menuBtn'])h.elements.set('#'+id,node({open:false}));
  h.context.window.matchMedia=()=>({matches:reducedMotion});
  h.context.history.replaceState=(_state,_title,hash)=>{h.context.location.hash=hash;};
  h.context.FormData=function(form){return form.entries;};
  h.db.channel=()=>({on(){return this;},subscribe(){return this;}});h.db.removeChannel=async()=>{};h.db.auth={signOut:async()=>({error:null})};
  h.run("session=null;me=null;page='home';location.hash='#home';hydrateOwnApplicationReason=async()=>{};refresh=async()=>{};touchPresence=async()=>{};loadPublic=async()=>{};");
  return {...h,dialog,video,still,stats};
}
const loginSession=id=>({user:{id,email:id+'@example.test'}});
const loginProfile=(id='self',overrides={})=>({id,full_name:'Tester',role:'member',membership_status:'approved',...overrides});
function verifyForm(code='12345678'){
  const submit=node(),form=node({id:'editor',dataset:{kind:'verify'},entries:[['code',code]],querySelector(selector){return selector==='[type=submit]'?submit:null;}});
  return {event:{target:form,preventDefault(){}},submit};
}

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
  assert.equal(h.run('session.user.id'),'self');assert.equal(h.requests.filter(r=>r.table==='profiles').length,1);slow.resolve({error:null});await leaving;assert.equal(h.run('session'),null);
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
  assert.equal(keys.includes('page:teaching'),['teacher','admin'].includes(role));assert.equal(keys.includes('page:founder-room'),['founder','admin'].includes(role));assert.equal(keys.includes('page:finance'),role==='admin');assert.equal(keys.includes('page:finance-review'),role==='founder');assert.equal(keys.includes('page:investor-portal'),['investor','admin'].includes(role));assert.equal(keys.includes('page:application'),role==='pending');
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
  assert.equal(h.links.get('finance-review').hidden,role!=='founder');
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
  const h=loginHarness(),pending=deferred(),calls=[];h.context.recordRefresh=mode=>{calls.push(mode);return pending.promise;};h.run('refresh=mode=>recordRefresh(mode)');h.queued.push({data:loginProfile(),error:null});await h.exec('signedIn(qaArgs,true)',loginSession('self'));assert.equal(h.run('authReady'),true);assert.equal(h.run('workspaceLoading'),false);assert.equal(h.dialog.open,true);assert.equal(h.stats.focused,0);assert.equal(h.run('workspaceHydrating'),true);assert.deepEqual(calls,['page']);h.run('authGeneration++');pending.resolve();await Promise.resolve();await Promise.resolve();assert.deepEqual(calls,['page'],'Superseded sign-in must not start another refresh');
});
test('Pending profile validation immediately clears previous private records and capabilities',async()=>{
  const h=loginHarness(),pending=deferred();h.run("session={user:{id:'old'}};me={id:'old',role:'admin',membership_status:'approved'};cache={finance_entries:[{id:'private'}]};financeReady=true;courseReady=true");h.queued.push(pending.promise);const signing=h.exec('signedIn(qaArgs)',loginSession('self'));assert.equal(h.run('me'),null);assert.equal(h.run('Object.keys(cache).length'),0);assert.equal(h.run('financeReady'),false);assert.equal(h.run('courseReady'),false);assert.equal(h.run('workspaceLoading'),true);pending.resolve({data:loginProfile(),error:null});await signing;assert.equal(h.run('me.id'),'self');
});
test('Failed profile checks show a retry state without giving approved account access',async()=>{
  const h=loginHarness();h.context.console={...console,error(){}};h.queued.push({data:null,error:{message:'Offline'}});await h.exec('signedIn(qaArgs,true)',loginSession('self'));assert.equal(h.run('approved()'),false);assert.equal(h.run('workspaceLoading'),false);assert(h.run('workspaceLoadError'));assert.equal(h.stats.opens,0);
});
test('A late course capability response cannot restore flags after an account changes',async()=>{
  const h=harness(),probe=deferred();h.run("courseReady=true;hydrateOwnApplicationReason=async()=>{};readRecords=async()=>[];detectFounderPortraits=async()=>{};hydrateMedia=async()=>{};refreshUnreadCounts=async()=>{};");h.queued.push({data:{id:'self',role:'member',membership_status:'approved'},error:null},...Array.from({length:8},()=>({data:[],error:null})),probe.promise,probe.promise,probe.promise);const loading=h.run('refresh()');for(let i=0;i<30;i++)await Promise.resolve();assert(h.requests.some(call=>call.ops.some(op=>op[0]==='select'&&op[1]==='submission_due_at')));h.run("authGeneration++;session={user:{id:'other'}};me={id:'other',role:'member',membership_status:'approved'};cache={};courseReady=false;coursePlanningReady=false;courseLifecycleReady=false;courseSeenReady=false");probe.resolve({error:null});await loading;assert.equal(h.run('coursePlanningReady'),false);assert.equal(h.run('courseLifecycleReady'),false);assert.equal(h.run('courseSeenReady'),false);assert.equal(h.run('Object.keys(cache).length'),0);
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

let failed=0;
for(const t of tests){try{await t.fn();console.log('PASS',t.name);}catch(e){failed++;console.log('FAIL',t.name,'\n',e.stack);}}
console.log(`${tests.length-failed}/${tests.length} checks passed`);
process.exitCode=failed?1:0;
