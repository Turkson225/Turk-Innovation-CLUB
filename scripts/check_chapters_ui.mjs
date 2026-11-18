import assert from 'node:assert/strict';
import {createChapterWorkspace} from '../space-chapters.js';
import {canOpenWorkspacePage} from '../workspace-navigation.js';

const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wait=()=>new Promise(resolve=>setImmediate(resolve));
const chapter={id:'id-ab',slug:'campus-a',name:'Campus A',institution:'University A',status:'active',description:'Build <together>'};
const activity={id:'act-1',kind:'announcement',title:'<img onerror=alert(1)>',body:'Local chapter details',can_edit:false};
const detail=(extra={})=>({chapter,can_read:true,can_manage:false,can_publish_workshop:false,activities:[activity],membership_status:'active',role:'member',...extra});
const originalDocument=globalThis.document, originalFormData=globalThis.FormData;
function harness(overrides={}){
  let state={page:'chapters',id:'alpha',generation:1,allowed:true,admin:false,slug:'',...overrides}, markup='', closed=0;
  const calls=[],queued=[],toasts=[],failures=[];
  globalThis.document={querySelector(){return null;}};
  globalThis.FormData=class {constructor(form){this.values=form.values;}get(name){return this.values[name];}};
  const ws=createChapterWorkspace({db:{rpc(name,args){calls.push({name,args});return Promise.resolve(queued.shift()||{data:null,error:{message:'Mock not configured'}});}},get:()=>state,esc,
    head:(_label,title,subtitle,action='')=>`<h1>${esc(title)}</h1><p>${esc(subtitle)}</p>${action}`,render:()=>ws.sync(),
    modal:html=>{markup=html;},close:()=>{closed++;markup='';},show:x=>toasts.push(x),fail:x=>failures.push(x),
    deadline:fn=>fn(),missing:e=>e.code==='PGRST202'});
  function submit(values={}){
    const attrs=Object.fromEntries([...markup.matchAll(/data-chapter-(form|context|token)="([^"]+)"/g)].map(match=>[match[1],match[2]]));
    const el={values,dataset:{chapterForm:attrs.form,chapterContext:attrs.context,chapterToken:attrs.token},isConnected:true,querySelector(){return {disabled:false,isConnected:true};}};
    assert(ws.submit({target:el,preventDefault(){}}));
  }
  return {calls,queued,toasts,failures,ws,submit,config(patch){state={...state,...patch};},markup:()=>markup,closed:()=>closed};
}
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS',name);}
try{
  await check('Chapter navigation is available to approved club accounts only',async()=>{
    for(const c of [{club:false},{club:false,investor:true},{club:false,signedIn:true}])assert.equal(canOpenWorkspacePage('chapters',c),false);
    assert.equal(canOpenWorkspacePage('chapters',{club:true}),true);
    const h=harness({allowed:false});h.ws.sync();await wait();assert.equal(h.calls.length,0);
  });
  await check('The directory links each chapter and central admins can create drafts',async()=>{
    const h=harness({admin:true});h.queued.push({data:{chapters:[chapter],mine:[]}});h.ws.sync();await wait();
    assert.match(h.ws.view(),/#chapters\/campus-a/);assert.match(h.ws.view(),/New chapter/);
    h.ws.action('chapter-create','');assert.match(h.markup(),/Create chapter/);
    assert.match(h.markup(),/value="draft" selected/);
  });
  await check('Pending members cannot see activities; a request reloads the same chapter',async()=>{
    const h=harness({slug:'campus-a'}), preview=detail({membership_status:null,can_read:false});
    h.queued.push({data:preview});h.ws.sync();await wait();
    assert.doesNotMatch(h.ws.view(),/Local chapter details/);assert.match(h.ws.view(),/Request to join/);
    h.ws.action('chapter-join','');assert.match(h.markup(),/may|will be visible/);
    h.queued.push({data:'pending'},{data:{...preview,membership_status:'pending'}});h.submit();await wait();
    assert.deepEqual(h.calls.map(c=>c.name),['space_get_chapter','space_request_chapter_membership','space_get_chapter']);
    assert.match(h.ws.view(),/Request pending/);
    assert.equal(h.closed(),1);
  });
  await check('Workshop teachers see only scoped publishing tools and all member text is escaped',async()=>{
    const h=harness({slug:'campus-a'});
    h.queued.push({data:detail({role:'teacher',can_publish_workshop:true})});h.ws.sync();await wait();
    assert.doesNotMatch(h.ws.view(),/New chapter|People &amp; applications|Add announcement|<img/);
    assert.match(h.ws.view(),/&lt;img/);
    h.queued.push({data:detail({role:'teacher',can_publish_workshop:true,activities:[]})});
    h.ws.action('chapter-tab','workshop');await wait();
    assert.match(h.ws.view(),/Add workshop/);
    h.ws.action('chapter-activity','');assert.match(h.markup(),/Controls and Automation/);
    h.queued.push({error:{code:'42501',message:'Chapter publishing access required'}});
    h.submit({title:'Practice lab',body:'Build and test',track:'Electronics and Robotics'});await wait();
    assert.equal(h.calls.at(-1).args.p_chapter,chapter.id);assert.equal(h.failures.length,1);
  });
  await check('Administration uses separate bounded roster requests and a chapter-scoped role dialog',async()=>{
    const h=harness({slug:'campus-a',admin:true}), d=detail({can_manage:true,can_publish_workshop:true});
    h.queued.push({data:d});h.ws.sync();await wait();
    h.queued.push({data:d},{data:[{user_id:'person-1',full_name:'Lab Lead',role:'member',status:'active'}]});
    h.ws.action('chapter-tab','people');await wait();
    assert.deepEqual(h.calls.at(-1),{name:'space_chapter_roster',args:{p_chapter:chapter.id,p_status:'pending',p_offset:0}});
    assert.match(h.ws.view(),/Assign chapter role/);
    h.ws.action('chapter-role','person-1');assert.match(h.markup(),/changes access in this chapter only/);
  });
  await check('Changing account or chapter cannot display a late private response',async()=>{
    const h=harness({slug:'campus-a'});
    let resolve;h.queued.push(new Promise(r=>{resolve=r;}));h.ws.sync();
    h.config({slug:'campus-b',id:'beta',generation:2});
    h.queued.push({data:detail({chapter:{...chapter,slug:'campus-b',name:'Campus B'},activities:[]})});h.ws.sync();await wait();
    resolve({data:detail()});await wait();
    assert.match(h.ws.view(),/Campus B/);assert.doesNotMatch(h.ws.view(),/Local chapter details/);
    h.config({allowed:false});h.ws.sync();assert.doesNotMatch(h.ws.view(),/Campus B/);
  });
  await check('Missing database migration shows activation pending and retry can recover',async()=>{
    const h=harness();h.queued.push({error:{code:'PGRST202'}});h.ws.sync();await wait();
    assert.match(h.ws.view(),/waiting for its database setup/);
    h.queued.push({data:{chapters:[chapter],mine:[]}});h.ws.action('chapter-reload','');await wait();
    assert.match(h.ws.view(),/Campus A/);
  });
  console.log(passed+' chapter UI checks passed.');
}finally{globalThis.document=originalDocument;globalThis.FormData=originalFormData;}
