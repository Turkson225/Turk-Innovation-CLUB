// Mobile shell checks with DOM doubles; no production data or browser login.
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../mobile-workspace.js',import.meta.url),'utf8');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function harness(overrides={}){
  const events=()=>{const handlers=new Map();return{addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);},fire(name,event={}){for(const fn of handlers.get(name)||[])fn(event);}};};
  let document;
  const node=extra=>({dataset:{},attributes:{},innerHTML:'',textContent:'',hidden:false,inert:false,isConnected:true,value:'',open:false,disabled:false,classList:{toggle(){}},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},getClientRects(){return [{}];},querySelectorAll(){return [];},focus(){document.activeElement=this;},matches(){return false;},...extra});
  const state={id:'self',name:'Alice Maker',firstName:'Alice',role:'Member',approved:true,club:true,admin:false,teacher:false,founder:false,investor:false,office:false,allowed:['home','messages','channels','courses','classroom','calendar','notifications','feed','shop','members','projects','privacy','founders'],page:'home',peer:null,day:'Saturday, Oct 17',messages:3,notices:2,pending:0,workTitle:'My learning',workCopy:'Your classes and feedback',workLabel:'learning workspace',actions:[],agenda:[],...overrides};
  const links=['home','messages','courses','classroom','teaching','calendar','shop','members','admin','applications','investor-portal'].map(page=>node({dataset:{page},hidden:!state.allowed.includes(page),textContent:page}));
  const learning=node({dataset:{navGroup:'learning'},querySelectorAll(){return links.filter(link=>['courses','classroom','teaching'].includes(link.dataset.page));}});
  const admin=node({dataset:{navGroup:'administration'},hidden:!state.admin,querySelectorAll(){return links.filter(link=>['admin','applications'].includes(link.dataset.page));}});
  const sections=[learning,admin],more=node(),nav=node({querySelector(){return more;}}),close=node(),search=node(),last=node(),sidebar=node({querySelectorAll(selector){return selector==='#nav a[data-page]'?links:selector==='details[data-nav-group]'?sections:[close,search,last];},contains(target){return [close,search,last,...links].includes(target);}}),backdrop=node({hidden:true}),main=node(),account=node(),menuButton=node(),empty=node();
  const elements=new Map([['#mobileNav',nav],['#sidebar',sidebar],['#mobileMenuBackdrop',backdrop],['#mobileAccount',account],['#mobilePageSearch',search],['#mobileMenuClose',close],['#mobileMenuEmpty',empty],['.main',main],['#menuBtn',menuButton]]);
  document={...events(),activeElement:menuButton,documentElement:node(),querySelector(selector){return elements.get(selector)||null;}};
  const mq={...events(),matches:true},window={matchMedia(){return mq;}},calls=[];
  vm.runInNewContext(source,{document,window,queueMicrotask,Map,Set,console});
  let api;
  api=window.SpaceMobile.create({get:()=>state,esc:escape,icon:name=>`<svg data-icon="${escape(name)}"></svg>`,menu(open){calls.push(['menu',open]);api?.menuState(open);},action(name){calls.push(['action',name]);},viewportChange(){calls.push(['viewport']);}});
  const click=action=>document.fire('click',{target:{closest(selector){return selector==='[data-mobile-action]'?{dataset:{mobileAction:action}}:null;}},preventDefault(){}});
  return {api,state,document,mq,calls,links,sections,more,nav,close,search,last,sidebar,backdrop,main,account,menuButton,empty,click};
}
const tests=[];const test=(name,fn)=>tests.push([name,fn]);
test('Members get five clear tabs without administrative routes',()=>{
  const h=harness();assert.match(h.nav.innerHTML,/>Home</);assert.match(h.nav.innerHTML,/>Chat</);assert.match(h.nav.innerHTML,/>Learn</);assert.match(h.nav.innerHTML,/>Calendar</);assert.match(h.nav.innerHTML,/>More</);assert.doesNotMatch(h.nav.innerHTML,/#admin|#teaching|#investor-portal/);
});
test('Teachers reach Teaching studio directly while founders retain their workspace',()=>{
  const t=harness({teacher:true,allowed:['home','messages','teaching','calendar']});assert.match(t.nav.innerHTML,/href="#teaching"/);assert.match(t.nav.innerHTML,/>Teach</);
  const f=harness({founder:true,allowed:['home','messages','founder-room','calendar']});assert.match(f.nav.innerHTML,/href="#founder-room"/);assert.match(f.nav.innerHTML,/>Lead</);
});
test('Administrators have a Manage tab and an application badge',()=>{
  const h=harness({admin:true,pending:4,allowed:['home','messages','admin','calendar']});assert.match(h.nav.innerHTML,/href="#admin"/);assert.match(h.nav.innerHTML,/>Manage</);assert.match(h.nav.innerHTML,/4 unread/);
});
test('Investor tabs never include chat, learning or calendar',()=>{
  const h=harness({club:false,investor:true,allowed:['home','investor-portal','notifications','founders']});assert.match(h.nav.innerHTML,/>Portal</);assert.match(h.nav.innerHTML,/>Updates</);assert.doesNotMatch(h.nav.innerHTML,/#messages|#courses|#calendar/);
});
test('Pending accounts and guests do not receive approved-member navigation',()=>{
  for(const id of ['pending','']){const h=harness({id,approved:false,club:false,allowed:['home','application','privacy']});assert.equal(h.nav.hidden,true);assert.equal(h.nav.innerHTML,'');}
});
test('Every bottom destination must also be permitted by the existing navigation',()=>{
  const h=harness({admin:true,allowed:['home','calendar']});assert.doesNotMatch(h.nav.innerHTML,/#admin|#messages/);assert.match(h.nav.innerHTML,/#calendar/);
});
test('A read clears the bottom Chat badge without rebuilding the conversation',()=>{
  const h=harness();assert.match(h.nav.innerHTML,/3 unread/);h.state.messages=0;h.api.updateCounts();assert.doesNotMatch(h.nav.innerHTML,/3 unread|mobile-tab-badge/);
});
test('Unread display is capped and has an accessible label',()=>{
  const h=harness({messages:2400});assert.match(h.nav.innerHTML,/99\+ unread/);assert.match(h.nav.innerHTML,/>99\+</);
});
test('Nested classroom and channel pages highlight their parent tabs',()=>{
  const h=harness({page:'classroom'});assert.match(h.nav.innerHTML,/href="#courses" class="mobile-tab is-current"/);h.state.page='channels';h.api.sync();assert.match(h.nav.innerHTML,/href="#messages" class="mobile-tab is-current"/);
});
test('Phone Home shows at most three actions and two upcoming items',()=>{
  const h=harness({actions:Array.from({length:12},(_,i)=>({href:'#courses',title:'Task '+i})),agenda:Array.from({length:20},(_,i)=>({href:'#calendar',title:'Event '+i}))});
  const html=h.api.home();assert.match(html,/Task 2/);assert.doesNotMatch(html,/Task 3/);assert.match(html,/Event 1/);assert.doesNotMatch(html,/Event 2/);
});
test('Unpermitted action links and schedule entries are omitted',()=>{
  const h=harness({actions:[{href:'#admin',title:'Private admin entry'}],agenda:[{href:'#investor-portal',title:'Private investor entry'}]});assert.doesNotMatch(h.api.home(),/Private admin|Private investor/);
});
test('Names, task titles and event details are escaped before rendering',()=>{
  const h=harness({name:'<script>bad</script>',firstName:'<img src=x>',actions:[{href:'#courses',title:'<script>alert(1)</script>',detail:'<b>feedback</b>'}]});assert.doesNotMatch(h.api.home(),/<script>|<img src=x>|<b>feedback/);assert.match(h.api.home(),/&lt;script&gt;/);assert.doesNotMatch(h.account.innerHTML,/<script>/);
});
test('Guests receive a short introduction with working signup and sign-in actions',()=>{
  const h=harness({id:'',approved:false,club:false});const html=h.api.home();assert.match(html,/data-action="login"/);assert.match(html,/data-action="signin"/);assert.match(html,/href="about\/"/);assert.doesNotMatch(html,/Visible profiles|Unread direct messages/);
});
test('Opening More exposes a modal menu and moves focus to its close button',()=>{
  const h=harness();h.click('menu');assert.equal(h.backdrop.hidden,false);assert.equal(h.main.inert,true);assert.equal(h.nav.inert,true);assert.equal(h.sidebar.inert,false);assert.equal(h.sidebar.attributes['aria-modal'],'true');assert.equal(h.document.activeElement,h.close);
});
test('Closing More restores focus and makes the closed drawer inert',()=>{
  const h=harness();h.click('menu');h.click('close');assert.equal(h.main.inert,false);assert.equal(h.nav.inert,false);assert.equal(h.sidebar.inert,true);assert.equal(h.backdrop.hidden,true);assert.equal(h.document.activeElement,h.menuButton);
});
test('Escape and both ends of keyboard navigation are contained in the drawer',()=>{
  const h=harness();h.click('menu');let prevented=0;const event={key:'Tab',preventDefault(){prevented++;}};
  h.document.activeElement=h.last;h.document.fire('keydown',event);assert.equal(h.document.activeElement,h.close);
  h.document.fire('keydown',{...event,shiftKey:true});assert.equal(h.document.activeElement,h.last);
  h.document.fire('keydown',{key:'Escape',preventDefault(){prevented++;}});assert.equal(h.backdrop.hidden,true);assert.equal(prevented,3);
});
test('Page search never grants access to hidden administrator links',()=>{
  const h=harness();h.search.value='admin';h.document.fire('input',{target:h.search});const admin=h.links.find(l=>l.dataset.page==='admin');assert.equal(admin.hidden,true);assert.equal(h.empty.hidden,false);
});
test('Searching opens matching groups and clearing restores the previous disclosure state',()=>{
  const h=harness();h.sections[0].open=false;h.search.value='courses';h.document.fire('input',{target:h.search});assert.equal(h.sections[0].open,true);assert.equal(h.links.find(l=>l.dataset.page==='messages').dataset.mobileFiltered,'true');h.search.value='';h.document.fire('input',{target:h.search});assert.equal(h.sections[0].open,false);assert.equal(h.links[0].dataset.mobileFiltered,'false');
});
test('Accounts, appearance, sound and sign-out delegate to the existing controls',()=>{
  const h=harness({admin:true});for(const action of ['accounts','theme','sound','signout'])h.click(action);assert.deepEqual(h.calls.filter(c=>c[0]==='action').map(c=>c[1]),['accounts','theme','sound','signout']);assert.match(h.account.innerHTML,/data-mobile-action="signout"/);
});
test('An account change clears private identity and the previous menu search',()=>{
  const h=harness();h.search.value='Alice';h.state.id='';h.state.approved=false;h.api.sync();assert.equal(h.search.value,'');assert.doesNotMatch(h.account.innerHTML,/Alice/);assert.equal(h.nav.hidden,true);
});
test('Switching to desktop closes the drawer and releases inert states',()=>{
  const h=harness();h.click('menu');h.mq.matches=false;h.mq.fire('change');assert.equal(h.main.inert,false);assert.equal(h.sidebar.inert,false);assert.equal(h.backdrop.hidden,true);assert(h.calls.some(c=>c[0]==='viewport'));
});
test('Typing hides phone tabs and leaving the input restores them',async()=>{
  const h=harness();h.document.activeElement={matches(){return true;}};h.document.fire('focusin');assert.equal(h.document.documentElement.dataset.mobileKeyboard,'open');h.document.activeElement=h.menuButton;h.document.fire('focusout');await Promise.resolve();assert.equal(h.document.documentElement.dataset.mobileKeyboard,'closed');
});
let passed=0;
for(const [name,fn]of tests){try{await fn();passed++;console.log('PASS',name);}catch(error){process.exitCode=1;console.error('FAIL',name,error);}}
console.log(`${passed}/${tests.length} mobile shell checks passed`);
