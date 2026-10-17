/*
 * SPACE Member wall: adapted from the user-supplied React Bits CardSwap.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause License Condition v1.0.
 * Source and full license: https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, and distribute the Software as part of an
 * application, website, or product, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * Commons Clause Restriction: You may use this Software, including for any
 * commercial purpose, so long as you do not sell, sublicense, or redistribute
 * the components themselves-whether alone, in a bundle, or as a ported version.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * SPACE adapts the rendering lifecycle without adding a React dependency.
 */
// A bounded, buildless CardSwap: existing club artwork, CSS transitions, no animation loop.
(() => {
 'use strict';
 const tracks=[
  {title:'Controls and Automation',tag:'01 / CONTROLS',image:'engineering-lab.webp',detail:'Wire sensors and actuators, design control logic, and test systems that respond to the real world.',outcome:'Prototype: a working controller'},
  {title:'Software and Programming',tag:'02 / CODE',image:'club-about-team.webp',detail:'Write code, build interfaces and connect data to useful tools for people and projects.',outcome:'Prototype: an app or dashboard'},
  {title:'Electronics and Robotics',tag:'03 / HARDWARE',image:'robotics-workbench.webp',detail:'Assemble circuits, integrate microcontrollers and bring moving or connected machines to life.',outcome:'Prototype: a tested device or robot'},
  {title:'AI & Machine Learning',tag:'04 / DATA',image:'club-about-lab.webp',detail:'Explore data, train and evaluate models, and put a useful idea into a working demonstration.',outcome:'Prototype: a usable model'}
 ];
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function markup(publicPage=false,partner=false){
  const base=publicPage?'../':'';
  const destination=partner&&!publicPage?'#investor-portal':`${base}#courses`,cta=partner&&!publicPage?'Open investor portal':'Browse workshops';
  return `<div class="space-card-swap" data-card-swap><div class="scs-toolbar" data-swap-toolbar hidden><span class="scs-count" data-swap-count aria-hidden="true">1 / 4</span><div><button type="button" data-swap-list aria-pressed="false">View all tracks</button><button type="button" data-swap-play aria-pressed="false">Pause rotation</button></div></div><div class="scs-stage" data-swap-stage aria-live="off">${tracks.map((t,i)=>`<article class="scs-card" data-swap-card aria-label="${i+1} of 4: ${escape(t.title)}"><div class="scs-visual"><img src="${base}assets/${t.image}" alt="" width="1200" height="800" loading="lazy" decoding="async" draggable="false"><span class="scs-image-fallback" aria-hidden="true">S<span>✦</span></span></div><div class="scs-copy"><span class="scs-track-label">${escape(t.tag)}</span><h3>${escape(t.title)}</h3><p>${escape(t.detail)}</p><small>${escape(t.outcome)}</small><a class="scs-link" href="${destination}"${publicPage||partner?'':` data-action="browseLearningTrack" data-track="${escape(t.title)}"`}>${cta} <span aria-hidden="true">→</span></a></div></article>`).join('')}</div><div class="scs-controls" data-swap-controls hidden><button type="button" data-swap-prev aria-label="Previous learning track">←</button><div class="scs-dots" role="group" aria-label="Choose a learning track">${tracks.map((t,i)=>`<button type="button" data-swap-to="${i}" aria-label="Show ${escape(t.title)}"><span aria-hidden="true"></span></button>`).join('')}</div><button type="button" data-swap-next aria-label="Next learning track">→</button></div><p class="scs-status sr-only" data-swap-status role="status" aria-live="polite" aria-atomic="true"></p><p class="scs-note">Illustrative artwork · Explore more than one track.</p></div>`;
 }
 function create(ctx){
  let active=null,retained=null;
  const state=()=>ctx.get(),owner=()=>{const s=state();return `${s.id}:${s.generation}`;};
  function reset(){if(active){const old=active;active=null;old.dispose();}retained=null;}
  function sync(host){
   if(active){const old=active;active=null;old.dispose();}
   if(!host||state().page!=='about')return;
   const root=host.querySelector('[data-card-swap]');if(!root)return;
   const cards=[...root.querySelectorAll('[data-swap-card]')].slice(0,4),stage=root.querySelector('[data-swap-stage]');
   if(!stage||!cards.length)return;
   const identity=owner(),key=identity+':about',saved=retained?.key===key?retained:null;
   let index=Math.min(cards.length-1,saved?.index||0),userPaused=saved?.paused||false,explicit=saved?.explicit||false,list=saved?.list||false;
   let timer=0,exitTimer=0,hover=false,focus=false,inView=true,suspended=false,drag=null,disposed=false;
   const fine=window.matchMedia?.('(hover: hover) and (pointer: fine)'),reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)'),connection=navigator.connection;
   const play=root.querySelector('[data-swap-play]'),listButton=root.querySelector('[data-swap-list]'),toolbar=root.querySelector('[data-swap-toolbar]'),controls=root.querySelector('[data-swap-controls]'),count=root.querySelector('[data-swap-count]'),status=root.querySelector('[data-swap-status]'),dots=[...root.querySelectorAll('[data-swap-to]')];
   const listeners=[],observers=[],tabIndices=new Map();
   for(const card of cards)for(const link of card.querySelectorAll('a,button,[tabindex]'))tabIndices.set(link,link.getAttribute('tabindex'));
   const current=()=>!disposed&&active?.root===root&&owner()===identity&&state().page==='about'&&root.isConnected;
   const blocked=()=>document.hidden||suspended||!inView||!!document.querySelector('dialog[open]')||document.documentElement.classList.contains('mobile-menu-open');
   const intent=()=>cards.length>1&&!list&&!userPaused&&(!reduce?.matches&&!connection?.saveData||explicit);
   const running=()=>current()&&intent()&&!blocked()&&!hover&&!focus&&!drag;
   function listen(node,type,fn,options){if(node?.addEventListener){node.addEventListener(type,fn,options);listeners.push(()=>node.removeEventListener(type,fn,options));}}
   function preference(node,fn){if(node?.addEventListener)listen(node,'change',fn);else if(node?.addListener){node.addListener(fn);listeners.push(()=>node.removeListener(fn));}}
   function save(){retained={key,index,paused:userPaused,explicit,list};}
   function stop(){window.clearTimeout(timer);timer=0;}
   function clearExit(){window.clearTimeout(exitTimer);exitTimer=0;cards.forEach(card=>card.classList.remove('is-swap-outgoing'));}
   function schedule(){
    stop();if(!current())return;
    root.classList.toggle('is-swap-running',running());
    if(play){play.hidden=list||cards.length<2;play.textContent=intent()?'Pause rotation':'Play rotation';play.setAttribute('aria-pressed',String(!intent()));}
    if(running())timer=window.setTimeout(()=>{timer=0;if(running())select((index+1)%cards.length,false);else schedule();},5500);
   }
   function measure(){
    if(!current()||list)return;
    const height=Math.max(...cards.map(card=>card.offsetHeight||0));
    if(height){const value=`${Math.ceil(height+52)}px`;if(stage.style.height!==value)stage.style.height=value;}
   }
   function presentation(){
    root.classList.toggle('is-swap-list',list);root.classList.toggle('is-motion-opt-in',explicit);root.classList.toggle('is-swap-still',!!(reduce?.matches||connection?.saveData)&&!explicit);
    if(list)root.removeAttribute('aria-roledescription');else root.setAttribute('aria-roledescription','carousel');
    if(listButton){listButton.textContent=list?'Show card stack':'View all tracks';listButton.setAttribute('aria-pressed',String(list));}
    if(controls)controls.hidden=list||cards.length<2;
    if(count)count.textContent=list?`${cards.length} learning tracks`:`${index+1} / ${cards.length}`;
    cards.forEach((card,i)=>{
     const position=(i-index+cards.length)%cards.length,visible=list||position===0;
     card.dataset.swapPosition=String(position);card.inert=!visible;
     if(visible)card.removeAttribute('aria-hidden');else card.setAttribute('aria-hidden','true');
     for(const link of card.querySelectorAll('a,button,[tabindex]')){const original=tabIndices.get(link);if(visible){if(original===null)link.removeAttribute('tabindex');else link.setAttribute('tabindex',original);}else link.setAttribute('tabindex','-1');}
    });
    dots.forEach((dot,i)=>{if(i===index)dot.setAttribute('aria-current','true');else dot.removeAttribute('aria-current');});
    if(list)stage.style.removeProperty('height');else measure();
    save();schedule();
   }
   function select(next,manual=true){
    if(!current()||blocked()||list)return;
    const chosen=(next+cards.length)%cards.length;if(chosen===index){schedule();return;}
    const outgoing=cards[index];
    clearExit();index=chosen;
    if(!reduce?.matches||explicit){outgoing.classList.add('is-swap-outgoing');exitTimer=window.setTimeout(()=>{outgoing.classList.remove('is-swap-outgoing');exitTimer=0;},420);}
    presentation();
    if(manual&&status)status.textContent=`${index+1} of ${cards.length}: ${tracks[index]?.title||cards[index].querySelector('h3')?.textContent||'Learning track'}`;
   }
   function click(event){
    if(!current())return;
    const button=event.target?.closest?.('[data-swap-play],[data-swap-list],[data-swap-prev],[data-swap-next],[data-swap-to]');
    if(!button||!root.contains(button))return;
    if(button===play){userPaused=intent();explicit=!userPaused;if(!userPaused)focus=false;presentation();return;}
    if(button===listButton){drag=null;clearExit();list=!list;presentation();return;}
    if(button.hasAttribute('data-swap-prev'))select(index-1);
    else if(button.hasAttribute('data-swap-next'))select(index+1);
    else if(button.hasAttribute('data-swap-to')){const target=Number(button.dataset.swapTo);if(Number.isInteger(target)&&target>=0&&target<cards.length)select(target);}
   }
   function keyboard(event){
    if(!current()||list||event.altKey||event.ctrlKey||event.metaKey)return;
    if(!event.target?.closest?.('[data-swap-controls]'))return;
    const next=event.key==='ArrowRight'?index+1:event.key==='ArrowLeft'?index-1:event.key==='Home'?0:event.key==='End'?cards.length-1:null;
    if(next!==null){event.preventDefault();select(next);}
   }
   function down(event){
    if(!current()||list||blocked()||cards.length<2||event.isPrimary===false||event.button>0)return;
    const visual=event.target?.closest?.('.scs-visual');if(!visual||!cards[index].contains(visual))return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY};schedule();
   }
   function up(event){
    if(!drag||event.pointerId!==drag.id)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag=null;
    if(Math.abs(dx)>=42&&Math.abs(dx)>Math.abs(dy)*1.4)select(index+(dx<0?1:-1));else schedule();
   }
   function cancel(){drag=null;schedule();}
   function gate(){if(!current())return;if(blocked()){drag=null;clearExit();}schedule();}
   function device(){if(!current())return;if(reduce?.matches||connection?.saveData)explicit=false;if(!fine?.matches)hover=false;clearExit();presentation();}
   listen(root,'click',click);listen(root,'keydown',keyboard);
   listen(stage,'pointerenter',event=>{if(fine?.matches&&event.pointerType!=='touch'){hover=true;schedule();}},{passive:true});
   listen(stage,'pointerleave',()=>{hover=false;schedule();},{passive:true});
   listen(root,'focusin',event=>{focus=!!fine?.matches||!!event.target?.matches?.(':focus-visible');schedule();});
   listen(root,'focusout',event=>{if(!root.contains(event.relatedTarget)){focus=false;schedule();}});
   listen(stage,'pointerdown',down,{passive:true});listen(window,'pointerup',up,{passive:true});listen(window,'pointercancel',cancel,{passive:true});
   listen(document,'visibilitychange',gate);
   listen(window,'pagehide',()=>{suspended=true;drag=null;clearExit();schedule();});listen(window,'pageshow',()=>{suspended=false;schedule();measure();});
   listen(window,'resize',measure,{passive:true});listen(window,'blur',()=>{drag=null;hover=false;schedule();});
   listen(root,'error',event=>{if(event.target?.matches?.('.scs-visual img'))event.target.hidden=true;},true);
   preference(reduce,device);preference(fine,device);listen(connection,'change',device);
   if(window.IntersectionObserver){const observer=new window.IntersectionObserver(entries=>{if(!current())return;inView=entries.some(entry=>entry.target===root&&entry.isIntersecting);gate();},{threshold:0});observer.observe(root);observers.push(observer);}
   if(window.ResizeObserver){const observer=new window.ResizeObserver(measure);observer.observe(stage);cards.forEach(card=>observer.observe(card));observers.push(observer);}
   if(window.MutationObserver){const observer=new window.MutationObserver(gate);for(const dialog of document.querySelectorAll('dialog'))observer.observe(dialog,{attributes:true,attributeFilter:['open']});observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});observers.push(observer);}
   active={root,dispose(){
    save();disposed=true;stop();clearExit();listeners.forEach(off=>off());observers.forEach(observer=>observer.disconnect());
    root.classList.remove('is-swap-ready','is-swap-list','is-swap-running','is-motion-opt-in','is-swap-still');root.removeAttribute('role');root.removeAttribute('aria-roledescription');root.removeAttribute('aria-label');stage.style.removeProperty('height');
    if(toolbar)toolbar.hidden=true;if(controls)controls.hidden=true;
    cards.forEach(card=>{card.inert=false;card.removeAttribute('aria-hidden');delete card.dataset.swapPosition;});
    for(const [link,value]of tabIndices){if(value===null)link.removeAttribute('tabindex');else link.setAttribute('tabindex',value);}
   }};
   root.classList.add('is-swap-ready');root.setAttribute('role','region');root.setAttribute('aria-label','Four practical learning tracks');if(toolbar)toolbar.hidden=false;presentation();
  }
  return {sync,reset};
 }
 window.SpaceCardSwap=Object.freeze({create,markup});
 // The standalone public About page uses the same progressively enhanced markup.
 if(document.body?.classList.contains('public-page'))create({get:()=>({id:'public',generation:0,page:'about'})}).sync(document.querySelector('main'));
})();
