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
let session = null, me = null, cache = {}, page = 'home', activeProject = null, activeChannelId = null, activeThreadId = null, activeReportTarget = null, pollTimer = null, presenceTimer = null, chatTimer = null, chatRealtime = null, authReady = false, communityReady = false, enhancedReady = false, feedReady = false, dmReady = false, mediaReady = false, avatarReady = false, roleReady = false, learningReady = false, courseReady = false, coursePlanningReady = false, teacherProfileReady = false, teacherProfile = null, privacyReady = false, inventoryReady = false, inventoryCatalogReady = false, financeReady = false, financeApprovalsReady = false, activePeerId = null, lastRenderedPage = '';
let adminAlertTimer = null, adminAlertDismissTimer = null, adminAudioContext = null, adminDeferredAlert = null;
let deferredInstallPrompt = null;
let memberNoticeRealtime = null, memberAlertTimer = null, memberAlertNotificationId = null, memberDeferredNotification = null, memberNotificationPrimed = false;
let inboxUnreadCount = null, inboxCountRequest = 0, pushBusy = false;
let adminPendingCount = 0, adminAlertsInitialized = false, adminSoundEnabled = false;
let adminSeenApplicationIds = new Set();
let adminAlertPolling = false;
let authGeneration = 0;
let inventoryFilter = 'all', inventorySearchTerm = '', financeFilter = 'all', inventoryLogPage = 0, financePage = 0, financeReviewPage = 0;
let memberDirectoryPage = 0, projectListPage = 0;
let applicationsPage = 0, approvedAccountsPage = 0, applicationsOwner = null, applicationsLoading = false, applicationsError = '';
let applicationRows = [], approvedAccountRows = [], applicationTotal = 0, approvedAccountTotal = 0, applicationsRequest = 0;
let applicationVerification = new Map(), applicationVerificationError = '';
let applicationAnswersReady = false;
let feedPage = 0, feedTotal = 0, feedLoading = false, feedError = '', feedOwner = null, feedRequest = 0;
let channelPage = 0, channelTotal = 0, channelHistoryId = null, channelHistoryRows = [], channelHistoryReactions = [], channelHistoryLoading = false, channelHistoryError = '', channelRequest = 0;
let dmPage = 0, dmTotal = 0, dmThreadPeer = null, dmThreadRows = [], dmThreadLoading = false, dmThreadError = '', dmRequest = 0;
let unreadCounts = {channels:{},direct_messages:{},direct_peers:[],direct_total:0}, unreadCountsReady = false;
let calendarMonth = new Date(new Date().getFullYear(),new Date().getMonth(),1), calendarSelected = new Date();
let courseTrack = 'all', courseView = 'mine', activeCourseId = null, courseDetailView = 'overview';
const courseTracks = [
  {name:'Controls and Automation',example:'Build a sensor-driven controller, PLC sequence or motor control system.'},
  {name:'Software and Programming',example:'Code a working app, dashboard, embedded interface or automation tool.'},
  {name:'Electronics and Robotics',example:'Assemble and test a circuit, mobile robot or connected device.'},
  {name:'AI & Machine Learning',example:'Train and evaluate a model using real data and a usable prototype.'}
];
const proposedWorkshops = [
  {track:'Controls and Automation',title:'Build a feedback controller for a small fan',detail:'Compare sensor readings and a setpoint, test a safe low-voltage output, and record what changed when feedback was enabled.'},
  {track:'Software and Programming',title:'Turn sensor readings into a useful dashboard',detail:'Build a responsive display with time-stamped readings, history, connection state, and a tested threshold alert.'},
  {track:'Electronics and Robotics',title:'Calibrate and test a small line-following robot',detail:'Map and calibrate sensors, tune steering, then log three repeatable trials and a recovery from a lost line.'},
  {track:'AI & Machine Learning',title:'Classify simple device states from sensor data',detail:'Build a baseline and a small classifier, compare held-out results, and explain uncertainty in the prototype.'}
];
const courseTrackFor = c => ({Automation:'Controls and Automation',Electronics:'Electronics and Robotics','Embedded systems':'Electronics and Robotics',Robotics:'Electronics and Robotics',CAD:'Software and Programming',Software:'Software and Programming'}[c.category]||c.category);
const mediaUrls = new Map();
const mediaUrl = path => path && mediaUrls.get(path)?.url || '';
async function hydrateMedia(extraPaths=[]) {
  if(!mediaReady)return false;
  const paths=[...(cache.profiles||[]).slice(0,150).map(p=>p.avatar_path),...extraPaths,...[...(cache.activity_posts||[]).slice(0,80),...(cache.channel_messages||[]).slice(0,180),...(cache.direct_messages||[]).slice(0,160),...channelHistoryRows,...dmThreadRows].map(x=>x.image_path)].filter(Boolean);
  const missing=[...new Set(paths)].filter(p=>!mediaUrls.has(p)||mediaUrls.get(p).expires<Date.now()+60000);
  if(!missing.length)return false;
  const {data,error}=await db.storage.from('club-media').createSignedUrls(missing,900);
  if(error){console.error(error);return false;}
  for(const [i,item] of (data||[]).entries())if(item.signedUrl)mediaUrls.set(item.path||missing[i],{url:item.signedUrl,expires:Date.now()+900000});
  return true;
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
let pendingProtectedPage = '';
let founderPortraitReady = false;
let toastTimer;
const pages = ['home','about','founders','investors','investor-portal','admin','privacy','application','applications','moderation','notifications','members','messages','feed','channels','library','news','projects','inventory','finance','finance-review','discussions','courses','teaching','events','calendar','announcements','founder-room'];
const approved = () => !!me && (!('membership_status' in me) || me.membership_status==='approved');
const investor = () => approved() && me?.role==='investor';
const clubAccess = () => approved() && !investor();
const teacher = () => clubAccess() && (['teacher','admin'].includes(me?.role)||me?.role==='founder'&&me?.founder_teaching_enabled===true);
const admin = () => approved() && me?.role === 'admin';
const founder = () => approved() && ['founder','admin'].includes(me?.role);
const founderOnly = () => approved() && me?.role === 'founder';
const accessSignature = p => `${p?.membership_status}:${p?.role}:${p?.founder_teaching_enabled===true}`;
const show = (message) => { $('#toast').textContent=message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4200); };
function updateAdminAlertControls(){
  const visible=admin();
  const bell=$('#adminBell'),sound=$('#adminSoundButton'),count=$('#adminBellCount');
  bell.hidden=!visible;sound.hidden=!visible;
  count.textContent=adminPendingCount>99?'99+':adminPendingCount;
  count.hidden=!visible||!adminPendingCount;
  bell.setAttribute('aria-label',`${adminPendingCount} account${adminPendingCount===1?'':'s'} awaiting approval. Review applications`);
  sound.setAttribute('aria-pressed',String(adminSoundEnabled));
  sound.setAttribute('aria-label',adminSoundEnabled?'Disable application alert sounds':'Enable application alert sounds');
  sound.title=adminSoundEnabled?'Application alert sounds on':'Application alert sounds off';
  sound.classList.toggle('active',adminSoundEnabled);
}
function dismissAdminAlert(){clearTimeout(adminAlertDismissTimer);adminDeferredAlert=null;$('#adminAlert').hidden=true;}
function dismissMemberAlert(){clearTimeout(memberAlertTimer);memberAlertNotificationId=null;$('#memberAlert').hidden=true;}
function updateInboxIndicators(){
  const count=clubAccess()?(inboxUnreadCount??(cache.notifications||[]).filter(n=>!n.read_at).length):0;
  const bell=$('#memberBell'),bubble=$('#memberBellCount');
  bell.hidden=!clubAccess()||!enhancedReady;
  bell.setAttribute('aria-label',`${count} unread club ${count===1?'update':'updates'}. Open inbox`);
  bubble.textContent=count>99?'99+':String(count);
  bubble.hidden=!count;
  bell.classList.toggle('has-unread',count>0);
  $('#notificationBadge').textContent=count;
  void window.InnovateXPush?.updateBadge(count);
}
async function refreshInboxUnreadCount(){
  const owner=session?.user.id,request=++inboxCountRequest;
  if(!owner||!clubAccess()||!enhancedReady){inboxUnreadCount=null;updateInboxIndicators();return;}
  const {count,error}=await db.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',owner).is('read_at',null);
  if(request!==inboxCountRequest||session?.user.id!==owner)return;
  if(error)console.error('Inbox unread count',error);
  else inboxUnreadCount=count||0;
  updateInboxIndicators();
}
function showMemberAlert(notification){
  if(!clubAccess())return;
  if(document.hidden){memberDeferredNotification=notification;return;}
  if(memberAlertNotificationId===notification.id&&!$('#memberAlert').hidden)return;
  memberDeferredNotification=null;
  memberAlertNotificationId=notification.id;
  $('#memberAlertTitle').textContent=notification.kind==='direct_message'?'New direct message':'New club update';
  $('#memberAlertMessage').textContent=String(notification.title||'Open your inbox for the latest update.').slice(0,180);
  $('#memberAlert').hidden=false;
  clearTimeout(memberAlertTimer);
  memberAlertTimer=setTimeout(dismissMemberAlert,11000);
}
function receiveMemberNotification(notification){
  if(!clubAccess()||!session||notification?.user_id!==session.user.id)return;
  const known=(cache.notifications||[]).some(n=>n.id===notification.id);
  const byId=new Map((cache.notifications||[]).map(n=>[n.id,n]));
  byId.set(notification.id,notification);
  cache.notifications=[...byId.values()].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,1000);
  if(!known&&inboxUnreadCount!==null&&!notification.read_at)inboxUnreadCount++;
  updateInboxIndicators();void refreshInboxUnreadCount();
  if(page==='notifications')render();
  if(!known)showMemberAlert(notification);
}
function showAdminAlert(title,message){
  if(!admin())return;
  if(document.hidden){clearTimeout(adminAlertDismissTimer);$('#adminAlert').hidden=true;adminDeferredAlert={title,message};return;}
  adminDeferredAlert=null;
  $('#adminAlertTitle').textContent=title;$('#adminAlertMessage').textContent=message;
  $('#adminAlert').hidden=false;
  clearTimeout(adminAlertDismissTimer);
  adminAlertDismissTimer=setTimeout(dismissAdminAlert,12000);
}
async function playAdminAlertSound(){
  if(!adminSoundEnabled||!admin())return;
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)return;
  try{
    adminAudioContext ||= new Audio();
    if(adminAudioContext.state==='suspended')await adminAudioContext.resume();
    const start=adminAudioContext.currentTime;
    for(const [i,pitch] of [660,880].entries()){
      const oscillator=adminAudioContext.createOscillator(),gain=adminAudioContext.createGain(),at=start+i*.16;
      oscillator.type='sine';oscillator.frequency.value=pitch;
      gain.gain.setValueAtTime(.0001,at);
      gain.gain.exponentialRampToValueAtTime(.09,at+.015);
      gain.gain.exponentialRampToValueAtTime(.0001,at+.15);
      oscillator.connect(gain);gain.connect(adminAudioContext.destination);
      oscillator.start(at);oscillator.stop(at+.16);
    }
  }catch(error){console.error('Application alert sound unavailable',error);}
}
function receiveAdminApplications(rows){
  if(!admin())return 0;
  const applications=rows.filter(n=>n?.kind==='application'&&n.target_type==='application'&&n.user_id===session.user.id);
  const unseen=applications.filter(n=>!adminSeenApplicationIds.has(n.id));
  for(const n of applications)adminSeenApplicationIds.add(n.id);
  if(!adminAlertsInitialized){
    adminAlertsInitialized=true;
    if(adminPendingCount)showAdminAlert(`${adminPendingCount} account${adminPendingCount===1?'':'s'} awaiting review`,'Open Applications to review their submitted details.');
  }else if(unseen.length){
    showAdminAlert(unseen.length===1?'New account awaiting review':`${unseen.length} new accounts awaiting review`,'A new signup has arrived. Open Applications to review its details.');
    void playAdminAlertSound();
  }
  return unseen.length;
}
function mergeAdminNotifications(rows){
  const byId=new Map((cache.notifications||[]).map(n=>[n.id,n]));
  let changed=false;
  for(const n of rows){if(!byId.has(n.id)||byId.get(n.id)?.read_at!==n.read_at)changed=true;byId.set(n.id,n);}
  cache.notifications=[...byId.values()].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,1000);
  if(changed){updateInboxIndicators();void refreshInboxUnreadCount();if(page==='notifications')render();}
}
async function refreshAdminAlerts(){
  if(!admin()||!session||adminAlertPolling)return;
  adminAlertPolling=true;
  const userId=session.user.id;
  try{
    const [pending,notices]=await Promise.all([
      db.from('profiles').select('id',{count:'exact',head:true}).eq('membership_status','pending'),
      db.from('notifications').select('*').eq('user_id',userId).eq('kind','application').order('created_at',{ascending:false}).limit(50)
    ]);
    if(!admin()||session?.user.id!==userId)return;
    const oldCount=adminPendingCount;
    if(pending.error)console.error('Application count',pending.error);
    else adminPendingCount=pending.count||0;
    let newCount=0;
    if(notices.error)console.error('Application notifications',notices.error);
    else {newCount=receiveAdminApplications(notices.data||[]);mergeAdminNotifications(notices.data||[]);}
    updateAdminAlertControls();
    if((page==='admin'||page==='applications')&&(oldCount!==adminPendingCount||newCount))void refresh();
  }catch(error){console.error('Application alerts',error);}
  finally{adminAlertPolling=false;}
}
const button = (label,action,extra='') => `<button class="button ${extra}" data-action="${action}">${label}</button>`;
const empty = (title,body) => `<div class="empty"><strong>${esc(title)}</strong>${esc(body)}</div>`;
const head = (label,title,subtitle,action='') => `<div class="page-head"><div><span class="eyebrow">${esc(label)}</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action}</div>`;
const avatar = (name,large=false,photoPath='') => {const url=mediaUrl(photoPath);return `<span class="avatar ${large?'large':''}">${url?`<img src="${esc(url)}" alt="" loading="lazy">`:esc(initials(name))}</span>`;};
const memberAvatar = (id,large=false) => {const p=(cache.profiles||[]).find(x=>x.id===id);return avatar(p?.full_name||'Member',large,p?.avatar_path);};
const roleBadge = p => {const labels={member:'Member',teacher:'Teacher',founder:'Founder',investor:'Investor',admin:'Administrator'};const role=Object.hasOwn(labels,p?.role)?p.role:'member';return `<span class="member-badge badge-${role}" title="Approved ${esc(labels[role])} account">${labels[role]}</span>${role==='founder'&&p?.founder_teaching_enabled===true?'<span class="member-badge badge-teacher" title="Can lead practical workshops">Teaching lead</span>':''}`;};
const iconPaths={home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',founders:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',privacy:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',application:'<path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/>',members:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M19 14a5 5 0 0 1 2 4v2"/>',messages:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 0 1-.9-4A8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z"/>',notifications:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',feed:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',channels:'<path d="M4 5h16v11H8l-4 4zM8 9h8M8 12h5"/>',library:'<path d="M4 4h12l4 4v12H4zM16 4v4h4M8 13h8M8 17h6"/>',news:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h4M13 12h4M7 16h10"/>',projects:'<path d="M3 7h7l2 2h9v11H3zM3 7V4h8l2 3"/>',discussions:'<path d="M4 4h16v12H8l-4 4zM8 9h8M8 12h5"/>',courses:'<path d="M3 6 12 3l9 3-9 3-9-3zM5 10v7c4 3 10 3 14 0v-7M21 7v8"/>',events:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h3"/>',announcements:'<path d="M3 10h4l12-5v14L7 14H3zM7 14l2 7h4l-2-6M21 9v6"/>','founder-room':'<path d="m12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5z"/>',applications:'<path d="M5 3h14v18H5zM8 8h8M8 13l2 2 5-5"/>',moderation:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7v6M12 17h.01"/>'};
iconPaths.investors='<path d="M3 20h18M5 16l5-5 4 3 5-7M16 7h3v3"/>';
iconPaths.about='<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>';
iconPaths['investor-portal']='<path d="M3 20h18M5 16l5-5 4 3 5-7M16 7h3v3"/>';
iconPaths.admin='<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/>';
iconPaths.teaching='<path d="M3 5h18v13H3zM7 22h10M12 18v4M7 10h10M7 13h6"/>';
iconPaths.finance='<path d="M3 6h18v14H3zM3 10h18M7 15h4M16 15h2"/>';
iconPaths['finance-review']='<path d="M4 3h16v18H4zM8 8h8M8 12h8M8 16l2 2 5-5"/>';
const iconSvg = name => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]||iconPaths.home}</svg>`;
iconPaths.calendar=iconPaths.events;
const modal = (html) => { if($('#modal').open) $('#modal').close(); $('#modalContent').innerHTML=html; $('#modal').showModal(); };
const close = () => $('#modal').close();
const imageView = {scale:1,x:0,y:0,pointers:new Map(),gesture:null,lastTap:null,focus:null,request:0};
const imageStage = () => $('#imageViewerStage');
const imagePhoto = () => $('#imageViewerPhoto');
function applyImageZoom(){
  const photo=imagePhoto();
  photo.style.transform=`translate3d(${imageView.x}px,${imageView.y}px,0) scale(${imageView.scale})`;
  $('#imageViewerZoomLabel').textContent=`${Math.round(imageView.scale*100)}%`;
  $('#imageViewerZoomOut').disabled=imageView.scale<=1;
  $('#imageViewerZoomIn').disabled=imageView.scale>=5;
  $('#imageViewerReset').disabled=imageView.scale<=1;
}
function clampImagePan(){
  const photo=imagePhoto(),stage=imageStage();
  const maxX=Math.max(0,(photo.offsetWidth*imageView.scale-stage.clientWidth)/2);
  const maxY=Math.max(0,(photo.offsetHeight*imageView.scale-stage.clientHeight)/2);
  imageView.x=Math.max(-maxX,Math.min(maxX,imageView.x));
  imageView.y=Math.max(-maxY,Math.min(maxY,imageView.y));
}
function setImageZoom(next,clientX,clientY){
  const stage=imageStage(),rect=stage.getBoundingClientRect();
  const cx=(clientX??rect.left+rect.width/2)-(rect.left+rect.width/2);
  const cy=(clientY??rect.top+rect.height/2)-(rect.top+rect.height/2);
  const scale=Math.max(1,Math.min(5,next));
  imageView.x=cx-(cx-imageView.x)*scale/imageView.scale;
  imageView.y=cy-(cy-imageView.y)*scale/imageView.scale;
  imageView.scale=scale;
  clampImagePan();applyImageZoom();
}
function fitImageViewer(){
  const photo=imagePhoto(),stage=imageStage();
  if(!photo.naturalWidth||!stage.clientWidth)return;
  const factor=Math.min(stage.clientWidth/photo.naturalWidth,stage.clientHeight/photo.naturalHeight);
  photo.style.width=`${photo.naturalWidth*factor}px`;
  photo.style.height=`${photo.naturalHeight*factor}px`;
  imageView.scale=1;imageView.x=0;imageView.y=0;applyImageZoom();
}
function closeImageViewer(restoreFocus=true){
  if(!restoreFocus)imageView.focus=null;
  imageView.request++;
  if($('#imageViewer').open)$('#imageViewer').close();
}
async function openImageViewer(path,caption,trigger){
  if(!clubAccess()||!mediaReady||!path)return;
  if($('#imageViewer').open)return;
  const user=session?.user.id,request=++imageView.request;
  try{
    let signed=mediaUrls.get(path);
    if(!signed||signed.expires<Date.now()+60000){
      const {data,error}=await db.storage.from('club-media').createSignedUrl(path,900);
      if(error||!data?.signedUrl)throw error||Error('Could not open this image.');
      signed={url:data.signedUrl,expires:Date.now()+900000};mediaUrls.set(path,signed);
    }
    if(request!==imageView.request||session?.user.id!==user||!clubAccess()||!trigger.isConnected)return;
    const viewer=$('#imageViewer'),photo=imagePhoto(),loading=$('#imageViewerLoading');
    imageView.focus=trigger;imageView.lastTap=null;imageView.gesture=null;imageView.pointers.clear();
    imageView.scale=1;imageView.x=0;imageView.y=0;applyImageZoom();
    $('#imageViewerCaption').textContent=caption||'Photo';
    loading.textContent='Opening photo…';loading.hidden=false;
    photo.style.visibility='hidden';photo.style.width='';photo.style.height='';
    photo.alt=caption||'Photo';
    photo.onload=()=>{if(request!==imageView.request)return;fitImageViewer();photo.style.visibility='visible';loading.hidden=true;};
    photo.onerror=()=>{if(request!==imageView.request)return;loading.textContent='Photo could not be loaded. Close and try again.';photo.style.visibility='hidden';};
    viewer.showModal();
    photo.src=signed.url;
    $('#imageViewerClose').focus();
  }catch(error){if(request===imageView.request)fail(error);}
}
function setupImageViewer(){
  const viewer=$('#imageViewer'),stage=imageStage(),photo=imagePhoto();
  $('#imageViewerClose').onclick=()=>closeImageViewer();
  $('#imageViewerZoomIn').onclick=()=>setImageZoom(imageView.scale*1.5);
  $('#imageViewerZoomOut').onclick=()=>setImageZoom(imageView.scale/1.5);
  $('#imageViewerReset').onclick=()=>setImageZoom(1);
  viewer.addEventListener('close',()=>{
    imageView.request++;imageView.pointers.clear();imageView.gesture=null;imageView.lastTap=null;
    photo.onload=null;photo.onerror=null;photo.removeAttribute('src');photo.style.transform='';
    const focus=imageView.focus;imageView.focus=null;
    if(focus?.isConnected)focus.focus({preventScroll:true});
  });
  viewer.addEventListener('keydown',e=>{
    if(e.key==='+'||e.key==='='){e.preventDefault();setImageZoom(imageView.scale*1.5);}
    if(e.key==='-'){e.preventDefault();setImageZoom(imageView.scale/1.5);}
    if(e.key==='0'){e.preventDefault();setImageZoom(1);}
  });
  stage.addEventListener('wheel',e=>{if(!photo.naturalWidth)return;e.preventDefault();setImageZoom(imageView.scale*(e.deltaY<0?1.15:1/1.15),e.clientX,e.clientY);},{passive:false});
  stage.addEventListener('pointerdown',e=>{
    if(!photo.naturalWidth||e.pointerType==='mouse'&&e.button!==0)return;
    stage.setPointerCapture(e.pointerId);
    imageView.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,time:Date.now()});
    if(imageView.pointers.size===1)imageView.gesture={type:'pan',x:imageView.x,y:imageView.y,startX:e.clientX,startY:e.clientY};
    if(imageView.pointers.size===2){
      const [a,b]=[...imageView.pointers.values()],rect=stage.getBoundingClientRect();
      imageView.gesture={type:'pinch',distance:Math.hypot(a.x-b.x,a.y-b.y)||1,scale:imageView.scale,x:imageView.x,y:imageView.y,
        cx:(a.x+b.x)/2-rect.left-rect.width/2,cy:(a.y+b.y)/2-rect.top-rect.height/2};
      imageView.lastTap=null;
    }
  });
  stage.addEventListener('pointermove',e=>{
    const point=imageView.pointers.get(e.pointerId);if(!point)return;
    point.x=e.clientX;point.y=e.clientY;
    if(imageView.pointers.size===2&&imageView.gesture?.type==='pinch'){
      const [a,b]=[...imageView.pointers.values()],g=imageView.gesture,rect=stage.getBoundingClientRect();
      const scale=Math.max(1,Math.min(5,g.scale*Math.hypot(a.x-b.x,a.y-b.y)/g.distance));
      const cx=(a.x+b.x)/2-rect.left-rect.width/2,cy=(a.y+b.y)/2-rect.top-rect.height/2;
      imageView.scale=scale;imageView.x=cx-(g.cx-g.x)*scale/g.scale;imageView.y=cy-(g.cy-g.y)*scale/g.scale;
      clampImagePan();applyImageZoom();
    }else if(imageView.pointers.size===1&&imageView.gesture?.type==='pan'&&imageView.scale>1){
      imageView.x=imageView.gesture.x+e.clientX-imageView.gesture.startX;
      imageView.y=imageView.gesture.y+e.clientY-imageView.gesture.startY;
      clampImagePan();applyImageZoom();
    }
  });
  const endPointer=e=>{
    const point=imageView.pointers.get(e.pointerId);if(!point)return;
    const wasPinch=imageView.gesture?.type==='pinch';imageView.pointers.delete(e.pointerId);
    if(imageView.pointers.size===1){
      const p=[...imageView.pointers.values()][0];imageView.gesture={type:'pan',x:imageView.x,y:imageView.y,startX:p.x,startY:p.y};
      imageView.lastTap=null;
    }else{
      imageView.gesture=null;
      if(e.type==='pointerup'&&!wasPinch&&Math.hypot(e.clientX-point.startX,e.clientY-point.startY)<12&&Date.now()-point.time<350){
        const tap=imageView.lastTap;
        if(tap&&Date.now()-tap.time<350&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<30){
          setImageZoom(imageView.scale>1?1:2.5,e.clientX,e.clientY);imageView.lastTap=null;
        }else imageView.lastTap={time:Date.now(),x:e.clientX,y:e.clientY};
      }else imageView.lastTap=null;
    }
  };
  stage.addEventListener('pointerup',endPointer);
  stage.addEventListener('pointercancel',endPointer);
  window.addEventListener('resize',()=>{if(viewer.open&&photo.naturalWidth)fitImageViewer();});
}
const fail = (error) => { console.error(error); show(error?.message || 'Something went wrong. Please try again.'); };
const read = async (table,query=q=>q) => { const {data,error}=await query(db.from(table).select('*')); if(error) throw error; return data || []; };
async function readRecords(table){
  // These relation tables use composite primary keys and do not have an `id` or `created_at`.
  // A stable, unique order is needed when a result is larger than PostgREST's row limit.
  const relationKeys={project_members:['project_id','user_id'],event_rsvps:['event_id','user_id'],founder_meeting_rsvps:['meeting_id','user_id']};
  const keys=relationKeys[table]||['created_at','id'];
  const rows=[];
  for(;;){
    let query=db.from(table).select('*',{count:'exact'});
    for(const key of keys)query=query.order(key,{ascending:!!relationKeys[table]});
    const {data,error,count}=await query.range(rows.length,rows.length+499);
    if(error)throw error;
    if(count===null)throw Error(`Could not count ${table} records. Please retry.`);
    if(!data?.length && count>rows.length)throw Error(`Could not load all ${table} records. Please retry.`);
    rows.push(...(data||[]));
    if(rows.length>=count)return rows;
  }
}
async function loadAdminApplicationPages(){
  if(!admin()||!session)return;
  const owner=session.user.id,request=++applicationsRequest;
  if(applicationsOwner!==owner){
    applicationsOwner=owner;applicationsPage=0;approvedAccountsPage=0;
    applicationRows=[];approvedAccountRows=[];applicationTotal=0;approvedAccountTotal=0;
  }
  applicationsLoading=true;applicationsError='';
  applicationVerificationError='';
  try{
    const getPages=()=>Promise.all([
      db.from('profiles').select('*',{count:'exact'}).neq('membership_status','approved').order('created_at',{ascending:false}).order('id',{ascending:false}).range(applicationsPage*50,applicationsPage*50+49),
      db.from('profiles').select('*',{count:'exact'}).eq('membership_status','approved').neq('id',owner).order('created_at',{ascending:false}).order('id',{ascending:false}).range(approvedAccountsPage*50,approvedAccountsPage*50+49)
    ]);
    let [applicants,accounts]=await getPages();
    if(applicants.error)throw applicants.error;
    if(accounts.error)throw accounts.error;
    if(applicants.count===null||accounts.count===null)throw Error('Could not count applications. Please retry.');
    if(applicationsPage>0&&applicationsPage*50>=applicants.count||approvedAccountsPage>0&&approvedAccountsPage*50>=accounts.count){
      applicationsPage=Math.min(applicationsPage,Math.max(0,Math.ceil(applicants.count/50)-1));
      approvedAccountsPage=Math.min(approvedAccountsPage,Math.max(0,Math.ceil(accounts.count/50)-1));
      [applicants,accounts]=await getPages();
      if(applicants.error)throw applicants.error;
      if(accounts.error)throw accounts.error;
    }
    let verification=new Map();
    let privateAnswers=new Map();
    if(applicants.data?.length){
      const result=await db.rpc('application_verification_status',{p_users:applicants.data.map(p=>p.id)});
      if(result.error)applicationVerificationError='Verification status unavailable. Run the updated approval migration to see it here.';
      else verification=new Map((result.data||[]).map(row=>[row.user_id,{verified:row.email_verified,previouslyApproved:row.previously_approved}]));
      if(applicationAnswersReady){
        const answers=await db.from('application_answers').select('user_id,reason').in('user_id',applicants.data.map(p=>p.id));
        if(answers.error)throw answers.error;
        privateAnswers=new Map((answers.data||[]).map(row=>[row.user_id,row.reason]));
      }
    }
    if(request!==applicationsRequest||session?.user.id!==owner||!admin())return;
    applicationRows=(applicants.data||[]).map(row=>applicationAnswersReady?{...row,application_reason:privateAnswers.get(row.id)||''}:row);
    approvedAccountRows=accounts.data||[];
    applicationVerification=verification;
    applicationTotal=applicants.count||0;approvedAccountTotal=accounts.count||0;
  }catch(error){
    if(request!==applicationsRequest)return;
    applicationRows=[];approvedAccountRows=[];applicationVerification=new Map();applicationsError=error?.message||'Could not load accounts.';
  }finally{
    if(request===applicationsRequest){applicationsLoading=false;if(page==='applications')render();}
  }
}
async function hydrateOwnApplicationReason(){
  if(!me||!session)return;
  const userId=session.user.id;
  applicationAnswersReady=!Object.hasOwn(me,'application_reason');
  if(!applicationAnswersReady)return;
  // Approved accounts cannot edit an application; only applicants need to load it.
  if(me.membership_status==='pending'||me.membership_status==='rejected'){
    const {data,error}=await db.from('application_answers').select('reason').eq('user_id',userId).maybeSingle();
    if(session?.user.id!==userId||me?.id!==userId)return;
    if(error){console.error('application_answers',error);me.application_reason='';return;}
    me.application_reason=data?.reason||'';
  }
}
async function readFeedRelations(table,ids){
  if(!ids.length)return [];
  const rows=[];
  const keys=table==='activity_likes'?['created_at','post_id','user_id']:['created_at','id'];
  let total=null;
  do{
    let query=db.from(table).select('*',{count:'exact'}).in('post_id',ids);
    for(const key of keys)query=query.order(key,{ascending:true});
    const {data,error,count}=await query.range(rows.length,rows.length+499);
    if(error)throw error;
    if(total===null)total=count;
    if(total===null||!data?.length&&rows.length<total)throw Error('Could not load complete feed discussion. Please retry.');
    rows.push(...(data||[]));
  }while(rows.length<total);
  return rows;
}
async function loadFeedPage(renderAfter=true){
  if(!session||!clubAccess()||!feedReady)return;
  const owner=session.user.id,request=++feedRequest;
  if(feedOwner!==owner){feedOwner=owner;feedPage=0;feedTotal=0;}
  feedLoading=true;feedError='';
  try{
    const fetchPosts=()=>db.from('activity_posts').select('*',{count:'exact'}).order('created_at',{ascending:false}).order('id',{ascending:false}).range(feedPage*30,feedPage*30+29);
    let posts=await fetchPosts();
    if(posts.error)throw posts.error;
    if(posts.count===null)throw Error('Could not count activity posts. Please retry.');
    if(feedPage>0&&feedPage*30>=posts.count){feedPage=Math.max(0,Math.ceil(posts.count/30)-1);posts=await fetchPosts();if(posts.error)throw posts.error;}
    const ids=(posts.data||[]).map(p=>p.id);
    const [comments,likes]=await Promise.all([readFeedRelations('activity_comments',ids),readFeedRelations('activity_likes',ids)]);
    if(request!==feedRequest||session?.user.id!==owner||!clubAccess())return;
    cache.activity_posts=posts.data||[];
    cache.activity_comments=comments;
    cache.activity_likes=likes;
    feedTotal=posts.count||0;
    await hydrateMedia();
  }catch(error){if(request===feedRequest)feedError=error?.message||'Could not load posts.';}
  finally{if(request===feedRequest){feedLoading=false;if(renderAfter&&page==='feed')render();}}
}
async function readRelatedRows(table,column,ids,order){
  const rows=[];
  for(let i=0;i<ids.length;i+=100){
    const subset=ids.slice(i,i+100);
    let total=null,offset=0;
    do{
      let query=db.from(table).select('*',{count:'exact'}).in(column,subset);
      for(const key of order)query=query.order(key,{ascending:true});
      const {data,error,count}=await query.range(offset,offset+499);
      if(error)throw error;
      if(total===null)total=count;
      if(total===null||!data?.length&&offset<total)throw Error(`Could not load complete ${table} history. Please retry.`);
      rows.push(...(data||[]));offset+=(data||[]).length;
    }while(offset<total);
  }
  return rows;
}
async function loadChannelHistory(renderAfter=true){
  if(!clubAccess()||!communityReady||!activeChannelId)return;
  const id=activeChannelId,owner=session.user.id,request=++channelRequest;
  if(channelHistoryId!==id){channelHistoryId=id;channelPage=0;channelTotal=0;channelHistoryRows=[];channelHistoryReactions=[];}
  channelHistoryLoading=true;channelHistoryError='';
  try{
    const fetchRoots=()=>{
      let query=db.from('channel_messages').select('*',{count:'exact'}).eq('channel_id',id);
      if(enhancedReady)query=query.is('parent_id',null);
      return query.order('created_at',{ascending:false}).order('id',{ascending:false}).range(channelPage*50,channelPage*50+49);
    };
    let result=await fetchRoots();
    if(result.error)throw result.error;
    if(result.count===null)throw Error('Could not count channel messages. Please retry.');
    if(channelPage>0&&channelPage*50>=result.count){channelPage=Math.max(0,Math.ceil(result.count/50)-1);result=await fetchRoots();if(result.error)throw result.error;}
    const roots=result.data||[];
    const replies=enhancedReady?await readRelatedRows('channel_messages','parent_id',roots.map(m=>m.id),['created_at','id']):[];
    const rows=roots.concat(replies);
    const reactions=enhancedReady?await readRelatedRows('message_reactions','message_id',rows.map(m=>m.id),['message_id','user_id','emoji']):[];
    if(request!==channelRequest||activeChannelId!==id||session?.user.id!==owner||!clubAccess())return;
    channelHistoryRows=rows;channelHistoryReactions=reactions;channelTotal=result.count||0;
    await hydrateMedia();
  }catch(error){if(request===channelRequest)channelHistoryError=error?.message||'Could not load channel history.';}
  finally{if(request===channelRequest){channelHistoryLoading=false;if(renderAfter&&page==='channels')render();}}
}
async function loadDmThread(renderAfter=true){
  if(!clubAccess()||!dmReady||!activePeerId||!session)return;
  const peer=activePeerId,owner=session.user.id,request=++dmRequest;
  if(dmThreadPeer!==peer){dmThreadPeer=peer;dmPage=0;dmTotal=0;dmThreadRows=[];}
  dmThreadLoading=true;dmThreadError='';
  try{
    const fetchThread=()=>db.from('direct_messages').select('*',{count:'exact'}).in('sender_id',[owner,peer]).in('recipient_id',[owner,peer]).order('created_at',{ascending:false}).order('id',{ascending:false}).range(dmPage*50,dmPage*50+49);
    let result=await fetchThread();
    if(result.error)throw result.error;
    if(result.count===null)throw Error('Could not count direct messages. Please retry.');
    if(dmPage>0&&dmPage*50>=result.count){dmPage=Math.max(0,Math.ceil(result.count/50)-1);result=await fetchThread();if(result.error)throw result.error;}
    if(request!==dmRequest||activePeerId!==peer||session?.user.id!==owner||!clubAccess())return;
    dmThreadRows=result.data||[];dmTotal=result.count||0;
    await hydrateMedia();
  }catch(error){if(request===dmRequest)dmThreadError=error?.message||'Could not load direct messages.';}
  finally{if(request===dmRequest){dmThreadLoading=false;if(renderAfter&&page==='messages')render();}}
}
async function refreshUnreadCounts(){
  if(!session||!clubAccess())return;
  const owner=session.user.id;
  const {data,error}=await db.rpc('club_unread_counts');
  if(session?.user.id!==owner||!clubAccess())return;
  if(error){unreadCountsReady=false;console.error('Unread counts',error);return;}
  if(!data||typeof data!=='object')return;
  unreadCounts={channels:data.channels||{},direct_messages:data.direct_messages||{},direct_peers:Array.isArray(data.direct_peers)?data.direct_peers:[],direct_total:Number(data.direct_total)||0};
  unreadCountsReady=true;
  const badge=$('#dmBadge');if(badge){badge.textContent=unreadCounts.direct_total;badge.hidden=!unreadCounts.direct_total;}
  for(const [selector,key,target] of [['[data-action="selectChannel"]','channels','strong'],['[data-action="openDm"]','direct_messages','button']]){
    for(const item of document.querySelectorAll(selector)){
      const parent=target==='button'?item:item.querySelector(target),value=Number(unreadCounts[key][item.dataset.id]||0);
      if(!parent)continue;
      let chip=parent.querySelector('.unread-badge');
      if(!value){chip?.remove();continue;}
      if(!chip){chip=document.createElement('i');chip.className='unread-badge';parent.append(chip);}
      chip.textContent=value;
    }
  }
}

// Keep the complete load for sign-in and mutations. Background checks only revisit
// data used by the visible page, while the separate chat and approval loops stay focused.
const pageRefreshDependencies={
  home:['project_tasks','courses','course_enrollments','course_submissions','course_completions','events'],
  about:[],founders:['founders'],investors:['founders','investor_updates'],
  privacy:['privacy_requests','profiles'],application:[],
  admin:['profiles','projects','reports','privacy_requests','investor_inquiries','activity_posts','founder_meetings','events','channels','news_posts','documents','audit_events'],
  applications:[],moderation:['reports','audit_events','profiles'],
  notifications:['events','founder_meetings','project_tasks'],members:['profiles'],
  messages:['profiles','direct_messages','direct_message_reads'],
  feed:['profiles','documents','announcements','news_posts','activity_posts'],
  channels:['profiles','channels','channel_reads','documents'],
  library:['documents','document_versions','channels','profiles'],news:['news_posts','profiles'],
  projects:['projects','project_tasks','project_members','project_milestones','profiles'],
  inventory:['inventory_items','profiles'],finance:['finance_entries','finance_reviews','profiles'],
  'finance-review':['finance_entries','finance_reviews','profiles'],
  discussions:['topics','replies','projects','profiles'],
  courses:['courses','learning_materials','course_enrollments','course_submissions','course_completions','profiles'],
  teaching:['courses','learning_materials','course_enrollments','course_submissions','course_completions','profiles'],
  events:['events','event_rsvps'],calendar:['events','founder_meetings','project_tasks','courses','course_enrollments'],
  announcements:['announcements'],'founder-room':['founder_meetings','founder_meeting_rsvps','founder_invites','profiles']
};
let backgroundRefreshBusy=false, lastProfileRefreshAt=0;
async function refreshVisiblePage(){
  if(backgroundRefreshBusy||document.hidden||!session)return;
  backgroundRefreshBusy=true;
  try{await refresh('page');}catch(error){console.error('Page refresh',error);}
  finally{backgroundRefreshBusy=false;}
}
async function refresh(mode='full') {
  if (!db || !session) return;
  const owner=session.user.id,generation=authGeneration,scoped=mode==='page';
  const knownNotificationIds=new Set((cache.notifications||[]).map(n=>n.id));
  const previous=accessSignature(me);
  const self=await db.from('profiles').select('*').eq('id',session.user.id).single();
  if(session?.user.id!==owner||generation!==authGeneration)return;
  if(!self.error&&self.data){me=self.data;await hydrateOwnApplicationReason();}
  if(session?.user.id!==owner||generation!==authGeneration)return;
  roleReady=!!me&&'application_type' in me;
  if(previous!==accessSignature(me))return signedIn(session);
  if(!approved()){
    if($('#imageViewer').open)closeImageViewer(false);
    let publicFounders=cache.founders||[];
    if(!scoped||page==='founders')try{publicFounders=await readRecords('founders');}catch(error){console.error('Public founders',error);}
    if(session?.user.id!==owner||generation!==authGeneration)return;
    cache={profiles:me?[me]:[],founders:publicFounders};
    if(!scoped||page==='founders')await detectFounderPortraits();
    communityReady=false;enhancedReady=false;feedReady=false;dmReady=false;mediaReady=false;avatarReady=false;learningReady=false;courseReady=false;coursePlanningReady=false;teacherProfileReady=false;teacherProfile=null;privacyReady=false;inventoryReady=false;inventoryCatalogReady=false;financeReady=false;financeApprovalsReady=false;mediaUrls.clear();route();return;
  }
  if(investor()){
    const results=await Promise.allSettled(['investor_updates','investor_inquiries','privacy_requests','founders'].map(readRecords));
    if(session?.user.id!==owner||generation!==authGeneration)return;
    cache={profiles:[me],investor_updates:results[0].status==='fulfilled'?results[0].value:[],investor_inquiries:results[1].status==='fulfilled'?results[1].value:[],privacy_requests:results[2].status==='fulfilled'?results[2].value:[],founders:results[3].status==='fulfilled'?results[3].value:[]};
    await detectFounderPortraits();
    communityReady=false;enhancedReady=false;feedReady=false;dmReady=false;mediaReady=false;avatarReady=false;learningReady=false;courseReady=false;coursePlanningReady=false;teacherProfileReady=false;teacherProfile=null;privacyReady=results[2].status==='fulfilled';inventoryReady=false;inventoryCatalogReady=false;financeReady=false;financeApprovalsReady=false;mediaUrls.clear();
    if(previous!==accessSignature(me)||!['home','about','founders','investors','investor-portal','privacy'].includes(page)) {route();return;}
    render();return;
  }
  const names=['profiles','projects','project_tasks','topics','replies','courses','learning_materials','course_enrollments','course_submissions','course_completions','privacy_requests','events','announcements','founders','channels','documents','channel_messages','news_posts','founder_invites','founder_meetings','message_reactions','channel_reads','notifications','project_members','project_milestones','event_rsvps','founder_meeting_rsvps','document_versions','reports','audit_events','activity_posts','activity_comments','activity_likes','direct_messages','direct_message_reads','investor_updates','investor_inquiries','inventory_items'];
  if(founder())names.push('inventory_movements','finance_entries','finance_reviews');
  if(scoped){
    const needed=new Set(['notifications',...(pageRefreshDependencies[page]||[])]);
    if(page==='home'&&founder()){
      needed.add('founder_meetings');needed.add('finance_entries');needed.add('finance_reviews');
    }
    if(page==='home'&&admin())needed.add('reports');
    if(page==='inventory'&&founder())needed.add('inventory_movements');
    if(Date.now()-lastProfileRefreshAt>120000)needed.add('profiles');
    for(let i=names.length-1;i>=0;i--)if(!needed.has(names[i]))names.splice(i,1);
  }
  const records=new Set(['profiles','projects','project_tasks','topics','replies','courses','learning_materials','events','announcements','founders','channels','documents','news_posts','founder_invites','founder_meetings','notifications','project_members','project_milestones','event_rsvps','founder_meeting_rsvps','document_versions','reports','audit_events','investor_updates','investor_inquiries','course_enrollments','course_submissions','course_completions','privacy_requests','inventory_items','inventory_movements','finance_entries','finance_reviews']);
  const previews={channel_messages:120,direct_messages:120,activity_posts:50,activity_comments:1,activity_likes:1,message_reactions:1,notifications:100};
  const checkTeacherProfile=teacher()&&!admin()&&(!scoped||page==='teaching');
  const [results,teachingProfileResult]=await Promise.all([
    Promise.allSettled(names.map(n=>records.has(n)?readRecords(n):read(n,q=>{
      if(n!=='channel_reads')q=q.order('created_at',{ascending:false});
      return Object.hasOwn(previews,n)?q.limit(previews[n]):q;
    }))),
    checkTeacherProfile?db.from('teacher_profiles').select('*').eq('teacher_id',owner).maybeSingle():Promise.resolve({data:null,error:null})
  ]);
  if(session?.user.id!==owner||generation!==authGeneration)return;
  if(checkTeacherProfile){
    teacherProfileReady=!teachingProfileResult.error;
    teacherProfile=teacherProfileReady?teachingProfileResult.data:null;
    if(teachingProfileResult.error)console.error('teacher_profiles',teachingProfileResult.error);
  }else if(!scoped){teacherProfileReady=false;teacherProfile=null;}
  results.forEach((r,i)=>{ if(r.status==='fulfilled') cache[names[i]]=r.value; else {cache[names[i]]=[];console.error(names[i],r.reason);} });
  if(names.includes('profiles')&&results[names.indexOf('profiles')].status==='fulfilled')lastProfileRefreshAt=Date.now();
  if(names.includes('founders'))await detectFounderPortraits();
  if(admin()&&(!scoped||page==='admin')){
    const pending=await db.from('profiles').select('id',{count:'exact',head:true}).eq('membership_status','pending');
    if(pending.error)console.error('Pending application count',pending.error);
    else adminPendingCount=pending.count||0;
  }
  if(admin()&&names.includes('notifications')&&results[names.indexOf('notifications')].status==='fulfilled')receiveAdminApplications(cache.notifications);
  const succeeded=n=>results[names.indexOf(n)]?.status==='fulfilled';
  if(names.includes('notifications')&&succeeded('notifications')){
    if(memberNotificationPrimed){
      const latest=(cache.notifications||[]).find(n=>!n.read_at&&!knownNotificationIds.has(n.id)&&!(admin()&&n.kind==='application'));
      if(latest)showMemberAlert(latest);
    }
    memberNotificationPrimed=true;
  }
  if(names.includes('channels'))communityReady=succeeded('channels');
  if(names.includes('channel_reads'))enhancedReady=succeeded('channel_reads');
  if(names.includes('notifications')&&succeeded('notifications'))void refreshInboxUnreadCount();
  if(names.includes('activity_posts'))feedReady=succeeded('activity_posts');
  if(names.includes('direct_messages'))dmReady=succeeded('direct_messages');
  if(names.includes('learning_materials'))learningReady=succeeded('learning_materials');
  if(!scoped||['course_enrollments','course_submissions','course_completions'].every(n=>names.includes(n)))courseReady=['course_enrollments','course_submissions','course_completions'].every(succeeded);
  if(!scoped||names.includes('courses')){
    const planningProbe=courseReady?await db.from('courses').select('submission_due_at').limit(1):{error:true};
    coursePlanningReady=!planningProbe.error;
  }
  if(!scoped||page==='teaching')cache.course_roster=[];
  if(coursePlanningReady&&teacher()&&(!scoped||page==='teaching')){
    try{
      for(let offset=0;;offset+=500){
        const roster=await db.rpc('teacher_course_roster').order('course_id').order('learner_id').range(offset,offset+499);
        if(roster.error)throw roster.error;
        cache.course_roster.push(...(roster.data||[]));
        if((roster.data||[]).length<500)break;
      }
    }catch(error){console.error('teacher_course_roster',error);coursePlanningReady=false;cache.course_roster=[];}
  }
  if(names.includes('privacy_requests'))privacyReady=succeeded('privacy_requests');
  if(names.includes('inventory_items')){
    inventoryReady=succeeded('inventory_items')&&(!founder()||succeeded('inventory_movements'));
    const {error:catalogError}=inventoryReady?await db.from('inventory_items').select('item_type').limit(1):{error:true};
    inventoryCatalogReady=!catalogError;
  }
  if(names.includes('finance_entries'))financeReady=founder()&&succeeded('finance_entries');
  if(names.includes('finance_reviews'))financeApprovalsReady=financeReady&&succeeded('finance_reviews');
  await refreshUnreadCounts();
  if(page==='feed'&&feedReady)await loadFeedPage(false);
  if(page==='channels'&&communityReady&&activeChannelId)await loadChannelHistory(false);
  if(page==='messages'&&dmReady&&activePeerId)await loadDmThread(false);
  if(!scoped){
    const {error:mediaError}=feedReady?await db.from('activity_posts').select('image_path').limit(1):{error:true};
    mediaReady=!mediaError;
    const {error:avatarError}=mediaReady?await db.from('profiles').select('avatar_path').eq('id',owner).limit(1):{error:true};
    avatarReady=!avatarError;
  }
  await hydrateMedia();
  if(page==='applications'&&admin())void loadAdminApplicationPages();
  if(previous!==accessSignature(me)){route();return;}
  if(page==='notifications' && document.activeElement?.closest('#content')) { render(); return; }
  if(page==='channels' && document.activeElement?.closest('#chatComposer')) { renderChatMessages(); return; }
  if(page==='messages' && document.activeElement?.closest('#dmComposer')) return;
  if(page==='teaching' && document.activeElement?.closest('#teacherProfileForm')) return;
  render();
}
async function refreshChat() {
  if(document.hidden||!session || !clubAccess() || !communityReady) return;
  try { cache.channel_messages=await read('channel_messages',q=>q.order('created_at',{ascending:false}).limit(120));if(page==='channels'&&activeChannelId)await loadChannelHistory(false);await refreshUnreadCounts();await hydrateMedia();
    if(page==='channels') renderChatMessages();
  } catch(e) { console.error(e); }
}
async function loadPublic() {
  if (!db) return;
  try { cache.founders=(await readRecords('founders')).sort((a,b)=>a.sort_order-b.sort_order); } catch(e) { console.error(e); }
  await detectFounderPortraits();
  render();
}
async function detectFounderPortraits(){
  if(cache.founders?.length){founderPortraitReady=Object.hasOwn(cache.founders[0],'portrait_path');return;}
  const {error}=await db.from('founders').select('portrait_path').limit(1);
  founderPortraitReady=!error;
}
async function touchPresence(online=true) {
  if (!session || !db) return;
  const {error}=await db.from('profiles').update({last_seen_at:online?new Date().toISOString():null}).eq('id',session.user.id);
  if(error) console.error(error);
}
async function signedIn(newSession) {
  const generation=++authGeneration;
  closeImageViewer(false);
  session=newSession;
  inboxUnreadCount=null;inboxCountRequest++;dismissMemberAlert();memberDeferredNotification=null;memberNotificationPrimed=false;
  unreadCounts={channels:{},direct_messages:{},direct_peers:[],direct_total:0};unreadCountsReady=false;
  applicationVerification=new Map();applicationsOwner=null;feedOwner=null;channelHistoryId=null;dmThreadPeer=null;
  applicationRows=[];approvedAccountRows=[];channelHistoryRows=[];dmThreadRows=[];
  authReady=true;
  clearInterval(pollTimer); clearInterval(presenceTimer);
  clearInterval(chatTimer);clearInterval(adminAlertTimer);dismissAdminAlert();
  adminPendingCount=0;adminAlertsInitialized=false;adminSeenApplicationIds=new Set();adminAlertPolling=false;
  if(chatRealtime) { await db.removeChannel(chatRealtime); chatRealtime=null; }
  if(memberNoticeRealtime) { await db.removeChannel(memberNoticeRealtime); memberNoticeRealtime=null; }
  if(generation!==authGeneration)return;
  void window.InnovateXPush?.authChanged(session?.user.id||null,db).then(()=>{if(page==='notifications')render();}).catch(error=>{console.error('Push state',error);if(!session)show(error.message);});
  if(session) {
    pendingEmail=''; sessionStorage.removeItem('innovatex.pendingEmail');sessionStorage.removeItem('innovatex.pendingAuthMode');
    const {data,error}=await db.from('profiles').select('*').eq('id',session.user.id).single();
    if(generation!==authGeneration)return;
    if(error) { fail(error); return; }
    me=data;
    await hydrateOwnApplicationReason();
    if(generation!==authGeneration)return;
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
    if(generation!==authGeneration)return;
    pollTimer=setInterval(refreshVisiblePage,45000);
    if(approved()){
      presenceTimer=setInterval(()=>{if(!document.hidden)void touchPresence();},20000);
      if(clubAccess())chatTimer=setInterval(()=>{if(!document.hidden)void refreshChat();},9000);
    }
    if(communityReady && clubAccess()) chatRealtime=db.channel('innovatex-chat')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'channel_messages'},refreshChat).subscribe();
    if(clubAccess()){
      memberNoticeRealtime=db.channel(`innovatex-inbox-${session.user.id}`)
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${session.user.id}`},payload=>{
          const notification=payload.new;
          if(admin()&&notification?.kind==='application'&&notification.target_type==='application'){
            receiveAdminApplications([notification]);mergeAdminNotifications([notification]);
            void refreshAdminAlerts();
          }else receiveMemberNotification(notification);
        }).subscribe();
    }
    if(admin())adminAlertTimer=setInterval(()=>{if(!document.hidden)void refreshAdminAlerts();},10000);
  } else { me=null;applicationAnswersReady=false;roleReady=false;courseReady=false;coursePlanningReady=false;teacherProfileReady=false;teacherProfile=null;privacyReady=false;inventoryReady=false;inventoryCatalogReady=false;financeReady=false;financeApprovalsReady=false;cache={};mediaUrls.clear(); await loadPublic(); }
  if(session&&!approved()&&!['about','founders','investors','application','privacy'].includes(page)){page='application';history.replaceState(null,'','#application');}
  if(investor()&&!['home','about','founders','investors','investor-portal','privacy'].includes(page)){page='investor-portal';history.replaceState(null,'','#investor-portal');}
  if(page==='founder-room'&&!founder()) {page='founders';history.replaceState(null,'','#founders');}
  if(page==='finance'&&!admin()){page=founderOnly()?'finance-review':clubAccess()?'inventory':'home';history.replaceState(null,'','#'+page);}
  if(page==='finance-review'&&!founderOnly()){page=admin()?'finance':clubAccess()?'inventory':'home';history.replaceState(null,'','#'+page);}
  if(pendingProtectedPage&&clubAccess()){
    history.replaceState(null,'','#'+pendingProtectedPage);
    pendingProtectedPage='';
  }
  route();
}
async function init() {
  document.querySelectorAll('#nav a[data-page]').forEach(a=>{const slot=a.querySelector('span');if(slot)slot.innerHTML=iconSvg(a.dataset.page);});
  let savedTheme='';try{savedTheme=localStorage.getItem('innovatex.theme')||'';}catch{}
  try{adminSoundEnabled=localStorage.getItem('innovatex.adminSound')==='on';}catch{}
  document.documentElement.dataset.theme=savedTheme==='dark'?'dark':'light';
  $('#themeButton').onclick=()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('innovatex.theme',next);}catch{}updateThemeButton();};
  updateThemeButton();
  $('#todayLabel').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  $('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');
  $('#installAppButton').onclick=installInnovateX;
  updateInstallButton();
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
    updateInstallButton();
  });
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;updateInstallButton();show('InnovateX is ready on your home screen.');});
  window.addEventListener('innovatexpush',()=>{if(session){void refreshInboxUnreadCount();void refreshVisiblePage();}});
  $('#modal').addEventListener('click',e=>{ if(e.target===$('#modal')) close(); });
  $('.modal-close').onclick=close;
  setupImageViewer();
  window.addEventListener('hashchange',route);
  window.addEventListener('hashchange',()=>{
    if(session&&authReady&&!document.hidden&&!['feed','channels','messages','applications'].includes(page))void refreshVisiblePage();
  });
  $('#authButton').onclick=()=>session ? signOut() : signInDialog();
  document.addEventListener('click',actions);
  document.addEventListener('keydown',e=>{
    const tab=e.target.closest?.('.teaching-tabs [role="tab"]');
    if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    const tabs=[...tab.parentElement.querySelectorAll('[role="tab"]')];
    const current=tabs.indexOf(tab);
    const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(current+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    e.preventDefault();tabs[next]?.click();
  });
  document.addEventListener('submit',submit);
  document.addEventListener('input',e=>{if(e.target.id==='dmFilter'){const term=e.target.value.toLowerCase();document.querySelectorAll('.dm-peer').forEach(b=>b.hidden=!b.textContent.toLowerCase().includes(term));}
    if(e.target.id==='inventorySearch'){inventorySearchTerm=e.target.value;applyInventorySearch();}
  });
  document.addEventListener('change',e=>{if(['chat_image','dm_image'].includes(e.target.name)){const label=$(e.target.name==='chat_image'?'#chatImageName':'#dmImageName');if(label){label.textContent=e.target.files?.[0]?.name||'';label.hidden=!e.target.files?.length;}}
    if(e.target.name==='movement_kind'&&e.target.closest('form[data-kind="inventoryMovement"]')){const member=$('#movementMember'),input=member?.querySelector('select'),needsMember=['check_out','return','issue_stock'].includes(e.target.value);if(member&&input){member.hidden=!needsMember;input.disabled=!needsMember;input.required=needsMember;if(needsMember)input.innerHTML=movementMemberOptions(e.target.form.elements.item_id.value,e.target.value);}}
  });
  route();
  if(!db) return;
  db.auth.onAuthStateChange((_event,s)=>{ if(s?.user.id !== session?.user.id) setTimeout(()=>signedIn(s),0); });
  const {data,error}=await db.auth.getSession();
  if(error) fail(error); else await signedIn(data.session);
  document.addEventListener('visibilitychange',()=>{
    if(!session)return;
    if(document.hidden){if(approved())void touchPresence(false);return;}
    if(adminDeferredAlert)showAdminAlert(adminDeferredAlert.title,adminDeferredAlert.message);
    if(memberDeferredNotification&&(cache.notifications||[]).some(n=>n.id===memberDeferredNotification.id&&!n.read_at))showMemberAlert(memberDeferredNotification);
    if(approved())void touchPresence();
    void refreshInboxUnreadCount();
    void refreshVisiblePage();
    if(page==='channels')void refreshChat();
    if(admin())void refreshAdminAlerts();
  });
  window.addEventListener('pagehide',()=>{ if(session) touchPresence(false); });
}
function updateInstallButton(){
  $('#installAppButton').hidden=window.matchMedia?.('(display-mode: standalone)').matches===true||navigator.standalone===true;
}
async function installInnovateX(){
  if(deferredInstallPrompt){
    const prompt=deferredInstallPrompt;deferredInstallPrompt=null;
    try{
      await prompt.prompt();
      const choice=await prompt.userChoice;
      if(choice?.outcome==='accepted')show('InnovateX is being added to your device.');
    }catch(error){console.error('Install prompt unavailable',error);}
    return;
  }
  const iphone=/iPad|iPhone|iPod/i.test(navigator.userAgent);
  const directions=iphone?
    '<li>Open this page in Safari.</li><li>Tap the Share button, then <strong>Add to Home Screen</strong>.</li><li>Choose <strong>Open as Web App</strong> if shown, then tap Add.</li>':
    '<li>Open your browser menu while viewing this page.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Confirm the InnovateX icon and name.</li>';
  modal(`<span class="eyebrow">INNOVATEX ON YOUR PHONE</span><h2>Install the club app</h2><p>Keep InnovateX on your home screen and open it without a browser tab.</p><ol class="install-steps">${directions}</ol><p class="subtle">Chats, courses, account approvals and shared files still need an internet connection.</p>`);
}
function updateThemeButton(){const dark=document.documentElement.dataset.theme==='dark';$('#themeButton').textContent=dark?'☀':'☾';$('#themeButton').setAttribute('aria-label',dark?'Switch to light theme':'Switch to dark theme');}
function route() {
  const requested=location.hash.slice(1).split('/')[0] || 'home';page=pages.includes(requested)?requested:'home';
  const protectedGuestPage=!session&&!['home','about','founders','investors','privacy'].includes(page);
  if(protectedGuestPage){
    page='home';
    if(authReady||!configured){
      pendingProtectedPage=requested;
      history.replaceState(null,'','#home');
    }
  }else if(!session&&authReady)pendingProtectedPage='';
  if(session&&!approved()&&!['about','founders','investors','application','privacy'].includes(page)){page='application';history.replaceState(null,'','#application');}
  if(investor()&&!['home','about','founders','investors','investor-portal','privacy'].includes(page)){page='investor-portal';history.replaceState(null,'','#investor-portal');}
  if(page==='investor-portal'&&authReady&&!investor()&&!admin()){page='investors';history.replaceState(null,'','#investors');}
  if(page==='teaching'&&authReady&&!teacher()){page=clubAccess()?'courses':'home';history.replaceState(null,'','#'+page);}
  if(page==='finance'&&authReady&&!admin()){page=founderOnly()?'finance-review':clubAccess()?'inventory':'home';history.replaceState(null,'','#'+page);}
  if(page==='finance-review'&&authReady&&!founderOnly()){page=admin()?'finance':clubAccess()?'inventory':'home';history.replaceState(null,'','#'+page);}
  if(page==='founder-room'&&authReady&&!founder()){page='founders';history.replaceState(null,'','#founders');show('Founder access required.');}
  if(['admin','applications','moderation'].includes(page)&&authReady&&!admin()){page='home';history.replaceState(null,'','#home');}
  $('#sidebar').classList.remove('open');render();
  if(protectedGuestPage&&(authReady||!configured))signInDialog('signin');
  if(page==='applications'&&admin())void loadAdminApplicationPages();
  if(page==='feed'&&feedReady)void loadFeedPage();
  if(page==='channels'&&communityReady&&activeChannelId)void loadChannelHistory();
  if(page==='messages'&&dmReady&&activePeerId)void loadDmThread();
}
function render() {
  $('#authButton').textContent=session?'Sign out':'Join / sign in';
  $('#connectionLabel').textContent=!configured?'Setup required':session&&!approved()?'Application pending':investor()?'Investor portal live':session?'Member workspace live':'Public preview';
  $('#accountBadge').hidden=!approved();$('#accountBadge').innerHTML=approved()?roleBadge(me):'';
  $('#pageCrumb').textContent=page==='founder-room'?'Founder room':page[0].toUpperCase()+page.slice(1);
  document.querySelectorAll('#nav a').forEach(a=>{a.classList.toggle('active',a.dataset.page===page);a.hidden=a.hasAttribute('data-private')&&!clubAccess();});
  document.querySelectorAll('#nav [data-founder]').forEach(a=>a.hidden=!founder());
  document.querySelectorAll('#nav [data-leadership]').forEach(a=>a.hidden=!founder());
  document.querySelectorAll('#nav [data-founder-only]').forEach(a=>a.hidden=!founderOnly());
  document.querySelectorAll('#nav [data-investors-nav]').forEach(a=>a.hidden=!founder());
  document.querySelectorAll('#nav [data-teacher]').forEach(a=>a.hidden=!teacher());
  document.querySelectorAll('#nav [data-investor]').forEach(a=>a.hidden=!investor()&&!admin());
  document.querySelectorAll('#nav [data-admin]').forEach(a=>a.hidden=!admin());
  document.querySelectorAll('#nav [data-pending]').forEach(a=>a.hidden=!session||approved());
  document.querySelectorAll('#nav .nav-group:not([data-admin])').forEach(a=>a.hidden=!clubAccess());
  $('#guestSidebarCta').hidden=!!session||configured&&!authReady;
  const online=(cache.profiles||[]).filter(p=>p.last_seen_at&&Date.now()-new Date(p.last_seen_at).getTime()<65000).length;
  $('#onlineBadge').textContent=online;
  updateInboxIndicators();
  updateAdminAlertControls();
  const pendingFinance=founderOnly()&&financeApprovalsReady?(cache.finance_entries||[]).filter(x=>financeStatus(x)==='pending').length:0;
  const financeBadge=$('#financeReviewBadge');if(financeBadge){financeBadge.textContent=pendingFinance;financeBadge.hidden=!pendingFinance;}
  const unreadDm=unreadCountsReady?unreadCounts.direct_total:(cache.direct_messages||[]).filter(m=>m.recipient_id===session?.user.id&&(!((cache.direct_message_reads||[]).find(r=>r.peer_id===m.sender_id))||new Date(m.created_at)>new Date((cache.direct_message_reads||[]).find(r=>r.peer_id===m.sender_id).last_read_at))).length;
  $('#dmBadge').textContent=unreadDm;$('#dmBadge').hidden=!unreadDm;
  const views={home,about,founders,investors,'investor-portal':investorPortal,admin:adminDashboard,privacy,application,applications,moderation,notifications,members,messages,feed,channels,library,news,projects,inventory,finance,'finance-review':financeReview,discussions,courses,teaching,events,calendar:calendarPage,announcements,'founder-room':founderRoom};
  $('#content').innerHTML=views[page]();
  if(page==='inventory')applyInventorySearch();
  $('#content').classList.toggle('view-enter',page!==lastRenderedPage);lastRenderedPage=page;
  if(page==='channels'){const stream=$('#messageStream');if(stream)stream.scrollTop=channelPage>0?0:stream.scrollHeight;if(channelPage===0&&activeChannelId&&enhancedReady)markChannelRead(activeChannelId);}
  if(page==='messages'){const stream=$('#dmStream');if(stream)stream.scrollTop=dmPage>0?0:stream.scrollHeight;if(dmPage===0&&activePeerId&&dmReady)markDmRead(activePeerId);}
}
function homeFocusCard(icon,label,title,detail,href,action='Open details',urgent=false){
  return `<a class="home-focus-card ${urgent?'is-urgent':''}" href="${href}"><span class="home-focus-icon">${iconSvg(icon)}</span><span class="home-focus-label">${esc(label)}</span><strong>${esc(title)}</strong><span class="home-focus-detail">${esc(detail)}</span><span class="home-focus-action">${esc(action)} →</span></a>`;
}
function personalHome(){
  const userId=session.user.id,now=Date.now();
  const name=(me?.full_name||session.user.email||'member').trim().split(/\s+/)[0];
  const enrollments=courseReady?(cache.course_enrollments||[]).filter(e=>e.learner_id===userId):[];
  const activeIds=new Set(enrollments.filter(e=>e.status!=='completed').map(e=>e.course_id));
  const myCourses=(cache.courses||[]).filter(c=>activeIds.has(c.id));
  const workshop=myCourses.filter(c=>c.starts_at&&new Date(c.starts_at).getTime()>=now).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at))[0];
  const deadlines=coursePlanningReady?myCourses.filter(c=>courseDeadline(c)).sort((a,b)=>courseDeadline(a)-courseDeadline(b)):[];
  const deadline=deadlines.find(c=>courseDeadline(c).getTime()<now)||deadlines[0];
  const feedback=courseReady?(cache.course_submissions||[]).filter(s=>s.learner_id===userId&&s.review_status!=='submitted'&&s.teacher_feedback).sort((a,b)=>new Date(b.reviewed_at||b.created_at)-new Date(a.reviewed_at||a.created_at))[0]:null;
  const feedbackCourse=feedback?(cache.courses||[]).find(c=>c.id===feedback.course_id):null;
  const tasks=(cache.project_tasks||[]).filter(t=>t.assignee_id===userId&&t.status!=='done').sort((a,b)=>new Date(a.due_at||'9999-12-31')-new Date(b.due_at||'9999-12-31'));
  const event=(cache.events||[]).filter(e=>new Date(e.starts_at).getTime()>=now).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at))[0];
  const notifications=(cache.notifications||[]).filter(n=>!n.read_at).length;
  const unreadMessages=unreadCountsReady?unreadCounts.direct_total+Object.values(unreadCounts.channels).reduce((sum,n)=>sum+(Number(n)||0),0):null;
  const assigned=(cache.courses||[]).filter(c=>c.instructor_id===userId),assignedIds=new Set(assigned.map(c=>c.id));
  const reviews=courseReady?(cache.course_submissions||[]).filter(s=>assignedIds.has(s.course_id)&&s.review_status==='submitted'):[];
  const teachingDate=assigned.flatMap(c=>[{title:c.title,at:c.starts_at,label:'Workshop starts'},{title:c.title,at:coursePlanningReady?c.submission_due_at:null,label:'Project deadline'}]).filter(x=>x.at&&new Date(x.at).getTime()>=now).sort((a,b)=>new Date(a.at)-new Date(b.at))[0];
  const meeting=founder()?(cache.founder_meetings||[]).filter(m=>new Date(m.starts_at).getTime()>=now).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at))[0]:null;
  const financePending=founderOnly()&&financeApprovalsReady?(cache.finance_entries||[]).filter(e=>financeStatus(e)==='pending').length:0;
  const reports=admin()?(cache.reports||[]).filter(r=>r.status==='open').length:0;
  const queue=admin()?[
    homeFocusCard('applications','ADMINISTRATOR · APPLICATIONS',`${adminPendingCount} waiting for review`,adminPendingCount?'Check verification and application details before deciding.':'New applications will appear here.','#applications','Review applications',adminPendingCount>0),
    homeFocusCard('moderation','ADMINISTRATOR · REPORTS',`${reports} open ${reports===1?'report':'reports'}`,reports?'Review reported posts, messages and shared content.':'Your moderation queue is clear.','#moderation','Open moderation',reports>0)
  ]:founderOnly()?[
    homeFocusCard('founder-room','FOUNDER · NEXT MEETING',meeting?.title||'No meeting scheduled',meeting?dateTime(meeting.starts_at):'Plan the next founder discussion.','#founder-room','Open founder room'),
    homeFocusCard('finance','FOUNDER · FINANCE',financeApprovalsReady?`${financePending} ${financePending===1?'entry':'entries'} to review`:'Finance review',financeApprovalsReady?'Check the purpose and evidence before a decision.':'Open the finance review page for setup details.','#finance-review','Review finance',financePending>0)
  ]:teacher()?[
    homeFocusCard('teaching','TEACHER · PROJECT REVIEWS',courseReady?`${reviews.length} ${reviews.length===1?'submission':'submissions'} awaiting feedback`:'Project reviews',courseReady?'Give learners a clear next step on their builds.':'Open Teaching studio for setup details.','#teaching','Review projects',reviews.length>0),
    homeFocusCard('calendar','TEACHER · COMING UP',teachingDate?.title||'No session scheduled',teachingDate?`${teachingDate.label} · ${dateTime(teachingDate.at)}`:'Set a date or deadline for your next workshop.','#teaching','Plan teaching')
  ]:[];
  if(founderOnly()&&teacher())queue.push(homeFocusCard('teaching','TEACHING LEAD · REVIEWS',courseReady?`${reviews.length} ${reviews.length===1?'submission':'submissions'} awaiting feedback`:'Project reviews',teachingDate?`${teachingDate.label}: ${teachingDate.title} · ${dateTime(teachingDate.at)}`:'Open Teaching studio to plan your workshops.','#teaching','Open teaching studio',reviews.length>0));
  const priority=admin()?'Club oversight':founderOnly()?'Founder priorities':teacher()?'Teaching priorities':'';
  const focus=[
    homeFocusCard('courses','YOUR NEXT WORKSHOP',workshop?.title||'Choose a practical workshop',workshop?`${dateTime(workshop.starts_at)} · ${courseTrackFor(workshop)}`:courseReady?'Browse the four tracks and join a build.':'Open Courses to see your learning options.','#courses','Open courses'),
    homeFocusCard('calendar','PROJECT DEADLINE',deadline?.title||'No project deadline set',deadline?`${courseDeadline(deadline).getTime()<now?'Past due · submissions remain open':'Due'} ${dateTime(deadline.submission_due_at)}`:'Your course deadlines will appear here.','#calendar','View calendar',!!deadline&&courseDeadline(deadline).getTime()<now),
    homeFocusCard('courses','TEACHER FEEDBACK',feedbackCourse?.title||'No feedback yet',feedback?`${feedback.review_status==='revision_requested'?'Revision requested':'Project accepted'} · ${feedback.teacher_feedback.slice(0,130)}${feedback.teacher_feedback.length>130?'…':''}`:'Your latest project review will appear here.','#courses','See my courses',feedback?.review_status==='revision_requested'),
    homeFocusCard('projects','ASSIGNED PROJECT TASKS',tasks.length?`${tasks.length} ${tasks.length===1?'task':'tasks'} in progress`:'No tasks assigned',tasks.length?`${tasks[0].title}${tasks[0].due_at?' · due '+dateTime(tasks[0].due_at):''}`:'Join a project or start one with your team.','#projects','View projects',!!tasks[0]?.due_at&&new Date(tasks[0].due_at).getTime()<now)
  ];
  return `<section class="home-personal-intro"><div><span class="eyebrow">YOUR INNOVATEX WORKSPACE</span><h1>Welcome back, ${esc(name)}.</h1><p>Pick up your next build, answer your team and keep the club moving.</p></div><a class="button button-outline" href="#calendar">Open calendar ↗</a></section>
  <div class="home-glance"><a href="#courses"><small>Courses in your plan</small><strong>${courseReady?enrollments.length:'—'}</strong><span>Explore your workshops →</span></a><a href="#events"><small>Next club event</small><strong class="home-glance-date">${esc(event?date(event.starts_at):'To be announced')}</strong><span>${esc(event?.title||'See the calendar')} →</span></a><a href="#notifications"><small>Unread alerts</small><strong>${notifications}</strong><span>Open inbox →</span></a><a href="#channels"><small>Unread messages</small><strong>${unreadMessages??'—'}</strong><span>${unreadMessages===null?'Open member channels':'Open conversations'} →</span></a></div>
  ${queue.length?`<div class="section-heading"><div><span class="eyebrow">NEEDS YOUR ATTENTION</span><h2>${priority}</h2></div></div><div class="home-focus-grid home-role-grid">${queue.join('')}</div>`:''}
  <div class="section-heading"><div><span class="eyebrow">YOUR NEXT MOVES</span><h2>Learning and projects</h2></div><a class="link" href="#calendar">See full calendar →</a></div><div class="home-focus-grid">${focus.join('')}</div>
  <div class="section-heading"><div><span class="eyebrow">BUILD TOGETHER</span><h2>Stay in the conversation</h2></div></div><div class="home-community-links"><a href="#feed">Share a build update <span>Activity feed →</span></a><a href="#channels">Ask your team <span>Member channels →</span></a><a href="#library">Find a resource <span>Document library →</span></a></div>`;
}
function home() {
  if(investor())return `${head('INNOVATEX PARTNERS','Welcome, '+(me?.full_name||'investor'),'Your approved investor space brings together curated updates and a direct inquiry form.')}<div class="grid grid-2"><a class="card feature-card" href="#investor-portal"><span class="feature-icon">${iconSvg('investors')}</span><h3>Investor portal</h3><p>Read updates the club has approved for investors and send a question to the team.</p><span class="link">Open portal →</span></a><a class="card feature-card" href="founders/"><span class="feature-icon">${iconSvg('founders')}</span><h3>Meet the founders</h3><p>Learn about the people guiding InnovateX.</p><span class="link">View founders →</span></a></div>`;
  if(clubAccess())return personalHome();
  const count=n=>(cache[n]||[]).length;
  const latest=(cache.announcements||[]).slice(0,3);
  const upcoming=(cache.events||[]).filter(e=>new Date(e.starts_at)>new Date()).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)).slice(0,3);
  return `<section class="hero"><div class="hero-copy"><span class="eyebrow">A COMMUNITY FOR ENGINEERS &amp; MAKERS</span><h1>Ideas become<br>working systems.</h1><p>Learn control, automation, electronics, software and robotics. Build prototypes together and prepare for regional and national competitions.</p><div class="hero-actions">${session?`<a class="button" href="#projects">Explore projects ↗</a>`:button('Join the workspace ↗','login')}<a class="button button-outline" href="about/">About the club</a></div></div><div class="hero-graphic">IX✦</div></section>
  <div class="section-heading"><div><span class="eyebrow">CLUB PULSE</span><h2>${session?'Your workspace at a glance':'Built for makers and innovators'}</h2></div><p>${session?`Welcome back, ${esc(me?.full_name||session.user.email)}.`:'A community of makers sharing practical skills and projects.'}</p></div>
  <div class="grid grid-4"><div class="stat"><small>Visible profiles</small><b>${session?count('profiles'):'—'}</b><span>In your workspace</span></div><div class="stat"><small>Visible online</small><b>${session?(cache.profiles||[]).filter(p=>p.last_seen_at&&Date.now()-new Date(p.last_seen_at).getTime()<65000).length:'—'}</b><span>Active in the last minute</span></div><div class="stat"><small>Active projects</small><b>${session?count('projects'):'—'}</b><span>Ideas in motion</span></div><div class="stat"><small>Upcoming events</small><b>${session?upcoming.length:'—'}</b><span>Sessions and meetups</span></div></div>
  <div class="section-heading"><div><span class="eyebrow">OUR MISSION</span><h2>From the workbench to the world.</h2></div></div><div class="grid grid-3">${[['courses','Learn','Hands-on courses in Arduino, Proteus, CAD, OpenPLC and electrical systems.'],['projects','Build','Plan and test real prototypes with multidisciplinary teams and mentors.'],['founder-room','Compete','Turn the strongest projects into competition-ready demonstrations.']].map(x=>`<div class="card mission-card"><div class="icon-box">${iconSvg(x[0])}</div><h3>${x[1]}</h3><p>${x[2]}</p></div>`).join('')}</div>
  <section class="studio-banner"><img src="assets/robotics-workbench.webp" alt="Concept artwork of hands assembling a robotics prototype" loading="lazy"><div><span class="eyebrow">ENGINEERING INSPIRATION · CONCEPT ARTWORK</span><h2>Make something that works.</h2><p>Find your team, share your next test and turn a good idea into a working prototype.</p><a class="button" href="${session?'#projects':'about/'}">${session?'Explore club projects':'Discover the club'} →</a></div></section>
  ${session?`<div class="section-heading"><h2>Your community</h2><p>Find a conversation or share what you’re learning.</p></div><div class="grid grid-4"><a class="card feature-card" href="#feed"><span class="feature-icon">${iconSvg('feed')}</span><h3>Activity feed</h3><p>Share progress and hear from club members.</p><span class="link">Open feed →</span></a><a class="card feature-card" href="#channels"><span class="feature-icon">${iconSvg('channels')}</span><h3>Member channels</h3><p>Get help and work through ideas together.</p><span class="link">Open channels →</span></a><a class="card feature-card" href="#library"><span class="feature-icon">${iconSvg('library')}</span><h3>Document library</h3><p>Notes, schematics and useful resources in one place.</p><span class="link">Browse files →</span></a><a class="card feature-card" href="#news"><span class="feature-icon">${iconSvg('news')}</span><h3>Technology news</h3><p>Discover engineering stories worth discussing.</p><span class="link">Read stories →</span></a></div>`:''}
  ${session?`<div class="section-heading"><h2>What’s happening</h2><a class="link" href="#events">View calendar →</a></div><div class="split"><div class="panel"><h3>Latest alerts</h3>${latest.length?latest.map(a=>`<div class="list-item"><span class="icon-box" style="margin:0">◈</span><div><strong>${esc(a.title)}</strong><small>${date(a.created_at)}</small><p class="subtle">${esc(a.body)}</p></div></div>`).join(''):empty('No alerts yet','Official club updates will appear here.')}</div><div class="panel"><h3>Coming up</h3>${upcoming.length?upcoming.map(e=>eventRow(e)).join(''):empty('Nothing scheduled','The next club event will appear here.')}</div></div>`:''}`;
}
function about() {
  const tracks=[
    {name:'Controls and Automation',detail:'Wire sensors and actuators, design control logic, and test systems that respond to the real world.',outcome:'Prototype: a working controller',icon:'projects'},
    {name:'Software and Programming',detail:'Write code, build interfaces and connect data to useful tools for people and projects.',outcome:'Prototype: an app or dashboard',icon:'courses'},
    {name:'Electronics and Robotics',detail:'Assemble circuits, integrate microcontrollers and bring moving or connected machines to life.',outcome:'Prototype: a tested device or robot',icon:'projects'},
    {name:'AI & Machine Learning',detail:'Explore data, train and evaluate models, and put a useful idea into a working demonstration.',outcome:'Prototype: a usable model',icon:'news'}
  ];
  const join=clubAccess()?'<a class="button" href="#courses">Explore practical courses ↗</a>':investor()?'<a class="button" href="#investor-portal">Explore the investor portal ↗</a>':session?'<a class="button" href="#application">View my application ↗</a>':button('Apply to join ↗','login');
  return `<section class="about-hero">
    <div class="about-hero-media"><img class="about-hero-image" src="assets/club-about-lab.webp" alt="Illustration of club members working together on a prototype"><div class="about-hero-overlay"></div></div>
    <div class="about-hero-copy"><span class="eyebrow about-kicker">ABOUT INNOVATEX ENGINEERING CLUB</span><h1>Learn it. Build it.<br>Make it matter.</h1><p>InnovateX Engineering Club brings curious builders, learners and mentors together across disciplines to learn practical skills, test ideas and turn promising prototypes into work we can share.</p><div class="hero-actions">${join}<a class="button button-outline" href="#founders">Meet the founders</a></div></div>
    <small class="about-image-note">Illustrative imagery</small>
  </section>
  <section class="about-section" aria-labelledby="about-purpose"><div class="section-heading"><div><span class="eyebrow">OUR PURPOSE</span><h2 id="about-purpose">Engineering grows when we build together.</h2></div></div>
    <div class="about-split"><div class="about-intro"><p class="lead">We are a community of people who learn by building, sharing and testing ideas together. Members share knowledge, help each other through technical challenges and create work they can demonstrate.</p><p>Our focus is practical: define a problem, make a first version, test it, learn from the result and improve it. The club platform connects those steps through courses, project planning, member channels, documents and events.</p></div>
    <div class="about-photo"><img src="assets/club-about-team.webp" alt="Illustration of club members collaborating around an engineering project" loading="lazy"><span class="about-photo-caption">People + practical skills + shared projects <small>Illustrative imagery</small></span></div></div>
  </section>
  <section class="about-section" aria-labelledby="about-direction"><div class="section-heading"><div><span class="eyebrow">THE DIRECTION</span><h2 id="about-direction">A clear reason to come together.</h2></div></div>
    <div class="grid grid-2"><article class="card about-statement"><span class="eyebrow">01 / VISION</span><h3>A community of engineers who turn ideas into useful solutions.</h3><p>We want members to gain the confidence, skills and collaborators to solve problems in the world around them.</p></article>
    <article class="card about-statement"><span class="eyebrow">02 / MISSION</span><h3>Learn by doing, then share what works.</h3><p>We connect members with practical workshops, team projects, constructive feedback and opportunities to present their work.</p></article></div>
  </section>
  <section class="about-section" id="about-tracks" aria-labelledby="about-tracks-title"><div class="section-heading"><div><span class="eyebrow">FOUR LEARNING TRACKS</span><h2 id="about-tracks-title">Pick a skill. Leave with a working result.</h2></div><p>Workshops centre on a build, a test and what members learned.</p></div>
    <div class="about-track-grid">${tracks.map((track,i)=>`<article class="card about-track-card"><span class="about-track-number">0${i+1}</span><span class="feature-icon">${iconSvg(track.icon)}</span><h3>${track.name}</h3><p>${track.detail}</p><span class="about-outcome">${track.outcome}</span></article>`).join('')}</div>
  </section>
  <section class="about-section" aria-labelledby="about-process-title"><div class="section-heading"><div><span class="eyebrow">HOW WE WORK</span><h2 id="about-process-title">A place to begin. A team to keep going.</h2></div></div>
    <div class="about-process"><article class="about-step"><span>01</span><h3>Find your people</h3><p>Meet members across disciplines, introduce an idea or join a conversation.</p></article><article class="about-step"><span>02</span><h3>Build and test</h3><p>Learn a practical skill, plan with a team and document what you discover.</p></article><article class="about-step"><span>03</span><h3>Show your work</h3><p>Share your progress, get feedback and prepare strong projects for demonstrations and competitions.</p></article></div>
  </section>
  <section class="about-section" aria-labelledby="about-values-title"><div class="section-heading"><div><span class="eyebrow">OUR CULTURE</span><h2 id="about-values-title">The habits behind good work.</h2></div></div>
    <div class="about-values"><div class="about-value"><strong>Curiosity</strong><p>Ask good questions and keep learning.</p></div><div class="about-value"><strong>Collaboration</strong><p>Bring different skills to one challenge.</p></div><div class="about-value"><strong>Care</strong><p>Work safely, respect people and build responsibly.</p></div><div class="about-value"><strong>Follow-through</strong><p>Test the idea and share honest results.</p></div></div>
  </section>
  <section class="about-section" aria-labelledby="about-leadership-title"><div class="section-heading"><div><span class="eyebrow">PEOPLE &amp; LEADERSHIP</span><h2 id="about-leadership-title">Built by members, strengthened by mentors.</h2></div></div>
    <div class="grid grid-3"><div class="card"><h3>Members</h3><p>Learn, collaborate, share projects and help shape the community.</p></div><div class="card"><h3>Founders &amp; teachers</h3><p>Approved founders coordinate the club; approved teachers can guide practical learning and share materials.</p></div><div class="card"><h3>Independent club</h3><p>Founders and members set the direction, make decisions and keep the club accountable.</p></div></div><p class="subtle">We plan to inform the Dean of Students’ Affairs about the independent club and seek acknowledgement of its existence.</p><p class="subtle">Founders are introduced on the <a class="link" href="#founders">Founders page</a> once each person confirms their profile.</p>
  </section>
  <section class="about-cta"><span class="eyebrow">YOUR NEXT BUILD STARTS HERE</span><h2>Bring an idea. Bring a question.<br>Bring your willingness to learn.</h2><p>Discover the people and projects behind InnovateX Engineering Club.</p><div class="hero-actions">${join}<a class="button button-outline" href="#founders">Explore the team →</a></div></section>`;
}
function founderPortraitUrl(f){
  if(!db||!founderPortraitReady||!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/.test(f.portrait_path||''))return '';
  return cleanUrl(db.storage.from('club-founder-portraits').getPublicUrl(f.portrait_path).data.publicUrl);
}
function founderBio(f){
  const bio=String(f.bio||'Founding team member').trim();
  if(bio.length<=195)return `<p class="founder-bio">${esc(bio)}</p>`;
  const cut=bio.slice(0,195).replace(/\s+\S*$/,'').trim();
  return `<p class="founder-bio">${esc(cut)}…</p><details class="founder-full-bio"><summary>Read full bio</summary><p>${esc(bio)}</p></details>`;
}
function founderProfile(f){
  const portrait=founderPortraitUrl(f),profile=cleanUrl(f.link_url||'');
  return `<article class="card founder-profile"><div class="founder-portrait">${portrait?`<img src="${esc(portrait)}" alt="Portrait of ${esc(f.name)}" loading="lazy" onerror="this.remove()">`:''}<span class="founder-portrait-fallback" aria-hidden="true">${esc(initials(f.name))}</span></div><div class="founder-profile-body"><span class="role">${esc(f.role)}</span><h3>${esc(f.name)}</h3>${founderBio(f)}<div class="founder-actions">${profile?`<a class="button button-outline button-sm" target="_blank" rel="noopener noreferrer" href="${esc(profile)}">View profile ↗</a>`:''}${admin()&&founderPortraitReady?`<button class="button button-outline button-sm" data-action="editFounderForm" data-id="${esc(f.id)}">Edit profile</button>`:''}${admin()?`<button class="text-button founder-card-remove" data-action="removeFounderCard" data-id="${esc(f.id)}">Remove public profile</button>`:''}</div></div></article>`;
}
function founders() {
  const list=cache.founders||[];
  return `${head('THE PEOPLE BEHIND THE IDEA','Founding team','The founding team shaping InnovateX with members, teachers and mentors.',admin()?button('+ Add founder','founderForm'):'')}
  <div class="notice">Founder profiles are added only after each person agrees to be listed.</div>
  <div class="section-heading"><h2>Meet the founders</h2></div><div class="founder-list ${list.length===1?'single':''}">${list.length?list.map(founderProfile).join(''):`<div class="founder-empty"><h3>Meet the team soon</h3><p>Founders will appear here after they approve their public profiles.</p></div>`}</div>
  <div class="founder-invite-banner"><div><span class="eyebrow">FOUNDER ACCESS</span><h3>Build the club together.</h3><p>Administrators approve founder applications. Accepted founders can plan together and meet in a private room.</p></div>${founder()?`<a class="button" href="#founder-room">Open founder room →</a>`:!session?button('Apply as founder','login'):''}</div>
  <div class="section-heading"><h2>How the club is led</h2></div><div class="grid grid-3"><div class="card"><h3>Club leadership</h3><p>Club leaders coordinate training, projects, communications and finance.</p></div><div class="card"><h3>Founders</h3><p>Founders set the club’s direction and lead its mentoring and partnerships.</p></div><div class="card"><h3>Internal accountability</h3><p>Administrators keep records of club funds, inventory and approvals; founders review financial entries.</p></div></div>`;
}
function investors(){
  return `${head('PARTNER WITH INNOVATEX','Investors & partners','Explore how engineering ideas become useful prototypes through shared learning and practical projects.')}
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
  memberDirectoryPage=Math.min(memberDirectoryPage,Math.max(0,Math.ceil(people.length/50)-1));
  const pageMembers=people.sort((a,b)=>Number(online(b))-Number(online(a))||a.full_name.localeCompare(b.full_name)).slice(memberDirectoryPage*50,memberDirectoryPage*50+50);
  const invite=(cache.founder_invites||[]).find(i=>i.email===session?.user.email?.toLowerCase()&&!i.accepted_at);
  return `${head('COMMUNITY','Members','See who is around and connect with the people building InnovateX.',`<div class="profile-buttons">${avatarReady?button('Change photo','avatarForm','button-outline'):''}${button('Edit my profile','profileForm')}<a class="button button-outline" href="#privacy">Privacy settings</a></div>`)}
  ${invite?`<div class="founder-invite-banner"><div><span class="eyebrow">FOUNDER INVITATION</span><h3>You’ve been invited to join the founding team.</h3><p>Accept with your verified account to open founder meetings and planning.</p></div>${button('Accept invitation','acceptFounder')}</div>`:''}
  <div class="grid grid-4"><div class="stat"><small>Visible members</small><b>${people.length}</b><span>In your directory</span></div><div class="stat"><small>Visible online</small><b>${people.filter(online).length}</b><span>Seen within 65 seconds</span></div></div><div class="section-heading"><h2>Member directory</h2><p>Presence updates while the workspace is open. Private profiles appear only to their owner and administrators.</p></div><div class="profile-grid">${people.length?pageMembers.map(p=>`<div class="card person">${p.avatar_path?`<button type="button" class="person-photo-trigger" data-action="viewProfilePhoto" data-id="${esc(p.id)}" aria-label="View ${esc(p.full_name)}'s profile photo full screen">${memberAvatar(p.id)}</button>`:memberAvatar(p.id)}<div><h3>${esc(p.full_name||'New member')}</h3>${roleBadge(p)}<p class="subtle">${esc(p.headline||p.programme||'Member')}</p></div>${online(p)?'<span class="online-dot" title="Online"></span>':''}<button class="text-button" data-action="memberProfile" data-id="${esc(p.id)}">Profile</button></div>`).join(''):empty('No members yet','Member profiles will appear after signup.')}</div>${recordsPager('memberDirectory',memberDirectoryPage,people.length)}`;
}
function memberProfile(id) {
  const p=(cache.profiles||[]).find(x=>x.id===id&&x.membership_status==='approved'&&x.role!=='investor');if(!p)return;
  const online=p.last_seen_at&&Date.now()-new Date(p.last_seen_at)<65000;
  modal(`<div class="member-profile-hero">${p.avatar_path?`<button type="button" class="profile-photo-trigger" data-action="viewProfilePhoto" data-id="${esc(p.id)}" aria-label="View ${esc(p.full_name)}'s profile photo full screen">${memberAvatar(p.id,true)}<span class="profile-photo-hint">Tap to enlarge</span></button>`:memberAvatar(p.id,true)}<span class="tag ${online?'':'blue'}">${online?'Online':esc(p.availability||'Member')}</span></div><h2>${esc(p.full_name)}</h2>${roleBadge(p)}<p class="profile-headline">${esc(p.headline||p.programme||'Club member')}</p><p class="subtle">${p.handle?'@'+esc(p.handle)+' · ':''}${esc(p.programme||'InnovateX Engineering Club')}</p><div class="profile-facts"><div><small>Role</small><strong>${esc(p.role)}</strong></div><div><small>Availability</small><strong>${esc(p.availability||'Available')}</strong></div><div><small>Joined</small><strong>${date(p.created_at)}</strong></div></div><h3>About</h3><p class="profile-bio">${esc(p.bio||'This member has not added a bio yet.')}</p><h3>Skills & interests</h3><p>${esc(p.skills||'Not listed yet.')}</p><div class="profile-buttons">${p.id===session?.user.id?`${avatarReady?button('Change photo','avatarForm','button-outline'):''}${button('Edit my profile','profileForm')}`:dmReady?`<button class="button" data-action="openDm" data-id="${esc(p.id)}">Message ${esc(p.full_name.split(' ')[0])} →</button>`:''}</div>`);
  if(p.avatar_path&&!mediaUrl(p.avatar_path))void hydrateMedia([p.avatar_path]).then(changed=>{
    const trigger=$('#modal .profile-photo-trigger');
    if(changed&&trigger?.dataset.id===id&&trigger.querySelector('.avatar'))trigger.querySelector('.avatar').outerHTML=memberAvatar(id,true);
  }).catch(console.error);
}
function messages() {
  if(!dmReady)return head('MEMBER CONNECTIONS','Direct messages','Private conversations with club members.')+communityNotice();
  const history=cache.direct_messages||[];
  const peers=new Set(history.map(m=>m.sender_id===session.user.id?m.recipient_id:m.sender_id));
  if(unreadCountsReady)for(const id of unreadCounts.direct_peers)peers.add(id);
  const people=(cache.profiles||[]).filter(p=>p.id!==session.user.id&&p.membership_status==='approved'&&p.role!=='investor');
  for(const id of peers)if(id!==session.user.id&&!people.some(p=>p.id===id))people.push({id,full_name:'Private member',headline:'Profile not shared',private_placeholder:true});
  if(activePeerId&&activePeerId!==session.user.id&&!people.some(p=>p.id===activePeerId))people.push({id:activePeerId,full_name:'Private member',headline:'Profile not shared',private_placeholder:true});
  const ordered=people.slice().sort((a,b)=>Number(peers.has(b.id))-Number(peers.has(a.id))||a.full_name.localeCompare(b.full_name));
  const peer=people.find(p=>p.id===activePeerId);
  const thread=peer?(dmThreadPeer===peer.id?dmThreadRows:history.filter(m=>(m.sender_id===session.user.id&&m.recipient_id===peer.id)||(m.recipient_id===session.user.id&&m.sender_id===peer.id))).slice().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)):[];
  return `${head('MEMBER CONNECTIONS','Direct messages','Discuss a project with another approved club member.')}
    ${!unreadCountsReady?'<div class="notice">Unread counts may be incomplete while the club finishes setup. Contact an administrator if a conversation seems missing.</div>':''}
    <div class="dm-layout"><div class="dm-list"><div class="dm-heading">Members <span>${people.length}</span></div><div class="dm-search"><label class="sr-only" for="dmFilter">Find a member</label><input id="dmFilter" placeholder="Find a member"></div>${ordered.map(p=>{const last=history.filter(m=>m.sender_id===p.id||m.recipient_id===p.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];const seen=(cache.direct_message_reads||[]).find(r=>r.peer_id===p.id)?.last_read_at;const unread=unreadCountsReady?Number(unreadCounts.direct_messages[p.id]||0):history.filter(m=>m.sender_id===p.id&&(!seen||new Date(m.created_at)>new Date(seen))).length;return `<button class="dm-peer ${p.id===activePeerId?'selected':''}" data-action="openDm" data-id="${esc(p.id)}">${memberAvatar(p.id)}<span><strong>${esc(p.full_name)}</strong><small>${esc(last?.body||p.headline||p.programme||'Start a conversation')}</small></span>${unread?`<i class="unread-badge">${unread}</i>`:''}</button>`}).join('')||empty('No other members','Approved members will appear here.')}</div>
    <div class="dm-conversation">${peer?`<div class="chat-head"><div><h2>${esc(peer.full_name)}</h2><p>${esc(peer.headline||peer.programme||'Club member')}</p></div>${peer.private_placeholder?'':`<button class="text-button" data-action="memberProfile" data-id="${esc(peer.id)}">View profile</button>`}</div>${dmThreadError?`<div class="notice">${esc(dmThreadError)} <button class="text-button" data-action="reloadDmThread">Retry</button></div>`:''}${dmTotal>50?`<div class="records-toolbar"><small class="subtle">Messages ${dmPage*50+1}–${Math.min(dmTotal,dmPage*50+50)} of ${dmTotal}</small><div class="records-actions"><button class="button button-outline button-sm" data-action="dmOlder" ${(dmPage+1)*50>=dmTotal||dmThreadLoading?'disabled':''}>← Older</button><button class="button button-outline button-sm" data-action="dmNewer" ${dmPage===0||dmThreadLoading?'disabled':''}>Newer →</button></div></div>`:''}<div id="dmStream" class="dm-stream">${thread.length?thread.map(m=>{const photo=mediaUrl(m.image_path);return `<div class="dm-bubble ${m.sender_id===session.user.id?'mine':''}">${m.sender_id!==session.user.id?memberAvatar(peer.id):''}<div><p>${esc(m.body)}</p>${photo?`<a href="${esc(photo)}" data-action="viewImage" data-media-path="${esc(m.image_path)}" data-caption="Image shared in this conversation" target="_blank" rel="noopener noreferrer" aria-label="View private image full screen"><img class="dm-photo" src="${esc(photo)}" loading="lazy" alt="Image shared in this conversation"></a>`:''}<small>${dateTime(m.created_at)}</small></div></div>`}).join(''):dmThreadLoading?empty('Loading messages','Fetching this part of the conversation…'):empty('Start a conversation','Send a message about a club project or upcoming event.')}</div><form id="dmComposer" class="chat-composer">${mediaReady?`<label class="gallery-picker" title="Choose an image from your gallery">▧<span class="sr-only">Choose image</span><input name="dm_image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>`:''}<label class="sr-only" for="dmBody">Message</label><input id="dmBody" name="body" maxlength="3000" placeholder="Message ${esc(peer.full_name)}" ${mediaReady?'':'required'} autocomplete="off"><button class="button" type="submit">Send ↗</button>${mediaReady?`<span id="dmImageName" class="chat-image-name" hidden></span>`:''}</form>`:empty('Choose a member','Select someone to start a private conversation.')}</div></div>`;
}
async function markDmRead(peerId) {
  if(!dmReady||!session||!peerId)return;
  const stamp=new Date().toISOString(),owner=session.user.id;
  try{
    const {error}=await db.from('direct_message_reads').upsert({user_id:owner,peer_id:peerId,last_read_at:stamp},{onConflict:'user_id,peer_id'});if(error)throw error;
    cache.direct_message_reads=(cache.direct_message_reads||[]).filter(r=>r.peer_id!==peerId).concat({user_id:owner,peer_id:peerId,last_read_at:stamp});
    const notices=await db.from('notifications').update({read_at:stamp}).eq('user_id',owner).eq('kind','direct_message').eq('target_id',peerId).is('read_at',null);
    if(notices.error)console.error('Mark message alerts read',notices.error);
    else for(const n of cache.notifications||[])if(n.kind==='direct_message'&&n.target_id===peerId&&!n.read_at)n.read_at=stamp;
    await refreshUnreadCounts();void refreshInboxUnreadCount();
  }catch(e){console.error(e);}
}
function projects() {
  const list=cache.projects||[];
  projectListPage=Math.min(projectListPage,Math.max(0,Math.ceil(list.length/50)-1));
  const visible=list.slice(projectListPage*50,projectListPage*50+50);
  return `${head('BUILD TOGETHER','Projects','Plan prototypes, track work and move ideas toward the next demonstration.',button('+ New project','projectForm'))}
  ${list.length?'':'<div class="notice">Project concepts below are suggestions for members to develop. They are not active club projects; an approved member must take ownership and create a plan.</div>'}
  <div class="grid grid-3">${list.length?visible.map(p=>`<div class="card"><div class="row"><span class="tag ${p.status==='complete'?'blue':p.status==='planning'?'gold':''}">${esc(p.status)}</span><span class="subtle">${date(p.created_at)}</span></div><h3 style="margin-top:17px">${esc(p.title)}</h3><p>${esc(p.summary||'No summary yet.')}</p><div class="progress"><span style="width:${Math.max(0,Math.min(100,Number(p.progress)||0))}%"></span></div><div class="card-footer"><span>${esc(p.progress)}% complete</span><button class="text-button" data-action="projectDetail" data-id="${esc(p.id)}">Open plan →</button></div></div>`).join(''):`<article class="card"><span class="tag gold">Proposed concept · owner needed</span><h3 style="margin-top:17px">Instrumented low-voltage energy bench</h3><p>Measure a safe low-voltage load, check readings against a reference meter, and show power estimates and alerts on a dashboard.</p><div class="card-footer"><span>Controls · Software · Electronics</span><button class="text-button" data-action="projectForm">Start a plan →</button></div></article><article class="card"><span class="tag gold">Proposed concept · owner needed</span><h3 style="margin-top:17px">Workshop inventory scanner</h3><p>Prototype QR or barcode check-out and return with sample items. Test duplicate scans and offline behavior before using real stock.</p><div class="card-footer"><span>Software · Electronics</span><button class="text-button" data-action="projectForm">Start a plan →</button></div></article>`}</div>${recordsPager('projectList',projectListPage,list.length)}`;
}
function discussions() {
  const list=cache.topics||[];
  return `${head('SHARE IDEAS','Discussions','Ask questions, debate designs and keep decisions visible.',button('+ New discussion','topicForm'))}<div class="grid">${list.length?list.map(t=>{const replies=(cache.replies||[]).filter(r=>r.topic_id===t.id),project=(cache.projects||[]).find(p=>p.id===t.project_id);return `<div class="card topic"><div class="row"><span class="tag">${esc(t.category||'General')}</span><span class="subtle">${date(t.created_at)}</span></div><h3>${esc(t.title)}</h3>${project?`<small class="muted">Project: ${esc(project.title)}</small>`:''}<p>${esc(t.body)}</p><div class="card-footer"><span>${replies.length} replies</span><button class="text-button" data-action="topicDetail" data-id="${esc(t.id)}">Read discussion →</button></div></div>`}).join(''):empty('Start the conversation','Your first discussion could be a workshop idea or a prototype challenge.')}</div>`;
}
const courseDateInput = value => {
  if(!value)return '';
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))return '';
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
};
const courseDeadline = c => c?.submission_due_at&&Number.isFinite(new Date(c.submission_due_at).getTime())?new Date(c.submission_due_at):null;
function courseTimeline(c,active=false){
  const due=coursePlanningReady?courseDeadline(c):null,late=!!due&&due.getTime()<Date.now();
  return `<div class="course-timeline"><span class="course-date">${c.starts_at?`Starts ${dateTime(c.starts_at)}`:'Start date to be announced'}</span>${coursePlanningReady?`<span class="course-deadline ${late&&active?'overdue':''}">${due?`${late&&active?'Past due · submissions remain open':'Project due'} ${dateTime(due)}`:'Project deadline to be announced'}</span>`:''}</div>`;
}
function courseLearnerName(courseId,learnerId){
  return (cache.course_roster||[]).find(r=>r.course_id===courseId&&r.learner_id===learnerId)?.full_name||memberName(learnerId);
}
function courseProgress(enrollment){
  if(enrollment.status==='completed')return 'Completed';
  const latest=(cache.course_submissions||[]).filter(s=>s.course_id===enrollment.course_id&&s.learner_id===enrollment.learner_id)
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
  return latest?.review_status==='accepted'?'Completed':latest?.review_status==='submitted'?'Awaiting feedback':latest?.review_status==='revision_requested'?'Revision needed':'In progress';
}
async function enrollAndOpenCourse(id){
  const owner=session?.user.id;
  try{
    const {error}=await db.from('course_enrollments').insert({course_id:id,learner_id:owner});
    if(error)throw error;
    if(session?.user.id!==owner)return;
    courseView='mine';activeCourseId=id;courseDetailView='overview';
    await refresh();
    show('Workshop joined. Your classroom is ready.');
    const classroom=document.getElementById(`course-${id}`);
    classroom?.querySelector('h2')?.focus({preventScroll:true});
    classroom?.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){fail(error);}
}
function courseAttempts(courseId) {
  return (cache.course_submissions||[]).filter(s=>s.course_id===courseId&&s.learner_id===session?.user.id)
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
}
function courseBrief(c){
  const description=String(c?.description||'');
  const structured=description.match(/^Build:\s*([\s\S]*?)\n\s*Practice:\s*([\s\S]*?)\n\s*Tools:\s*([\s\S]*)$/i);
  return structured?{goal:structured[1].trim(),practice:structured[2].trim(),tools:structured[3].trim()}:
    {goal:c?.build_goal||description,practice:c?.practice_steps||'',tools:c?.tools||''};
}
function courseFeedback(c) {
  const attempts=courseAttempts(c.id);
  const reviewed=attempts.filter(s=>s.review_status!=='submitted'&&s.teacher_feedback);
  const completion=(cache.course_completions||[]).find(x=>x.course_id===c.id&&x.learner_id===session?.user.id);
  return `<section id="course-detail-panel" class="course-classroom-panel" aria-label="Teacher feedback">
    <h3>Teacher feedback</h3>
    <p class="subtle">Your teacher’s comments stay here for every reviewed attempt.</p>
    ${completion?`<div class="course-completion"><strong>Project completed</strong><span>Recorded ${date(completion.completed_at)} · Assessed by ${esc(memberName(completion.assessed_by))}</span></div>`:''}
    ${reviewed.length?`<div class="course-feedback-list">${reviewed.map((s,i)=>`<article class="course-feedback-entry"><div class="row"><span class="tag ${s.review_status==='accepted'?'blue':'gold'}">${s.review_status==='accepted'?'Accepted':'Changes requested'}</span><small class="subtle">${dateTime(s.reviewed_at||s.created_at)}</small></div><h4>Review ${reviewed.length-i}</h4><p>${esc(s.teacher_feedback)}</p></article>`).join('')}</div>`:empty('No teacher feedback yet',attempts.some(s=>s.review_status==='submitted')?'Your project is with your teacher. Their response will appear here after review.':'Submit a practical project to receive specific feedback on your build.')}
  </section>`;
}
function courseJourney(c){
  const enrollment=(cache.course_enrollments||[]).find(e=>e.course_id===c.id&&e.learner_id===session?.user.id);
  if(!enrollment)return `<div class="course-journey"><strong>Join this workshop first</strong><button class="button button-sm" data-action="enrollCourse" data-id="${esc(c.id)}">Join workshop</button></div>`;
  const attempts=courseAttempts(c.id),latest=attempts[0];
  const completion=(cache.course_completions||[]).find(x=>x.course_id===c.id&&x.learner_id===session.user.id);
  const finished=!!completion||latest?.review_status==='accepted';
  const status=finished?'Project accepted':latest?.review_status==='submitted'?'Waiting for teacher review':latest?.review_status==='revision_requested'?'Changes requested':'Ready when you are';
  const message=finished?'Your practical project is complete. You can review your submission history below.':latest?.review_status==='submitted'?'Your teacher has received your work. Feedback will appear in the Feedback tab.':latest?.review_status==='revision_requested'?'Read the teacher’s feedback, improve your build, then send another attempt.':'Describe what you built and tested. Attach a link or evidence file if you have one.';
  return `<section id="course-detail-panel" class="course-classroom-panel" aria-label="Project submission">
    <h3>Submit your project</h3>
    <div class="course-journey"><strong>${status}</strong><p>${message}</p>
      ${latest?.review_status==='revision_requested'?`<button class="text-button" data-action="courseDetailView" data-view="feedback">Read teacher feedback →</button>`:''}
      ${!finished&&latest?.review_status!=='submitted'?`<button class="button button-sm" data-action="submitCourseForm" data-id="${esc(c.id)}">${latest?'Submit improved work':'Send project for review'} →</button>`:''}
    </div>
    ${attempts.length?`<details class="course-submission-history"><summary>Submission history · ${attempts.length} ${attempts.length===1?'attempt':'attempts'}</summary><ol>${attempts.map(s=>`<li><div class="row"><strong>${s.review_status==='accepted'?'Accepted':s.review_status==='revision_requested'?'Changes requested':'Awaiting review'}</strong><small class="subtle">${dateTime(s.created_at)}</small></div><p>${esc(s.details)}</p>${cleanUrl(s.evidence_url)?`<a class="link" href="${esc(cleanUrl(s.evidence_url))}" target="_blank" rel="noopener noreferrer">Open project link ↗</a>`:''}${s.evidence_path?`<button class="text-button" data-action="downloadCourseEvidence" data-id="${esc(s.id)}">Open ${esc(s.evidence_name||'evidence file')} ↗</button>`:''}${s.teacher_feedback?`<p class="course-feedback"><b>Teacher feedback</b> ${esc(s.teacher_feedback)}</p>`:''}</li>`).join('')}</ol></details>`:''}
  </section>`;
}
function courses() {
  const list=cache.courses||[];
  const materials=learningReady?(cache.learning_materials||[]).filter(m=>!m.hidden_at):[];
  const enrolled=courseReady?(cache.course_enrollments||[]).filter(e=>e.learner_id===session?.user.id):[];
  const completed=enrolled.filter(e=>e.status==='completed');
  const myCourses=enrolled.map(e=>({enrollment:e,course:list.find(c=>c.id===e.course_id)})).filter(x=>x.course)
    .sort((a,b)=>Number(a.enrollment.status==='completed')-Number(b.enrollment.status==='completed')||(new Date(a.course.starts_at||'9999-12-31')-new Date(b.course.starts_at||'9999-12-31')));
  const chosen=myCourses.find(x=>x.course.id===activeCourseId)||myCourses[0];
  const selected=chosen?.course, enrollment=chosen?.enrollment;
  const brief=courseBrief(selected);
  const attempts=selected?courseAttempts(selected.id):[];
  const latest=attempts[0],selectedMaterials=selected?materials.filter(m=>m.course_id===selected.id):[];
  const completedProject=enrollment?.status==='completed'||latest?.review_status==='accepted';
  const tab=(key,label,count='')=>`<button type="button" class="course-view-button ${courseView===key?'selected':''}" data-action="courseView" data-view="${key}" aria-pressed="${courseView===key}" aria-controls="course-view-panel">${label}${count?` <span class="course-tab-count">${count}</span>`:''}</button>`;
  const detailTab=(key,label,count='')=>`<button type="button" class="course-detail-button ${courseDetailView===key?'selected':''}" data-action="courseDetailView" data-view="${key}" aria-pressed="${courseDetailView===key}" aria-controls="course-detail-panel">${label}${count?` <span class="course-tab-count">${count}</span>`:''}</button>`;
  const overview=selected?`<section id="course-detail-panel" class="course-classroom-panel" aria-label="Workshop overview">
    <h3>What you will build</h3><p>${esc(brief.goal||'Your teacher will add the project brief soon.')}</p>
    ${brief.practice?`<h4>Hands-on activities and tests</h4><p>${esc(brief.practice)}</p>`:''}
    ${brief.tools?`<h4>Tools and components</h4><p>${esc(brief.tools)}</p>`:''}
    <div class="course-next-step"><strong>${completedProject?'Your build is complete':latest?.review_status==='submitted'?'Your teacher is reviewing your work':latest?.review_status==='revision_requested'?'Your next step: improve your build':'Your next step: prepare and build'}</strong><p>${completedProject?'Read the teacher’s final feedback and keep your completion record.':latest?.review_status==='submitted'?'You can see the work you sent in Submit project.':latest?.review_status==='revision_requested'?'Open Feedback for specific improvements, then submit a revision.':'Download the workshop materials, test your project, and submit your results.'}</p><div class="course-next-actions"><button class="button button-sm" data-action="courseDetailView" data-view="${completedProject||latest?.review_status==='revision_requested'?'feedback':latest?.review_status==='submitted'?'submit':'materials'}">${completedProject||latest?.review_status==='revision_requested'?'See feedback':latest?.review_status==='submitted'?'View submitted work':'Open materials'} →</button>${!completedProject&&latest?.review_status!=='submitted'?`<button class="button button-outline button-sm" data-action="courseDetailView" data-view="submit">Submit project</button>`:''}</div></div>
  </section>`:'';
  const materialPanel=selected?`<section id="course-detail-panel" class="course-classroom-panel" aria-label="Workshop materials"><h3>Materials and slides</h3><p class="subtle">Use these resources as you build and test your project.</p>
    ${selected.resource_url&&cleanUrl(selected.resource_url)?`<a class="course-resource-link" href="${esc(cleanUrl(selected.resource_url))}" target="_blank" rel="noopener noreferrer"><strong>Workshop resource link</strong><span>Open resource ↗</span></a>`:''}
    ${selectedMaterials.length?`<div class="course-material-list">${selectedMaterials.map(materialRow).join('')}</div>`:learningReady?empty('No slides or files yet','Your teacher can upload a guide, worksheet or slides for this workshop.'):`<div class="notice">Learning files will appear after the materials setup is complete.</div>`}
  </section>`:'';
  const feedbackCount=selected?attempts.filter(s=>s.review_status!=='submitted'&&s.teacher_feedback).length:0;
  const classroom=selected?`<article class="course-classroom" id="course-${esc(selected.id)}">
    <div class="course-classroom-head"><div><span class="eyebrow">YOUR CLASSROOM · ${esc(courseTrackFor(selected))}</span><h2 tabindex="-1">${esc(selected.title)}</h2><p>${esc(brief.goal||'Build and test a real project with your teacher.')}</p></div><span class="tag ${completedProject?'blue':latest?.review_status==='revision_requested'?'gold':''}">${esc(courseProgress(enrollment))}</span></div>
    <div class="course-classroom-meta"><span><b>Teacher</b> ${esc(selected.instructor_id?memberName(selected.instructor_id):'To be assigned')}</span>${courseTimeline(selected,enrollment.status==='enrolled')}</div>
    <div class="course-detail-switch" role="group" aria-label="Inside this workshop">${detailTab('overview','Overview')}${detailTab('materials','Materials',selectedMaterials.length)}${detailTab('submit','Submit project',attempts.length)}${detailTab('feedback','Feedback',feedbackCount)}</div>
    ${courseDetailView==='materials'?materialPanel:courseDetailView==='submit'?courseJourney(selected):courseDetailView==='feedback'?courseFeedback(selected):overview}
  </article>`:'';
  const myLearning=`<section id="course-view-panel" class="course-view-panel" aria-label="My learning">
    ${courseReady?`<div class="course-summary"><strong>${enrolled.length} workshop${enrolled.length===1?'':'s'} joined</strong><span>${completed.length} completed</span>${teacher()?'<a href="#teaching">Open teaching studio →</a>':''}</div>`:`<div class="notice">Course enrollment and project submissions need the course journey database setup. You can still explore published workshops.</div>`}
    <div class="section-heading"><div><span class="eyebrow">YOUR LEARNING PLAN</span><h2>My workshops</h2></div><p>Choose a classroom to see its brief, materials, submissions and feedback.</p></div>
    ${myCourses.length?`<div class="course-classroom-layout"><div class="course-class-list" role="group" aria-label="My enrolled workshops">${myCourses.map(({course:c,enrollment:e})=>`<button type="button" class="course-class-choice ${selected?.id===c.id?'selected':''}" data-action="courseSelect" data-id="${esc(c.id)}" aria-pressed="${selected?.id===c.id}"><small>${esc(courseTrackFor(c))}</small><strong>${esc(c.title)}</strong><span>${esc(courseProgress(e))} · ${courseDeadline(c)?`Due ${date(c.submission_due_at)}`:'Deadline to be announced'}</span></button>`).join('')}</div>${classroom}</div>`:`<div class="course-empty-state"><h3>No workshops joined yet</h3><p>Explore the four tracks, choose a practical build, and it will appear here with your materials and teacher feedback.</p><button class="button" data-action="courseView" data-view="explore">Explore workshops →</button></div>`}
    ${materials.some(m=>!m.course_id)?`<section class="course-general-library"><div class="section-heading"><div><span class="eyebrow">FOR EVERY MEMBER</span><h2>Club learning library</h2></div><p>General notes and guides for any workshop.</p></div><div class="grid grid-2">${materials.filter(m=>!m.course_id).map(m=>`<div class="card">${materialRow(m)}</div>`).join('')}</div></section>`:''}
  </section>`;
  const visible=courseTrack==='all'?list:list.filter(c=>courseTrackFor(c)===courseTrack);
  const explore=`<section id="course-view-panel" class="course-view-panel" aria-label="Explore workshops"><div class="course-steps"><div><b>1</b><strong>Choose a workshop</strong><small>Pick one or more tracks.</small></div><div><b>2</b><strong>Learn by doing</strong><small>Follow your teacher’s brief and materials.</small></div><div><b>3</b><strong>Share your build</strong><small>Send test notes and evidence.</small></div><div><b>4</b><strong>Improve with feedback</strong><small>Revise or record completion.</small></div></div>
    <div class="section-heading"><div><span class="eyebrow">FOUR PRACTICAL TRACKS</span><h2>Find a project to build</h2></div><p>You can join several workshops across different tracks.</p></div>
    <div class="course-tracks"><button class="course-track course-track-all ${courseTrack==='all'?'selected':''}" data-action="courseTrack" data-track="all" aria-pressed="${courseTrack==='all'}"><strong>All tracks</strong><small>See every published workshop.</small><em>${list.length} workshop${list.length===1?'':'s'} ↗</em></button>${courseTracks.map((t,i)=>{const count=list.filter(c=>courseTrackFor(c)===t.name).length;return `<button class="course-track ${courseTrack===t.name?'selected':''}" data-action="courseTrack" data-track="${esc(t.name)}" aria-pressed="${courseTrack===t.name}"><span>0${i+1} / PRACTICAL TRACK</span><strong>${esc(t.name)}</strong><small>${esc(t.example)}</small><em>${count} workshop${count===1?'':'s'} ↗</em></button>`}).join('')}</div>
    <div class="section-heading"><div><span class="eyebrow">PUBLISHED WORKSHOPS</span><h2>${courseTrack==='all'?'All workshops':esc(courseTrack)}</h2></div></div>
    <div class="grid grid-3">${visible.length?visible.map(c=>{const joined=enrolled.some(e=>e.course_id===c.id);return `<article class="card course-card" id="course-${esc(c.id)}"><span class="tag blue">${esc(c.level||'Practical')}</span><h3 tabindex="-1">${esc(c.title)}</h3><p>${esc(courseBrief(c).goal||'A practical project brief is coming soon.')}</p><div class="pill-row"><span class="subtle">${esc(courseTrackFor(c))}</span><span class="subtle">${c.instructor_id?`Teacher: ${esc(memberName(c.instructor_id))}`:'Teacher to be assigned'}</span></div>${courseTimeline(c,false)}<div class="course-catalog-action">${joined?`<button class="button button-outline button-sm" data-action="focusCourse" data-id="${esc(c.id)}">Open my classroom →</button>`:courseReady?`<button class="button button-sm" data-action="enrollCourse" data-id="${esc(c.id)}">Join workshop →</button>`:`<small class="subtle">Enrollment opens after course setup.</small>`}</div></article>`}).join(''):proposedWorkshops.filter(w=>courseTrack==='all'||w.track===courseTrack).map(w=>`<article class="card course-card course-proposal"><span class="tag gold">Proposed workshop</span><h3>${esc(w.title)}</h3><small>${esc(w.track)}</small><p>${esc(w.detail)}</p><div class="card-footer"><span>Planning draft · Date and teacher to be confirmed</span></div></article>`).join('')||empty('No workshops in this track yet','Approved teachers can publish a practical session in this track.')}</div>
  </section>`;
  return `${head('LEARN BY BUILDING','Courses and workshops','Choose a practical build, follow your teacher’s materials and keep your feedback in one classroom.',teacher()?`<div class="profile-buttons">${button('+ Publish workshop','courseForm')}${learningReady?button('+ Upload material','learningForm','button-outline'):''}</div>`:'')}
    <div class="course-view-switch" role="group" aria-label="Course views">${tab('mine','My learning',myCourses.length)}${tab('explore','Explore workshops',list.length)}</div>
    ${courseView==='explore'?explore:myLearning}`;
}
function materialRow(m){return `<div class="learning-row"><span class="tag blue">${esc(m.kind)}</span><div><strong>${esc(m.title)}</strong><small>${esc(m.file_name)} · ${fileSize(m.file_size)} · ${date(m.created_at)}</small>${m.description?`<p>${esc(m.description)}</p>`:''}</div>${m.hidden_at?'<span class="tag gold">Hidden</span>':`<button class="text-button" data-action="downloadLearning" data-id="${esc(m.id)}">Download ↓</button>`}</div>`;}
let teachingTab = 'overview';
function teaching(){
  if(!teacher())return '';
  const ownId=session.user.id;
  const workshops=(cache.courses||[]).filter(c=>admin()||c.instructor_id===ownId);
  const courseIds=new Set(workshops.map(c=>c.id));
  const enrollments=courseReady?(cache.course_enrollments||[]).filter(e=>courseIds.has(e.course_id)):[];
  const submissions=courseReady?(cache.course_submissions||[]).filter(s=>courseIds.has(s.course_id)):[];
  const pending=submissions.filter(s=>s.review_status==='submitted'&&s.learner_id!==ownId).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const reviewed=submissions.filter(s=>s.review_status!=='submitted').sort((a,b)=>new Date(b.reviewed_at||b.created_at)-new Date(a.reviewed_at||a.created_at));
  const completions=courseReady?(cache.course_completions||[]).filter(x=>courseIds.has(x.course_id)):[];
  const materials=learningReady?(cache.learning_materials||[]).filter(m=>admin()||m.uploaded_by===ownId||courseIds.has(m.course_id)):[];
  const uniqueLearners=new Set(enrollments.map(e=>e.learner_id)).size;
  const now=Date.now();
  const agenda=workshops.flatMap(c=>{
    const starts=c.starts_at?new Date(c.starts_at).getTime():NaN;
    const due=coursePlanningReady?courseDeadline(c)?.getTime():null;
    return [Number.isFinite(starts)&&starts>=now?{course:c,label:'Workshop starts',at:starts}:null,
      Number.isFinite(due)&&due>=now?{course:c,label:'Project deadline',at:due}:null].filter(Boolean);
  }).sort((a,b)=>a.at-b.at).slice(0,5);
  const profile=admin()?'':teacherProfileReady?`<section class="card teacher-onboarding"><div class="row"><div><span class="eyebrow">YOUR TEACHING PROFILE</span><h2>${teacherProfile?'Update your teaching details':'Complete your teaching details'}</h2><p class="subtle">Describe the practical work you can lead. These details are visible only to you and administrators.</p></div><span class="tag ${teacherProfile?'blue':'gold'}">${teacherProfile?'Saved':'To complete'}</span></div><form id="teacherProfileForm" data-kind="teacherProfile" class="form-stack">${select('Primary learning track','track',courseTracks.map(t=>t.name),teacherProfile?.track||courseTracks[0].name)}<div class="field"><label for="teacher_experience">Relevant experience or skills</label><textarea id="teacher_experience" name="experience" minlength="20" maxlength="2000" required placeholder="Describe the tools, projects and topics you can teach.">${esc(teacherProfile?.experience||'')}</textarea></div><div class="field"><label for="teacher_practical_focus">Practical teaching plan</label><textarea id="teacher_practical_focus" name="practical_focus" minlength="20" maxlength="2000" required placeholder="What will members build or test with you?">${esc(teacherProfile?.practical_focus||'')}</textarea></div><div class="field"><label for="teacher_availability">Availability</label><textarea id="teacher_availability" name="availability" minlength="5" maxlength="500" required placeholder="For example, Saturdays or two sessions each month.">${esc(teacherProfile?.availability||'')}</textarea></div><button class="button" type="submit">${teacherProfile?'Save changes':'Save teaching profile'}</button></form></section>`:'<div class="notice">Run the teacher promotions migration to enable your teaching profile.</div>';
  const tabs=[['overview','Overview'],['workshops',`Workshops (${workshops.length})`],['reviews',`To review (${pending.length})`],['materials',`Materials (${materials.length})`],...(!admin()?[['profile','My profile']]:[])];
  if(!tabs.some(([key])=>key===teachingTab))teachingTab='overview';
  const panel=(key,content)=>`<section id="teaching-panel-${key}" role="tabpanel" aria-labelledby="teaching-tab-${key}" ${teachingTab===key?'':'hidden'}>${content}</section>`;
  const overview=courseReady?`<div class="teaching-overview"><section class="teaching-agenda"><span class="eyebrow">WHAT TO DO NEXT</span><h2>Your teaching checklist</h2>
    <div class="teaching-agenda-row"><div><strong>${pending.length?`${pending.length} project${pending.length===1?'':'s'} need feedback`:'Project reviews are clear'}</strong><small class="subtle">Read each build, give practical feedback, then accept it or request a revision.</small></div><button class="text-button" data-action="teachingTab" data-tab="reviews">Open reviews →</button></div>
    <div class="teaching-agenda-row"><div><strong>${workshops.length?`${workshops.length} assigned workshop${workshops.length===1?'':'s'}`:'Publish your first workshop'}</strong><small class="subtle">Set the project goal, dates and students for each workshop.</small></div><button class="text-button" data-action="teachingTab" data-tab="workshops">Open workshops →</button></div>
    <div class="teaching-agenda-row"><div><strong>${materials.length} published material${materials.length===1?'':'s'}</strong><small class="subtle">Attach slides or notes to the workshop students will use them in.</small></div><button class="text-button" data-action="teachingTab" data-tab="materials">Open materials →</button></div>
    ${!admin()&&!teacherProfile?'<div class="teaching-agenda-row"><div><strong>Complete your teaching profile</strong><small class="subtle">Add your experience, practical focus and availability.</small></div><button class="text-button" data-action="teachingTab" data-tab="profile">Open profile →</button></div>':''}</section>
    <section class="teaching-agenda"><span class="eyebrow">COMING UP</span><h2>Dates and deadlines</h2>${agenda.length?agenda.map(x=>`<div class="teaching-agenda-row"><span class="tag ${x.label==='Project deadline'?'gold':'blue'}">${esc(x.label)}</span><div><strong>${esc(x.course.title)}</strong><small class="subtle">${dateTime(x.at)}</small></div></div>`).join(''):empty('Nothing scheduled yet','Set a workshop start and project deadline to help students plan.')}</section></div>
    <div class="notice">Teach in this order: publish a practical workshop, add students, share materials, review their project submissions, and give feedback. Students can join more than one workshop.</div>`:`<div class="notice">Run the course journey migration to enable enrollment, project reviews and completion records.</div>${!admin()&&!teacherProfile?'<button class="button button-sm" data-action="teachingTab" data-tab="profile">Complete teaching profile</button>':''}`;
  const workshopContent=courseReady?`<div class="section-heading"><div><span class="eyebrow">YOUR CLASSROOMS</span><h2>${admin()?'Club workshops':'Workshops assigned to me'}</h2></div><p>Manage students, practical plans, deadlines and materials for each workshop.</p></div>
    ${!coursePlanningReady?'<div class="notice">Run the course planning migration to enable student assignment, complete rosters and workshop deadlines.</div>':''}
    <div class="teaching-workshops">${workshops.length?workshops.map(c=>{
      const students=enrollments.filter(e=>e.course_id===c.id).sort((a,b)=>Number(a.status==='completed')-Number(b.status==='completed')||new Date(b.created_at)-new Date(a.created_at));
      const waiting=pending.filter(s=>s.course_id===c.id).length;
      return `<article class="teaching-workshop-card" id="teaching-workshop-${esc(c.id)}"><div class="row"><span class="tag blue">${esc(courseTrackFor(c))}</span><small>${esc(c.level||'Practical')}</small></div><h3>${esc(c.title)}</h3>${admin()?`<p class="subtle">Lead: ${esc(c.instructor_id?memberName(c.instructor_id):'Not assigned')}</p>`:''}<p>${esc(c.description||'Add a practical build goal so learners know what they will make.')}</p>${courseTimeline(c,true)}<div class="course-summary"><strong>${students.length} student${students.length===1?'':'s'}</strong><span>${waiting} awaiting feedback</span><span>${students.filter(e=>e.status==='completed').length} completed</span></div><div class="teacher-roster-list">${students.length?students.slice(0,3).map(e=>`<div class="teacher-roster-row">${memberAvatar(e.learner_id)}<div><strong>${esc(courseLearnerName(c.id,e.learner_id))}</strong><small>${esc(courseProgress(e))}</small></div></div>`).join(''):empty('No students yet','Members can enroll themselves, or you can add an approved member by email.')}</div><div class="teacher-workshop-actions">${coursePlanningReady?`<button class="button button-sm" data-action="assignLearnerForm" data-id="${esc(c.id)}">+ Add student</button><button class="button button-outline button-sm" data-action="courseRoster" data-id="${esc(c.id)}">View all ${students.length} students</button><button class="button button-outline button-sm" data-action="editCourseScheduleForm" data-id="${esc(c.id)}">Set dates</button>`:''}<button class="button button-outline button-sm" data-action="editCourseContentForm" data-id="${esc(c.id)}">Edit workshop plan</button>${learningReady?`<button class="button button-outline button-sm" data-action="learningForm" data-course="${esc(c.id)}">+ Add slides or notes</button>`:''}<button class="text-button" data-action="focusCourse" data-id="${esc(c.id)}">View course listing →</button></div></article>`;
    }).join(''):empty('No workshops assigned yet',admin()?'Publish the club’s first practical workshop.':'Publish a workshop or ask an administrator to assign one to you.')}</div>
    <div class="teacher-workshop-actions"><button class="button button-sm" data-action="courseForm">+ Publish workshop</button></div>
    ${admin()?`<div class="section-heading"><h2>Workshop teachers</h2><p>Assign an approved teacher to older or reassigned workshops.</p></div><div class="grid grid-2">${(cache.courses||[]).map(c=>`<div class="card course-assignment"><strong>${esc(c.title)}</strong><small>${esc(c.instructor_id?memberName(c.instructor_id):'Not assigned')}</small><button class="text-button" data-action="assignCourseForm" data-id="${esc(c.id)}">Assign teacher →</button></div>`).join('')||empty('No workshops','Publish a practical workshop first.')}</div>`:''}`:'<div class="notice">Run the course journey migration to manage workshop students and dates.</div>';
  const reviewContent=courseReady?`<div class="section-heading"><div><span class="eyebrow">PROJECT FEEDBACK</span><h2>${pending.length} project${pending.length===1?'':'s'} to review</h2></div><p>Read the build and evidence, then accept the project or request a specific improvement.</p></div><div class="grid grid-2">${pending.length?pending.map(s=>courseSubmissionCard(s,true)).join(''):empty('All caught up','New projects from students in your workshops will appear here.')}</div>
    <div class="section-heading"><div><span class="eyebrow">FEEDBACK HISTORY</span><h2>Reviewed projects</h2></div><p>Accepted work has a completion record. Revision requests let students submit an updated build.</p></div><div class="grid grid-2">${reviewed.length?reviewed.map(s=>courseSubmissionCard(s,false)).join(''):empty('No completed reviews yet','Your decisions and feedback will appear here.')}</div>`:'<div class="notice">Run the course journey migration to review project submissions.</div>';
  const materialContent=learningReady?`<div class="section-heading"><div><span class="eyebrow">LEARNING MATERIALS</span><h2>${admin()?'Club materials':'Materials for my workshops'}</h2></div><button class="button button-sm" data-action="learningForm">+ Upload slides or notes</button></div><p class="subtle">Choose the related workshop when uploading a file so students can find it alongside their project. PDF, PPT, PPTX, DOC or DOCX · up to 20 MB.</p><div class="grid grid-2">${materials.length?materials.map(m=>`<div class="card teaching-card">${materialRow(m)}<div class="card-footer"><span>${m.course_id?esc((cache.courses||[]).find(c=>c.id===m.course_id)?.title||'Workshop'):'General learning library'} · ${esc(memberName(m.uploaded_by))}</span>${admin()?`<button class="text-button" data-action="toggleLearning" data-id="${esc(m.id)}">${m.hidden_at?'Restore':'Hide'}</button>`:''}</div></div>`).join(''):empty('No materials yet','Upload a presentation, worksheet or guide for your students.')}</div>`:'<div class="notice">Run the teacher materials migration to enable slides and learning files.</div>';
  return `${head('TEACHING','Teaching studio','Plan practical workshops, support enrolled students and review their project work.',`<div class="profile-buttons">${button('+ Publish workshop','courseForm')}${learningReady?button('+ Upload material','learningForm','button-outline'):''}</div>`)}
    ${courseReady?`<div class="course-summary"><strong>${workshops.length} workshop${workshops.length===1?'':'s'}</strong><span>${uniqueLearners} student${uniqueLearners===1?'':'s'}</span><span>${pending.length} awaiting feedback</span><span>${completions.length} completed project${completions.length===1?'':'s'}</span></div>`:''}
    <div class="records-tabs teaching-tabs" role="tablist" aria-label="Teaching studio sections">${tabs.map(([key,label])=>`<button type="button" role="tab" id="teaching-tab-${key}" aria-controls="teaching-panel-${key}" aria-selected="${teachingTab===key}" tabindex="${teachingTab===key?'0':'-1'}" data-action="teachingTab" data-tab="${key}" class="${teachingTab===key?'active':''}">${esc(label)}</button>`).join('')}</div>
    <div class="teaching-panels">${panel('overview',overview)}${panel('workshops',workshopContent)}${panel('reviews',reviewContent)}${panel('materials',materialContent)}${!admin()?panel('profile',profile):''}</div>`;
}
function courseSubmissionCard(s,waiting){
  const course=(cache.courses||[]).find(c=>c.id===s.course_id);
  return `<div class="card course-review"><div class="row"><span class="tag ${waiting?'gold':'blue'}">${waiting?'Awaiting review':s.review_status==='accepted'?'Accepted':'Revision requested'}</span><small>${dateTime(s.created_at)}</small></div><h3>${esc(course?.title||'Workshop')}</h3><small>Submitted by ${esc(courseLearnerName(s.course_id,s.learner_id))}</small><p>${esc(s.details)}</p>${s.evidence_url?`<a class="link" href="${esc(cleanUrl(s.evidence_url))}" target="_blank" rel="noopener noreferrer">Open project link ↗</a>`:''}${s.evidence_path?`<button class="text-button" data-action="downloadCourseEvidence" data-id="${esc(s.id)}">Open ${esc(s.evidence_name||'evidence')} ↗</button>`:''}${s.teacher_feedback?`<p class="course-feedback"><b>Teacher feedback</b> ${esc(s.teacher_feedback)}</p>`:''}${waiting&&s.learner_id!==session.user.id?`<div class="course-review-actions"><button class="button button-sm" data-action="reviewCourseForm" data-status="accepted" data-id="${esc(s.id)}">Accept project</button><button class="button button-outline button-sm" data-action="reviewCourseForm" data-status="revision_requested" data-id="${esc(s.id)}">Request revision</button></div>`:''}</div>`;
}
const recordMoney = cents => new Intl.NumberFormat('en-GH',{style:'currency',currency:'GHS'}).format(cents/100);
const recordDate = value => value ? date(`${value}T12:00:00`) : '—';
const recordsStat = (label,value,detail,extra='') => `<div class="records-stat"><small>${esc(label)}</small><strong class="${extra}">${esc(value)}</strong><span>${esc(detail)}</span></div>`;
const recordsPager = (name,current,total) => total<=50?'':`<div class="records-toolbar"><small class="subtle">Showing ${current*50+1}–${Math.min(total,(current+1)*50)} of ${total}</small><div class="records-actions"><button class="button button-outline button-sm" data-action="${name}Prev" ${current===0?'disabled':''}>← Previous</button><button class="button button-outline button-sm" data-action="${name}Next" ${(current+1)*50>=total?'disabled':''}>Next →</button></div></div>`;
function movementMemberOptions(itemId,kind){
  const outstanding=new Map();
  for(const m of cache.inventory_movements||[])if(m.item_id===itemId&&m.member_id&&['check_out','return'].includes(m.kind))outstanding.set(m.member_id,(outstanding.get(m.member_id)||0)+(m.kind==='check_out'?Number(m.quantity):-Number(m.quantity)));
  const eligible=(cache.profiles||[]).filter(p=>kind==='return'?outstanding.get(p.id)>0:p.membership_status==='approved'&&['member','teacher','founder','admin'].includes(p.role));
  return '<option value="">Choose a member</option>'+eligible.map(p=>`<option value="${esc(p.id)}">${esc(p.full_name||'Member')}${kind==='return'?` · ${outstanding.get(p.id)} outstanding`:''}</option>`).join('');
}
const itemLow = x => x.condition==='good'&&Number(x.quantity_available)<=Number(x.reorder_level||0);
const financeReviewFor = entry => (cache.finance_reviews||[]).find(r=>r.entry_id===entry.id);
const financeStatus = entry => financeReviewFor(entry)?.decision||'pending';
const financeEffective = entry => financeStatus(entry)==='approved';
function applyInventorySearch(){
  const term=inventorySearchTerm.trim().toLowerCase();
  document.querySelectorAll('[data-inventory-card]').forEach(card=>{card.style.display=card.textContent.toLowerCase().includes(term)?'':'none';});
}
function inventory(){
  if(!clubAccess())return '';
  if(!inventoryReady)return `${head('CLUB RECORDS','Inventory','Track shared equipment and supplies.')}<div class="notice">To activate inventory, run <code>supabase/upgrade_inventory_finance.sql</code> in your Supabase SQL Editor, then refresh this page.</div>`;
  if(!inventoryCatalogReady)return `${head('CLUB RECORDS','Inventory','Track components, tools and supplies.')}<div class="notice">Run <code>supabase/upgrade_inventory_finance_approvals.sql</code> after the first inventory migration to activate item types, units and stock alerts.</div>`;
  const items=cache.inventory_items||[],movements=founder()?cache.inventory_movements||[]:[];
  const visible=items.filter(x=>inventoryFilter==='all'||x.item_type===inventoryFilter||(inventoryFilter==='low_stock'&&itemLow(x))||(inventoryFilter==='checked_out'&&x.quantity_total>x.quantity_available)||(inventoryFilter==='needs_repair'&&x.condition==='needs_repair')||(inventoryFilter==='retired'&&x.condition==='retired'));
  const tabs=[['all','All'],['component','Components'],['tool','Tools'],['equipment','Equipment'],['consumable','Supplies'],['other','Other'],['low_stock','Low stock'],['checked_out','Checked out'],['needs_repair','Needs repair'],['retired','Retired']];
  const pageMoves=movements.slice(inventoryLogPage*50,(inventoryLogPage+1)*50);
  return `${head('CLUB RECORDS','Inventory','A practical register for components, tools, equipment and supplies.',admin()?button('+ Add stock item','inventoryAddForm'):'')}
    <div class="records-stats">${recordsStat('Stock records',items.length,'Types of items tracked')}${recordsStat('Ready to use',items.filter(x=>x.condition==='good'&&x.quantity_available>0).length,'Items with usable stock')}${recordsStat('Low stock',items.filter(itemLow).length,'At or below reorder level')}${recordsStat('Checked out',items.filter(x=>x.quantity_total>x.quantity_available).length,'Item types held by members')}</div>
    <div class="notice">Use <strong>Check out</strong> for returnable tools and equipment. Use <strong>Issue / consume</strong> when components or supplies are used up; this records the recipient and reduces the stock total.</div>
    <div class="records-toolbar"><div><h2>Club stock</h2><p class="subtle">${items.length} item types, each counted in its own unit.</p></div><div class="records-actions"><input class="records-filter" id="inventorySearch" type="search" value="${esc(inventorySearchTerm)}" placeholder="Search items or locations" aria-label="Search inventory">${founder()?`<button class="button button-outline button-sm" data-action="exportCsv" data-table="inventory_items">Inventory CSV ↓</button><button class="button button-outline button-sm" data-action="exportCsv" data-table="inventory_movements">History CSV ↓</button>`:''}</div></div>
    <div class="records-tabs" role="group" aria-label="Filter inventory">${tabs.map(([key,label])=>`<button data-action="inventoryFilter" data-filter="${key}" class="${inventoryFilter===key?'active':''}" aria-pressed="${inventoryFilter===key}">${label}</button>`).join('')}</div>
    ${visible.length?`<div class="inventory-grid">${visible.map(x=>`<article class="inventory-card ${itemLow(x)?'stock-low':''}" data-inventory-card><div class="inventory-card-head"><div><h3>${esc(x.name)}</h3><p>${esc(x.category)}${x.serial_number?` · ${esc(x.serial_number)}`:''}</p></div><span class="inventory-kind ${esc(x.item_type)}">${esc(x.item_type)}</span></div><div class="inventory-stock ${itemLow(x)?'stock-low':''}"><strong>${esc(x.quantity_available)} ${esc(x.unit)}</strong><small>in stock<br>of ${esc(x.quantity_total)} ${esc(x.unit)}</small></div><div class="inventory-card-meta"><span>Reorder at <strong>${esc(x.reorder_level)} ${esc(x.unit)}</strong></span><span>${itemLow(x)?'<span class="record-pill stock-low">Low stock</span>':esc(x.condition.replaceAll('_',' '))}</span></div><div class="inventory-card-meta"><span>Location: <strong>${esc(x.location||'Not set')}</strong></span>${x.quantity_total>x.quantity_available?`<span>${esc(x.quantity_total-x.quantity_available)} checked out</span>`:''}</div>${admin()?`<div class="inventory-card-actions"><button class="text-button" data-action="inventoryQuantityForm" data-id="${esc(x.id)}">Update quantity</button><button class="text-button" data-action="inventoryUnitForm" data-id="${esc(x.id)}">Change unit</button><button class="text-button" data-action="inventoryMoveForm" data-id="${esc(x.id)}">Record movement →</button><button class="text-button" data-action="inventoryEditForm" data-id="${esc(x.id)}">Edit details</button></div>`:''}</article>`).join('')}</div>`:`<div class="records-empty"><strong>${items.length?'No matching items':'No items registered yet'}</strong>${items.length?'Choose another filter.':'An administrator can add the first stock item.'}</div>`}
    ${founder()?`<div class="records-toolbar"><div><h2>Stock history</h2><p class="subtle">Permanent checkout, issue, return, adjustment and item change records · founders and administrators.</p></div></div><div class="records-panel">${movements.length?`<div class="records-table-wrap"><table class="records-table"><thead><tr><th>Recorded</th><th>Item</th><th>Movement</th><th>Member</th><th>Handled by</th><th>Reason / change</th></tr></thead><tbody>${pageMoves.map(m=>`<tr><td>${esc(dateTime(m.created_at))}</td><td>${esc(items.find(x=>x.id===m.item_id)?.name||m.old_details?.name||'Unknown item')}</td><td><span class="record-pill">${esc(m.kind.replaceAll('_',' '))}${m.kind==='update_details'?'':` · ${esc(m.quantity)} ${esc(m.unit_at_movement||items.find(x=>x.id===m.item_id)?.unit||'units')}`}</span></td><td>${m.member_id?esc(memberName(m.member_id)):'—'}</td><td>${esc(memberName(m.handled_by))}</td><td>${esc(m.note||'—')}${m.old_details&&m.new_details?`<small>${esc(['name','category','item_type','unit','quantity_total','quantity_available','reorder_level','condition','location','serial_number'].filter(k=>m.old_details[k]!==m.new_details[k]).map(k=>`${k.replaceAll('_',' ')}: ${m.old_details[k]??'—'} → ${m.new_details[k]??'—'}`).join(' · '))}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`:`<div class="records-empty"><strong>No movements yet</strong>Checkouts, issues, returns and item changes will appear here.</div>`}${recordsPager('inventoryLog',inventoryLogPage,movements.length)}</div>`:''}`;
}
function finance(){
  if(!admin())return '';
  if(!financeReady)return `${head('LEADERSHIP RECORDS','Finance','Review the club ledger.')}<div class="notice">To activate finance, run <code>supabase/upgrade_inventory_finance.sql</code> in your Supabase SQL Editor, then refresh this page.</div>`;
  if(!financeApprovalsReady)return `${head('ADMIN RECORDS','Finance','Record income and expenses.')}<div class="notice">Run <code>supabase/upgrade_inventory_finance_approvals.sql</code> to activate founder approvals and the accountable balance.</div>`;
  const entries=cache.finance_entries||[];
  const effective=entries.filter(financeEffective);
  const income=effective.filter(x=>x.entry_type==='income').reduce((n,x)=>n+Math.round(Number(x.amount)*100),0);
  const expense=effective.filter(x=>x.entry_type==='expense').reduce((n,x)=>n+Math.round(Number(x.amount)*100),0);
  const pending=entries.filter(x=>financeStatus(x)==='pending').length;
  const visible=entries.filter(x=>financeFilter==='all'||x.entry_type===financeFilter||financeStatus(x)===financeFilter).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on)||b.created_at.localeCompare(a.created_at));
  const pageEntries=visible.slice(financePage*50,(financePage+1)*50);
  return `${head('ADMIN RECORDS','Finance','Record the club’s funds and track founder decisions.',button('+ Submit transaction','financeEntryForm'))}
    <div class="records-stats">${recordsStat('Approved income',recordMoney(income),'Founder approved entries','finance-income')}${recordsStat('Approved expenses',recordMoney(expense),'Founder approved entries','finance-expense')}${recordsStat('Recorded balance',recordMoney(income-expense),'Approved income less expenses','finance-total')}${recordsStat('Awaiting review',pending,'Founder approval needed')}</div>
    <div class="notice">Amounts are in Ghana cedis (GHS). All entries, including ones recorded before this approval upgrade, need a founder decision. Pending and rejected amounts do not affect the balance. Corrections require a new entry and founder review.</div>
    <div class="records-toolbar"><div><h2>Transaction ledger</h2><p class="subtle">Admin entries retain the purpose, date, reference and founder decision.</p></div><div class="records-actions"><button class="button button-outline button-sm" data-action="exportCsv" data-table="finance_entries">Download ledger CSV ↓</button></div></div>
    <div class="records-tabs" role="group" aria-label="Filter transactions">${[['all','All'],['pending','Pending'],['approved','Approved'],['rejected','Rejected'],['income','Income'],['expense','Expenses']].map(([key,label])=>`<button data-action="financeFilter" data-filter="${key}" class="${financeFilter===key?'active':''}" aria-pressed="${financeFilter===key}">${label}</button>`).join('')}</div>
    <div class="records-panel">${visible.length?`<div class="records-table-wrap"><table class="records-table"><thead><tr><th>Date</th><th>Type / amount</th><th>Category / purpose</th><th>Counterparty / reference</th><th>Status</th><th>Entered by</th><th>Founder review</th></tr></thead><tbody>${pageEntries.map(financeEntryRow).join('')}</tbody></table></div>`:`<div class="records-empty"><strong>${entries.length?'No matching transactions':'No transactions yet'}</strong>${entries.length?'Choose another filter.':'Record the first income or expense to begin.'}</div>`}${recordsPager('finance',financePage,visible.length)}</div>`;
}
function financeEntryRow(x){
  const review=financeReviewFor(x),status=financeStatus(x);
  return `<tr><td>${esc(recordDate(x.occurred_on))}<small>Entered ${esc(dateTime(x.created_at))}</small></td><td><span class="record-pill ${x.entry_type==='expense'?'expense':''}">${esc(x.entry_type)}</span><small class="${x.entry_type==='income'?'finance-income':'finance-expense'}">${esc(recordMoney(Math.round(Number(x.amount)*100)))}</small></td><td>${esc(x.category)}<small>${esc(x.description)}</small></td><td>${esc(x.counterparty||'—')}<small>${esc(x.reference||'No reference')}</small></td><td><span class="finance-status ${status}">${esc(status)}</span></td><td>${esc(memberName(x.created_by))}</td><td>${review?`${esc(memberName(review.reviewer_id))}<small>${esc(dateTime(review.created_at))}${review.note?` · ${esc(review.note)}`:''}</small>`:'—'}</td></tr>`;
}
function financeReview(){
  if(!founderOnly())return '';
  if(!financeReady)return `${head('FOUNDER REVIEW','Finance approvals','Review the club’s transactions.')}<div class="notice">First run <code>supabase/upgrade_inventory_finance.sql</code> in Supabase SQL Editor.</div>`;
  if(!financeApprovalsReady)return `${head('FOUNDER REVIEW','Finance approvals','Review the club’s transactions.')}<div class="notice">Run <code>supabase/upgrade_inventory_finance_approvals.sql</code> after the first inventory and finance migration.</div>`;
  const entries=cache.finance_entries||[],pending=entries.filter(x=>financeStatus(x)==='pending').sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const history=entries.filter(x=>financeStatus(x)!=='pending').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const pageHistory=history.slice(financeReviewPage*50,(financeReviewPage+1)*50);
  return `${head('FOUNDER REVIEW','Finance approvals','Review new transactions and keep a visible record of decisions.')}
    <div class="records-stats">${recordsStat('Waiting for review',pending.length,'Founder decision needed')}${recordsStat('Approved',history.filter(x=>financeStatus(x)==='approved').length,'Included in balance')}${recordsStat('Rejected',history.filter(x=>financeStatus(x)==='rejected').length,'Excluded from balance')}${recordsStat('All records',entries.length,'Earlier and new entries')}</div>
    <div class="notice">Only approved founders can approve or reject new entries. The administrator records the transactions; approval determines whether they count in the club balance. Rejection needs a reason.</div>
    <div class="section-heading"><div><h2>Awaiting your review</h2><p>Check the amount, purpose and reference before deciding.</p></div></div>
    ${pending.length?`<div class="finance-review-grid">${pending.map(x=>`<article class="finance-review-card"><header><span class="finance-status pending">Pending</span><strong class="${x.entry_type==='income'?'finance-income':'finance-expense'}">${esc(recordMoney(Math.round(Number(x.amount)*100)))}</strong></header><h3>${esc(x.category)} · ${esc(x.entry_type)}</h3><p>${esc(x.description)}</p><small>${esc(recordDate(x.occurred_on))} · Entered by ${esc(memberName(x.created_by))}</small><small>${x.counterparty?`From / to: ${esc(x.counterparty)} · `:''}Reference: ${esc(x.reference||'Not supplied')}</small><div class="finance-review-actions"><button class="button button-sm" data-action="reviewFinance" data-id="${esc(x.id)}" data-decision="approved">Review to approve</button><button class="button button-outline button-sm" data-action="reviewFinance" data-id="${esc(x.id)}" data-decision="rejected">Reject</button></div></article>`).join('')}</div>`:`<div class="records-empty"><strong>All caught up</strong>No finance entries are awaiting a founder decision.</div>`}
    <div class="finance-history"><div class="section-heading"><div><h2>Decision history</h2><p>Approved and rejected transactions remain visible with their reviewers and reasons.</p></div></div><div class="records-panel">${history.length?`<div class="records-table-wrap"><table class="records-table"><thead><tr><th>Date</th><th>Type / amount</th><th>Category / purpose</th><th>Counterparty / reference</th><th>Status</th><th>Entered by</th><th>Founder review</th></tr></thead><tbody>${pageHistory.map(financeEntryRow).join('')}</tbody></table></div>`:`<div class="records-empty"><strong>No decisions yet</strong>Approved and rejected transactions will appear here.</div>`}${recordsPager('financeReview',financeReviewPage,history.length)}</div></div>`;
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
const calendarDayKey = value => {const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function calendarEntries() {
  const items=(cache.events||[]).map(e=>({...e,kind:'event'}));
  if(founder())items.push(...(cache.founder_meetings||[]).map(m=>({...m,kind:'meeting'})));
  items.push(...(cache.project_tasks||[]).filter(t=>t.due_at&&t.status!=='done').map(t=>({...t,kind:'task',starts_at:t.due_at})));
  if(clubAccess()){
    const joined=new Set((cache.course_enrollments||[]).filter(e=>e.learner_id===session?.user.id).map(e=>e.course_id));
    for(const course of cache.courses||[]){
      if(!admin()&&!(teacher()&&course.instructor_id===session?.user.id)&&!joined.has(course.id))continue;
      if(course.starts_at)items.push({id:course.id,kind:'course',title:course.title,starts_at:course.starts_at});
      if(coursePlanningReady&&course.submission_due_at)items.push({id:course.id,kind:'course_due',title:course.title,starts_at:course.submission_due_at});
    }
  }
  return items.filter(x=>x.starts_at&&!Number.isNaN(new Date(x.starts_at).getTime())).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
}
function calendarPage() {
  const year=calendarMonth.getFullYear(),month=calendarMonth.getMonth(),today=calendarDayKey(new Date()),selected=calendarDayKey(calendarSelected);
  const entries=calendarEntries(),byDay=new Map();
  entries.forEach(item=>{const key=calendarDayKey(item.starts_at);if(!byDay.has(key))byDay.set(key,[]);byDay.get(key).push(item);});
  const offset=new Date(year,month,1).getDay(),days=new Date(year,month+1,0).getDate();
  const calendarLabel=item=>item.kind==='task'?'Task deadline':item.kind==='meeting'?'Founder meeting':item.kind==='course'?'Workshop starts':item.kind==='course_due'?'Project deadline':'Club event';
  const cells=Array.from({length:Math.ceil((offset+days)/7)*7},(_,index)=>{
    const day=index-offset+1;if(day<1||day>days)return '<div class="cal-cell outside" aria-hidden="true"></div>';
    const key=calendarDayKey(new Date(year,month,day)),items=byDay.get(key)||[];
    return `<div class="cal-cell ${key===today?'today':''} ${key===selected?'selected':''}"><button class="cal-date" data-action="calendarDay" data-date="${key}" aria-label="${esc(new Date(year,month,day).toLocaleDateString(undefined,{dateStyle:'full'}))}, ${items.length} calendar items" aria-pressed="${key===selected}">${day}</button><div class="cal-items">${items.slice(0,3).map(item=>`<button class="cal-chip ${item.kind}" data-action="calendarItem" data-kind="${item.kind}" data-id="${esc(item.id)}" title="${esc(calendarLabel(item)+': '+item.title)}" aria-label="${esc(calendarLabel(item)+': '+item.title+', '+dateTime(item.starts_at))}">${esc(item.title)}</button>`).join('')}${items.length>3?`<button class="cal-more" data-action="calendarDay" data-date="${key}">+${items.length-3} more</button>`:''}</div></div>`;
  }).join('');
  const selectedItems=byDay.get(selected)||[];
  const card=item=>`<button class="cal-agenda-item" data-action="calendarItem" data-kind="${item.kind}" data-id="${esc(item.id)}"><span class="cal-dot ${item.kind}"></span><span><strong>${esc(item.title)}</strong><small>${calendarLabel(item)} · ${dateTime(item.starts_at)}</small></span><span aria-hidden="true">↗</span></button>`;
  const upcoming=entries.filter(item=>new Date(item.starts_at)>=new Date()).slice(0,5);
  return `${head('PLAN TOGETHER','Club calendar','See club events, your workshops and project deadlines in one place. Founder meetings appear only for approved founders.',admin()?button('+ Schedule event','eventForm'):'')}
  <div class="cal-toolbar"><div><h2>${esc(calendarMonth.toLocaleDateString(undefined,{month:'long',year:'numeric'}))}</h2><p class="subtle">${entries.filter(item=>{const d=new Date(item.starts_at);return d.getMonth()===month&&d.getFullYear()===year;}).length} items this month</p></div><div class="cal-nav"><button data-action="calendarToday" class="button button-outline button-sm">Today</button><button data-action="calendarPrev" aria-label="Previous month" class="cal-arrow">‹</button><button data-action="calendarNext" aria-label="Next month" class="cal-arrow">›</button></div></div>
  <div class="cal-layout"><div class="cal-board"><div class="cal-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<span>${d}</span>`).join('')}</div><div class="cal-grid">${cells}</div></div><aside class="cal-agenda"><h3>${esc(calendarSelected.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}))}</h3>${selectedItems.length?selectedItems.map(card).join(''):empty('Nothing scheduled','Choose a date with an item to view its details.')}<h3 class="cal-upcoming-title">Coming up</h3>${upcoming.length?upcoming.map(card).join(''):empty('No upcoming items','New events will show here when scheduled.')}<a href="#events" class="link cal-events-link">All club events →</a><a href="#courses" class="link cal-events-link">My courses →</a>${teacher()?'<a href="#teaching" class="link cal-events-link">Teaching studio →</a>':''}</aside></div><div class="cal-legend"><span><i class="cal-dot event"></i> Club event</span><span><i class="cal-dot course"></i> Workshop starts</span>${coursePlanningReady?'<span><i class="cal-dot course_due"></i> Course project deadline</span>':''}<span><i class="cal-dot task"></i> Task deadline</span>${founder()?'<span><i class="cal-dot meeting"></i> Founder meeting</span>':''}</div>`;
}
function calendarItem(kind,id) {
  if((kind==='course'||kind==='course_due')&&clubAccess()){
    const course=(cache.courses||[]).find(c=>c.id===id);
    const enrolled=(cache.course_enrollments||[]).some(e=>e.course_id===id&&e.learner_id===session?.user.id);
    if(!course||!admin()&&!(teacher()&&course.instructor_id===session?.user.id)&&!enrolled)return;
    if(kind==='course_due'&&(!coursePlanningReady||!course.submission_due_at))return;
    if(kind==='course'&&!course.starts_at)return;
    const deadline=kind==='course_due';
    return modal(`<span class="eyebrow">${deadline?'PROJECT DEADLINE':'PRACTICAL WORKSHOP'}</span><h2>${esc(course.title)}</h2><p>${esc(course.description||'Build and test a practical project with your teacher.')}</p><div class="meta"><span>${esc(courseTrackFor(course))}</span>${course.instructor_id?`<span>Teacher: ${esc(memberName(course.instructor_id))}</span>`:''}</div>${courseTimeline(course,enrolled)}${deadline?'<p class="subtle">This date helps you plan. Project submissions remain open after the deadline.</p>':''}<div class="cal-detail-actions"><button class="button" data-action="focusCourse" data-id="${esc(course.id)}">View workshop →</button></div>`);
  }
  const table={event:'events',meeting:'founder_meetings',task:'project_tasks'}[kind];
  if(!clubAccess()||!table||kind==='meeting'&&!founder())return;
  const item=(cache[table]||[]).find(x=>x.id===id);if(!item)return;
  if(kind==='task')return modal(`<span class="eyebrow">PROJECT DEADLINE</span><h2>${esc(item.title)}</h2><p>Due ${dateTime(item.due_at)}</p><p>${esc(item.description||'Check the project plan for more details.')}</p><button class="button" data-action="calendarProject" data-id="${esc(item.project_id)}">View project →</button>`);
  const meeting=kind==='meeting';
  modal(`<span class="eyebrow">${meeting?'FOUNDER MEETING':'CLUB EVENT'}</span><h2>${esc(item.title)}</h2><p>${esc(meeting?item.agenda||'Agenda to follow.':item.description||'Details to follow.')}</p><div class="meta"><span>◷ ${dateTime(item.starts_at)}${item.ends_at?' – '+dateTime(item.ends_at):''}</span><span>⌁ ${esc(meeting?'Private founder meeting':item.location||'Online')}</span></div>${rsvpControls(meeting?'meeting':'event',id)}<div class="cal-detail-actions">${item.meet_url?`<a class="button" href="${esc(cleanUrl(item.meet_url))}" target="_blank" rel="noopener noreferrer">Join Google Meet ↗</a>`:''}<button class="button button-outline" data-action="${meeting?'founderCalendar':'calendar'}" data-id="${esc(id)}">Add to Google Calendar</button><button class="button button-outline" data-action="${meeting?'founderIcs':'ics'}" data-id="${esc(id)}">Download ICS</button></div>`);
}
function announcements() {
  const list=cache.announcements||[];
  return `${head('STAY INFORMED','Club alerts','Important updates, deadlines and opportunities.',admin()?button('+ Post alert','announcementForm'):'')}
  <div class="grid">${list.length?list.map(a=>`<div class="card"><div class="row"><span class="tag ${a.priority==='urgent'?'gold':''}">${esc(a.priority)}</span><span class="subtle">${date(a.created_at)}</span></div><h3 style="margin-top:15px">${esc(a.title)}</h3><p class="detail">${esc(a.body)}</p>${admin()?`<div class="card-footer"><span>Published club alert</span><button class="text-button alert-delete" type="button" data-action="deleteAnnouncement" data-id="${esc(a.id)}">Delete alert</button></div>`:''}</div>`).join(''):empty('No alerts yet','Official updates will appear here.')}</div>`;
}

let privacyRequestLoading=false;
async function loadPrivacyRequests(){
  if(!db||!session||privacyRequestLoading)return;
  privacyRequestLoading=true;
  const userId=session.user.id;
  try{
    const data=await readRecords('privacy_requests');
    if(session?.user.id!==userId)return;
    cache.privacy_requests=data||[];privacyReady=true;
    if(page==='privacy')render();
  }catch(error){console.error('Privacy requests',error);}
  finally{privacyRequestLoading=false;}
}
const privacyRequestLabel=type=>type==='account_removal'?'Account and data removal':'Specific content removal';
function privacyRequestCard(request,adminView=false){
  const status=request.status.replace('_',' '),open=request.status==='open',reviewing=request.status==='in_review';
  const owner=(cache.profiles||[]).find(p=>p.id===request.requester_id);
  return `<article class="card privacy-request"><div class="row"><span class="tag ${open||reviewing?'gold':'blue'}">${esc(status)}</span><small class="subtle">${dateTime(request.created_at)}</small></div>
    <h3>${esc(privacyRequestLabel(request.request_type))}</h3>
    ${adminView?`<p class="subtle">From ${esc(owner?.full_name|| (request.requester_id?'Member':'Account removed'))} · Auth user ID ${esc(request.requester_auth_id||'Removed')} · Request ${esc(request.id)}</p>`:''}
    ${request.details?`<p class="profile-bio">${esc(request.details)}</p>`:''}
    ${request.review_note?`<p class="privacy-review-note"><strong>Administrator response:</strong> ${esc(request.review_note)}</p>`:''}
    ${adminView&&(open||reviewing)?`<div class="profile-buttons">${open?`<button class="button button-outline button-sm" data-action="reviewPrivacy" data-status="in_review" data-id="${esc(request.id)}">Start review</button>`:request.request_type==='account_removal'&&request.requester_id?'<span class="hint">Complete after account removal.</span>':`<button class="button button-sm" data-action="reviewPrivacy" data-status="completed" data-id="${esc(request.id)}">Mark completed</button>`}<button class="button button-outline button-sm" data-action="reviewPrivacy" data-status="declined" data-id="${esc(request.id)}">Decline with reason</button></div>`:''}</article>`;
}
function privacy() {
  if(session&&!approved()&&!privacyReady&&!privacyRequestLoading)void loadPrivacyRequests();
  const requests=(cache.privacy_requests||[]),myRequests=requests.filter(r=>r.requester_id===session?.user.id);
  const adminRequests=admin()?requests.filter(r=>r.status==='open'||r.status==='in_review'):[];
  return `${head('CLUB TRUST','Privacy & conduct','Decide how your profile appears and ask an administrator to handle your data.')}
  <div class="grid grid-2"><div class="card"><h3>Who can see your information?</h3><p>Listed profiles show approved club members your name, headline, bio, background, skills and approximate online status. Set your profile to private to remove it from other members’ directory and profile search. Administrators can still see it. A teacher assigned to a workshop you join can see your name in that workshop’s student roster, even if your profile is private. Existing direct messages remain available to their participants. Posts, replies and files you already shared remain visible where you shared them. Published founder bios are separate public content.</p></div>
  <div class="card"><h3>What can you share?</h3><p>Share work you have permission to distribute. Do not upload passwords, private member records, personal contact lists or copyrighted files without permission. Shared club files are available to approved members.</p></div>
  <div class="card"><h3>Community conduct</h3><p>Keep feedback constructive and relevant to engineering work. Credit sources and collaborators. Use the Report button when a message, article or document needs administrator review.</p></div>
  <div class="card"><h3>Accounts and decisions</h3><p>New members apply after verifying their email. Administrators review applications. An account or content removal request starts a manual review; submitting one does not instantly delete anything. An administrator must also handle uploaded files and connected records.</p></div></div>
  ${session?`<div class="section-heading"><h2>My privacy controls</h2></div>
    ${'profile_visibility' in (me||{})?`<form class="card privacy-settings form-stack privacy-editor" data-kind="profileVisibility"><h3>Profile visibility</h3><p>Private hides your member profile from other members. You, administrators and teachers of workshops you join can see your name in their student roster.</p><div class="field"><label for="profile_visibility">Show my profile to</label><select id="profile_visibility" name="profile_visibility"><option value="club" ${me.profile_visibility==='club'?'selected':''}>Approved club members</option><option value="private" ${me.profile_visibility==='private'?'selected':''}>Private (course teachers see my name)</option></select></div><button class="button" type="submit">Save visibility</button></form>`:communityNotice()}
    ${privacyReady?`<div class="grid grid-2 privacy-request-layout"><form class="card form-stack privacy-editor" data-kind="privacyRequest"><h3>Request account or content removal</h3><p>Tell an administrator what you want removed. They will review the request and record a response here.</p><div class="field"><label for="request_type">Request type</label><select name="request_type" id="request_type"><option value="account_removal">Remove my account and associated data</option><option value="content_removal">Remove specific content I shared</option></select></div><div class="field"><label for="request_details">Details (optional for account removal)</label><textarea id="request_details" name="details" maxlength="2000" placeholder="For content removal, describe the posts or files you mean."></textarea></div><button class="button" type="submit">Send request</button></form><div class="card"><h3>What happens next?</h3><p>Your request appears in the administrator’s private queue. The administrator reviews it, removes the applicable information using Supabase administration tools, and records the outcome. Content posted by others and records that must be retained may need separate review.</p><p class="hint">Only you and administrators can see your request and its response.</p></div></div><div class="section-heading"><h2>My requests</h2></div><div class="grid grid-2">${myRequests.length?myRequests.map(r=>privacyRequestCard(r)).join(''):empty('No privacy requests yet','Requests you send will appear here.')}</div>`:communityNotice()}
    ${admin()&&privacyReady?`<div class="section-heading" id="privacy-admin-queue"><h2>Administrator queue</h2><p>${adminRequests.length} awaiting action</p></div><div class="grid grid-2">${adminRequests.length?adminRequests.map(r=>privacyRequestCard(r,true)).join(''):empty('No open requests','Member privacy requests will appear here.')}</div>`:''}`:'<div class="notice" style="margin-top:22px">Sign in to manage your profile or send a request to an administrator.</div>'}`;
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
    <section class="feed-main" aria-label="Member posts"><div class="card feed-composer">${memberAvatar(session.user.id)}<button class="feed-composer-prompt" data-action="feedPostForm">What are you building, ${esc(me?.full_name?.split(' ')[0]||'member')}?</button>${button('Share update','feedPostForm','button-sm')}</div>${feedError?`<div class="notice">${esc(feedError)} <button class="text-button" data-action="reloadFeed">Retry</button></div>`:''}<div class="feed-posts">${posts.length?posts.map(feedPostCard).join(''):feedLoading?empty('Loading posts','Fetching this page of club activity…'):empty('Start the conversation','Share a project milestone, question or useful resource with the club.')}</div>${feedTotal>30?`<div class="records-toolbar"><small class="subtle">Posts ${feedPage*30+1}–${Math.min(feedTotal,feedPage*30+30)} of ${feedTotal}</small><div class="records-actions"><button class="button button-outline button-sm" data-action="feedPrev" ${feedPage===0||feedLoading?'disabled':''}>← Newer</button><button class="button button-outline button-sm" data-action="feedNext" ${(feedPage+1)*30>=feedTotal||feedLoading?'disabled':''}>Older →</button></div></div>`:''}</section>
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
    ${photo?`<a href="${esc(photo)}" data-action="viewImage" data-media-path="${esc(p.image_path)}" data-caption="Image shared by ${esc(memberName(p.author_id))}" target="_blank" rel="noopener noreferrer" aria-label="View shared image full screen"><img class="feed-photo" src="${esc(photo)}" loading="lazy" alt="Image shared by ${esc(memberName(p.author_id))}"></a>`:''}
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
  ${status==='approved'?`<p style="margin-top:20px"><a href="${investor()?'#investor-portal':'#home'}" class="button">Open ${investor()?'investor portal':'workspace'} →</a></p>`:status==='suspended'?'<p class="subtle">Contact a club administrator to review your access.</p>':`<form id="editor" data-kind="application" class="form-stack card application-form" style="margin-top:20px">${roleReady?select('I am applying as','application_type',['member','teacher','founder','investor'],me.application_type||pendingType):''}${field('Full name','full_name','text',me.full_name||'')}${field('Background / organization','programme','text',me.programme||'')}${field('Skills or interests','skills','text',me.skills||'',false)}${area('Why do you want to join or partner with InnovateX?','application_reason',me.application_reason||'')}<button class="button" type="submit">${status==='pending'?'Submit or update application':'Update application'}</button></form>`}`;
}
function applications() {
  if(!admin())return '';
  if(!enhancedReady)return head('ADMINISTRATION','Applications','Review club membership.')+communityNotice();
  const applicants=applicationsOwner===session.user.id?applicationRows:[];
  const accounts=applicationsOwner===session.user.id?approvedAccountRows:[];
  return `${head('ADMINISTRATION','Applications','Review new accounts and submitted details before granting club access.')}
    ${applicationsError?`<div class="notice">${esc(applicationsError)} <button class="text-button" data-action="reloadApplications">Retry</button></div>`:''}
    ${applicationVerificationError?`<div class="notice">${esc(applicationVerificationError)}</div>`:''}
    <div class="section-heading"><h2>Applications (${applicationTotal})</h2><p>All pending, rejected and suspended accounts, newest first.</p></div>
    <div class="grid grid-2">${applicants.length?applicants.map(p=>{const eligibility=applicationVerification.get(p.id),verified=eligibility?.verified,previouslyApproved=eligibility?.previouslyApproved===true,submitted=!!p.application_reason?.trim();return `<div class="card"><div class="row"><span class="tag ${p.membership_status==='pending'?'gold':''}">${esc(p.membership_status)}</span><span class="tag blue">${esc(p.application_type||'member')}</span><small class="subtle">${date(p.created_at)}</small></div><h3 style="margin-top:14px">${esc(p.full_name)}</h3><div class="row"><span class="tag ${verified===true?'blue':'gold'}">${verified===true?'Email verified':verified===false?'Verify email first':'Email status unknown'}</span><span class="tag ${submitted?'blue':'gold'}">${submitted?'Application submitted':previouslyApproved?'Prior member: reason not recorded':'Application incomplete'}</span></div><p>${esc(p.programme||'Background not provided')}</p><p class="detail">${esc(p.application_reason||'No reason submitted yet.')}</p><div class="card-footer"><span>${esc(p.skills||'')}</span><div class="application-actions"><button class="text-button" data-action="reviewMember" data-status="approved" data-id="${esc(p.id)}" ${verified!==true||!submitted&&!previouslyApproved?'disabled':''}>Approve</button>${p.application_type==='member'&&['pending','rejected'].includes(p.membership_status)?`<button class="text-button" data-action="approveApplicantTeacher" data-id="${esc(p.id)}" ${verified!==true||!submitted&&!previouslyApproved?'disabled':''}>Approve as teacher</button>`:''}<button class="text-button" data-action="reviewMember" data-status="rejected" data-id="${esc(p.id)}">Reject</button></div></div></div>`}).join(''):applicationsLoading?empty('Loading applications','Fetching this page of accounts…'):applicationTotal?empty('Page unavailable','Use Previous or retry loading.'):empty('No applications waiting','New accounts will appear here.')}</div>
    ${recordsPager('applications',applicationsPage,applicationTotal)}
    <div class="section-heading"><h2>Approved accounts (${approvedAccountTotal})</h2><p>Manage teacher and founder access or pause an account.</p></div><div class="profile-grid">${accounts.map(p=>`<div class="card person">${avatar(p.full_name,false,p.avatar_path)}<div><strong>${esc(p.full_name)}</strong>${roleBadge(p)}<small class="subtle">${esc(p.role)} · ${esc(p.handle||'')}</small>${p.role==='founder'&&'founder_teaching_enabled' in p?`<small class="subtle">Teaching ${p.founder_teaching_enabled?'enabled':'paused'}</small>`:''}</div><div class="person-actions">${p.role==='member'?`<button class="text-button" data-action="promoteTeacher" data-id="${esc(p.id)}">Make teacher</button>`:''}${p.role==='teacher'&&'founder_teaching_enabled' in p?`<button class="text-button" data-action="assignFounderRole" data-id="${esc(p.id)}">Make founder</button>`:''}${p.role==='teacher'||p.role==='founder'&&p.founder_teaching_enabled?`<button class="text-button" data-action="viewTeacherProfile" data-id="${esc(p.id)}">Teaching details</button>`:''}${p.role==='founder'&&'founder_teaching_enabled' in p?`<button class="text-button" data-action="toggleFounderTeaching" data-id="${esc(p.id)}">${p.founder_teaching_enabled?'Pause teaching':'Assign teaching'}</button><button class="text-button" data-action="removeFounderRole" data-id="${esc(p.id)}">Remove founder role</button>`:''}<button class="text-button" data-action="reviewMember" data-status="suspended" data-id="${esc(p.id)}">Suspend</button></div></div>`).join('')||empty('No approved accounts','Approved accounts will appear here.')}</div>${recordsPager('approvedAccounts',approvedAccountsPage,approvedAccountTotal)}`;
}
function adminDashboard(){
  if(!admin())return '';
  const profiles=cache.profiles||[],pending=profiles.filter(p=>p.membership_status==='pending');
  const reports=(cache.reports||[]).filter(r=>r.status==='open');
  const privacyQueue=(cache.privacy_requests||[]).filter(r=>['open','in_review'].includes(r.status));
  const inquiries=(cache.investor_inquiries||[]).filter(q=>q.status==='new');
  const posts=cache.activity_posts||[],projects=cache.projects||[];
  const exports=[['profiles','Applications & members'],['projects','Projects'],['events','Events'],['activity_posts','Activity posts'],['reports','Reports'],['investor_inquiries','Investor inquiries'],['audit_events','Audit log']];
  return `${head('ADMINISTRATION','Club oversight','Review membership, community activity, founder planning and investor communication.')}
  ${!roleReady?'<div class="notice">Run the roles and investors migration to enable applicant types and the investor portal.</div>':''}
  <div class="grid grid-4"><a class="stat dashboard-stat" href="#applications"><small>Pending applications</small><b>${adminPendingCount}</b><span>Review requests →</span></a><a class="stat dashboard-stat" href="#moderation"><small>Open reports</small><b>${reports.length}</b><span>Moderate content →</span></a><a class="stat dashboard-stat" href="#feed"><small>Recent activity posts</small><b>${posts.length}</b><span>View feed →</span></a><a class="stat dashboard-stat" href="#projects"><small>Projects</small><b>${projects.length}</b><span>View plans →</span></a></div>
  ${privacyQueue.length?`<div class="notice privacy-admin-notice"><strong>${privacyQueue.length} privacy ${privacyQueue.length===1?'request needs':'requests need'} review.</strong> <a href="#privacy">Open the administrator queue →</a></div>`:''}
  <div class="grid grid-2 admin-overview"><div class="card"><h2>Needs attention</h2>${pending.slice(0,5).map(p=>`<div class="list-item"><span class="tag gold">${esc(p.application_type||'member')}</span><div><strong>${esc(p.full_name)}</strong><small>Applied ${date(p.created_at)}</small></div></div>`).join('')||`<p class="muted">${adminPendingCount?`${adminPendingCount} pending applications. Open Applications to review every page.`:'No pending applications.'}</p>`}${reports.length?`<p class="subtle">${reports.length} open ${reports.length===1?'report':'reports'} await review.</p>`:''}${inquiries.length?`<p class="subtle">${inquiries.length} new investor ${inquiries.length===1?'inquiry':'inquiries'} await review.</p>`:''}<div class="profile-buttons"><a class="button button-sm" href="#applications">Review applications</a><a class="button button-outline button-sm" href="#investor-portal">Investor portal</a></div></div>
  <div class="card"><h2>Club activity</h2><div class="admin-quick"><a href="#founder-room">Founder meetings <strong>${(cache.founder_meetings||[]).length} →</strong></a><a href="#events">Events <strong>${(cache.events||[]).length} →</strong></a><a href="#channels">Channels <strong>${(cache.channels||[]).length} →</strong></a><a href="#news">Technology stories <strong>${(cache.news_posts||[]).length} →</strong></a><a href="#library">Shared documents <strong>${(cache.documents||[]).length} →</strong></a></div><p class="hint">Private direct messages remain visible only to their participants.</p></div></div>
  <div class="section-heading"><h2>Download CSV</h2><p>Each CSV fetches all records you are authorized to see, in batches, when you click Download.</p></div><div class="card"><div class="export-actions">${exports.map(([key,label])=>`<button class="button button-outline button-sm" data-action="exportCsv" data-table="${key}">${esc(label)} CSV ↓</button>`).join('')}</div><p class="hint">CSV files exclude authentication records, direct messages and uploaded file contents. Preserve Storage files separately; use database backups for recovery.</p></div>
  <div class="section-heading"><h2>Recent administrator actions</h2></div><div class="card">${(cache.audit_events||[]).slice(0,8).map(a=>`<div class="list-item"><div><strong>${esc(a.action.replaceAll('_',' '))}</strong><small>${dateTime(a.created_at)} · ${esc(memberName(a.actor_id))}</small></div></div>`).join('')||'<p class="muted">No actions recorded yet.</p>'}</div>`;
}
function pushSettingsCard(){
  const state=window.InnovateXPush?.state();
  const status=pushBusy?'Updating…':!state?.supported?state?.installed?'Unavailable on this browser':'Install the web app first':state.permission==='denied'?'Blocked in device settings':state.subscribed?'On for this device':'Off for this device';
  const detail=!state?.supported?state?.installed?'This browser cannot receive web push. You can still use the club inbox while the app is open.':'On iPhone, add InnovateX to your Home Screen and open the installed app before enabling alerts. Other devices may support alerts directly in the browser.':state.permission==='denied'?'Allow InnovateX notifications in your device or browser settings, then return here.':state.subscribed?'New club messages and updates can appear even while this app is closed. Your device controls lock-screen visibility.':'Turn on device alerts for direct messages, mentions, replies and club updates. Message text will not appear in lock-screen previews.';
  const control=state?.supported&&state.permission!=='denied'?`<button class="button ${state.subscribed?'button-outline':''} button-sm" type="button" data-action="togglePush" ${pushBusy?'disabled':''}>${state.subscribed?'Turn off device alerts':'Enable device alerts'}</button>`:'';
  return `<div class="card push-settings"><span class="push-settings-icon" aria-hidden="true">${iconSvg('notifications')}</span><div><span class="eyebrow">PHONE &amp; DESKTOP</span><h2>Alerts on this device</h2><p>${esc(detail)}</p><strong class="push-status">${esc(status)}</strong></div>${control}</div>`;
}
async function togglePushNotifications(){
  if(!clubAccess()||pushBusy||!window.InnovateXPush)return;
  const owner=session.user.id,client=window.InnovateXPush;
  pushBusy=true;
  // Calling subscribe here preserves the button's user gesture for the browser permission request.
  const operation=client.state().subscribed?client.unsubscribe(owner,db):client.subscribe(owner,db);
  if(page==='notifications')render();
  try{
    const next=await operation;
    if(session?.user.id!==owner)return;
    show(next.subscribed?'Device alerts enabled.':'Device alerts turned off.');
  }catch(error){
    if(session?.user.id===owner)fail(error);
  }finally{pushBusy=false;if(session?.user.id===owner&&page==='notifications')render();}
}
function notifications() {
  if(!enhancedReady)return head('CLUB INBOX','Notifications','Mentions and updates.')+communityNotice();
  const list=cache.notifications||[];
  const soon=(cache.events||[]).filter(e=>new Date(e.starts_at)>new Date()&&new Date(e.starts_at)-Date.now()<172800000);
  const founderSoon=founder()?(cache.founder_meetings||[]).filter(e=>new Date(e.starts_at)>new Date()&&new Date(e.starts_at)-Date.now()<172800000):[];
  const tasksSoon=(cache.project_tasks||[]).filter(t=>t.assignee_id===session?.user.id&&t.status!=='done'&&t.due_at&&new Date(t.due_at)>new Date()&&new Date(t.due_at)-Date.now()<172800000);
  return `${head('CLUB INBOX','Notifications','Mentions, replies, assignments and upcoming meetings.')}
    ${pushSettingsCard()}
    ${(soon.length||founderSoon.length||tasksSoon.length)?`<div class="notice"><strong>Coming up in the next 48 hours:</strong> ${[...soon,...founderSoon].map(e=>esc(e.title)+' · '+dateTime(e.starts_at)).concat(tasksSoon.map(t=>esc(t.title)+' · due '+dateTime(t.due_at))).join(' / ')}</div>`:''}
    <div class="grid" style="margin-top:18px">${list.length?list.map(n=>`<div class="card notification-item ${n.read_at?'':'unread'}"><div><span class="tag">${esc(n.kind)}</span><h3>${esc(n.title)}</h3><p>${dateTime(n.created_at)}</p></div><div><button class="text-button" data-action="openNotification" data-id="${esc(n.id)}">Open →</button>${!n.read_at?` · <button class="text-button" data-action="readNotification" data-id="${esc(n.id)}">Mark read</button>`:''}</div></div>`).join(''):empty('All caught up','Messages, club alerts and your updates will show here.')}</div>`;
}
function moderation() {
  if(!admin())return '';
  if(!enhancedReady)return head('ADMINISTRATION','Moderation','Community reports.')+communityNotice();
  const reports=(cache.reports||[]).filter(r=>r.status==='open');
  return `${head('ADMINISTRATION','Moderation','Review reports and keep discussions useful.',button('Download current view JSON','exportData','button-outline'))}
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
    ${!unreadCountsReady?'<div class="notice">Unread counts may be incomplete while the club finishes setup. Contact an administrator if a conversation seems missing.</div>':''}
    <div class="chat-layout"><div class="channel-list"><div class="channel-label">YOUR CHANNELS</div>${list.map(c=>{const seen=(cache.channel_reads||[]).find(r=>r.channel_id===c.id)?.last_read_at;const unread=unreadCountsReady?Number(unreadCounts.channels[c.id]||0):enhancedReady?(cache.channel_messages||[]).filter(m=>m.channel_id===c.id&&!m.deleted_at&&m.author_id!==session.user.id&&(!seen||new Date(m.created_at)>new Date(seen))).length:0;return `<button class="channel-button ${c.id===activeChannelId?'selected':''}" data-action="selectChannel" data-id="${esc(c.id)}"><strong># ${esc(c.name)} ${unread?`<i class="unread-badge">${unread}</i>`:''}</strong><small>${esc(c.description)}</small></button>`}).join('')}</div>
    <div class="chat-panel">${selected?`<div class="chat-head"><div><h2># ${esc(selected.name)}</h2><p>${esc(selected.description)}</p></div><div class="chat-tools">${button('Search','searchChat','button-outline button-sm')}${button('Share file','shareDoc','button-outline button-sm')}</div></div>${channelHistoryError?`<div class="notice">${esc(channelHistoryError)} <button class="text-button" data-action="reloadChannelHistory">Retry</button></div>`:''}${channelTotal>50?`<div class="records-toolbar"><small class="subtle">Messages ${channelPage*50+1}–${Math.min(channelTotal,channelPage*50+50)} of ${channelTotal}</small><div class="records-actions"><button class="button button-outline button-sm" data-action="channelOlder" ${(channelPage+1)*50>=channelTotal||channelHistoryLoading?'disabled':''}>← Older</button><button class="button button-outline button-sm" data-action="channelNewer" ${channelPage===0||channelHistoryLoading?'disabled':''}>Newer →</button></div></div>`:''}<div id="messageStream" class="message-stream" aria-live="polite">${messageList()}</div><form id="chatComposer" class="chat-composer">${mediaReady?`<label class="gallery-picker" title="Choose an image from your gallery">▧<span class="sr-only">Choose image</span><input name="chat_image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>`:''}<label class="sr-only" for="chatBody">Message</label><input id="chatBody" name="body" maxlength="3000" placeholder="Message #${esc(selected.name)} · mention @handle" ${mediaReady?'':'required'} autocomplete="off"><button class="button" type="submit">Send ↗</button>${mediaReady?`<span id="chatImageName" class="chat-image-name" hidden></span>`:''}</form>`:empty('No channels yet','An administrator can add the first channel.')}</div></div>`;
}
function messageList() {
  const all=channelHistoryId===activeChannelId?channelHistoryRows:cache.channel_messages||[];
  const list=all.filter(m=>m.channel_id===activeChannelId&&!m.parent_id).slice().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).slice(-100);
  return list.length?list.map(m=>messageRow(m,true)).join(''):channelHistoryLoading?empty('Loading messages','Fetching this page of the channel…'):empty('No messages yet','Be the first to start the conversation.');
}
function messageRow(m,showThread=false) {
  const doc=m.deleted_at?null:(cache.documents||[]).find(d=>d.id===m.document_id);
  const selected=channelHistoryId===activeChannelId&&channelHistoryRows.some(x=>x.id===m.id);
  const replies=(selected?channelHistoryRows:cache.channel_messages||[]).filter(x=>x.parent_id===m.id).length;
  const reactions=(selected?channelHistoryReactions:cache.message_reactions||[]).filter(x=>x.message_id===m.id);
  const photo=m.deleted_at?'':mediaUrl(m.image_path);
  return `<div class="chat-message">${memberAvatar(m.author_id)}<div><div class="message-meta"><strong>${esc(memberName(m.author_id))}</strong><time>${dateTime(m.created_at)}${m.edited_at?' · edited':''}</time></div><p>${esc(m.body)}</p>${photo?`<a href="${esc(photo)}" data-action="viewImage" data-media-path="${esc(m.image_path)}" data-caption="Image shared by ${esc(memberName(m.author_id))}" target="_blank" rel="noopener noreferrer" aria-label="View shared image full screen"><img class="chat-photo" src="${esc(photo)}" loading="lazy" alt="Image shared by ${esc(memberName(m.author_id))}"></a>`:''}${doc?`<button class="attachment" data-action="downloadDoc" data-id="${esc(doc.id)}">▤ ${esc(doc.title)} <small>${fileSize(doc.file_size)}</small></button>`:''}
  ${enhancedReady&&!m.deleted_at?`<div class="message-actions">${['👍','💡','🔥','🎯'].map(emoji=>`<button class="reaction ${reactions.some(r=>r.emoji===emoji&&r.user_id===session.user.id)?'selected':''}" data-action="react" data-id="${esc(m.id)}" data-emoji="${emoji}" aria-label="React ${emoji}">${emoji}${reactions.filter(r=>r.emoji===emoji).length||''}</button>`).join('')}${showThread?`<button class="text-button" data-action="thread" data-id="${esc(m.id)}">Reply${replies?` (${replies})`:''}</button>`:''}${m.author_id===session.user.id?`<button class="text-button" data-action="editMessage" data-id="${esc(m.id)}">Edit</button>`:''}${m.author_id===session.user.id||admin()?`<button class="text-button" data-action="removeMessage" data-id="${esc(m.id)}">Remove</button>`:''}<button class="text-button" data-action="report" data-type="message" data-id="${esc(m.id)}">Report</button></div>`:''}</div></div>`;
}
function threadDialog(id) {
  const all=channelHistoryId===activeChannelId?channelHistoryRows:cache.channel_messages||[];
  const root=all.find(m=>m.id===id);if(!root)return;
  activeThreadId=id;
  const replies=all.filter(m=>m.parent_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
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
  const destination=pendingProtectedPage?pendingProtectedPage.replace(/-/g,' '):'';
  modal(`<span class="eyebrow">INNOVATEX ENGINEERING CLUB</span><h2>${pendingAuthMode==='signup'?'Create your account':'Sign in'}</h2>${destination?`<div class="auth-access-note"><strong>${esc(destination[0].toUpperCase()+destination.slice(1))} is in the club workspace.</strong><span>Sign in to continue, or create an account for administrator approval.</span></div>`:''}<div class="auth-switch"><button type="button" class="${pendingAuthMode==='signin'?'selected':''}" data-action="signin">I have an account</button><button type="button" class="${pendingAuthMode==='signup'?'selected':''}" data-action="signup">Create an account</button></div><p class="muted">${pendingAuthMode==='signup'?'Choose the type of account you are applying for. Verify your email once to create the account; an administrator will review the application.':'Enter the email for your existing account. We’ll send a fresh one-time sign-in code.'}</p><form id="editor" data-kind="login" class="form-stack">${pendingAuthMode==='signup'?select('I am applying as','application_type',['member','teacher','founder','investor'],pendingType):''}${field('Email address','email','email')}<button class="button" type="submit">${pendingAuthMode==='signup'?'Create account and send code':'Send sign-in code'}</button></form>`);
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
async function signOut() {try{if(session&&window.InnovateXPush)await window.InnovateXPush.unsubscribe(session.user.id,db);await touchPresence(false);const {error}=await db.auth.signOut();if(error)throw error;pendingProtectedPage='';history.replaceState(null,'','#home');await signedIn(null);show('Signed out. See you soon.');}catch(e){fail(e);}}

async function deleteAnnouncement(id){
  if(!admin())return;
  const entry=(cache.announcements||[]).find(a=>a.id===id);if(!entry)return;
  if(!confirm(`Delete the club alert “${entry.title}”? Members will no longer see it.`))return;
  const userId=session.user.id;
  try{
    const {data,error}=await db.from('announcements').delete().eq('id',id).select('id');
    if(error)throw error;
    if(!data?.length)throw Error('This alert was already removed. Refresh the page.');
    if(session?.user.id!==userId||!admin())return;
    await refresh();show('Club alert deleted.');
  }catch(error){fail(error);}
}

function actions(e) {
  const el=e.target.closest('[data-action]'); if(!el)return; const action=el.dataset.action,id=el.dataset.id;
  if(action==='viewProfilePhoto'){
    e.preventDefault();
    const profile=(cache.profiles||[]).find(p=>p.id===id&&p.membership_status==='approved'&&p.role!=='investor');
    if(profile?.avatar_path&&clubAccess())void openImageViewer(profile.avatar_path,`${profile.full_name} profile photo`,el);
    return;
  }
  if(action==='viewImage'){
    e.preventDefault();
    if(clubAccess()&&el.dataset.mediaPath)void openImageViewer(el.dataset.mediaPath,el.dataset.caption||'Shared photo',el);
    return;
  }
  if(action==='dismissAdminAlert'){dismissAdminAlert();return;}
  if(action==='dismissMemberAlert'){dismissMemberAlert();return;}
  if(action==='openMemberAlert'){
    const notificationId=memberAlertNotificationId;dismissMemberAlert();
    if(notificationId)void openNotification(notificationId);else location.hash='#notifications';
    return;
  }
  if(action==='openMemberInbox'){dismissMemberAlert();location.hash='#notifications';return;}
  if(action==='togglePush'){void togglePushNotifications();return;}
  if(action==='deleteAnnouncement'){void deleteAnnouncement(id);return;}
  if(action==='openAdminApplications'){
    if(!admin())return;
    dismissAdminAlert();location.hash='#applications';void refresh();return;
  }
  if(action==='toggleAdminSound'){
    if(!admin())return;
    adminSoundEnabled=!adminSoundEnabled;
    try{localStorage.setItem('innovatex.adminSound',adminSoundEnabled?'on':'off');}catch{}
    updateAdminAlertControls();
    if(adminSoundEnabled){void playAdminAlertSound();show('Application alert sounds enabled in this browser.');}
    else show('Application alert sounds off.');
    return;
  }
  if(action==='reviewPrivacy'){
    if(!admin()||!privacyReady)return;
    const request=(cache.privacy_requests||[]).find(r=>r.id===id),status=el.dataset.status;
    if(!request||!['in_review','completed','declined'].includes(status))return;
    const message=status==='completed'&&request.request_type==='account_removal'
      ?'Complete this only after you have handled the Auth account, related records and uploaded files in Supabase.'
      :status==='completed'?'Complete this only after the requested content has been handled.':'Write a clear response; the requester can see it.';
    return modal(`<span class="eyebrow">PRIVACY REVIEW</span><h2>${esc(privacyRequestLabel(request.request_type))}</h2><p>${esc(message)}</p><p class="hint">Request ID: ${esc(request.id)} · Auth user ID: ${esc(request.requester_auth_id||'Removed')}</p><form id="editor" data-kind="privacyReview" class="form-stack"><input type="hidden" name="request_id" value="${esc(id)}"><input type="hidden" name="decision" value="${esc(status)}"><div class="field"><label for="privacy_review_note">Response to the requester ${status==='in_review'?'(optional)':''}</label><textarea id="privacy_review_note" name="note" maxlength="2000" ${status==='in_review'?'':'required'}></textarea></div><button class="button" type="submit">${status==='in_review'?'Begin review':status==='completed'?'Mark completed':'Decline request'}</button></form>`);
  }
  if(action==='reloadApplications'&&admin())return loadAdminApplicationPages();
  if(['applicationsPrev','applicationsNext','approvedAccountsPrev','approvedAccountsNext'].includes(action)){
    if(!admin()||applicationsLoading)return;
    const applicantPage=action.startsWith('applications');
    const current=applicantPage?applicationsPage:approvedAccountsPage;
    const total=applicantPage?applicationTotal:approvedAccountTotal;
    const next=current+(action.endsWith('Next')?1:-1);
    if(next<0||next*50>=total)return;
    if(applicantPage)applicationsPage=next;else approvedAccountsPage=next;
    return loadAdminApplicationPages();
  }
  if(action==='reloadFeed'&&clubAccess())return loadFeedPage();
  if(action==='feedPrev'||action==='feedNext'){
    if(!clubAccess()||feedLoading)return;
    const next=feedPage+(action==='feedNext'?1:-1);
    if(next<0||next*30>=feedTotal)return;
    feedPage=next;
    return loadFeedPage();
  }
  if(action==='inventoryFilter'){if(!clubAccess())return;inventoryFilter=el.dataset.filter;render();return;}
  if(action==='financeFilter'){if(!admin())return;financeFilter=el.dataset.filter;financePage=0;render();return;}
  if(action==='inventoryLogPrev'||action==='inventoryLogNext'){if(!founder())return;inventoryLogPage=Math.max(0,inventoryLogPage+(action==='inventoryLogNext'?1:-1));render();return;}
  if(action==='financePrev'||action==='financeNext'){if(!admin())return;financePage=Math.max(0,financePage+(action==='financeNext'?1:-1));render();return;}
  if(action==='financeReviewPrev'||action==='financeReviewNext'){if(!founderOnly())return;financeReviewPage=Math.max(0,financeReviewPage+(action==='financeReviewNext'?1:-1));render();return;}
  if(action==='reviewFinance'&&founderOnly()&&financeApprovalsReady){
    const entry=(cache.finance_entries||[]).find(x=>x.id===id),decision=el.dataset.decision;
    if(!entry||financeStatus(entry)!=='pending'||!['approved','rejected'].includes(decision))return;
    return modal(`<span class="eyebrow">FOUNDER DECISION</span><h2>${decision==='approved'?'Approve':'Reject'} transaction</h2><p class="muted">${esc(entry.entry_type)} · ${esc(recordMoney(Math.round(Number(entry.amount)*100)))} · ${esc(entry.category)} · ${esc(recordDate(entry.occurred_on))}</p><p>${esc(entry.description)}</p><p class="subtle">Reference: ${esc(entry.reference||'Not supplied')} · Entered by ${esc(memberName(entry.created_by))}</p><form id="editor" data-kind="financeReview" class="form-stack"><input type="hidden" name="entry_id" value="${esc(id)}"><input type="hidden" name="decision" value="${decision}"><div class="field"><label for="review_note">${decision==='rejected'?'Reason for rejection':'Review note (optional)'}</label><textarea id="review_note" name="note" maxlength="2000" ${decision==='rejected'?'required':''}></textarea></div><button class="button" type="submit">Confirm ${decision==='approved'?'approval':'rejection'}</button></form>`);
  }
  if(action==='inventoryAddForm'&&admin()&&inventoryCatalogReady)return form('Add stock item','Record a component, tool, supply or other club asset. Quantities are whole numbers; use cm for wire or g for small weights.','inventoryItem',field('Item name','name')+select('Item type','item_type',['component','tool','equipment','consumable','other'])+field('Category (e.g. Sensors, Hand tools)','category')+field('Unit (pcs, cm, g, rolls, sets)','unit','text','pcs')+`<div class="field"><label for="quantity_total">Starting quantity</label><input id="quantity_total" name="quantity_total" type="number" min="0" max="2147483647" step="1" value="1" required></div><div class="field"><label for="reorder_level">Low-stock level</label><input id="reorder_level" name="reorder_level" type="number" min="0" max="2147483647" step="1" value="0" required></div>`+select('Condition','condition',['good','needs_repair','retired'])+field('Storage location','location','text','',false)+field('Serial or asset number (optional)','serial_number','text','',false));
  if(action==='inventoryQuantityForm'&&admin()&&inventoryCatalogReady){
    const item=(cache.inventory_items||[]).find(x=>x.id===id);if(!item)return;
    const checkedOut=Number(item.quantity_total)-Number(item.quantity_available);
    return form('Update quantity',`${esc(item.name)} · ${item.quantity_available} ${esc(item.unit)} in stock, ${checkedOut} checked out. Set the new amount in stock; the total changes by the same amount and existing loans stay recorded.`,'inventoryQuantity',`<input type="hidden" name="item_id" value="${esc(item.id)}"><input type="hidden" name="expected_total" value="${esc(item.quantity_total)}"><input type="hidden" name="expected_available" value="${esc(item.quantity_available)}"><div class="field"><label for="target_available">New quantity in stock (${esc(item.unit)})</label><input id="target_available" name="target_available" type="number" min="0" max="${2147483647-checkedOut}" step="1" value="${esc(item.quantity_available)}" required></div><div class="field"><label for="quantity_note">Reason for correction</label><textarea id="quantity_note" name="note" maxlength="2000" required placeholder="e.g. Counted five additional sensors after a workshop"></textarea></div>`);
  }
  if(action==='inventoryUnitForm'&&admin()&&inventoryCatalogReady){
    const item=(cache.inventory_items||[]).find(x=>x.id===id);if(!item)return;
    const checkedOut=Number(item.quantity_total)-Number(item.quantity_available);
    if(checkedOut>0)return modal(`<span class="eyebrow">INVENTORY</span><h2>Change measurement unit</h2><p>${esc(item.name)} has ${checkedOut} ${esc(item.unit)} checked out. Record their return before changing how this item is counted.</p><button class="button" type="button" data-action="inventoryMoveForm" data-movement="return" data-id="${esc(item.id)}">Record return →</button>`);
    return form('Change measurement unit',`${esc(item.name)} is currently counted as ${item.quantity_available} ${esc(item.unit)}. Enter the count and low-stock level in the new unit. Older movements keep their original unit in history.`,'inventoryUnit',`<input type="hidden" name="item_id" value="${esc(item.id)}"><input type="hidden" name="expected_unit" value="${esc(item.unit)}"><input type="hidden" name="expected_total" value="${esc(item.quantity_total)}"><input type="hidden" name="expected_available" value="${esc(item.quantity_available)}"><input type="hidden" name="expected_reorder_level" value="${esc(item.reorder_level)}"><div class="field"><label for="new_unit">New measurement unit</label><input id="new_unit" name="new_unit" maxlength="30" value="${esc(item.unit)}" placeholder="e.g. pcs, cm, g, rolls or sets" required></div><div class="field"><label for="new_quantity">New count in the new unit</label><input id="new_quantity" name="new_quantity" type="number" min="0" max="2147483647" step="1" value="${esc(item.quantity_available)}" required><small class="hint">Keep this number for a label correction; recount when converting to a different sized unit.</small></div><div class="field"><label for="new_reorder_level">Low-stock level in the new unit</label><input id="new_reorder_level" name="new_reorder_level" type="number" min="0" max="2147483647" step="1" value="${esc(item.reorder_level)}" required></div><div class="field"><label for="unit_note">Reason for change</label><textarea id="unit_note" name="note" maxlength="2000" required placeholder="e.g. Changed from metres to centimetres and recounted stock"></textarea></div>`);
  }
  if(action==='inventoryEditForm'&&admin()&&inventoryCatalogReady){
    const item=(cache.inventory_items||[]).find(x=>x.id===id);if(!item)return;
    return form('Edit item details','Update descriptions here. The reason and before/after values stay in stock history.','inventoryDetails',`<input type="hidden" name="item_id" value="${esc(item.id)}"><div class="notice">Need to change stock or units? <button type="button" class="text-button" data-action="inventoryQuantityForm" data-id="${esc(item.id)}">Update quantity →</button> · <button type="button" class="text-button" data-action="inventoryUnitForm" data-id="${esc(item.id)}">Change unit →</button></div>`+field('Item name','name','text',item.name)+select('Item type','item_type',['component','tool','equipment','consumable','other'],item.item_type)+field('Category','category','text',item.category)+`<div class="field"><span class="field-label">Measurement unit</span><strong>${esc(item.unit)}</strong><input type="hidden" name="unit" value="${esc(item.unit)}"><small class="hint">Use Change unit to recount stock and preserve older units in history.</small></div>`+`<div class="field"><label for="reorder_level">Low-stock level</label><input id="reorder_level" name="reorder_level" type="number" min="0" max="2147483647" step="1" value="${esc(item.reorder_level)}" required></div>`+select('Condition','condition',['good','needs_repair','retired'],item.condition)+field('Storage location','location','text',item.location||'',false)+field('Serial or asset number (optional)','serial_number','text',item.serial_number||'',false)+`<div class="field"><label for="change_note">Reason for change</label><textarea id="change_note" name="note" maxlength="2000" required></textarea></div>`);
  }
  if(action==='inventoryMoveForm'&&admin()&&inventoryCatalogReady){
    const item=(cache.inventory_items||[]).find(x=>x.id===id);if(!item)return;
    const first=el.dataset.movement==='return'?'return':['component','consumable'].includes(item.item_type)?'issue_stock':'check_out';
    const kinds=first==='return'?['return','check_out','add_stock','remove_stock','issue_stock']:first==='issue_stock'?['issue_stock','add_stock','remove_stock','check_out','return']:['check_out','return','add_stock','remove_stock','issue_stock'];
    return form('Record movement',`${esc(item.name)} · ${item.quantity_available} of ${item.quantity_total} ${esc(item.unit)} in stock.`,'inventoryMovement',`<input type="hidden" name="item_id" value="${esc(item.id)}">`+select('Movement','movement_kind',kinds)+`<div class="field"><label for="movement_quantity">Quantity (${esc(item.unit)})</label><input id="movement_quantity" name="quantity" type="number" min="1" max="2147483647" step="1" value="1" required></div><div class="field" id="movementMember"><label for="member_id">Member receiving or returning it</label><select id="member_id" name="member_id" required>${movementMemberOptions(item.id,first)}</select></div><div class="field"><label for="movement_note">Purpose / project / reason</label><textarea id="movement_note" name="note" maxlength="2000" required></textarea></div>`);
  }
  if(action==='financeEntryForm'&&admin()&&financeApprovalsReady)return form('Submit transaction','Enter income or spending in GHS. An approved founder must review it before it changes the balance.','financeEntry',select('Type','entry_type',['income','expense'])+select('Category','category',['Opening balance','Membership dues','Donation','Sponsorship','Event','Equipment','Transport','Training','Operations','Other'])+`<div class="field"><label for="amount">Amount (GHS)</label><input id="amount" name="amount" type="number" min="0.01" max="9999999999.99" step="0.01" required></div>`+field('Transaction date','occurred_on','date',new Date().toISOString().slice(0,10))+area('Purpose / explanation','description')+field('From / paid to (optional)','counterparty','text','',false)+field('Receipt or transfer reference (optional)','reference','text','',false));
  if(action==='calendarPrev'||action==='calendarNext'){calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+(action==='calendarNext'?1:-1),1);calendarSelected=new Date(calendarMonth);render();return;}
  if(action==='calendarToday'){calendarSelected=new Date();calendarMonth=new Date(calendarSelected.getFullYear(),calendarSelected.getMonth(),1);render();return;}
  if(action==='calendarDay'){const [y,m,d]=(el.dataset.date||'').split('-').map(Number);if(!y||m<1||m>12||d<1||d>31)return;calendarSelected=new Date(y,m-1,d);render();return;}
  if(action==='calendarItem')return calendarItem(el.dataset.kind,id);
  if(action==='calendarProject'){close();location.hash='#projects';projectDetail(id);return;}
  if(action==='teachingTab'){
    if(!teacher())return;
    const target=el.dataset.tab;
    if(!['overview','workshops','reviews','materials',...(!admin()?['profile']:[])].includes(target))return;
    teachingTab=target;render();
    if(el.getAttribute('role')==='tab')requestAnimationFrame(()=>document.getElementById(`teaching-tab-${target}`)?.focus());
    else document.getElementById(`teaching-tab-${target}`)?.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  if(action==='courseView'&&clubAccess()){
    const view=el.dataset.view;if(!['mine','explore'].includes(view))return;
    courseView=view;render();
    document.querySelector(`.course-view-button[data-view="${view}"]`)?.focus();
    return;
  }
  if(action==='courseSelect'&&clubAccess()&&courseReady){
    if(!(cache.course_enrollments||[]).some(e=>e.course_id===id&&e.learner_id===session.user.id))return;
    activeCourseId=id;courseDetailView='overview';courseView='mine';render();
    document.querySelector('.course-classroom h2')?.focus({preventScroll:true});
    document.getElementById(`course-${id}`)?.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  if(action==='courseDetailView'&&clubAccess()&&courseReady){
    const view=el.dataset.view;if(!['overview','materials','submit','feedback'].includes(view))return;
    courseDetailView=view;render();
    document.querySelector(`.course-detail-button[data-view="${view}"]`)?.focus();
    return;
  }
  if(action==='courseTrack'){const track=el.dataset.track;if(track==='all'||courseTracks.some(t=>t.name===track)){courseTrack=track;render();}return;}
  if(action==='focusCourse'&&clubAccess()){
    if(!(cache.courses||[]).some(c=>c.id===id))return;
    if($('#modal').open)close();
    const enrolled=(cache.course_enrollments||[]).some(e=>e.course_id===id&&e.learner_id===session?.user.id);
    courseView=enrolled?'mine':'explore';activeCourseId=enrolled?id:null;
    courseDetailView='overview';courseTrack='all';location.hash='#courses';render();
    setTimeout(()=>{const target=document.getElementById(`course-${id}`);target?.querySelector('h2,h3')?.focus({preventScroll:true});target?.scrollIntoView({behavior:'smooth',block:'center'});},80);
    return;
  }
  if(action==='courseRoster'&&teacher()&&courseReady&&coursePlanningReady){
    const course=(cache.courses||[]).find(c=>c.id===id);
    if(!course||!admin()&&course.instructor_id!==session.user.id)return;
    const learners=(cache.course_enrollments||[]).filter(e=>e.course_id===id);
    return modal(`<span class="eyebrow">TEACHING STUDIO</span><h2>${esc(course.title)} · students</h2><p class="muted">${learners.length} enrolled member${learners.length===1?'':'s'}. Private profiles show their name here only because they are in this workshop.</p><div class="teacher-roster-list">${learners.map(e=>`<div class="teacher-roster-row"><span><strong>${esc(courseLearnerName(id,e.learner_id))}</strong><small>${esc(courseProgress(e))}</small></span>${e.status==='enrolled'&&!(cache.course_submissions||[]).some(s=>s.course_id===id&&s.learner_id===e.learner_id)?`<button type="button" class="text-button" data-action="unassignCourseForm" data-id="${esc(id)}" data-learner="${esc(e.learner_id)}">Remove</button>`:''}</div>`).join('')||empty('No learners yet','Members can add this workshop to their learning plans, or you can assign one by email.')}</div>`);
  }
  if(action==='assignLearnerForm'&&teacher()&&courseReady&&coursePlanningReady){
    const course=(cache.courses||[]).find(c=>c.id===id);
    if(!course||!admin()&&course.instructor_id!==session.user.id)return;
    return form('Assign a member',`Add an approved club member to ${esc(course.title)} using the email they use to sign in. They will receive an in-app notification. They can still join other workshops.`,'courseLearner',`<input type="hidden" name="course_id" value="${esc(id)}">${field('Member sign-in email','email','email')}`);
  }
  if(action==='editCourseScheduleForm'&&teacher()&&courseReady&&coursePlanningReady){
    const course=(cache.courses||[]).find(c=>c.id===id);
    if(!course||!admin()&&course.instructor_id!==session.user.id)return;
    return form('Workshop schedule',`Update the start time and project deadline for ${esc(course.title)}. Enrolled students will receive an in-app notification. Work can still be submitted after the deadline.`,'courseSchedule',`<input type="hidden" name="course_id" value="${esc(id)}">${field('Start date and time','starts_at','datetime-local',courseDateInput(course.starts_at),false)}${field('Project deadline (optional)','submission_due_at','datetime-local',courseDateInput(course.submission_due_at),false)}`);
  }
  if(action==='editCourseContentForm'&&teacher()&&courseReady){
    const course=(cache.courses||[]).find(c=>c.id===id);
    if(!course||!admin()&&course.instructor_id!==session.user.id)return;
    const original=String(course.description||'').replace(/\r\n?/g,'\n');
    const parts=original.match(/^Build:\s*([\s\S]*?)\n\nPractice:\s*([\s\S]*?)\n\nTools:\s*([\s\S]*)$/);
    const build=parts?parts[1]:original,practice=parts?parts[2]:'',tools=parts?parts[3]:'';
    return form('Edit workshop plan','Describe the build, hands-on activities and tools learners need. Older freeform descriptions appear in the build goal for you to revise.','courseContent',`<input type="hidden" name="course_id" value="${esc(id)}">${field('Workshop title','title','text',course.title)}${select('Learning track','category',courseTracks.map(t=>t.name),courseTrackFor(course))}${select('Level','level',['Beginner','Intermediate','Advanced'],course.level)}${area('What will students build?','build_goal',build)}${area('Hands-on activities and tests','practice_steps',practice)}${field('Tools and materials','tools','text',tools)}${field('Resource URL (optional)','resource_url','url',course.resource_url||'',false)}`);
  }
  if(action==='unassignCourseForm'&&teacher()&&courseReady&&coursePlanningReady){
    const course=(cache.courses||[]).find(c=>c.id===id),learnerId=el.dataset.learner;
    const enrollment=(cache.course_enrollments||[]).find(e=>e.course_id===id&&e.learner_id===learnerId);
    if(!course||!enrollment||!admin()&&course.instructor_id!==session.user.id)return;
    if(enrollment.status!=='enrolled'||(cache.course_submissions||[]).some(s=>s.course_id===id&&s.learner_id===learnerId))return show('A student with submitted work or a completion record cannot be removed.');
    return modal(`<span class="eyebrow">TEACHING STUDIO</span><h2>Remove student</h2><p>Remove ${esc(courseLearnerName(id,learnerId))} from ${esc(course.title)}? They will receive an in-app notification. They can rejoin later. Submitted work cannot be removed.</p><form id="editor" data-kind="courseUnassign" class="form-stack"><input type="hidden" name="course_id" value="${esc(id)}"><input type="hidden" name="learner_id" value="${esc(learnerId)}"><button class="button" type="submit">Remove student</button></form>`);
  }
  if(action==='enrollCourse'&&clubAccess()&&courseReady){
    if(!(cache.courses||[]).some(c=>c.id===id))return;
    return enrollAndOpenCourse(id);
  }
  if(action==='submitCourseForm'&&clubAccess()&&courseReady){
    const course=(cache.courses||[]).find(c=>c.id===id);
    const enrollment=(cache.course_enrollments||[]).find(e=>e.course_id===id&&e.learner_id===session.user.id&&e.status==='enrolled');
    if(!course||!enrollment|| (cache.course_submissions||[]).some(s=>s.course_id===id&&s.learner_id===session.user.id&&s.review_status==='submitted'))return;
    return modal(`<span class="eyebrow">PRACTICAL WORKSHOP</span><h2>Submit your project</h2><p class="muted">${esc(course.title)} · Explain what you built, how you tested it, and what you learned. You may attach a PDF or image up to 10 MB.</p><form id="editor" data-kind="courseSubmission" class="form-stack"><input type="hidden" name="course_id" value="${esc(id)}">${area('Build notes and test results','details')}${field('Project or demo URL (optional)','evidence_url','url','',false)}<div class="field"><label for="course_file">Evidence file (optional)</label><input id="course_file" name="course_file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"></div><button class="button" type="submit">Send project for review</button></form>`);
  }
  if(action==='downloadCourseEvidence'&&clubAccess()&&courseReady)return downloadCourseEvidence(id);
  if(action==='reviewCourseForm'&&teacher()&&courseReady){
    const attempt=(cache.course_submissions||[]).find(s=>s.id===id&&s.review_status==='submitted'),course=(cache.courses||[]).find(c=>c.id===attempt?.course_id);
    const decision=el.dataset.status;if(!attempt||!course||attempt.learner_id===session.user.id||(!admin()&&course.instructor_id!==session.user.id)||!['accepted','revision_requested'].includes(decision))return;
    return modal(`<span class="eyebrow">TEACHER FEEDBACK</span><h2>${decision==='accepted'?'Accept and complete project':'Ask for a revision'}</h2><p class="muted">${esc(course.title)} · ${esc(courseLearnerName(course.id,attempt.learner_id))}</p><p class="subtle">Build and test notes</p><p class="course-feedback">${esc(attempt.details)}</p>${attempt.evidence_url?`<a class="link" href="${esc(cleanUrl(attempt.evidence_url))}" target="_blank" rel="noopener noreferrer">Open project link ↗</a>`:''}${attempt.evidence_path?`<button type="button" class="text-button" data-action="downloadCourseEvidence" data-id="${esc(attempt.id)}">Open submitted evidence ↗</button>`:''}<p class="subtle">${decision==='accepted'?'Explain what worked and one useful next step. Acceptance records the student’s completion.':'Explain what to improve and how the student can test the revised build.'}</p><form id="editor" data-kind="courseReview" class="form-stack"><input type="hidden" name="submission_id" value="${esc(id)}"><input type="hidden" name="decision" value="${esc(decision)}"><div class="field"><label for="feedback">Feedback for the student</label><textarea id="feedback" name="feedback" minlength="5" maxlength="3000" required placeholder="Mention a specific result, then give one actionable suggestion."></textarea></div><button class="button" type="submit">${decision==='accepted'?'Accept and record completion':'Send revision request'}</button></form>`);
  }
  if(action==='assignCourseForm'&&admin()&&courseReady){
    const course=(cache.courses||[]).find(c=>c.id===id);if(!course)return;
    const teachers=(cache.profiles||[]).filter(p=>p.membership_status==='approved'&&(['teacher','admin'].includes(p.role)||p.role==='founder'&&p.founder_teaching_enabled===true));
    return modal(`<span class="eyebrow">TEACHING STUDIO</span><h2>Assign workshop teacher</h2><p class="muted">${esc(course.title)}</p><form id="editor" data-kind="courseInstructor" class="form-stack"><input type="hidden" name="course_id" value="${esc(id)}"><div class="field"><label for="teacher_id">Approved teacher</label><select id="teacher_id" name="teacher_id" required>${teachers.map(p=>`<option value="${esc(p.id)}" ${p.id===course.instructor_id?'selected':''}>${esc(p.full_name)} · ${esc(p.role)}</option>`).join('')}</select></div><button class="button" type="submit">Assign teacher</button></form>`);
  }
  if(action==='login'||action==='signup')return signInDialog('signup');
  if(action==='signin')return signInDialog('signin');
  if(action==='memberProfile')return memberProfile(id);
  if(action==='openDm'){if(!dmReady)return;activePeerId=id;if($('#modal').open)close();location.hash='#messages';render();void loadDmThread();markDmRead(id);return;}
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
  if(action==='selectChannel'){activeChannelId=id;render();void loadChannelHistory();markChannelRead(id);return;}
  if(action==='reloadChannelHistory'&&clubAccess())return loadChannelHistory();
  if(action==='channelOlder'||action==='channelNewer'){
    if(!clubAccess()||channelHistoryLoading)return;
    const next=channelPage+(action==='channelOlder'?1:-1);
    if(next<0||next*50>=channelTotal)return;
    channelPage=next;return loadChannelHistory();
  }
  if(action==='reloadDmThread'&&clubAccess())return loadDmThread();
  if(action==='dmOlder'||action==='dmNewer'){
    if(!clubAccess()||dmThreadLoading)return;
    const next=dmPage+(action==='dmOlder'?1:-1);
    if(next<0||next*50>=dmTotal)return;
    dmPage=next;return loadDmThread();
  }
  if(['memberDirectoryPrev','memberDirectoryNext','projectListPrev','projectListNext'].includes(action)){
    if(!clubAccess())return;
    const memberList=action.startsWith('memberDirectory');
    const current=memberList?memberDirectoryPage:projectListPage;
    const total=memberList?(cache.profiles||[]).filter(p=>p.membership_status==='approved'&&p.role!=='investor').length:(cache.projects||[]).length;
    const next=current+(action.endsWith('Next')?1:-1);
    if(next<0||next*50>=total)return;
    if(memberList)memberDirectoryPage=next;else projectListPage=next;
    render();
    if(memberList){
      const paths=[...document.querySelectorAll('.person-photo-trigger[data-id]')].map(photo=>(cache.profiles||[]).find(p=>p.id===photo.dataset.id)?.avatar_path).filter(Boolean);
      void hydrateMedia(paths).then(changed=>{if(changed&&page==='members'&&memberDirectoryPage===next)render();}).catch(console.error);
    }
    return;
  }
  if(action==='thread')return threadDialog(id);
  if(action==='react')return toggleReaction(id,el.dataset.emoji);
  if(action==='editMessage'){const m=(channelHistoryRows||[]).find(x=>x.id===id)||(cache.channel_messages||[]).find(x=>x.id===id);if(m)return form('Edit message','Update your message in this channel.','editMessage',area('Message','body',m.body)+`<input type="hidden" name="message_id" value="${esc(id)}">`);return;}
  if(action==='removeMessage')return removeMessage(id);
  if(action==='searchChat')return form('Search messages','Find a conversation across club channels.','searchChat',field('Search term','term'));
  if(action==='openChannel'){close();activeChannelId=id;location.hash='#channels';render();void loadChannelHistory();markChannelRead(id);return;}
  if(action==='report'){activeReportTarget={type:el.dataset.type,id};return form('Report content','Tell administrators what needs attention.','report',area('Reason for report','reason'));}
  if(action==='reviewMember')return reviewMember(id,el.dataset.status);
  if(action==='approveApplicantTeacher'&&admin()){
    const applicant=applicationRows.find(p=>p.id===id&&p.application_type==='member'&&['pending','rejected'].includes(p.membership_status));
    const eligibility=applicationVerification.get(id);
    if(!applicant||eligibility?.verified!==true||!applicant.application_reason?.trim()&&!eligibility.previouslyApproved)return;
    return modal(`<span class="eyebrow">APPLICATION REVIEW</span><h2>Approve ${esc(applicant.full_name)} as a teacher?</h2><p class="muted">They applied as a member. This grants teacher access, sends the normal approval notification and queues the first approval email if the email worker is running. They can complete their teaching details in Teaching studio.</p><form id="editor" data-kind="approveApplicantTeacher" class="form-stack"><input type="hidden" name="user_id" value="${esc(id)}"><button class="button" type="submit">Approve as teacher</button></form>`);
  }
  if(action==='promoteTeacher'&&admin()){
    const member=approvedAccountRows.find(p=>p.id===id&&p.role==='member'&&p.membership_status==='approved');
    if(!member)return;
    return modal(`<span class="eyebrow">TEACHER ACCESS</span><h2>Make ${esc(member.full_name)} a teacher?</h2><p class="muted">They will gain access to Teaching studio, course publishing, learning materials and assigned project reviews. They can complete their teaching details after signing in.</p><form id="editor" data-kind="promoteTeacher" class="form-stack"><input type="hidden" name="user_id" value="${esc(id)}"><button class="button" type="submit">Confirm teacher access</button></form>`);
  }
  if(action==='assignFounderRole'&&admin()){
    const account=approvedAccountRows.find(p=>p.id===id&&p.role==='teacher'&&p.membership_status==='approved'&&'founder_teaching_enabled' in p);
    if(!account)return;
    return modal(`<span class="eyebrow">FOUNDER LEADERSHIP</span><h2>Make ${esc(account.full_name)} a founder?</h2><p class="muted">They keep their teaching profile and assigned workshops and gain the private Founder room and finance review access. This takes effect immediately and sends an in-app notification.</p><form id="editor" data-kind="assignFounderRole" class="form-stack"><input type="hidden" name="user_id" value="${esc(id)}"><button class="button" type="submit">Make founder</button></form>`);
  }
  if(action==='viewTeacherProfile'&&admin())return void viewTeacherProfile(id);
  if(action==='toggleFounderTeaching'&&admin()){
    const account=approvedAccountRows.find(p=>p.id===id&&p.role==='founder'&&p.membership_status==='approved'&&'founder_teaching_enabled' in p);
    if(!account)return;
    const enable=!account.founder_teaching_enabled;
    return modal(`<span class="eyebrow">FOUNDER TEACHING</span><h2>${enable?'Assign teaching to':'Pause teaching for'} ${esc(account.full_name)}?</h2><p class="muted">${enable?'Their founder access stays active. They can use Teaching studio, complete a teaching profile and lead workshops.':'Their founder meetings and finance review stay available. Reassign their workshops before pausing teaching access.'}</p><form id="editor" data-kind="founderTeaching" class="form-stack"><input type="hidden" name="user_id" value="${esc(id)}"><input type="hidden" name="enabled" value="${enable}"><button class="button" type="submit">${enable?'Assign teaching':'Pause teaching'}</button></form>`);
  }
  if(action==='removeFounderRole'&&admin()){
    const account=approvedAccountRows.find(p=>p.id===id&&p.role==='founder'&&p.membership_status==='approved');
    if(!account)return;
    return modal(`<span class="eyebrow">FOUNDER ROLE</span><h2>Remove ${esc(account.full_name)} from founder leadership?</h2><p class="muted">Founder room and finance review access will end. Choose Teacher to give or retain teaching access and keep current workshop assignments, or Member to end teaching access. Reassign all their workshops before choosing Member. Their public founder profile, if published, is removed separately on the Founders page.</p><form id="editor" data-kind="removeFounderRole" class="form-stack"><input type="hidden" name="user_id" value="${esc(id)}">${select('Keep account as','next_role',['teacher','member'],account.founder_teaching_enabled?'teacher':'member')}<button class="button" type="submit">Remove founder role</button></form>`);
  }
  if(action==='removeFounderCard'&&admin()){
    const card=(cache.founders||[]).find(f=>f.id===id);if(!card)return;
    return modal(`<span class="eyebrow">PUBLIC PROFILE</span><h2>Remove ${esc(card.name)} from the Founders page?</h2><p class="muted">This removes the published card. It does not change anyone's account access or delete their posts and records.</p><form id="editor" data-kind="removeFounderCard" class="form-stack"><input type="hidden" name="card_id" value="${esc(id)}"><button class="button" type="submit">Remove public profile</button></form>`);
  }
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
    const assigned=(cache.courses||[]).filter(c=>admin()||c.instructor_id===session.user.id);
    const selected=assigned.some(c=>c.id===el.dataset.course)?el.dataset.course:'';
    const options='<option value="" '+(!selected?'selected':'')+'>General learning library</option>'+assigned.map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.title)}</option>`).join('');
    return modal(`<span class="eyebrow">TEACHING STUDIO</span><h2>Upload learning material</h2><p class="muted">Choose one of your assigned workshops to make its slides, notes or guides easy for enrolled students to find. Choose the general library for material intended for the wider club. Maximum 20 MB per file.</p><form id="editor" data-kind="learningMaterial" class="form-stack">${field('Title','title')}${select('Type','kind',['slides','notes','worksheet','guide'])}<div class="field"><label for="course_id">Related workshop</label><select id="course_id" name="course_id">${options}</select></div><div class="field"><label for="description">Description (optional)</label><textarea id="description" name="description" maxlength="1500"></textarea></div><div class="field"><label for="learning_file">PDF, PPT, PPTX, DOC or DOCX</label><input id="learning_file" name="learning_file" type="file" accept=".pdf,.ppt,.pptx,.doc,.docx" required></div><button class="button" type="submit">Publish material</button></form>`);
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
    const basic=field('Full name','full_name','text',me?.full_name||'')+(enhancedReady?field('Unique handle (for mentions)','handle','text',me?.handle||''):'')+field('Background / organization','programme','text',me?.programme||'',false)+field('Skills / interests','skills','text',me?.skills||'',false);
    const extra=(dmReady?field('Headline / role','headline','text',me?.headline||'',false)+`<div class="field"><label for="bio">About me</label><textarea id="bio" name="bio" maxlength="1200">${esc(me?.bio||'')}</textarea></div>`+select('Availability','availability',['available','busy','away'],me?.availability||'available'):'')+('profile_visibility' in (me||{})?`<div class="field"><label for="profile_visibility">Profile visibility</label><select id="profile_visibility" name="profile_visibility"><option value="club" ${me.profile_visibility==='club'?'selected':''}>Approved club members</option><option value="private" ${me.profile_visibility==='private'?'selected':''}>Only me and administrators</option></select></div>`:'');
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
  if(action==='courseForm'&&teacher())return form('Practical workshop','Choose one of the four tracks and describe the project learners will complete.','course',field('Workshop title','title')+select('Learning track','category',courseTracks.map(t=>t.name))+select('Level','level',['Beginner','Intermediate','Advanced'])+area('What will learners build?','build_goal')+area('Hands-on activities and tests','practice_steps')+field('Tools and materials','tools')+field('Start date and time','starts_at',coursePlanningReady?'datetime-local':'date','',false)+(coursePlanningReady?field('Project deadline (optional)','submission_due_at','datetime-local','',false):'')+field('Resource URL (optional)','resource_url','url','',false));
  if(action==='eventForm')return form('Event','The calendar and meeting link stay together.','event',field('Title','title')+area('Description','description')+field('Start','starts_at','datetime-local')+field('End','ends_at','datetime-local')+field('Location','location','text','',false)+field('Google Meet URL','meet_url','url','',false));
  if(action==='announcementForm')return form('Alert','Important updates appear on the home page.','announcement',field('Title','title')+select('Priority','priority',['normal','urgent'])+area('Message','body'));
  if(action==='founderForm'&&admin())return form('Founder','Publish only details and photos this person has agreed to share.','founder',field('Name','name')+field('Role','role')+area('Bio','bio')+field('Profile URL','link_url','url','',false)+field('Order','sort_order','number','1')+(founderPortraitReady?'<div class="field"><label for="portrait_file">Public portrait (optional, JPG, PNG or WebP, max 5 MB)</label><input id="portrait_file" name="portrait_file" type="file" accept="image/jpeg,image/png,image/webp"><p class="hint">This photograph is visible to everyone on the Founders page.</p></div>':'<p class="hint">Portrait upload will be available after the founder portrait setup.</p>'));
  if(action==='editFounderForm'&&admin()&&founderPortraitReady){
    const card=(cache.founders||[]).find(f=>f.id===id);if(!card)return;
    return form('Founder profile','Update the public card with the founder’s consent.','founderEdit',`<input type="hidden" name="card_id" value="${esc(card.id)}">`+field('Name','name','text',card.name)+field('Role','role','text',card.role)+area('Bio','bio',card.bio||'')+field('Profile URL','link_url','url',card.link_url||'',false)+field('Order','sort_order','number',card.sort_order||1)+`<div class="field"><label for="portrait_file">${card.portrait_path?'Replace public portrait':'Add public portrait'} (optional, max 5 MB)</label><input id="portrait_file" name="portrait_file" type="file" accept="image/jpeg,image/png,image/webp"></div>${card.portrait_path?'<label class="hint"><input type="checkbox" name="remove_portrait" value="yes"> Remove current portrait</label>':''}`);
  }
  if(action==='calendar'||action==='ics'){const item=(cache.events||[]).find(x=>x.id===id);if(item)calendar(item,action==='ics');}
}
async function mutate(fn) {try{const {error}=await fn();if(error)throw error;close();await refresh();show('Saved successfully.');}catch(e){fail(e);}}
async function reviewMember(id,status) {
  if(!admin()||!['approved','rejected','suspended'].includes(status))return;
  try {const {error}=await db.rpc('review_membership',{p_user:id,p_status:status});if(error)throw error;await refresh();show(`Membership ${status}.`);}catch(e){fail(e);}
}
async function approveApplicantTeacher(id) {
  if(!admin()||!applicationRows.some(p=>p.id===id&&p.application_type==='member'&&['pending','rejected'].includes(p.membership_status)))return;
  try {
    const {error}=await db.rpc('approve_member_applicant_as_teacher',{p_user:id});
    if(error)throw error;
    close();await refresh();await loadAdminApplicationPages();show('Applicant approved as a teacher.');
  }catch(error){fail(error);}
}
async function promoteTeacher(id) {
  if(!admin()||!approvedAccountRows.some(p=>p.id===id&&p.role==='member'&&p.membership_status==='approved'))return;
  try {
    const {error}=await db.rpc('promote_member_to_teacher',{p_user:id});
    if(error)throw error;
    close();await refresh();await loadAdminApplicationPages();show('Member promoted to teacher. Their Teaching studio is ready.');
  }catch(error){fail(error);}
}
async function assignFounderRole(id) {
  if(!admin()||!approvedAccountRows.some(p=>p.id===id&&p.role==='teacher'&&p.membership_status==='approved'))return;
  try {
    const {error}=await db.rpc('assign_teacher_as_founder',{p_user:id});
    if(error)throw error;
    close();await refresh();await loadAdminApplicationPages();show('Teacher assigned as founder. Their teaching access remains active.');
  }catch(error){fail(error);}
}
async function viewTeacherProfile(id) {
  const account=approvedAccountRows.find(p=>p.id===id&&['teacher','founder'].includes(p.role)&&p.membership_status==='approved');
  if(!admin()||!account)return;
  try {
    const {data,error}=await db.from('teacher_profiles').select('*').eq('teacher_id',id).maybeSingle();
    if(error)throw error;
    modal(`<span class="eyebrow">PRIVATE TEACHING DETAILS</span><h2>${esc(account.full_name)}</h2>${data?`<div class="teacher-profile-review"><small>${esc(data.track)} · Updated ${dateTime(data.updated_at)}</small><h3>Experience or skills</h3><p>${esc(data.experience)}</p><h3>Practical teaching plan</h3><p>${esc(data.practical_focus)}</p><h3>Availability</h3><p>${esc(data.availability)}</p></div>`:'<p class="muted">This teacher has not completed their teaching profile yet.</p>'}`);
  }catch(error){fail(error);}
}
async function setFounderTeaching(id,enabled) {
  if(!admin()||!approvedAccountRows.some(p=>p.id===id&&p.role==='founder'&&p.membership_status==='approved'))return;
  try {
    const {error}=await db.rpc('set_founder_teaching',{p_user:id,p_enabled:enabled});
    if(error)throw error;
    close();await refresh();await loadAdminApplicationPages();show(enabled?'Founder teaching access enabled.':'Founder teaching access paused.');
  }catch(error){fail(error);}
}
async function removeFounderRole(id,nextRole) {
  if(!admin()||!['member','teacher'].includes(nextRole)||!approvedAccountRows.some(p=>p.id===id&&p.role==='founder'&&p.membership_status==='approved'))return;
  try {
    const {error}=await db.rpc('remove_founder_role',{p_user:id,p_next_role:nextRole});
    if(error)throw error;
    close();await refresh();await loadAdminApplicationPages();show(`Founder role removed. Account remains ${nextRole}.`);
  }catch(error){fail(error);}
}
async function removeFounderCard(id) {
  const card=(cache.founders||[]).find(f=>f.id===id);
  if(!admin()||!card)return;
  try {
    const {error}=await db.from('founders').delete().eq('id',id);
    if(error)throw error;
    let cleanupFailed=false;
    if(card.portrait_path){const removed=await db.storage.from('club-founder-portraits').remove([card.portrait_path]);if(removed.error){console.error('Founder portrait cleanup',removed.error);cleanupFailed=true;}}
    close();await refresh();show(cleanupFailed?'Profile removed. Delete its orphaned portrait from Storage manually.':'Public founder profile removed.');
  }catch(error){fail(error);}
}
async function markNotification(id) {
  try {const {error}=await db.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id);if(error)throw error;await refresh();void refreshInboxUnreadCount();}catch(e){fail(e);}
}
async function openNotification(id) {
  const n=(cache.notifications||[]).find(x=>x.id===id);if(!n)return;
  if(!n.read_at)await markNotification(id);
  if(n.target_type==='channel'){activeChannelId=n.target_id;location.hash='#channels';}
  else if(n.target_type==='project'){location.hash='#projects';setTimeout(()=>projectDetail(n.target_id),60);}
  else if(n.target_type==='course'){
    const joined=(cache.course_enrollments||[]).some(e=>e.course_id===n.target_id&&e.learner_id===session?.user.id);
    courseView=joined?'mine':'explore';activeCourseId=joined?n.target_id:null;
    courseDetailView=joined&&/^(Project accepted|Revision requested):/i.test(n.title||'')?'feedback':'overview';
    courseTrack='all';location.hash='#courses';render();
    setTimeout(()=>{const target=document.getElementById(`course-${n.target_id}`);target?.querySelector('h2,h3')?.focus({preventScroll:true});target?.scrollIntoView({behavior:'smooth',block:'center'});},80);
  }
  else if(n.target_type==='meeting')location.hash='#founder-room';
  else if(n.target_type==='founder')location.hash='#founder-room';
  else if(n.target_type==='event')location.hash='#events';
  else if(n.target_type==='announcement')location.hash='#announcements';
  else if(n.target_type==='application')location.hash=admin()?'#applications':'#application';
  else if(n.target_type==='teacher'){
    const isReview=n.kind==='course'&&/^Project ready for review:/i.test(n.title||'');
    const isEnrollment=n.kind==='course'&&/^New learner enrolled in:/i.test(n.title||'');
    teachingTab=isReview?'reviews':isEnrollment?'workshops':'profile';
    if(location.hash==='#teaching')render();else location.hash='#teaching';
    if(isEnrollment&&n.target_id)setTimeout(()=>document.getElementById(`teaching-workshop-${n.target_id}`)?.scrollIntoView({behavior:'smooth',block:'center'}),120);
  }
  else if(n.target_type==='privacy_request'){location.hash='#privacy';if(admin())setTimeout(()=>document.getElementById('privacy-admin-queue')?.scrollIntoView({behavior:'smooth',block:'start'}),80);}
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
  const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),note:'Current browser view only: not all database rows, authentication records or uploaded file bytes. This is not a backup.',data},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`innovatex-content-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function exportCsv(table){
  if(!session||!admin()&&!(founderOnly()&&['inventory_items','inventory_movements'].includes(table)))return;
  const columns={
    profiles:['id','full_name','application_type','role','membership_status','programme','skills','application_reason','created_at'],
    projects:['id','title','summary','status','progress','owner_id','created_at'],
    events:['id','title','starts_at','ends_at','location','created_at'],
    activity_posts:['id','author_id','title','category','body','created_at'],
    reports:['id','reporter_id','target_type','target_id','reason','status','created_at'],
    investor_inquiries:['id','investor_id','subject','message','status','created_at'],
    audit_events:['id','actor_id','action','target_type','target_id','created_at'],
    inventory_items:['id','name','category','item_type','unit','reorder_level','quantity_total','quantity_available','condition','location','serial_number','created_by','created_at','updated_at'],
    inventory_movements:['id','item_id','kind','quantity','unit_at_movement','member_id','note','old_details','new_details','handled_by','created_at'],
    finance_entries:['id','entry_type','category','amount','occurred_on','description','counterparty','reference','created_by','created_at','approval_status','reviewed_by','reviewed_at','review_note']
  };
  if(!Object.hasOwn(columns,table))return;
  const safe=value=>{
    let cell=typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');
    // A quoted formula is still evaluated by spreadsheet apps. Prefix any
    // formula-like cell with an apostrophe, including leading whitespace.
    if(/^[\s]*[=+@-]/.test(cell))cell="'"+cell;
    return `"${cell.replaceAll('"','""')}"`;
  };
  const headers=columns[table];
  const dataColumns=headers.filter(key=>!['approval_status','reviewed_by','reviewed_at','review_note'].includes(key)&&!(table==='profiles'&&applicationAnswersReady&&key==='application_reason'));
  const userId=session.user.id;
  const parts=['\ufeff',headers.join(','),'\r\n'];
  const pageSize=500;
  let offset=0,total=null;
  show('Preparing CSV export…');
  try{
    do{
      if(session?.user.id!==userId||!admin()&&!(founderOnly()&&['inventory_items','inventory_movements'].includes(table)))throw Error('Your session changed. Please start the export again.');
      const {data,error,count}=await db.from(table).select(dataColumns.join(','),{count:'exact'}).order('created_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+pageSize-1);
      if(error)throw error;
      if(total===null)total=count;
      if(total===null)throw Error('Could not determine export size. Please retry.');
      if(count!==total)throw Error('The records changed during export. Please retry to download a complete CSV.');
      if(!data?.length&&offset<total)throw Error('The export stopped before all rows were downloaded. Please retry.');
      let reviews=new Map();
      let answers=new Map();
      if(table==='profiles'&&applicationAnswersReady&&data?.length){
        // Read each export batch through the admin-only table after the privacy migration.
        const ids=data.map(row=>row.id);
        for(let i=0;i<ids.length;i+=100){
          const subset=ids.slice(i,i+100);
          const result=await db.from('application_answers').select('user_id,reason').in('user_id',subset);
          if(result.error)throw result.error;
          for(const answer of result.data||[])answers.set(answer.user_id,answer.reason);
        }
      }
      if(table==='finance_entries'&&data?.length){
        // Review rows are fetched for this batch, rather than relying on the
        // browser's first page of cached finance approvals.
        const ids=data.map(row=>row.id);
        for(let i=0;i<ids.length;i+=100){
          const subset=ids.slice(i,i+100);
          let reviewOffset=0,reviewTotal=null;
          do{
            const result=await db.from('finance_reviews').select('entry_id,decision,reviewer_id,created_at,note',{count:'exact'}).in('entry_id',subset).order('entry_id',{ascending:true}).range(reviewOffset,reviewOffset+99);
            if(result.error)throw result.error;
            if(reviewTotal===null)reviewTotal=result.count;
            if(reviewTotal===null||!result.data?.length&&reviewOffset<reviewTotal)throw Error('Could not load all finance approvals. Please retry.');
            for(const review of result.data||[])reviews.set(review.entry_id,review);
            reviewOffset+=(result.data||[]).length;
          }while(reviewOffset<reviewTotal);
        }
      }
      for(const row of data||[]){
        const review=reviews.get(row.id);
        const record=table==='finance_entries'?{...row,approval_status:review?.decision||'pending',reviewed_by:review?.reviewer_id,reviewed_at:review?.created_at,review_note:review?.note}:table==='profiles'&&applicationAnswersReady?{...row,application_reason:answers.get(row.id)||''}:row;
        parts.push(headers.map(key=>safe(record[key])).join(','),'\r\n');
      }
      offset+=(data||[]).length;
    }while(offset<total);
    const url=URL.createObjectURL(new Blob(parts,{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`innovatex-${table}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    show(`Downloaded ${offset} ${table.replaceAll('_',' ')} records.`);
  }catch(error){fail(error);}
}
async function markChannelRead(id) {
  if(!enhancedReady||!session)return;
  const stamp=new Date().toISOString();
  try {const {error}=await db.from('channel_reads').upsert({channel_id:id,user_id:session.user.id,last_read_at:stamp},{onConflict:'channel_id,user_id'});if(error)throw error;
    cache.channel_reads=(cache.channel_reads||[]).filter(r=>r.channel_id!==id).concat({channel_id:id,user_id:session.user.id,last_read_at:stamp});
    await refreshUnreadCounts();
  }catch(e){console.error(e);}
}
async function toggleReaction(id,emoji) {
  if(!enhancedReady||!['👍','💡','🔥','🎯'].includes(emoji))return;
  const selected=channelHistoryRows.some(m=>m.id===id);
  const old=(selected?channelHistoryReactions:cache.message_reactions||[]).some(r=>r.message_id===id&&r.user_id===session.user.id&&r.emoji===emoji);
  try {const q=db.from('message_reactions');const {error}=old?await q.delete().eq('message_id',id).eq('user_id',session.user.id).eq('emoji',emoji):await q.insert({message_id:id,user_id:session.user.id,emoji});if(error)throw error;
    if(selected)await loadChannelHistory(false);else cache.message_reactions=await read('message_reactions');
    if(page==='channels')renderChatMessages();
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
async function downloadCourseEvidence(id){
  const attempt=(cache.course_submissions||[]).find(s=>s.id===id&&s.evidence_path);if(!attempt)return;
  try{const {data,error}=await db.storage.from('club-course-evidence').createSignedUrl(attempt.evidence_path,120);
    if(error)throw error;const a=document.createElement('a');a.href=data.signedUrl;a.target='_blank';a.rel='noopener noreferrer';document.body.appendChild(a);a.click();a.remove();
  }catch(error){fail(error);}
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
    try{if(file)path=await uploadClubImage(file);const record={sender_id:session.user.id,recipient_id:activePeerId,body:body||'Shared an image'};if(mediaReady)record.image_path=path;const {error}=await db.from('direct_messages').insert(record);if(error)throw error;input.value='';input.blur();if(file)e.target.querySelector('[name=dm_image]').value='';dmPage=0;await refresh();if(page==='messages')await loadDmThread();}catch(error){if(path)await db.storage.from('club-media').remove([path]);fail(error);}finally{send.disabled=false;}return;
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
    try {if(file)path=await uploadClubImage(file);const record={channel_id:activeChannelId,author_id:session.user.id,body:body||'Shared an image'};if(mediaReady)record.image_path=path;const {error}=await db.from('channel_messages').insert(record);if(error)throw error;input.value='';if(file)e.target.querySelector('[name=chat_image]').value='';const label=$('#chatImageName');if(label)label.hidden=true;channelPage=0;await refreshChat();if(page==='channels')render();}
    catch(error){if(path)await db.storage.from('club-media').remove([path]);fail(error);}finally{send.disabled=false;}return;
  }
  if(e.target.id!=='editor'&&!e.target.matches('.privacy-editor')&&e.target.id!=='teacherProfileForm')return; e.preventDefault(); if(!db)return;
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
    if(kind==='promoteTeacher'){
      await promoteTeacher(String(payload.user_id||''));return;
    }
    if(kind==='approveApplicantTeacher'){
      await approveApplicantTeacher(String(payload.user_id||''));return;
    }
    if(kind==='founderTeaching'){
      if(!admin()||!['true','false'].includes(payload.enabled))throw Error('Administrator access and a valid teaching decision are required.');
      await setFounderTeaching(String(payload.user_id||''),payload.enabled==='true');return;
    }
    if(kind==='assignFounderRole'){
      await assignFounderRole(String(payload.user_id||''));return;
    }
    if(kind==='removeFounderRole'){
      await removeFounderRole(String(payload.user_id||''),String(payload.next_role||''));return;
    }
    if(kind==='removeFounderCard'){
      await removeFounderCard(String(payload.card_id||''));return;
    }
    if(kind==='teacherProfile'){
      if(!teacher()||admin()||!teacherProfileReady)throw Error('Approved teaching access and the teacher promotions migration are required.');
      const record={track:String(payload.track||''),experience:String(payload.experience||'').trim(),practical_focus:String(payload.practical_focus||'').trim(),availability:String(payload.availability||'').trim()};
      if(!courseTracks.some(t=>t.name===record.track)||record.experience.length<20||record.experience.length>2000||record.practical_focus.length<20||record.practical_focus.length>2000||record.availability.length<5||record.availability.length>500)throw Error('Choose a track and complete your experience, practical plan and availability.');
      const query=teacherProfile?db.from('teacher_profiles').update(record).eq('teacher_id',session.user.id):db.from('teacher_profiles').insert({teacher_id:session.user.id,...record});
      const {error}=await query;if(error)throw error;
      document.activeElement?.blur();await refresh();show('Teaching profile saved.');return;
    }
    if(kind==='profileVisibility'){
      if(!session||!me||!('profile_visibility' in me)||!['club','private'].includes(payload.profile_visibility))throw Error('Select a profile visibility option.');
      const {error}=await db.from('profiles').update({profile_visibility:payload.profile_visibility}).eq('id',session.user.id);
      if(error)throw error;
      me.profile_visibility=payload.profile_visibility;await refresh();show('Profile visibility saved.');return;
    }
    if(kind==='privacyRequest'){
      if(!session||!privacyReady)throw Error('Privacy request form is not ready.');
      const details=String(payload.details||'').trim();
      if(!['account_removal','content_removal'].includes(payload.request_type)||details.length>2000||payload.request_type==='content_removal'&&details.length<10)throw Error('Describe the content to remove in at least 10 characters.');
      if((cache.privacy_requests||[]).some(r=>r.requester_id===session.user.id&&r.request_type===payload.request_type&&['open','in_review'].includes(r.status)))throw Error('You already have an open request of this type. Follow its status below.');
      const {error}=await db.from('privacy_requests').insert({requester_id:session.user.id,request_type:payload.request_type,details});
      if(error)throw error;
      await refresh();if(!approved())await loadPrivacyRequests();show('Privacy request sent to administrators.');return;
    }
    if(kind==='privacyReview'){
      if(!admin()||!privacyReady)throw Error('Administrator access required.');
      const note=String(payload.note||'').trim();
      if(!['in_review','completed','declined'].includes(payload.decision)||note.length>2000||payload.decision!=='in_review'&&!note)throw Error('Explain the request outcome.');
      const {error}=await db.rpc('review_privacy_request',{p_request:payload.request_id,p_status:payload.decision,p_note:note});
      if(error)throw error;
      close();await refresh();show('Privacy request updated.');return;
    }
    if(kind==='courseContent'){
      if(!teacher()||!courseReady)throw Error('Teacher access and workshop data are required.');
      const course=(cache.courses||[]).find(c=>c.id===payload.course_id);
      if(!course||!admin()&&course.instructor_id!==session.user.id)throw Error('Only the assigned teacher may edit this workshop.');
      const title=String(payload.title||'').trim(),category=String(payload.category||''),level=String(payload.level||'');
      const build=String(payload.build_goal||'').trim(),practice=String(payload.practice_steps||'').trim(),tools=String(payload.tools||'').trim();
      const description=`Build: ${build}\n\nPractice: ${practice}\n\nTools: ${tools}`;
      const rawUrl=String(values.resource_url||'').trim();
      if(title.length<3||title.length>160||!build||!practice||!tools||description.length>5000||!courseTracks.some(t=>t.name===category)||!['Beginner','Intermediate','Advanced'].includes(level))throw Error('Enter a title, one of the four tracks, a level, the build goal, hands-on activities and required tools.');
      if(rawUrl&&(!payload.resource_url||payload.resource_url.length>1000))throw Error('Enter an HTTPS resource URL up to 1,000 characters.');
      const {error}=await db.rpc('update_course_content',{p_course:course.id,p_title:title,p_category:category,p_level:level,p_description:description,p_resource_url:payload.resource_url});
      if(error){if(['42883','PGRST202'].includes(error.code))throw Error('Run upgrade_course_classroom_access.sql to enable workshop editing.');throw error;}
      close();await refresh();show('Workshop plan updated.');return;
    }
    if(kind==='courseSchedule'){
      if(!teacher()||!courseReady||!coursePlanningReady)throw Error('Teacher access and the course planning migration are required.');
      const course=(cache.courses||[]).find(c=>c.id===payload.course_id);
      if(!course||!admin()&&course.instructor_id!==session.user.id)throw Error('Only the assigned teacher may update this workshop.');
      const start=payload.starts_at?new Date(payload.starts_at):null,due=payload.submission_due_at?new Date(payload.submission_due_at):null;
      if(start&&!Number.isFinite(start.getTime())||due&&!Number.isFinite(due.getTime())||due&&!start)throw Error('Choose a valid start date and project deadline.');
      if(start&&due&&due<=start)throw Error('Set the project deadline after the workshop start.');
      const {error}=await db.rpc('update_course_schedule',{p_course:course.id,p_starts_at:start?.toISOString()||null,p_due_at:due?.toISOString()||null});
      if(error)throw error;
      close();await refresh();show('Schedule saved. Enrolled students have been notified.');return;
    }
    if(kind==='courseLearner'){
      if(!teacher()||!courseReady||!coursePlanningReady)throw Error('Teacher access and the course planning migration are required.');
      const course=(cache.courses||[]).find(c=>c.id===payload.course_id);
      if(!course||!admin()&&course.instructor_id!==session.user.id)throw Error('Only the assigned teacher may enroll a member.');
      const email=String(payload.email||'').trim().toLowerCase();
      if(!email||email.length>320||!email.includes('@'))throw Error('Enter the member’s sign-in email.');
      const {error}=await db.rpc('assign_course_learner',{p_course:course.id,p_email:email});
      if(error)throw error;
      close();await refresh();show('Member added to the workshop and notified.');return;
    }
    if(kind==='courseUnassign'){
      if(!teacher()||!courseReady||!coursePlanningReady)throw Error('Teacher access and the course planning migration are required.');
      const course=(cache.courses||[]).find(c=>c.id===payload.course_id);
      if(!course||!admin()&&course.instructor_id!==session.user.id)throw Error('Only the assigned teacher may remove a member.');
      const {error}=await db.rpc('unassign_course_learner',{p_course:course.id,p_learner:String(payload.learner_id||'')});
      if(error)throw error;
      close();await refresh();show('Student removed from the workshop and notified.');return;
    }
    if(kind==='courseSubmission'){
      if(!clubAccess()||!courseReady)throw Error('Course enrollment is required before submitting.');
      const courseId=String(payload.course_id||''),enrollment=(cache.course_enrollments||[]).find(e=>e.course_id===courseId&&e.learner_id===session.user.id&&e.status==='enrolled');
      if(!enrollment)throw Error('You must be enrolled in this workshop.');
      const details=String(payload.details||'').trim(),evidenceUrl=String(payload.evidence_url||'').trim();
      if(details.length<20||details.length>5000)throw Error('Write at least 20 characters about your build and tests.');
      const url=evidenceUrl?cleanUrl(evidenceUrl):null;
      if(evidenceUrl&&!url)throw Error('Enter an HTTPS project URL.');
      const file=formEl.querySelector('[name=course_file]')?.files?.[0];
      const ext={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file?.type];
      if(file?.size&&(!ext||file.size>10485760))throw Error('Choose a PDF, JPG, PNG or WebP evidence file up to 10 MB.');
      const path=file?.size?`${session.user.id}/${courseId}/${crypto.randomUUID()}.${ext}`:null;
      try{
        if(path){const {error}=await db.storage.from('club-course-evidence').upload(path,file,{upsert:false,contentType:file.type});if(error)throw error;}
        const {error}=await db.from('course_submissions').insert({course_id:courseId,learner_id:session.user.id,details,evidence_url:url,evidence_path:path,evidence_name:path?file.name.slice(0,240):null});
        if(error)throw error;
      }catch(error){if(path){const removed=await db.storage.from('club-course-evidence').remove([path]);if(removed.error)console.error(removed.error);}throw error;}
      close();await refresh();show('Project sent to your teacher for review.');return;
    }
    if(kind==='courseReview'){
      if(!teacher()||!courseReady)throw Error('Teacher access is required.');
      const submissionId=String(payload.submission_id||''),decision=String(payload.decision||''),feedback=String(payload.feedback||'').trim();
      if(!['accepted','revision_requested'].includes(decision)||feedback.length<5||feedback.length>3000)throw Error('Choose a decision and write useful feedback.');
      const {error}=await db.rpc('review_course_submission',{p_submission:submissionId,p_decision:decision,p_feedback:feedback});if(error)throw error;
      close();await refresh();show(decision==='accepted'?'Project accepted. Completion recorded.':'Revision request sent to the learner.');return;
    }
    if(kind==='courseInstructor'){
      if(!admin()||!courseReady)throw Error('Administrator access is required.');
      const {error}=await db.rpc('assign_course_instructor',{p_course:String(payload.course_id||''),p_teacher:String(payload.teacher_id||'')});if(error)throw error;
      close();await refresh();show('Workshop teacher assigned.');return;
    }
    if(kind==='inventoryQuantity'){
      if(!admin()||!inventoryCatalogReady)throw Error('Administrator access and the stock catalog migration are required.');
      const item=(cache.inventory_items||[]).find(x=>x.id===payload.item_id);
      if(!item)throw Error('Choose an inventory item.');
      const quantity=Number(payload.target_available),expectedTotal=Number(payload.expected_total),expectedAvailable=Number(payload.expected_available),checkedOut=expectedTotal-expectedAvailable;
      const note=String(payload.note||'').trim();
      if(!Number.isInteger(expectedTotal)||!Number.isInteger(expectedAvailable)||expectedAvailable<0||checkedOut<0)throw Error('Refresh inventory and try again.');
      if(!Number.isInteger(quantity)||quantity<0||quantity+checkedOut>2147483647)throw Error('Enter a valid whole-number quantity in stock.');
      if(quantity===expectedAvailable)throw Error('Enter a different in-stock quantity.');
      if(!note||note.length>2000)throw Error('Explain this quantity change.');
      const {error}=await db.rpc('set_inventory_available_quantity',{p_item:item.id,p_target_available:quantity,p_expected_total:expectedTotal,p_expected_available:expectedAvailable,p_note:note});
      if(error)throw error;
      close();await refresh();show('Quantity updated and recorded in stock history.');return;
    }
    if(kind==='inventoryUnit'){
      if(!admin()||!inventoryCatalogReady)throw Error('Administrator access and the stock catalog migration are required.');
      const item=(cache.inventory_items||[]).find(x=>x.id===payload.item_id);
      if(!item)throw Error('Choose an inventory item.');
      const unit=String(payload.new_unit||'').trim(),expectedUnit=String(payload.expected_unit||'');
      const quantity=Number(payload.new_quantity),reorder=Number(payload.new_reorder_level);
      const expectedTotal=Number(payload.expected_total),expectedAvailable=Number(payload.expected_available),expectedReorder=Number(payload.expected_reorder_level);
      const note=String(payload.note||'').trim();
      if(!unit||unit.length>30||unit===expectedUnit)throw Error('Enter a different measurement unit, up to 30 characters.');
      if(![quantity,reorder,expectedTotal,expectedAvailable,expectedReorder].every(n=>Number.isInteger(n)&&n>=0&&n<=2147483647))throw Error('Enter valid whole-number stock and reorder amounts.');
      if(expectedTotal!==expectedAvailable)throw Error('Return checked-out items before changing the unit.');
      if(!note||note.length>2000)throw Error('Explain the unit change and stock recount.');
      const {error}=await db.rpc('change_inventory_unit',{p_item:item.id,p_new_unit:unit,p_new_quantity:quantity,p_new_reorder_level:reorder,p_expected_unit:expectedUnit,p_expected_total:expectedTotal,p_expected_available:expectedAvailable,p_expected_reorder_level:expectedReorder,p_note:note});
      if(error?.code==='PGRST202')throw Error('The unit change is not available in Supabase yet. Check that its migration ran successfully, then refresh and retry.');
      if(error)throw error;
      close();await refresh();show('Measurement unit and stock count updated in history.');return;
    }
    if(kind==='inventoryItem'){
      if(!admin()||!inventoryCatalogReady)throw Error('Administrator access and the stock catalog migration are required.');
      const count=Number(payload.quantity_total),reorder=Number(payload.reorder_level);
      if(!Number.isInteger(count)||count<0||count>2147483647||!Number.isInteger(reorder)||reorder<0||reorder>2147483647)throw Error('Enter valid stock and low-stock quantities.');
      const name=String(payload.name||'').trim(),category=String(payload.category||'').trim(),unit=String(payload.unit||'').trim();
      if(name.length<2||name.length>160||category.length<2||category.length>80)throw Error('Enter an item name and category.');
      if(unit.length<1||unit.length>30)throw Error('Enter a unit such as pcs, metres or rolls.');
      if(!['component','tool','equipment','consumable','other'].includes(payload.item_type))throw Error('Choose an item type.');
      if(!['good','needs_repair','retired'].includes(payload.condition))throw Error('Choose a valid item condition.');
      return await mutate(()=>db.from('inventory_items').insert({name,category,item_type:payload.item_type,unit,reorder_level:reorder,quantity_total:count,quantity_available:count,condition:payload.condition,location:String(payload.location||'').trim(),serial_number:String(payload.serial_number||'').trim()||null}));
    }
    if(kind==='inventoryMovement'){
      if(!admin()||!inventoryCatalogReady)throw Error('Administrator access and the stock catalog migration are required.');
      if(!(cache.inventory_items||[]).some(x=>x.id===payload.item_id))throw Error('Choose an inventory item.');
      const quantity=Number(payload.quantity),movement=payload.movement_kind;
      if(!Number.isInteger(quantity)||quantity<1||quantity>2147483647)throw Error('Enter a positive whole number of units.');
      if(!['check_out','return','add_stock','remove_stock','issue_stock'].includes(movement))throw Error('Choose a valid movement.');
      const member=['check_out','return','issue_stock'].includes(movement)?payload.member_id||null:null;
      if(['check_out','return','issue_stock'].includes(movement)&&!member)throw Error('Choose the member receiving or returning this item.');
      const note=String(payload.note||'').trim();if(!note||note.length>2000)throw Error('Explain the movement in the reason field.');
      return await mutate(()=>db.rpc('record_inventory_movement',{p_item:payload.item_id,p_kind:movement,p_quantity:quantity,p_member:member,p_note:note}));
    }
    if(kind==='inventoryDetails'){
      if(!admin()||!inventoryCatalogReady)throw Error('Administrator access and the stock catalog migration are required.');
      if(!(cache.inventory_items||[]).some(x=>x.id===payload.item_id))throw Error('Choose an inventory item.');
      const name=String(payload.name||'').trim(),category=String(payload.category||'').trim(),unit=String(payload.unit||'').trim(),note=String(payload.note||'').trim(),reorder=Number(payload.reorder_level);
      if(name.length<2||name.length>160||category.length<2||category.length>80||!note||note.length>2000)throw Error('Enter an item name, category and reason for the change.');
      if(!['component','tool','equipment','consumable','other'].includes(payload.item_type)||unit.length<1||unit.length>30||!Number.isInteger(reorder)||reorder<0||reorder>2147483647)throw Error('Choose a valid type, unit and low-stock level.');
      if(!['good','needs_repair','retired'].includes(payload.condition))throw Error('Choose a valid item condition.');
      return await mutate(()=>db.rpc('update_inventory_item_catalog',{p_item:payload.item_id,p_name:name,p_category:category,p_item_type:payload.item_type,p_unit:unit,p_reorder_level:reorder,p_condition:payload.condition,p_location:String(payload.location||'').trim(),p_serial_number:String(payload.serial_number||'').trim()||null,p_note:note}));
    }
    if(kind==='financeReview'){
      if(!founderOnly()||!financeApprovalsReady)throw Error('Approved founder access and the finance review migration are required.');
      const entry=(cache.finance_entries||[]).find(x=>x.id===payload.entry_id),note=String(payload.note||'').trim();
      if(!entry||financeStatus(entry)!=='pending'||!['approved','rejected'].includes(payload.decision))throw Error('This transaction is no longer pending review.');
      if(payload.decision==='rejected'&&!note)throw Error('Explain why this transaction is rejected.');
      const {error}=await db.rpc('review_finance_entry',{p_entry:entry.id,p_decision:payload.decision,p_note:note});
      if(error)throw error;
      close();await refresh();show(`Transaction ${payload.decision}.`);return;
    }
    if(kind==='financeEntry'){
      if(!admin()||!financeApprovalsReady)throw Error('Administrator access and the finance review migration are required.');
      if(!['income','expense'].includes(payload.entry_type))throw Error('Choose income or expense.');
      const amount=Number(payload.amount),description=String(payload.description||'').trim();
      if(!Number.isFinite(amount)||amount<=0||amount>9999999999.99||Math.abs(amount*100-Math.round(amount*100))>0.000001)throw Error('Enter a positive amount with no more than two decimal places.');
      if(!description||description.length>2000)throw Error('Explain this transaction.');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.occurred_on)||Number.isNaN(Date.parse(`${payload.occurred_on}T12:00:00Z`)))throw Error('Choose a valid transaction date.');
      const record={entry_type:payload.entry_type,category:String(payload.category||'').trim(),amount:amount.toFixed(2),occurred_on:payload.occurred_on,description,counterparty:String(payload.counterparty||'').trim(),reference:String(payload.reference||'').trim()};
      const {error}=await db.from('finance_entries').insert(record);if(error)throw error;
      close();await refresh();show('Transaction submitted for founder review.');return;
    }
    if(kind==='application'){
      if('application_type' in payload){
        if(!['member','teacher','founder','investor'].includes(payload.application_type))throw Error('Choose a valid account type.');
        const {error:typeError}=await db.rpc('set_application_type',{p_type:payload.application_type});if(typeError)throw typeError;
        me.application_type=payload.application_type;delete payload.application_type;
      }
      const reason=String(payload.application_reason||'').trim();
      if(applicationAnswersReady)delete payload.application_reason;
      const {error}=await db.from('profiles').update(payload).eq('id',session.user.id);if(error)throw error;
      if(applicationAnswersReady){
        const answer=await db.from('application_answers').upsert({user_id:session.user.id,reason},{onConflict:'user_id'});
        if(answer.error)throw answer.error;
      }
      me={...me,...payload,application_reason:reason};close();render();show('Application saved for review.');return;
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
      if(payload.course_id&&!(cache.courses||[]).some(c=>c.id===payload.course_id&&(admin()||c.instructor_id===session.user.id)))throw Error('Choose one of your assigned workshops.');
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
      const parent=channelHistoryRows.find(m=>m.id===activeThreadId)||(cache.channel_messages||[]).find(m=>m.id===activeThreadId);if(!parent)throw Error('Thread not found.');
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
    if(kind==='founder'||kind==='founderEdit'){
      if(!admin())throw Error('Only an administrator can publish founder profiles.');
      const file=formEl.querySelector('[name=portrait_file]')?.files?.[0];
      const ext=file&&{'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
      if(file&&(!founderPortraitReady||!ext||file.size<1||file.size>5242880))throw Error('Choose a JPG, PNG or WebP portrait up to 5 MB after setting up founder portraits.');
      if(file&&payload.remove_portrait)throw Error('Choose either a replacement portrait or removal.');
      if(formEl.elements.link_url.value&&!payload.link_url)throw Error('Enter a valid HTTPS profile URL.');
      const fields={name:String(payload.name).trim(),role:String(payload.role).trim(),bio:String(payload.bio).trim(),link_url:payload.link_url||null,sort_order:Number(payload.sort_order)||1};
      const existing=kind==='founderEdit'?(cache.founders||[]).find(f=>f.id===payload.card_id):null;
      if(kind==='founderEdit'&&(!founderPortraitReady||!existing))throw Error('Refresh the founder profiles and try again.');
      let id=existing?.id||'',uploaded='',created=false,oldPath=existing?.portrait_path||'';
      try{
        if(!existing){
          const {data,error}=await db.from('founders').insert(fields).select('id').single();
          if(error)throw error;
          id=data.id;created=true;
        }
        if(file){
          uploaded=`${id}/${crypto.randomUUID()}.${ext}`;
          const {error}=await db.storage.from('club-founder-portraits').upload(uploaded,file,{upsert:false,contentType:file.type});
          if(error)throw error;
        }
        if(existing||uploaded){
          if(uploaded||payload.remove_portrait)fields.portrait_path=uploaded||null;
          const {error}=await db.from('founders').update(fields).eq('id',id).select('id').single();
          if(error)throw error;
        }
      }catch(error){
        if(uploaded){const cleanup=await db.storage.from('club-founder-portraits').remove([uploaded]);if(cleanup.error)console.error('Portrait cleanup',cleanup.error);}
        if(created){const cleanup=await db.from('founders').delete().eq('id',id);if(cleanup.error)console.error('Founder rollback',cleanup.error);}
        throw error;
      }
      let cleanupFailed=false;
      if(oldPath&&(uploaded||payload.remove_portrait)){
        const {error}=await db.storage.from('club-founder-portraits').remove([oldPath]);
        if(error){console.error('Old founder portrait cleanup',error);cleanupFailed=true;}
      }
      close();await refresh();show(cleanupFailed?'Profile saved. Remove the old portrait from Storage manually.':'Founder profile saved.');return;
    }
    if(kind==='course'||kind==='event'||kind==='announcement'){
      if(kind==='course'){
        if(!teacher())throw Error('Only approved teachers and administrators can publish courses.');
        if(!courseTracks.some(t=>t.name===payload.category))throw Error('Choose one of the four learning tracks.');
        payload.description=`Build: ${String(payload.build_goal).trim()}\n\nPractice: ${String(payload.practice_steps).trim()}\n\nTools: ${String(payload.tools).trim()}`;
        delete payload.build_goal;delete payload.practice_steps;delete payload.tools;
        if(payload.starts_at){
          const start=new Date(payload.starts_at);
          if(!Number.isFinite(start.getTime()))throw Error('Choose a valid workshop start date.');
          payload.starts_at=start.toISOString();
        }else payload.starts_at=null;
        if(coursePlanningReady){
          if(payload.submission_due_at){
            const due=new Date(payload.submission_due_at);
            if(!Number.isFinite(due.getTime())||!payload.starts_at||due<=new Date(payload.starts_at))throw Error('Set the project deadline after the workshop start.');
            payload.submission_due_at=due.toISOString();
          }else payload.submission_due_at=null;
        }else delete payload.submission_due_at;
        payload.resource_url=payload.resource_url?cleanUrl(payload.resource_url):null;
        if(formEl.querySelector('[name=resource_url]').value&&!payload.resource_url)throw Error('Enter a valid HTTPS resource URL.');
        courseTrack=payload.category;
      }else if(!admin())throw Error('Only an administrator can publish this item.');
      if(kind==='event'&&new Date(payload.ends_at)<=new Date(payload.starts_at))throw Error('End time must be after start time.');
      const table={course:'courses',event:'events',announcement:'announcements'}[kind];
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
