// Offline regression checks: mocked DOM and database; no live requests.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
function deferred(){let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve};}
function node(overrides={}){return {id:'',dataset:{},style:{},isConnected:true,hidden:false,textContent:'',innerHTML:'',value:'',scrollHeight:400,scrollTop:400,clientHeight:300,classList:{add(){},remove(){},toggle(){},contains(){return false;}},querySelector(){return null;},querySelectorAll(){return [];},closest(){return null;},setAttribute(){},getAttribute(){return null;},focus(){},remove(){},close(){this.open=false;},showModal(){this.open=true;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},...overrides};}
function harness(){
  const requests=[],queued=[],elements=new Map();
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
  const context=vm.createContext({console,URL,crypto:globalThis.crypto,Blob,Date,Map,Set,Promise,setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},sessionStorage:storage,localStorage:storage,createClient(){return db;},window:{INNOVATEX_CONFIG:{supabaseUrl:'https://qa.supabase.co',supabaseAnonKey:'fake'},addEventListener(){}},navigator:{},location:{hash:'#messages'},history:{replaceState(){}},document:{hidden:false,activeElement:null,querySelector(selector){return elements.get(selector)??null;},querySelectorAll(){return [];},getElementById(id){return elements.get('#'+id)??null;},addEventListener(){},documentElement:{dataset:{theme:'light'}}}});
  const source=fs.readFileSync(root+'/app.js','utf8').replace(/^import .*\n/,'').replace(/\ninit\(\);\s*$/,'');
  vm.runInContext(source,context,{filename:'app.js'});
  const run=code=>vm.runInContext(code,context);
  const exec=(code,args)=>{context.qaArgs=args;return run(code);};
  run("session={user:{id:'self'}};me={id:'self',full_name:'Tester',role:'member',membership_status:'approved'};dmReady=true;page='messages';cache={profiles:[me,{id:'a',full_name:'Alice',membership_status:'approved',role:'member'},{id:'b',full_name:'Bob',membership_status:'approved',role:'teacher'}],direct_messages:[],direct_message_reads:[],notifications:[]};render=()=>{};dmShowThreadUpdate=()=>{};refreshUnreadCounts=async()=>{};refreshInboxUnreadCount=async()=>{};");
  elements.set('#toast',node());elements.set('#dmBody',node());elements.set('#modal',node({open:false}));elements.set('#modalContent',node());
  return {run,exec,requests,queued,rpcQueued,rpcCalls,elements,context};
}
const tests=[];
function test(name,fn){tests.push({name,fn});}
const message=(id,sender_id='a',recipient_id='self',body='hello',created_at='2026-10-01T08:00:00Z')=>({id,sender_id,recipient_id,body,created_at});
function composer(peer,text){const input=node({value:text});const send=node();const form=node({id:'dmComposer',dataset:{peer},elements:{body:input},querySelector(s){return s==='[type=submit]'?send:null;}});return {form,input,send,event:{target:form,preventDefault(){}}};}
function action(h,dataset){return h.exec('actions(qaArgs)',{target:{closest(){return node({dataset});}},preventDefault(){}});}

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

let failed=0;
for(const t of tests){try{await t.fn();console.log('PASS',t.name);}catch(e){failed++;console.log('FAIL',t.name,'\n',e.stack);}}
console.log(`${tests.length-failed}/${tests.length} checks passed`);
process.exitCode=failed?1:0;
