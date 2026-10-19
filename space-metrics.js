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
  if(['messages','channels'].includes(s.page))return null;
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
 const tones=['blue','purple','orange','green','rose','slate'];
 const pieIds=new Set(['membership-status','inventory-types','order-status','dm-direction']);
 function tone(label,index=0) {
  const v=String(label||'').toLowerCase();
  const inventory={component:'blue',tool:'orange',equipment:'purple',consumable:'green',other:'slate'};
  if(Object.hasOwn(inventory,v))return inventory[v];
  if(/suspend/.test(v))return 'slate';
  if(/cancel|reject|repair|revision/.test(v))return 'rose';
  if(/approved|accept|complet|delivered|income/.test(v))return 'green';
  if(/pending|await|low stock|expense/.test(v))return 'orange';
  if(/sent|ready|equipment/.test(v))return 'purple';
  if(/receiv|process|active|component/.test(v))return 'blue';
  return tones[(v?[...v].reduce((n,c)=>n+c.charCodeAt(0),0):index)%tones.length];
 }
 function chart(c,index,choice) {
  const rows=(Array.isArray(c.rows)?c.rows:[]).slice(0,90).filter(r=>typeof r.label==='string'&&number(r.value)&&r.value>=0);
  const max=Math.max(0,...rows.map(r=>r.value)),total=rows.reduce((n,r)=>n+r.value,0),daily=c.kind==='daily',unit=c.unit||'';
  const eligible=!daily&&!unit&&pieIds.has(c.id)&&rows.length<=6;
  const pie=eligible&&choice!=='bar',title=esc(c.title),id='space-metrics-chart-'+index;
  const exact=rows.map(r=>`<tr><th scope="row">${esc(r.label)}</th><td>${esc(value(r.value,unit))}</td></tr>`).join('');
  let marks;
  if(pie&&total>0){let offset=0;const slices=rows.map((r,i)=>{const share=100*r.value/total,start=offset;offset+=share;if(!share)return '';return `<circle class="metrics-pie-slice tone-${tone(r.label,i)}" cx="60" cy="60" r="43" pathLength="100" fill="none" stroke-width="18" stroke-dasharray="${share} ${100-share}" stroke-dashoffset="${-start}" transform="rotate(-90 60 60)" tabindex="0" role="img" aria-label="${esc(r.label)}: ${esc(value(r.value))}, ${share.toFixed(1)}% of total"><title>${esc(r.label)} · ${esc(value(r.value))} · ${share.toFixed(1)}%</title></circle>`;}).join('');marks=`<div class="metrics-pie-layout"><div class="metrics-donut"><svg viewBox="0 0 120 120" aria-label="${title}">${slices}</svg><div class="metrics-donut-total"><strong>${esc(value(total))}</strong><small>Total</small></div></div><ul class="metrics-legend">${rows.map((r,i)=>`<li><i class="tone-${tone(r.label,i)}"></i><span>${esc(r.label.replaceAll('_',' '))}</span><strong>${esc(value(r.value))}<small>${(100*r.value/total).toFixed(1)}%</small></strong></li>`).join('')}</ul></div>`;}
  else if(daily)marks=`<div class="metrics-daily" role="group" aria-label="${title}">${rows.map(r=>`<span class="metrics-day" tabindex="0" aria-label="${esc(r.label)}: ${esc(value(r.value,unit))}"><i style="height:${max?r.value/max*100:0}%"></i><span class="metrics-tip">${esc(r.label)}<b>${esc(value(r.value,unit))}</b></span></span>`).join('')}</div><div class="metrics-axis"><span>${esc(rows[0]?.label||'')}</span><span>0–${esc(value(max,unit))}</span><span>${esc(rows.at(-1)?.label||'')}</span></div>`;
  else marks=`<div class="metrics-bars">${rows.map((r,i)=>`<div class="metrics-bar"><span><i class="metrics-key tone-${tone(r.label,i)}"></i>${esc(r.label.replaceAll('_',' '))}</span><strong>${esc(value(r.value,unit))}</strong><div class="metrics-track"><i class="tone-${tone(r.label,i)}" style="width:${max?r.value/max*100:0}%"></i></div></div>`).join('')}</div>`;
  const toggle=eligible?`<div class="metrics-chart-switch" role="group" aria-label="${title} chart style"><button type="button" data-metrics-action="chart-mode" data-chart="${esc(c.id)}" data-view="pie" aria-pressed="${pie}">Pie</button><button type="button" data-metrics-action="chart-mode" data-chart="${esc(c.id)}" data-view="bar" aria-pressed="${!pie}">Bars</button></div>`:'';
  return `<figure class="metrics-chart" aria-labelledby="${id}"><figcaption id="${id}">${title}${unit==='GHS'?'<small>GHS</small>':''}</figcaption>${toggle}${!max?'<p class="metrics-empty">No recorded activity for this chart.</p>':''}${rows.length?marks:'<p>No records available.</p>'}<details class="metrics-data"><summary>View exact values</summary><div class="metrics-table-wrap"><table><caption class="sr-only">${title}</caption><thead><tr><th scope="col">${daily?'Date (UTC)':'Category'}</th><th scope="col">${unit==='GHS'?'Amount (GHS)':'Count'}</th></tr></thead><tbody>${exact||'<tr><td colspan="2">No records</td></tr>'}</tbody></table></div></details></figure>`;
 }
 function insightRows(d) {
  const out=[],k=label=>d.kpis?.find(k=>k.label===label)?.value;
  const add=(text,href,label)=>out.push({text,href,label});
  if(d.scope==='membership'&&k('Pending applications')>0)add(`${value(k('Pending applications'))} applications are currently awaiting approval.`,'#applications','Review applications');
  if(['learning','teaching'].includes(d.scope)){
   const rows=d.charts?.find(c=>c.id==='learning-attempts')?.rows||[],waiting=rows.find(r=>r.label==='Awaiting feedback')?.value,revisions=rows.find(r=>r.label==='Revision requested')?.value;
   if(waiting>0)add(`${value(waiting)} submission attempts created in this period are still awaiting feedback.`,d.scope==='teaching'?'#teaching':'#courses',d.scope==='teaching'?'Open review queue':'Open my learning');
   if(revisions>0)add(`${value(revisions)} submission attempts created in this period currently request revision.`,'#courses','Open learning');
   if(number(k('Completion share')))add(`${value(k('Completed enrollments'))} completed enrollments represent ${value(k('Completion share'),'percent')} of all enrollments in this scope. Enrollment cards include all dates.`);
  }
  if(d.scope==='inventory'){
   if(k('Low stock')>0)add(`${value(k('Low stock'))} usable stock records are at or below their reorder levels.`,'#inventory','Review stock');
   if(k('Needs repair')>0)add(`${value(k('Needs repair'))} stock records are marked as needing repair.`,'#inventory','Review inventory');
  }
  if(d.scope==='finance'&&number(k('Net movement'))){const net=k('Net movement');add(net<0?`Approved expenses exceed approved income by ${value(-net,'GHS')} in this period. This excludes the opening balance.`:`Approved net movement is ${value(net,'GHS')} in this period. This excludes the opening balance.`,'#finance','Review ledger');}
  if(d.scope==='orders'&&k('In progress')>0)add(`${value(k('In progress'))} orders placed in this period are currently pending, processing or ready.`,null,null);
  if(d.scope==='dm'&&k('Unread in period')>0)add(`${value(k('Unread in period'))} received messages from this period are beyond your saved read position. This can differ from the all-time inbox badge.`);
  if(d.scope==='channel'&&k('Messages')>0)add(`${value(k('Thread replies'))} of ${value(k('Messages'))} non-deleted messages in this period are thread replies. This is a message mix, not a satisfaction score.`);
  const daily=d.charts?.find(c=>c.kind==='daily')?.rows||[],peak=Math.max(0,...daily.map(r=>number(r.value)?r.value:0));
  if(peak>0){const ties=daily.filter(r=>r.value===peak).length;add(`The highest recorded daily count is ${value(peak)}, reached on ${ties} ${ties===1?'day':'days'} in the selected UTC period.`);}
  return out.slice(0,3);
 }
 function insightMarkup(d){const rows=insightRows(d);return `<section class="metrics-insights" aria-label="Meaningful insights"><h3>At a glance</h3><p class="metrics-insight-scope">Based on this scope and its labelled periods.</p>${rows.length?`<ul>${rows.map(r=>`<li>${esc(r.text)}${r.href?` <a href="${esc(r.href)}">${esc(r.label)} →</a>`:''}</li>`).join('')}</ul>`:'<p>No additional insight is supported by the current figures. Empty data is not a performance judgement.</p>'}</section>`;}
 function manualAllowed(s,scope){return s.allowed&&scope&&!['dm','channel'].includes(scope.scope)&&(s.admin||s.teacher&&scope.scope==='teaching');}
 function manualValue(n,unit){if(!number(n))return '—';return unit==='GHS'?value(n,unit):n.toLocaleString(undefined,{maximumFractionDigits:2})+(unit==='percent'?'%':'');}
 function manualEntryMarkup(entry,history=false){const target=number(entry.target)?entry.target:null,gap=target===null?null:entry.actual-target;const diff=gap===null?'':gap>=0?'Target reached':entry.unit==='percent'?manualValue(-gap,'count')+' percentage points below target':manualValue(-gap,entry.unit)+' below target';return `<article class="metrics-manual-record"><div><span class="metrics-manual-badge">MANUAL · revision ${esc(entry.revision)}</span><h3>${esc(entry.label)}</h3><strong>${esc(manualValue(entry.actual,entry.unit))}${entry.unit==='hours'?' hr':''}</strong>${target!==null?`<p>Target: ${esc(manualValue(target,entry.unit))}${entry.unit==='hours'?' hr':''} · ${esc(diff)}</p>`:'<p>No target set.</p>'}<p>${esc(entry.observed_on)}${entry.course_title?' · '+esc(entry.course_title):''}</p><p><b>Source:</b> ${esc(entry.source)}</p>${entry.note?`<p>${esc(entry.note)}</p>`:''}<small>Recorded ${esc(new Date(entry.created_at).toLocaleString())} · ${entry.is_mine?'by you':'by another authorised editor'}</small></div>${history?'':`<div class="metrics-manual-actions"><button type="button" class="text-button" data-metrics-action="manual-correct" data-id="${esc(entry.id)}">Correct entry</button><button type="button" class="text-button" data-metrics-action="manual-history" data-id="${esc(entry.root_id)}">History</button></div>`}</article>`;}
 function report(data,options={}) {
  if(!data||!Array.isArray(data.kpis)||!Array.isArray(data.charts))return '<p>Metrics could not be read. Please refresh.</p>';
  const date=new Date(data.generated_at),stamp=Number.isFinite(date.getTime())?date.toLocaleString():'time unavailable';
  return `<div class="metrics-kpis">${data.kpis.slice(0,6).map((k,i)=>`<article class="metrics-kpi tone-${tone(k.label,i)}"><h3>${esc(k.label)}</h3><strong>${esc(value(k.value,k.unit))}</strong><p>${esc(k.detail)}</p></article>`).join('')}</div><p class="metrics-period">${data.scope==='inventory'?'Current snapshot':esc(data.from)+' – '+esc(data.through)+' · UTC · includes today (partial)'}</p>${insightMarkup(data)}<div class="metrics-charts">${data.charts.slice(0,3).map((c,i)=>chart(c,i,options.modes?.[c.id])).join('')}</div>${manualAllowed(options,{scope:data.scope})?'<section class="metrics-manual-intro"><h3>Manual measurements &amp; targets</h3><p>Record offline results, sources and optional targets separately from automatic totals.</p><button type="button" class="button button-outline button-sm" data-metrics-action="manual-open">Open manual records</button></section>':''}<details class="metrics-definitions"><summary>How these metrics are counted</summary><ul>${(data.notes||[]).slice(0,8).map(n=>`<li>${esc(n)}</li>`).join('')}</ul><p>Source: SPACE records available to your account through existing access rules.</p></details><p class="metrics-updated">Updated ${esc(stamp)} · refresh to include newer changes.</p>`;
 }
 function create(ctx) {
  let identity='',epoch=0,days=30;
  const cache=new Map(),pending=new Map(),opened=new Set(),modes={};
  let editor=null,editorContext='',manualScope=null,manualOffset=0,manualRoot=null,manualRows=[],manualRequest=0,saving=false;
  const actor=()=>ctx.get();
  const stamp=s=>[s.id,s.generation,s.allowed,s.admin,s.teacher,s.managesCourse].join(':');
  const context=s=>[stamp(s),s.page,s.peer||'',s.channel||'',s.course||''].join(':');
  const current=()=>scopeFor(actor());
  const key=(s,scope)=>[stamp(s),scope.scope,scope.target||'',days].join(':');
  function closeEditor(){manualRequest++;if(editor){editor.close();editor.remove();editor=null;}editorContext='';manualScope=null;manualRows=[];saving=false;}
  function reset(){epoch++;cache.clear();pending.clear();opened.clear();closeEditor();identity='';document.querySelectorAll('[data-metrics-body]').forEach(n=>{n.innerHTML='';});}
  function check(){const s=actor(),id=stamp(s);if(identity!==id){reset();identity=id;}if(editor&&(editorContext!==context(s)||!s.allowed))closeEditor();return s;}
  function controls(scope){return `<div class="metrics-toolbar">${scope.scope==='inventory'?'<span>Current stock records</span>':`<label>Period <select data-metrics-days aria-label="Metrics reporting period">${[7,30,90].map(n=>`<option value="${n}" ${days===n?'selected':''}>Last ${n} days</option>`).join('')}</select></label>`}<button type="button" class="text-button" data-metrics-action="refresh">Refresh</button><span data-metrics-status role="status"></span></div><div data-metrics-body></div>`;}
  function view() {
   const s=check(),scope=scopeFor(s);if(!scope||['dm','channel'].includes(scope.scope))return '';
   return `<details class="space-metrics" data-space-metrics ${opened.has(context(s))?'open':''}><summary>${icon}<span>Metrics &amp; progress</span><small>View charts</small></summary>${controls(scope)}</details>`;
  }
  function host(){return document.querySelector('[data-space-metrics][open]');}
  function paint(entry,loading=false) {
   const h=host();if(!h)return;const body=h.querySelector('[data-metrics-body]'),status=h.querySelector('[data-metrics-status]');if(!body)return;
   if(status)status.textContent=loading?'Updating…':entry?.error?'Could not update':'';
   body.setAttribute('aria-busy',String(loading));
   if(entry?.data)body.innerHTML=report(entry.data,{...actor(),modes})+(entry.error?'<p class="metrics-error" role="status">Showing the previous result. Refresh to try again.</p>':'');
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
  function sync(root) {const s=check();if(!root)return;if(!s.allowed)return;if(host())void load();}
  function editorBody(){return editor?.querySelector('[data-manual-content]');}
  function editorValid(request){return !!editor&&request===manualRequest&&editorContext===context(actor())&&manualAllowed(actor(),manualScope);}
  async function request(name,args){let timer;try{const r=await Promise.race([ctx.db.rpc(name,args),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Request timed out. Check records before retrying.')),12000);})]);if(r.error)throw r.error;return r.data;}finally{clearTimeout(timer);}}
  async function manualList(){
   if(!editor||!manualAllowed(actor(),manualScope))return;
   const token=++manualRequest,scope={...manualScope};editorBody().innerHTML='<p role="status">Loading manual records…</p>';
   try{const data=await request('space_manual_metric_list',{p_scope:scope.scope,p_days:days,p_course:scope.target,p_offset:manualOffset,p_root:manualRoot});if(!editorValid(token))return;
    if(!data||!Array.isArray(data.entries))throw Error('Manual records could not be read.');manualRows=data.entries;
    const canAdd=actor().admin||scope.scope==='teaching'&&!!scope.target;
    editorBody().innerHTML=`<p class="metrics-period">${manualRoot?'Correction history · all observation dates':`Observations in the last ${days} UTC days`}</p><p class="metrics-manual-explain">Manual observations are visible to administrators and their recording teacher. They never change automatic totals, stock quantities, order status or the finance ledger.</p>${manualRoot?'<button type="button" class="text-button" data-metrics-action="manual-back">← Current records</button>':canAdd?'<button type="button" class="button button-sm" data-metrics-action="manual-add">+ Record a measurement</button>':'<p>Open a workshop’s classroom to record a measurement for that class.</p>'}${manualRows.map(r=>manualEntryMarkup(r,!!manualRoot)).join('')||'<p class="metrics-empty">No manual records for this view. No values have been assumed.</p>'}<div class="metrics-manual-pager"><button type="button" class="text-button" data-metrics-action="manual-prev" ${manualOffset===0?'disabled':''}>Previous</button><span>${Number(data.total)||0} records · page ${1+manualOffset/20}</span><button type="button" class="text-button" data-metrics-action="manual-next" ${manualOffset+20>=Number(data.total)?'disabled':''}>Next</button></div>`;
   }catch(error){if(editorValid(token))editorBody().innerHTML=`<p role="status">${['PGRST202','42883'].includes(error?.code)?'Manual entries are awaiting administrator setup. Your other metrics remain available.':'Manual records could not load. Please retry.'}</p><button type="button" class="text-button" data-metrics-action="manual-back">Retry</button>`;}
  }
  function openEditor(){const s=check(),scope=scopeFor(s);if(!manualAllowed(s,scope))return;closeEditor();manualScope=scope;editorContext=context(s);manualOffset=0;manualRoot=null;
   editor=document.createElement('dialog');editor.className='metrics-dialog metrics-manual-dialog';editor.setAttribute('aria-labelledby','metrics-manual-title');editor.innerHTML='<div class="metrics-dialog-head"><div><span class="eyebrow">RECORDED BY PEOPLE</span><h2 id="metrics-manual-title">Manual measurements & targets</h2></div><button type="button" class="metrics-close" data-metrics-action="manual-close" aria-label="Close manual records">×</button></div><div data-manual-content></div>';
   editor.addEventListener('cancel',event=>{if(saving){event.preventDefault();return;}event.preventDefault();closeEditor();});document.body.append(editor);editor.showModal();void manualList();
  }
  function manualForm(previous){
   if(!editor||!manualAllowed(actor(),manualScope)||!actor().admin&&!manualScope.target&&!previous?.course_id)return;
   const r=previous||{},today=new Date().toISOString().slice(0,10),course=previous?.course_id||manualScope.target||'';
   editorBody().innerHTML=`<button type="button" class="text-button" data-metrics-action="manual-back">← Records</button><form data-manual-form data-previous="${esc(r.id||'')}" data-course="${esc(course)}" data-token="${crypto.randomUUID()}"><p>${previous?'A correction creates a new revision; the earlier record remains in History.':'Examples: attendance counted from a signed sheet, practical hours, an outreach count or a budget target.'}</p><label>Metric name<input name="label" required minlength="3" maxlength="100" value="${esc(r.label||'')}" placeholder="e.g. Workshop attendees"></label><div class="metrics-manual-fields"><label>Unit<select name="unit" ${previous?'disabled':''}>${[['count','Count'],['hours','Hours'],['percent','Percent'],['GHS','GHS']].map(([v,l])=>`<option value="${v}" ${r.unit===v?'selected':''}>${l}</option>`).join('')}</select></label><label>Actual value<input name="actual" type="number" required min="0" max="100000000000" step="0.01" value="${esc(r.actual??'')}"></label><label>Target (optional)<input name="target" type="number" min="0.01" max="100000000000" step="0.01" value="${esc(r.target??'')}"></label><label>Observation date (UTC)<input name="observed" type="date" required min="2000-01-01" max="${today}" value="${esc(r.observed_on||today)}"></label></div><label>Source<input name="source" required minlength="3" maxlength="160" placeholder="e.g. Signed attendance sheet, 19 October" value="${esc(r.source||'')}"></label><label>Note ${previous?' / reason for correction':''}<textarea name="note" maxlength="1000" ${previous?'required':''}>${esc(r.note||'')}</textarea></label><p class="metrics-manual-explain">Counts use whole numbers. Percentages range from 0 to 100. Actual values may be zero; an optional target must be positive. Record each measurement once; correct an existing entry to revise it.</p><p data-manual-status role="status"></p><button type="submit" class="button">${previous?'Save correction':'Save measurement'}</button></form>`;
  }
  async function manualSubmit(form){
   const s=check();if(!editor||saving||!manualAllowed(s,manualScope))return;
   const read=name=>form.elements[name]?.value,actual=Number(read('actual')),target=read('target')===''?null:Number(read('target')),status=form.querySelector('[data-manual-status]');
   if(navigator.onLine===false){status.textContent='You are offline. Reconnect before saving; your form is still here.';return;}
   if(read('actual')===''||!number(actual)||actual<0||target!==null&&(!number(target)||target<=0)){status.textContent='Enter a nonnegative actual and positive optional target.';return;}
   const args={p_scope:manualScope.scope,p_course:form.dataset.course||null,p_label:read('label').trim(),p_unit:read('unit'),p_actual:actual,p_target:target,p_observed:read('observed'),p_source:read('source').trim(),p_note:read('note').trim(),p_token:form.dataset.token,p_previous:form.dataset.previous||null};
   const token=manualRequest,version=epoch,place=editorContext; saving=true;form.querySelector('button[type="submit"]').disabled=true;status.textContent='Saving…';
   try{await request('space_manual_metric_save',args);if(version!==epoch||place!==context(actor())||!editorValid(token))return;saving=false;manualOffset=0;manualRoot=null;await manualList();}
   catch(error){if(version!==epoch||!editorValid(token))return;saving=false;form.querySelector('button[type="submit"]').disabled=false;status.textContent=['42501','PGRST202','42883'].includes(error?.code)?'You cannot save this entry. Check your access and administrator setup.':String(error?.message||'Save could not be confirmed. Retry with this form to avoid a duplicate.').slice(0,240);}
  }
  document.addEventListener('submit',event=>{if(!event.target.matches?.('[data-manual-form]'))return;event.preventDefault();void manualSubmit(event.target);});
  document.addEventListener('toggle',event=>{const details=event.target;if(!details?.matches?.('[data-space-metrics]'))return;const s=check();if(details.open){opened.add(context(s));void load();}else opened.delete(context(s));},true);
  document.addEventListener('change',event=>{if(!event.target.matches?.('[data-metrics-days]'))return;const next=Number(event.target.value);if(![7,30,90].includes(next))return;days=next;void load();});
  document.addEventListener('click',event=>{
   const b=event.target.closest?.('[data-metrics-action]');if(!b)return;
   const action=b.dataset.metricsAction;if(action==='refresh'){void load(true);return;}
   if(action==='chart-mode'){if(!pieIds.has(b.dataset.chart)||!['pie','bar'].includes(b.dataset.view))return;modes[b.dataset.chart]=b.dataset.view;const scope=current();if(scope)paint(cache.get(key(actor(),scope)));return;}
   if(action==='manual-open'){openEditor();return;}
   if(action.startsWith('manual-')){
    check();if(!editor||saving||!manualAllowed(actor(),manualScope))return;
    if(action==='manual-close'){closeEditor();return;}
    if(action==='manual-add'){manualForm();return;}
    if(action==='manual-correct'){const r=manualRows.find(r=>r.id===b.dataset.id);if(r)manualForm(r);return;}
    if(action==='manual-history'){const r=manualRows.find(r=>r.root_id===b.dataset.id);if(!r)return;manualRoot=r.root_id;manualOffset=0;}
    if(action==='manual-back'){manualRoot=null;manualOffset=0;}
    if(action==='manual-prev')manualOffset=Math.max(0,manualOffset-20);
    if(action==='manual-next')manualOffset+=20;
    void manualList();return;
   }
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&host())void load();});
  return {view,sync,reset,load};
 }
 window.SpaceMetrics={create,scopeFor,report,chart,value,tone,insightRows,manualAllowed,manualEntryMarkup};
})();
