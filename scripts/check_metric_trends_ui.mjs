import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../space-metric-trends.js',import.meta.url),'utf8');
const fakeToday='2024-03-01';
const rows=[
  {date:'2024-02-27',from:'2024-02-27',through:'2024-02-27',values:{orders_created:1,orders_collected:0}},
  {date:'2024-02-28',from:'2024-02-28',through:'2024-02-28',values:{orders_created:2,orders_collected:1}},
  {date:'2024-02-29',from:'2024-02-29',through:'2024-02-29',values:{orders_created:4,orders_collected:3}},
  {date:'2024-03-01',from:'2024-03-01',through:'2024-03-01',values:{orders_created:0,orders_collected:0}}
];
const sample={grain:'day',from:rows[0].from,through:rows.at(-1).through,unit:'count',series:['orders_created','orders_collected'],rows};
function testEnv(){
  const hooks={},result={innerHTML:''},positions=[],curr={innerHTML:''},host={open:true,querySelector(s){
    if(s==='[data-trend-result]')return result;if(s==='[data-trend-current]')return curr;
    if(s==='[data-trend-cursor]')return {setAttribute:(...a)=>positions.push(a)};return null;}};
  const document={querySelector:()=>host,addEventListener(n,fn){(hooks[n]??=[]).push(fn);}};
  class FixedDate extends Date{constructor(...a){super(...(a.length?a:['2024-03-01T01:00:00Z']));}}
  const ctx=vm.createContext({window:{},document,Intl,Date:FixedDate,setTimeout,clearTimeout});
  vm.runInContext(code,ctx);
  return {lib:ctx.window.SpaceMetricTrends,result,host,emit:(n,e)=>hooks[n]?.forEach(fn=>fn(e)),positions,curr};
}
const {lib}=testEnv();
const wait=()=>new Promise(resolve=>setImmediate(resolve));
let n=0;
async function check(label,fn){await fn();console.log('PASS',label);n++;}
await check('Daily, monthly and annual presets use real UTC boundaries and date filters are bounded',async()=>{
  assert.equal(lib.preset('day',fakeToday).from,'2024-02-01');
  assert.equal(lib.preset('month',fakeToday).from,'2023-04-01');
  assert.equal(lib.preset('year',fakeToday).from,'2020-01-01');
  assert.throws(()=>lib.validate({grain:'day',from:'2023-02-29',through:fakeToday},fakeToday),/valid dates/);
  assert.throws(()=>lib.validate({grain:'day',from:'2022-01-01',through:fakeToday},fakeToday),/366 days/);
  assert.throws(()=>lib.validate({grain:'year',from:'2024-02-29',through:'2034-02-28'},'2034-02-28'),/10 years/);
});
await check('Results reject missing, malformed and out-of-order dated buckets',async()=>{
  assert.equal(lib.checked(sample,sample,'orders').rows.length,4);
  assert.throws(()=>lib.checked({...sample,rows:rows.filter((_,i)=>i!==1)},sample,'orders'),/dates/);
  assert.throws(()=>lib.checked({...sample,rows:rows.slice(0,3)},sample,'orders'),/final/);
  assert.throws(()=>lib.checked({...sample,series:['orders_created','<svg>']},sample,'orders'),/incomplete/);
});
await check('Insights label the partial day and compare only complete periods',async()=>{
  const [copy]=lib.insights(sample,['orders_created'],fakeToday);
  assert.match(copy,/7 in this range/);assert.match(copy,/Peak: 4 \(2024-02-29\)/);assert.match(copy,/2 higher/);
  assert.doesNotMatch(copy,/4 lower/);
  const html=lib.report(sample,'orders_created',3,fakeToday);
  assert.match(html,/includes partial periods/);assert.match(html,/View exact values \(4 periods\)/);
  assert.match(html,/data-trend-point="3"/);assert.match(html,/Orders placed: <b>0<\/b>/);
});
await check('Zero activity is not treated as a trend and comparisons are escaped',async()=>{
  const [msg]=lib.insights({...sample,rows:rows.slice(0,1)},['orders_collected'],fakeToday);
  assert.match(msg,/no records/);
  const markup=lib.comparison('Current campuses',[{label:'<svg onload=alert(1)>',values:[8,2]},{label:'B',values:[4,1]}],['Active','Pending']);
  assert.match(markup,/Current snapshot/);assert.match(markup,/max="8" value="2"/);assert.doesNotMatch(markup,/<svg/);
});
await check('Finance comparison plots both approved amounts with one GHS scale',async()=>{
  const data={...sample,series:['income','expense'],unit:'GHS',rows:rows.map((r,i)=>({...r,values:{income:i===1?14.25:0,expense:i===2?3.10:0}}))};
  const html=lib.report(data,'pair',1,fakeToday);
  assert.match(html,/Approved income \(GHS\)/);assert.match(html,/Approved expenses \(GHS\)/);
  assert.match(html,/GHS 14\.25/);assert.match(html,/trend-series-1/);
});
await check('Manual observations plot real zero, gaps and targets separately',async()=>{
  const data={...sample,series:['actual','target'],unit:'hours',rows:rows.map((r,i)=>({...r,
    observed:[1,2].includes(i)?r.date:null,values:{actual:i===1?0:i===2?2.5:null,target:i===2?4:null}}))};
  assert.equal(lib.checked(data,sample,'manual').rows.length,4);
  const html=lib.report(data,'pair',3,fakeToday);
  assert.equal((html.match(/<circle/g)||[]).length,3);
  assert.match(html,/No observation/);
  assert.match(html,/Latest recorded value: 2\.5 hr on 2024-02-29/);
  assert.match(html,/Latest target: 4 hr · below target/);
  assert.match(html,/<td>0 hr<\/td>/);
  assert.throws(()=>lib.checked({...data,rows:[{...data.rows[0],values:{actual:0,target:null}},...data.rows.slice(1)]},sample,'manual'),/dates/);
});
await check('Load requests only after expansion, offers keyboard inspection and rejects stale results',async()=>{
  const env=testEnv();let actor={id:'A',generation:1,page:'orders',scope:'orders'},calls=[],queue=[];
  const controller=env.lib.create({id:'test',db:{rpc(name,args){calls.push({name,args});return Promise.resolve(queue.shift());}},get:()=>actor});
  assert.match(controller.view(),/Activity trends/);assert.equal(calls.length,0);
  const form={matches:()=>true,closest:()=>env.host,elements:{grain:{value:'day'},from:{value:sample.from},through:{value:sample.through}}};
  env.host.open=true;queue.push({data:sample});env.emit('submit',{target:form,preventDefault(){}});
  await wait();assert.equal(calls[0].name,'space_metric_trends');assert.match(env.result.innerHTML,/Orders placed/);
  env.emit('keydown',{key:'Home',target:{matches:()=>true,closest:()=>env.host},preventDefault(){}});
  assert.match(env.curr.innerHTML,/2024-02-27/);assert(env.positions.length);
  let resolve;queue.push(new Promise(r=>{resolve=r;}));env.emit('submit',{target:form,preventDefault(){}});
  actor={...actor,id:'B',generation:2};controller.sync();
  resolve({data:sample});await wait();assert.equal(env.result.innerHTML,'');
});
await check('Chapter office filter sends the selected chapter and authorised office only',async()=>{
  const env=testEnv(),calls=[];
  const actor={id:'coordinator',generation:2,page:'chapter-admin',scope:'chapter',target:'campus-a',offices:[['secretary','Secretary']]};
  const data={...sample,series:['tasks_assigned','tasks_completed'],rows:rows.map(r=>({...r,values:{tasks_assigned:1,tasks_completed:0}}))};
  const controller=env.lib.create({id:'test',db:{rpc(name,args){calls.push({name,args});return Promise.resolve({data});}},get:()=>actor});
  assert.match(controller.view(),/Secretary tasks/);
  env.host.open=true;
  env.emit('submit',{target:{matches:()=>true,closest:()=>env.host,elements:{grain:{value:'day'},from:{value:sample.from},through:{value:sample.through},office:{value:'secretary'}}},preventDefault(){}});
  await wait();assert.equal(calls[0].name,'space_chapter_metric_trends');assert.equal(calls[0].args.p_chapter,'campus-a');assert.equal(calls[0].args.p_office,'secretary');
});
console.log(n+' trend UI checks passed.');
