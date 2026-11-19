const CHAPTER_PAGE_SIZE = 20;
const DIRECTORY_PAGE_SIZE = 25;
const kinds = {announcement:'Announcements',event:'Events',project:'Projects',workshop:'Workshops'};
const typeNames = {announcement:'announcement',event:'event',project:'project',workshop:'workshop'};
const roles = {member:'Member',coordinator:'Coordinator',teacher:'Teacher',secretary:'Secretary'};
const states = {pending:'Pending',active:'Active',declined:'Declined',inactive:'Inactive'};
const decisions = {approve:'Approve request',decline:'Decline request',remove:'Remove access',restore:'Restore access'};
const tracks = ['Controls and Automation','Software and Programming','Electronics and Robotics','AI & Machine Learning'];

export function createChapterWorkspace({db,get,esc,head,render,modal,close,show,fail,deadline,missing}) {
  let key='', serial=0, data=null, error='', loading=false, busy=false, formToken=0, rosterData=[];
  let tab='announcement', status='pending', pageIndex=0, lastLoad=0;
  const active = () => {
    const c=get();
    return c.page==='chapters'&&c.allowed&&c.id&&db ? c : null;
  };
  const routeKey = c => c ? [c.id,c.generation,c.admin,c.slug].join(':') : '';
  const field = (label,name,value='',attrs='') => `<label>${esc(label)}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
  const area = (label,name,value,attrs='') => `<label>${esc(label)}<textarea name="${name}" rows="4" ${attrs}>${esc(value)}</textarea></label>`;
  const select = (label,name,values,value) => `<label>${esc(label)}<select name="${name}">${values.map(([v,l])=>`<option value="${esc(v)}"${v===value?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
  const button = (action,label,value='',style='button button-outline') => `<button class="${style}" type="button" data-action="chapter-${action}" data-id="${esc(value)}"${busy?' disabled':''}>${esc(label)}</button>`;
  const link = chapter => `#chapters/${encodeURIComponent(chapter.slug)}`;
  const labelStatus = s => ({draft:'Draft',active:'Open',archived:'Archived'}[s]||'');
  const memberStatus = s => ({pending:'Request pending',active:'Joined',declined:'Request declined',inactive:'Access removed'}[s]||'');
  function clear(resetControls=true){
    serial++;formToken++;data=null;rosterData=[];error='';loading=false;busy=false;lastLoad=0;
    if(resetControls){tab='announcement';status='pending';pageIndex=0;}
  }
  function reset(){
    if(key&&document.querySelector('#modal[open] [data-chapter-form]'))close();
    key='';clear();
  }
  function sync(){
    const current=active(), next=routeKey(current);
    if(next!==key){
      reset();key=next;
      if(current)void load(current);
    }else if(current&&!loading&&!busy&&!error&&Date.now()-lastLoad>30000&&!document.querySelector('#modal[open] [data-chapter-form]')){
      void load(current);
    }
  }
  async function read(name,params){
    const {data:result,error:failure}=await deadline(()=>db.rpc(name,params),10000,'Chapter records took too long to load.');
    if(failure)throw failure;
    return result;
  }
  async function load(current=active(),paint=false){
    if(!current||loading)return;
    const request=++serial,expected=routeKey(current),selectedTab=tab;
    const valid=()=>request===serial&&expected===routeKey(active());
    loading=true;error='';
    if(paint)render();
    try{
      if(!current.slug){
        const result=await read('space_chapter_directory',{p_offset:pageIndex*DIRECTORY_PAGE_SIZE});
        if(valid())data=result;
      }else{
        const result=await read('space_get_chapter',{p_slug:current.slug,p_kind:kinds[selectedTab]?selectedTab:'announcement',p_offset:kinds[selectedTab]?pageIndex*CHAPTER_PAGE_SIZE:0});
        if(!valid())return;
        if(selectedTab==='people'&&(result.can_manage||current.admin)){
          const rows=await read('space_chapter_roster',{p_chapter:result.chapter.id,p_status:status,p_offset:pageIndex*CHAPTER_PAGE_SIZE});
          if(!valid())return;
          rosterData=rows||[];
        }else{
          rosterData=[];
          if(selectedTab==='people')tab='announcement';
        }
        data=result;
      }
    }catch(failure){
      if(!valid())return;
      data=null;rosterData=[];
      error=missing(failure)
        ? 'The chapter workspace is waiting for its database setup.'
        : failure?.code==='42501'?'This chapter is unavailable for your account. Open the directory or reload to check access.':'Chapter records could not load. Please try again.';
    }finally{
      if(valid()){loading=false;lastLoad=Date.now();render();}
    }
  }
  function switchList(){
    serial++;data=null;rosterData=[];loading=false;
    void load(active(),true);
  }
  const pager=(more)=>pageIndex||more?`<div class="chapter-actions chapter-pager">${pageIndex?button('page','Previous',pageIndex-1):''}<span>Page ${pageIndex+1}</span>${more?button('page','Next',pageIndex+1):''}</div>`:'';
  function directory(current){
    const rows=data.chapters||[], chapters=rows.slice(0,DIRECTORY_PAGE_SIZE), mine=data.mine||[];
    return head('CHAPTERS','University chapters','Find your university chapter or return to a chapter you already belong to.',current.admin?button('create','New chapter','','button'):'')
      + (mine.length?`<section class="chapter-section" aria-labelledby="myChapters"><h2 id="myChapters">Your chapters</h2><ul class="chapter-links">${mine.map(c=>`<li><a href="${link(c)}">${esc(c.name)}</a><small>${esc(c.status==='archived'?'Archived':c.membership_status==='active'?(roles[c.chapter_role]||'Member'):memberStatus(c.membership_status))}</small></li>`).join('')}</ul></section>`:'')
      + `<section class="chapter-section" aria-labelledby="chapterDirectory"><h2 id="chapterDirectory">Chapter directory</h2><div class="chapter-grid">${chapters.map(c=>`<article class="chapter-card"><div class="chapter-card-top"><span class="eyebrow">${esc(c.institution)}</span><span class="chapter-tag">${esc(memberStatus(c.membership_status)||labelStatus(c.status))}</span></div><h3><a href="${link(c)}">${esc(c.name)}</a></h3>${c.description?`<p>${esc(c.description.length>220?c.description.slice(0,219)+'…':c.description)}</p>`:''}<a class="text-button" href="${link(c)}">Open chapter <span aria-hidden="true">→</span></a></article>`).join('')||'<p>No chapters on this page yet.</p>'}</div>${pager(rows.length>DIRECTORY_PAGE_SIZE)}</section>`;
  }
  function roster(current){
    const c=data.chapter;
    return `<section class="chapter-section" aria-labelledby="chapterPeople"><h2 id="chapterPeople">People &amp; applications</h2><div class="chapter-actions" aria-label="Membership filters">${Object.entries(states).map(([v,l])=>`<button class="button button-outline" type="button" data-action="chapter-status" data-id="${v}" aria-pressed="${v===status}">${esc(l)}</button>`).join('')}</div>
      <div class="chapter-stack">${rosterData.slice(0,CHAPTER_PAGE_SIZE).map(person=>{
        const change=c.status==='active'&&person.user_id!==current.id&&(current.admin||person.role==='member');
        const review=change?(person.status==='pending'?['approve','decline']:person.status==='active'?['remove']:['restore']):[];
        return `<article class="chapter-person"><div><strong>${esc(person.full_name||'Member')}</strong><small>${esc(roles[person.role]||'Member')} · ${esc(states[person.status])}</small></div><div class="chapter-actions">${review.map(a=>button('review',decisions[a],person.user_id+'/'+a)).join('')}${current.admin&&c.status==='active'&&person.status==='active'?button('role','Assign chapter role',person.user_id):''}</div></article>`;
      }).join('')||'<p>No people in this category.</p>'}</div>${pager(rosterData.length>CHAPTER_PAGE_SIZE)}</section>`;
  }
  function activities(){
    const rows=data.activities||[], publish=data.can_manage||tab==='workshop'&&data.can_publish_workshop;
    return `<section class="chapter-section" aria-labelledby="chapterActivities"><div class="chapter-heading"><h2 id="chapterActivities">${esc(kinds[tab])}</h2>${publish?button('activity','Add '+typeNames[tab],'','button'):''}</div><div class="chapter-stack">${rows.slice(0,CHAPTER_PAGE_SIZE).map(a=>`<article class="chapter-card"><div class="chapter-heading"><h3>${esc(a.title)}</h3>${a.track?`<span class="chapter-tag">${esc(a.track)}</span>`:''}</div>${a.starts_at?`<p class="chapter-time"><time datetime="${esc(a.starts_at)}">${esc(new Date(a.starts_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}))}</time></p>`:''}${a.location?`<p class="chapter-time">${esc(a.location)}</p>`:''}<p class="chapter-copy">${esc(a.body)}</p>${a.can_edit?`<div class="chapter-actions">${button('activity','Edit',a.id)}${button('archive-activity','Archive',a.id)}</div>`:''}</article>`).join('')||`<p>No ${esc(kinds[tab].toLowerCase())} have been posted here yet.</p>`}</div>${pager(rows.length>CHAPTER_PAGE_SIZE)}</section>`;
  }
  function detail(current){
    const c=data.chapter, mine=data.membership_status, staff=data.can_manage||current.admin;
    const membership=mine==='active'?roles[data.role]:memberStatus(mine);
    return `<p class="chapter-directory-link"><a href="#chapters">← Chapter directory</a></p>`+
      head(c.institution,c.name,c.institution,current.admin?button('edit','Edit chapter'):'')+
      `<div class="chapter-actions"><span class="chapter-tag">${esc(labelStatus(c.status))}</span>${membership?`<span class="chapter-tag">${esc(membership)}</span>`:''}</div>
      ${c.description?`<p class="chapter-copy chapter-description">${esc(c.description)}</p>`:''}
      ${current.admin?`<p><a href="#chapter-admin/${encodeURIComponent(c.id)}">Manage chapter operations →</a></p>`:mine==='active'&&c.status==='active'?'<p><a href="#chapter-offices">My chapter offices →</a></p>':''}
      ${c.status==='archived'?'<p class="notice">This chapter is archived. Its records are read-only.</p>':''}
      ${c.status==='draft'?'<p class="notice">This draft is visible only to central administrators. Set its status to Open to accept applications.</p>':''}`+
      (!data.can_read?`<section class="chapter-section"><h2>Membership</h2><p>${esc(mine==='pending'?'Chapter leadership will review your request.':mine?'Contact chapter leadership if you have questions about your membership.':'Request membership to open this chapter’s activities and workshop listings.')}</p>${!mine&&c.status==='active'?button('join','Request to join','','button'):''}</section>`:
      `<nav class="chapter-actions chapter-tabs" aria-label="Chapter sections">${[...Object.entries(kinds),...(staff?[['people','People & applications']]:[])].map(([v,l])=>`<button type="button" class="button button-outline" data-action="chapter-tab" data-id="${v}" aria-pressed="${v===tab}">${esc(l)}</button>`).join('')}</nav>${tab==='people'?roster(current):activities()}`);
  }
  function view(){
    const current=active();
    if(!current)return head('CHAPTERS','University chapters','Sign in with an approved club account to open chapters.');
    if(error)return head('CHAPTERS','University chapters',error)+`<div class="chapter-actions">${button('reload','Try again')}${current.slug?'<a href="#chapters">Back to directory</a>':''}</div>`;
    if(!data)return head('CHAPTERS','University chapters','Opening the chapter workspace…')+'<p role="status">Loading chapter records…</p>';
    return `<div class="chapter-workspace" aria-busy="${loading||busy}">${current.slug?detail(current):directory(current)}</div>`;
  }
  function editor(kind,title,body,label){
    modal(`<span class="eyebrow">UNIVERSITY CHAPTERS</span><h2>${esc(title)}</h2><form class="form-stack" data-chapter-form="${kind}" data-chapter-context="${esc(key)}" data-chapter-token="${++formToken}">${body}<button class="button" type="submit">${esc(label)}</button></form>`);
  }
  function chapterEditor(c){
    const values = !c?[['draft','Draft'],['active','Open']]:c.status==='draft'?[['draft','Draft'],['active','Open'],['archived','Archived']]:[['active','Open'],['archived','Archived']];
    editor(c?'edit':'create',c?'Edit chapter':'New chapter',
      field('Chapter name','chapter_name',c?.name,'required minlength="3" maxlength="100"')+
      field('University or institution','institution',c?.institution,'required minlength="2" maxlength="150"')+
      (c?'<p class="hint">Chapter link: <code>'+esc(c.slug)+'</code></p>':field('Short link name','slug','','required minlength="2" maxlength="48" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="e.g. ttu"'))+
      area('Directory description','description',c?.description||'','maxlength="2000"')+
      select('Status','status',values,c?.status||'draft')+
      '<p class="hint">Open chapters appear in the signed-in chapter directory. Archiving stops new requests and changes while keeping prior records.</p>',
      c?'Save chapter':'Create chapter');
  }
  function localDateTime(value){
    if(!value)return '';
    const d=new Date(value);
    const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,16);
  }
  function activityEditor(a){
    editor('activity',a?'Edit '+typeNames[tab]:'New '+typeNames[tab],
      `<input type="hidden" name="id" value="${esc(a?.id||'')}">`+
      field('Title','title',a?.title,'required minlength="3" maxlength="150"')+
      area('Details','body',a?.body||'','required minlength="3" maxlength="4000"')+
      (tab==='event'||tab==='workshop'?field('Start (your local time)','starts_at',localDateTime(a?.starts_at),'type="datetime-local"'+(tab==='event'?' required':'')):'')+
      (tab==='event'||tab==='workshop'?field('Venue or access details','location',a?.location,'maxlength="200"'):'')+
      (tab==='workshop'?select('Learning track','track',tracks.map(t=>[t,t]),a?.track||tracks[0]):''),a?'Save changes':'Publish to chapter');
  }
  function action(actionName,id){
    if(!actionName.startsWith('chapter-'))return false;
    const current=active(), action=actionName.slice(8);
    if(!current||busy)return true;
    if(action==='reload'){if(!loading)void load(current,true);return true;}
    if(!data||loading)return true;
    if(action==='page'){
      const next=Number(id);if(Number.isInteger(next)&&next>=0&&next!==pageIndex){pageIndex=next;switchList();}return true;
    }
    if(action==='create'&&current.admin&&!current.slug){chapterEditor(null);return true;}
    const chapter=data.chapter;
    if(!chapter)return true;
    if(action==='edit'&&current.admin)chapterEditor(chapter);
    if(action==='join'&&!data.membership_status&&chapter.status==='active'){
      editor('join','Request to join '+chapter.name,'<p>Your name will be visible to chapter leadership for the membership review.</p>','Send request');
    }
    if(action==='tab'&&(Object.hasOwn(kinds,id)||id==='people'&&(data.can_manage||current.admin))&&tab!==id){
      tab=id;pageIndex=0;switchList();
    }
    if(action==='status'&&tab==='people'&&Object.hasOwn(states,id)&&id!==status){status=id;pageIndex=0;switchList();}
    if(action==='activity'||action==='archive-activity'){
      const a=(data.activities||[]).find(r=>r.id===id);
      if(action==='activity'&&(!id&&(data.can_manage||tab==='workshop'&&data.can_publish_workshop)||a?.can_edit))activityEditor(a);
      if(action==='archive-activity'&&a?.can_edit)editor(action,'Archive '+a.title,`<input type="hidden" name="id" value="${esc(id)}"><p>This item will be removed from the chapter activity list. Its record is retained.</p>`,'Archive activity');
    }
    if(action==='review'||action==='role'){
      const [user,decision]=id.split('/'),person=rosterData.find(p=>p.user_id===user);
      if(!person)return true;
      const hidden=`<input type="hidden" name="user" value="${esc(user)}">`;
      if(action==='review'&&Object.hasOwn(decisions,decision))editor('review',decisions[decision],hidden+`<input type="hidden" name="decision" value="${esc(decision)}"><p>Confirm this change for <strong>${esc(person.full_name)}</strong> in ${esc(chapter.name)}.</p>`,decisions[decision]);
      if(action==='role'&&current.admin)editor('role','Assign chapter role',hidden+select('Role for '+person.full_name,'role',Object.entries(roles),person.role)+'<p class="hint">This changes access in this chapter only.</p>','Assign role');
    }
    return true;
  }
  function submit(e){
    const form=e.target, kind=form.dataset.chapterForm;
    if(!kind)return false;
    e.preventDefault();
    const current=active(), expected=key;
    if(!current||loading||busy||form.dataset.chapterContext!==expected)return true;
    const token=form.dataset.chapterToken,c=data?.chapter, fields=new FormData(form);
    const value=name=>String(fields.get(name)||'').trim();
    let fn,args,success;
    if(kind==='create'||kind==='edit'){
      fn='space_save_chapter';args={p_chapter:c?.id||null,p_slug:c?.slug||value('slug'),p_name:value('chapter_name'),p_institution:value('institution'),p_description:value('description'),p_status:value('status')};success='Chapter saved.';
    }else if(kind==='join'){
      fn='space_request_chapter_membership';args={p_chapter:c.id};success='Chapter membership request submitted.';
    }else if(kind==='review'){
      fn='space_review_chapter_membership';args={p_chapter:c.id,p_user:value('user'),p_decision:value('decision')};success='Chapter membership updated.';
    }else if(kind==='role'){
      fn='space_assign_chapter_role';args={p_chapter:c.id,p_user:value('user'),p_role:value('role')};success='Chapter role updated.';
    }else if(kind==='activity'||kind==='archive-activity'){
      const starts=value('starts_at');
      if(starts&&!Number.isFinite(Date.parse(starts))){show('Enter a valid start date and time.');return true;}
      fn='space_save_chapter_activity';args={p_chapter:c.id,p_activity:value('id')||null,p_kind:tab,p_title:value('title'),p_body:value('body'),p_starts_at:starts?new Date(starts).toISOString():null,p_location:value('location'),p_track:value('track')||null,p_archive:kind==='archive-activity'};success=kind==='activity'?'Chapter activity saved.':'Chapter activity archived.';
    }else return true;
    busy=true;
    const submitter=form.querySelector('[type=submit]');
    if(submitter)submitter.disabled=true;
    const valid=()=>routeKey(active())===expected&&String(formToken)===token;
    void (async()=>{
      try{
        const {error:failure}=await db.rpc(fn,args);
        if(failure)throw failure;
        if(!valid())return;
        if(form.isConnected&&form.dataset.chapterToken===token)close();
        show(success);busy=false;pageIndex=0;
        void load(active(),true);
      }catch(failure){
        if(valid()){
          if(failure?.code==='23505'&&fn==='space_save_chapter')show('That short link name is already used. Choose another.');
          else fail(failure);
        }
      }finally{
        if(valid())busy=false;
        if(submitter?.isConnected)submitter.disabled=false;
      }
    })();
    return true;
  }
  return {sync,reset,view,action,submit};
}
