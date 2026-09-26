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
let session = null, me = null, cache = {}, page = 'home', activeProject = null, activeChannelId = null, pollTimer = null, presenceTimer = null, chatTimer = null, chatRealtime = null, authReady = false, communityReady = false;
let pendingEmail = sessionStorage.getItem('innovatex.pendingEmail') || '';
let toastTimer;
const pages = ['home','founders','members','channels','library','news','projects','discussions','courses','events','announcements','founder-room'];
const admin = () => me?.role === 'admin';
const founder = () => ['founder','admin'].includes(me?.role);
const show = (message) => { $('#toast').textContent=message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4200); };
const button = (label,action,extra='') => `<button class="button ${extra}" data-action="${action}">${label}</button>`;
const empty = (title,body) => `<div class="empty"><strong>${esc(title)}</strong>${esc(body)}</div>`;
const head = (label,title,subtitle,action='') => `<div class="page-head"><div><span class="eyebrow">${esc(label)}</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action}</div>`;
const avatar = (name,large=false) => `<span class="avatar ${large?'large':''}">${esc(initials(name))}</span>`;
const modal = (html) => { if($('#modal').open) $('#modal').close(); $('#modalContent').innerHTML=html; $('#modal').showModal(); };
const close = () => $('#modal').close();
const fail = (error) => { console.error(error); show(error?.message || 'Something went wrong. Please try again.'); };
const read = async (table,query=q=>q) => { const {data,error}=await query(db.from(table).select('*')); if(error) throw error; return data || []; };

async function refresh() {
  if (!db || !session) return;
  const names=['profiles','projects','project_tasks','topics','replies','courses','events','announcements','founders','channels','documents','channel_messages','news_posts','founder_invites','founder_meetings'];
  const results=await Promise.allSettled(names.map(n=>read(n,q=>q.order('created_at',{ascending:false}))));
  results.forEach((r,i)=>{ if(r.status==='fulfilled') cache[names[i]]=r.value; else console.error(names[i],r.reason); });
  communityReady=results[names.indexOf('channels')].status==='fulfilled';
  if(page==='channels' && document.activeElement?.closest('#chatComposer')) { renderChatMessages(); return; }
  render();
}
async function refreshChat() {
  if(!session || !communityReady) return;
  try { cache.channel_messages=await read('channel_messages',q=>q.order('created_at',{ascending:false}).limit(250));
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
    pendingEmail=''; sessionStorage.removeItem('innovatex.pendingEmail');
    const {data,error}=await db.from('profiles').select('*').eq('id',session.user.id).single();
    if(error) { fail(error); return; }
    me=data;
    await touchPresence();
    await refresh();
    pollTimer=setInterval(refresh,30000);
    presenceTimer=setInterval(()=>touchPresence(),20000);
    chatTimer=setInterval(refreshChat,9000);
    if(communityReady) chatRealtime=db.channel('innovatex-chat')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'channel_messages'},refreshChat).subscribe();
  } else { me=null; cache={}; if(!['home','founders'].includes(page)) page='home'; await loadPublic(); }
  if(page==='founder-room'&&!founder()) {page='founders';history.replaceState(null,'','#founders');}
  render();
}
async function init() {
  $('#todayLabel').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  $('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');
  $('#modal').addEventListener('click',e=>{ if(e.target===$('#modal')) close(); });
  $('.modal-close').onclick=close;
  window.addEventListener('hashchange',route);
  $('#authButton').onclick=()=>session ? signOut() : signInDialog();
  document.addEventListener('click',actions);
  document.addEventListener('submit',submit);
  route();
  if(!db) return;
  db.auth.onAuthStateChange((_event,s)=>{ if(s?.user.id !== session?.user.id) setTimeout(()=>signedIn(s),0); });
  const {data,error}=await db.auth.getSession();
  if(error) fail(error); else await signedIn(data.session);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && session) {touchPresence();refresh();} });
  window.addEventListener('pagehide',()=>{ if(session) touchPresence(false); });
}
function route() { const requested=location.hash.slice(1).split('/')[0] || 'home'; page=pages.includes(requested)?requested:'home'; if(!session && (authReady||!configured) && !['home','founders'].includes(page)) { page='home'; history.replaceState(null,'','#home'); show('Sign in to open the member workspace.'); } if(page==='founder-room'&&authReady&&!founder()) {page='founders';history.replaceState(null,'','#founders');show('The founder room is for accepted founders.');} $('#sidebar').classList.remove('open'); render(); }
function render() {
  $('#authButton').textContent=session?'Sign out':'Member sign in';
  $('#connectionLabel').textContent=!configured?'Setup required':session?'Member workspace live':'Public preview';
  $('#pageCrumb').textContent=page==='founder-room'?'Founder room':page[0].toUpperCase()+page.slice(1);
  document.querySelectorAll('#nav a').forEach(a=>{a.classList.toggle('active',a.dataset.page===page);a.hidden=!!a.dataset.private&&!session;});
  document.querySelectorAll('#nav [data-founder]').forEach(a=>a.hidden=!founder());
  document.querySelectorAll('#nav .nav-group').forEach(a=>a.hidden=!session);
  const online=(cache.profiles||[]).filter(p=>p.last_seen_at&&Date.now()-new Date(p.last_seen_at).getTime()<65000).length;
  $('#onlineBadge').textContent=online;
  const views={home,founders,members,channels,library,news,projects,discussions,courses,events,announcements,'founder-room':founderRoom};
  $('#content').innerHTML=views[page]();
  if(page==='channels'){const stream=$('#messageStream');if(stream)stream.scrollTop=stream.scrollHeight;}
}
function home() {
  const count=n=>(cache[n]||[]).length;
  const latest=(cache.announcements||[]).slice(0,3);
  const upcoming=(cache.events||[]).filter(e=>new Date(e.starts_at)>new Date()).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)).slice(0,3);
  return `<section class="hero"><div class="hero-copy"><span class="eyebrow">THE ENGINEERING COMMUNITY AT TTU</span><h1>Ideas become<br>working systems.</h1><p>Learn control, automation, electronics, software and robotics. Build prototypes together and prepare for regional and national competitions.</p><div class="hero-actions">${session?`<a class="button" href="#projects">Explore projects ↗</a>`:button('Join the workspace ↗','login')}<a class="button button-outline" href="#founders">Meet the founders</a></div></div><div class="hero-graphic">IX✦</div></section>
  <div class="section-heading"><div><span class="eyebrow">CLUB PULSE</span><h2>${session?'Your workspace at a glance':'Built for makers and innovators'}</h2></div><p>${session?`Welcome back, ${esc(me?.full_name||session.user.email)}.`:'An alumni initiated, student led engineering community.'}</p></div>
  <div class="grid grid-4"><div class="stat"><small>Members</small><b>${session?count('profiles'):'—'}</b><span>Across disciplines</span></div><div class="stat"><small>Online now</small><b>${session?(cache.profiles||[]).filter(p=>p.last_seen_at&&Date.now()-new Date(p.last_seen_at).getTime()<65000).length:'—'}</b><span>Active in the last minute</span></div><div class="stat"><small>Active projects</small><b>${session?count('projects'):'—'}</b><span>Ideas in motion</span></div><div class="stat"><small>Upcoming events</small><b>${session?upcoming.length:'—'}</b><span>Sessions and meetups</span></div></div>
  <div class="section-heading"><div><span class="eyebrow">OUR MISSION</span><h2>From the workbench to the world.</h2></div></div><div class="grid grid-3">${[['▤','Learn','Hands-on courses in Arduino, Proteus, CAD, OpenPLC and electrical systems.'],['▥','Build','Plan and test real prototypes with multidisciplinary teams and mentors.'],['✧','Compete','Turn the strongest projects into competition-ready demonstrations.']].map(x=>`<div class="card"><div class="icon-box">${x[0]}</div><h3>${x[1]}</h3><p>${x[2]}</p></div>`).join('')}</div>
  ${session?`<div class="section-heading"><h2>Your community</h2><p>Find a conversation or share what you’re learning.</p></div><div class="grid grid-3"><a class="card feature-card" href="#channels"><span class="feature-icon">▣</span><h3>Member channels</h3><p>Get help and work through ideas together.</p><span class="link">Open channels →</span></a><a class="card feature-card" href="#library"><span class="feature-icon">▤</span><h3>Document library</h3><p>Notes, schematics and useful resources in one place.</p><span class="link">Browse files →</span></a><a class="card feature-card" href="#news"><span class="feature-icon">◈</span><h3>Technology news</h3><p>Discover engineering stories worth discussing.</p><span class="link">Read stories →</span></a></div>`:''}
  ${session?`<div class="section-heading"><h2>What’s happening</h2><a class="link" href="#events">View calendar →</a></div><div class="split"><div class="panel"><h3>Latest alerts</h3>${latest.length?latest.map(a=>`<div class="list-item"><span class="icon-box" style="margin:0">◈</span><div><strong>${esc(a.title)}</strong><small>${date(a.created_at)}</small><p class="subtle">${esc(a.body)}</p></div></div>`).join(''):empty('No alerts yet','Official club updates will appear here.')}</div><div class="panel"><h3>Coming up</h3>${upcoming.length?upcoming.map(e=>eventRow(e)).join(''):empty('Nothing scheduled','The next club event will appear here.')}</div></div>`:''}`;
}
function founders() {
  const list=cache.founders||[];
  return `${head('THE PEOPLE BEHIND THE IDEA','Founding team','A four-person team shaping InnovateX with student leaders and university guidance.',admin()?button('+ Add founder','founderForm'):'')}
  <div class="notice">Founder profiles are added only after each person agrees to be listed. The Dean of Students’ Affairs has been invited to serve as patron; patronage is pending acceptance.</div>
  <div class="founder-invite-banner"><div><span class="eyebrow">FOUNDER ACCESS</span><h3>Build the club together.</h3><p>Accepted founders sign in with their invited email, accept the invitation, and meet in a private founder room.</p></div>${session?`<a class="button" href="${founder()?'#founder-room':'#members'}">${founder()?'Open founder room':'View my invitation'} →</a>`:button('Founder sign in','login')}</div>
  <div class="section-heading"><h2>Meet the founders</h2></div><div class="grid grid-4">${list.length?list.map(f=>`<div class="card founder-card">${avatar(f.name,true)}<div class="role">${esc(f.role)}</div><h3>${esc(f.name)}</h3><p>${esc(f.bio||'Founding team member')}</p>${f.link_url?`<a class="link" target="_blank" rel="noopener noreferrer" href="${esc(cleanUrl(f.link_url))}">Profile ↗</a>`:''}</div>`).join(''):[1,2,3,4].map((n)=>`<div class="card founder-card">${avatar('IX',true)}<div class="role">Founding member ${n}</div><h3>Profile coming soon</h3><p>We’ll introduce each founder after the team confirms their details.</p></div>`).join('')}</div><div class="section-heading"><h2>How the club is led</h2></div><div class="grid grid-3"><div class="card"><h3>Student executive</h3><p>Elected students lead training, projects, communications and finance.</p></div><div class="card"><h3>Founding advisers</h3><p>Founders help with continuity, mentoring and partnerships.</p></div><div class="card"><h3>Proposed patron</h3><p>The Dean of Students’ Affairs has been invited to guide the club, subject to acceptance.</p></div></div>`;
}
function members() {
  const people=cache.profiles||[]; const online=p=>p.last_seen_at&&Date.now()-new Date(p.last_seen_at).getTime()<65000;
  const invite=(cache.founder_invites||[]).find(i=>i.email===session?.user.email?.toLowerCase()&&!i.accepted_at);
  return `${head('COMMUNITY','Members','See who is around and connect with the people building InnovateX.',button('Edit my profile','profileForm'))}
  ${invite?`<div class="founder-invite-banner"><div><span class="eyebrow">FOUNDER INVITATION</span><h3>You’ve been invited to join the founding team.</h3><p>Accept with your verified account to open founder meetings and planning.</p></div>${button('Accept invitation','acceptFounder')}</div>`:''}
  <div class="grid grid-4"><div class="stat"><small>Registered members</small><b>${people.length}</b><span>Club workspace</span></div><div class="stat"><small>Online now</small><b>${people.filter(online).length}</b><span>Seen within 65 seconds</span></div></div><div class="section-heading"><h2>Member directory</h2><p>Presence updates while the workspace is open.</p></div><div class="profile-grid">${people.length?people.sort((a,b)=>Number(online(b))-Number(online(a))).map(p=>`<div class="card person">${avatar(p.full_name||p.email)}<div><h3>${esc(p.full_name||'New member')}</h3><p class="subtle">${esc(p.programme||'Member')} ${p.skills?'· '+esc(p.skills):''}</p></div>${online(p)?'<span class="online-dot" title="Online"></span>':''}</div>`).join(''):empty('No members yet','Member profiles will appear after signup.')}</div>`;
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
  return `${head('LEARN BY DOING','Courses','Find workshops, resources and guided learning pathways.',admin()?button('+ Publish course','courseForm'):'')}
  <div class="grid grid-3">${list.length?list.map(c=>`<div class="card"><span class="tag blue">${esc(c.level)}</span><h3 style="margin-top:18px">${esc(c.title)}</h3><p>${esc(c.description||'Details coming soon.')}</p><div class="pill-row"><span class="subtle">${esc(c.category)}</span></div><div class="card-footer"><span>${date(c.starts_at)}</span>${c.resource_url?`<a class="link" href="${esc(cleanUrl(c.resource_url))}" target="_blank" rel="noopener noreferrer">Resources ↗</a>`:''}</div></div>`).join(''):empty('Courses are being prepared','The training team will publish upcoming workshops here.')}</div>`;
}
function eventRow(e) {return `<div class="list-item"><div class="event-date"><b>${new Date(e.starts_at).getDate()}</b><small>${new Date(e.starts_at).toLocaleString(undefined,{month:'short'})}</small></div><div><strong>${esc(e.title)}</strong><small>${dateTime(e.starts_at)} · ${esc(e.location||'Online')}</small></div></div>`;}
function events() {
  const list=(cache.events||[]).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  return `${head('MAKE TIME TO BUILD','Events calendar','Workshops, project reviews, club meetings and demo days.',admin()?button('+ Schedule event','eventForm'):'')}
  <div class="grid grid-2">${list.length?list.map(e=>`<div class="card"><div class="row"><span class="tag ${new Date(e.starts_at)<new Date()?'gold':''}">${new Date(e.starts_at)<new Date()?'Past event':'Upcoming'}</span><span class="subtle">${dateTime(e.starts_at)}</span></div><h3 style="margin-top:18px">${esc(e.title)}</h3><p>${esc(e.description||'')}</p><div class="meta"><span>◷ ${dateTime(e.starts_at)}</span><span>⌁ ${esc(e.location||'Online')}</span></div><div class="card-footer"><div>${e.meet_url?`<a class="link" href="${esc(cleanUrl(e.meet_url))}" target="_blank" rel="noopener noreferrer">Join Google Meet ↗</a>`:''}</div><div><button class="text-button" data-action="calendar" data-id="${esc(e.id)}">Add to calendar</button> · <button class="text-button" data-action="ics" data-id="${esc(e.id)}">ICS</button></div></div></div>`).join(''):empty('No events yet','Events will appear here when the team sets the schedule.')}</div>`;
}
function announcements() {
  const list=cache.announcements||[];
  return `${head('STAY INFORMED','Club alerts','Important updates, deadlines and opportunities.',admin()?button('+ Post alert','announcementForm'):'')}
  <div class="grid">${list.length?list.map(a=>`<div class="card"><div class="row"><span class="tag ${a.priority==='urgent'?'gold':''}">${esc(a.priority)}</span><span class="subtle">${date(a.created_at)}</span></div><h3 style="margin-top:15px">${esc(a.title)}</h3><p class="detail">${esc(a.body)}</p></div>`).join(''):empty('No alerts yet','Official updates will appear here.')}</div>`;
}

const communityNotice = () => `<div class="notice">Community features are ready in the site. An administrator needs to run the Supabase community upgrade before they can be used.</div>`;
const memberName = id => (cache.profiles||[]).find(p=>p.id===id)?.full_name || 'Member';
const fileSize = bytes => bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${Math.ceil(bytes/1024)} KB`;
function channels() {
  if(!communityReady) return head('COMMUNITY','Channels','Talk and build together.')+communityNotice();
  const list=(cache.channels||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));
  if(!list.some(c=>c.id===activeChannelId)) activeChannelId=list[0]?.id||null;
  const selected=list.find(c=>c.id===activeChannelId);
  return `${head('CLUB CONVERSATIONS','Channels','Focused spaces for ideas, help and project updates.',admin()?button('+ Create channel','channelForm'):'')}
    <div class="chat-layout"><div class="channel-list"><div class="channel-label">YOUR CHANNELS</div>${list.map(c=>`<button class="channel-button ${c.id===activeChannelId?'selected':''}" data-action="selectChannel" data-id="${esc(c.id)}"><strong># ${esc(c.name)}</strong><small>${esc(c.description)}</small></button>`).join('')}</div>
    <div class="chat-panel">${selected?`<div class="chat-head"><div><h2># ${esc(selected.name)}</h2><p>${esc(selected.description)}</p></div>${button('Share file','shareDoc','button-outline button-sm')}</div><div id="messageStream" class="message-stream" aria-live="polite">${messageList()}</div><form id="chatComposer" class="chat-composer"><label class="sr-only" for="chatBody">Message</label><input id="chatBody" name="body" maxlength="3000" placeholder="Message #${esc(selected.name)}" required autocomplete="off"><button class="button" type="submit">Send ↗</button></form>`:empty('No channels yet','An administrator can add the first channel.')}</div></div>`;
}
function messageList() {
  const list=(cache.channel_messages||[]).filter(m=>m.channel_id===activeChannelId).slice().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).slice(-100);
  return list.length?list.map(m=>{const doc=(cache.documents||[]).find(d=>d.id===m.document_id);return `<div class="chat-message">${avatar(memberName(m.author_id))}<div><div class="message-meta"><strong>${esc(memberName(m.author_id))}</strong><time>${dateTime(m.created_at)}</time></div><p>${esc(m.body)}</p>${doc?`<button class="attachment" data-action="downloadDoc" data-id="${esc(doc.id)}">▤ ${esc(doc.title)} <small>${fileSize(doc.file_size)}</small></button>`:''}</div></div>`}).join(''):empty('No messages yet','Be the first to start the conversation.');
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
  <div class="notice">Files are available only to signed-in members. Maximum size: 10 MB. Share only files you have permission to distribute.</div>
  <div class="grid grid-3" style="margin-top:22px">${docs.length?docs.map(d=>`<div class="card document-card"><span class="feature-icon">▤</span><h3>${esc(d.title)}</h3><p>Shared by ${esc(memberName(d.author_id))} · ${date(d.created_at)}</p><div class="meta">${d.channel_id?`<span># ${esc((cache.channels||[]).find(c=>c.id===d.channel_id)?.name||'Channel')}</span>`:''}<span>${fileSize(d.file_size)}</span></div><div class="card-footer"><span>${esc(d.file_type||'Document')}</span><button class="text-button" data-action="downloadDoc" data-id="${esc(d.id)}">Open file ↗</button></div></div>`).join(''):empty('No files shared yet','Upload the first project note or useful resource.')}</div>`;
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
function newsCard(n,pending=false) {return `<div class="card news-card"><div class="row"><span class="tag ${pending?'gold':'blue'}">${pending?'Pending review':esc(n.category)}</span><span class="subtle">${date(n.created_at)}</span></div><h3>${esc(n.title)}</h3><p>${esc(n.summary)}</p><div class="card-footer"><span>By ${esc(memberName(n.submitted_by))}</span>${pending&&admin()?`<div><button class="text-button" data-action="reviewNews" data-status="published" data-id="${esc(n.id)}">Publish</button> · <button class="text-button" data-action="reviewNews" data-status="rejected" data-id="${esc(n.id)}">Reject</button></div>`:pending?'<span>Awaiting approval</span>':`<a class="link" href="${esc(cleanUrl(n.url))}" target="_blank" rel="noopener noreferrer">Read source ↗</a>`}</div></div>`;}
function founderRoom() {
  if(!founder()) return head('FOUNDING TEAM','Founder room','For accepted founders.')+empty('Founder access required','Accept an invitation to enter this room.');
  if(!communityReady) return head('FOUNDING TEAM','Founder room','Private planning and meetings.')+communityNotice();
  const meetings=(cache.founder_meetings||[]).slice().sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  const invites=cache.founder_invites||[];
  return `${head('FOUNDING TEAM','Founder room','A private place for accepted founders to plan and meet.',button('+ Schedule meeting','founderMeetingForm'))}
  <div class="founder-invite-banner"><div><span class="eyebrow">PRIVATE SPACE</span><h3>Keep the founding team aligned.</h3><p>Schedule a Google Meet, share an agenda and add meetings to your calendar. Only accepted founders and administrators can view this space.</p></div><span class="founder-mark">IX✦</span></div>
  ${admin()?`<div class="section-heading"><h2>Founder invitations</h2>${button('+ Invite founder','inviteFounder','button-outline button-sm')}</div><div class="card"><div class="invite-list">${invites.length?invites.map(i=>`<div class="list-item"><div><strong>${esc(i.email)}</strong><small>${i.accepted_at?'Accepted '+date(i.accepted_at):'Waiting for founder to sign in and accept'}</small></div><span class="tag ${i.accepted_at?'':'gold'}">${i.accepted_at?'Accepted':'Pending'}</span></div>`).join(''):empty('No invitations yet','Invite founders using the email they will sign in with.')}</div></div>`:''}
  <div class="section-heading"><h2>Meetings</h2><p>Private meeting links are shown only in this room.</p></div><div class="grid grid-2">${meetings.length?meetings.map(m=>`<div class="card"><div class="row"><span class="tag ${new Date(m.starts_at)<new Date()?'gold':''}">${new Date(m.starts_at)<new Date()?'Past meeting':'Upcoming'}</span><span class="subtle">${dateTime(m.starts_at)}</span></div><h3 style="margin-top:17px">${esc(m.title)}</h3><p>${esc(m.agenda||'Agenda to follow.')}</p><div class="meta"><span>◷ ${dateTime(m.starts_at)}</span><span>Hosted by ${esc(memberName(m.host_id))}</span></div><div class="card-footer"><div>${m.meet_url?`<a class="link" href="${esc(cleanUrl(m.meet_url))}" target="_blank" rel="noopener noreferrer">Join Google Meet ↗</a>`:'Meet link to follow'}</div><div><button class="text-button" data-action="founderCalendar" data-id="${esc(m.id)}">Calendar</button> · <button class="text-button" data-action="founderIcs" data-id="${esc(m.id)}">ICS</button></div></div></div>`).join(''):empty('No founder meetings yet','Schedule a planning call for the founding team.')}</div>`;
}

function field(label,name,type='text',value='',required=true) {return `<div class="field"><label for="${name}">${esc(label)}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''}></div>`;}
function area(label,name,value='') {return `<div class="field"><label for="${name}">${esc(label)}</label><textarea id="${name}" name="${name}" required>${esc(value)}</textarea></div>`;}
function select(label,name,options,current='') {return `<div class="field"><label for="${name}">${esc(label)}</label><select id="${name}" name="${name}">${options.map(x=>`<option value="${esc(x)}" ${x===current?'selected':''}>${esc(x)}</option>`).join('')}</select></div>`;}
function form(title,description,kind,fields) {modal(`<span class="eyebrow">INNOVATEX WORKSPACE</span><h2>${title}</h2><p class="muted">${description}</p><form id="editor" data-kind="${kind}" class="form-stack">${fields}<button class="button" type="submit">Save ${title.toLowerCase()}</button></form>`);}
function signInDialog() {
  if(!configured) return show('Add your Supabase URL and publishable key to config.js first.');
  if(pendingEmail) return codeDialog();
  modal(`<span class="eyebrow">INNOVATEX ENGINEERING CLUB</span><h2>Join or sign in</h2><p class="muted">Enter your email. We’ll send a one-time verification code to create your account or sign you in.</p><form id="editor" data-kind="login" class="form-stack">${field('Email address','email','email')}<button class="button" type="submit">Send verification code</button></form>`);
}
function codeDialog() {
  modal(`<span class="eyebrow">INNOVATEX ENGINEERING CLUB</span><h2>Verify your email</h2><p class="muted">Enter the code sent to <strong>${esc(pendingEmail)}</strong>.</p><form id="editor" data-kind="verify" class="form-stack"><div class="field"><label for="code">Verification code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" placeholder="Your code" required></div><button class="button" type="submit">Verify and enter</button></form><div class="otp-actions"><button class="text-button" data-action="resendCode">Resend code</button><button class="text-button" data-action="changeEmail">Use another email</button></div><p class="hint">Only the latest code will work. Check your spam folder if you don't see the email.</p>`);
  $('#code').focus();
}
async function requestCode(email) {
  const {error}=await db.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:location.origin+location.pathname}});
  if(error) throw error;
  pendingEmail=email;
  sessionStorage.setItem('innovatex.pendingEmail',email);
  codeDialog();
  show('Verification code sent. Check your email.');
}
function projectDetail(id) {
  const p=(cache.projects||[]).find(x=>x.id===id); if(!p)return;
  activeProject=id; const tasks=(cache.project_tasks||[]).filter(t=>t.project_id===id); const can=admin()||p.owner_id===session?.user.id;
  const threads=(cache.topics||[]).filter(t=>t.project_id===id);
  modal(`<span class="tag">${esc(p.status)}</span><h2 style="margin-top:15px">${esc(p.title)}</h2><p>${esc(p.summary||'')}</p><p class="subtle">${esc(p.description||'')}</p><div class="progress"><span style="width:${Math.max(0,Math.min(100,Number(p.progress)||0))}%"></span></div><div class="row"><h3>Project plan</h3>${can?button('+ Add task','taskForm','button-sm'):''}</div><div class="list">${tasks.length?tasks.map(t=>`<div class="list-item"><span class="tag ${t.status==='done'?'':'gold'}">${esc(t.status)}</span><div><strong>${esc(t.title)}</strong><small>${t.due_at?'Due '+date(t.due_at):'No due date'}</small></div>${can&&t.status!=='done'?`<button class="text-button" data-action="taskDone" data-id="${esc(t.id)}">Mark done</button>`:''}</div>`).join(''):empty('No tasks yet','Break this project into small, testable steps.')}</div><div class="row" style="margin-top:22px"><h3>Project discussions</h3><button class="text-button" data-action="projectTopic" data-id="${esc(id)}">Start discussion +</button></div>${threads.length?threads.map(t=>`<div class="list-item"><div><strong>${esc(t.title)}</strong><small>${date(t.created_at)}</small></div><button class="text-button" data-action="topicDetail" data-id="${esc(t.id)}">Open →</button></div>`).join(''):'<p class="muted">No project discussions yet.</p>'}${can?`<div class="profile-action">${button('Update project','projectEdit','button-outline button-sm')}</div>`:''}`);
}
function topicDetail(id) {const t=(cache.topics||[]).find(x=>x.id===id);if(!t)return;const list=(cache.replies||[]).filter(x=>x.topic_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));modal(`<span class="tag">${esc(t.category)}</span><h2 style="margin-top:15px">${esc(t.title)}</h2><p>${esc(t.body)}</p><h3>Replies (${list.length})</h3><div style="max-height:300px;overflow:auto">${list.map(r=>`<div class="reply"><strong>${esc((cache.profiles||[]).find(p=>p.id===r.author_id)?.full_name||'Member')}</strong><span class="subtle"> · ${dateTime(r.created_at)}</span><p>${esc(r.body)}</p></div>`).join('')||'<p class="muted">Be the first to reply.</p>'}</div><form id="editor" data-kind="reply" class="form-stack">${area('Your reply','body')}<button class="button" type="submit">Post reply</button></form>`);}
async function signOut() {try{await touchPresence(false);const {error}=await db.auth.signOut();if(error)throw error;await signedIn(null);show('Signed out. See you soon.');}catch(e){fail(e);}}

function actions(e) {
  const el=e.target.closest('[data-action]'); if(!el)return; const action=el.dataset.action,id=el.dataset.id;
  if(action==='login')return signInDialog();
  if(action==='selectChannel'){activeChannelId=id;render();const stream=$('#messageStream');if(stream)stream.scrollTop=stream.scrollHeight;return;}
  if(action==='shareDoc'){
    if(!communityReady)return show('Run the Supabase community upgrade first.');
    const options='<option value="">Library only</option>'+(cache.channels||[]).map(c=>`<option value="${esc(c.id)}" ${c.id===activeChannelId&&page==='channels'?'selected':''}># ${esc(c.name)}</option>`).join('');
    return modal(`<span class="eyebrow">CLUB LIBRARY</span><h2>Share a document</h2><p class="muted">Files are private to signed-in club members. Maximum size: 10 MB.</p><form id="editor" data-kind="document" class="form-stack"><div class="field"><label for="upload">Choose a file</label><input id="upload" name="upload" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip,.png,.jpg,.jpeg,.stl" required></div><div class="field"><label for="channel_id">Share in channel</label><select id="channel_id" name="channel_id">${options}</select></div><button class="button" type="submit">Upload document</button></form>`);
  }
  if(action==='downloadDoc')return downloadDocument(id);
  if(action==='channelForm')return form('Channel','Create a focused place for members to collaborate.','channel',field('Channel name','name')+field('Short description','description'));
  if(action==='newsForm')return form('Technology article','Share the source and explain why it matters to the club. Administrators review submissions.','news',field('Headline','title')+field('Article link','url','url')+select('Topic','category',['Technology','Robotics','AI','Energy','Electronics','Software','Research'])+area('Why it matters','summary'));
  if(action==='reviewNews')return reviewNews(id,el.dataset.status);
  if(action==='inviteFounder')return form('Founder invitation','Use the email address this founder will use to sign in.','founderInvite',field('Founder email','email','email'));
  if(action==='acceptFounder')return acceptFounder();
  if(action==='founderMeetingForm')return form('Founder meeting','Add the Google Meet link and an agenda for accepted founders.','founderMeeting',field('Meeting title','title')+area('Agenda','agenda')+field('Start','starts_at','datetime-local')+field('End','ends_at','datetime-local')+field('Google Meet URL','meet_url','url','',false));
  if(action==='founderCalendar'||action==='founderIcs'){const m=(cache.founder_meetings||[]).find(x=>x.id===id);if(m)calendar({...m,description:m.agenda,location:'Online'},action==='founderIcs');return;}
  if(action==='changeEmail'){pendingEmail='';sessionStorage.removeItem('innovatex.pendingEmail');return signInDialog();}
  if(action==='resendCode')return requestCode(pendingEmail).catch(fail);
  if(action==='profileForm')return form('My profile','Help other members recognize your work.','profile',field('Full name','full_name','text',me?.full_name||'')+field('Programme / department','programme','text',me?.programme||'',false)+field('Skills / interests','skills','text',me?.skills||'',false));
  if(action==='projectForm')return form('New project','Start with a clear problem and the first test.','project',field('Project title','title')+field('One-line summary','summary')+area('Description and goal','description'));
  if(action==='projectDetail')return projectDetail(id);
  if(action==='projectEdit'){const p=(cache.projects||[]).find(x=>x.id===activeProject);return form('Update project','Keep the plan current.','projectEdit',field('Title','title','text',p.title)+field('Summary','summary','text',p.summary)+area('Description','description',p.description)+select('Status','status',['planning','building','testing','complete'],p.status)+field('Progress 0–100','progress','number',p.progress));}
  if(action==='taskForm')return form('Project task','Make the next step specific.','task',field('Task title','title')+field('Due date','due_at','date','',false));
  if(action==='taskDone')return mutate(async()=>db.from('project_tasks').update({status:'done'}).eq('id',id).select().single());
  if(action==='topicForm'||action==='projectTopic'){
    const options=['<option value="">Club-wide discussion</option>',...(cache.projects||[]).map(p=>`<option value="${esc(p.id)}" ${p.id===id?'selected':''}>${esc(p.title)}</option>`)].join('');
    return form('New discussion','Ask a focused question or share a decision.','topic',field('Title','title')+`<div class="field"><label for="project_id">Project</label><select id="project_id" name="project_id">${options}</select></div>`+select('Category','category',['General','Project idea','Technical help','Competition','Workshop'])+area('Your message','body'));
  }
  if(action==='topicDetail'){activeProject=id;return topicDetail(id);}
  if(action==='courseForm')return form('Course','Publish a workshop or learning resource.','course',field('Title','title')+select('Category','category',['Automation','Electronics','Embedded systems','Robotics','CAD','Software'])+select('Level','level',['Beginner','Intermediate','Advanced'])+area('Description','description')+field('Start date','starts_at','date','',false)+field('Resource URL','resource_url','url','',false));
  if(action==='eventForm')return form('Event','The calendar and meeting link stay together.','event',field('Title','title')+area('Description','description')+field('Start','starts_at','datetime-local')+field('End','ends_at','datetime-local')+field('Location','location','text','',false)+field('Google Meet URL','meet_url','url','',false));
  if(action==='announcementForm')return form('Alert','Important updates appear on the home page.','announcement',field('Title','title')+select('Priority','priority',['normal','urgent'])+area('Message','body'));
  if(action==='founderForm')return form('Founder','Publish only approved biographical details.','founder',field('Name','name')+field('Role','role')+area('Short bio','bio')+field('Profile URL','link_url','url','',false)+field('Order','sort_order','number','1'));
  if(action==='calendar'||action==='ics'){const item=(cache.events||[]).find(x=>x.id===id);if(item)calendar(item,action==='ics');}
}
async function mutate(fn) {try{const {error}=await fn();if(error)throw error;close();await refresh();show('Saved successfully.');}catch(e){fail(e);}}
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
async function submit(e) {
  if(e.target.id==='chatComposer'){
    e.preventDefault(); if(!session||!activeChannelId)return;
    const input=e.target.querySelector('[name=body]'),body=input.value.trim(),send=e.target.querySelector('[type=submit]');
    if(!body)return;send.disabled=true;
    try {const {error}=await db.from('channel_messages').insert({channel_id:activeChannelId,author_id:session.user.id,body});if(error)throw error;input.value='';await refreshChat();}
    catch(error){fail(error);}finally{send.disabled=false;}return;
  }
  if(e.target.id!=='editor')return; e.preventDefault(); if(!db)return;
  const formEl=e.target,kind=formEl.dataset.kind,values=Object.fromEntries(new FormData(formEl));
  const submitBtn=formEl.querySelector('[type=submit]'); submitBtn.disabled=true;
  try {
    if(kind==='login'){await requestCode(String(values.email).trim().toLowerCase());return;}
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
    if(kind==='profile')return await mutate(()=>db.from('profiles').update(payload).eq('id',session.user.id));
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
    if(kind==='task'){payload.project_id=activeProject;return await mutate(()=>db.from('project_tasks').insert(payload));}
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
function calendar(e,download=false){
  const start=new Date(e.starts_at),end=new Date(e.ends_at);
  const fmt=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  if(download){const encode=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');const content=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//InnovateX//Club Calendar//EN\r\nBEGIN:VEVENT\r\nUID:${e.id}@innovatex.club\r\nDTSTAMP:${fmt(new Date())}\r\nDTSTART:${fmt(start)}\r\nDTEND:${fmt(end)}\r\nSUMMARY:${encode(e.title)}\r\nDESCRIPTION:${encode(e.description)}\r\nLOCATION:${encode(e.meet_url||e.location)}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/calendar'}));a.download='innovatex-event.ics';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);return;}
  const url=new URL('https://calendar.google.com/calendar/render');url.searchParams.set('action','TEMPLATE');url.searchParams.set('text',e.title);url.searchParams.set('dates',`${fmt(start)}/${fmt(end)}`);url.searchParams.set('details',[e.description,e.meet_url].filter(Boolean).join('\n'));url.searchParams.set('location',e.location||e.meet_url||'');window.open(url.href,'_blank','noopener,noreferrer');
}
init();
