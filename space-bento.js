/*
 * SPACE Member wall: adapted from the user-supplied React Bits MagicBento.
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
// Progressive enhancement: real cards and native actions work before this script loads.
(() => {
 'use strict';
 const routes=new Set(['home','courses','teaching','projects','admin']);
 const cardTypes='a,button,article,.card,.stat,.records-stat,.teaching-agenda';
 function create(ctx){
  let active=null;
  const key=()=>{const s=ctx.get();return `${s.id}:${s.generation}:${s.page}`;};
  function detach(){if(active){const old=active;active=null;old.dispose();}}
  function sync(host){
   detach();
   if(!host||!routes.has(ctx.get().page))return;
   const groups=[...host.querySelectorAll('[data-bento]')].slice(0,12),cards=new Set();
   for(const group of groups)for(const item of [...group.children]){
    if(cards.size<96&&item.matches(cardTypes))cards.add(item);
   }
   if(!cards.size)return;
   const owner=key(),fine=window.matchMedia?.('(hover: hover) and (pointer: fine)'),reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)'),connection=navigator.connection;
   const listeners=[],observers=[],waves=new Map();
   let frame=0,point=null,lit=null,suspended=false,disposed=false;
   const current=()=>!disposed&&active?.host===host&&key()===owner&&host.isConnected;
   const blocked=()=>document.hidden||suspended||!!document.querySelector('dialog[open]')||document.documentElement.classList.contains('mobile-menu-open');
   const motion=()=>current()&&!blocked()&&!reduced?.matches&&!connection?.saveData;
   function listen(node,type,fn,options){
    if(!node?.addEventListener)return;
    node.addEventListener(type,fn,options);listeners.push(()=>node.removeEventListener(type,fn,options));
   }
   function preference(node,fn){
    if(node?.addEventListener)listen(node,'change',fn);
    else if(node?.addListener){node.addListener(fn);listeners.push(()=>node.removeListener(fn));}
   }
   function clearLight(){
    if(frame)window.cancelAnimationFrame(frame);frame=0;point=null;
    if(lit){lit.classList.remove('is-bento-lit');lit.style.removeProperty('--sb-x');lit.style.removeProperty('--sb-y');lit=null;}
   }
   function clearWaves(){for(const [card,{node,timer}]of waves){window.clearTimeout(timer);node.remove();waves.delete(card);}}
   function halt(){clearLight();clearWaves();}
   function preferences(){
    if(!current())return;
    host.toggleAttribute('data-bento-static',!!reduced?.matches||!!connection?.saveData);
    halt();
   }
   function cardFor(target){const card=target?.closest?.('[data-bento] > *');return cards.has(card)?card:null;}
   function paint(){
    frame=0;if(!motion()||!fine?.matches){clearLight();return;}
    const latest=point;point=null;if(!latest)return;
    const {card,x,y}=latest;
    if(!cards.has(card)||!card.isConnected||card.closest('[hidden]')){clearLight();return;}
    const rect=card.getBoundingClientRect();
    if(!rect.width||!rect.height||x<rect.left||x>rect.right||y<rect.top||y>rect.bottom){clearLight();return;}
    if(lit!==card){clearLight();lit=card;lit.classList.add('is-bento-lit');}
    card.style.setProperty('--sb-x',`${Math.round(x-rect.left)}px`);
    card.style.setProperty('--sb-y',`${Math.round(y-rect.top)}px`);
   }
   function pointer(event){
    if(!motion()||!fine?.matches||event.pointerType==='touch'){clearLight();return;}
    const card=cardFor(event.target);if(!card){clearLight();return;}
    point={card,x:event.clientX,y:event.clientY};
    if(!frame)frame=window.requestAnimationFrame(paint);
   }
   function click(event){
    if(event.defaultPrevented||!motion())return;
    const card=cardFor(event.target),action=event.target?.closest?.('a[href],button');
    if(!card||!action||!card.contains(action)||action.disabled||action.getAttribute('aria-disabled')==='true')return;
    if(event.target.closest('input,textarea,select,[contenteditable]'))return;
    const rect=card.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const old=waves.get(card);if(old){window.clearTimeout(old.timer);old.node.remove();}
    const node=document.createElement('span'),size=Math.ceil(Math.hypot(rect.width,rect.height)*2);
    const within=event.detail>0&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY);
    const x=within?Math.max(0,Math.min(rect.width,event.clientX-rect.left)):rect.width/2;
    const y=within?Math.max(0,Math.min(rect.height,event.clientY-rect.top)):rect.height/2;
    node.className='space-bento-wave';node.setAttribute('aria-hidden','true');
    node.style.cssText=`width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
    card.appendChild(node);
    const timer=window.setTimeout(()=>{node.remove();if(waves.get(card)?.node===node)waves.delete(card);},460);
    waves.set(card,{node,timer});
   }
   function gate(){if(current()&&blocked())halt();}
   listen(host,'pointermove',pointer,{passive:true});listen(host,'pointerleave',clearLight,{passive:true});
   listen(host,'click',click);listen(host,'focusin',clearLight);
   listen(window,'scroll',clearLight,{passive:true,capture:true});listen(window,'resize',clearLight,{passive:true});
   listen(document,'visibilitychange',gate);
   listen(window,'pagehide',()=>{suspended=true;halt();});listen(window,'pageshow',()=>{suspended=false;halt();});
   preference(fine,preferences);preference(reduced,preferences);listen(connection,'change',preferences);
   if(window.MutationObserver){
    const observer=new window.MutationObserver(gate);
    for(const dialog of document.querySelectorAll('dialog'))observer.observe(dialog,{attributes:true,attributeFilter:['open']});
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});observers.push(observer);
   }
   active={host,dispose(){disposed=true;halt();listeners.forEach(off=>off());observers.forEach(o=>o.disconnect());host.removeAttribute('data-bento-static');}};
   preferences();
  }
  return {sync,reset:detach};
 }
 window.SpaceBento=Object.freeze({create});
})();
