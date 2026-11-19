/* Optional walkthroughs of existing SPACE pages. No tour action writes club data. */
(() => {
 'use strict';
 const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
 const slug=s=>typeof s==='string'&&s.length<=48&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
 const step=(title,text,href='',label='')=>({title,text,href,label});
 const roleNotice=step('Read your assignment','Open Role updates to read your assignment note. If the update asks you to acknowledge it, do that on the Role updates page.','#role-updates','Open Role updates');
 const notes=step('Keep up with updates','Find new assignments, workshop notices and replies in Notifications. You can turn on device alerts there if you want them.','#notifications','Open Notifications');
 const general={
  member:{title:'New member tour',steps:[
   step('Choose what you want to learn','Pick any of the four learning tracks in My learning. You can choose more than one. Open a workshop to check what you will build, what to bring and how to enrol.','#courses','Open My learning'),
   step('Find your university chapter','Open University chapters, find your campus and request to join. Once you are approved for that chapter, its announcements, events and projects appear on the chapter page.','#chapters','Find my chapter'),
   step('Use your calendar','See upcoming club events and scheduled classes. Open an event for the time, venue or meeting link when one is available.','#calendar','Open Calendar'),
   step('Meet people and get help','Introduce yourself in the Member feed, ask a question or reply to a thread. Use Direct messages when you want a private conversation.','#feed','Open Member feed'),notes]},
  teacher:{title:'Teaching Studio tour',steps:[roleNotice,
   step('Set up your teaching profile','In Teaching Studio, open the profile tab and describe what you teach, your practical experience and your availability.','#teaching','Open Teaching Studio'),
   step('Prepare a practical workshop','Create a workshop in an assigned track. Explain what learners will build, list any prerequisites and put the workshop date and deadlines in the course.','#teaching','Open my workshops'),
   step('Follow your learners’ work','Open an assigned classroom. Use Learn for files, Work for assignments and feedback, and Students for the roster. All of these are scoped to that classroom.','#teaching','Find an assigned classroom'),
   step('Complete the learning journey','Save your certificate signature in Teaching Studio if you will issue certificates. Confirm completion only after you have reviewed the learner’s work.','#teaching','Open Teaching Studio')]},
  founder:{title:'Founder tour',steps:[roleNotice,
   step('Join founder meetings','Open Founder meetings to review the meeting details, join online when a link is provided, and follow up on decisions.','#founder-room','Open Founder meetings'),
   step('Support the club’s projects','Review active builds, find milestones and help teams get unstuck before their next demonstration or competition.','#projects','Open Projects'),notes]},
  admin:{title:'Administrator tour',steps:[
   step('Deal with what needs attention','Use Admin overview to check pending approvals and the rest of the club’s work. Open Membership approvals to review verified applications.','#admin','Open Admin overview'),
   step('Assign club responsibilities','Use Roles & offices to record officer assignments and their duties. The person receives an assignment notice that they can acknowledge.','#officers','Open Roles & offices'),
   step('Keep chapters moving','Open Chapter Control Centre to compare campuses, review their workload and manage chapter leadership.','#chapter-admin','Open Chapter Control Centre'),
   step('Review club finances','Use Finance for recording, approvals, receipts and monthly review. Open Finance reports to read approved monthly totals.','#finance','Open Finance')]},
  investor:{title:'Investor portal tour',steps:[roleNotice,
   step('See club and project updates','Your Investor portal shows the updates available to partners and a way to send inquiries to the club.','#investor-portal','Open Investor portal'),notes]}
 };
 const clubOffices={
  president:['President','Set priorities, agree who owns each action and check progress before the next meeting.'],
  vice_president:['Vice president','Coordinate office holders, follow up on action owners and surface blockers early.'],
  secretary:['Secretary','Record meeting minutes, decisions and action owners so people know what to do next.'],
  treasurer:['Treasurer','Prepare budget notes and flag any difference for the administrator’s monthly review.'],
  project_lead:['Project lead','Track build milestones, owners, blockers and evidence for project reviews.'],
  events_coordinator:['Events coordinator','Prepare venue, timing and logistics and keep the event plan up to date.'],
  communications_officer:['Communications officer','Draft announcements and outreach material, and confirm deadlines and details before sharing.']
 };
 const chapterOffices={
  coordinator:['Coordinator','Open People & roles to see local office holders and assign work. In the work queue, review submitted tasks and return them with feedback or mark them complete.'],
  deputy_coordinator:['Deputy coordinator','Follow up on assigned plans, outstanding actions and blockers. Pass items that need a decision to your chapter coordinator.'],
  teacher:['Chapter teacher','Plan practical workshops for your campus. Use the chapter page for workshop listings and check your office queue for assigned preparation. A chapter teaching role is separate from a club-wide teaching assignment.'],
  secretary:['Chapter secretary','Keep the campus agenda, minutes and decisions. Include the owner and due date for each action when you submit an update.'],
  treasurer:['Chapter treasurer','Prepare campus budget notes and expense summaries. Send them for review through your assigned tasks; chapter appointment does not grant access to the central finance ledger.'],
  teaching_lead:['Teaching lead','Coordinate local workshop schedules, materials and practical preparation with your chapter teachers.'],
  events_lead:['Events lead','Plan the programme, venue and event logistics. Keep the coordinator informed about deadlines and dependencies.'],
  projects_lead:['Projects lead','Track local build milestones, blockers and the evidence needed for demos and competitions.'],
  communications:['Communications officer','Prepare the chapter’s announcements and outreach. Confirm the intended audience, timing and contact details before sharing.']
 };
 const sanctioned=['home','courses','teaching','role-updates','notifications','office','chapter-offices','admin','investor-portal','founder-room'];
 const keyPart=(type,code)=>type+':'+code;
 function guides(s,c,chapters){
  if(!s?.id||!s.approved||c?.session?.user?.id!==s.id||!c.approved)return [];
  const results=[],add=(key,item)=>results.push({key,...item});
  if(!s.club){if(c.me?.role==='investor')add('investor',general.investor);return results;}
  add('member',general.member);
  if(s.admin)add('admin',general.admin);
  else if(s.teacher)add('teacher',general.teacher);
  if(c.me?.role==='founder')add('founder',general.founder);
  for(const office of new Set(Array.isArray(c.offices)?c.offices:[])){
   if(!Object.hasOwn(clubOffices,office))continue;
   const [name,tip]=clubOffices[office],steps=[roleNotice,step('Open your office desk','My office shows your duties, due dates and work history. '+tip,'#office','Open My office')];
   if(office==='treasurer')steps.push(step('Read approved financial reports','Use Finance reports to review approved income, expenses and monthly balances. Send anything that needs an adjustment to the administrator.','#finance-reports','Open Finance reports'));
   steps.push(step('Record your progress','Open a work item in My office or use the available office form. Add a clear update with the date, what changed and any next action.','#office','Open My office'));
   add(keyPart('office',office),{title:name+' tour',steps});
  }
  for(const campus of chapters){
   const href='#chapter-offices/'+campus.id;
   for(const office of campus.offices){
    if(!Object.hasOwn(chapterOffices,office))continue;
    const [name,tip]=chapterOffices[office];
    add(keyPart('chapter',campus.id+':'+office),{title:name+' tour',chapter:campus.name,chapterId:campus.id,steps:[
     step('Open your campus workspace','Your chapter dashboard separates local assignments from club-wide responsibilities. Check the office listed beside your name or in My chapter offices.',href,'Open my chapter workspace'),
     step('Know what your office handles',tip,href,'Open my chapter workspace'),
     step('Work from your queue','Open the Work queue or My assigned work. Read the instructions and due date, then use Submit work on your task with a clear progress note. Check its status or history for the response.',href,'Open assigned work'),
     step('Visit your chapter page','See the chapter’s workshops, announcements and local activity on its chapter page.','#chapters/'+campus.slug,'Open my chapter')]});
   }
  }
  return results;
 }
 function cleanChapters(rows){
  if(!Array.isArray(rows))return [];
  return rows.filter(x=>x&&uuid(x.id)&&slug(x.slug)&&typeof x.name==='string'&&Array.isArray(x.offices)).slice(0,100)
   .map(x=>({id:x.id,slug:x.slug,name:x.name.slice(0,160),offices:[...new Set(x.offices.filter(o=>Object.hasOwn(chapterOffices,o)))]}));
 }
 let commerce=()=>null,controller=null;
 function create({get,db,deadline}){
  let owner='',generation=null,chapters=[],reading=null,loadedAt=0,dialog=null,active=null,following=null,restore=null,cycle=0;
  const memo=new Map();
  const state=()=>{
   const s=get(),c=commerce(),id=s.approved&&s.id&&c?.session?.user?.id===s.id&&c.approved?s.id:'';
   if(owner!==id||generation!==s.generation){
    reset();owner=id;generation=s.generation;
   }
   return {s,c,id};
  };
  function reset(){
   active=null;following=null;restore=null;owner='';generation=null;chapters=[];reading=null;loadedAt=0;cycle++;memo.clear();
   if(dialog){if(dialog.open)dialog.close();dialog.remove();dialog=null;}
  }
  function list(){
   const {s,c,id}=state();return id?guides(s,c,chapters):[];
  }
  const position=v=>v?.state==='done'||v?.state==='later'||v?.state==='paused'?v:null;
  function read(key){
   if(memo.has(key))return memo.get(key);
   try{return position(JSON.parse(localStorage.getItem('space.tour.v1.'+owner+'.'+key)||'null'));}catch{return null;}
  }
  function save(key,mark,index=0){
   const value={state:mark,step:index};memo.set(key,value);
   try{localStorage.setItem('space.tour.v1.'+owner+'.'+key,JSON.stringify(value));}catch{}
  }
  const progress=(guide,p)=>p?.state==='done'?'Completed':p?.state==='paused'?'In progress · step '+(indexFor(guide,p)+1):guide.steps.length+' steps';
  const indexFor=(guide,p)=>Number.isInteger(p?.step)?Math.min(guide.steps.length-1,Math.max(0,p.step)):0;
  const button=(label,cmd,key='',className='button button-outline button-sm')=>`<button type="button" class="${className}" data-space-tour="${cmd}"${key?` data-tour-key="${e(key)}"`:''}>${e(label)}</button>`;
  function library(){
   const all=list();if(!all.length)return '';
   return `<section class="space-tour-library" aria-labelledby="space-tour-library-title"><span class="eyebrow">A QUICK WALKTHROUGH</span><h2 id="space-tour-library-title">Platform tours</h2><p>Choose a guide for your current access. Pause or replay it whenever you need.</p><div class="space-tour-grid">${all.map(g=>{
    const p=read(g.key);
    return `<article class="space-tour-card"><div><h3>${e(g.title)}</h3>${g.chapter?`<span>${e(g.chapter)}</span>`:''}<small>${e(progress(g,p))}</small></div>${button(p?.state==='done'?'Replay':p?.state==='paused'?'Resume':'Start tour','start',g.key)}</article>`;
   }).join('')}</div></section>`;
  }
  function offerFor(all,c){
   if(!c)return null;
   if(following&&following.href===location.hash){
    const g=all.find(g=>g.key===following.key);
    if(g)return {g,following:true};
   }
   if(!sanctioned.includes(c.page))return null;
   let candidates=all.filter(g=>!['done','later'].includes(read(g.key)?.state));
   if(c.page==='courses')candidates=candidates.filter(g=>g.key==='member');
   if(c.page==='teaching')candidates=candidates.filter(g=>g.key==='teacher');
   if(c.page==='office')candidates=candidates.filter(g=>g.key.startsWith('office:'));
   if(c.page==='admin')candidates=candidates.filter(g=>g.key==='admin');
   if(c.page==='founder-room')candidates=candidates.filter(g=>g.key==='founder');
   if(c.page==='investor-portal')candidates=candidates.filter(g=>g.key==='investor');
   if(c.page==='chapter-offices'){
    const id=location.hash.split('/')[1];
    candidates=candidates.filter(g=>g.chapterId&&(!id||id===g.chapterId));
   }
   if(['role-updates','notifications'].includes(c.page))candidates=candidates.filter(g=>g.key!=='member');
   const g=candidates.find(g=>g.key!=='member')||candidates[0];return g?{g}:null;
  }
  function sync(){
   const all=list(),{c,id}=state();
   if(active&&!all.some(g=>g.key===active.key))close(false);
   const content=document.getElementById('content');
   if(!content)return;
   const base=content.querySelector('[data-tour-library-host]');
   if(base){const markup=library();if(base.innerHTML!==markup)base.innerHTML=markup;}
   const previous=content.querySelector('[data-tour-offer]');
   const pick=id&&!content.querySelector('.workspace-start')&&offerFor(all,c);
   if(!pick){previous?.remove();return;}
   const {g}=pick,p=read(g.key);
   const markup=`<section class="space-tour-offer" data-tour-offer aria-label="SPACE tutorial"><div><span class="eyebrow">${pick.following?'CONTINUE WHERE YOU LEFT OFF':'GET TO KNOW YOUR WORKSPACE'}</span><h2>${e(g.title)}${g.chapter?' · '+e(g.chapter):''}</h2><p>${pick.following?'Continue to the next tip when you are ready.':read(g.key)?.state==='paused'?'Your place is saved on this browser.':'A short walkthrough of the pages you will use most.'}</p></div><div class="space-tour-buttons">${button(pick.following?'Next tour step':p?.state==='paused'?'Resume tour':'Start tour',pick.following?'continue':'start',g.key,'button button-sm')}${button('Not now','later',g.key,'text-button')}</div></section>`;
   if(previous?.outerHTML===markup)return;
   if(previous)previous.outerHTML=markup;else content.insertAdjacentHTML('afterbegin',markup);
  }
  function loadChapters(page){
   const {id,s}=state();
   if(!id||!s.club||!db||!['home','getting-started','chapter-offices','role-updates','notifications'].includes(page))return;
   if(reading||Date.now()-loadedAt<60000)return reading;
   const request=++cycle;
   reading=Promise.resolve().then(async()=>{
    try{
     const result=await deadline(()=>db.rpc('space_my_chapter_offices'),6500,'The chapter guides could not load.');
     if(cycle===request&&state().id===id&&cycle===request)chapters=result.error?[]:cleanChapters(result.data);
    }catch{if(cycle===request)chapters=[];}
    finally{if(cycle===request){reading=null;loadedAt=Date.now();sync();}}
   });
   return reading;
  }
  function close(putFocus=true){
   active=null;
   if(dialog){if(dialog.open)dialog.close();dialog.remove();dialog=null;}
   if(putFocus&&restore?.isConnected)restore.focus({preventScroll:true});
   restore=null;
  }
  function restorePageFocus(){
   const target=document.getElementById('content')?.querySelector('[data-tour-library-host] button, [data-tour-offer] button, h1');
   if(target){
    if(target.tagName==='H1')target.setAttribute('tabindex','-1');
    target.focus({preventScroll:true});
   }
  }
  function paint(g){
   const row=g.steps[active.step],n=active.step+1,tot=g.steps.length;
   dialog.innerHTML=`<div class="space-tour-top"><span>${e(g.title)}${g.chapter?' · '+e(g.chapter):''}</span>${button('Close tour','pause','','text-button')}</div><div class="space-tour-step-count">Step ${n} of ${tot}<progress aria-label="Tour progress" value="${n}" max="${tot}">${n}/${tot}</progress></div><h2 id="space-tour-title" tabindex="-1">${e(row.title)}</h2><p id="space-tour-description">${e(row.text)}</p>${row.href?`<a class="space-tour-jump" href="${e(row.href)}" data-space-tour="jump">${e(row.label)} <span aria-hidden="true">↗</span></a>`:''}<footer class="space-tour-buttons">${active.step?button('Back','back'):''}${button(n===tot?'Finish tour':'Next',n===tot?'finish':'next','','button button-sm')}</footer>`;
   dialog.querySelector('#space-tour-title')?.focus({preventScroll:true});
  }
  function start(g,source,advance=false){
   if(!g||active||document.querySelector('dialog[open]:not(#loginWelcome)'))return;
   const p=read(g.key),index=p?.state==='paused'?indexFor(g,p):0;
   restore=source;following=null;active={key:g.key,step:Math.min(g.steps.length-1,index+(advance?1:0))};
   dialog=document.createElement('dialog');dialog.className='space-tour-dialog';dialog.setAttribute('aria-labelledby','space-tour-title');dialog.setAttribute('aria-describedby','space-tour-description');
   dialog.addEventListener('cancel',event=>{event.preventDefault();doCommand('pause',g.key);});
   document.body.append(dialog);
   try{dialog.showModal();paint(g);}catch{close();}
  }
  function doCommand(cmd,key,source){
   const guide=list().find(g=>g.key===(active?.key||key));if(!guide){close(false);return;}
   if(cmd==='start'||cmd==='continue'){start(guide,source,cmd==='continue');return;}
   if(cmd==='later'&&!active){save(guide.key,'later');following=null;sync();restorePageFocus();return;}
   if(!active)return;
   if(cmd==='next'||cmd==='back'){
    active.step=Math.max(0,Math.min(guide.steps.length-1,active.step+(cmd==='next'?1:-1)));
    save(guide.key,'paused',active.step);paint(guide);return;
   }
   if(cmd==='pause'||cmd==='finish'||cmd==='jump'){
    const row=guide.steps[active.step];
    save(guide.key,cmd==='finish'?'done':'paused',active.step);
    following=cmd==='jump'&&row.href?{key:guide.key,href:row.href}:null;
    const original=restore;
    close(cmd!=='jump');sync();
    if(cmd!=='jump'&&!original?.isConnected)restorePageFocus();
    return cmd==='jump'?row.href:undefined;
   }
  }
  document.addEventListener('click',event=>{
   const source=event.target.closest?.('[data-space-tour]');
   if(!source)return;
   event.preventDefault();const href=doCommand(source.dataset.spaceTour,source.dataset.tourKey,source);
   if(href){location.hash=href;sync();}
  });
  window.addEventListener('hashchange',()=>{if(active)doCommand('pause',active.key);});
  window.addEventListener('pagehide',reset);
  controller={library,sync,reset,loadChapters};
  return controller;
 }
 window.SpaceTours={create,connect(fn){commerce=fn;},refresh(){controller?.sync();},guides,cleanChapters};
})();
