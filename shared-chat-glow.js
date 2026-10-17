/* SPACE shared glow: lightweight Canvas2D interpretation of the supplied React Bits
 * GlowCursor reference. Deliberate, ephemeral strokes; no ambient cursor tracking.
 * Private Supabase Broadcast only. No drawing is written to messages or Storage. */
(() => {
'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN=/^[a-zA-Z0-9_-]{1,40}$/;
const COLORS=['#78a7ff','#ffb35c','#e78aff','#62e3c2'];
const id=()=>crypto.randomUUID().replaceAll('-','');
function topicFor(a,b,minute){return `space-glow:${[a,b].sort().join(':')}:${minute}`;}
function validRoom(data,a,b){
 return data&&UUID.test(a)&&UUID.test(b)&&a!==b&&Number.isSafeInteger(data.minute)&&data.minute>0&&data.topic===topicFor(a,b,data.minute)&&Number.isFinite(data.lease_ms)&&data.lease_ms>0&&data.lease_ms<=60000;
}
function packet(data,peer){
 if(!data||data.v!==1||data.from!==peer||(typeof data.sid!=='string'||!TOKEN.test(data.sid))||!Number.isSafeInteger(data.seq)||data.seq<1)return null;
 if(data.kind==='state')return typeof data.want==='boolean'?data:null;
 if(data.kind==='decline'||data.kind==='clear')return data;
 if(data.kind!=='stroke'||(typeof data.stroke!=='string'||!TOKEN.test(data.stroke))||!Number.isInteger(data.color)||data.color<0||data.color>=COLORS.length||typeof data.burst!=='boolean'||!Array.isArray(data.points)||!data.points.length||data.points.length>12)return null;
 if(!data.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1)))return null;
 return data;
}
function createBoard(onPoint){
 const canvas=document.createElement('canvas'),pad=document.createElement('div');
 canvas.className='shared-glow-canvas';canvas.setAttribute('aria-hidden','true');
 pad.className='shared-glow-pad';pad.setAttribute('aria-hidden','true');
 const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)throw Error('Canvas unavailable');
 let host=null,raf=0,last=0,expiry=0,segments=[],tails=new Map(),pointer=null,mode=false,dead=false;
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 const small=()=>window.matchMedia?.('(max-width: 740px)').matches;
 const quiet=()=>!!(reduced?.matches||navigator.connection?.saveData);
 function square(){const w=host?.clientWidth||1,h=host?.clientHeight||1,s=Math.min(w,h);return {w,h,s,x:(w-s)/2,y:(h-s)/2};}
 function draw(){
  const box=square(),cap=small()?120000:250000,scale=Math.min(window.devicePixelRatio||1,Math.sqrt(cap/(box.w*box.h))),w=Math.max(1,Math.floor(box.w*scale)),h=Math.max(1,Math.floor(box.h*scale));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,box.w,box.h);
  const now=Date.now(),life=quiet()?1400:5500;
  segments=segments.filter(s=>now-s.time<life);
  for(const s of segments){
   const alpha=quiet()?1:Math.pow(1-(now-s.time)/life,1.5),a=s.a,b=s.b;
   ctx.globalAlpha=alpha;ctx.strokeStyle=COLORS[s.color];ctx.fillStyle=COLORS[s.color];ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor=COLORS[s.color];ctx.shadowBlur=15;
   const x=box.x+b[0]*box.s,y=box.y+b[1]*box.s;
   ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(box.x+a[0]*box.s,box.y+a[1]*box.s);ctx.lineTo(x,y);ctx.stroke();
   ctx.beginPath();ctx.arc(x,y,s.burst?7:2,0,Math.PI*2);ctx.fill();
   if(s.burst&&!quiet()){ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,8+(1-alpha)*20,0,Math.PI*2);ctx.stroke();}
  }
  ctx.globalAlpha=1;ctx.shadowBlur=0;
  clearTimeout(expiry);if(quiet()&&segments.length)expiry=setTimeout(wake,1450);
 }
 function frame(now){raf=0;if(dead||!host?.isConnected||document.hidden)return;if(now-last>=1000/(small()?18:24)||!last){last=now;draw();}if(segments.length&&!quiet())raf=requestAnimationFrame(frame);}
 function wake(){if(!dead&&!raf&&host?.isConnected&&!document.hidden)raf=requestAnimationFrame(frame);}
 function add(data,key){
  const now=Date.now(),tailKey=key+':'+data.stroke,tail=tails.get(tailKey);let previous=tail&&now-tail.time<1500?tail.point:data.points[0],first=true;
  for(const point of data.points){segments.push({a:previous,b:point,time:now,color:data.color,burst:data.burst&&first});previous=point;first=false;}
  tails.delete(tailKey);tails.set(tailKey,{point:previous,time:now});while(tails.size>32)tails.delete(tails.keys().next().value);
  if(segments.length>360)segments=segments.slice(-360);wake();
 }
 function stop(){if(pointer!==null)try{pad.releasePointerCapture(pointer);}catch{}pointer=null;}
 function coordinate(event){const rect=pad.getBoundingClientRect(),box=square(),x=(event.clientX-rect.left-box.x)/box.s,y=(event.clientY-rect.top-box.y)/box.s;return x>=0&&x<=1&&y>=0&&y<=1?[x,y]:null;}
 pad.addEventListener('pointerdown',event=>{if(!mode||pointer!==null||event.button!==0)return;const point=coordinate(event);if(!point)return;event.preventDefault();pointer=event.pointerId;try{pad.setPointerCapture(pointer);}catch{}onPoint('start',point);});
 pad.addEventListener('pointermove',event=>{if(pointer!==event.pointerId||!mode)return;const point=coordinate(event);if(point){event.preventDefault();onPoint('move',point);}});
 for(const name of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(name,event=>{if(pointer===event.pointerId){stop();onPoint('end',null);}});
 const resize=typeof ResizeObserver==='function'?new ResizeObserver(()=>wake()):null;
 return {add,mode(value){mode=value;pad.hidden=!mode;if(!mode)stop();host?.classList.toggle('shared-glow-drawing',mode);},moveTo(next){if(host!==next){host?.classList.remove('shared-glow-drawing');resize?.disconnect();host=next;host.prepend(canvas);host.append(pad);resize?.observe(host);}host.classList.add('shared-glow-ready');host.classList.toggle('shared-glow-drawing',mode);wake();},clear(){segments=[];tails.clear();cancelAnimationFrame(raf);raf=0;clearTimeout(expiry);ctx.clearRect(0,0,canvas.width,canvas.height);},destroy(){dead=true;stop();this.clear();resize?.disconnect();host?.classList.remove('shared-glow-ready','shared-glow-drawing');canvas.width=canvas.height=1;canvas.remove();pad.remove();host=null;}};
}
function create({db,get}){
 let root=null,bar=null,host=null,owner='',peer='',generation=null,epoch=0,channel=null,connected=false,connecting=false,want=false,drawMode=false,remote=null,remoteAt=0,declinedSid='',sid='',seq=0,status='',missing=false,board=null;
 let leaseTimer=0,heartbeat=0,sendTimer=0,queued=[],stroke='',color=0,rateAt=0,rateCount=0,seen=new Map(),retired=new Set(),sending=false;
 const current=()=>{const s=get();return !!db&&!document.hidden&&s.allowed&&s.page==='messages'&&s.id===owner&&s.peer===peer&&s.generation===generation&&UUID.test(owner)&&UUID.test(peer)&&owner!==peer&&host?.isConnected;};
 const ready=()=>current()&&connected&&want&&remote?.want&&Date.now()-remoteAt<24000;
 const valid=e=>e===epoch&&current();
 function releaseBoard(){board?.destroy();board=null;window.SpaceChatWaves?.hold?.('shared-glow',false);}
 function update(){
  const live=ready();if(!live){drawMode=false;queued=[];clearTimeout(sendTimer);sendTimer=0;releaseBoard();}
  else if(!board)try{board=createBoard(point);board.moveTo(host);window.SpaceChatWaves?.hold?.('shared-glow',true);}catch{failure('Drawing is unavailable on this device. You can still chat.');return;}
  if(board){board.moveTo(host);board.mode(drawMode);}
  if(!bar)return;
  const invited=connected&&remote?.want&&!want;
  const text=status||(connecting?'Connecting privately…':live?(drawMode?'Draw inside the square. Your friend can see it live.':'Shared glow is on. Switch to Draw mode to sketch.'):invited?'Your friend invited you to draw together.':want?'Waiting for your friend to open this chat and join…':'Draw glowing trails together. They fade after a few seconds.');
  const label=bar.querySelector('[data-glow-status]');if(label.textContent!==text)label.textContent=text;
  const show=(action,visible)=>{const el=bar.querySelector(`[data-glow-action="${action}"]`);el.hidden=!visible;};
  show('invite',!want&&!invited&&!status);show('join',invited&&!status);show('decline',invited&&!status);show('mode',live);show('sparkle',live);show('clear',live);show('done',want);show('retry',!!status);
  const invite=bar.querySelector('[data-glow-action="invite"]');invite.disabled=connecting;
  const mode=bar.querySelector('[data-glow-action="mode"]');mode.textContent=drawMode?'Chat mode':'Draw mode';mode.setAttribute('aria-pressed',String(drawMode));
  const palette=bar.querySelector('[data-glow-palette]');palette.hidden=!live;
  for(const button of palette.querySelectorAll('button'))button.setAttribute('aria-pressed',String(Number(button.dataset.glowColor)===color));
  bar.classList.toggle('shared-glow-live',!!live);
 }
 function clearTimers(){clearTimeout(leaseTimer);clearInterval(heartbeat);clearTimeout(sendTimer);leaseTimer=heartbeat=sendTimer=0;queued=[];sending=false;}
 function closeChannel(){const old=channel;channel=null;connected=false;connecting=false;clearTimers();if(old)try{Promise.resolve(db.removeChannel(old)).catch(()=>{});}catch{}releaseBoard();}
 function reset(){epoch++;closeChannel();owner=peer='';generation=null;want=false;remote=null;remoteAt=0;declinedSid='';seen.clear();retired.clear();status='';missing=false;bar=host=root=null;}
 function failure(message,noMigration=false){epoch++;closeChannel();remote=null;want=false;status=message;missing=noMigration;update();}
 async function send(kind,extra={}){
  if(!current()||!connected||!channel)return false;
  const target=channel,e=epoch,payload={v:1,kind,from:owner,sid,seq:++seq,...extra};
  try{let timer;const result=await Promise.race([Promise.resolve(target.send({type:'broadcast',event:'glow-v1',payload})),new Promise(resolve=>{timer=setTimeout(()=>resolve('timed out'),6000);})]).finally(()=>clearTimeout(timer));if(!valid(e)||target!==channel)return false;if(result!=='ok'){failure('The drawing connection paused. Retry to reconnect.');return false;}return true;}catch{if(valid(e))failure('The drawing connection paused. Retry to reconnect.');return false;}
 }
 function state(){return send('state',{want});}
 function receive(message,e){
  if(!valid(e)||!connected)return;
  const p=packet(message?.payload,peer);if(!p||retired.has(p.sid))return;
  const now=Date.now();if(now-rateAt>=1000){rateAt=now;rateCount=0;}if(++rateCount>24)return;
  const prior=seen.get(p.sid)||0;if(p.seq<=prior)return;
  // Only state can introduce a session; strokes can never grant consent.
  if(p.kind!=='state'&&remote?.sid!==p.sid)return;
  seen.delete(p.sid);seen.set(p.sid,p.seq);while(seen.size>8)seen.delete(seen.keys().next().value);
  if(p.kind==='state'){
   if(p.sid===declinedSid&&p.want)return;
   // An idle second tab must not displace the friend already drawing here.
   if(remote?.sid!==p.sid&&ready())return;
   const wasLive=ready();
   const changed=remote?.sid!==p.sid||remote?.want!==p.want;
   if(remote?.sid!==p.sid){if(remote?.sid){retired.add(remote.sid);while(retired.size>8)retired.delete(retired.values().next().value);}board?.clear();queued=[];}
   remote={sid:p.sid,want:p.want};remoteAt=now;if(wasLive&&!p.want)want=false;update();
   if(changed)void state();return;
  }
  if(p.kind==='decline'){want=false;remote={sid:p.sid,want:false};board?.clear();update();void state();return;}
  if(!ready())return;
  if(p.kind==='clear'){board?.clear();return;}
  board?.add(p,'remote');
 }
 async function connect(){
  if(!current()||connecting||connected||missing)return;
  connecting=true;status='';remote=null;declinedSid='';seen.clear();retired.clear();sid=id();seq=0;const e=++epoch;update();
  const bounded=promise=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout')),6000);Promise.resolve(promise).then(v=>{clearTimeout(timer);resolve(v);},err=>{clearTimeout(timer);reject(err);});});
  try{
   await bounded(db.realtime.setAuth());if(!valid(e))return;
   const requested=Date.now(),result=await bounded(db.rpc('club_glow_room',{p_peer:peer}));if(!valid(e))return;
   if(result.error){const absent=result.error.code==='PGRST202'||/could not find.*club_glow_room/i.test(result.error.message||'');failure(absent?'Shared drawing needs the Supabase setup. Normal messages still work.':'Shared drawing is unavailable for this conversation. Try again later.',absent);return;}
   if(!validRoom(result.data,owner,peer))throw Error('Invalid drawing room');
   const lease=result.data.lease_ms-(Date.now()-requested);
   if(lease<900){connecting=false;leaseTimer=setTimeout(()=>{if(valid(e))void connect();},Math.max(100,lease+100));update();return;}
   const candidate=db.channel(result.data.topic,{config:{private:true,broadcast:{ack:true,self:false}}});channel=candidate;
   // Authorization is cached at join. Close before the server-minute lease ends,
   // then authorize again; never fall back to a public or unjoined HTTP broadcast.
   leaseTimer=setTimeout(()=>{if(!valid(e))return;epoch++;closeChannel();remote=null;update();void connect();},Math.max(1,lease-300));
   candidate.on('broadcast',{event:'glow-v1'},message=>receive(message,e)).subscribe(value=>{
    if(!valid(e)||candidate!==channel)return;
    if(value==='SUBSCRIBED'){connected=true;connecting=false;status='';void state();clearInterval(heartbeat);heartbeat=setInterval(()=>{if(!valid(e))return;if(remote&&Date.now()-remoteAt>=24000){remote=null;update();}if(want||remote?.want)void state();},8000);update();}
    else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(value))failure('The drawing connection paused. Retry to reconnect.');
   });
  }catch{if(valid(e))failure('Shared drawing could not connect. Check your connection and retry.');}
 }
 function flush(){
  sendTimer=0;if(!ready()){queued=[];return;}
  if(sending){schedule();return;}
  const item=queued.shift();if(!item)return;
  // Bound each packet and retain both ends when a fast pen produces many points.
  const points=item.points.length<=12?item.points:Array.from({length:12},(_,i)=>item.points[Math.round(i*(item.points.length-1)/11)]);
  const e=epoch;sending=true;void send('stroke',{stroke:item.stroke,color:item.color,burst:item.burst,points}).finally(()=>{if(e!==epoch)return;sending=false;if(queued.length)schedule();});
 }
 function schedule(){if(!sendTimer&&queued.length)sendTimer=setTimeout(flush,125);}
 function enqueue(point,burst=false,strokeId=stroke){
  if(!ready())return;
  const data={stroke:strokeId||id(),color,burst,points:[point]};board?.add(data,'local');
  const last=queued.at(-1);if(!burst&&last?.stroke===stroke&&last.color===color){last.points.push(point);if(last.points.length>48)last.points.splice(1,1);}else{queued.push(data);if(queued.length>4)queued.shift();}schedule();
 }
 function point(kind,coordinate){if(!ready()||!drawMode)return;if(kind==='start')stroke=id();if(coordinate)enqueue(coordinate,kind==='start');if(kind==='end')stroke='';}
 function action(name){
  if(!current())return;
  if(name==='retry'){missing=false;status='';void connect();return;}
  if(name==='invite'||name==='join'){if(!connected)return;want=true;drawMode=false;sid=id();seq=0;update();void state();return;}
  if(name==='decline'){void send('decline');declinedSid=remote?.sid||'';if(remote)remote={sid:remote.sid,want:false};update();return;}
  if(name==='done'){want=false;drawMode=false;remote=null;board?.clear();void state();update();return;}
  if(!ready())return;
  if(name==='mode'){drawMode=!drawMode;update();}
  if(name==='sparkle')enqueue([.25+Math.random()*.5,.25+Math.random()*.5],true,'');
  if(name==='clear'){queued=[];board?.clear();void send('clear');}
 }
 function sync(nextRoot=document){
  const s=get(),nextBar=nextRoot?.querySelector?.('[data-glow-bar]'),nextHost=nextRoot?.querySelector?.('[data-chat-waves]'),stream=nextHost?.querySelector?.('#dmStream');
  const usable=db&&!document.hidden&&s.allowed&&s.page==='messages'&&UUID.test(s.id||'')&&UUID.test(s.peer||'')&&s.id!==s.peer&&nextBar&&stream?.dataset.peer===s.peer;
  if(!usable){reset();return;}
  if(owner!==s.id||peer!==s.peer||generation!==s.generation){reset();owner=s.id;peer=s.peer;generation=s.generation;}
  root=nextRoot;bar=nextBar;host=nextHost;update();if(!connected&&!connecting&&!status&&!leaseTimer)void connect();
 }
 document.addEventListener('click',event=>{
  const target=event.target.closest?.('[data-glow-action],[data-glow-color]');if(!target||!bar?.contains(target))return;event.preventDefault();
  if(target.dataset.glowColor!==undefined){const n=Number(target.dataset.glowColor);if(Number.isInteger(n)&&n>=0&&n<COLORS.length){color=n;update();}return;}action(target.dataset.glowAction);
 });
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&drawMode){drawMode=false;update();}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();else sync(document.querySelector('#content'));});
 window.addEventListener('pagehide',reset);window.addEventListener('pageshow',()=>sync(document.querySelector('#content')));
 return {sync,reset,markup(){return `<div class="shared-glow-bar" data-glow-bar><div class="shared-glow-caption"><span aria-hidden="true">✦</span><p data-glow-status role="status" aria-live="polite">Draw glowing trails together. They fade after a few seconds.</p></div><div class="shared-glow-controls"><button type="button" data-glow-action="invite">Draw together</button><button type="button" data-glow-action="join" hidden>Join drawing</button><button type="button" data-glow-action="decline" hidden>Not now</button><button type="button" data-glow-action="mode" aria-pressed="false" hidden>Draw mode</button><span data-glow-palette role="group" aria-label="Glow color" hidden>${['Blue','Orange','Violet','Mint'].map((name,i)=>`<button type="button" class="shared-glow-color glow-color-${i}" data-glow-color="${i}" aria-label="${name} glow" aria-pressed="${i===0}"></button>`).join('')}</span><button type="button" data-glow-action="sparkle" hidden>Sparkle</button><button type="button" data-glow-action="clear" hidden>Clear glow</button><button type="button" data-glow-action="done" hidden>Done</button><button type="button" data-glow-action="retry" hidden>Retry drawing</button></div></div>`;}};
}
window.SpaceSharedGlow={create,protocol:Object.freeze({packet,validRoom,topicFor})};
})();
