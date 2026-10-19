/* SPACE metrics: read-only aggregates, lazy loading, account-scoped memory only. */
(() => {
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 20h17M7 16v-5m6 5V5m6 11V8" stroke-linecap="round"/></svg>';
 const number=n=>typeof n==='number'&&Number.isFinite(n);
 function value(n,unit='') {
  if(!number(n))return '—';
  if(unit==='GHS')return new Intl.NumberFormat(undefined,{style:'currency',currency:'GHS',maximumFractionDigits:2}).format(n);
  if(unit==='percent')return n.toLocaleString(undefined,{maximumFractionDigits:1})+'%';
  if(unit==='seconds')return n<60?Math.round(n)+' sec':n<3600?Math.round(n/60)+' min':n<86400?(n/3600).toFixed(1)+' hr':(n/86400).toFixed(1)+' days';
  return n.toLocaleString(undefined,{maximumFractionDigits:1});
 }
 function scopeFor(s) {
  if(!s.allowed)return null;
  const target=s.page==='classroom'?s.course||null:null;
  if(s.page==='messages')return {scope:'dm',target:s.peer||null};
  if(s.page==='channels')return s.channel?{scope:'channel',target:s.channel}:null;
  if(s.page==='home')return {scope:s.admin?'membership':s.teacher?'teaching':'learning',target:null};
  if(['admin','applications'].includes(s.page))return s.admin?{scope:'membership',target:null}:null;
  if(s.page==='courses')return {scope:'learning',target:null};
  if(s.page==='teaching')return s.teacher?{scope:'teaching',target:null}:null;
  if(s.page==='classroom')return {scope:s.managesCourse?'teaching':'learning',target};
  if(s.page==='inventory')return {scope:'inventory',target:null};
  if(['finance','finance-review'].includes(s.page))return s.admin?{scope:'finance',target:null}:null;
  if(['orders','order-desk','shop-admin'].includes(s.page))return ['order-desk','shop-admin'].includes(s.page)&&!s.admin?null:{scope:'orders',target:null};
  return null;
 }
 function chart(c,index) {
  const rows=(Array.isArray(c.rows)?c.rows:[]).slice(0,90).filter(r=>typeof r.label==='string'&&number(r.value)&&r.value>=0);
  const max=Math.max(0,...rows.map(r=>r.value)),daily=c.kind==='daily',unit=c.unit||'';
  const title=esc(c.title),id='space-metrics-chart-'+index;
  const exact=rows.map(r=>`<tr><th scope="row">${esc(r.label)}</th><td>${esc(value(r.value,unit))}</td></tr>`).join('');
  const marks=daily?`<div class="metrics-daily" role="group" aria-label="${title}">${rows.map(r=>`<span class="metrics-day" tabindex="0" aria-label="${esc(r.label)}: ${esc(value(r.value,unit))}"><i style="height:${max?r.value/max*100:0}%"></i><span class="metrics-tip">${esc(r.label)}<b>${esc(value(r.value,unit))}</b></span></span>`).join('')}</div><div class="metrics-axis"><span>${esc(rows[0]?.label||'')}</span><span>0–${esc(value(max,unit))}</span><span>${esc(rows.at(-1)?.label||'')}</span></div>`:
   `<div class="metrics-bars">${rows.map(r=>`<div class="metrics-bar"><span>${esc(r.label.replaceAll('_',' '))}</span><strong>${esc(value(r.value,unit))}</strong><div class="metrics-track"><i style="width:${max?r.value/max*100:0}%"></i></div></div>`).join('')}</div>`;
  return `<figure class="metrics-chart" aria-labelledby="${id}"><figcaption id="${id}">${title}${unit==='GHS'?'<small>GHS</small>':''}</figcaption>${!max?'<p class="metrics-empty">No recorded activity for this chart.</p>':''}${rows.length?marks:'<p>No records available.</p>'}<details class="metrics-data"><summary>View exact values</summary><div class="metrics-table-wrap"><table><caption class="sr-only">${title}</caption><thead><tr><th scope="col">${daily?'Date (UTC)':'Category'}</th><th scope="col">${unit==='GHS'?'Amount (GHS)':'Count'}</th></tr></thead><tbody>${exact||'<tr><td colspan="2">No records</td></tr>'}</tbody></table></div></details></figure>`;
 }
 function report(data) {
  if(!data||!Array.isArray(data.kpis)||!Array.isArray(data.charts))return '<p>Metrics could not be read. Please refresh.</p>';
  const date=new Date(data.generated_at),stamp=Number.isFinite(date.getTime())?date.toLocaleString():'time unavailable';
  return `<div class="metrics-kpis">${data.kpis.slice(0,6).map(k=>`<article class="metrics-kpi"><h3>${esc(k.label)}</h3><strong>${esc(value(k.value,k.unit))}</strong><p>${esc(k.detail)}</p></article>`).join('')}</div><p class="metrics-period">${data.scope==='inventory'?'Current snapshot':esc(data.from)+' – '+esc(data.through)+' · UTC · includes today (partial)'}</p><div class="metrics-charts">${data.charts.slice(0,3).map(chart).join('')}</div><details class="metrics-definitions"><summary>How these metrics are counted</summary><ul>${(data.notes||[]).slice(0,8).map(n=>`<li>${esc(n)}</li>`).join('')}</ul><p>Source: SPACE records available to your account through existing access rules.</p></details><p class="metrics-updated">Updated ${esc(stamp)} · refresh to include newer changes.</p>`;
 }
 function create(ctx) {
  let identity='',epoch=0,days=30,dialog=null,dialogKey='',selection=null,opener=null;
  const cache=new Map(),pending=new Map(),opened=new Set();
  const actor=()=>ctx.get();
  const stamp=s=>[s.id,s.generation,s.allowed,s.admin,s.teacher,s.managesCourse].join(':');
  const context=s=>[stamp(s),s.page,s.peer||'',s.channel||'',s.course||''].join(':');
  const current=()=>selection||scopeFor(actor());
  const key=(s,scope)=>[stamp(s),scope.scope,scope.target||'',days].join(':');
  function closeDialog(){if(dialog){dialog.close();dialog.remove();dialog=null;}selection=null;dialogKey='';if(opener?.isConnected)opener.focus({preventScroll:true});opener=null;}
  function reset(){epoch++;cache.clear();pending.clear();opened.clear();closeDialog();identity='';document.querySelectorAll('[data-metrics-body]').forEach(n=>{n.innerHTML='';});}
  function check(){const s=actor(),id=stamp(s);if(identity!==id){reset();identity=id;}if(dialog&&(dialogKey!==context(s)||!s.allowed))closeDialog();return s;}
  function button(kind='conversation') {if(!actor().allowed)return '';return `<button type="button" class="metrics-chat-button" data-metrics-action="open" data-metrics-kind="${kind==='inbox'?'inbox':'conversation'}" aria-label="${kind==='inbox'?'My messaging statistics':'Conversation insights'}" title="${kind==='inbox'?'My messaging statistics':'Conversation insights'}">${icon}<span class="sr-only">Insights</span></button>`;}
  function controls(scope){return `<div class="metrics-toolbar">${scope.scope==='inventory'?'<span>Current stock records</span>':`<label>Period <select data-metrics-days aria-label="Metrics reporting period">${[7,30,90].map(n=>`<option value="${n}" ${days===n?'selected':''}>Last ${n} days</option>`).join('')}</select></label>`}<button type="button" class="text-button" data-metrics-action="refresh">Refresh</button><span data-metrics-status role="status"></span></div><div data-metrics-body></div>`;}
  function view() {
   const s=check(),scope=scopeFor(s);if(!scope||['dm','channel'].includes(scope.scope))return '';
   return `<details class="space-metrics" data-space-metrics ${opened.has(context(s))?'open':''}><summary>${icon}<span>Metrics &amp; progress</span><small>View charts</small></summary>${controls(scope)}</details>`;
  }
  function host(){return dialog||document.querySelector('[data-space-metrics][open]');}
  function paint(entry,loading=false) {
   const h=host();if(!h)return;const body=h.querySelector('[data-metrics-body]'),status=h.querySelector('[data-metrics-status]');if(!body)return;
   if(status)status.textContent=loading?'Updating…':entry?.error?'Could not update':'';
   body.setAttribute('aria-busy',String(loading));
   if(entry?.data)body.innerHTML=report(entry.data)+(entry.error?'<p class="metrics-error" role="status">Showing the previous result. Refresh to try again.</p>':'');
   else body.innerHTML=entry?.missing?'<p class="metrics-empty">Metrics are awaiting administrator setup. Your other pages remain available.</p>':entry?.error?'<p class="metrics-error" role="status">Metrics could not load. Check your connection and select Refresh.</p>':'<div class="metrics-loading" role="status">Loading your metrics…<span></span></div>';
  }
  async function load(force=false) {
   const s=check(),scope=current();if(!s.allowed||!scope||!host())return;
   const k=key(s,scope),previous=cache.get(k),version=epoch,owner=stamp(s),place=context(s),requestedDays=days;
   if(pending.has(k)){await pending.get(k);if(epoch===version&&place===context(actor())&&days===requestedDays&&actor().allowed&&current()?.scope===scope.scope&&current()?.target===scope.target)paint(cache.get(k));return;}
   if(previous&&!force&&Date.now()-previous.at<60000){paint(previous);return;}
   if(force&&previous&&Date.now()-previous.at<3000){paint(previous);return;}
   if(navigator.onLine===false){paint({...previous,error:true});return;}
   paint(previous,true);
   let timer;const task=(async()=>{
    let entry;
    try {
     const result=await Promise.race([ctx.db.rpc('space_metrics',{p_scope:scope.scope,p_days:requestedDays,p_target:scope.target}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),12000);})]);
     if(result.error)throw result.error;
     if(!result.data||result.data.scope!==scope.scope||!Array.isArray(result.data.kpis)||!Array.isArray(result.data.charts))throw Error('Invalid metrics result');
     entry={data:result.data,at:Date.now()};
    } catch(error) {
     const missing=['PGRST202','42883'].includes(error?.code),denied=error?.code==='42501';
     entry={...(denied?{}:previous),error:true,missing,at:Date.now()};
    } finally {clearTimeout(timer);if(epoch===version)pending.delete(k);}
    if(epoch!==version||stamp(actor())!==owner||!actor().allowed)return;
    cache.set(k,entry);while(cache.size>12)cache.delete(cache.keys().next().value);
    if(place===context(actor())&&days===requestedDays&&current()?.scope===scope.scope&&current()?.target===scope.target)paint(entry);
   })();pending.set(k,task);return task;
  }
  function sync(root) {const s=check();if(!root){if(dialog)closeDialog();return;}if(!s.allowed)return;if(host())void load();}
  document.addEventListener('toggle',event=>{const details=event.target;if(!details?.matches?.('[data-space-metrics]'))return;const s=check();if(details.open){opened.add(context(s));void load();}else opened.delete(context(s));},true);
  document.addEventListener('change',event=>{if(!event.target.matches?.('[data-metrics-days]'))return;const next=Number(event.target.value);if(![7,30,90].includes(next))return;days=next;void load();});
  document.addEventListener('click',event=>{
   const b=event.target.closest?.('[data-metrics-action]');if(!b)return;
   const action=b.dataset.metricsAction;if(action==='close'){closeDialog();return;}if(action==='refresh'){void load(true);return;}
   if(action!=='open')return;
   const s=check();if(!s.allowed)return;const scope=b.dataset.metricsKind==='inbox'&&s.page==='messages'?{scope:'dm',target:null}:scopeFor(s);if(!scope||!['dm','channel'].includes(scope.scope))return;
   closeDialog();selection=scope;dialogKey=context(s);opener=b;
   dialog=document.createElement('dialog');dialog.className='metrics-dialog';dialog.setAttribute('aria-labelledby','metrics-dialog-title');
   dialog.innerHTML=`<div class="metrics-dialog-head"><div><span class="eyebrow">CHAT ACTIVITY</span><h2 id="metrics-dialog-title">${scope.scope==='channel'?'Channel insights':scope.target?'Conversation insights':'My messaging activity'}</h2></div><button type="button" class="metrics-close" data-metrics-action="close" aria-label="Close insights">×</button></div>${controls(scope)}`;
   dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});document.body.append(dialog);dialog.showModal();void load();
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&host())void load();});
  return {view,button,sync,reset,load};
 }
 window.SpaceMetrics={create,scopeFor,report,chart,value};
})();
