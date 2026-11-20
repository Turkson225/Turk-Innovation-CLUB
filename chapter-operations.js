const chapterOffices = {
  coordinator:['Coordinator','Oversee chapter membership and review the work of local officers.'],
  teacher:['Teacher','Plan and deliver practical workshops for your chapter.'],
  deputy_coordinator:['Deputy coordinator','Follow up on chapter plans and support the coordinator.'],
  secretary:['Secretary','Prepare agendas, minutes and chapter records.'],
  treasurer:['Treasurer','Prepare budget notes and expense summaries for central review.'],
  teaching_lead:['Teaching lead','Coordinate learning schedules, materials and workshop preparation.'],
  events_lead:['Events lead','Plan sessions, venues and event logistics.'],
  projects_lead:['Projects lead','Track project milestones and practical build outcomes.'],
  communications:['Communications officer','Prepare chapter announcements and outreach.']
};
const chapterTaskStates={all:'All work',open:'Open',submitted:'Awaiting review',completed:'Completed',cancelled:'Cancelled'};
const chapterTaskActions={submit:'Submit work',return:'Request changes',complete:'Mark complete',cancel:'Cancel task'};
const chapterOfficeActions={create:'Task assigned.',submit:'Work submitted for review.',return:'Work returned for changes.',complete:'Task completed.',cancel:'Task cancelled.'};
const chapterOpsPageSize=20;
const chapterOpsNumber=v=>Number(v)||0;

export function createChapterOperations({db,get,esc,head,render,modal,close,show,fail,deadline,missing}){
  let key='', serial=0, editorId=0, data=null, rows=[], loading=false, busy=false, error='', lastLoad=0;
  let days=30, offset=0, workStatus='all', officeFilter='', tab='work', search='';
  const current=()=>{
    const c=get();
    return db&&c.id&&c.allowed&&(c.page==='chapter-offices'||(c.page==='chapter-admin'&&c.admin))?c:null;
  };
  const routeKey=c=>c?[c.id,c.generation,c.admin,c.page,c.chapter].join(':'):'';
  const trends=globalThis.SpaceMetricTrends?.create({db,id:'chapters',get:()=>{
    const c=current();if(!c||!data||error)return null;
    if(!c.chapter)return c.page==='chapter-admin'?{...c,scope:'chapter',target:null,access:'network',note:'Published activity includes archived listings. Current staffing and pending totals above are snapshots.'}:null;
    if(data.chapter?.id!==c.chapter)return null;
    return {...c,scope:'chapter',target:c.chapter,access:data.manager?'manager':(data.my_offices||[]).join(','),
      offices:(data.office_metrics||[]).map(o=>[o.office,splitName(o.office)]),
      note:data.manager?'Use Scope to chart tasks for a specific office. The all-activity view counts historical publications, including archived listings.':'Only tasks assigned to you in offices you currently hold.'};
  }});
  const splitName=office=>chapterOffices[office]?.[0]||'Chapter office';
  const el=(action,id,label,style='button button-outline')=>`<button type="button" class="${style}" data-action="chapterops-${action}" data-id="${esc(id)}"${busy?' disabled':''}>${esc(label)}</button>`;
  const label=(text,name,type='text',attrs='')=>`<label>${esc(text)}<input name="${name}" type="${type}" ${attrs}></label>`;
  const options=(name,labelText,entries,selected='')=>`<label>${esc(labelText)}<select name="${name}">${entries.map(([v,l])=>`<option value="${esc(v)}"${v===selected?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
  const area=(labelText,name,required=true,limit=3000)=>`<label>${esc(labelText)}<textarea name="${name}" rows="4" maxlength="${limit}" ${required?'required minlength="3"':''}></textarea></label>`;
  const chapterUrl=c=>'#chapters/'+encodeURIComponent(c.slug);
  const dateText=d=>esc(new Date(d).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}));
  const dashboardUrl=(mode,id)=>'#'+mode+'/'+encodeURIComponent(id);
  const hasDialog=()=>document.querySelector('#modal[open] [data-chapterops-dialog]');
  function reset(){
    if(key&&hasDialog())close();
    trends?.reset();
    key='';serial++;editorId++;data=null;rows=[];loading=false;busy=false;error='';lastLoad=0;
    tab='work';offset=0;workStatus='all';officeFilter='';search='';
  }
  function sync(){
    const c=current(), next=routeKey(c);
    if(next!==key){reset();key=next;if(c)void load(c);}
    else if(c&&!loading&&!busy&&!error&&!hasDialog()&&Date.now()-lastLoad>45000)void load(c);
    trends?.sync();
  }
  async function rpc(name,params){
    const r=await deadline(()=>db.rpc(name,params),12000,'Chapter operations took too long to load.');
    if(r.error)throw r.error;
    return r.data;
  }
  async function load(c=current(),paint=false){
    if(!c||loading)return;
    const generation=++serial,expected=key;
    const valid=()=>generation===serial&&expected===routeKey(current());
    loading=true;error='';
    if(paint)render();
    try{
      let result,people=[];
      if(!c.chapter){
        result=c.page==='chapter-admin'?await rpc('space_chapter_ops_index',{p_days:days,p_offset:offset}):await rpc('space_my_chapter_offices',{});
      }else{
        result=await rpc('space_chapter_ops_detail',{p_chapter:c.chapter,p_days:days,p_office:officeFilter||null,p_status:workStatus,p_offset:tab==='work'?offset:0});
        if(!valid())return;
        if(tab==='people'&&result.manager)people=await rpc('space_chapter_ops_people',{p_chapter:c.chapter,p_query:search,p_offset:offset,p_days:days});
        else if(tab==='people'){tab='work';offset=0;}
      }
      if(valid()){data=result;rows=people;}
    }catch(f){
      if(!valid())return;
      data=null;rows=[];
      error=missing(f)?'Chapter operations is waiting for its database migration.':f?.code==='42501'?'You do not have access to this chapter office.':'Chapter operations could not load. Try again.';
    }finally{
      if(valid()){loading=false;lastLoad=Date.now();render();}
    }
  }
  function reload(){
    serial++;loading=false;data=null;rows=[];void load(current(),true);
  }
  const pager=more=>offset||more?`<div class="chapter-actions chapter-pager">${offset?el('page',offset-chapterOpsPageSize,'Previous'):''}<span>Page ${Math.floor(offset/chapterOpsPageSize)+1}</span>${more?el('page',offset+chapterOpsPageSize,'Next'):''}</div>`:'';
  const fmt=(value)=>chapterOpsNumber(value).toLocaleString();
  function summary(m,network=false){
    const metrics=[
      ['Active memberships',m.active,network?'Counts each chapter membership':'Current approved chapter members'],
      ['Pending applications',m.pending,'Currently awaiting a decision'],
      ['New join requests',m.new_requests,'Received in this period'],
      ['Workshop listings',m.workshops,'Published in this period'],
      ['Events',m.events,'Published in this period'],
      ['Projects',m.projects,'Published in this period'],
      ['Announcements',m.announcements,'Published in this period'],
      ['Tasks awaiting review',m.submitted,'Submitted and waiting now'],
      ['Completed tasks',m.completed,'Completed in this period'],
      ['Overdue tasks',m.overdue,'Unfinished after the due date'],
      ['Tasks without access',m.needs_reassignment,'Open tasks whose assignee no longer holds the office']
    ];
    return `<dl class="chapter-ops-metrics">${metrics.map(([title,n,note])=>`<div><dt>${esc(title)}</dt><dd>${fmt(n)}</dd><small>${esc(note)}</small></div>`).join('')}</dl>`;
  }
  const periodButtons=()=>`<div class="chapter-actions" aria-label="Reporting period">${[30,90].map(n=>`<button class="button button-outline" type="button" data-action="chapterops-days" data-id="${n}" aria-pressed="${n===days}">Last ${n} days</button>`).join('')}</div>`;
  const badge=s=>`<span class="chapter-tag">${esc(s)}</span>`;
  function table(caption,columns,body){
    return `<div class="chapter-ops-table" tabindex="0" role="region" aria-label="${esc(caption)}"><table><caption>${esc(caption)}</caption><thead><tr>${columns.map(l=>`<th scope="col">${esc(l)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function central(){
    const compare=globalThis.SpaceMetricTrends?.comparison('Compare current campus memberships (this page)',(data.rows||[]).map(c=>({label:c.name,values:[chapterOpsNumber(c.metrics?.active),chapterOpsNumber(c.metrics?.pending)]})),['Active','Pending']);
    return head('ADMINISTRATION','Chapter control centre','Compare campuses, review what needs attention and manage local leadership.',`<a class="button button-outline" href="#chapters">Chapter directory</a>`)+
      `<section class="chapter-section"><div class="chapter-heading"><h2>Network overview</h2>${periodButtons()}</div><p>${fmt(data.open_chapters)} open chapters out of ${fmt(data.total)}. Totals include draft and archived chapters where records exist.</p>${summary(data.metrics||{},true)}</section>`+
      (trends?.view()||'')+(compare||'')+(data.rows?.length?table('Campus comparison',['Chapter','Status','Active','Pending','Published','Open work','Overdue','Action'],data.rows.map(c=>{
        const m=c.metrics||{}, published=['announcements','events','projects','workshops'].reduce((n,k)=>n+chapterOpsNumber(m[k]),0);
        return `<tr><th scope="row">${esc(c.name)}<small>${esc(c.institution)}</small></th><td>${esc(c.status==='active'?'Open':c.status)}${c.status==='active'&&!c.has_coordinator?'<small>No coordinator</small>':''}</td><td>${fmt(m.active)}</td><td>${fmt(m.pending)}</td><td>${fmt(published)}</td><td>${fmt(chapterOpsNumber(m.open)+chapterOpsNumber(m.submitted))}</td><td>${fmt(m.overdue)}</td><td><a href="${dashboardUrl('chapter-admin',c.id)}">Manage chapter <span class="sr-only">${esc(c.name)}</span> →</a></td></tr>`;
      }).join('')):'<p>No chapters on this page. Create a chapter in the directory first.</p>')+pager(offset+chapterOpsPageSize<chapterOpsNumber(data.total));
  }
  function myOffices(){
    return head('YOUR WORKSPACE','My chapter offices','Open your chapter’s work queue and see the responsibilities assigned to you.')+
      ((data||[]).length?`<section class="chapter-grid">${data.map(c=>`<article class="chapter-card"><span class="eyebrow">${esc(c.institution)}</span><h2>${esc(c.name)}</h2><ul>${c.offices.map(o=>`<li><strong>${esc(splitName(o))}</strong> <small>${esc(chapterOffices[o]?.[1]||'')}</small></li>`).join('')}</ul><a class="button button-outline" href="${dashboardUrl('chapter-offices',c.id)}">Open office workspace →</a></article>`).join('')}</section>`:'<p class="notice">No open chapter offices are assigned to you. When an administrator assigns one, it will appear here.</p><a href="#chapters">Browse university chapters →</a>');
  }
  function officeMetrics(){
    return table(data.manager?'Metrics by chapter office':'My office metrics',[data.manager?'Office':'Your office',...(data.manager?['Holders']:[]),'Open','Awaiting review',`Completed (${days} days)`,'Overdue'],
      (data.office_metrics||[]).map(o=>`<tr><th scope="row">${esc(splitName(o.office))}</th>${data.manager?`<td>${fmt(o.holders)}</td>`:''}<td>${fmt(o.open)}</td><td>${fmt(o.submitted)}</td><td>${fmt(o.completed)}</td><td>${fmt(o.overdue)}</td></tr>`).join(''));
  }
  function taskButtons(t,c){
    const buttons=[el('history',t.id,'History')];
    if(data.chapter.status!=='active')return buttons.join('');
    if(t.status==='open'&&t.assignee_id===c.id&&t.assignee_has_office)buttons.push(el('task-action',t.id+'/submit','Submit work','button'));
    if(data.manager&&t.status==='submitted'&&t.assignee_id!==c.id){
      buttons.push(el('task-action',t.id+'/complete','Mark complete','button'),el('task-action',t.id+'/return','Request changes'));
    }
    if(data.manager&&['open','submitted'].includes(t.status))buttons.push(el('task-action',t.id+'/cancel','Cancel task'));
    return buttons.join('');
  }
  function work(c){
    const tasks=data.tasks||[];
    return `<section class="chapter-section"><div class="chapter-heading"><h2>${data.manager?'Chapter work queue':'My assigned work'}</h2>${data.manager&&data.chapter.status==='active'?el('tab','people','Assign work from People & roles'):''}</div>
      <form class="chapter-actions chapter-ops-filter" data-chapterops-form="filter">
        ${options('office','Office',[['','All offices'],...(data.office_metrics||[]).map(o=>[o.office,splitName(o.office)])],officeFilter)}
        ${options('status','Work status',Object.entries(chapterTaskStates),workStatus)}
        <button class="button button-outline" type="submit">Apply filters</button>
      </form><div class="chapter-stack">${tasks.slice(0,chapterOpsPageSize).map(t=>{
        const overdue=t.due_on&&['open','submitted'].includes(t.status)&&t.due_on<new Date().toISOString().slice(0,10);
        return `<article class="chapter-card chapter-task"><div class="chapter-heading"><h3>${esc(t.title)}</h3>${badge(chapterTaskStates[t.status])}</div>
          <p>${esc(splitName(t.office))} · ${esc(t.assignee_name||'Former member')}${t.due_on?' · Due '+esc(t.due_on):''}${overdue?' · Overdue':''}</p>
          ${t.status==='open'&&!t.assignee_has_office?'<p class="notice">The assignee no longer holds this office. Cancel and assign a replacement task.</p>':''}
          <p class="chapter-copy">${esc(t.instructions)}</p>
          ${t.progress_note?`<p class="chapter-copy"><strong>Submitted work:</strong> ${esc(t.progress_note)}</p>`:''}
          ${t.review_note?`<p class="chapter-copy"><strong>Review note:</strong> ${esc(t.review_note)}</p>`:''}
          <div class="chapter-actions">${taskButtons(t,c)}</div></article>`;
      }).join('')||'<p>No tasks match the current filters.</p>'}</div>${pager(tasks.length>chapterOpsPageSize)}</section>`;
  }
  function people(){
    return `<section class="chapter-section"><div class="chapter-heading"><h2>People &amp; roles</h2><a href="${chapterUrl(data.chapter)}">Review membership requests in the chapter →</a></div>
      <p>Only approved, active chapter members can hold offices. Office appointments do not grant access to the club-wide ledger or other campuses.</p>
      <form data-chapterops-form="search" class="chapter-actions chapter-ops-filter">
        <label>Find an active member<input type="search" name="query" maxlength="100" value="${esc(search)}"></label>
        <button class="button button-outline" type="submit">Search</button>
      </form>
      <div class="chapter-stack">${rows.slice(0,chapterOpsPageSize).map(p=>`<article class="chapter-person"><div><strong>${esc(p.full_name)}</strong><small>${esc(p.offices.length?p.offices.map(splitName).join(', '):'Chapter member')}</small>${p.work?`<small>${fmt(p.work.open)} open · ${fmt(p.work.submitted)} awaiting review · ${fmt(p.work.completed)} completed in ${days} days · ${fmt(p.work.overdue)} overdue</small>`:''}</div>
        <div class="chapter-actions">${data.chapter.status==='active'?(data.admin?el('role',p.user_id,'Chapter role')+el('office',p.user_id,'Edit office appointments'):'')+(p.offices.length?el('new-task',p.user_id,'Assign task','button'):''):''}</div></article>`).join('')||'<p>No active chapter members match your search.</p>'}</div>${pager(rows.length>chapterOpsPageSize)}</section>`;
  }
  function detail(c){
    const compare=globalThis.SpaceMetricTrends?.comparison('Compare current office workloads',(data.office_metrics||[]).map(o=>({label:splitName(o.office),values:[chapterOpsNumber(o.open),chapterOpsNumber(o.submitted)]})),['Open','Awaiting review']);
    return `<p><a href="#${c.page}">← ${c.page==='chapter-admin'?'Chapter control centre':'My chapter offices'}</a></p>`+
      head('CHAPTER OFFICES',data.chapter.name,data.manager?'Monitor chapter activity, staffing and office work.':'Track your chapter responsibilities and submit work for review.',`<a class="button button-outline" href="${chapterUrl(data.chapter)}">Open chapter</a>`)+
      (data.chapter.status!=='active'?'<p class="notice">This chapter is not open. Its operations records are read-only.</p>':'')+
      `<section class="chapter-section"><div class="chapter-heading"><h2>${data.manager?'Chapter overview':'My office overview'}</h2>${periodButtons()}</div>
      ${data.metrics?summary(data.metrics):`<p>Your assignments: ${esc(data.my_offices.map(splitName).join(', '))}.</p>`}
      ${officeMetrics()}</section>`+(trends?.view()||'')+(compare||'')+
      (data.manager?`<div class="chapter-actions" aria-label="Operations sections">${[['work','Work queue'],['people','People & roles']].map(([v,l])=>`<button class="button button-outline" type="button" data-action="chapterops-tab" data-id="${v}" aria-pressed="${v===tab}">${esc(l)}</button>`).join('')}</div>`:'')+(tab==='people'&&data.manager?people():work(c));
  }
  function view(){
    const c=current();
    if(!c)return head('CHAPTER OFFICES','Chapter operations','An eligible SPACE account is required.');
    if(error)return head('CHAPTER OFFICES','Chapter operations',error)+el('reload','','Try again')+(c.chapter?` <a href="#${c.page}">Go back</a>`:'');
    if(!data)return head('CHAPTER OFFICES','Chapter operations','Opening your workspace…')+'<p role="status">Loading chapter records…</p>';
    return `<div class="chapter-workspace chapter-ops" aria-busy="${loading||busy}">${c.chapter?detail(c):c.page==='chapter-admin'?central():myOffices()}</div>`;
  }
  function form(kind,title,markup,button,params={}){
    const attrs=Object.entries(params).map(([n,v])=>` data-${n}="${esc(v)}"`).join('');
    modal(`<section data-chapterops-dialog><span class="eyebrow">CHAPTER OFFICES</span><h2>${esc(title)}</h2><form class="form-stack" data-chapterops-form="${kind}" data-editor="${++editorId}" data-context="${esc(key)}"${attrs}>${markup}<button class="button" type="submit">${esc(button)}</button></form></section>`);
  }
  async function history(t){
    const expected=key, ed=++editorId;
    modal('<section data-chapterops-dialog><h2>Task history</h2><p role="status">Loading changes…</p></section>');
    try{
      const entries=await rpc('space_chapter_office_task_history',{p_chapter:data.chapter.id,p_task:t.id});
      if(expected!==routeKey(current())||ed!==editorId||!hasDialog())return;
      modal(`<section data-chapterops-dialog><h2>Task history</h2><p>${esc(t.title)}</p><ol class="chapter-stack">${entries.map(h=>`<li><strong>${esc({create:'Assigned',submit:'Submitted',return:'Returned',complete:'Completed',cancel:'Cancelled'}[h.action])}</strong> · ${dateText(h.happened_at)}${h.note?`<p class="chapter-copy">${esc(h.note)}</p>`:''}</li>`).join('')}</ol></section>`);
    }catch(e){if(expected===routeKey(current())&&ed===editorId&&hasDialog()){close();fail(e);}}
  }
  function action(name,id){
    if(!name.startsWith('chapterops-'))return false;
    const c=current(), v=name.slice(11);
    if(!c||busy)return true;
    if(v==='reload'){if(!loading)reload();return true;}
    if(!data||loading)return true;
    if(v==='days'&&[30,90].includes(Number(id))&&Number(id)!==days){days=Number(id);offset=0;reload();}
    if(v==='page'&&Number.isSafeInteger(Number(id))&&Number(id)>=0){offset=Number(id);reload();}
    if(v==='tab'&&data.manager&&['work','people'].includes(id)&&id!==tab){tab=id;offset=0;reload();}
    if(v==='history'){
      const t=data.tasks?.find(r=>r.id===id);
      if(t)void history(t);
    }
    if(v==='task-action'){
      const [idTask,decision]=id.split('/'),t=data.tasks?.find(r=>r.id===idTask);
      if(t&&Object.hasOwn(chapterTaskActions,decision))form('task-action',chapterTaskActions[decision],`<p>${esc(t.title)}</p>`+area('Note', 'note',decision!=='complete'),chapterTaskActions[decision],{target:idTask,decision});
    }
    const person=rows.find(r=>r.user_id===id);
    if(!person)return true;
    if(v==='role'&&data.admin)form('role','Chapter role for '+person.full_name,options('role','Chapter role',[['member','Member'],['coordinator','Coordinator'],['teacher','Teacher'],['secretary','Secretary']],person.role), 'Save chapter role',{target:id});
    if(v==='office'&&data.admin){
      const has=new Set(person.assigned_offices),inherited=['coordinator','teacher','secretary'].includes(person.role)?person.role:'';
      const list=Object.entries(chapterOffices).filter(([k])=>!['coordinator','teacher',inherited].includes(k));
      form('office','Office appointments for '+person.full_name,
        options('office','Choose an office',list.map(([k])=>[k,splitName(k)+(has.has(k)?' (assigned)':'')]))+
        options('enabled','Change',[['true','Assign selected office'],['false','Remove selected office']])+
        '<p class="hint">Appointments can be combined and are separate from the person’s chapter role and club-wide permissions.</p>','Save appointment',{target:id});
    }
    if(v==='new-task'&&data.manager&&person.offices.length)form('new-task','Assign work to '+person.full_name,
      options('office','Office',person.offices.map(k=>[k,splitName(k)]))+label('Task title','title','text','required minlength="3" maxlength="150"')+
      area('Instructions','instructions',true,4000)+label('Due date','due','date'),'Assign task',{target:id,'request-id':crypto.randomUUID()});
    return true;
  }
  function submit(e){
    const f=e.target,v=f.dataset.chapteropsForm;
    if(!v)return false;
    e.preventDefault();
    const c=current();
    if(!c||!data||busy||loading)return true;
    const fields=new FormData(f),value=k=>String(fields.get(k)||'').trim(),subject=f.dataset.target;
    if(v==='search'&&data.manager){search=value('query').slice(0,100);offset=0;reload();return true;}
    if(v==='filter'){workStatus=value('status')||'all';officeFilter=value('office');offset=0;reload();return true;}
    if(f.dataset.context!==key||Number(f.dataset.editor)!==editorId||!data.chapter)return true;
    const chapter=data.chapter.id,p_chapter=chapter;
    let fn,args,success;
    if(v==='role'&&data.admin){fn='space_assign_chapter_role';args={p_chapter,p_user:subject,p_role:value('role')};success='Chapter role saved.';}
    if(v==='office'&&data.admin){fn='space_set_chapter_office';args={p_chapter,p_user:subject,p_office:value('office'),p_enabled:value('enabled')==='true'};success='Office appointment saved.';}
    if(v==='new-task'&&data.manager){fn='space_create_chapter_office_task';args={p_chapter,p_user:subject,p_office:value('office'),p_title:value('title'),p_instructions:value('instructions'),p_due_on:value('due')||null,p_request_id:f.dataset.requestId};success=chapterOfficeActions.create;}
    if(v==='task-action'){const p_action=f.dataset.decision;fn='space_chapter_office_task_action';args={p_chapter,p_task:subject,p_action,p_note:value('note')};success=chapterOfficeActions[p_action];}
    if(!fn)return true;
    const expected=key,ed=editorId,valid=()=>expected===routeKey(current())&&ed===editorId;
    const send=f.querySelector('[type=submit]');
    busy=true;if(send)send.disabled=true;
    void (async()=>{
      try{
        const r=await db.rpc(fn,args);
        if(r.error)throw r.error;
        if(valid()){if(f.isConnected&&hasDialog())close();show(success);busy=false;void load(current(),true);}
      }catch(failure){if(valid())fail(failure);}
      finally{if(valid())busy=false;if(send?.isConnected)send.disabled=false;}
    })();
    return true;
  }
  return {reset,sync,view,action,submit};
}
