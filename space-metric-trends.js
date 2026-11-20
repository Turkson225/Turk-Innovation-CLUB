/* Read-only period charts. No externally hosted charts or persistent browser data. */
(() => {
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={
    requests:'Join requests',activations:'Approvals and restorations',announcement:'Announcements published',event:'Events published',project:'Projects published',workshop:'Workshops published',
    tasks_assigned:'Tasks assigned',tasks_completed:'Tasks completed',enrollments:'Workshop enrolments',attempts:'Submission attempts',completions:'Recorded completions',
    stock_created:'Stock records created',checkouts:'Checkout records',returns:'Return records',orders_created:'Orders placed',orders_collected:'Orders collected',
    income:'Approved income',expense:'Approved expenses',actual:'Recorded value',target:'Target'
  };
  const groupNames={day:'Daily',month:'Monthly',year:'Annual'};
  const utcDay=()=>new Date().toISOString().slice(0,10);
  const iso=d=>d.toISOString().slice(0,10);
  const fromIso=s=>new Date(s+'T00:00:00Z');
  const realDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(fromIso(s).getTime())&&iso(fromIso(s))===s;
  function preset(grain,end=utcDay()){
    const start=fromIso(end);
    if(grain==='month'){start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-11);}
    else if(grain==='year')start.setUTCFullYear(start.getUTCFullYear()-4,0,1);
    else start.setUTCDate(start.getUTCDate()-29);
    return {grain,from:iso(start),through:end};
  }
  function validate(f,today=utcDay()){
    if(!Object.hasOwn(groupNames,f.grain)||!realDate(f.from)||!realDate(f.through)||f.from<'2000-01-01'||f.through>today||f.from>f.through)
      throw Error('Choose valid dates up to today (UTC).');
    const limit=fromIso(f.from),month=limit.getUTCMonth();limit.setUTCFullYear(limit.getUTCFullYear()+10);
    if(limit.getUTCMonth()!==month)limit.setUTCDate(0);
    if(f.through>=iso(limit))throw Error('Choose a window shorter than 10 years.');
    if(f.grain==='day'&&Date.parse(f.through)-Date.parse(f.from)>=366*86400000)throw Error('Daily grouping allows up to 366 days. Use monthly or annual grouping for a longer period.');
    return f;
  }
  function nextBucket(start,grain){
    const d=fromIso(start);
    if(grain==='month')d.setUTCMonth(d.getUTCMonth()+1);
    else if(grain==='year')d.setUTCFullYear(d.getUTCFullYear()+1);
    else d.setUTCDate(d.getUTCDate()+1);
    return d;
  }
  const lastDay=(start,grain)=>{const d=nextBucket(start,grain);d.setUTCDate(d.getUTCDate()-1);return iso(d);};
  const bucketStart=(d,g)=>g==='year'?d.slice(0,4)+'-01-01':g==='month'?d.slice(0,7)+'-01':d;
  function checked(d,f,scope){
    const manual=scope==='manual';
    if(!d||d.grain!==f.grain||d.from!==f.from||d.through!==f.through||!(manual?['count','hours','percent','GHS'].includes(d.unit):d.unit===(scope==='ledger'?'GHS':'count'))||
       !Array.isArray(d.series)||!d.series.length||d.series.length>8||new Set(d.series).size!==d.series.length||!d.series.every(k=>Object.hasOwn(labels,k))||
       (manual?d.series.join(',')!=='actual,target':d.series.some(k=>['actual','target'].includes(k)))||
       !Array.isArray(d.rows)||!d.rows.length||d.rows.length>366)throw Error('The chart data was incomplete. Refresh to try again.');
    let expected=bucketStart(f.from,f.grain);
    for(const r of d.rows){
      if(r.date!==expected||r.from!==(expected<f.from?f.from:expected)||r.through!==[f.through,lastDay(expected,f.grain)].sort()[0]||
        !d.series.every(k=>manual&&r.values?.[k]===null||typeof r.values?.[k]==='number'&&Number.isFinite(r.values[k])&&r.values[k]>=0)||
        manual&&(r.observed===null?(r.values.actual!==null||r.values.target!==null):(!realDate(r.observed)||r.observed<r.from||r.observed>r.through||r.values.actual===null)))throw Error('The chart data did not match the dates selected.');
      expected=iso(nextBucket(expected,f.grain));
    }
    if(d.rows.at(-1).through!==f.through)throw Error('The final chart period was missing.');
    return d;
  }
  const dateLabel=(date,g)=>g==='year'?date.slice(0,4):new Intl.DateTimeFormat(undefined,{timeZone:'UTC',month:'short',...(g==='day'?{day:'numeric'}:{year:'numeric'})}).format(fromIso(date));
  const fmt=(n,unit)=>n.toLocaleString(undefined,{minimumFractionDigits:unit==='GHS'?2:0,maximumFractionDigits:['GHS','percent','hours'].includes(unit)?2:0});
  const amount=(n,u)=>n===null?'—':(u==='GHS'?'GHS ':'')+fmt(n,u)+(u==='percent'?'%':u==='hours'?' hr':'');
  const manualChart=d=>d.series[0]==='actual';
  const canPair=d=>manualChart(d)||d.unit==='GHS';
  const axis=n=>new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(n);
  const interval=r=>r.from===r.through?r.from:r.from+' to '+r.through;
  function insights(d,visible,today=utcDay()){
    const m=d.grain==='year'?'years':d.grain==='month'?'months':'days';
    const complete=d.rows.filter(r=>r.from===r.date&&r.through===lastDay(r.date,d.grain)&&r.through<today);
    if(manualChart(d)){
      const recorded=d.rows.filter(r=>r.observed);
      if(!recorded.length)return ['No manual observations in this range.'];
      const last=recorded.at(-1),peak=Math.max(...recorded.map(r=>r.values.actual));
      const copy=[`Latest recorded value: ${amount(last.values.actual,d.unit)} on ${last.observed}. Highest recorded value in the selected periods: ${amount(peak,d.unit)}.`];
      if(last.values.target!==null)copy.push(`Latest target: ${amount(last.values.target,d.unit)} · ${last.values.actual>=last.values.target?'target reached':'below target'}.`);
      if(complete.length>=2&&complete.slice(-2).every(r=>r.observed)){
        const [prior,next]=complete.slice(-2),diff=Math.round((next.values.actual-prior.values.actual)*100)/100;
        copy.push(`${dateLabel(next.date,d.grain)} versus ${dateLabel(prior.date,d.grain)}: ${diff===0?'no change':(d.unit==='percent'?fmt(Math.abs(diff),'percent')+' percentage points':amount(Math.abs(diff),d.unit))+(diff>0?' higher':' lower')}.`);
      }
      return copy;
    }
    return visible.map(k=>{
      const all=d.rows.map(r=>r.values[k]),peak=Math.max(...all),sum=all.reduce((n,v)=>n+v,0), high=d.rows.filter(r=>r.values[k]===peak).length;
      const show=n=>amount(n,d.unit);
      if(!peak)return labels[k]+': no records in this date range.';
      const r=d.rows[all.indexOf(peak)];
      let copy=labels[k]+': '+show(sum)+' in this range. '+(high===1?'Peak: '+show(peak)+' ('+interval(r)+').':'Peak: '+show(peak)+' across '+high+' periods.');
      if(complete.length>=2){
        const [previous,latest]=complete.slice(-2), a=previous.values[k], b=latest.values[k], difference=d.unit==='GHS'?Math.round((b-a)*100)/100:b-a;
        copy+=' '+(difference===0?'No change':show(Math.abs(difference))+(difference>0?' higher':' lower'))+' in the most recent complete period ('+dateLabel(latest.date,d.grain)+') versus '+dateLabel(previous.date,d.grain)+'.';
      }else if(d.rows.length>1)copy+=' At least two complete '+m+' are needed for a period comparison.';
      return copy;
    });
  }
  function geometry(d,visible){
    const count=d.rows.length,width=Math.max(700,count*14+94),left=62,right=24,top=19,height=230,bottom=40;
    const raw=Math.max(0,...d.rows.flatMap(r=>visible.map(k=>r.values[k]))),power=10**Math.floor(Math.log10(raw||1));
    let step=[1,2,2.5,5,10].map(n=>n*power/5).find(n=>n>=raw/5)||power*2;
    if(d.unit==='count')step=Math.max(1,Math.ceil(step));
    const max=Math.max(step,Math.ceil(raw/step)*step),span=(width-left-right)/count,baseline=height-bottom;
    return {width,left,right,top,height,baseline,span,step,max,x:i=>left+(i+.5)*span,y:v=>baseline-v/max*(baseline-top)};
  }
  function chart(d,visible,selected){
    const g=geometry(d,visible),n=d.rows.length;
    const ticks=Array.from({length:Math.round(g.max/g.step)+1},(_,i)=>i*g.step).map(v=>`<line class="trend-grid" x1="${g.left}" x2="${g.width-g.right}" y1="${g.y(v)}" y2="${g.y(v)}"/><text class="trend-axis" x="${g.left-9}" y="${g.y(v)+4}" text-anchor="end">${esc(axis(v))}</text>`).join('');
    const groupWidth=Math.min(g.span*.73,visible.length*27),bar=groupWidth/visible.length;
    const buckets=d.rows.map((r,i)=>visible.map((k,j)=>{
      const v=r.values[k];if(v===null)return '';
      const title=`<title>${esc((r.observed||interval(r))+' · '+labels[k]+': '+amount(v,d.unit))}</title>`;
      return manualChart(d)?`<circle class="trend-series-${j}" cx="${g.x(i)+(j-(visible.length-1)/2)*6}" cy="${g.y(v)}" r="3.5">${title}</circle>`:
        `<rect class="trend-series-${j}" x="${g.x(i)-groupWidth/2+j*bar}" y="${g.y(v)}" width="${Math.max(.8,bar-1)}" height="${g.baseline-g.y(v)}" rx="2">${title}</rect>`;
    }).join('')).join('');
    const stride=Math.max(1,Math.ceil((n-1)/5));
    const tickIndexes=[...new Set([0,...d.rows.map((_,i)=>i).filter(i=>i%stride===0&&i<n-1-stride*.55),n-1])];
    const dates=tickIndexes.map(i=>`<text class="trend-axis" x="${g.x(i)}" y="${g.height-14}" text-anchor="${n===1?'middle':i===0?'start':i===n-1?'end':'middle'}">${esc(dateLabel(d.rows[i].date,d.grain))}</text>`).join('');
    return `<div class="trend-plot" data-trend-plot tabindex="0" role="group" aria-label="Trend chart. Use the left and right arrow keys to inspect a period."><svg width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" aria-hidden="true">${ticks}<rect class="trend-focus" data-trend-cursor x="${g.left+selected*g.span}" y="${g.top}" width="${g.span}" height="${g.baseline-g.top}"/>${buckets}${dates}${d.rows.map((_,i)=>`<rect fill="transparent" data-trend-point="${i}" x="${g.left+i*g.span}" y="${g.top}" width="${g.span}" height="${g.baseline-g.top}"/>`).join('')}</svg></div>`;
  }
  function periodDetails(d,visible,i){
    const r=d.rows[i];return `<strong>${esc(interval(r))}</strong> ${manualChart(d)?r.observed?`<span>Observed ${esc(r.observed)}</span>`:'<span>No observation</span>':''} ${visible.map(k=>`<span>${esc(labels[k])}: <b>${esc(amount(r.values[k],d.unit))}</b></span>`).join('')}`;
  }
  function report(d,selected,current,today=utcDay()){
    const series=selected==='pair'?d.series:[selected],partial=d.rows.some(r=>r.date!==r.from||r.through!==lastDay(r.date,d.grain)||r.through===today);
    return `<div class="trend-output"><div class="trend-heading"><p><b>${esc(groupNames[d.grain])}</b> · ${esc(d.from)} to ${esc(d.through)} · UTC${partial?' · includes partial periods':''}</p>
      ${d.series.length>1?`<label>Chart measure <select data-trend-series>${canPair(d)?'<option value="pair" '+(selected==='pair'?'selected':'')+'>'+(manualChart(d)?'Recorded value and target':'Compare income and expenses')+'</option>':''}${d.series.map(k=>`<option value="${k}"${k===selected?' selected':''}>${esc(labels[k])}</option>`).join('')}</select></label>`:''}</div>
      <div class="trend-legend">${series.map((k,i)=>`<span><i class="trend-swatch-${i}" aria-hidden="true"></i>${esc(labels[k])}${d.unit==='GHS'?' (GHS)':''}</span>`).join('')}</div>
      ${chart(d,series,current)}
      <div class="trend-period" data-trend-current aria-live="polite">${periodDetails(d,series,current)}</div>
      <div class="trend-insight"><h3>What this shows</h3><ul>${insights(d,series,today).map(line=>`<li>${esc(line)}</li>`).join('')}</ul></div>
      <details class="trend-values"><summary>View exact values (${d.rows.length} periods)</summary><div class="trend-table" tabindex="0" role="region" aria-label="Exact chart values"><table><caption>Exact values for the selected measures</caption><thead><tr><th scope="col">Period from</th><th scope="col">Period through</th>${manualChart(d)?'<th scope="col">Observed on</th>':''}${series.map(k=>`<th scope="col">${esc(labels[k])}${d.unit==='GHS'?' (GHS)':''}</th>`).join('')}</tr></thead><tbody>
      ${d.rows.map(r=>`<tr><th scope="row">${r.from}</th><td>${r.through}</td>${manualChart(d)?`<td>${esc(r.observed||'—')}</td>`:''}${series.map(k=>`<td>${esc(amount(r.values[k],d.unit))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details></div>`;
  }
  function comparison(title,rows,series){
    if(!rows.length)return '';
    const max=Math.max(1,...rows.flatMap(row=>row.values));
    return `<details class="space-trends"><summary>${esc(title)} <small>Current snapshot</small></summary><div class="trend-inner"><p class="trend-note">Each bar uses the same scale. Figures are the current view, not a historical trend.</p><div class="trend-comparison">${rows.map(r=>`<section><h3>${esc(r.label)}</h3>${series.map((s,i)=>`<label>${esc(s)} <b>${esc(fmt(r.values[i]))}</b><meter min="0" max="${max}" value="${r.values[i]}">${esc(fmt(r.values[i]))}</meter></label>`).join('')}</section>`).join('')}</div></div></details>`;
  }
  function create({db,get,id}){
    let key='',serial=0,opened=false,filter=preset('day'),data=null,selection='',index=0,loading=false,error='',office='';
    const marker='[data-trend-host="'+id+'"]',host=()=>document.querySelector(marker);
    const active=()=>{const x=get();return db&&x?.id&&x.scope?x:null;};
    const signature=x=>x?[x.id,x.generation,x.page,x.scope,x.target,x.access].join(':'):'';
    function reset(){
      serial++;key='';opened=false;filter=preset('day');data=null;selection='';index=0;loading=false;error='';office='';
      const n=host();if(n){n.open=false;const body=n.querySelector('[data-trend-result]');if(body)body.innerHTML='';}
    }
    function ensure(){
      const a=active(),k=signature(a);
      if(k!==key){reset();key=k;if(realDate(a?.through))filter=preset('day',a.through);}
      return a;
    }
    function controls(x){
      return `<form class="trend-controls" data-trend-form><label>Group by<select name="grain">${Object.entries(groupNames).map(([k,l])=>`<option value="${k}"${k===filter.grain?' selected':''}>${l}</option>`).join('')}</select></label>
        <label>From<input type="date" name="from" min="2000-01-01" max="${utcDay()}" value="${filter.from}" required></label><label>Through<input type="date" name="through" min="2000-01-01" max="${utcDay()}" value="${filter.through}" required></label>
        ${x.offices?.length?`<label>Scope<select name="office"><option value="">All available activity</option>${x.offices.map(([v,l])=>`<option value="${esc(v)}"${v===office?' selected':''}>${esc(l)} tasks</option>`).join('')}</select></label>`:''}<button class="button button-outline" type="submit">Apply period</button></form>`;
    }
    const body=()=>loading?'<p role="status">Loading dated records…</p>':error?`<p role="alert">${esc(error)}</p>`:data?report(data,selection,index):'<p>Select a reporting period to view activity.</p>';
    function view(){
      const x=ensure();if(!x)return '';
      return `<details class="space-trends" data-trend-host="${id}"${opened?' open':''}><summary><span>${esc(x.title||'Activity trends')}</span><small>Daily · Monthly · Annual</small></summary><div class="trend-inner">${controls(x)}<div data-trend-result>${body()}</div><p class="trend-note">${esc(x.note||'Charts show dated activity. Current totals elsewhere on this page are snapshots.')}</p></div></details>`;
    }
    function paint(restore=false){
      const root=host(),box=root?.querySelector('[data-trend-result]');
      if(!box)return;
      box.innerHTML=body();
      const plot=root.querySelector('[data-trend-plot]');
      if(plot&&data){
        const g=geometry(data,selection==='pair'?data.series:[selection]);
        plot.scrollLeft=Math.max(0,g.x(index)-plot.clientWidth/2);
      }
      if(restore)root.querySelector('[data-trend-series]')?.focus({preventScroll:true});
    }
    async function load(){
      const x=ensure();
      if(!x||!host()?.open||loading)return;
      const request=++serial, expected=key,f={...filter},selectedOffice=office;
      const valid=()=>signature(active())===expected&&request===serial;
      const args={p_grain:f.grain,p_from:f.from,p_through:f.through};
      const name=x.scope==='chapter'?'space_chapter_metric_trends':x.scope==='ledger'?'space_approved_ledger_trends':x.scope==='manual'?'space_manual_metric_trends':'space_metric_trends';
      if(x.scope==='chapter'){args.p_chapter=x.target||null;args.p_office=selectedOffice||null;}
      else if(x.scope==='manual')args.p_root=x.target;
      else if(x.scope!=='ledger'){args.p_scope=x.scope;args.p_target=x.target||null;}
      data=null;loading=true;error='';paint();
      let timer;
      try{
        const result=await Promise.race([db.rpc(name,args),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The chart took too long. Try applying the period again.')),12000);})]);
        if(!valid())return;
        if(result.error)throw result.error;
        data=checked(result.data,f,x.scope);
        if(!data.series.includes(selection)&&!(selection==='pair'&&canPair(data)))selection=canPair(data)?'pair':data.series[0];
        index=data.rows.length-1;
      }catch(e){
        if(!valid())return;
        error=['PGRST202','42883','42P01'].includes(e?.code)?'Activity trends await the metrics migration. Existing charts and snapshots are still available.':
          e?.code==='42501'?'You don’t have access to this report.':'The report could not load. Apply the period again to retry.';
      }finally{clearTimeout(timer);if(valid()){loading=false;paint();}}
    }
    function readPoint(i,keyboard=false){
      if(!data||!Number.isInteger(i)||i<0||i>=data.rows.length)return;
      index=i;const root=host(),visible=selection==='pair'?data.series:[selection],g=geometry(data,visible);
      const box=root?.querySelector('[data-trend-current]'),cursor=root?.querySelector('[data-trend-cursor]');
      if(box)box.innerHTML=periodDetails(data,visible,i);
      cursor?.setAttribute('x',String(g.left+i*g.span));
      if(keyboard)root?.querySelector(`[data-trend-point="${i}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});
    }
    document.addEventListener('toggle',e=>{
      if(e.target!==host()||!ensure())return;
      opened=e.target.open;
      if(opened&&!data&&!error)void load();
    },true);
    document.addEventListener('change',e=>{
      const n=e.target;if(!n.closest?.(marker)||!ensure())return;
      if(n.name==='grain'&&n.form?.matches?.('[data-trend-form]')&&Object.hasOwn(groupNames,n.value)){
        const end=active()?.through,p=preset(n.value,realDate(end)?end:utcDay());n.form.elements.from.value=p.from;n.form.elements.through.value=p.through;
      }
      if(n.matches?.('[data-trend-series]')&&data&&(data.series.includes(n.value)||n.value==='pair'&&canPair(data))){
        selection=n.value;paint(true);
      }
    });
    document.addEventListener('submit',e=>{
      const form=e.target;if(!form.matches?.('[data-trend-form]')||!form.closest(marker))return;
      e.preventDefault();const x=ensure();if(!x)return;
      const f={grain:form.elements.grain.value,from:form.elements.from.value,through:form.elements.through.value};
      try{validate(f);}catch(e){error=e.message;data=null;serial++;loading=false;paint();return;}
      const chosen=form.elements.office?.value||'';
      if(chosen&&!x.offices?.some(([v])=>v===chosen))return;
      serial++;loading=false;filter=f;office=chosen;void load();
    });
    document.addEventListener('pointerover',e=>{
      const n=e.target.closest?.('[data-trend-point]');
      if(n?.closest(marker)&&ensure()&&e.pointerType!=='touch')readPoint(Number(n.getAttribute('data-trend-point')));
    });
    document.addEventListener('click',e=>{
      const n=e.target.closest?.('[data-trend-point]');
      if(n?.closest(marker)&&ensure())readPoint(Number(n.getAttribute('data-trend-point')));
    });
    document.addEventListener('keydown',e=>{
      if(!e.target.matches?.('[data-trend-plot]')||!e.target.closest(marker)||!ensure()||!data||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?data.rows.length-1:index+(e.key==='ArrowLeft'?-1:1);
      readPoint(Math.max(0,Math.min(next,data.rows.length-1)),true);
    });
    return {view,reset,sync:ensure};
  }
  window.SpaceMetricTrends={create,preset,validate,checked,insights,report,comparison};
})();
