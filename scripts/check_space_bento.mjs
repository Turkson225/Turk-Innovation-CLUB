// Behavioral checks with synthetic cards: no browser, accounts or network access.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../space-bento.js',import.meta.url),'utf8');
function element(extra={}){
 const listeners=new Map(),classes=new Set(),attributes=new Map();
 const node={listeners,classes,attributes,isConnected:true,children:[],parentElement:null,disabled:false,
  style:{setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}},
  classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)},
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
  removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
  fire(type,event={}){for(const fn of [...(listeners.get(type)||[])])fn(event);},
  setAttribute(k,v){attributes.set(k,String(v));},getAttribute:k=>attributes.get(k)??null,
  removeAttribute:k=>attributes.delete(k),toggleAttribute(k,on){if(on)attributes.set(k,'');else attributes.delete(k);},
  contains(child){for(let n=child;n;n=n.parentElement)if(n===this)return true;return false;},
  appendChild(child){child.parentElement=this;this.children.push(child);},
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.isConnected=false;},
  getBoundingClientRect:()=>({left:10,top:20,right:310,bottom:180,width:300,height:160}),
  matches:()=>false,closest:()=>null,querySelectorAll:()=>[],...extra};return node;
}
function harness({phone=false,reduced=false,saveData=false,page='home',count=4,legacy=false}={}){
 const state={id:'member',generation:1,page},frames=new Map(),timers=new Map(),observers=[];let serial=0;
 const fine=element({matches:!phone}),reduce=element({matches:reduced}),connection=element({saveData});
 const html=element(),dialogs=[element(),element(),element()],document=element({hidden:false,modal:false,documentElement:html,querySelector:()=>document.modal?{}:null,querySelectorAll:()=>dialogs,createElement:()=>element()});
 const window=element({matchMedia:q=>q.includes('reduced')?reduce:fine,
  requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
  setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  MutationObserver:class{constructor(fn){this.callback=fn;this.watched=[];observers.push(this);}observe(node,options){this.watched.push({node,options});}disconnect(){this.disconnected=true;}}
 });
 if(legacy){for(const media of [fine,reduce]){media.addEventListener=undefined;media.removeEventListener=undefined;media.addListener=fn=>media.legacy=fn;media.removeListener=fn=>{if(media.legacy===fn)media.legacy=null;};}}
 const host=element(),group=element();host.groups=[group];host.querySelectorAll=q=>q==='[data-bento]'?host.groups:[];
 function makeCard(){
  const card=element({isCard:true,isAction:true,matches:()=>true});
  card.closest=q=>q==='[data-bento] > *'?card:q==='[hidden]'?(card.hidden?card:null):q==='a[href],button'?card:null;
  const child=element({parentElement:card});child.closest=q=>q==='[data-bento] > *'?card:q==='a[href],button'?card:null;
  card.target=child;return card;
 }
 const cards=Array.from({length:count},makeCard);group.children=cards;
 const context=vm.createContext({window,document,navigator:{connection},Set,Map,Math,Number,Object});vm.runInContext(source,context);
 const api=window.SpaceBento.create({get:()=>state});
 const move=(card=cards[0],x=100,y=90,type=phone?'touch':'mouse')=>host.fire('pointermove',{target:card.target,clientX:x,clientY:y,pointerType:type});
 const click=(card=cards[0],event={})=>{const e={target:card.target,detail:1,clientX:80,clientY:70,defaultPrevented:false,...event};host.fire('click',e);return e;};
 const tick=()=>{for(const [id,fn]of [...frames]){frames.delete(id);fn();}};
 return {api,state,window,document,host,group,cards,fine,reduce,connection,observers,frames,timers,move,click,tick,makeCard,mount(){api.sync(host);return this;},waves:card=>card.children.filter(n=>n.className==='space-bento-wave')};
}
const tests=[];const test=(name,fn)=>tests.push({name,fn});
test('Only explicitly marked overview groups receive enhancement',()=>{const h=harness();h.host.groups=[];h.mount();assert.equal(h.host.listeners.size,0);assert.equal(h.observers.length,0);});
test('Chats and record pages remain outside the enhancement',()=>{for(const page of ['messages','channels','finance','inventory','members','classroom']){const h=harness({page}).mount();assert.equal(h.host.listeners.size,0);}});
test('Pointer updates coalesce into one frame and stop immediately afterward',()=>{const h=harness().mount();for(let i=0;i<12;i++)h.move(h.cards[0],100+i,80);assert.equal(h.frames.size,1);h.tick();assert.equal(h.frames.size,0);assert(h.cards[0].classes.has('is-bento-lit'));assert.equal(h.cards[0].style['--sb-x'],'101px');assert.equal(h.cards[0].style['--sb-y'],'60px');});
test('Moving across cards clears the previous spotlight',()=>{const h=harness().mount();h.move();h.tick();h.move(h.cards[1]);h.tick();assert(!h.cards[0].classes.has('is-bento-lit'));assert.equal(h.cards[0].style['--sb-x'],undefined);assert(h.cards[1].classes.has('is-bento-lit'));});
test('Moving outside a card or leaving the page clears pending light',()=>{const h=harness().mount();h.move();h.host.fire('pointerleave');assert.equal(h.frames.size,0);h.move();h.tick();h.host.fire('pointermove',{target:element(),pointerType:'mouse'});assert(!h.cards[0].classes.has('is-bento-lit'));});
test('Touch works with native click feedback without synthetic hover',()=>{const h=harness({phone:true}).mount();h.move();h.move(h.cards[0],100,90,'mouse');assert.equal(h.frames.size,0);const event=h.click();assert.equal(event.defaultPrevented,false);assert.equal(h.waves(h.cards[0]).length,1);assert.equal(h.waves(h.cards[0])[0].getAttribute('aria-hidden'),'true');});
test('Decorative feedback never intercepts the existing navigation or action',()=>{const h=harness().mount();let prevented=0,stopped=0;h.click(h.cards[0],{preventDefault:()=>prevented++,stopPropagation:()=>stopped++});assert.equal(prevented,0);assert.equal(stopped,0);});
test('Keyboard activation uses centered feedback and keeps focus semantics native',()=>{const h=harness().mount();h.click(h.cards[0],{detail:0,clientX:0,clientY:0});assert(h.waves(h.cards[0])[0].style.cssText.includes('left:150px;top:80px'));assert.equal(h.cards[0].getAttribute('tabindex'),null);assert.equal(h.host.listeners.has('keydown'),false);});
test('Repeated clicks replace a card wave instead of accumulating effects',()=>{const h=harness().mount();for(let i=0;i<20;i++)h.click();assert.equal(h.waves(h.cards[0]).length,1);assert.equal(h.timers.size,1);const [id,finish]=[...h.timers][0];h.timers.delete(id);finish();assert.equal(h.waves(h.cards[0]).length,0);});
test('Disabled, already handled and editable targets have no decorative click',()=>{const h=harness().mount();h.cards[0].disabled=true;h.click();h.cards[0].disabled=false;h.click(h.cards[0],{defaultPrevented:true});const input=element();input.closest=q=>q==='[data-bento] > *'?h.cards[0]:q==='a[href],button'?h.cards[0]:input;h.click(h.cards[0],{target:input});assert.equal(h.timers.size,0);});
test('A plain article never becomes a fake button',()=>{const h=harness().mount();h.cards[0].target.closest=q=>q==='[data-bento] > *'?h.cards[0]:null;h.click();assert.equal(h.waves(h.cards[0]).length,0);assert.equal(h.cards[0].getAttribute('role'),null);});
for(const setting of [{reduced:true},{saveData:true}])test('Device preference '+JSON.stringify(setting)+' keeps a still functional design',()=>{const h=harness(setting).mount();h.move();const event=h.click();assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert(h.host.attributes.has('data-bento-static'));assert.equal(event.defaultPrevented,false);});
test('Changing motion/data preferences releases active effects immediately',()=>{const h=harness().mount();h.move();h.tick();h.click();h.reduce.matches=true;h.reduce.fire('change');assert(!h.cards[0].classes.has('is-bento-lit'));assert.equal(h.timers.size,0);h.reduce.matches=false;h.reduce.fire('change');h.move();assert.equal(h.frames.size,1);h.connection.saveData=true;h.connection.fire('change');assert.equal(h.frames.size,0);});
test('A hybrid device switching to a coarse pointer clears its spotlight',()=>{const h=harness().mount();h.move();h.tick();h.fine.matches=false;h.fine.fire('change');assert(!h.cards[0].classes.has('is-bento-lit'));h.move();assert.equal(h.frames.size,0);});
test('Hidden documents release frames and waves and remain still until visible',()=>{const h=harness().mount();h.move();h.click();h.document.hidden=true;h.document.fire('visibilitychange');assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);h.move();assert.equal(h.frames.size,0);h.document.hidden=false;h.document.fire('visibilitychange');h.move();assert.equal(h.frames.size,1);});
test('Dialogs and mobile menus gate background decoration',()=>{const h=harness().mount();h.move();h.document.modal=true;h.observers[0].callback([]);assert.equal(h.frames.size,0);h.click();assert.equal(h.timers.size,0);h.document.modal=false;h.document.documentElement.classes.add('mobile-menu-open');h.move();assert.equal(h.frames.size,0);h.document.documentElement.classes.delete('mobile-menu-open');h.move();assert.equal(h.frames.size,1);assert.equal(h.observers[0].watched.length,4);});
test('Scroll, resize and keyboard focus clear stale pointer coordinates',()=>{const h=harness().mount();for(const [target,event]of [[h.window,'scroll'],[h.window,'resize'],[h.host,'focusin']]){h.move();h.tick();target.fire(event);assert(!h.cards[0].classes.has('is-bento-lit'));}});
test('A browser page-cache exit releases work and restores native actions on return',()=>{const h=harness().mount();h.move();h.click();h.window.fire('pagehide');assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);h.move();assert.equal(h.frames.size,0);h.window.fire('pageshow');h.click();assert.equal(h.timers.size,1);});
test('Hidden tabs in the teaching overview cannot receive a spotlight',()=>{const h=harness().mount();h.cards[0].hidden=true;h.move();h.tick();assert(!h.cards[0].classes.has('is-bento-lit'));});
test('Detached cards and coordinates outside the measured card are discarded',()=>{const h=harness().mount();h.move();h.cards[0].isConnected=false;h.tick();assert(!h.cards[0].classes.has('is-bento-lit'));h.cards[0].isConnected=true;h.move(h.cards[0],9999,9999);h.tick();assert(!h.cards[0].classes.has('is-bento-lit'));});
test('A pending callback cannot carry effects across accounts or routes',()=>{for(const property of ['id','generation','page']){const h=harness().mount();h.move();h.state[property]=property==='generation'?2:'other';h.tick();h.click();assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert(!h.cards[0].classes.has('is-bento-lit'));}});
test('Reset and loading states clean listeners, observers, timers and pointer variables',()=>{const h=harness().mount();h.move();h.tick();h.click();h.api.reset();assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert(!h.cards[0].classes.has('is-bento-lit'));assert(h.observers.every(o=>o.disconnected));for(const node of [h.host,h.window,h.document,h.connection,h.fine,h.reduce])for(const listeners of node.listeners.values())assert.equal(listeners.size,0);assert(!h.host.attributes.has('data-bento-static'));});
test('Rerendering uses the new cards and late observers cannot modify them',()=>{const h=harness().mount();const previous=h.observers[0].callback,old=h.cards[0],next=h.makeCard();h.group.children=[next];h.api.sync(h.host);h.move(next);h.tick();previous([]);assert(next.classes.has('is-bento-lit'));assert(!old.classes.has('is-bento-lit'));h.move(old);h.tick();assert(!old.classes.has('is-bento-lit'));});
test('The card collection stays bounded on oversized result sets',()=>{const h=harness({count:150}).mount();h.move(h.cards[95]);h.tick();assert(h.cards[95].classes.has('is-bento-lit'));h.move(h.cards[96]);h.tick();assert(!h.cards[96].classes.has('is-bento-lit'));});
test('Legacy motion preference listeners are released with the view',()=>{const h=harness({legacy:true}).mount();assert.equal(typeof h.reduce.legacy,'function');h.api.sync(null);assert.equal(h.reduce.legacy,null);assert.equal(h.fine.legacy,null);});
test('The optional module works without media queries, connection hints or observers',()=>{const h=harness();delete h.window.matchMedia;delete h.window.MutationObserver;vm.runInContext(source,vm.createContext({window:h.window,document:h.document,navigator:{},Set,Map,Math,Number,Object}));const api=h.window.SpaceBento.create({get:()=>h.state});api.sync(h.host);h.click();assert.equal(h.waves(h.cards[0]).length,1);api.reset();});
test('The optional assets and behavioral checks are included in publication',()=>{const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),workflow=fs.readFileSync(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');for(const asset of ['space-bento.js','space-bento.css'])assert(index.includes(asset)&&workflow.includes(asset));assert(workflow.includes('node scripts/check_space_bento.mjs'));});
let failed=0;for(const {name,fn}of tests){try{await fn();console.log('PASS',name);}catch(error){failed++;console.error('FAIL',name,error);}}console.log(`${tests.length-failed}/${tests.length} Bento checks passed`);if(failed)process.exitCode=1;
