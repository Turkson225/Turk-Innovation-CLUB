/* SPACE private member ID. The optional 3D renderer adapts the supplied React Bits Lanyard. */
(() => {
 'use strict';
 let engineModule=null;
 const loadEngine=()=>engineModule||(engineModule=import('./member-id-lanyard.js?v=space-member-id-20261017').catch(error=>{engineModule=null;throw error;}));
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function drawCard(canvas,data,back=false,photo=null){
  const c=canvas.getContext('2d');if(!c)return false;
  canvas.width=768;canvas.height=1080;c.fillStyle=back?'#242039':'#fbfaff';c.fillRect(0,0,768,1080);
  c.fillStyle=back?'#43336a':'#eee8fb';c.fillRect(0,0,768,210);c.fillStyle='#f09a50';c.fillRect(0,210,768,8);
  const text=(value,x,y,size,color='#242039',weight=600)=>{c.font=`${weight} ${size}px sans-serif`;c.fillStyle=color;c.fillText(String(value),x,y);};
  text('space',64,133,72,back?'#f5f0ff':'#30204d',800);text('TURK INNOVATION CLUB',66,179,19,back?'#ded2f5':'#655478',700);
  const wrap=(value,x,y,width,size,line=44,max=4,color='#242039')=>{
   c.font=`600 ${size}px sans-serif`;const words=String(value).split(/\s+/);let row='',rows=[];
   for(const word of words){const next=row?row+' '+word:word;if(row&&c.measureText(next).width>width){rows.push(row);row=word;}else row=next;}if(row)rows.push(row);
   rows.slice(0,max).forEach((v,i)=>text(v,x,y+i*line,size,color));
  };
  if(back){
   text(data.trackLabel.toUpperCase(),64,285,22,'#f8b274',700);
   if(data.tracks.length)data.tracks.forEach((t,i)=>{text(String(i+1).padStart(2,'0'),64,355+i*94,22,'#bca8e5');wrap(t,119,355+i*94,565,28,35,2,'#f4efff');});
   else wrap('Your learning journey starts in My learning.',64,367,640,32,46,3,'#f4efff');
   text('PROFILE REFERENCE',64,817,19,'#baa9d4');
   const id=String(data.id);text(id.slice(0,18),64,860,25,'#f4efff');text(id.slice(18),64,895,25,'#f4efff');
   text('Learn. Build. Share.',64,1001,31,'#f8b274',700);
  }else{
   c.save();c.beginPath();c.arc(384,344,104,0,Math.PI*2);c.clip();c.fillStyle='#ded4f1';c.fillRect(280,240,208,208);
   if(photo){const side=Math.min(photo.naturalWidth||photo.width,photo.naturalHeight||photo.height);c.drawImage(photo,((photo.naturalWidth||photo.width)-side)/2,((photo.naturalHeight||photo.height)-side)/2,side,side,280,240,208,208);}
   else {c.font='700 69px sans-serif';c.fillStyle='#503777';c.textAlign='center';c.fillText(data.initials,384,368);c.textAlign='left';}c.restore();
   wrap(data.name,64,530,640,48,61,3);text(data.role.toUpperCase(),64,751,26,'#6b459a',700);
   if(data.handle)text('@'+data.handle,64,806,26,'#655478');
   text('JOINED SPACE',64,892,18,'#796b8d',700);text(data.joined,64,936,31,'#30204d');
   c.fillStyle='#30204d';c.fillRect(0,982,768,98);text('MEMBER ID',64,1041,25,'#f7eeff',700);text('SPACE',595,1041,22,'#f8b274',700);
  }
  return true;
 }
 function create(ctx){
  let active=null;
  const state=()=>ctx.get(),key=s=>`${s.id}:${s.generation}`;
  const allowed=s=>!!s.id&&s.approved&&s.profile?.id===s.id;
  function reset(){if(active){const old=active;active=null;old.dispose();}}
  function check(){if(active&&!active.current()){const old=active,close=old.root.isConnected&&old.dialog.open;reset();if(close)ctx.close();}}
  function open(){
   const s=state();if(!allowed(s))return false;
   reset();
   const p=s.profile,role={admin:'Administrator',founder:'Founder',teacher:'Teacher',investor:'Investor',member:'Member'}[p.role]||'Member';
   const date=new Date(p.created_at),data={id:s.id,name:p.full_name||'SPACE member',role:s.teacher&&p.role==='founder'?'Founder · Teaching lead':role,handle:p.handle||'',joined:Number.isFinite(date.getTime())?date.toLocaleDateString(undefined,{month:'short',year:'numeric'}):'Not recorded',tracks:(s.tracks||[]).slice(0,4).map(String),trackLabel:s.teacher?'Teaching tracks':'Learning tracks'};
   data.initials=data.name.trim().split(/\s+/).slice(0,2).map(v=>Array.from(v)[0]||'').join('').toLocaleUpperCase();
   ctx.modal(`<section class="member-id-modal" data-member-id-view><span class="eyebrow">YOUR SPACE</span><h2>My member ID</h2><div class="mid-stage"><div class="mid-strap" aria-hidden="true"><span>SPACE</span></div><div class="mid-flat" data-id-flat aria-hidden="true"></div><div class="mid-canvas" data-id-canvas aria-hidden="true"></div></div><div class="mid-controls"><button class="button button-outline button-sm" type="button" data-id-flip>Flip card</button><button class="button button-outline button-sm" type="button" data-id-mode>3D lanyard</button><button class="button button-outline button-sm" type="button" data-id-motion hidden aria-pressed="false">Pause motion</button></div><p class="mid-status" data-id-status role="status" aria-live="polite">Your card is ready.</p><div class="mid-owner"><strong>${escape(data.name)}</strong><span>${escape(data.role)} · Joined ${escape(data.joined)}</span></div><p class="mid-track-text" data-id-tracks hidden>${escape(data.trackLabel)}: ${escape(data.tracks.join(' · ')||'Choose your tracks in My learning.')}</p><details class="mid-reference"><summary>Profile reference</summary><code>${escape(data.id)}</code></details></section>`);
   const root=document.querySelector('[data-member-id-view]'),dialog=root?.closest('dialog');if(!root||!dialog)return false;
   dialog.classList.add('member-id-dialog');
   const flat=root.querySelector('[data-id-flat]'),canvasHost=root.querySelector('[data-id-canvas]'),mode=root.querySelector('[data-id-mode]'),motion=root.querySelector('[data-id-motion]'),status=root.querySelector('[data-id-status]'),tracks=root.querySelector('[data-id-tracks]'),front=document.createElement('canvas'),back=document.createElement('canvas'),strap=document.createElement('canvas');
   front.setAttribute('aria-hidden','true');back.setAttribute('aria-hidden','true');back.hidden=true;flat.append(front,back);drawCard(front,data);drawCard(back,data,true);
   strap.width=384;strap.height=128;const band=strap.getContext('2d');if(band){band.fillStyle='#30204d';band.fillRect(0,0,384,128);band.fillStyle='#faf4ff';band.font='700 54px sans-serif';band.fillText('SPACE',72,85);}
   let renderer=null,dead=false,loading=false,request=0,backSide=false,paused=false,visible=true,suspended=false,image=null;
   const listeners=[],observers=[],owner=key(s),originPage=s.page,reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)'),connection=navigator.connection;
   const current=()=>!dead&&active?.root===root&&root.isConnected&&dialog.open&&allowed(state())&&key(state())===owner&&state().page===originPage;
   const blocked=()=>document.hidden||suspended||!visible||!!document.querySelector('dialog[open]:not(#modal)')||document.documentElement.classList.contains('mobile-menu-open');
   const listen=(node,type,fn,settings)=>{if(node?.addEventListener){node.addEventListener(type,fn,settings);listeners.push(()=>node.removeEventListener(type,fn,settings));}};
   function gate(){if(!current()){check();return;}renderer?.setActive(!paused&&!blocked());}
   function face(value){if(!current())return;backSide=!!value;front.hidden=backSide;back.hidden=!backSide;tracks.hidden=!backSide;root.classList.toggle('is-id-back',backSide);status.textContent=backSide?'Back of your member ID.':'Front of your member ID.';}
   function still(){request++;loading=false;renderer?.dispose();renderer=null;root.classList.remove('is-id-3d');flat.hidden=false;motion.hidden=true;mode.textContent='3D lanyard';}
   async function three(){
    if(!current())return;
    if(renderer||loading){still();status.textContent='Still view. Use Flip card to view both sides.';return;}
    const token=++request;loading=true;mode.textContent='Use still view';status.textContent='Opening the interactive lanyard…';
    try{
     const module=await (ctx.loadEngine?ctx.loadEngine():loadEngine());
     if(!current()||request!==token)return;
     renderer=module.mount(canvasHost,{frontCanvas:front,backCanvas:back,strapCanvas:strap,phone:!!window.matchMedia?.('(max-width: 760px)').matches,isCurrent:current,onFlip:face,onError:()=>{if(current()){still();status.textContent='3D is unavailable. Your still card is ready.';}}});
     if(!current()||request!==token){renderer?.dispose();renderer=null;return;}
     loading=false;paused=false;root.classList.add('is-id-3d');flat.hidden=true;mode.textContent='Still view';motion.hidden=false;motion.textContent='Pause motion';motion.setAttribute('aria-pressed','false');renderer.setSide(backSide);gate();renderer.swing();status.textContent='Drag to move your card. Tap or use Flip card to turn it.';
    }catch{if(current()&&request===token){still();status.textContent='3D is unavailable. Your still card is ready.';}}
   }
   function click(event){const button=event.target?.closest?.('[data-id-flip],[data-id-mode],[data-id-motion]');if(!current()||!button||!root.contains(button))return;
    if(button.hasAttribute('data-id-flip')){face(!backSide);renderer?.setSide(backSide);}
    else if(button===mode)void three();
    else if(button===motion){paused=!paused;motion.textContent=paused?'Resume motion':'Pause motion';motion.setAttribute('aria-pressed',String(paused));gate();}
   }
   function device(){if(current()&&(reduce?.matches||connection?.saveData)){still();status.textContent='Still view is selected. You can enable the 3D lanyard.';}}
   listen(root,'click',click);listen(dialog,'close',()=>{if(active?.root===root&&(!dialog.open||!root.isConnected))reset();});listen(window,'hashchange',check);listen(document,'visibilitychange',gate);
   listen(window,'pagehide',()=>{suspended=true;gate();});listen(window,'pageshow',()=>{suspended=false;gate();});
   if(reduce?.addEventListener)listen(reduce,'change',device);else if(reduce?.addListener){reduce.addListener(device);listeners.push(()=>reduce.removeListener(device));}listen(connection,'change',device);
   if(window.IntersectionObserver){const observer=new window.IntersectionObserver(entries=>{if(!current())return;visible=entries.some(e=>e.target===root&&e.isIntersecting);gate();});observer.observe(root);observers.push(observer);}
   if(window.MutationObserver){const observer=new window.MutationObserver(gate);observer.observe(dialog,{attributes:true,attributeFilter:['open']});observer.observe(document.querySelector('#modalContent'),{childList:true});observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});for(const other of document.querySelectorAll('dialog'))if(other!==dialog)observer.observe(other,{attributes:true,attributeFilter:['open']});observers.push(observer);}
   active={root,dialog,current,dispose(){dead=true;request++;renderer?.dispose();renderer=null;listeners.forEach(off=>off());observers.forEach(o=>o.disconnect());if(image){image.onload=null;image.onerror=null;image.src='';}for(const c of [front,back,strap]){c.width=1;c.height=1;}root.replaceChildren();dialog.classList.remove('member-id-dialog');}};
   Promise.resolve().then(()=>ctx.photo?.()).then(url=>{
    if(!url||!current())return;image=new Image();image.crossOrigin='anonymous';image.decoding='async';image.onload=()=>{if(current()){drawCard(front,data,false,image);renderer?.refresh();}};image.onerror=()=>{};image.src=url;
   }).catch(()=>{});
   if(!reduce?.matches&&!connection?.saveData)void three();else device();
   return true;
  }
  return {open,reset,check};
 }
 window.SpaceMemberID=Object.freeze({create,drawCard});
})();
