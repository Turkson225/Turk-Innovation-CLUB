/* Role onboarding and administrator diagnostics. No provider secrets in client code. */
(() => {
 'use strict';
 function create(ctx){
  const e=ctx.esc;let owner='',generation=-1,snapshot=null,health=null,healthError='',loading=false,request=0,reportTimes=new Map(),dismissed=new Set();
  const current=()=>ctx.get(),valid=(id,gen)=>current().id===id&&current().generation===gen;
  const missing=error=>['PGRST202','42883','42P01'].includes(error?.code);
  function ensure(){const s=current();if(owner!==s.id||generation!==s.generation){owner=s.id;generation=s.generation;snapshot=null;health=null;healthError='';loading=false;request++;reportTimes=new Map();}return s;}
  function mode(s){return s.teacher&&!s.admin?'teacher':'member';}
  const hideKey=s=>'space.welcome.dismissed.'+s.id+'.'+mode(s);
  function isHidden(s){if(dismissed.has(hideKey(s)))return true;try{return localStorage.getItem(hideKey(s))==='1';}catch{return false;}}
  function fact(key,fallback=null){return fallback===true?true:typeof snapshot?.[key]==='boolean'?snapshot[key]:fallback;}
  function steps(){
   const s=ensure();if(!s.approved||!s.club||s.admin)return [];
   return mode(s)==='teacher'?[
    {key:'teaching_profile',title:'Complete your teaching profile',copy:'Describe your experience, practical focus and availability.',action:'onboardingTeachingProfile',done:fact('teaching_profile',s.teachingProfile)},
    {key:'signature',title:'Save your own certificate signature',copy:'Draw, type or upload your signature with consent.',action:'certificateSettings',done:fact('signature')},
    {key:'published_course',title:'Prepare your first workshop',copy:'Publish a clear build outcome in an assigned teaching track.',action:'courseForm',done:fact('published_course',s.hasWorkshop)},
    {key:'materials',title:'Share a course file',copy:'Add slides or a guide to the course your students will open.',action:'learningForm',done:fact('materials',s.hasMaterial)},
    {key:'assignment',title:'Set the first practical task',copy:'Give enrolled students instructions and a deadline.',action:'classworkForm',done:fact('assignment',s.hasAssignment)}
   ]:[
    {key:'profile',title:'Introduce yourself on your profile',copy:'Add your interests and a short introduction. A photo is optional.',action:'profileForm',done:s.profileDone},
    {key:'tracks',title:'Choose your learning tracks',copy:'Select any combination of the four practical tracks.',action:'learningPathForm',done:fact('tracks',s.tracksDone)},
    {key:'enrolled',title:'Join your first workshop',copy:'Browse workshops and open the classroom for one you join.',href:'#courses',done:fact('enrolled',s.enrolled)},
    {key:'first_post',title:'Share your first club update',copy:'Introduce an idea, question or something you are building.',href:'#feed',done:fact('first_post',s.firstPost)}
   ];
  }
  function banner(){
   const s=ensure(),rows=steps();if(!rows.length||isHidden(s)||rows.every(row=>row.done===true))return '';
   const done=rows.filter(row=>row.done===true).length;
   return `<section class="journey-welcome-banner"><a href="#getting-started"><strong>${mode(s)==='teacher'?'Set up your teaching space':'Make yourself at home'}</strong><span>${done} of ${rows.length} steps completed · Continue →</span></a><button type="button" data-action="onboardingDismiss" aria-label="Hide welcome checklist on Home">×</button></section>`;
  }
  function welcome(){
   const s=ensure(),rows=steps(),done=rows.filter(row=>row.done===true).length;
   if(!s.approved)return '<div class="notice">Your account needs approval before the workspace checklist is available.</div>';
   if(!rows.length)return `<section class="card"><h2>Welcome to SPACE</h2><p>${s.admin?'Your administrator workspace brings together approvals, course oversight, orders and system health.':'Your investor portal contains approved club updates and inquiries.'}</p><div class="profile-buttons"><a class="button" href="${s.admin?'#admin':'#investor-portal'}">Open my workspace →</a>${s.admin?'<a class="button button-outline" href="#system-health">System health</a>':''}</div></section>`;
   return `<header class="page-head"><div><span class="eyebrow">WELCOME TO SPACE</span><h1>${mode(s)==='teacher'?'Your teaching setup':'Your first steps'}</h1><p>A short guide to the tools you will use most.</p></div><button class="button button-outline button-sm" data-action="onboardingReload">Refresh progress</button></header><section class="card journey-onboarding-progress"><strong>${done} of ${rows.length} completed</strong><progress value="${done}" max="${rows.length}" aria-label="Welcome checklist progress">${done}/${rows.length}</progress><p>${done===rows.length?'You are ready. Return here whenever you need a reminder.':'Progress follows your saved work. You can return to this guide from More or the sidebar.'}</p></section><div class="journey-checklist">${rows.map((row,i)=>`<article class="card journey-checklist-item ${row.done===true?'is-done':''}"><span class="journey-check-step" aria-hidden="true">${row.done===true?'✓':i+1}</span><div><small>${row.done===true?'Completed':row.done===null?'Not checked yet':'Next step'}</small><h2>${e(row.title)}</h2><p>${e(row.copy)}</p></div>${row.action?`<button type="button" class="button button-outline button-sm" data-action="${row.action}">${row.done===true?'Review':'Open'} →</button>`:`<a class="button button-outline button-sm" href="${e(row.href)}">${row.done===true?'Review':'Open'} →</a>`}</article>`).join('')}</div><div class="profile-buttons"><button class="text-button" data-action="onboardingShow">Show this checklist reminder on Home</button><a class="link" href="#home">Return Home →</a></div>`;
  }
  async function load(page){
   const s=ensure();if(!s.approved||!['home','getting-started','teaching','system-health'].includes(page))return;
   const id=s.id,gen=s.generation,version=++request;
   if(page==='system-health'){
    if(!s.admin)return;loading=true;healthError='';
    try{const result=await ctx.deadline(()=>ctx.db.rpc('space_admin_system_health'),12000,'Health checks timed out.');if(!valid(id,gen)||version!==request)return;if(result.error)throw result.error;if(!result.data||!Array.isArray(result.data.schema_checks))throw Error('Invalid health response');health=result.data;}
    catch(error){if(valid(id,gen)&&version===request){health=null;healthError=missing(error)?'Run upgrade_guidance_system_health.sql in Supabase to activate these checks.':'System checks are temporarily unavailable. Refresh to try again.';}}
    finally{if(valid(id,gen)&&version===request)loading=false;}
    return;
   }
   if(!s.club||s.admin)return;
   try{const result=await ctx.deadline(()=>ctx.db.rpc('space_onboarding_status'),8000,'Welcome progress could not load.');if(valid(id,gen)&&version===request&&!result.error&&result.data)snapshot=result.data;}catch{}
  }
  function healthView(){
   const s=ensure();if(!s.admin)return '';
   const intro=`<header class="page-head"><div><span class="eyebrow">ADMINISTRATION</span><h1>System health</h1><p>Delivery queues, setup checks and member-reported problems.</p></div><button class="button button-outline" data-action="healthReload" ${loading?'disabled':''}>${loading?'Checking…':'Refresh checks'}</button></header>`;
   if(!health)return intro+`<div class="notice" role="status">${e(healthError||'Open this page online to load current checks.')}</div><a class="link" href="${ctx.runbook}" target="_blank" rel="noopener noreferrer">Setup and recovery guide ↗</a>`;
   const checked=health.checked_at,date=value=>value?new Date(value).toLocaleString():'No delivery recorded';
   const state=(data,bad)=>!data?'Not set up':bad?'Needs attention':'No queued failures';
   const metric=(label,value)=>`<div><strong>${e(value??'—')}</strong><small>${e(label)}</small></div>`;
   const card=(title,status,body,extra='')=>`<article class="card journey-health-card"><div class="row"><h2>${e(title)}</h2><span class="tag ${status==='Needs attention'||status==='Not set up'?'gold':'blue'}">${e(status)}</span></div>${body}${extra}</article>`;
   const email=health.approval_emails,push=health.push,uploads=health.upload_reports||{},notices=health.notification_reports||{};
   const queueCards=card('Approval emails',state(email,email?.failed||email?.overdue),`<div class="journey-health-metrics">${metric('Waiting / retry',email?.pending)}${metric('Failed jobs',email?.failed)}${metric('Overdue jobs',email?.overdue)}${metric('Sent in 24 hours',email?.sent_24h)}</div><p>Last recorded send: ${e(date(email?.last_sent_at))}.</p><p class="subtle">A worker success records provider acceptance. Inbox delivery and Auth signup/password emails still need a live email test.</p>`)+card('Device notifications',state(push,push?.failed_24h||push?.overdue),`<div class="journey-health-metrics">${metric('Registered devices',push?.registered_devices)}${metric('Waiting / retry',push?.pending)}${metric('Overdue jobs',push?.overdue)}${metric('Failed new jobs / 24h',push?.failed_24h)}</div><p>Last recorded send: ${e(date(push?.last_sent_at))}.</p><p class="subtle">Push-service acceptance does not confirm display on a lock screen. Devices must opt in.</p>`);
   const issueCard=(category,title,data)=>card(title,data.affected_members?'Needs attention':'No unreviewed reports',`<strong class="journey-health-total">${e(data.affected_members||0)}</strong><p>Accounts with an unreviewed problem report. Only the latest report per account and category is retained.</p>${data.last_report_at?`<small>Latest report: ${e(date(data.last_report_at))}</small>`:''}`,data.affected_members?`<button class="button button-outline button-sm" data-action="healthReview" data-category="${category}" data-before="${e(checked)}">Mark these reports reviewed</button>`:'');
   const browser=window.InnovateXPush?.state?.(),schedule=health.schedules||{};
   return intro+`<p class="subtle">Checked ${e(date(checked))}. Refresh after changes. These checks do not certify uptime or backup recovery.</p><div class="journey-health-grid">${queueCards}${issueCard('upload','Upload problem reports',uploads)}${issueCard('notifications','Notification setup reports',notices)}</div><section class="card journey-health-recovery"><h2>Recover and verify</h2><ol><li><strong>Email problems:</strong> check the approval worker logs, its private SMTP credentials and its schedule. After fixing the cause, automatic retries continue for retry jobs; review failed jobs using the runbook.</li><li><strong>Notification problems:</strong> check the push worker, its keys, schedules and device permission. Test a new notification with a consenting test account.</li><li><strong>Upload problems:</strong> check the bucket setup below, its limits and permissions, then retry a small supported file. A report does not contain a filename or private document.</li></ol><div class="profile-buttons"><a class="button button-outline" href="${ctx.dashboard}" target="_blank" rel="noopener noreferrer">Supabase dashboard ↗</a><a class="button button-outline" href="${ctx.runbook}" target="_blank" rel="noopener noreferrer">Recovery runbook ↗</a><a class="link" href="#notifications">This device’s alert settings →</a></div><p class="subtle">This browser: ${e(browser?browser.subscribed?'registered for alerts':browser.reason||'alerts are not enabled':'notification state unavailable')}. No test notification is sent automatically.</p></section><details class="card journey-health-details"><summary>Configuration checks</summary><h3>Required course and privacy records</h3><ul>${health.schema_checks.map(check=>`<li><code>${e(check.key)}</code> — ${check.present?'present':'missing: apply its setup migration'}</li>`).join('')}</ul><p>Private application-answer migration: ${health.application_privacy_migration?'present':'needs review'}. This checks the schema layout, not every access policy.</p><h3>Storage buckets</h3><ul>${(health.storage||[]).map(bucket=>`<li><code>${e(bucket.name)}</code> — ${!bucket.present?'missing':bucket.visibility_ok?'expected visibility':'visibility needs review'}</li>`).join('')}</ul><h3>Scheduled workers</h3><p>Supabase Cron: ${schedule.cron_available?'available':'not found'}. Approval job: ${schedule.approval_job===null?'not verified':schedule.approval_job?'active job found':'no matching active job'}. Push job: ${schedule.push_job===null?'not verified':schedule.push_job?'active job found':'no matching active job'}.</p><p class="subtle">An external scheduler or a differently named job is not detected. Function deployment, Vault values, Auth SMTP and secret correctness require checks in Supabase. Member problem reporting begins with this update and is not a historical file-transfer audit.</p></details>`;
  }
  async function report(category,error,expectedOwner){
   const s=ensure();if(!s.approved||!s.id||expectedOwner&&expectedOwner!==s.id||!['upload','notifications'].includes(category))return;
   const now=Date.now();if((reportTimes.get(category)||0)>now-60000)return;reportTimes.set(category,now);
   const value=String(error?.code||error?.status||error?.statusCode||'').toLowerCase();
   const code=['401','403','42501'].includes(value)?'permission':['404','pgrst202','42p01','42883'].includes(value)?'configuration':error?.name==='TypeError'||/network|fetch/.test(value)?'network':/^5\d\d$/.test(value)?'unavailable':'unknown';
   try{await ctx.deadline(()=>ctx.db.rpc('space_report_client_issue',{p_category:category,p_code:code}),5000,'Issue report unavailable.');}catch{}
  }
  async function action(name,el){
   if(!['onboardingDismiss','onboardingShow','onboardingReload','healthReload','healthReview'].includes(name))return false;
   const s=ensure();
   if(name.startsWith('onboarding')){if(!s.approved)return true;if(name!=='onboardingReload'){const key=hideKey(s);if(name==='onboardingDismiss')dismissed.add(key);else dismissed.delete(key);try{localStorage.setItem(key,name==='onboardingDismiss'?'1':'0');}catch{}}if(name==='onboardingReload')await load('getting-started');if(valid(s.id,s.generation))ctx.render();return true;}
   if(!s.admin)return true;
   if(name==='healthReload'){const checking=load('system-health');ctx.render();await checking;if(valid(s.id,s.generation))ctx.render();return true;}
   if(!['upload','notifications'].includes(el?.dataset.category)||!health||el.dataset.before!==health.checked_at)return true;
   el.disabled=true;try{const result=await ctx.deadline(()=>ctx.db.rpc('space_admin_review_client_issues',{p_category:el.dataset.category,p_before:health.checked_at}),10000,'Review timed out.');if(result.error)throw result.error;if(!valid(s.id,s.generation))return true;await load('system-health');if(valid(s.id,s.generation)){ctx.show('Reports marked reviewed. New reports remain visible.');ctx.render();}}catch{if(valid(s.id,s.generation))ctx.show('Reports could not be reviewed. Refresh and try again.');}finally{if(el.isConnected)el.disabled=false;}return true;
  }
  return {load,banner,welcome,healthView,report,action,steps,reset(){owner='';generation=-1;snapshot=null;health=null;healthError='';request++;}};
 }
 window.SpaceGuidance={create};
})();
