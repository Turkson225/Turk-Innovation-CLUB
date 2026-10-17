/*
 * SPACE Member wall: adapted from the user-supplied React Bits DriftWall.
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
// Buildless adaptation: compositor-driven drift, current-page data, no React runtime.
(() => {
 'use strict';
 function create(ctx){
  const e=ctx.esc;let pending=null,active=null,serial=0;const preferences=new Map();
  const state=()=>ctx.get(),identity=s=>s.id+':'+s.generation;
  const allowed=s=>!!s.id&&s.allowed&&s.page==='members';
  const photo=url=>{try{const u=new URL(url);return u.protocol==='https:'?u.href:'';}catch{return '';}};
  const initials=name=>String(name||'Member').trim().split(/\s+/u).slice(0,2).map(v=>Array.from(v)[0]||'').join('').toLocaleUpperCase();
  const tone=id=>Array.from(id).reduce((n,c)=>n+c.charCodeAt(0),0)%4;
  const media=item=>`<span class="mw-portrait mw-tone-${tone(item.id)}"><span class="mw-initials" aria-hidden="true">${e(initials(item.name))}</span><img data-wall-photo="${e(item.id)}" ${item.image?`src="${e(item.image)}"`:''} alt="" loading="lazy" decoding="async" draggable="false" ${item.image?'':'hidden'}></span>`;
  function tile(item,decorative=false){
   const attrs=`data-action="memberProfile" data-id="${e(item.id)}"`,inside=`${media(item)}<span class="mw-caption"><strong>${e(item.name)}</strong><small>${e(item.detail||item.role||'SPACE member')}</small></span>${item.online?'<span class="mw-online" aria-hidden="true"></span>':''}`;
   return decorative?`<span class="mw-tile" ${attrs}>${inside}</span>`:`<button type="button" class="mw-profile" ${attrs} aria-label="View ${e(item.name)}’s profile${item.online?', online now':''}">${inside}</button>`;
  }
  function markup(rows){
   const s=state();if(!allowed(s))return '';
   const seen=new Set(),items=rows.filter(p=>p?.id&&!seen.has(p.id)&&seen.add(p.id)).slice(0,24).map(p=>({id:String(p.id),name:String(p.name||'Member'),detail:String(p.detail||'').slice(0,160),role:String(p.role||''),online:p.online===true,image:photo(p.image)}));
   if(!items.length)return '';
   const key=String(++serial);pending={key,identity:identity(s),items};
   return `<section class="member-wall is-still" data-member-wall="${key}" aria-label="Member wall"><div class="mw-toolbar"><div><span class="eyebrow">MEMBER WALL</span><p>Open a face. Find common ground.</p></div><button type="button" class="button button-outline button-sm" data-wall-motion aria-pressed="false">Play motion</button></div><p class="mw-status" data-wall-status role="status">${items.length} ${items.length===1?'member':'members'} from your current page.</p><div class="mw-visual" aria-hidden="true"><div class="mw-plane"></div></div><div class="mw-static">${items.map(item=>tile(item)).join('')}</div><details class="mw-name-index" hidden><summary>Browse all ${items.length} names</summary><div>${items.map(item=>`<button type="button" data-action="memberProfile" data-id="${e(item.id)}">${e(item.name)}<span aria-hidden="true">↗</span></button>`).join('')}</div></details></section>`;
  }
  function detach(){
   const s=active;if(!s)return;active=null;s.alive=false;
   if(s.frame!==null)cancelAnimationFrame(s.frame);
   s.intersection?.disconnect();s.resize?.disconnect();s.modalObserver?.disconnect();
   for(const [target,event,handler,options]of s.listeners)target.removeEventListener(event,handler,options);
   s.root.classList.remove('is-running');s.root.classList.add('is-suspended');
  }
  function sync(host){
   const root=host?.querySelector('[data-member-wall]'),now=state();
   if(!root||!pending||root.dataset.memberWall!==pending.key||pending.identity!==identity(now)||!allowed(now)){detach();pending=null;return;}
   if(active?.root===root){updatePhotos();return;}
   detach();
   const s={root,identity:identity(now),items:pending.items,plane:root.querySelector('.mw-plane'),visual:root.querySelector('.mw-visual'),grid:root.querySelector('.mw-static'),names:root.querySelector('.mw-name-index'),button:root.querySelector('[data-wall-motion]'),status:root.querySelector('[data-wall-status]'),listeners:[],frame:null,alive:true,intersecting:true,hovered:false,focused:false,pageHidden:false,built:false,width:0};active=s;
   const valid=()=>active===s&&s.alive&&identity(state())===s.identity&&allowed(state());
   const listen=(target,event,handler,options)=>{if(!target?.addEventListener)return;target.addEventListener(event,handler,options);s.listeners.push([target,event,handler,options]);};
   const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)'),small=window.matchMedia?.('(max-width: 760px)'),connection=navigator.connection;
   const key='space.member-wall.motion.'+now.id;
   s.preference=preferences.get(key)||null;if(!preferences.has(key))try{const value=localStorage.getItem(key);if(['play','pause'].includes(value))s.preference=value;}catch{}
   const blocked=()=>!!reduced?.matches||!!connection?.saveData||(Number(navigator.deviceMemory)>0&&navigator.deviceMemory<=2)||(Number(navigator.hardwareConcurrency)>0&&navigator.hardwareConcurrency<=2);
   const modalOpen=()=>!!document.querySelector('dialog[open],#sidebar.open');
   const resetPlane=()=>{s.plane.style.transform='';if(s.frame!==null){cancelAnimationFrame(s.frame);s.frame=null;}};
   function build(){
    const width=root.clientWidth||960;if(s.built&&Math.abs(width-s.width)<40)return;
    s.width=width;const columns=Math.min(s.items.length,width>1000?5:width>620?4:2),tileWidth=Math.max(138,Math.min(204,(width+80)/columns)),unit=tileWidth+62+14,height=s.visual.clientHeight||540;
    root.style.setProperty('--mw-tile-w',tileWidth+'px');root.style.setProperty('--mw-tile-h',(tileWidth+62)+'px');
    s.plane.innerHTML=Array.from({length:columns},(_,index)=>{const items=s.items.filter((_,i)=>i%columns===index),cycle=items.length*unit,copies=Math.min(6,Math.max(2,Math.ceil(height*1.6/cycle)+1)),factor=1+.38*(((index*.6180339887+.35)%1)*2-1),duration=cycle/(26*factor);return `<div class="mw-column"><div class="mw-track" style="--mw-cycle:${cycle}px;--mw-duration:${duration}s;--mw-delay:${-(index*.37%1)*duration}s;animation-direction:${index%2?'reverse':'normal'}">${Array.from({length:copies},()=>items.map(item=>tile(item,true)).join('')).join('')}</div></div>`;}).join('');s.built=true;
   }
   function apply(){
    if(!valid()){if(active===s){detach();pending=null;}return;}
    const hard=blocked()||s.items.length<4,still=hard||small?.matches&&!s.preference,paused=s.preference==='pause',suspended=document.hidden||s.pageHidden||!s.intersecting||s.hovered||s.focused||modalOpen();
    s.still=!!still;s.paused=paused;s.root.classList.toggle('is-still',!!still);s.grid.hidden=!still;s.names.hidden=!!still;s.root.classList.toggle('is-suspended',suspended);s.root.classList.toggle('is-paused',paused);
    if(!still)build();s.root.classList.toggle('is-running',!still&&!paused&&!suspended);
    s.button.disabled=hard;s.button.setAttribute('aria-pressed',String(!still&&!paused));s.button.textContent=hard?'Still view':still||paused?'Play motion':'Pause motion';
    const message=hard?(s.items.length<4?'A closer look at your results. Motion is available with four or more members.':'Still view follows your device’s motion and data preferences.'):still?'A lighter view for your phone. Play motion whenever you like.':paused?'Motion paused. Open a portrait or browse the names.':'Drifting portraits from this page. Hover to hold the wall, or browse all names below.';
    if(s.status.textContent!==message)s.status.textContent=message;
    if(still||paused||suspended)resetPlane();
   }
   listen(s.button,'click',()=>{if(!valid()||blocked()||s.items.length<4)return;s.preference=s.still||s.paused?'play':'pause';preferences.set(key,s.preference);try{localStorage.setItem(key,s.preference);}catch{}apply();});
   listen(s.visual,'pointerenter',event=>{if(event.pointerType==='touch')return;s.hovered=true;apply();});
   listen(s.visual,'pointerdown',event=>{if(event.pointerType==='touch'){s.hovered=true;apply();}});
   for(const event of ['pointerup','pointercancel'])listen(s.visual,event,e=>{if(e.pointerType==='touch'){s.hovered=false;apply();}});
   listen(s.visual,'pointerleave',()=>{s.hovered=false;resetPlane();apply();});
   listen(s.visual,'pointermove',event=>{if(!valid()||s.still||s.paused||blocked()||event.pointerType==='touch')return;const rect=s.visual.getBoundingClientRect();if(!rect.width||!rect.height)return;s.pointer={x:Math.max(-.5,Math.min(.5,(event.clientX-rect.left)/rect.width-.5)),y:Math.max(-.5,Math.min(.5,(event.clientY-rect.top)/rect.height-.5))};if(s.frame!==null)return;s.frame=requestAnimationFrame(()=>{s.frame=null;if(!valid()||s.still||s.paused||document.hidden)return;s.plane.style.transform=`translate(-50%,-50%) rotateX(${12-s.pointer.y*4}deg) rotateY(${-12+s.pointer.x*4}deg) translateZ(-70px)`;});});
   listen(s.names,'focusin',()=>{s.focused=true;apply();});listen(s.names,'focusout',event=>{if(!s.names.contains(event.relatedTarget)){s.focused=false;apply();}});
   listen(root,'error',event=>{if(valid()&&event.target?.matches?.('[data-wall-photo]'))event.target.hidden=true;},true);
   listen(document,'visibilitychange',apply);listen(window,'pagehide',()=>{s.pageHidden=true;apply();});listen(window,'pageshow',()=>{s.pageHidden=false;apply();});listen(reduced,'change',apply);listen(small,'change',apply);listen(connection,'change',apply);
   if(typeof IntersectionObserver!=='undefined'){s.intersection=new IntersectionObserver(entries=>{if(!valid())return;const entry=entries.find(v=>v.target===root);if(entry){s.intersecting=entry.isIntersecting;apply();}},{threshold:0});s.intersection.observe(root);}
   if(typeof ResizeObserver!=='undefined'){s.resize=new ResizeObserver(()=>{if(valid())apply();});s.resize.observe(root);}
   if(typeof MutationObserver!=='undefined'){s.modalObserver=new MutationObserver(()=>{if(valid())apply();});for(const id of ['modal','imageViewer','sidebar']){const node=document.getElementById(id);if(node)s.modalObserver.observe(node,{attributes:true,attributeFilter:[id==='sidebar'?'class':'open']});}}
   apply();updatePhotos();
  }
  function updatePhotos(){
   const s=active;if(!s||!allowed(state())||identity(state())!==s.identity)return;
   const images=new Map(s.items.map(item=>[item.id,photo(ctx.photo?.(item.id)||item.image)]));
   for(const img of s.root.querySelectorAll('[data-wall-photo]')){const url=images.get(img.dataset.wallPhoto);if(url&&img.getAttribute('src')!==url){img.src=url;img.hidden=false;}}
  }
  return {markup,sync,updatePhotos,reset(){detach();pending=null;serial++;}};
 }
 window.SpaceMemberWall={create};
})();
