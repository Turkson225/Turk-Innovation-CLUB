import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = window.INNOVATEX_CONFIG || {};
const configured = /^https:\/\/.+\.supabase\.co\/?$/.test(cfg.supabaseUrl || '') && !!cfg.supabaseAnonKey;
const db = configured ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { detectSessionInUrl: true } }) : null;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const date = (s) => s ? new Date(s).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'TBD';
const dateTime = (s) => s ? new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'TBD';
const initials = (s) => String(s || 'IX').split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase();
let session = null, me = null, cache = {}, page = 'home', activeProject = null, activeChannelId = null, activeThreadId = null, activeReportTarget = null, pollTimer = null, presenceTimer = null, chatTimer = null, chatRealtime = null, authReady = false, communityReady = false, enhancedReady = false, feedReady = false, dmReady = false, mediaReady = false, avatarReady = false, roleReady = false, learningReady = false, activePeerId = null, lastRenderedPage = '';
const mediaUrls = new Map();
const mediaUrl = path => path && mediaUrls.get(path)?.url || '';
async function hydrateMedia() {
  if(!mediaReady)return;
  const paths=[...(cache.profiles||[]).slice(0,150).map(p=>p.avatar_path),...[...(cache.activity_posts||[]).slice(0,80),...(cache.channel_messages||[]).slice(0,180),...(cache.direct_messages||[]).slice(0,160)].map(x=>x.image_path)].filter(Boolean);
  const missing=[...new Set(paths)].filter(p=>!mediaUrls.has(p)||mediaUrls.get(p).expires<Date.now()+60000);
  if(!missing.length)return;
  const {data,error}=await db.storage.from('club-media').createSignedUrls(missing,900);
  if(error){console.error(error);return;}
  for(const [i,item] of (data||[]).entries())if(item.signedUrl)mediaUrls.set(item.path||missing[i],{url:item.signedUrl,expires:Date.now()+900000});
}
async function uploadClubImage(file){
  if(!mediaReady)throw Error('Run the Supabase media migration before sharing images.');
  const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'}[file?.type];
  if(!ext||file.size<1||file.size>5242880)throw Error('Choose a JPG, PNG, WebP or GIF image up to 5 MB.');
  const path=`${session.user.id}/${crypto.randomUUID()}.${ext}`;
  const {error}=await db.storage.from('club-media').upload(path,file,{upsert:false,contentType:file.type});
  if(error)throw error;return path;
}
async function removeAvatar(){
  if(!session||!avatarReady)return;
  const old=me?.avatar_path;if(!old)return;
  try{
    const {error}=await db.from('profiles').update({avatar_path:null}).eq('id',session.user.id);if(error)throw error;
    me.avatar_path=null;mediaUrls.delete(old);close();await refresh();
    const removed=await db.storage.from('club-media').remove([old]);if(removed.error)console.error(removed.error);
    show('Profile photo removed.');
  }catch(error){fail(error);}
}
let pendingEmail = sessionStorage.getItem('innovatex.pendingEmail') || '';
let pendingType = sessionStorage.getItem('innovatex.pendingType') || 'member';
let pendingAuthMode = sessionStorage.getItem('innovatex.pendingAuthMode') === 'signup' ? 'signup' : 'signin';
let toastTimer;
const pages = ['home','founders','investors','investor-portal','admin','privacy','application','applications','moderation','notifications','members','messages','feed','channels','library','news','projects','discussions','courses','teaching','events','announcements','founder-room'];
const approved = () => !!me && (!('membership_status' in me) || me.membership_status==='approved');
const investor = () => approved() && me?.role==='investor';
const clubAccess = () => approved() && !investor();
const teacher = () => clubAccess() && ['teacher','admin'].includes(me?.role);
const admin = () => approved() && me?.role === 'admin';
const founder = () => approved() && ['founder','admin'].includes(me?.role);
const show = (message) => { $('#toast').textContent=message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4200); };
const button = (label,action,extra='') => `<button class="button ${extra}" data-action="${action}">${label}</button>`;
const empty = (title,body) => `<div class="empty"><strong>${esc(title)}</strong>${esc(body)}</div>`;
const head = (label,title,subtitle,action='') => `<div class="page-head"><div><span class="eyebrow">${esc(label)}</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action}</div>`;
const avatar = (name,large=false,photoPath='') => {const url=mediaUrl(photoPath);return `<span class="avatar ${large?'large':''}">${url?`<img src="${esc(url)}" alt="" loading="lazy">`:esc(initials(name))}</span>`;};
const memberAvatar = (id,large=false) => {const p=(cache.profiles||[]).find(x=>x.id===id);return avatar(p?.full_name||'Member',large,p?.avatar_path);};
const roleBadge = p => {const labels={member:'Member',teacher:'Teacher',founder:'Founder',investor:'Investor',admin:'Administrator'};const role=Object.hasOwn(labels,p?.role)?p.role:'member';return `<span class="member-badge badge-${role}" title="Approved ${esc(labels[role])} account">${labels[role]}</span>`;};
const iconPaths={home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',founders:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',privacy:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',application:'<path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/>',members:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M19 14a5 5 0 0 1 2 4v2"/>',messages:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 0 1-.9-4A8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z"/>',notifications:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',feed:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',channels:'<path d="M4 5h16v11H8l-4 4zM8 9h8M8 12h5"/>',library:'<path d="M4 4h12l4 4v12H4zM16 4v4h4M8 13h8M8 17h6"/>',news:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h4M13 12h4M7 16h10"/>',projects:'<path d="M3 7h7l2 2h9v11H3zM3 7V4h8l2 3"/>',discussions:'<path d="M4 4h16v12H8l-4 4zM8 9h8M8 12h5"/>',courses:'<path d="M3 6 12 3l9 3-9 3-9-3zM5 10v7c4 3 10 3 14 0v-7M21 7v8"/>',events:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h3"/>',announcements:'<path d="M3 10h4l12-5v14L7 14H3zM7 14l2 7h4l-2-6M21 9v6"/>','founder-room':'<path d="m12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5z"/>',applications:'<path d="M5 3h14v18H5zM8 8h8M8 13l2 2 5-5"/>',moderation:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7v6M12 17h.01"/>'};
iconPaths.investors='<path d="M3 20h18M5 16l5-5 4 3 5-7M16 7h3v3"/>';
iconPaths['investor-portal']='<path d="M3 20h18M5 16l5-5 4 3 5-7M16 7h3v3"/>';
iconPaths.admin='<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/>';
iconPaths.teaching='<path d="M3 5h18v13H3zM7 22h10M12 18v4M7 10h10M7 13h6"/>';
const iconSvg = name => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]||iconPaths.home}</svg>`;
const modal = (html) => { if($('#modal').open) $('#modal').close(); $('#modalContent').innerHTML=html; $('#modal').showModal(); };
const close = () => $('#modal').close();
const fail = (error) => { console.error(error); show(error?.message || 'Something went wrong. Please try again.'); };
const read = async (table,query=q=>q) => { const {data,error}=await query(db.from(table).select('*')); if(error) throw error; return data || []; };

async function refresh() {
  if (!db || !session) return;
  const previous=`${me?.membership_status}:${me?.role}`;
  const self=await db.from('profiles').select('*').eq('id',session.user.id).single();
  if(!self.error&&self.data)me=self.data;
  roleReady=!!me&&'application_type' in me;
  if(previous!==`${me?.membership_status}:${me?.role}`)return signedIn(session);
  if(!approved()){cache={profiles:me?[me]:[]};communityReady=false;enhancedReady=false;feedReady=false;dmReady=false;mediaReady=false;avatarReady=false;learningReady=false;mediaUrls.clear();route();return;}
  if(investor()){
    const results=await Promise.allSettled(['investor_updates','investor_inquiries'].map(n=>read(n,q=>q.order('created_at',{ascending:false}))));
    cache={profiles:[me],investor_updates:results[0].status==='fulfilled'?results[0].value:[],investor_inquiries:results[1].status==='fulfilled'?results[1].value:[]};
    communityReady=false;enhancedReady=false;feedReady=false;dmReady=false;mediaReady=false;avatarReady=false;learningReady=false;mediaUrls.clear();
    if(previous!==`${me.membership_status}:${me.role}`||!['home','founders','investors','investor-portal','privacy'].includes(page)) {route();return;}
    render();return;
  }
  const names=['profiles','projects','project_tasks','topics','replies','courses','learning_materials','events','announcements','founders','channels','documents','channel_messages','news_posts','founder_invites','founder_meetings','message_reactions','channel_reads','notifications','project_members','project_milestones','event_rsvps','founder_meeting_rsvps','document_versions','reports','audit_events','activity_posts','activity_comments','activity_likes','direct_messages','direct_message_reads','investor_updates','investor_inquiries'];
  const unordered=new Set(['channel_reads','project_members','event_rsvps','founder_meeting_rsvps']);
  const results=await Promise.allSettled(names.map(n=>read(n,q=>unordered.has(n)?q:q.order('created_at',{ascending:false}))));
  results.forEach((r,i)=>{ if(r.status==='fulfilled') cache[names[i]]=r.value; else console.error(names[i],r.reason); });
  communityReady=results[names.indexOf('channels')].status==='fulfilled';
  enhancedReady=results[names.indexOf('channel_reads')].status==='fulfilled';
  feedReady=results[names.indexOf('activity_posts')].status==='fulfilled';
  dmReady=results[names.indexOf('direct_messages')].status==='fulfilled';
  learningReady=results[names.indexOf('learning_materials')].status==='fulfilled';
  const {error:mediaError}=feedReady?await db.from('activity_posts').select('image_path').limit(1):{error:true};
  mediaReady=!mediaError;
  const {error:avatarError}=mediaReady?await db.from('profiles').select('avatar_path').eq('id',session.user.id).limit(1):{error:true};
  avatarReady=!avatarError;
  await hydrateMedia();
  if(previous!==`${me.membership_status}:${me.role}`){route();return;}
  if(page==='notifications' && document.activeElement?.closest('#content')) { render(); return; }
  if(page==='channels' && document.activeElement?.closest('#chatComposer')) { renderChatMessages(); return; }
  if(page==='messages' && document.activeElement?.closest('#dmComposer')) return;
  render();
}
async function refreshChat() {
  if(!session || !clubAccess() || !communityReady) return;
  try { cache.channel_messages=await read('channel_messages',q=>q.order('created_at',{ascending:false}).limit(250));await hydrateMedia();
    if(page==='channels') renderChatMessages();
  } catch(e) { console.error(e); }
}
async function loadPublic() {
  if (!db) return;
  try { cache.founders=await read('founders',q=>q.order('sort_order',{ascending:true})); } catch(e) { console.error(e); }
  render();
}
async function touchPresence(online=true) {
  if (!session || !db) return;
  const {error}=await db.from('profiles').update({last_seen_at:online?new Date().toISOString():null}).eq('id',session.user.id);
  if(error) console.error(error);
}
async function signedIn(newSession) {
  session=newSession;
  authReady=true;
  clearInterval(pollTimer); clearInterval(presenceTimer);
  clearInterval(chatTimer);
  if(chatRealtime) { await db.removeChannel(chatRealtime); chatRealtime=null; }
  if(session) {
    pendingEmail=''; sessionStorage.removeItem('innovatex.pendingEmail');sessionStorage.removeItem('innovatex.pendingAuthMode');
    const {data,error}=await db.from('profiles').select('*').eq('id',session.user.id).single();
    if(error) { fail(error); return; }
    me=data;
    roleReady='application_type' in me;
    if(roleReady){
      if(!approved()&&['pending','rejected'].includes(me.membership_status)&&sessionStorage.getItem('innovatex.pendingType')){
        const {error:typeError}=await db.rpc('set_application_type',{p_type:pendingType});
        if(typeError)fail(typeError);else me.application_type=pendingType;
      }
      sessionStorage.removeItem('innovatex.pendingType');pendingType='member';
    }
    if(approved())await touchPresence();
    await refresh();
    pollTimer=setInterval(refresh,30000);
    if(approved()){
      presenceTimer=setInterval(()=>touchPresence(),20000);
      if(clubAccess())chatTimer=setInterval(refreshChat,9000);
    }
    if(communityReady && clubAccess()) chatRealtime=db.channel('innovatex-chat')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'channel_messages'},refreshChat).subscribe();
  } else { me=null;roleReady=false;cache={};mediaUrls.clear(); if(!['home','founders','investors'].includes(page)) page='home'; await loadPublic(); }
  if(session&&!approved()&&!['application','privacy'].includes(page)){page='application';history.replaceState(null,'','#application');}
  if(investor()&&!['home','founders','investors','investor-portal','privacy'].includes(page)){page='investor-portal';history.replaceState(null,'','#investor-portal');}
  if(page==='founder-room'&&!founder()) {page='founders';history.replaceState(null,'','#founders');}
  render();
}
async function init() {
  document.querySelectorAll('#nav a[data-page]').forEach(a=>{const slot=a.querySelector('span');if(slot)slot.innerHTML=iconSvg(a.dataset.page);});
  let savedTheme='';try{savedTheme=localStorage.getItem('innovatex.theme')||'';}catch{}
  document.documentElement.dataset.theme=savedTheme==='dark'?'dark':'light';
  $('#themeButton').onclick=()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('innovatex.theme',next);}catch{}updateThemeButton();};
  updateThemeButton();
  $('#todayLabel').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  $('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');
  $('#modal').addEventListener('click',e=>{ if(e.target===$('#modal')) close(); });
  $('.modal-close').onclick=close;
  window.addEventListener('hashchange',route);
  $('#authButton').onclick=()=>session ? signOut() : signInDialog();
  document.addEventListener('click',actions);
  document.addEventListener('submit',submit);
  document.addEventListener('input',e=>{if(e.target.id==='dmFilter'){const term=e.target.value.toLowerCase();document.querySelectorAll('.dm-peer').forEach(b=>b.hidden=!b.textContent.toLowerCase().includes(term));}});
  document.addEventListener('change',e=>{if(['chat_image','dm_image'].includes(e.target.name)){const label=$(e.target.name==='chat_image'?'#chatImageName':'#dmImageName');if(label){label.textContent=e.target.files?.[0]?.name||'';label.hidden=!e.target.files?.length;}}});
  route();
  if(!db) return;
  db.auth.onAuthStateChange((_event,s)=>{ if(s?.user.id !== session?.user.id) setTimeout(()=>signedIn(s),0); });
  const {data,error}=await db.auth.getSession();
  if(error) fail(error); else await signedIn(data.session);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && session) {touchPresence();refresh();} });
  window.addEventListener('pagehide',()=>{ if(session) touchPresence(false); });
}
function updateThemeButton(){const dark=document.documentElement.dataset.theme==='dark';$('#themeButton').textContent=dark?'☀':'☾';$('#themeButton').setAttribute('aria-label',dark?'Switch to light theme':'Switch to dark theme');}
function route() {
  const requested=location.hash.slice(1).split('/')[0] || 'home';page=pages.includes(requested)?requested:'home';
  if(!session&&(authReady||!configured)&&!['home','founders','investors','privacy'].includes(page)){page='home';history.replaceState(null,'','#home');show('Sign in to open the workspace.');}
  if(session&&!approved()&&!['application','privacy'].includes(page)){page='application';history.replaceState(null,'','#application');}
  if(investor()&&!['home','founders','investors','investor-portal','privacy'].includes(page)){page='investor-portal';history.replaceState(null,'','#investor-portal');}
  if(page==='investor-portal'&&authReady&&!investor()&&!admin()){page='investors';history.replaceState(null,'','#investors');}
  if(page==='teaching'&&authReady&&!teacher()){page=clubAccess()?'courses':'home';history.replaceState(null,'','#'+page);}
  if(page==='founder-room'&&authReady&&!founder()){page='founders';history.replaceState(null,'','#founders');show('Founder access required.');}
  if(['admin','applications','moderation'].includes(page)&&authReady&&!admin()){page='home';history.replaceState(null,'','#home');}
  $('#sidebar').classList.remove('open');render();
}
function render() {
  $('#authButton').textContent=session?'Sign out':'Join / sign in';
  $('#connectionLabel').textContent=!configured?'Setup required':session&&!approved()?'Application pending':investor()?'Investor portal live':session?'Member workspace live':'Public preview';
  $('#accountBadge').hidden=!approved();$('#accountBadge').innerHTML=approved()?roleBadge(me):'';
  $('#pageCrumb').textContent=page==='founder-room'?'Founder room':page[0].toUpperCase()+page.slice(1);
  document.querySelectorAll('#nav a').forEach(a=>{a.classList.toggle('active',a.dataset.page===page);a.hidden=!!a.dataset.private&&!clubAccess();});
  document.querySelectorAll('#nav [data-founder]').forEach(a=>a.hidden=!founder());
  document.querySelectorAll('#nav [data-investors-nav]').forEach(a=>a.hidden=!founder());
  document.querySelectorAll('#nav [data-teacher]').forEach(a=>a.hidden=!teacher());
  document.querySelectorAll('#nav [data-investor]').forEach(a=>a.hidden=!investor()&&!admin());
  document.querySelectorAll('#nav [data-admin]').forEach(a=>a.hidden=!admin());
  document.querySelectorAll('#nav [data-pending]').forEach(a=>a.hidden=!session||approved());
  document.querySelectorAll('#nav .nav-group:not([data-admin])').forEach(a=>a.hidden=!clubAccess());
  const online=(cache.profiles||[]).filter(p=>p.last_seen_at&&Date.now()-new Date(p.last_seen_at).getTime()<65000).length;
  $('#onlineBadge').textContent=online;
  $('#notificationBadge').textContent=(cache.notifications||[]).filter(n=>!n.read_at).length;
  const unreadDm=(cache.direct_messages||[]).filter(m=>m.recipient_id===session?.user.id&&(!((cache.direct_message_reads||[]).find(r=>r.peer_id===m.sender_id))||new Date(m.created_at)>new Date((cache.direct_message_reads||[]).find(r=>r.peer_id===m.sender_id).last_read_at))).length;
  $('#dmBadge').textContent=unreadDm;$('#dmBadge').hidden=!unreadDm;
  const views={home,founders,investors,'investor-portal':investorPortal,admin:adminDashboard,privacy,application,applications,moderation,notifications,members,messages,feed,channels,library,news,projects,discussions,courses,teaching,events,announcements,'founder-room':founderRoom};
  $('#content').innerHTML=views[page]();
  $('#content').classList.toggle('view-enter',page!==lastRenderedPage);lastRenderedPage=page;
  if(page==='channels'){const stream=$('#messageStream');if(stream)stream.scrollTop=stream.scrollHeight;if(activeChannelId&&enhancedReady)markChannelRead(activeChannelId);}
  if(page==='messages'){const stream=$('#dmStream');if(stream)stream.scrollTop=stream.scrollHeight;if(activePeerId&&dmReady)markDmRead(activePeerId);}
}
function home() {
  if(investor())return `${head('INNOVATEX PARTNERS','Welcome, '+(me?.full_name||'investor'),'Your approved investor space brings together curated updates and a direct inquiry form.')}<div class="grid grid-2"><a class="card feature-card" href="#investor-portal"><span class="feature-icon">${iconSvg('investors')}</span><h3>Investor portal</h3><p>Read updates the club has approved for investors and send a question to the team.</p><span class="link">Open portal →</span></a><a class="card feature-card" href="#founders"><span class="feature-icon">${iconSvg('founders')}</span><h3>Meet the founders</h3><p>Learn about the people guiding InnovateX.</p><span class="link">View founders →</span></a></div>`;
  const count=n=>(cache[n]||[]).length;
  const latest=(cache.announcements||[]).slice(0,3);
  const upcoming=(cache.events||[]).filter(e=>new Date(e.starts_at)>new Date()).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)).slice(0,3);
  return `<section class="hero"><div class="hero-copy"><span class="eyebrow">THE ENGINEERING COMMUNITY AT TTU</span><h1>Ideas become<br>working systems.</h1><p>Learn control, automation, electronics, software and robotics. Build prototypes together and prepare for regional and national competitions.</p><div class="hero-actions">${session?`<a class="button" href="#projects">Explore projects ↗</a>`:button('Join the workspace ↗','login')}<a class="button button-outline" href="#founders">Meet the founders</a></div></div><div class="hero-graphic">IX✦</div></section>
  <div class="section-heading"><div><span class="eyebrow">CLUB PULSE</span><h2>${session?'Your workspace at a glance':'Built for makers and innovators'}</h2></div><p>${session?`Welcome back, ${esc(me?.full_name||session.user.email)}.`:'An alumni initiated, student led engineering community.'}</p></div>
  <div class="grid grid-4"><div class="stat"><small>Members</small><b>${session?count('profiles'):'—'}</b><span>Across disciplines</span></div><div class="stat"><small>Online now</small><b>${session?(cache.profiles||[]).filter(p=>p.last_seen_at&&Date.now()-new Date(p.last_seen_at).getTime()<65000).length:'—'}</b><span>Active in the last minute</span></div><div class="stat"><small>Active projects</small><b>${session?count('projects'):'—'}</b><span>Ideas in motion</span></div><div class="stat"><small>Upcoming events</small><b>${session?upcoming.length:'—'}</b><span>Sessions and meetups</span></div></div>
  <div class="section-heading"><div><span class="eyebrow">OUR MISSION</span><h2>From the workbench to the world.</h2></div></div><div class="grid grid-3">${[['courses','Learn','Hands-on courses in Arduino, Proteus, CAD, OpenPLC and electrical systems.'],['projects','Build','Plan and test real prototypes with multidisciplinary teams and mentors.'],['founder-room','Compete','Turn the strongest projects into competition-ready demonstrations.']].map(x=>`<div class="card mission-card"><div class="icon-box">${iconSvg(x[0])}</div><h3>${x[1]}</h3><p>${x[2]}</p></div>`).join('')}</div>
  <section class="studio-banner"><img src="assets/robotics-workbench.webp" alt="Concept artwork of hands assembling a robotics prototype" loading="lazy"><div><span class="eyebrow">ENGINEERING INSPIRATION · CONCEPT ARTWORK</span><h2>Make something that works.</h2><p>Find your team, share your next test and turn a good idea into a working prototype.</p><a class="button" href="${session?'#projects':'#founders'}">${session?'Explore club projects':'Discover the club'} →</a></div></section>
  ${session?`<div class="section-heading"><h2>Your community</h2><p>Find a conversation or share what you’re learning.</p></div><div class="grid grid-4"><a class="card feature-card" href="#feed"><span class="feature-icon">${iconSvg('feed')}</span><h3>Activity feed</h3><p>Share progress and hear from club members.</p><span class="link">Open feed →</span></a><a class="card feature-card" href="#channels"><span class="feature-icon">${iconSvg('channels')}</span><h3>Member channels</h3><p>Get help and work through ideas together.</p><span class="link">Open channels →</span></a><a class="card feature-card" href="#library"><span class="feature-icon">${iconSvg('library')}</span><h3>Document library</h3><p>Notes, schematics and useful resources in one place.</p><span class="link">Browse files →</span></a><a class="card feature-card" href="#news"><span class="feature-icon">${iconSvg('news')}</span><h3>Technology news</h3><p>Discover engineering stories worth discussing.</p><span class="link">Read stories →</span></a></div>`:''}
  ${session?`<div class="section-heading"><h2>What’s happening</h2><a class="link" href="#events">View calendar →</a></div><div class="split"><div class="panel"><h3>Latest alerts</h3>${latest.length?latest.map(a=>`<div class="list-item"><span class="icon-box" style="margin:0">◈</span><div><strong>${esc(a.title)}</strong><small>${date(a.created_at)}</small><p class="subtle">${esc(a.body)}</p></div></div>`).join(''):empty('No alerts yet','Official club updates will appear here.')}</div><div class="panel"><h3>Coming up</h3>${upcoming.length?upcoming.map(e=>eventRow(e)).join(''):empty('Nothing scheduled','The next club event will appear here.')}</div></div>`:''}`;
}
function founders() {
  const list=cache.founders||[];
  return `${head('THE PEOPLE BEHIND THE IDEA','Founding team','A four-person team shaping InnovateX with student leaders and university guidance.',admin()?button('+ Add founder','founderForm'):'')}
  <div class="notice">Founder profiles are added only after each person agrees to be listed. The Dean of Students’ Affairs has been invited to serve as patron; patronage is pending acceptance.</div>
  <div class="founder-invite-banner"><div><span class="eyebrow">FOUNDER ACCESS</span><h3>Build the club together.</h3><p>Administrators approve founder applications. Accepted founders can plan together and meet in a private room.</p></div>${founder()?`<a class="button" href="#founder-room">Open founder room →</a>`:!session?button('Apply as founder','login'):''}</div>
  <div class="section-heading"><h2>Meet the founders</h2></div><div class="grid grid-4">${list.length?list.map(f=>`<div class="card founder-card">${avatar(f.name,true)}<div class="role">${esc(f.role)}</div><h3>${esc(f.name)}</h3><p>${esc(f.bio||'Founding team member')}</p>${f.link_url?`<a class="link" target="_blank" rel="noopener noreferrer" href="${esc(cleanUrl(f.link_url))}">Profile ↗</a>`:''}</div>`).join(''):[1,2,3,4].map((n)=>`<div class="card founder-card">${avatar('IX',true)}<div class="role">Founding member ${n}</div><h3>Profile coming soon</h3><p>We’ll introduce each founder after the team confirms their details.</p></div>`).join('')}</div><div class="section-heading"><h2>How the club is led</h2></div><div class="grid grid-3"><div class="card"><h3>Student executive</h3><p>Elected students lead training, projects, communications and finance.</p></div><div class="card"><h3>Founding advisers</h3><p>Founders help with continuity, mentoring and partnerships.</p></div><div class="card"><h3>Proposed patron</h3><p>The Dean of Students’ Affairs has been invited to guide the club, subject to acceptance.</p></div></div>`;
}
function investors(){
  return `${head('PARTNER WITH INNOVATEX','Investors & partners','Explore how engineering ideas become useful prototypes through a student-led community.')}
  <div class="founder-invite-banner"><div><span class="eyebrow">INVESTOR ACCESS</span><h3>See the work behind the vision.</h3><p>Apply as an investor with your verified email. An administrator reviews each application before access is granted.</p></div>${investor()||admin()?`<a class="button" href="#investor-portal">Open investor portal →</a>`:!session?button('Apply as investor','login'):''}</div>
  <div class="section-heading"><h2>What partners can explore</h2></div><div class="grid grid-3"><div class="card"><div class="icon-box">${iconSvg('projects')}</div><h3>Project milestones</h3><p>Updates selected for investors by the club leadership.</p></div><div class="card"><div class="icon-box">${iconSvg('events')}</div><h3>Demonstrations</h3><p>Progress toward showcases, competitions and collaboration.</p></div><div class="card"><div class="icon-box">${iconSvg('messages')}</div><h3>Direct inquiries</h3><p>Send a question or partnership idea to administrators in the private portal.</p></div></div><p class="subtle" style="margin-top:20px">No investment terms or funding claims are published here. Opportunities require a conversation with the team.</p>`;
}
function investorPortal(){
  if(!investor()&&!admin())return '';
  if(!roleReady)return head('PARTNERS','Investor portal','Run the roles and investors migration to enable this page.')+communityNotice();
  const updates=(cache.investor_updates||[]).filter(u=>u.published||admin());
  const inquiries=cache.investor_inquiries||[];
  return `${head('PARTNERS','Investor portal','Curated club milestones and private conversations with the administration.',admin()?button('+ Publish update','investorUpdateForm'):button('Send an inquiry','investorInquiryForm'))}
  <div class="notice">Only approved investors and administrators can read published investor updates. Inquiries are visible to their sender and administrators.</div>
  <div class="section-heading"><h2>Updates</h2><p>${updates.length} curated ${updates.length===1?'update':'updates'}</p></div><div class="grid grid-2">${updates.length?updates.map(u=>`<article class="card investor-update"><div class="row"><span class="tag blue">${esc(u.category)}</span><small class="subtle">${date(u.published_at)}</small></div><h3>${esc(u.title)}</h3><p>${esc(u.summary)}</p>${admin()?`<div class="card-footer"><span>${u.published?'Published':'Draft'}</span><button class="text-button" data-action="toggleInvestorUpdate" data-id="${esc(u.id)}">${u.published?'Unpublish':'Publish'}</button></div>`:''}</article>`).join(''):empty('Updates coming soon','Administrators will publish reviewed project milestones here.')}</div>
  <div class="section-heading"><h2>${admin()?'Investor inquiries':'My inquiries'}</h2></div><div class="grid">${inquiries.length?inquiries.map(q=>`<div class="card"><div class="row"><span class="tag ${q.status==='new'?'gold':''}">${esc(q.status)}</span><small class="subtle">${dateTime(q.created_at)}</small></div><h3>${esc(q.subject)}</h3><p class="profile-bio">${esc(q.message)}</p><div class="card-footer"><span>${admin()?esc(memberName(q.investor_id)):'Sent to the club administrators'}</span>${admin()&&q.status==='new'?`<button class="text-button" data-action="reviewInquiry" data-id="${esc(q.id)}">Mark reviewed</button>`:''}</div></div>`).join(''):empty('No inquiries yet','Investor questions will appear here.')}</div>`;
}
function members() {
  const people=(cache.profiles||[]).filter(p=>(!('membership_status' in p)||p.membership_status==='approved')&&p.role!=='investor'); const online=p=>p.last_seen_at&&Date.now()-new Date(p.last_seen_at).getTime()<65000;
  const invite=(cache.founder_invites||[]).find(i=>i.email===session?.user.email?.toLowerCase()&&!i.accepted_at);
  return `${head('COMMUNITY','Members','See who is around and connect with the people building InnovateX.',`<div class="profile-buttons">${avatarReady?button('Change photo','avatarForm','button-outline'):''}${button('Edit my profile','profileForm')}</div>`)}
  ${invite?`<div class="founder-invite-banner"><div><span class="eyebrow">FOUNDER INVITATION</span><h3>You’ve been invited to join the founding team.</h3><p>Accept with your verified account to open founder meetings and planning.</p></div>${button('Accept invitation','acceptFounder')}</div>`:''}
  <div class="grid grid-4"><div class="stat"><small>Registered members</small><b>${people.length}</b><span>Club workspace</span></div><div class="stat"><small>Online now</small><b>${people.filter(online).length}</b><span>Seen within 65 seconds</span></div></div><div class="section-heading"><h2>Member directory</h2><p>Presence updates while the workspace is open.</p></div><div class="profile-grid">${people.length?people.sort((a,b)=>Number(online(b))-Number(online(a))).map(p=>`<div class="card person">${memberAvatar(p.id)}<div><h3>${esc(p.full_name||'New member')}</h3>${roleBadge(p)}<p class="subtle">${esc(p.headline||p.programme||'Member')}</p></div>${online(p)?'<span class="online-dot" title="Online"></span>':''}<button class="text-button" data-action="memberProfile" data-id="${esc(p.id)}">Profile</button></div>`).join(''):empty('No members yet','Member profiles will appear after signup.')}</div>`;
}
function memberProfile(id) {
  const p=(cache.profiles||[]).find(x=>x.id===id&&x.membership_status==='approved'&&x.role!=='investor');if(!p)return;
  const online=p.last_seen_at&&Date.now()-new Date(p.last_seen_at)<65000;
  modal(`<div class="member-profile-hero">${memberAvatar(p.id,true)}<span class="tag ${online?'':'blue'}">${online?'Online':esc(p.availability||'Member')}</span></div><h2>${esc(p.full_name)}</h2>${roleBadge(p)}<p class="profile-headline">${esc(p.headline||p.programme||'Club member')}</p><p class="subtle">${p.handle?'@'+esc(p.handle)+' · ':''}${esc(p.programme||'InnovateX Engineering Club')}</p><div class="profile-facts"><div><small>Role</small><strong>${esc(p.role)}</strong></div><div><small>Availability</small><strong>${esc(p.availability||'Available')}</strong></div><div><small>Joined</small><strong>${date(p.created_at)}</strong></div></div><h3>About</h3><p class="profile-bio">${esc(p.bio||'This member has not added a bio yet.')}</p><h3>Skills & interests</h3><p>${esc(p.skills||'Not listed yet.')}</p><div class="profile-buttons">${p.id===session?.user.id?`${avatarReady?button('Change photo','avatarForm','button-outline'):''}${button('Edit my profile','profileForm')}`:dmReady?`<button class="button" data-action="openDm" data-id="${esc(p.id)}">Message ${esc(p.full_name.split(' ')[0])} →</button>`:''}</div>`);
}
function messages() {
  if(!dmReady)return head('MEMBER CONNECTIONS','Direct messages','Private conversations with club members.')+communityNotice();
  const people=(cache.profiles||[]).filter(p=>p.id!==session.user.id&&p.membership_status==='approved'&&p.role!=='investor');
  const history=cache.direct_messages||[];
  const peers=new Set(history.map(m=>m.sender_id===session.user.id?m.recipient_id:m.sender_id));
  const ordered=people.slice().sort((a,b)=>Number(peers.has(b.id))-Number(peers.has(a.id))||a.full_name.localeCompare(b.full_name));
  const peer=people.find(p=>p.id===activePeerId);
  const thread=peer?history.filter(m=>(m.sender_id===session.user.id&&m.recipient_id===peer.id)||(m.recipient_id===session.user.id&&m.sender_id===peer.id)).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)):[];
  return `${head('MEMBER CONNECTIONS','Direct messages','Discuss a project with another approved club member.')}
    <div class="dm-layout"><div class="dm-list"><div class="dm-heading">Members <span>${people.length}</span></div><div class="dm-search"><label class="sr-only" for="dmFilter">Find a member</label><input id="dmFilter" placeholder="Find a member"></div>${ordered.map(p=>{const last=history.filter(m=>m.sender_id===p.id||m.recipient_id===p.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];const seen=(cache.direct_message_reads||[]).find(r=>r.peer_id===p.id)?.last_read_at;const unread=history.filter(m=>m.sender_id===p.id&&(!seen||new Date(m.created_at)>new Date(seen))).length;return `<button class="dm-peer ${p.id===activePeerId?'selected':''}" data-action="openDm" data-id="${esc(p.id)}">${memberAvatar(p.id)}<span><strong>${esc(p.full_name)}</strong><small>${esc(last?.body||p.headline||p.programme||'Start a conversation')}</small></span>${unread?`<i class="unread-badge">${unread}</i>`:''}</button>`}).join('')||empty('No other members','Approved members will appear here.')}</div>
    <div class="dm-conversation">${peer?`<div class="chat-head"><div><h2>${esc(peer.full_name)}</h2><p>${esc(peer.headline||peer.programme||'Club member')}</p></div><button class="text-button" data-action="memberProfile" data-id="${esc(peer.id)}">View profile</button></div><div id="dmStream" class="dm-stream">${thread.length?thread.map(m=>{const photo=mediaUrl(m.image_path);return `<div class="dm-bubble ${m.sender_id===session.user.id?'mine':''}">${m.sender_id!==session.user.id?memberAvatar(peer.id):''}<div><p>${esc(m.body)}</p>${photo?`<a href="${esc(photo)}" target="_blank" rel="noopener noreferrer" aria-label="Open private image"><img class="dm-photo" src="${esc(photo)}" loading="lazy" alt="Image shared in this conversation"></a>`:''}<small>${dateTime(m.created_at)}</small></div></div>`}).join(''):empty('Start a conversation','Send a message about a club project or upcoming event.')}</div><form id="dmComposer" class="chat-composer">${mediaReady?`<label class="gallery-picker" title="Choose an image from your gallery">▧<span class="sr-only">Choose image</span><input name="dm_image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>`:''}<label class="sr-only" for="dmBody">Message</label><input id="dmBody" name="body" maxlength="3000" placeholder="Message ${esc(peer.full_name)}" ${mediaReady?'':'required'} autocomplete="off"><button class="button" type="submit">Send ↗</button>${mediaReady?`<span id="dmImageName" class="chat-image-name" hidden></span>`:''}</form>`:empty('Choose a member','Select someone to start a private conversation.')}</div></div>`;
}
async function markDmRead(peerId) {
  if(!dmReady||!session||!peerId)return;
  const stamp=new Date().toISOString();try{const {error}=await db.from('direct_message_reads').upsert({user_id:session.user.id,peer_id:peerId,last_read_at:stamp},{onConflict:'user_id,peer_id'});if(error)throw error;cache.direct_message_reads=(cache.direct_message_reads||[]).filter(r=>r.peer_id!==peerId).concat({user_id:session.user.id,peer_id:peerId,last_read_at:stamp});$('#dmBadge').textContent=(cache.direct_messages||[]).filter(m=>m.recipient_id===session.user.id&&(!((cache.direct_message_reads||[]).find(r=>r.peer_id===m.sender_id))||new Date(m.created_at)>new Date((cache.direct_message_reads||[]).find(r=>r.peer_id===m.sender_id).last_read_at))).length;}catch(e){console.error(e);}
}
function projects() {
  const list=cache.projects||[];
  return `${head('BUILD TOGETHER','Projects','Plan prototypes, track work and move ideas toward the next demonstration.',button('+ New project','projectForm'))}
  <div class="grid grid-3">${list.length?list.map(p=>`<div class="card"><div class="row"><span class="tag ${p.status==='complete'?'blue':p.status==='planning'?'gold':''}">${esc(p.status)}</span><span class="subtle">${date(p.created_at)}</span></div><h3 style="margin-top:17px">${esc(p.title)}</h3><p>${esc(p.summary||'No summary yet.')}</p><div class="progress"><span style="width:${Math.max(0,Math.min(100,Number(p.progress)||0))}%"></span></div><div class="card-footer"><span>${esc(p.progress)}% complete</span><button class="text-button" data-action="projectDetail" data-id="${esc(p.id)}">Open plan →</button></div></div>`).join(''):empty('No projects yet','Start the first prototype plan.')}</div>`;
}
function discussions() {
  const list=cache.topics||[];
  return `${head('SHARE IDEAS','Discussions','Ask questions, debate designs and keep decisions visible.',button('+ New discussion','topicForm'))}<div class="grid">${list.length?list.map(t=>{const replies=(cache.replies||[]).filter(r=>r.topic_id===t.id),project=(cache.projects||[]).find(p=>p.id===t.project_id);return `<div class="card topic"><div class="row"><span class="tag">${esc(t.category||'General')}</span><span class="subtle">${date(t.created_at)}</span></div><h3>${esc(t.title)}</h3>${project?`<small class="muted">Project: ${esc(project.title)}</small>`:''}<p>${esc(t.body)}</p><div class="card-footer"><span>${replies.length} replies</span><button class="text-button" data-action="topicDetail" data-id="${esc(t.id)}">Read discussion →</button></div></div>`}).join(''):empty('Start the conversation','Your first discussion could be a workshop idea or a prototype challenge.')}</div>`;
}
function courses() {
  const list=cache.courses||[];
  const materials=learningReady?(cache.learning_materials||[]).filter(m=>!m.hidden_at):[];
  return `${head('LEARN BY DOING','Courses','Workshops, learning materials and slides for approved club members.',teacher()?`<div class="profile-buttons">${button('+ Publish course','courseForm')}${button('+ Upload material','learningForm','button-outline')}</div>`:'')}
  <div class="grid grid-3">${list.length?list.map(c=>`<div class="card"><span class="tag blue">${esc(c.level)}</span><h3 style="margin-top:18px">${esc(c.title)}</h3><p>${esc(c.description||'Details coming soon.')}</p><div class="pill-row"><span class="subtle">${esc(c.category)}</span></div>${materials.filter(m=>m.course_id===c.id).map(materialRow).join('')}<div class="card-footer"><span>${date(c.starts_at)}</span>${c.resource_url?`<a class="link" href="${esc(cleanUrl(c.resource_url))}" target="_blank" rel="noopener noreferrer">Resource link ↗</a>`:''}</div></div>`).join(''):empty('Courses are being prepared','The teaching team will publish workshops here.')}</div>
  ${materials.some(m=>!m.course_id)?`<div class="section-heading"><h2>Club learning library</h2></div><div class="grid grid-2">${materials.filter(m=>!m.course_id).map(m=>`<div class="card">${materialRow(m)}</div>`).join('')}</div>`:''}`;
}
function materialRow(m){return `<div class="learning-row"><span class="tag blue">${esc(m.kind)}</span><div><strong>${esc(m.title)}</strong><small>${esc(m.file_name)} · ${fileSize(m.file_size)} · ${date(m.created_at)}</small>${m.description?`<p>${esc(m.description)}</p>`:''}</div>${m.hidden_at?'<span class="tag gold">Hidden</span>':`<button class="text-button" data-action="downloadLearning" data-id="${esc(m.id)}">Download ↓</button>`}</div>`;}
function teaching(){
  if(!teacher())return '';
  if(!learningReady)return head('TEACHING','Teaching studio','Upload slides and learning materials.')+communityNotice();
  const items=(cache.learning_materials||[]).filter(m=>admin()||m.uploaded_by===session.user.id);
  return `${head('TEACHING','Teaching studio','Share notes, presentations and guides with approved club members.',button('+ Upload material','learningForm'))}
  <div class="notice">Only approved teachers and administrators can publish learning files. Approved club members can download visible materials.</div>
  <div class="section-heading"><h2>${admin()?'All learning materials':'Materials I uploaded'}</h2><p>PDF, PPT, PPTX, DOC or DOCX · up to 20 MB</p></div><div class="grid grid-2">${items.length?items.map(m=>`<div class="card teaching-card">${materialRow(m)}<div class="card-footer"><span>${m.course_id?esc((cache.courses||[]).find(c=>c.id===m.course_id)?.title||'Course'):'General learning library'} · ${esc(memberName(m.uploaded_by))}</span>${admin()?`<button class="text-button" data-action="toggleLearning" data-id="${esc(m.id)}">${m.hidden_at?'Restore':'Hide'}</button>`:''}</div></div>`).join(''):empty('No materials yet','Upload a presentation, lesson notes or a guide to begin.')}</div>`;
}
function eventRow(e) {return `<div class="list-item"><div class="event-date"><b>${new Date(e.starts_at).getDate()}</b><small>${new Date(e.starts_at).toLocaleString(undefined,{month:'short'})}</small></div><div><strong>${esc(e.title)}</strong><small>${dateTime(e.starts_at)} · ${esc(e.location||'Online')}</small></div></div>`;}
function rsvpControls(kind,id) {
  if(!enhancedReady)return '';
  const list=kind==='meeting'?cache.founder_meeting_rsvps:cache.event_rsvps;
  const key=kind==='meeting'?'meeting_id':'event_id';
  const responses=(list||[]).filter(r=>r[key]===id);
  const mine=responses.find(r=>r.user_id===session?.user.id)?.response;
  return `<div class="rsvp-controls"><span class="subtle">${responses.filter(r=>r.response==='going').length} going</span>${[['going','Going'],['maybe','Maybe'],['not_going','Can’t go']].map(([value,label])=>`<button class="rsvp-button ${mine===value?'selected':''}" data-action="rsvp" data-kind="${kind}" data-response="${value}" data-id="${esc(id)}">${label}</button>`).join('')}</div>`;
}
function events() {
  const list=(cache.events||[]).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  return `${head('MAKE TIME TO BUILD','Events calendar','Workshops, project reviews, club meetings and demo days.',admin()?button('+ Schedule event','eventForm'):'')}
  <div class="grid grid-2">${list.length?list.map(e=>`<div class="card"><div class="row"><span class="tag ${new Date(e.starts_at)<new Date()?'gold':''}">${new Date(e.starts_at)<new Date()?'Past event':'Upcoming'}</span><span class="subtle">${dateTime(e.starts_at)}</span></div><h3 style="margin-top:18px">${esc(e.title)}</h3><p>${esc(e.description||'')}</p><div class="meta"><span>◷ ${dateTime(e.starts_at)}</span><span>⌁ ${esc(e.location||'Online')}</span></div>${rsvpControls("event",e.id)}<div class="card-footer"><div>${e.meet_url?`<a class="link" href="${esc(cleanUrl(e.meet_url))}" target="_blank" rel="noopener noreferrer">Join Google Meet ↗</a>`:''}</div><div>${admin()&&!e.meet_url?`<button class="text-button" data-action="createMeet" data-kind="event" data-id="${esc(e.id)}">Create Meet</button> · `:''}<button class="text-button" data-action="calendar" data-id="${esc(e.id)}">Add to calendar</button> · <button class="text-button" data-action="ics" data-id="${esc(e.id)}">ICS</button></div></div></div>`).join(''):empty('No events yet','Events will appear here when the team sets the schedule.')}</div>`;
}
function announcements() {
  const list=cache.announcements||[];
  return `${head('STAY INFORMED','Club alerts','Important updates, deadlines and opportunities.',admin()?button('+ Post alert','announcementForm'):'')}
  <div class="grid">${list.length?list.map(a=>`<div class="card"><div class="row"><span class="tag ${a.priority==='urgent'?'gold':''}">${esc(a.priority)}</span><span class="subtle">${date(a.created_at)}</span></div><h3 style="margin-top:15px">${esc(a.title)}</h3><p class="detail">${esc(a.body)}</p></div>`).join(''):empty('No alerts yet','Official updates will appear here.')}</div>`;
}

function privacy() {
  return `${head('CLUB TRUST','Privacy & conduct','How the InnovateX workspace should be used.')}
  <div class="grid grid-2"><div class="card"><h3>Who can see your information?</h3><p>Your name, headline, bio, programme, skills, project activity and approximate online status are visible to approved club members. Direct messages are visible to their two participants. Founder bios are public only after an administrator publishes them with consent. Founder meetings are restricted to accepted founders and administrators.</p></div>
  <div class="card"><h3>What can you share?</h3><p>Share work you have permission to distribute. Do not upload passwords, private student records, personal contact lists or copyrighted files without permission. Files in the club library are available to all approved members.</p></div>
  <div class="card"><h3>Community conduct</h3><p>Keep feedback constructive and relevant to engineering work. Credit sources and collaborators. Use the Report button when a message, article or document needs administrator review.</p></div>
  <div class="card"><h3>Accounts and decisions</h3><p>New members apply for approval after verifying their email. Administrators can approve, reject or suspend membership. For account or data removal, contact a club administrator; an automated deletion request flow is not yet available.</p></div></div>`;
}
function feed() {
  if(!feedReady)return head('CLUB COMMUNITY','Activity feed','Member projects, questions and progress.')+communityNotice();
  const posts=(cache.activity_posts||[]).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const updates=[...(cache.announcements||[]).map(a=>({title:a.title,at:a.created_at,kind:'Alert',page:'announcements'})),...posts.map(p=>({title:p.title||memberName(p.author_id)+' shared an update',at:p.created_at,kind:'Post',id:p.id}))].sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,6);
  const recentNews=(cache.news_posts||[]).filter(n=>n.status==='published').slice(0,5);
  const people=(cache.profiles||[]).filter(p=>p.membership_status==='approved'&&p.role!=='investor'&&p.last_seen_at).sort((a,b)=>new Date(b.last_seen_at)-new Date(a.last_seen_at)).slice(0,10);
  return `${head('COMMUNITY PULSE','Activity feed','Share builds, ask for feedback and follow what members are creating.')}
  <div class="feed-layout">
    <aside class="feed-rail"><section class="card feed-side"><div class="row"><h2>Recent stories</h2><a class="link" href="#news">See all</a></div>${recentNews.length?recentNews.map(n=>`<a class="feed-story" href="${esc(cleanUrl(n.url))}" target="_blank" rel="noopener noreferrer"><span class="feed-story-icon">◈</span><span><strong>${esc(n.title)}</strong><small>${esc(n.category)}</small></span></a>`).join(''):empty('No stories yet','Share a technology article for review.')}</section><section class="card feed-side"><h2>Explore together</h2><p>Find the right space for a deeper discussion.</p><a class="feed-shortcut" href="#projects">▥ &nbsp; Project plans →</a><a class="feed-shortcut" href="#channels">▣ &nbsp; Member channels →</a><a class="feed-shortcut" href="#events">▦ &nbsp; Club events →</a></section></aside>
    <section class="feed-main" aria-label="Member posts"><div class="card feed-composer">${memberAvatar(session.user.id)}<button class="feed-composer-prompt" data-action="feedPostForm">What are you building, ${esc(me?.full_name?.split(' ')[0]||'member')}?</button>${button('Share update','feedPostForm','button-sm')}</div><div class="feed-posts">${posts.length?posts.map(feedPostCard).join(''):empty('Start the conversation','Share a project milestone, question or useful resource with the club.')}</div></section>
    <aside class="feed-rail"><section class="card feed-side"><h2>Latest updates</h2>${updates.length?updates.map(u=>`<div class="feed-update"><span class="feed-update-mark">${u.kind==='Alert'?'◈':'▧'}</span><div>${u.id?`<button class="text-button" data-action="jumpPost" data-id="${esc(u.id)}">${esc(u.title)}</button>`:`<a class="link" href="#${esc(u.page)}">${esc(u.title)}</a>`}<small>${dateTime(u.at)} · ${esc(u.kind)}</small></div></div>`).join(''):empty('No updates yet','New activity appears here.')}</section><section class="card feed-side"><h2>Recently active members</h2><div class="feed-people">${people.length?people.map(p=>`<div class="feed-person" title="${esc(p.full_name)}">${memberAvatar(p.id)}<span>${esc(p.full_name)}</span>${Date.now()-new Date(p.last_seen_at)<65000?'<i class="online-dot"></i>':''}</div>`).join(''):empty('No recent activity','Members appear here after signing in.')}</div><a class="link" href="#members">View directory →</a></section></aside>
  </div>`;
}
function feedPostCard(p) {
  const comments=(cache.activity_comments||[]).filter(c=>c.post_id===p.id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const roots=comments.filter(c=>!c.parent_id);
  const likes=(cache.activity_likes||[]).filter(l=>l.post_id===p.id);
  const liked=likes.some(l=>l.user_id===session?.user.id);
  const doc=(cache.documents||[]).find(d=>d.id===p.document_id);
  let domain='';try{domain=p.link_url?new URL(p.link_url).hostname.replace(/^www\./,''):'';}catch{}
  const photo=mediaUrl(p.image_path);
  return `<article class="card feed-post" id="post-${esc(p.id)}"><div class="feed-post-head">${memberAvatar(p.author_id)}<div><strong>${esc(memberName(p.author_id))} ${roleBadge((cache.profiles||[]).find(x=>x.id===p.author_id))}</strong><small>${dateTime(p.created_at)}${p.edited_at?' · edited':''}</small></div>${p.author_id===session?.user.id||admin()?`<div class="feed-post-menu">${p.author_id===session?.user.id?`<button class="text-button" data-action="editFeedPost" data-id="${esc(p.id)}">Edit</button>`:''}<button class="text-button" data-action="removeFeedPost" data-id="${esc(p.id)}">Remove</button></div>`:''}</div>${mediaReady?`<span class="tag blue feed-category">${esc(p.category||'Project update')}</span>`:''}${p.title?`<h2 class="feed-post-title">${esc(p.title)}</h2>`:''}<p class="feed-body">${esc(p.body)}</p>
    ${photo?`<a href="${esc(photo)}" target="_blank" rel="noopener noreferrer" aria-label="Open full image"><img class="feed-photo" src="${esc(photo)}" loading="lazy" alt="Image shared by ${esc(memberName(p.author_id))}"></a>`:''}
    ${p.link_url?`<a class="feed-link" href="${esc(cleanUrl(p.link_url))}" target="_blank" rel="noopener noreferrer"><span class="feed-link-art">↗</span><span><small>${esc(domain)}</small><strong>${esc(p.link_url)}</strong></span></a>`:''}
    ${doc?`<button class="feed-file" data-action="downloadDoc" data-id="${esc(doc.id)}">▤ &nbsp; ${esc(doc.title)} <small>Open document ↗</small></button>`:''}
    <div class="feed-post-actions"><button class="feed-action ${liked?'selected':''}" data-action="likeFeedPost" data-id="${esc(p.id)}" aria-label="${liked?'Unlike':'Like'} post">${liked?'♥':'♡'} ${likes.length} Likes</button><span>◌ ${comments.length} Comments</span><button class="feed-action" data-action="report" data-type="post" data-id="${esc(p.id)}">Report</button></div>
    <div class="feed-comments">${roots.slice(-2).map(c=>feedCommentRow(c,comments)).join('')}${roots.length>2?`<button class="text-button" data-action="allFeedComments" data-id="${esc(p.id)}">View all ${comments.length} comments and replies</button>`:''}</div>
    <form class="feed-comment-form" data-post="${esc(p.id)}">${memberAvatar(session.user.id)}<label class="sr-only" for="comment-${esc(p.id)}">Comment on post</label><input id="comment-${esc(p.id)}" name="body" maxlength="1000" placeholder="Add a helpful comment…" required><button class="button button-sm" type="submit">Reply</button></form></article>`;
}
function feedCommentRow(c,all){
  const replies=all.filter(x=>x.parent_id===c.id);
  const one=x=>`<div class="feed-comment ${x.parent_id?'nested':''}">${memberAvatar(x.author_id)}<div><strong>${esc(memberName(x.author_id))}</strong><span>${esc(x.body)}</span><small>${dateTime(x.created_at)}${!x.parent_id?` · <button class="text-button" data-action="replyFeedComment" data-id="${esc(x.id)}">Reply</button>`:''}</small></div></div>`;
  return `<div class="feed-thread">${one(c)}${replies.map(one).join('')}</div>`;
}
function application() {
  if(!session)return head('JOIN INNOVATEX','Membership application','Sign in to apply.')+button('Member sign in','login');
  if(!('membership_status' in me))return head('JOIN INNOVATEX','Membership application','The approval upgrade has not yet been activated.')+communityNotice();
  const status=me.membership_status;
  return `${head('JOIN INNOVATEX','Account application','Tell the club how you want to contribute.')}
  <div class="notice">Applying as: <strong>${esc(me.application_type||'member')}</strong> · Status: <strong>${esc(status.toUpperCase())}</strong>. ${status==='approved'?'Your access is open.':status==='rejected'?'An administrator did not approve this application. You may update your details and contact the team for clarification.':status==='suspended'?'Your membership has been paused. Please contact a club administrator.':'An administrator will review your application.'}</div>
  ${status==='approved'?`<p style="margin-top:20px"><a href="${investor()?'#investor-portal':'#home'}" class="button">Open ${investor()?'investor portal':'workspace'} →</a></p>`:status==='suspended'?'<p class="subtle">Contact a club administrator to review your access.</p>':`<form id="editor" data-kind="application" class="form-stack card application-form" style="margin-top:20px">${roleReady?select('I am applying as','application_type',['member','teacher','founder','investor'],me.application_type||pendingType):''}${field('Full name','full_name','text',me.full_name||'')}${field('Programme / organization','programme','text',me.programme||'')}${field('Skills or interests','skills','text',me.skills||'',false)}${area('Why do you want to join or partner with InnovateX?','application_reason',me.application_reason||'')}<button class="button" type="submit">${status==='pending'?'Submit or update application':'Update application'}</button></form>`}`;
}
function applications() {
  if(!admin())return '';
  if(!enhancedReady)return head('ADMINISTRATION','Applications','Review club membership.')+communityNotice();
  const applicants=(cache.profiles||[]).filter(p=>p.membership_status!=='approved');
  return `${head('ADMINISTRATION','Applications','Review verified accounts before they enter the club workspace.')}
    <div class="grid grid-2">${applicants.length?applicants.map(p=>`<div class="card"><div class="row"><span class="tag ${p.membership_status==='pending'?'gold':''}">${esc(p.membership_status)}</span><span class="tag blue">${esc(p.application_type||'member')}</span><small class="subtle">${date(p.created_at)}</small></div><h3 style="margin-top:14px">${esc(p.full_name)}</h3><p>${esc(p.programme||'Programme not provided')}</p><p class="detail">${esc(p.application_reason||'No reason submitted yet.')}</p><div class="card-footer"><span>${esc(p.skills||'')}</span><div><button class="text-button" data-action="reviewMember" data-status="approved" data-id="${esc(p.id)}">Approve</button> · <button class="text-button" data-action="reviewMember" data-status="rejected" data-id="${esc(p.id)}">Reject</button></div></div></div>`).join(''):empty('No applications waiting','New verified accounts will appear here.')}</div>
    <div class="section-heading"><h2>Approved accounts</h2><p>Pause access if needed.</p></div><div class="profile-grid">${(cache.profiles||[]).filter(p=>p.membership_status==='approved'&&p.id!==session.user.id).map(p=>`<div class="card person">${memberAvatar(p.id)}<div><strong>${esc(p.full_name)}</strong>${roleBadge(p)}<small class="subtle">${esc(p.role)} · ${esc(p.handle||'')}</small></div><button class="text-button" data-action="reviewMember" data-status="suspended" data-id="${esc(p.id)}">Suspend</button></div>`).join('')}</div>`;
}
function adminDashboard(){
  if(!admin())return '';
  const profiles=cache.profiles||[],pending=profiles.filter(p=>p.membership_status==='pending');
  const reports=(cache.reports||[]).filter(r=>r.status==='open');
  const inquiries=(cache.investor_inquiries||[]).filter(q=>q.status==='new');
  const posts=cache.activity_posts||[],projects=cache.projects||[];
  const exports=[['profiles','Applications & members'],['projects','Projects'],['events','Events'],['activity_posts','Activity posts'],['reports','Reports'],['investor_inquiries','Investor inquiries'],['audit_events','Audit log']];
  return `${head('ADMINISTRATION','Club oversight','Review membership, community activity, founder planning and investor communication.')}
  ${!roleReady?'<div class="notice">Run the roles and investors migration to enable applicant types and the investor portal.</div>':''}
  <div class="grid grid-4"><a class="stat dashboard-stat" href="#applications"><small>Pending applications</small><b>${pending.length}</b><span>Review requests →</span></a><a class="stat dashboard-stat" href="#moderation"><small>Open reports</small><b>${reports.length}</b><span>Moderate content →</span></a><a class="stat dashboard-stat" href="#feed"><small>Activity posts</small><b>${posts.length}</b><span>View feed →</span></a><a class="stat dashboard-stat" href="#projects"><small>Projects</small><b>${projects.length}</b><span>View plans →</span></a></div>
  <div class="grid grid-2 admin-overview"><div class="card"><h2>Needs attention</h2>${pending.slice(0,5).map(p=>`<div class="list-item"><span class="tag gold">${esc(p.application_type||'member')}</span><div><strong>${esc(p.full_name)}</strong><small>Applied ${date(p.created_at)}</small></div></div>`).join('')||'<p class="muted">No pending applications.</p>'}${reports.length?`<p class="subtle">${reports.length} open ${reports.length===1?'report':'reports'} await review.</p>`:''}${inquiries.length?`<p class="subtle">${inquiries.length} new investor ${inquiries.length===1?'inquiry':'inquiries'} await review.</p>`:''}<div class="profile-buttons"><a class="button button-sm" href="#applications">Review applications</a><a class="button button-outline button-sm" href="#investor-portal">Investor portal</a></div></div>
  <div class="card"><h2>Club activity</h2><div class="admin-quick"><a href="#founder-room">Founder meetings <strong>${(cache.founder_meetings||[]).length} →</strong></a><a href="#events">Events <strong>${(cache.events||[]).length} →</strong></a><a href="#channels">Channels <strong>${(cache.channels||[]).length} →</strong></a><a href="#news">Technology stories <strong>${(cache.news_posts||[]).length} →</strong></a><a href="#library">Shared documents <strong>${(cache.documents||[]).length} →</strong></a></div><p class="hint">Private direct messages remain visible only to their participants.</p></div></div>
  <div class="section-heading"><h2>Download CSV</h2><p>Exports contain rows currently loaded in this browser, usually up to the Supabase query limit.</p></div><div class="card"><div class="export-actions">${exports.map(([key,label])=>`<button class="button button-outline button-sm" data-action="exportCsv" data-table="${key}">${esc(label)} CSV ↓</button>`).join('')}</div><p class="hint">CSV files exclude authentication records, direct messages and uploaded file contents. For a full backup, use Supabase backups.</p></div>
  <div class="section-heading"><h2>Recent administrator actions</h2></div><div class="card">${(cache.audit_events||[]).slice(0,8).map(a=>`<div class="list-item"><div><strong>${esc(a.action.replaceAll('_',' '))}</strong><small>${dateTime(a.created_at)} · ${esc(memberName(a.actor_id))}</small></div></div>`).join('')||'<p class="muted">No actions recorded yet.</p>'}</div>`;
}
function notifications() {
  if(!enhancedReady)return head('CLUB INBOX','Notifications','Mentions and updates.')+communityNotice();
  const list=cache.notifications||[];
  const soon=(cache.events||[]).filter(e=>new Date(e.starts_at)>new Date()&&new Date(e.starts_at)-Date.now()<172800000);
  const founderSoon=founder()?(cache.founder_meetings||[]).filter(e=>new Date(e.starts_at)>new Date()&&new Date(e.starts_at)-Date.now()<172800000):[];
  const tasksSoon=(cache.project_tasks||[]).filter(t=>t.assignee_id===session?.user.id&&t.status!=='done'&&t.due_at&&new Date(t.due_at)>new Date()&&new Date(t.due_at)-Date.now()<172800000);
  return `${head('CLUB INBOX','Notifications','Mentions, replies, assignments and upcoming meetings.')}
    ${(soon.length||founderSoon.length||tasksSoon.length)?`<div class="notice"><strong>Coming up in the next 48 hours:</strong> ${[...soon,...founderSoon].map(e=>esc(e.title)+' · '+dateTime(e.starts_at)).concat(tasksSoon.map(t=>esc(t.title)+' · due '+dateTime(t.due_at))).join(' / ')}</div>`:''}
    <div class="grid" style="margin-top:18px">${list.length?list.map(n=>`<div class="card notification-item ${n.read_at?'':'unread'}"><div><span class="tag">${esc(n.kind)}</span><h3>${esc(n.title)}</h3><p>${dateTime(n.created_at)}</p></div><div><button class="text-button" data-action="openNotification" data-id="${esc(n.id)}">Open →</button>${!n.read_at?` · <button class="text-button" data-action="readNotification" data-id="${esc(n.id)}">Mark read</button>`:''}</div></div>`).join(''):empty('All caught up','Mentions, replies and task assignments will show here.')}</div>`;
}
function moderation() {
  if(!admin())return '';
  if(!enhancedReady)return head('ADMINISTRATION','Moderation','Community reports.')+communityNotice();
  const reports=(cache.reports||[]).filter(r=>r.status==='open');
  return `${head('ADMINISTRATION','Moderation','Review reports and keep discussions useful.',button('Export content JSON','exportData','button-outline'))}
    <div class="grid">${reports.length?reports.map(r=>`<div class="card"><div class="row"><span class="tag gold">${esc(r.target_type)}</span><span class="subtle">${dateTime(r.created_at)}</span></div><h3 style="margin-top:12px">Report from ${esc(memberName(r.reporter_id))}</h3><p>${esc(r.reason)}</p><div class="card-footer"><span>Content ID: ${esc(r.target_id)}</span><div><button class="text-button" data-action="moderateContent" data-id="${esc(r.id)}">Remove content</button> · <button class="text-button" data-action="resolveReport" data-id="${esc(r.id)}">Resolve</button></div></div></div>`).join(''):empty('No open reports','Member reports will appear here.')}</div>
    <div class="section-heading"><h2>Recent administrator actions</h2></div><div class="card">${(cache.audit_events||[]).slice(0,15).map(a=>`<div class="list-item"><div><strong>${esc(a.action.replaceAll('_',' '))}</strong><small>${dateTime(a.created_at)} · ${esc(memberName(a.actor_id))}</small></div></div>`).join('')||'<p class="muted">No actions recorded yet.</p>'}</div>`;
}
const communityNotice = () => `<div class="notice">This feature needs the Supabase migration to be run by an administrator.</div>`;
const memberName = id => (cache.profiles||[]).find(p=>p.id===id)?.full_name || 'Member';
const fileSize = bytes => bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${Math.ceil(bytes/1024)} KB`;
function channels() {
  if(!communityReady) return head('COMMUNITY','Channels','Talk and build together.')+communityNotice();
  const list=(cache.channels||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));
  if(!list.some(c=>c.id===activeChannelId)) activeChannelId=list[0]?.id||null;
  const selected=list.find(c=>c.id===activeChannelId);
  return `${head('CLUB CONVERSATIONS','Channels','Focused spaces for ideas, help and project updates.',admin()?button('+ Create channel','channelForm'):'')}
    <div class="chat-layout"><div class="channel-list"><div class="channel-label">YOUR CHANNELS</div>${list.map(c=>{const seen=(cache.channel_reads||[]).find(r=>r.channel_id===c.id)?.last_read_at;const unread=enhancedReady?(cache.channel_messages||[]).filter(m=>m.channel_id===c.id&&m.author_id!==session.user.id&&(!seen||new Date(m.created_at)>new Date(seen))).length:0;return `<button class="channel-button ${c.id===activeChannelId?'selected':''}" data-action="selectChannel" data-id="${esc(c.id)}"><strong># ${esc(c.name)} ${unread?`<i class="unread-badge">${unread}</i>`:''}</strong><small>${esc(c.description)}</small></button>`}).join('')}</div>
    <div class="chat-panel">${selected?`<div class="chat-head"><div><h2># ${esc(selected.name)}</h2><p>${esc(selected.description)}</p></div><div class="chat-tools">${button('Search','searchChat','button-outline button-sm')}${button('Share file','shareDoc','button-outline button-sm')}</div></div><div id="messageStream" class="message-stream" aria-live="polite">${messageList()}</div><form id="chatComposer" class="chat-composer">${mediaReady?`<label class="gallery-picker" title="Choose an image from your gallery">▧<span class="sr-only">Choose image</span><input name="chat_image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>`:''}<label class="sr-only" for="chatBody">Message</label><input id="chatBody" name="body" maxlength="3000" placeholder="Message #${esc(selected.name)} · mention @handle" ${mediaReady?'':'required'} autocomplete="off"><button class="button" type="submit">Send ↗</button>${mediaReady?`<span id="chatImageName" class="chat-image-name" hidden></span>`:''}</form>`:empty('No channels yet','An administrator can add the first channel.')}</div></div>`;
}
function messageList() {
  const all=cache.channel_messages||[];
  const list=all.filter(m=>m.channel_id===activeChannelId&&!m.parent_id).slice().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).slice(-100);
  return list.length?list.map(m=>messageRow(m,true)).join(''):empty('No messages yet','Be the first to start the conversation.');
}
function messageRow(m,showThread=false) {
  const doc=m.deleted_at?null:(cache.documents||[]).find(d=>d.id===m.document_id);
  const replies=(cache.channel_messages||[]).filter(x=>x.parent_id===m.id).length;
  const reactions=(cache.message_reactions||[]).filter(x=>x.message_id===m.id);
  const photo=m.deleted_at?'':mediaUrl(m.image_path);
  return `<div class="chat-message">${memberAvatar(m.author_id)}<div><div class="message-meta"><strong>${esc(memberName(m.author_id))}</strong><time>${dateTime(m.created_at)}${m.edited_at?' · edited':''}</time></div><p>${esc(m.body)}</p>${photo?`<a href="${esc(photo)}" target="_blank" rel="noopener noreferrer" aria-label="Open shared image"><img class="chat-photo" src="${esc(photo)}" loading="lazy" alt="Image shared by ${esc(memberName(m.author_id))}"></a>`:''}${doc?`<button class="attachment" data-action="downloadDoc" data-id="${esc(doc.id)}">▤ ${esc(doc.title)} <small>${fileSize(doc.file_size)}</small></button>`:''}
  ${enhancedReady&&!m.deleted_at?`<div class="message-actions">${['👍','💡','🔥','🎯'].map(emoji=>`<button class="reaction ${reactions.some(r=>r.emoji===emoji&&r.user_id===session.user.id)?'selected':''}" data-action="react" data-id="${esc(m.id)}" data-emoji="${emoji}" aria-label="React ${emoji}">${emoji}${reactions.filter(r=>r.emoji===emoji).length||''}</button>`).join('')}${showThread?`<button class="text-button" data-action="thread" data-id="${esc(m.id)}">Reply${replies?` (${replies})`:''}</button>`:''}${m.author_id===session.user.id?`<button class="text-button" data-action="editMessage" data-id="${esc(m.id)}">Edit</button>`:''}${m.author_id===session.user.id||admin()?`<button class="text-button" data-action="removeMessage" data-id="${esc(m.id)}">Remove</button>`:''}<button class="text-button" data-action="report" data-type="message" data-id="${esc(m.id)}">Report</button></div>`:''}</div></div>`;
}
function threadDialog(id) {
  const root=(cache.channel_messages||[]).find(m=>m.id===id);if(!root)return;
  activeThreadId=id;
  const replies=(cache.channel_messages||[]).filter(m=>m.parent_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  modal(`<span class="eyebrow">CHANNEL THREAD</span><h2>Replies</h2><div class="thread-scroll">${messageRow(root)}${replies.map(m=>messageRow(m)).join('')}</div><form id="editor" data-kind="threadReply" class="form-stack">${area('Your reply','body')}<button class="button" type="submit">Post reply</button></form>`);
}
function renderChatMessages() {
  const stream=$('#messageStream'); if(!stream) return;
  const atBottom=stream.scrollHeight-stream.scrollTop-stream.clientHeight<100;
  stream.innerHTML=messageList();
  if(atBottom) stream.scrollTop=stream.scrollHeight;
}
function library() {
  if(!communityReady) return head('SHARED KNOWLEDGE','Document library','Files for the club.')+communityNotice();
  const docs=cache.documents||[];
  return `${head('SHARED KNOWLEDGE','Document library','Project notes, design files, workshop material and research shared by members.',button('+ Share document','shareDoc'))}
  <div class="notice">Files are available to approved members. Maximum size: 10 MB. Share only files you have permission to distribute.</div>
  <div class="grid grid-3" style="margin-top:22px">${docs.length?docs.map(d=>`<div class="card document-card"><span class="feature-icon">▤</span><h3>${esc(d.title)}</h3><p>Shared by ${esc(memberName(d.author_id))} · ${date(d.created_at)}</p><div class="meta">${d.channel_id?`<span># ${esc((cache.channels||[]).find(c=>c.id===d.channel_id)?.name||'Channel')}</span>`:''}<span>${fileSize(d.file_size)}</span></div><div class="card-footer"><span>${esc(d.file_type||'Document')}</span><div class="doc-actions"><button class="text-button" data-action="downloadDoc" data-id="${esc(d.id)}">Open ↗</button>${enhancedReady?`<button class="text-button" data-action="documentVersions" data-id="${esc(d.id)}">Versions</button>${d.author_id===session.user.id?`<button class="text-button" data-action="uploadRevision" data-id="${esc(d.id)}">Revise</button>`:''}<button class="text-button" data-action="report" data-type="document" data-id="${esc(d.id)}">Report</button>`:''}</div></div></div>`).join(''):empty('No files shared yet','Upload the first project note or useful resource.')}</div>`;
}
function news() {
  if(!communityReady) return head('DISCOVER','Technology news','Curated engineering stories.')+communityNotice();
  const items=cache.news_posts||[];
  const published=items.filter(n=>n.status==='published');
  const review=items.filter(n=>n.status==='pending'&&(admin()||n.submitted_by===session?.user.id));
  return `${head('DISCOVER','Technology news','Member-curated articles on engineering, robotics, energy and emerging technology.',button('+ Share an article','newsForm'))}
  <div class="notice">Members recommend articles from external sources. A club administrator reviews each submission before it appears in the feed.</div>
  ${review.length?`<div class="section-heading"><h2>${admin()?'Awaiting review':'Your submissions'}</h2></div><div class="grid grid-2">${review.map(n=>newsCard(n,true)).join('')}</div>`:''}
  <div class="section-heading"><h2>Latest from the community</h2><p>Open the source to read the full story.</p></div><div class="grid grid-3">${published.length?published.map(n=>newsCard(n)).join(''):empty('No articles yet','Share an important technology story to start this feed.')}</div>`;
}
function newsCard(n,pending=false) {return `<div class="card news-card"><div class="row"><span class="tag ${pending?'gold':'blue'}">${pending?'Pending review':esc(n.category)}</span><span class="subtle">${date(n.created_at)}</span></div><h3>${esc(n.title)}</h3><p>${esc(n.summary)}</p><div class="card-footer"><span>By ${esc(memberName(n.submitted_by))}</span>${pending&&admin()?`<div><button class="text-button" data-action="reviewNews" data-status="published" data-id="${esc(n.id)}">Publish</button> · <button class="text-button" data-action="reviewNews" data-status="rejected" data-id="${esc(n.id)}">Reject</button></div>`:pending?'<span>Awaiting approval</span>':`<div class="doc-actions"><a class="link" href="${esc(cleanUrl(n.url))}" target="_blank" rel="noopener noreferrer">Read source ↗</a>${enhancedReady?`<button class="text-button" data-action="report" data-type="news" data-id="${esc(n.id)}">Report</button>`:''}</div>`}</div></div>`;}
function founderRoom() {
  if(!founder()) return head('FOUNDING TEAM','Founder room','For accepted founders.')+empty('Founder access required','Accept an invitation to enter this room.');
  if(!communityReady) return head('FOUNDING TEAM','Founder room','Private planning and meetings.')+communityNotice();
  const meetings=(cache.founder_meetings||[]).slice().sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  const invites=cache.founder_invites||[];
  return `${head('FOUNDING TEAM','Founder room','A private place for accepted founders to plan and meet.',button('+ Schedule meeting','founderMeetingForm'))}
  <div class="founder-invite-banner"><div><span class="eyebrow">PRIVATE SPACE</span><h3>Keep the founding team aligned.</h3><p>Schedule a Google Meet, share an agenda and add meetings to your calendar. Only accepted founders and administrators can view this space.</p></div><span class="founder-mark">IX✦</span></div>
  ${admin()?`<div class="section-heading"><h2>Founder invitations</h2>${button('+ Invite founder','inviteFounder','button-outline button-sm')}</div><div class="card"><div class="invite-list">${invites.length?invites.map(i=>`<div class="list-item"><div><strong>${esc(i.email)}</strong><small>${i.accepted_at?'Accepted '+date(i.accepted_at):'Waiting for founder to sign in and accept'}</small></div><span class="tag ${i.accepted_at?'':'gold'}">${i.accepted_at?'Accepted':'Pending'}</span></div>`).join(''):empty('No invitations yet','Invite founders using the email they will sign in with.')}</div></div>`:''}
  <div class="section-heading"><h2>Meetings</h2><p>Private meeting links are shown only in this room.</p></div><div class="grid grid-2">${meetings.length?meetings.map(m=>`<div class="card"><div class="row"><span class="tag ${new Date(m.starts_at)<new Date()?'gold':''}">${new Date(m.starts_at)<new Date()?'Past meeting':'Upcoming'}</span><span class="subtle">${dateTime(m.starts_at)}</span></div><h3 style="margin-top:17px">${esc(m.title)}</h3><p>${esc(m.agenda||'Agenda to follow.')}</p><div class="meta"><span>◷ ${dateTime(m.starts_at)}</span><span>Hosted by ${esc(memberName(m.host_id))}</span></div>${rsvpControls("meeting",m.id)}<div class="card-footer"><div>${m.meet_url?`<a class="link" href="${esc(cleanUrl(m.meet_url))}" target="_blank" rel="noopener noreferrer">Join Google Meet ↗</a>`:'Meet link to follow'}</div><div>${!m.meet_url&&(admin()||m.host_id===session?.user.id)?`<button class="text-button" data-action="createMeet" data-kind="meeting" data-id="${esc(m.id)}">Create Meet</button> · `:''}<button class="text-button" data-action="founderCalendar" data-id="${esc(m.id)}">Calendar</button> · <button class="text-button" data-action="founderIcs" data-id="${esc(m.id)}">ICS</button></div></div></div>`).join(''):empty('No founder meetings yet','Schedule a planning call for the founding team.')}</div>`;
}

function field(label,name,type='text',value='',required=true) {return `<div class="field"><label for="${name}">${esc(label)}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''}></div>`;}
function area(label,name,value='') {return `<div class="field"><label for="${name}">${esc(label)}</label><textarea id="${name}" name="${name}" required>${esc(value)}</textarea></div>`;}
function select(label,name,options,current='') {return `<div class="field"><label for="${name}">${esc(label)}</label><select id="${name}" name="${name}">${options.map(x=>`<option value="${esc(x)}" ${x===current?'selected':''}>${esc(x)}</option>`).join('')}</select></div>`;}
function form(title,description,kind,fields) {modal(`<span class="eyebrow">INNOVATEX WORKSPACE</span><h2>${title}</h2><p class="muted">${description}</p><form id="editor" data-kind="${kind}" class="form-stack">${fields}<button class="button" type="submit">Save ${title.toLowerCase()}</button></form>`);}
function signInDialog(mode='signin') {
  if(!configured) return show('Add your Supabase URL and publishable key to config.js first.');
  if(pendingEmail) return codeDialog();
  pendingAuthMode=mode==='signup'?'signup':'signin';
  modal(`<span class="eyebrow">INNOVATEX ENGINEERING CLUB</span><h2>${pendingAuthMode==='signup'?'Create your account':'Sign in'}</h2><div class="auth-switch"><button type="button" class="${pendingAuthMode==='signin'?'selected':''}" data-action="signin">I have an account</button><button type="button" class="${pendingAuthMode==='signup'?'selected':''}" data-action="signup">Create an account</button></div><p class="muted">${pendingAuthMode==='signup'?'Choose the type of account you are applying for. Verify your email once to create the account; an administrator will review the application.':'Enter the email for your existing account. We’ll send a fresh one-time sign-in code.'}</p><form id="editor" data-kind="login" class="form-stack">${pendingAuthMode==='signup'?select('I am applying as','application_type',['member','teacher','founder','investor'],pendingType):''}${field('Email address','email','email')}<button class="button" type="submit">${pendingAuthMode==='signup'?'Create account and send code':'Send sign-in code'}</button></form>`);
}
function codeDialog() {
  modal(`<span class="eyebrow">INNOVATEX ENGINEERING CLUB</span><h2>${pendingAuthMode==='signup'?'Verify your new account':'Enter your sign-in code'}</h2><p class="muted">Enter the one-time code sent to <strong>${esc(pendingEmail)}</strong>.</p><form id="editor" data-kind="verify" class="form-stack"><div class="field"><label for="code">One-time code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" placeholder="Your code" required></div><button class="button" type="submit">${pendingAuthMode==='signup'?'Verify account':'Sign in'}</button></form><div class="otp-actions"><button class="text-button" data-action="resendCode">Resend code</button><button class="text-button" data-action="changeEmail">Use another email</button></div><p class="hint">Only the latest code will work. Check your spam folder if you don't see the email.</p>`);
  $('#code').focus();
}
async function requestCode(email,type=pendingType,mode=pendingAuthMode) {
  mode=mode==='signup'?'signup':'signin';
  const {error}=await db.auth.signInWithOtp({email,options:{shouldCreateUser:mode==='signup',emailRedirectTo:location.origin+location.pathname}});
  if(error) throw error;
  pendingEmail=email;pendingAuthMode=mode;pendingType=['member','teacher','founder','investor'].includes(type)?type:'member';
  sessionStorage.setItem('innovatex.pendingEmail',email);sessionStorage.setItem('innovatex.pendingAuthMode',mode);
  if(mode==='signup')sessionStorage.setItem('innovatex.pendingType',pendingType);else sessionStorage.removeItem('innovatex.pendingType');
  codeDialog();
  show('Verification code sent. Check your email.');
}
function projectDetail(id) {
  const p=(cache.projects||[]).find(x=>x.id===id);if(!p)return;
  activeProject=id;
  const tasks=(cache.project_tasks||[]).filter(t=>t.project_id===id);
  const team=(cache.project_members||[]).filter(m=>m.project_id===id);
  const milestones=(cache.project_milestones||[]).filter(m=>m.project_id===id);
  const threads=(cache.topics||[]).filter(t=>t.project_id===id);
  const can=admin()||p.owner_id===session?.user.id;
  modal(`<span class="tag">${esc(p.status)}</span><h2 style="margin-top:15px">${esc(p.title)}</h2><p>${esc(p.summary||'')}</p><p class="subtle">${esc(p.description||'')}</p><div class="progress"><span style="width:${Math.max(0,Math.min(100,Number(p.progress)||0))}%"></span></div>
    ${enhancedReady?`<div class="row"><h3>Project team</h3>${can?button('+ Add member','projectMemberForm','button-sm'):''}</div><div class="pill-row">${team.length?team.map(m=>`<span class="tag">${esc(memberName(m.user_id))}${m.user_id===p.owner_id?' · owner':''}</span>`).join(''):'<span class="subtle">Add collaborators to assign tasks.</span>'}</div>
    <div class="row" style="margin-top:18px"><h3>Milestones</h3>${can?button('+ Milestone','milestoneForm','button-sm'):''}</div><div class="list">${milestones.map(m=>`<div class="list-item"><span class="tag ${m.status==='done'?'':'gold'}">${esc(m.status)}</span><div><strong>${esc(m.title)}</strong><small>${m.due_at?'Due '+date(m.due_at):'No due date'}</small></div>${can&&m.status!=='done'?`<button class="text-button" data-action="milestoneDone" data-id="${esc(m.id)}">Done</button>`:''}</div>`).join('')||'<p class="subtle">Add key delivery dates for this project.</p>'}</div>`:''}
    <div class="row" style="margin-top:20px"><h3>Project plan</h3>${can?button('+ Add task','taskForm','button-sm'):''}</div><div class="list">${tasks.length?tasks.map(t=>`<div class="list-item"><span class="tag ${t.status==='done'?'':'gold'}">${esc(t.status)}</span><div><strong>${esc(t.title)}</strong><small>${t.due_at?'Due '+date(t.due_at):'No due date'}${t.assignee_id?' · '+esc(memberName(t.assignee_id)):''}</small></div>${can&&enhancedReady?`<button class="text-button" data-action="assignTask" data-id="${esc(t.id)}">Assign</button>`:''}${(can||t.assignee_id===session?.user.id)&&t.status!=='done'?`<button class="text-button" data-action="taskDone" data-id="${esc(t.id)}">Done</button>`:''}</div>`).join(''):empty('No tasks yet','Break this project into small, testable steps.')}</div>
    <div class="row" style="margin-top:22px"><h3>Project discussions</h3><button class="text-button" data-action="projectTopic" data-id="${esc(id)}">Start discussion +</button></div>${threads.length?threads.map(t=>`<div class="list-item"><div><strong>${esc(t.title)}</strong><small>${date(t.created_at)}</small></div><button class="text-button" data-action="topicDetail" data-id="${esc(t.id)}">Open →</button></div>`).join(''):'<p class="muted">No project discussions yet.</p>'}${can?`<div class="profile-action">${button('Update project','projectEdit','button-outline button-sm')}</div>`:''}`);
}
function topicDetail(id) {const t=(cache.topics||[]).find(x=>x.id===id);if(!t)return;const list=(cache.replies||[]).filter(x=>x.topic_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));modal(`<span class="tag">${esc(t.category)}</span><h2 style="margin-top:15px">${esc(t.title)}</h2><p>${esc(t.body)}</p><h3>Replies (${list.length})</h3><div style="max-height:300px;overflow:auto">${list.map(r=>`<div class="reply"><strong>${esc((cache.profiles||[]).find(p=>p.id===r.author_id)?.full_name||'Member')}</strong><span class="subtle"> · ${dateTime(r.created_at)}</span><p>${esc(r.body)}</p></div>`).join('')||'<p class="muted">Be the first to reply.</p>'}</div><form id="editor" data-kind="reply" class="form-stack">${area('Your reply','body')}<button class="button" type="submit">Post reply</button></form>`);}
async function signOut() {try{await touchPresence(false);const {error}=await db.auth.signOut();if(error)throw error;await signedIn(null);show('Signed out. See you soon.');}catch(e){fail(e);}}

function actions(e) {
  const el=e.target.closest('[data-action]'); if(!el)return; const action=el.dataset.action,id=el.dataset.id;
  if(action==='login'||action==='signup')return signInDialog('signup');
  if(action==='signin')return signInDialog('signin');
  if(action==='memberProfile')return memberProfile(id);
  if(action==='openDm'){if(!dmReady)return;activePeerId=id;if($('#modal').open)close();location.hash='#messages';render();markDmRead(id);return;}
  if(action==='feedPostForm'){
    if(!feedReady)return show('Activate the Supabase activity feed migration first.');
    const options='<option value="">No document attached</option>'+(cache.documents||[]).map(d=>`<option value="${esc(d.id)}">${esc(d.title)}</option>`).join('');
    return form('Share an update','Tell members about a build, question or technology worth discussing.','feedPost',(mediaReady?field('Headline (optional)','title','text','',false)+select('Topic','category',['Project update','Technology','Build log','Question','Opportunity']):'')+area('Your update','body')+(mediaReady?`<div class="field"><label for="post_image">Gallery image (optional, max 5 MB)</label><input id="post_image" name="post_image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></div>`:'')+field('Link to a resource (optional)','link_url','url','',false)+`<div class="field"><label for="document_id">Club document (optional)</label><select id="document_id" name="document_id">${options}</select></div>`);
  }
  if(action==='editFeedPost'){const p=(cache.activity_posts||[]).find(x=>x.id===id);if(p?.author_id===session?.user.id)return form('Edit update','Revise your post.','feedEdit',(mediaReady?field('Headline','title','text',p.title||'',false)+select('Topic','category',['Project update','Technology','Build log','Question','Opportunity'],p.category||'Project update'):'')+area('Your update','body',p.body)+`<input type="hidden" name="post_id" value="${esc(id)}">`);return;}
  if(action==='replyFeedComment'){
    const c=(cache.activity_comments||[]).find(x=>x.id===id);if(!c||c.parent_id)return;
    return form('Reply to comment',`Reply to ${esc(memberName(c.author_id))}.`,'feedReply',area('Your reply','body')+`<input type="hidden" name="post_id" value="${esc(c.post_id)}"><input type="hidden" name="parent_id" value="${esc(c.id)}">`);
  }
  if(action==='removeFeedPost')return removeFeedPost(id);
  if(action==='likeFeedPost')return toggleFeedLike(id);
  if(action==='jumpPost')return document.getElementById(`post-${id}`)?.scrollIntoView({behavior:'smooth',block:'center'});
  if(action==='allFeedComments')return allFeedComments(id);
  if(action==='selectChannel'){activeChannelId=id;render();markChannelRead(id);return;}
  if(action==='thread')return threadDialog(id);
  if(action==='react')return toggleReaction(id,el.dataset.emoji);
  if(action==='editMessage'){const m=(cache.channel_messages||[]).find(x=>x.id===id);if(m)return form('Edit message','Update your message in this channel.','editMessage',area('Message','body',m.body)+`<input type="hidden" name="message_id" value="${esc(id)}">`);return;}
  if(action==='removeMessage')return removeMessage(id);
  if(action==='searchChat')return form('Search messages','Find a conversation across club channels.','searchChat',field('Search term','term'));
  if(action==='openChannel'){close();activeChannelId=id;location.hash='#channels';render();markChannelRead(id);return;}
  if(action==='report'){activeReportTarget={type:el.dataset.type,id};return form('Report content','Tell administrators what needs attention.','report',area('Reason for report','reason'));}
  if(action==='reviewMember')return reviewMember(id,el.dataset.status);
  if(action==='readNotification')return markNotification(id);
  if(action==='openNotification')return openNotification(id);
  if(action==='resolveReport')return resolveReport(id);
  if(action==='moderateContent')return moderateReportedContent(id);
  if(action==='exportData')return exportClubContent();
  if(action==='exportCsv')return exportCsv(el.dataset.table);
  if(action==='investorUpdateForm'&&admin())return form('Investor update','Publish a reviewed club milestone for approved investors.','investorUpdate',field('Title','title')+select('Category','category',['Project milestone','Demonstration','Partnership','Club progress'])+area('Update','summary'));
  if(action==='investorInquiryForm'&&investor())return form('Investor inquiry','Send a private question or partnership idea to club administrators.','investorInquiry',field('Subject','subject')+area('Your message','message'));
  if(action==='reviewInquiry'&&admin())return mutate(()=>db.from('investor_inquiries').update({status:'reviewed'}).eq('id',id));
  if(action==='toggleInvestorUpdate'&&admin()){
    const update=(cache.investor_updates||[]).find(x=>x.id===id);if(update)return mutate(()=>db.from('investor_updates').update({published:!update.published}).eq('id',id));return;
  }
  if(action==='rsvp')return saveRsvp(el.dataset.kind,id,el.dataset.response);
  if(action==='createMeet')return createMeetFor(el.dataset.kind,id);
  if(action==='projectMemberForm'){
    const current=new Set((cache.project_members||[]).filter(m=>m.project_id===activeProject).map(m=>m.user_id));
    const options=(cache.profiles||[]).filter(p=>p.membership_status==='approved'&&p.role!=='investor'&&!current.has(p.id)).map(p=>`<option value="${esc(p.id)}">${esc(p.full_name)} (@${esc(p.handle)})</option>`).join('');
    return modal(`<span class="eyebrow">PROJECT TEAM</span><h2>Add collaborator</h2><form id="editor" data-kind="projectMember" class="form-stack"><div class="field"><label for="user_id">Approved member</label><select id="user_id" name="user_id" required>${options}</select></div><button class="button" type="submit" ${options?'':'disabled'}>Add to project</button></form>`);
  }
  if(action==='milestoneForm')return form('Milestone','Set a delivery goal for the project.','milestone',field('Title','title')+field('Due date','due_at','date','',false));
  if(action==='milestoneDone')return mutate(()=>db.from('project_milestones').update({status:'done'}).eq('id',id));
  if(action==='assignTask'){
    const t=(cache.project_tasks||[]).find(x=>x.id===id);if(!t)return;
    const memberOptions='<option value="">Unassigned</option>'+(cache.project_members||[]).filter(m=>m.project_id===t.project_id).map(m=>`<option value="${esc(m.user_id)}" ${m.user_id===t.assignee_id?'selected':''}>${esc(memberName(m.user_id))}</option>`).join('');
    const milestoneOptions='<option value="">No milestone</option>'+(cache.project_milestones||[]).filter(m=>m.project_id===t.project_id).map(m=>`<option value="${esc(m.id)}" ${m.id===t.milestone_id?'selected':''}>${esc(m.title)}</option>`).join('');
    return modal(`<span class="eyebrow">PROJECT TASK</span><h2>Assign task</h2><p>${esc(t.title)}</p><form id="editor" data-kind="assignTask" class="form-stack"><input type="hidden" name="task_id" value="${esc(t.id)}"><div class="field"><label for="assignee_id">Team member</label><select id="assignee_id" name="assignee_id">${memberOptions}</select></div><div class="field"><label for="milestone_id">Milestone</label><select id="milestone_id" name="milestone_id">${milestoneOptions}</select></div><button class="button" type="submit">Save assignment</button></form>`);
  }
  if(action==='shareDoc'){
    if(!communityReady)return show('Run the Supabase community upgrade first.');
    const options='<option value="">Library only</option>'+(cache.channels||[]).map(c=>`<option value="${esc(c.id)}" ${c.id===activeChannelId&&page==='channels'?'selected':''}># ${esc(c.name)}</option>`).join('');
    return modal(`<span class="eyebrow">CLUB LIBRARY</span><h2>Share a document</h2><p class="muted">Files are private to signed-in club members. Maximum size: 10 MB.</p><form id="editor" data-kind="document" class="form-stack"><div class="field"><label for="upload">Choose a file</label><input id="upload" name="upload" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip,.png,.jpg,.jpeg,.stl" required></div><div class="field"><label for="channel_id">Share in channel</label><select id="channel_id" name="channel_id">${options}</select></div><button class="button" type="submit">Upload document</button></form>`);
  }
  if(action==='learningForm'){
    if(!teacher()||!learningReady)return show('Teacher access and the learning materials migration are required.');
    const options='<option value="">General learning library</option>'+(cache.courses||[]).map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('');
    return modal(`<span class="eyebrow">TEACHING STUDIO</span><h2>Upload learning material</h2><p class="muted">Share presentations, notes and guides with approved members. Maximum 20 MB per file.</p><form id="editor" data-kind="learningMaterial" class="form-stack">${field('Title','title')}${select('Type','kind',['slides','notes','worksheet','guide'])}<div class="field"><label for="course_id">Related course</label><select id="course_id" name="course_id">${options}</select></div><div class="field"><label for="description">Description (optional)</label><textarea id="description" name="description" maxlength="1500"></textarea></div><div class="field"><label for="learning_file">PDF, PPT, PPTX, DOC or DOCX</label><input id="learning_file" name="learning_file" type="file" accept=".pdf,.ppt,.pptx,.doc,.docx" required></div><button class="button" type="submit">Publish material</button></form>`);
  }
  if(action==='downloadLearning')return downloadLearning(id);
  if(action==='toggleLearning'&&admin()){
    const m=(cache.learning_materials||[]).find(x=>x.id===id);if(m)return mutate(()=>db.from('learning_materials').update({hidden_at:m.hidden_at?null:new Date().toISOString()}).eq('id',id));return;
  }
  if(action==='downloadDoc')return downloadDocument(id);
  if(action==='documentVersions')return documentVersions(id);
  if(action==='downloadVersion')return downloadVersion(id);
  if(action==='uploadRevision')return uploadRevisionDialog(id);
  if(action==='channelForm')return form('Channel','Create a focused place for members to collaborate.','channel',field('Channel name','name')+field('Short description','description'));
  if(action==='newsForm')return form('Technology article','Share the source and explain why it matters to the club. Administrators review submissions.','news',field('Headline','title')+field('Article link','url','url')+select('Topic','category',['Technology','Robotics','AI','Energy','Electronics','Software','Research'])+area('Why it matters','summary'));
  if(action==='reviewNews')return reviewNews(id,el.dataset.status);
  if(action==='inviteFounder')return form('Founder invitation','Use the email address this founder will use to sign in.','founderInvite',field('Founder email','email','email'));
  if(action==='acceptFounder')return acceptFounder();
  if(action==='founderMeetingForm')return form('Founder meeting','Add the Google Meet link and an agenda for accepted founders.','founderMeeting',field('Meeting title','title')+area('Agenda','agenda')+field('Start','starts_at','datetime-local')+field('End','ends_at','datetime-local')+field('Google Meet URL','meet_url','url','',false));
  if(action==='founderCalendar'||action==='founderIcs'){const m=(cache.founder_meetings||[]).find(x=>x.id===id);if(m)calendar({...m,description:m.agenda,location:'Online'},action==='founderIcs');return;}
  if(action==='changeEmail'){pendingEmail='';sessionStorage.removeItem('innovatex.pendingEmail');sessionStorage.removeItem('innovatex.pendingType');sessionStorage.removeItem('innovatex.pendingAuthMode');return signInDialog(pendingAuthMode);}
  if(action==='resendCode')return requestCode(pendingEmail).catch(fail);
  if(action==='avatarForm'){
    if(!avatarReady)return show('Run the Supabase profile photo migration first.');
    modal(`<span class="eyebrow">MY PROFILE</span><h2>Change profile photo</h2><div class="avatar-preview">${memberAvatar(session.user.id,true)}<p>Choose a clear image. Approved club members can see your photo in conversations and the directory.</p></div><form id="editor" data-kind="avatar" class="form-stack"><div class="field"><label for="avatar_image">Photo (JPG, PNG, WebP or GIF, up to 5 MB)</label><input id="avatar_image" name="avatar_image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required></div><button class="button" type="submit">Save photo</button></form>${me?.avatar_path?`<button class="text-button remove-avatar" data-action="removeAvatar">Remove current photo</button>`:''}`);
    return;
  }
  if(action==='removeAvatar')return removeAvatar();
  if(action==='profileForm'){
    const basic=field('Full name','full_name','text',me?.full_name||'')+(enhancedReady?field('Unique handle (for mentions)','handle','text',me?.handle||''):'')+field('Programme / department','programme','text',me?.programme||'',false)+field('Skills / interests','skills','text',me?.skills||'',false);
    const extra=dmReady?field('Headline / role','headline','text',me?.headline||'',false)+`<div class="field"><label for="bio">About me</label><textarea id="bio" name="bio" maxlength="1200">${esc(me?.bio||'')}</textarea></div>`+select('Availability','availability',['available','busy','away'],me?.availability||'available'):'';
    return form('My profile','Help other members recognize your work.','profile',basic+extra);
  }
  if(action==='projectForm')return form('New project','Start with a clear problem and the first test.','project',field('Project title','title')+field('One-line summary','summary')+area('Description and goal','description'));
  if(action==='projectDetail')return projectDetail(id);
  if(action==='projectEdit'){const p=(cache.projects||[]).find(x=>x.id===activeProject);return form('Update project','Keep the plan current.','projectEdit',field('Title','title','text',p.title)+field('Summary','summary','text',p.summary)+area('Description','description',p.description)+select('Status','status',['planning','building','testing','complete'],p.status)+field('Progress 0–100','progress','number',p.progress));}
  if(action==='taskForm'){
    const memberOptions='<option value="">Unassigned</option>'+(cache.project_members||[]).filter(m=>m.project_id===activeProject).map(m=>`<option value="${esc(m.user_id)}">${esc(memberName(m.user_id))}</option>`).join('');
    const milestoneOptions='<option value="">No milestone</option>'+(cache.project_milestones||[]).filter(m=>m.project_id===activeProject).map(m=>`<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('');
    return form('Project task','Make the next step specific.','task',field('Task title','title')+field('Due date','due_at','date','',false)+(enhancedReady?`<div class="field"><label for="assignee_id">Assign to</label><select id="assignee_id" name="assignee_id">${memberOptions}</select></div><div class="field"><label for="milestone_id">Milestone</label><select id="milestone_id" name="milestone_id">${milestoneOptions}</select></div>`:''));
  }
  if(action==='taskDone')return mutate(async()=>db.from('project_tasks').update({status:'done'}).eq('id',id).select().single());
  if(action==='topicForm'||action==='projectTopic'){
    const options=['<option value="">Club-wide discussion</option>',...(cache.projects||[]).map(p=>`<option value="${esc(p.id)}" ${p.id===id?'selected':''}>${esc(p.title)}</option>`)].join('');
    return form('New discussion','Ask a focused question or share a decision.','topic',field('Title','title')+`<div class="field"><label for="project_id">Project</label><select id="project_id" name="project_id">${options}</select></div>`+select('Category','category',['General','Project idea','Technical help','Competition','Workshop'])+area('Your message','body'));
  }
  if(action==='topicDetail'){activeProject=id;return topicDetail(id);}
  if(action==='courseForm'&&teacher())return form('Course','Publish a workshop or learning resource.','course',field('Title','title')+select('Category','category',['Automation','Electronics','Embedded systems','Robotics','CAD','Software'])+select('Level','level',['Beginner','Intermediate','Advanced'])+area('Description','description')+field('Start date','starts_at','date','',false)+field('Resource URL','resource_url','url','',false));
  if(action==='eventForm')return form('Event','The calendar and meeting link stay together.','event',field('Title','title')+area('Description','description')+field('Start','starts_at','datetime-local')+field('End','ends_at','datetime-local')+field('Location','location','text','',false)+field('Google Meet URL','meet_url','url','',false));
  if(action==='announcementForm')return form('Alert','Important updates appear on the home page.','announcement',field('Title','title')+select('Priority','priority',['normal','urgent'])+area('Message','body'));
  if(action==='founderForm')return form('Founder','Publish only approved biographical details.','founder',field('Name','name')+field('Role','role')+area('Short bio','bio')+field('Profile URL','link_url','url','',false)+field('Order','sort_order','number','1'));
  if(action==='calendar'||action==='ics'){const item=(cache.events||[]).find(x=>x.id===id);if(item)calendar(item,action==='ics');}
}
async function mutate(fn) {try{const {error}=await fn();if(error)throw error;close();await refresh();show('Saved successfully.');}catch(e){fail(e);}}
async function reviewMember(id,status) {
  if(!admin()||!['approved','rejected','suspended'].includes(status))return;
  try {const {error}=await db.rpc('review_membership',{p_user:id,p_status:status});if(error)throw error;await refresh();show(`Membership ${status}.`);}catch(e){fail(e);}
}
async function markNotification(id) {
  try {const {error}=await db.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id);if(error)throw error;await refresh();}catch(e){fail(e);}
}
async function openNotification(id) {
  const n=(cache.notifications||[]).find(x=>x.id===id);if(!n)return;
  if(!n.read_at)await markNotification(id);
  if(n.target_type==='channel'){activeChannelId=n.target_id;location.hash='#channels';}
  else if(n.target_type==='project'){location.hash='#projects';setTimeout(()=>projectDetail(n.target_id),60);}
  else if(n.target_type==='meeting')location.hash='#founder-room';
  else if(n.target_type==='event')location.hash='#events';
  else if(n.target_type==='application')location.hash=admin()?'#applications':'#application';
  else if(n.target_type==='post'){location.hash='#feed';setTimeout(()=>document.getElementById(`post-${n.target_id}`)?.scrollIntoView({behavior:'smooth',block:'center'}),80);}
  else if(n.target_type==='direct_message'){activePeerId=n.target_id;location.hash='#messages';render();markDmRead(activePeerId);}
}
async function resolveReport(id) {
  if(!admin())return;
  try {const {error}=await db.from('reports').update({status:'resolved'}).eq('id',id);if(error)throw error;await refresh();show('Report resolved.');}catch(e){fail(e);}
}
async function moderateReportedContent(id) {
  if(!admin())return;const report=(cache.reports||[]).find(x=>x.id===id);if(!report)return;
  if(!confirm('Remove the reported content from the club workspace?'))return;
  try {const {error}=await db.rpc('moderate_content',{p_type:report.target_type,p_id:report.target_id});if(error)throw error;await resolveReport(id);show('Content removed and report resolved.');}catch(e){fail(e);}
}
function exportClubContent() {
  if(!admin())return;
  const names=['profiles','projects','project_tasks','project_members','project_milestones','topics','replies','channels','channel_messages','documents','document_versions','news_posts','events','event_rsvps','founder_meetings','founder_meeting_rsvps','announcements','courses','reports','audit_events','activity_posts','activity_comments','activity_likes'];
  const data=Object.fromEntries(names.map(n=>[n,cache[n]||[]]));
  const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),note:'Content export; excludes authentication records and file bytes.',data},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`innovatex-content-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportCsv(table){
  if(!admin())return;
  const columns={
    profiles:['id','full_name','application_type','role','membership_status','programme','skills','application_reason','created_at'],
    projects:['id','title','summary','status','progress','owner_id','created_at'],
    events:['id','title','starts_at','ends_at','location','created_at'],
    activity_posts:['id','author_id','title','category','body','created_at'],
    reports:['id','reporter_id','target_type','target_id','reason','status','created_at'],
    investor_inquiries:['id','investor_id','subject','message','status','created_at'],
    audit_events:['id','actor_id','action','target_type','target_id','created_at']
  };
  if(!Object.hasOwn(columns,table))return;
  const safe=value=>{
    let cell=String(value??'');
    if(/^[\s]*[=+@-]/.test(cell))cell="'"+cell;
    return `"${cell.replaceAll('"','""')}"`;
  };
  const headers=columns[table];
  const rows=(cache[table]||[]).map(row=>headers.map(key=>safe(row[key])).join(','));
  const csv='\ufeff'+headers.join(',')+'\r\n'+rows.join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`innovatex-${table}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function markChannelRead(id) {
  if(!enhancedReady||!session)return;
  const stamp=new Date().toISOString();
  try {const {error}=await db.from('channel_reads').upsert({channel_id:id,user_id:session.user.id,last_read_at:stamp},{onConflict:'channel_id,user_id'});if(error)throw error;
    cache.channel_reads=(cache.channel_reads||[]).filter(r=>r.channel_id!==id).concat({channel_id:id,user_id:session.user.id,last_read_at:stamp});
  }catch(e){console.error(e);}
}
async function toggleReaction(id,emoji) {
  if(!enhancedReady||!['👍','💡','🔥','🎯'].includes(emoji))return;
  const old=(cache.message_reactions||[]).some(r=>r.message_id===id&&r.user_id===session.user.id&&r.emoji===emoji);
  try {const q=db.from('message_reactions');const {error}=old?await q.delete().eq('message_id',id).eq('user_id',session.user.id).eq('emoji',emoji):await q.insert({message_id:id,user_id:session.user.id,emoji});if(error)throw error;
    cache.message_reactions=await read('message_reactions');if(page==='channels')renderChatMessages();
    if(activeThreadId&&$('#modal').open)threadDialog(activeThreadId);
  }catch(e){fail(e);}
}
async function toggleFeedLike(id) {
  if(!feedReady||!(cache.activity_posts||[]).some(p=>p.id===id))return;
  const liked=(cache.activity_likes||[]).some(l=>l.post_id===id&&l.user_id===session.user.id);
  try{const q=db.from('activity_likes');const {error}=liked?await q.delete().eq('post_id',id).eq('user_id',session.user.id):await q.insert({post_id:id,user_id:session.user.id});if(error)throw error;await refresh();}catch(e){fail(e);}
}
async function removeFeedPost(id) {
  if(!confirm('Remove this update and its comments from the feed?'))return;
  try{const {error}=await db.rpc('remove_activity_post',{p_id:id});if(error)throw error;await refresh();show('Update removed.');}catch(e){fail(e);}
}
function allFeedComments(id) {
  const post=(cache.activity_posts||[]).find(p=>p.id===id);if(!post)return;
  const comments=(cache.activity_comments||[]).filter(c=>c.post_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  modal(`<span class="eyebrow">CLUB DISCUSSION</span><h2>${esc(post.title||'Comments')}</h2><p>${esc(post.body)}</p><div class="thread-scroll">${comments.filter(c=>!c.parent_id).map(c=>feedCommentRow(c,comments)).join('')}</div>`);
}
async function removeMessage(id) {
  if(!confirm('Remove this message?'))return;
  try {const {error}=await db.rpc('remove_channel_message',{p_id:id});if(error)throw error;await refreshChat();if(activeThreadId&&$('#modal').open)threadDialog(activeThreadId);show('Message removed.');}catch(e){fail(e);}
}
async function saveRsvp(kind,id,response) {
  if(!enhancedReady||!['going','maybe','not_going'].includes(response))return;
  const meeting=kind==='meeting',table=meeting?'founder_meeting_rsvps':'event_rsvps',key=meeting?'meeting_id':'event_id';
  if(meeting&&!founder())return;
  try {const {error}=await db.from(table).upsert({[key]:id,user_id:session.user.id,response,updated_at:new Date().toISOString()},{onConflict:`${key},user_id`});if(error)throw error;await refresh();show('Response saved.');}catch(e){fail(e);}
}
async function reviewNews(id,status) {
  if(!admin()||!['published','rejected'].includes(status))return;
  try {const {error}=await db.from('news_posts').update({status}).eq('id',id);if(error)throw error;await refresh();show(status==='published'?'Article published.':'Article rejected.');}catch(e){fail(e);}
}
async function acceptFounder() {
  try {const {error}=await db.rpc('accept_founder_invitation');if(error)throw error;await signedIn(session);location.hash='#founder-room';show('Founder invitation accepted.');}catch(e){fail(e);}
}
async function downloadDocument(id) {
  const doc=(cache.documents||[]).find(d=>d.id===id);if(!doc)return;
  try {const {data,error}=await db.storage.from('club-documents').createSignedUrl(doc.storage_path,120);if(error)throw error;const a=document.createElement('a');a.href=data.signedUrl;a.target='_blank';a.rel='noopener noreferrer';document.body.appendChild(a);a.click();a.remove();}catch(e){fail(e);}
}
async function downloadLearning(id){
  if(!clubAccess()||!learningReady)return;
  const m=(cache.learning_materials||[]).find(x=>x.id===id&&!x.hidden_at);if(!m)return;
  try{
    const {data,error}=await db.storage.from('club-learning').createSignedUrl(m.storage_path,120);
    if(error)throw error;
    const a=document.createElement('a');a.href=data.signedUrl;a.target='_blank';a.rel='noopener noreferrer';document.body.appendChild(a);a.click();a.remove();
  }catch(e){fail(e);}
}
function documentVersions(id) {
  const doc=(cache.documents||[]).find(d=>d.id===id);if(!doc)return;
  const versions=(cache.document_versions||[]).filter(v=>v.document_id===id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  modal(`<span class="eyebrow">DOCUMENT HISTORY</span><h2>${esc(doc.title)}</h2><p class="muted">Earlier versions remain available to approved members.</p><div class="list">${versions.map((v,i)=>`<div class="list-item"><span class="tag">v${versions.length-i}</span><div><strong>${dateTime(v.created_at)}</strong><small>${fileSize(v.file_size)} · ${esc(memberName(v.uploaded_by))}</small></div><button class="text-button" data-action="downloadVersion" data-id="${esc(v.id)}">Open ↗</button></div>`).join('')||empty('No versions','The original file is available from the library.')}</div>`);
}
async function downloadVersion(id) {
  const v=(cache.document_versions||[]).find(x=>x.id===id);if(!v)return;
  try {const {data,error}=await db.storage.from('club-documents').createSignedUrl(v.storage_path,120);if(error)throw error;const a=document.createElement('a');a.href=data.signedUrl;a.target='_blank';a.rel='noopener noreferrer';a.click();}catch(e){fail(e);}
}
function uploadRevisionDialog(id) {
  const doc=(cache.documents||[]).find(d=>d.id===id);if(!doc||doc.author_id!==session.user.id)return;
  modal(`<span class="eyebrow">DOCUMENT HISTORY</span><h2>Upload a revision</h2><p class="muted">The current file stays in the version history.</p><form id="editor" data-kind="revision" class="form-stack"><input type="hidden" name="document_id" value="${esc(id)}"><div class="field"><label for="revision_file">New file (max 10 MB)</label><input id="revision_file" name="revision_file" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip,.png,.jpg,.jpeg,.stl" required></div><button class="button" type="submit">Upload revision</button></form>`);
}
async function submit(e) {
  if(e.target.id==='dmComposer'){
    e.preventDefault();const input=e.target.elements.body,body=input.value.trim(),file=e.target.querySelector('[name=dm_image]')?.files?.[0],send=e.target.querySelector('[type=submit]');
    if(!dmReady||!activePeerId||(!body&&!file))return;send.disabled=true;let path=null;
    try{if(file)path=await uploadClubImage(file);const record={sender_id:session.user.id,recipient_id:activePeerId,body:body||'Shared an image'};if(mediaReady)record.image_path=path;const {error}=await db.from('direct_messages').insert(record);if(error)throw error;input.value='';input.blur();if(file)e.target.querySelector('[name=dm_image]').value='';await refresh();}catch(error){if(path)await db.storage.from('club-media').remove([path]);fail(error);}finally{send.disabled=false;}return;
  }
  if(e.target.classList.contains('feed-comment-form')){
    e.preventDefault();const formEl=e.target,body=formEl.elements.body.value.trim(),post_id=formEl.dataset.post,send=formEl.querySelector('[type=submit]');
    if(!feedReady||!body||!post_id)return;send.disabled=true;
    try{const {error}=await db.from('activity_comments').insert({post_id,author_id:session.user.id,body});if(error)throw error;formEl.reset();await refresh();}
    catch(error){fail(error);}finally{send.disabled=false;}return;
  }
  if(e.target.id==='chatComposer'){
    e.preventDefault(); if(!session||!activeChannelId)return;
    const input=e.target.querySelector('[name=body]'),body=input.value.trim(),file=e.target.querySelector('[name=chat_image]')?.files?.[0],send=e.target.querySelector('[type=submit]');
    if(!body&&!file)return;send.disabled=true;let path=null;
    try {if(file)path=await uploadClubImage(file);const record={channel_id:activeChannelId,author_id:session.user.id,body:body||'Shared an image'};if(mediaReady)record.image_path=path;const {error}=await db.from('channel_messages').insert(record);if(error)throw error;input.value='';if(file)e.target.querySelector('[name=chat_image]').value='';const label=$('#chatImageName');if(label)label.hidden=true;await refreshChat();}
    catch(error){if(path)await db.storage.from('club-media').remove([path]);fail(error);}finally{send.disabled=false;}return;
  }
  if(e.target.id!=='editor')return; e.preventDefault(); if(!db)return;
  const formEl=e.target,kind=formEl.dataset.kind,values=Object.fromEntries(new FormData(formEl));
  const submitBtn=formEl.querySelector('[type=submit]'); submitBtn.disabled=true;
  try {
    if(kind==='login'){await requestCode(String(values.email).trim().toLowerCase(),String(values.application_type),pendingAuthMode);return;}
    if(kind==='verify'){
      const token=String(values.code).trim();
      if(!/^[0-9]{6,10}$/.test(token))throw Error('Enter the numeric code from your email.');
      const {data,error}=await db.auth.verifyOtp({email:pendingEmail,token,type:'email'});
      if(error)throw error;
      if(!data.session)throw Error('Verification succeeded, but no session was returned. Please try signing in again.');
      close();await signedIn(data.session);show('Email verified. Welcome to InnovateX!');return;
    }
    const payload={...values};
    for(const key of ['starts_at','ends_at','due_at']) if(key in payload) payload[key]=payload[key]?new Date(payload[key]).toISOString():null;
    for(const key of ['link_url','resource_url','meet_url']) if(key in payload) payload[key]=payload[key]?cleanUrl(payload[key]):null;
    if(kind==='application'){
      if('application_type' in payload){
        if(!['member','teacher','founder','investor'].includes(payload.application_type))throw Error('Choose a valid account type.');
        const {error:typeError}=await db.rpc('set_application_type',{p_type:payload.application_type});if(typeError)throw typeError;
        me.application_type=payload.application_type;delete payload.application_type;
      }
      const {error}=await db.from('profiles').update(payload).eq('id',session.user.id);if(error)throw error;
      me={...me,...payload};close();render();show('Application saved for review.');return;
    }
    if(kind==='investorUpdate'){
      if(!admin())throw Error('Administrator access required.');
      return await mutate(()=>db.from('investor_updates').insert({title:String(payload.title).trim(),category:payload.category,summary:String(payload.summary).trim(),published:true}));
    }
    if(kind==='investorInquiry'){
      if(!investor())throw Error('Investor approval required.');
      return await mutate(()=>db.from('investor_inquiries').insert({investor_id:session.user.id,subject:String(payload.subject).trim(),message:String(payload.message).trim()}));
    }
    if(kind==='profile'){
      if('handle' in payload){payload.handle=String(payload.handle).trim().toLowerCase();if(!/^[a-z0-9_]{3,30}$/.test(payload.handle))throw Error('Use 3–30 lowercase letters, numbers or underscores for your handle.');}
      const {error}=await db.from('profiles').update(payload).eq('id',session.user.id);if(error)throw error;
      me={...me,...payload};close();await refresh();show('Profile saved.');return;
    }
    if(kind==='avatar'){
      if(!avatarReady)throw Error('Run the Supabase profile photo migration first.');
      const file=formEl.querySelector('[name=avatar_image]')?.files?.[0];if(!file)throw Error('Choose a photo first.');
      const old=me?.avatar_path;let path=null;
      try{
        path=await uploadClubImage(file);
        const {error}=await db.from('profiles').update({avatar_path:path}).eq('id',session.user.id);if(error)throw error;
        me.avatar_path=path;close();await refresh();
        if(old&&old!==path){const removed=await db.storage.from('club-media').remove([old]);if(removed.error)console.error(removed.error);}
        show('Profile photo updated.');return;
      }catch(error){if(path&&me?.avatar_path!==path)await db.storage.from('club-media').remove([path]);throw error;}
    }
    if(kind==='learningMaterial'){
      if(!teacher()||!learningReady)throw Error('Approved teacher access is required.');
      const file=formEl.querySelector('[name=learning_file]')?.files?.[0];
      const ext=file?.name.split('.').pop()?.toLowerCase();
      const mime={pdf:'application/pdf',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}[ext];
      if(!file||!mime||file.size<1||file.size>20971520||file.name.length>240)throw Error('Choose a PDF, PPT, PPTX, DOC or DOCX file up to 20 MB.');
      if(file.type&&file.type!=='application/octet-stream'&&file.type!==mime)throw Error('The selected file type does not match its extension.');
      const path=`${session.user.id}/${crypto.randomUUID()}.${ext}`;
      const {error:uploadError}=await db.storage.from('club-learning').upload(path,file,{upsert:false,contentType:mime});
      if(uploadError)throw uploadError;
      const record={course_id:payload.course_id||null,uploaded_by:session.user.id,title:String(payload.title).trim(),description:String(payload.description||'').trim(),kind:payload.kind,file_name:file.name,storage_path:path,file_size:file.size};
      try{
        const {error}=await db.from('learning_materials').insert(record);if(error)throw error;
      }catch(error){const removed=await db.storage.from('club-learning').remove([path]);if(removed.error)console.error(removed.error);throw error;}
      close();await refresh();show('Learning material published.');return;
    }
    if(kind==='feedPost'){
      if(!feedReady)throw Error('Activate the activity feed migration first.');
      payload.body=String(payload.body).trim();payload.link_url=payload.link_url?cleanUrl(payload.link_url):null;
      if(values.link_url&&!payload.link_url)throw Error('Enter a valid HTTPS link.');
      payload.document_id=payload.document_id||null;payload.author_id=session.user.id;
      const file=formEl.querySelector('[name=post_image]')?.files?.[0];delete payload.post_image;
      let path=null;try{if(file)path=await uploadClubImage(file);if(mediaReady)payload.image_path=path;const {error}=await db.from('activity_posts').insert(payload);if(error)throw error;close();await refresh();show('Update shared with the club.');return;}
      catch(error){if(path)await db.storage.from('club-media').remove([path]);throw error;}
    }
    if(kind==='feedEdit'){
      const {error}=mediaReady?await db.rpc('edit_activity_post_details',{p_id:payload.post_id,p_body:String(payload.body).trim(),p_title:payload.title||'',p_category:payload.category}):await db.rpc('edit_activity_post',{p_id:payload.post_id,p_body:String(payload.body).trim()});if(error)throw error;
      close();await refresh();show('Update edited.');return;
    }
    if(kind==='feedReply'){
      const {error}=await db.from('activity_comments').insert({post_id:payload.post_id,parent_id:payload.parent_id,author_id:session.user.id,body:String(payload.body).trim()});if(error)throw error;
      close();await refresh();show('Reply posted.');return;
    }
    if(kind==='editMessage'){
      const {error}=await db.rpc('edit_channel_message',{p_id:payload.message_id,p_body:String(payload.body).trim()});if(error)throw error;
      close();await refreshChat();show('Message edited.');return;
    }
    if(kind==='threadReply'){
      const parent=(cache.channel_messages||[]).find(m=>m.id===activeThreadId);if(!parent)throw Error('Thread not found.');
      const {error}=await db.from('channel_messages').insert({channel_id:parent.channel_id,parent_id:parent.id,author_id:session.user.id,body:String(payload.body).trim()});if(error)throw error;
      await refreshChat();threadDialog(parent.id);return;
    }
    if(kind==='searchChat'){
      const term=String(payload.term).trim();if(term.length<2)throw Error('Search with at least two characters.');
      const {data,error}=await db.from('channel_messages').select('*').ilike('body',`%${term.replace(/[%_]/g,'\\$&')}%`).limit(30);
      if(error)throw error;
      modal(`<span class="eyebrow">CHANNEL SEARCH</span><h2>Results for “${esc(term)}”</h2><div class="thread-scroll">${(data||[]).map(m=>`<div class="list-item"><div><strong># ${esc((cache.channels||[]).find(c=>c.id===m.channel_id)?.name||'Channel')} · ${esc(memberName(m.author_id))}</strong><p>${esc(m.body)}</p><small>${dateTime(m.created_at)}</small></div><button class="text-button" data-action="openChannel" data-id="${esc(m.channel_id)}">Open</button></div>`).join('')||empty('No matches','Try a different word or phrase.')}</div>`);return;
    }
    if(kind==='report'){
      if(!activeReportTarget)throw Error('Content to report not found.');
      const {error}=await db.from('reports').insert({reporter_id:session.user.id,target_type:activeReportTarget.type,target_id:activeReportTarget.id,reason:String(payload.reason).trim()});if(error)throw error;
      activeReportTarget=null;close();show('Report sent to club administrators.');return;
    }
    if(kind==='projectMember')return await mutate(()=>db.from('project_members').insert({project_id:activeProject,user_id:payload.user_id}));
    if(kind==='milestone')return await mutate(()=>db.from('project_milestones').insert({project_id:activeProject,title:payload.title,due_at:payload.due_at}));
    if(kind==='assignTask')return await mutate(()=>db.rpc('assign_project_task',{p_task:payload.task_id,p_assignee:payload.assignee_id||null,p_milestone:payload.milestone_id||null}));
    if(kind==='channel'){
      if(!admin())throw Error('Only an administrator can create channels.');
      payload.slug=String(payload.name).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      if(payload.slug.length<2)throw Error('Choose a channel name with at least two letters or numbers.');
      return await mutate(()=>db.from('channels').insert(payload));
    }
    if(kind==='news'){
      payload.url=cleanUrl(payload.url);
      if(!payload.url)throw Error('Enter a valid HTTPS article URL.');
      payload.submitted_by=session.user.id;payload.status='pending';
      return await mutate(()=>db.from('news_posts').insert(payload));
    }
    if(kind==='founderInvite'){
      if(!admin())throw Error('Only an administrator can invite founders.');
      return await mutate(()=>db.from('founder_invites').insert({email:String(payload.email).trim().toLowerCase(),invited_by:session.user.id}));
    }
    if(kind==='founderMeeting'){
      if(!founder())throw Error('Founder access is required.');
      if(new Date(payload.ends_at)<=new Date(payload.starts_at))throw Error('End time must be after start time.');
      if(payload.meet_url && !cleanUrl(payload.meet_url))throw Error('Enter a valid HTTPS Google Meet URL.');
      payload.meet_url=payload.meet_url||null;payload.host_id=session.user.id;
      return await mutate(()=>db.from('founder_meetings').insert(payload));
    }
    if(kind==='revision'){
      const doc=(cache.documents||[]).find(d=>d.id===payload.document_id);
      if(!doc||doc.author_id!==session.user.id)throw Error('Document owner access required.');
      const file=formEl.querySelector('[name=revision_file]').files[0],ext=file?.name.split('.').pop().toLowerCase();
      if(!file||file.size<1||file.size>10485760||!['pdf','doc','docx','ppt','pptx','xls','xlsx','txt','csv','zip','png','jpg','jpeg','stl'].includes(ext))throw Error('Choose a supported file up to 10 MB.');
      const path=`${session.user.id}/${crypto.randomUUID()}.${ext}`;
      const {error:uploadError}=await db.storage.from('club-documents').upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});
      if(uploadError)throw uploadError;
      const {error:updateError}=await db.from('documents').update({storage_path:path,file_size:file.size,file_type:ext.toUpperCase()}).eq('id',doc.id);
      if(updateError){await db.storage.from('club-documents').remove([path]);throw updateError;}
      close();await refresh();show('New document version uploaded.');return;
    }
    if(kind==='document'){
      const file=formEl.querySelector('[name=upload]').files[0];
      const ext=file?.name.split('.').pop().toLowerCase();
      if(!file||file.size<1||file.size>10485760||!['pdf','doc','docx','ppt','pptx','xls','xlsx','txt','csv','zip','png','jpg','jpeg','stl'].includes(ext))throw Error('Choose a supported file up to 10 MB.');
      const path=`${session.user.id}/${crypto.randomUUID()}.${ext}`;
      const {error:uploadError}=await db.storage.from('club-documents').upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});
      if(uploadError)throw uploadError;
      const channel_id=payload.channel_id||null;
      const {data:doc,error:docError}=await db.from('documents').insert({channel_id,author_id:session.user.id,title:file.name,storage_path:path,file_type:ext.toUpperCase(),file_size:file.size}).select('id').single();
      if(docError){await db.storage.from('club-documents').remove([path]);throw docError;}
      if(channel_id){const {error:messageError}=await db.from('channel_messages').insert({channel_id,author_id:session.user.id,body:`Shared a document: ${file.name}`,document_id:doc.id});if(messageError)fail(messageError);}
      close();await refresh();show('Document shared with the club.');return;
    }
    if(kind==='project'){payload.owner_id=session.user.id;return await mutate(()=>db.from('projects').insert(payload));}
    if(kind==='projectEdit'){payload.progress=Math.min(100,Math.max(0,Number(payload.progress)||0));return await mutate(()=>db.from('projects').update(payload).eq('id',activeProject));}
    if(kind==='task'){payload.project_id=activeProject;if('assignee_id' in payload)payload.assignee_id=payload.assignee_id||null;if('milestone_id' in payload)payload.milestone_id=payload.milestone_id||null;return await mutate(()=>db.from('project_tasks').insert(payload));}
    if(kind==='topic'){payload.author_id=session.user.id;payload.project_id=payload.project_id||null;return await mutate(()=>db.from('topics').insert(payload));}
    if(kind==='reply'){payload.author_id=session.user.id;payload.topic_id=activeProject;return await mutate(()=>db.from('replies').insert(payload));}
    if(kind==='course'||kind==='event'||kind==='announcement'||kind==='founder'){
      if(!admin())throw Error('Only an administrator can publish this item.');
      if(kind==='event'&&new Date(payload.ends_at)<=new Date(payload.starts_at))throw Error('End time must be after start time.');
      if(kind==='founder')payload.sort_order=Number(payload.sort_order)||1;
      const table={course:'courses',event:'events',announcement:'announcements',founder:'founders'}[kind];
      return await mutate(()=>db.from(table).insert(payload));
    }
  }catch(error){fail(error);}finally{submitBtn.disabled=false;}
}
async function createMeetFor(kind,id) {
  const meeting=kind==='meeting',item=(cache[meeting?'founder_meetings':'events']||[]).find(x=>x.id===id);
  if(!item||item.meet_url||!(meeting?(founder()&&(item.host_id===session.user.id||admin())):admin()))return;
  if(!cfg.googleClientId)return show('Google Calendar connection is being set up. Add a Meet link manually for now.');
  if(!window.google?.accounts?.oauth2)return show('Google Calendar is still loading. Try again shortly.');
  try {
    const token=await new Promise((resolve,reject)=>{
      const client=window.google.accounts.oauth2.initTokenClient({client_id:cfg.googleClientId,
        scope:'https://www.googleapis.com/auth/calendar.events',
        callback:response=>response.error?reject(Error(response.error)):resolve(response.access_token),
        error_callback:()=>reject(Error('Google authorization was not completed.'))});
      client.requestAccessToken({prompt:'consent'});
    });
    const api='https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const body={summary:item.title,description:meeting?item.agenda:item.description,
      start:{dateTime:new Date(item.starts_at).toISOString()},end:{dateTime:new Date(item.ends_at).toISOString()},
      conferenceData:{createRequest:{requestId:crypto.randomUUID(),conferenceSolutionKey:{type:'hangoutsMeet'}}}};
    const response=await fetch(`${api}?conferenceDataVersion=1`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    let event=await response.json();if(!response.ok)throw Error(event.error?.message||'Google Calendar could not create the meeting.');
    const meetLink=()=>event.hangoutLink||event.conferenceData?.entryPoints?.find(p=>p.entryPointType==='video')?.uri;
    for(let attempt=0;!meetLink()&&attempt<4;attempt++){
      await new Promise(resolve=>setTimeout(resolve,850));
      const retry=await fetch(`${api}/${encodeURIComponent(event.id)}?conferenceDataVersion=1`,{headers:{Authorization:`Bearer ${token}`}});
      if(retry.ok)event=await retry.json();
    }
    if(!meetLink())throw Error('The Calendar event was created, but Google Meet is still preparing its link. Open Google Calendar to find the event.');
    const table=meeting?'founder_meetings':'events';
    const {error}=await db.from(table).update({meet_url:meetLink()}).eq('id',item.id);
    if(error){modal(`<h2>Meet created in Google Calendar</h2><p>The link could not be saved to the club yet. Keep this link and add it to the meeting:</p><p><a class="link" href="${esc(cleanUrl(meetLink()))}" target="_blank" rel="noopener noreferrer">${esc(meetLink())}</a></p>`);throw error;}
    await refresh();show('Google Meet created and added to the club calendar.');
  }catch(e){fail(e);}
}
function calendar(e,download=false){
  const start=new Date(e.starts_at),end=new Date(e.ends_at);
  const fmt=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  if(download){const encode=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');const content=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//InnovateX//Club Calendar//EN\r\nBEGIN:VEVENT\r\nUID:${e.id}@innovatex.club\r\nDTSTAMP:${fmt(new Date())}\r\nDTSTART:${fmt(start)}\r\nDTEND:${fmt(end)}\r\nSUMMARY:${encode(e.title)}\r\nDESCRIPTION:${encode(e.description)}\r\nLOCATION:${encode(e.meet_url||e.location)}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/calendar'}));a.download='innovatex-event.ics';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);return;}
  const url=new URL('https://calendar.google.com/calendar/render');url.searchParams.set('action','TEMPLATE');url.searchParams.set('text',e.title);url.searchParams.set('dates',`${fmt(start)}/${fmt(end)}`);url.searchParams.set('details',[e.description,e.meet_url].filter(Boolean).join('\n'));url.searchParams.set('location',e.location||e.meet_url||'');window.open(url.href,'_blank','noopener,noreferrer');
}
init();
