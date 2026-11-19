import assert from 'node:assert/strict';
import {createChapterOperations} from '../chapter-operations.js';
import {canOpenWorkspacePage} from '../workspace-navigation.js';

const wait=()=>new Promise(resolve=>setImmediate(resolve)), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const a={id:'chapter-a',slug:'campus-a',name:'Campus A',institution:'University A',status:'active'};
const metrics={active:14,pending:4,workshops:3,open:3,submitted:1,completed:2,overdue:1};
const task={id:'task-a',office:'treasurer',assignee_id:'officer',assignee_name:'Local officer',title:'<img onerror=alert(1)>',instructions:'Private work details',status:'open',assignee_has_office:true};
const overview=(extra={})=>({chapter:a,manager:false,admin:false,my_offices:['treasurer'],office_metrics:[{office:'treasurer',open:1,overdue:1}],tasks:[task],metrics:null,...extra});
const network={open_chapters:1,total:22,metrics,rows:[{...a,metrics,has_coordinator:false}]};
const originals=[globalThis.document,globalThis.FormData];

function harness(patch={}){
  let state={id:'admin',generation:1,allowed:true,admin:true,page:'chapter-admin',chapter:'',...patch},dialog='';
  const incoming=[],calls=[],failures=[],toasts=[];
  globalThis.document={querySelector:()=>dialog?{}:null};
  globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};
  const op=createChapterOperations({db:{rpc(name,args){calls.push({name,args});return Promise.resolve(incoming.shift()??{error:{message:'Missing test response'}});}},
    get:()=>state,esc,head:(_type,h,p,action='')=>`<h1>${esc(h)}</h1><p>${esc(p)}</p>${action}`,
    render:()=>op.sync(),modal:html=>{dialog=html;},close:()=>{dialog='';},show:x=>toasts.push(x),
    fail:e=>failures.push(e),deadline:fn=>fn(),missing:e=>e.code==='PGRST202'});
  const submit=(values={},extra={})=>{
    const attrs=Object.fromEntries([...dialog.matchAll(/data-(chapterops-form|editor|context|target|decision|request-id)="([^"]+)"/g)].map(m=>[m[1].replace(/-([a-z])/g,(_,p)=>p.toUpperCase()),m[2]]));
    const send={disabled:false,isConnected:true};
    assert(op.submit({target:{dataset:{...attrs,...extra},values,isConnected:true,querySelector:()=>send},preventDefault(){}}));
    return send;
  };
  return {config:p=>{state={...state,...p};},op,incoming,calls,failures,toasts,submit,dialog:()=>dialog};
}
let count=0;
const check=async(name,fn)=>{await fn();console.log('PASS',name);count++;};
try{
  await check('Central view is administrator-only; approved club members can open their own office list',async()=>{
    assert.equal(canOpenWorkspacePage('chapter-admin',{club:true,admin:false}),false);
    assert.equal(canOpenWorkspacePage('chapter-admin',{club:true,admin:true}),true);
    assert.equal(canOpenWorkspacePage('chapter-offices',{club:true}),true);
    assert.equal(canOpenWorkspacePage('chapter-offices',{club:false,investor:true}),false);
    const h=harness({admin:false});h.op.sync();await wait();assert.equal(h.calls.length,0);
  });
  await check('Network counts and comparisons use the reporting filter and paginate without guessing counts',async()=>{
    const h=harness();h.incoming.push({data:network});h.op.sync();await wait();
    assert.match(h.op.view(),/Chapter control centre/);assert.match(h.op.view(),/No coordinator/);
    assert.match(h.op.view(),/chapter-admin\/chapter-a/);assert.match(h.op.view(),/14/);
    h.incoming.push({data:network});h.op.action('chapterops-days','90');await wait();
    assert.deepEqual(h.calls.at(-1).args,{p_days:90,p_offset:0});
    h.incoming.push({data:{...network,rows:[]}});h.op.action('chapterops-page','20');await wait();
    assert.deepEqual(h.calls.at(-1).args,{p_days:90,p_offset:20});assert.match(h.op.view(),/Page 2/);
  });
  await check('Officer list provides scoped workspaces and excludes management actions',async()=>{
    const h=harness({page:'chapter-offices',id:'officer',admin:false});h.incoming.push({data:[{...a,offices:['treasurer','events_lead']}]});
    h.op.sync();await wait();assert.match(h.op.view(),/Treasurer/);assert.match(h.op.view(),/chapter-offices\/chapter-a/);
    h.config({chapter:a.id});h.incoming.push({data:overview()});h.op.sync();await wait();
    const view=h.op.view();
    assert.match(view,/My office metrics|My assigned work/);assert.match(view,/Submit work/);assert.match(view,/&lt;img/);
    assert.doesNotMatch(view,/People &amp; roles|Mark complete|Edit office|<img/);
  });
  await check('Administrators can set chapter roles and append an office appointment for the selected chapter',async()=>{
    const h=harness({chapter:a.id});
    const manager=overview({admin:true,manager:true,metrics});
    const person={user_id:'officer',full_name:'Active Member',role:'member',offices:['treasurer'],assigned_offices:['treasurer']};
    h.incoming.push({data:manager});h.op.sync();await wait();
    h.incoming.push({data:manager},{data:[person]});h.op.action('chapterops-tab','people');await wait();
    assert.match(h.op.view(),/Edit office appointments/);
    h.op.action('chapterops-office',person.user_id);
    assert.match(h.dialog(),/Treasurer \(assigned\)/);
    h.incoming.push({data:null},{data:manager},{data:[person]});h.submit({office:'events_lead',enabled:'true'});await wait();
    assert.deepEqual(h.calls.find(x=>x.name==='space_set_chapter_office')?.args,{p_chapter:a.id,p_user:person.user_id,p_office:'events_lead',p_enabled:true});
    assert.match(h.toasts.at(-1),/Office appointment saved/);
    h.op.action('chapterops-role',person.user_id);assert.match(h.dialog(),/Coordinator/);
  });
  await check('Officers can submit assigned work through the selected chapter, not through a club-wide role',async()=>{
    const h=harness({page:'chapter-offices',id:'officer',admin:false,chapter:a.id});h.incoming.push({data:overview()});h.op.sync();await wait();
    h.op.action('chapterops-task-action','task-a/submit');
    assert.match(h.dialog(),/Submit work/);
    h.incoming.push({data:null},{data:overview({tasks:[{...task,status:'submitted'}]})});h.submit({note:'Progress recorded'});await wait();
    assert.deepEqual(h.calls.find(x=>x.name==='space_chapter_office_task_action')?.args,{p_chapter:a.id,p_task:'task-a',p_action:'submit',p_note:'Progress recorded'});
    assert.match(h.op.view(),/Awaiting review/);assert.doesNotMatch(h.op.view(),/Submit work/);
  });
  await check('The view discards late private results after an account or route change',async()=>{
    const h=harness({chapter:a.id});let resolve;h.incoming.push(new Promise(r=>{resolve=r;}));h.op.sync();
    h.config({page:'chapter-offices',id:'new-account',generation:2,admin:false,chapter:''});
    h.incoming.push({data:[]});h.op.sync();await wait();resolve({data:overview({manager:true,admin:true})});await wait();
    assert.match(h.op.view(),/No open chapter offices/);assert.doesNotMatch(h.op.view(),/Private work details/);
  });
  await check('Missing SQL is retryable and no unauthorized roster is loaded',async()=>{
    const h=harness({chapter:a.id});h.incoming.push({error:{code:'PGRST202'}});h.op.sync();await wait();
    assert.match(h.op.view(),/waiting for its database migration/);
    h.incoming.push({data:overview()});h.op.action('chapterops-reload','');await wait();
    assert.match(h.op.view(),/Campus A/);assert(h.calls.every(r=>r.name!=='space_chapter_ops_people'));
  });
  console.log(count+' chapter operations UI checks passed.');
}finally{[globalThis.document,globalThis.FormData]=originals;}
