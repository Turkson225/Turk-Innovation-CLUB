import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDataCenter,dataCenterCsv} from '../assets/space-data-center.js';
import {canOpenWorkspacePage,pages} from '../workspace-navigation.js';

let page={page:'data-center',id:'admin',admin:true,generation:1},errors=[],requests=[],waits=[],files=[];
const nextTick=()=>new Promise(r=>setImmediate(r));
function harness(){
  const listeners={};
  const doc={addEventListener(name,cb){listeners[name]=cb;}};
  const center=createDataCenter({current:()=>page,now:()=>Date.parse('2026-11-24T12:00Z'),
    rpc(name,args){requests.push({name,args});return new Promise(resolve=>waits.push(resolve));},
    redraw(){},authFailure:e=>errors.push(e),download:(...args)=>files.push(args)});
  center.bind(doc);
  const event=(label,data={})=>listeners.click({target:{closest(){return {dataset:{[label]:data.value},
    hasAttribute:n=>n==='data-dc-retry'&&label==='retry',closest:()=>data.form};}}});
  const form=(from='2026-11-01',to='2026-11-24',dataset='profiles')=>({reportValidity:()=>true,matches:()=>true,
    elements:{dataset:{value:dataset},from:{value:from},to:{value:to}}});
  return {center,event,form,submit:f=>listeners.submit({target:f,preventDefault(){}})};
}
const catalog={started_at:'2026-11-24T00:00:00Z',datasets:[
  {id:'profiles',records:true,has_date:true,area:'Membership',title:'Members',columns:['full_name']},
  {id:'direct_messages',records:false,has_date:false,area:'Community',title:'Direct messages (counts)',columns:[]}
]};
function respond(data,error=null){const resolve=waits.shift();assert(resolve);resolve({data,error});}
const h=harness();
assert(pages.includes('data-center'));
assert(canOpenWorkspacePage('data-center',{admin:true}));
assert(!canOpenWorkspacePage('data-center',{admin:false,club:true}));
assert.match(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),/data-page="data-center" data-admin hidden/);
h.center.sync();assert.equal(requests[0].name,'space_data_center_catalog');
respond(catalog);await nextTick();
assert.match(h.center.view(),/Current records[\s\S]*Change history[\s\S]*Daily activity/);
assert.doesNotMatch(h.center.view(),/Direct messages/);
h.submit(h.form());
assert.equal(requests.at(-1).args.p_limit,75);assert.equal(requests.at(-1).args.p_export,false);
respond({columns:['full_name'],rows:[{full_name:'<script>unsafe</script>'}],next_cursor:{cutoff:'2026-11-24'},as_of:'2026-11-24'});
await nextTick();
assert.match(h.center.view(),/&lt;script&gt;unsafe/);
assert.doesNotMatch(h.center.view(),/<script>/);
h.event('dcPage',{value:'next'});
assert.deepEqual(requests.at(-1).args.p_cursor,{cutoff:'2026-11-24'});
respond({columns:['full_name'],rows:[{full_name:'Member 2'}],next_cursor:null});await nextTick();
assert.match(h.center.view(),/Page 2/);
h.event('dcExport',{value:'csv',form:h.form()});
assert.equal(requests.at(-1).args.p_export,true);
respond({columns:['full_name'],rows:[{full_name:'"=unsafe"'}],next_cursor:{offset:1},as_of:'2026-11-24'});
await nextTick();
assert.deepEqual(requests.at(-1).args.p_cursor,{offset:1});
respond({columns:['full_name'],rows:[{full_name:'=unsafe-formula'}],next_cursor:null});await nextTick();
assert.equal(files.length,1);assert.match(files[0][1],/"'=unsafe-formula"/);
assert.match(dataCenterCsv(['n'],[{n:'\tfirst'},{n:'＋formula'}]),/"'\tfirst"[\s\S]*"'＋formula"/);
h.event('dcMode',{value:'totals'});
assert.match(h.center.view(),/Direct messages \(counts\)/);
h.event('dcExport',{value:'json',form:h.form('2026-11-22','2026-11-24','direct_messages')});
assert.equal(requests.at(-1).args.p_mode,'totals');
respond(null,{code:'42501',details:'SPACE_ADMIN_MFA_RECENT_REQUIRED'});await nextTick();
assert.equal(errors.length,1);assert.equal(files.length,1);
h.event('dcExport',{value:'json',form:h.form('2026-11-22','2026-11-24','direct_messages')});
page={page:'home',id:'another',admin:false,generation:2};
h.center.sync();
respond({columns:['day','total'],rows:[{day:'2026-11-22',total:15}],next_cursor:null});
await nextTick();
assert.equal(files.length,1);
assert.equal(h.center.view(),'');
console.log('PASS admin routing, filter and export paging, safe CSV/rendering, MFA handling, and account-switch isolation');
