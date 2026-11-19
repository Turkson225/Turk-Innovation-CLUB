import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const source=read('space-tours.js');
const user={user:{id:'current-user'}};
const chapterId='31f615aa-36f9-4295-813c-8adaacf5bd3a';
const campus={id:chapterId,slug:'koforidua-technical',name:'Koforidua Technical University',offices:['coordinator','treasurer']};
const account={id:user.user.id,generation:1,approved:true,club:true,teacher:false,admin:false};
const commerce={session:user,approved:true,me:{role:'member'},page:'courses',offices:[]};
const portal=(overrides={})=>({...commerce,...overrides});

function harness({stored=new Map(),noStorage=false,chapters=[campus]}={}){
 const documentHooks={},windowHooks={},requests=[],modals=[],off={html:''};
 const s={...account}, c={...commerce}, location={hash:'#courses'};
 const pending=[];
 let blocked=false, focusCount=0;
 const view={innerHTML:''};
 const page={tagName:'H1',setAttribute(){},focus(){focusCount++;}};
 const doc={
  getElementById(){return content;},
  querySelector(sel){return sel==='dialog[open]:not(#loginWelcome)'&&(blocked||modals.some(x=>x.open))?{}:null;},
  createElement(name){
   assert.equal(name,'dialog');
   return {className:'',open:false,innerHTML:'',hooks:{},attrs:{},
    setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.hooks[k]=fn;},
    querySelector(){return {focus(){focusCount++;}};},
    showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}
   };
  },
  addEventListener(name,fn){documentHooks[name]=fn;},
  body:{append(x){modals.push(x);}}
 };
 const offer={
  get outerHTML(){return off.html;}, set outerHTML(v){off.html=v;},
  remove(){off.html='';}
 };
 const content={querySelector(sel){
  if(sel==='[data-tour-offer]')return off.html?offer:null;
  if(sel==='[data-tour-library-host]')return c.page==='getting-started'?view:null;
  if(sel.includes('h1'))return page;
  return null;
 },insertAdjacentHTML(pos,html){assert.equal(pos,'afterbegin');off.html=html;}};
 const win={addEventListener(name,fn){windowHooks[name]=fn;}};
 const ctx=vm.createContext({window:win,document:doc,location,localStorage:{
  getItem(k){if(noStorage)throw Error('Disabled');return stored.get(k)||null;},
  setItem(k,v){if(noStorage)throw Error('Disabled');stored.set(k,v);}
 }});
 vm.runInContext(source,ctx);
 const lib=win.SpaceTours;
 lib.connect(()=>c);
 const tours=lib.create({get:()=>s,db:{rpc(name){requests.push(name);return pending.shift()||{data:chapters};}},deadline:fn=>fn()});
 const click=(cmd,key)=>{
  const element={dataset:{spaceTour:cmd,tourKey:key},isConnected:true,focus(){focusCount++;}};
  documentHooks.click({target:{closest:()=>element},preventDefault(){}});
 };
 return {s,c,lib,tours,stored,location,click,off,view,requests,pending,
  active:()=>modals.find(m=>m.open),focusCount:()=>focusCount,block:v=>{blocked=v;},hashchange:()=>windowHooks.hashchange(),exit:()=>windowHooks.pagehide()};
}

const keys=(t,s=account,c=commerce,cs=[])=>Array.from(t.lib.guides(s,c,cs),g=>g.key);
let passed=0;
async function check(label,fn){await fn();console.log('PASS',label);passed++;}
await check('Only current approved accounts receive guides',async()=>{
 const t=harness();
 assert.deepEqual(keys(t),['member']);
 assert.deepEqual(keys(t,{...account,approved:false}),[]);
 assert.deepEqual(keys(t,account,portal({session:{user:{id:'another-user'}}})),[]);
 assert.deepEqual(keys(t,{...account,club:false},portal({me:{role:'investor'},offices:['treasurer']})),['investor']);
});
await check('Teaching, founder and administrator paths follow current access',async()=>{
 const t=harness();
 assert.deepEqual(keys(t,account,portal({me:{role:'founder'}})),['member','founder']);
 assert.deepEqual(keys(t,{...account,teacher:true},portal({me:{role:'founder'}})),['member','teacher','founder']);
 assert.deepEqual(keys(t,{...account,admin:true,teacher:true},portal({me:{role:'admin'}})),['member','admin']);
});
await check('Chapter offices are separate from global roles and use safe destinations',async()=>{
 const t=harness(), data=t.lib.cleanChapters([campus,{...campus,id:'"><img src=x>'},{...campus,slug:'../x'}]);
 assert.equal(data.length,1);
 const guides=t.lib.guides(account,commerce,data);
 const lead=guides.find(g=>g.key.endsWith(':coordinator')),money=guides.find(g=>g.key.endsWith(':treasurer'));
 assert.equal(lead.steps[0].href,'#chapter-offices/'+chapterId);
 assert.match(lead.steps[1].text,/People & roles/);
 assert.doesNotMatch(money.steps.map(s=>s.href).join(' '),/finance/);
 const global=t.lib.guides(account,portal({offices:['secretary','treasurer','__proto__']}),data);
 assert(global.find(g=>g.key==='office:treasurer').steps.some(s=>s.href==='#finance-reports'));
 assert(!global.some(g=>g.key.endsWith(':__proto__')));
});
await check('First visit to My learning offers a tour without opening a modal',async()=>{
 const t=harness();
 t.tours.sync();
 assert.match(t.off.html,/New member tour/);assert.equal(t.active(),undefined);
 t.c.page='messages';t.tours.sync();assert.equal(t.off.html,'');
});
await check('Progress, next and back work; a pause resumes the correct step',async()=>{
 const t=harness();
 t.click('start','member');assert.match(t.active().innerHTML,/Step 1 of 5/);
 t.click('next');assert.match(t.active().innerHTML,/Step 2 of 5/);
 t.click('back');assert.match(t.active().innerHTML,/Step 1 of 5/);
 t.click('next');t.active().hooks.cancel({preventDefault(){}});
 assert.equal(t.active(),undefined);assert(t.focusCount()>0);
 t.click('start','member');assert.match(t.active().innerHTML,/Find your university chapter/);
});
await check('Opening a destination saves progress and offers the next step on arrival',async()=>{
 const t=harness();
 t.click('start','member');t.click('next');t.click('jump');
 assert.equal(t.location.hash,'#chapters');assert.equal(t.active(),undefined);
 t.c.page='chapters';t.hashchange();t.tours.sync();assert.match(t.off.html,/Next tour step/);
 t.click('continue','member');assert.match(t.active().innerHTML,/Step 3 of 5/);
});
await check('Finish and Not now hide only that prompt and every guide can be replayed',async()=>{
 const t=harness();
 t.click('start','member');
 for(let i=0;i<4;i++)t.click('next');
 t.click('finish');
 assert.equal(t.active(),undefined);assert.equal(t.off.html,'');
 assert.match(t.tours.library(),/Completed.*Replay/);
 t.s.teacher=true;t.c.me.role='teacher';t.c.page='teaching';t.location.hash='#teaching';t.tours.sync();assert.match(t.off.html,/Teaching Studio tour/);
 t.click('later','teacher');assert.equal(t.off.html,'');assert.match(t.tours.library(),/Teaching Studio tour/);
 t.click('start','member');assert.match(t.active().innerHTML,/Step 1 of 5/);
});
await check('Storage is per account and a revoked role cannot start or keep a tour open',async()=>{
 const t=harness();
 t.s.teacher=true;t.c.me.role='teacher';t.click('start','teacher');
 assert(t.active());t.s.teacher=false;t.c.me.role='member';t.tours.sync();assert.equal(t.active(),undefined);
 t.click('start','teacher');assert.equal(t.active(),undefined);
 t.click('later','member');assert.equal(t.off.html,'');
 t.c.session={user:{id:'other'}};t.s.id='other';t.s.generation++;t.tours.sync();assert.match(t.off.html,/New member tour/);
 assert([...t.stored.keys()].every(k=>k.startsWith('space.tour.v1.current-user.')));
});
await check('Tours never interrupt an open dialog and can run when storage is disabled',async()=>{
 const t=harness({noStorage:true});
 t.block(true);t.click('start','member');assert.equal(t.active(),undefined);
 t.block(false);t.click('start','member');t.click('next');t.click('pause');t.click('start','member');
 assert.match(t.active().innerHTML,/Step 2 of 5/);
 t.exit();assert.equal(t.active(),undefined);
});
await check('Chapter reads are scoped, deduplicated and safe after an account switch',async()=>{
 const t=harness();
 assert.equal(t.tours.loadChapters('messages'),undefined);
 let resolve;t.pending.push(new Promise(r=>{resolve=r;}));
 const read=t.tours.loadChapters('home');assert.equal(t.tours.loadChapters('getting-started'),read);
 await Promise.resolve();assert.deepEqual(t.requests,['space_my_chapter_offices']);
 t.c.session={user:{id:'other'}};t.s.id='other';t.s.generation++;t.tours.sync();
 resolve({data:[campus]});await read;assert.doesNotMatch(t.tours.library(),/Koforidua/);
});
await check('Office guides appear when a chapter is returned; member-authored campus text is escaped',async()=>{
 const t=harness({chapters:[{...campus,name:'<img src=x>'}]});
 t.c.page='getting-started';await t.tours.loadChapters('getting-started');
 assert.match(t.view.innerHTML,/Coordinator tour/);
 assert.match(t.view.innerHTML,/&lt;img src=x&gt;/);assert.doesNotMatch(t.view.innerHTML,/<img/);
 t.c.page='chapter-offices';t.location.hash='#chapter-offices/'+chapterId;t.tours.sync();assert.match(t.off.html,/Coordinator tour/);
});
await check('Published assets are ordered, replays are in Getting started, and role acknowledgement remains separate',async()=>{
 const html=read('index.html'),workflow=read('.github/workflows/pages.yml'),guide=read('club-guidance.js'),shop=read('club-commerce.js');
 assert(html.indexOf('src="space-tours.js')<html.indexOf('src="club-guidance.js'));
 assert.match(workflow,/cp space-tours.js space-tours.css _site\//);
 assert.match(guide,/data-tour-library-host/);
 assert.match(shop,/Explore my role guides/);assert.match(shop,/Acknowledge & open my workspace/);
});
console.log(passed+' tour checks passed.');
