const escape = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modes={
  records:{name:'Current records',detail:'Browse the records already in SPACE, including those created before Data Center was enabled.'},
  history:{name:'Change history',detail:'Review recorded additions, updates and removals, including who made them when recorded.'},
  totals:{name:'Daily activity',detail:'Export counts by completed UTC day, feature and action. These rows contain no account IDs or content.'}
};
const dateKey=ms=>new Date(ms).toISOString().slice(0,10);
const defaultDates=now=>({from:dateKey(now()-29*86400000),to:dateKey(now())});
const labels={id:'Record ID',record_id:'Record ID',actor_id:'Actor ID',day:'UTC day',happened_at:'Time (UTC)',created_at:'Created',before_state:'Before',after_state:'After',changed_fields:'Changed fields'};
const friendly=key=>labels[key]||key.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const cellText=v=>v==null?'':Array.isArray(v)&&v.every(x=>typeof x==='string')?v.join(', '):typeof v==='object'?JSON.stringify(v):String(v);
const bounded=n=>Intl.NumberFormat().format(n);
export function dataCenterCsv(columns,rows){
  const cells=v=>'"'+cellText(v).replace(/^[\u0000-\u0020]*[=+@＝＋＠－\-]|^[\t\r\n]/u,"'$&").replaceAll('"','""')+'"';
  return '\ufeff'+columns.map(cells).join(',')+'\r\n'+rows.map(row=>columns.map(c=>cells(row[c])).join(',')).join('\r\n')+'\r\n';
}
function downloadFile(name,contents,mime){
  const url=URL.createObjectURL(new Blob([contents],{type:mime}));
  const a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
export function createDataCenter({rpc,current,redraw,authFailure,now=Date.now,download=downloadFile}){
  let epoch=0,owner='',catalog=null,loadingCatalog=false,messages='',busy='',rows=null,next=null,columns=[],viewPage=1,applied=null;
  let draft={mode:'records',dataset:'',...defaultDates(now)};
  const route=()=>current().page==='data-center';
  const permitted=()=>!!current().id&&current().admin;
  const key=()=>permitted()?current().id+':'+current().generation:'';
  const valid=token=>epoch===token&&owner===key()&&route()&&permitted();
  const draw=()=>{if(route()&&permitted())redraw();};
  function reset(){
    epoch++;owner='';catalog=null;loadingCatalog=false;messages='';busy='';rows=null;next=null;columns=[];viewPage=1;applied=null;
    draft={mode:'records',dataset:'',...defaultDates(now)};
  }
  function onError(error){
    if(String(error?.details||error?.detail||'').includes('SPACE_ADMIN_MFA')){
      messages='Verify with your authenticator, then try again.';
      authFailure(error);return;
    }
    if(['PGRST202','42883','PGRST204'].includes(error?.code)){
      messages='Data Center is not enabled yet. Apply the Data Center database migration, then reload.';
    }else if(error?.code==='42501'){
      messages='Only a verified administrator can access these records.';
    }else messages=error?.message||'The request could not complete. Try again.';
  }
  async function loadCatalog(){
    const token=epoch;loadingCatalog=true;messages='';
    try{
      const {data,error}=await rpc('space_data_center_catalog',{});
      if(!valid(token))return;
      if(error)throw error;
      if(!data||!Array.isArray(data.datasets))throw Error('The dataset list could not load. Try again.');
      catalog=data;
      draft.dataset=data.datasets.find(d=>d.id==='profiles')?.id||data.datasets.find(d=>d.records)?.id||'';
    }catch(error){if(valid(token))onError(error);}
    finally{if(valid(token)){loadingCatalog=false;draw();}}
  }
  function sync(){
    const latest=key();
    if(latest!==owner){reset();owner=latest;}
    if(!route()){
      if(busy||loadingCatalog){epoch++;busy='';loadingCatalog=false;}
      return;
    }
    if(latest&&!catalog&&!loadingCatalog&&!messages)void loadCatalog();
  }
  function setMode(mode){
    if(!Object.hasOwn(modes,mode)||draft.mode===mode)return;
    const previous=draft.dataset;
    const set=catalog.datasets.find(d=>d.id===previous);
    draft={...draft,mode,dataset:mode==='records'?(set?.records?previous:catalog.datasets.find(d=>d.records)?.id||''):''};
    messages='';rows=null;applied=null;next=null;viewPage=1;draw();
  }
  function params(filters,cursor,limit,isExport){
    return {p_mode:filters.mode,p_dataset:filters.dataset||null,p_from:filters.from,p_to:filters.to,
      p_cursor:cursor,p_limit:limit,p_export:isExport};
  }
  function check(filters){
    if(!filters.dataset&&filters.mode==='records')throw Error('Choose a dataset.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(filters.from)||!/^\d{4}-\d{2}-\d{2}$/.test(filters.to)
      ||filters.from>filters.to||filters.to>dateKey(now())||Date.parse(filters.to)-Date.parse(filters.from)>365*86400000)
      throw Error('Choose dates in UTC with a range of up to 366 days, ending no later than today.');
  }
  function capture(form){
    draft={...draft,dataset:form.elements.dataset.value,from:form.elements.from.value,to:form.elements.to.value};
  }
  async function page(first){
    if(!catalog||busy||!valid(epoch)||(!first&&!next))return;
    const token=epoch,filters=first?{...draft}:applied,cursor=first?null:next;
    if(first){rows=null;next=null;applied=null;viewPage=1;}
    messages='';busy='Loading records…';draw();
    try{
      check(filters);
      const {data,error}=await rpc('space_data_center_page',params(filters,cursor,75,false));
      if(!valid(token))return;
      if(error)throw error;
      if(!data||!Array.isArray(data.rows)||!Array.isArray(data.columns))throw Error('Could not load this page. Try again.');
      rows=data.rows;columns=data.columns;next=data.next_cursor;applied=filters;if(!first)viewPage++;
    }catch(err){if(valid(token))onError(err);}
    finally{if(valid(token)){busy='';draw();}}
  }
  async function exportRows(format){
    if(!valid(epoch)||!catalog||busy||!['csv','json'].includes(format))return;
    const token=epoch,filters={...draft};
    messages='';busy='Preparing export…';draw();
    try{
      check(filters);
      const all=[];let cursor=null,header=null,started=null;
      do{
        const {data,error}=await rpc('space_data_center_page',params(filters,cursor,200,true));
        if(!valid(token))return;
        if(error)throw error;
        if(!data||!Array.isArray(data.rows)||!Array.isArray(data.columns))throw Error('The export could not finish. Try again.');
        header??=data.columns;started??=data.as_of;
        all.push(...data.rows);
        if(data.next_cursor&&JSON.stringify(data.next_cursor)===JSON.stringify(cursor))throw Error('The export stopped before all rows were retrieved. Shorten the date range and try again.');
        cursor=data.next_cursor;
        if(all.length>30000||(all.length===30000&&cursor))
          throw Error('This export has more than 30,000 rows. Choose a smaller date range or dataset.');
      }while(cursor);
      const suffix=`space-${filters.mode}-${filters.dataset||'all'}-${filters.from}-to-${filters.to}`;
      if(format==='csv')download(suffix+'.csv',dataCenterCsv(header,all),'text/csv;charset=utf-8');
      else download(suffix+'.json',JSON.stringify({view:filters.mode,dataset:filters.dataset||null,
        utc_from:filters.from,utc_to:filters.to,as_of:started,columns:header,rows:all},null,2),'application/json');
      messages=`Exported ${bounded(all.length)} records.`;
    }catch(err){if(valid(token))onError(err);}
    finally{if(valid(token)){busy='';draw();}}
  }
  function view(){
    if(!permitted())return '';
    const tabs=Object.entries(modes).map(([id,m])=>`<button type="button" class="button button-sm ${draft.mode===id?'':'button-outline'}" data-dc-mode="${id}" aria-pressed="${draft.mode===id}" ${busy?'disabled':''}>${escape(m.name)}</button>`).join('');
    const choices=catalog?.datasets?.filter(d=>draft.mode!=='records'||d.records)||[];
    const groups=Map.groupBy?Map.groupBy(choices,d=>d.area):choices.reduce((m,d)=>m.set(d.area,[...(m.get(d.area)||[]),d]),new Map());
    const info=choices.find(d=>d.id===draft.dataset);
    const result=rows===null?'':rows.length?`<div class="dc-results" role="region" aria-label="Data Center results" tabindex="0"><table><thead><tr>${columns.map(c=>`<th scope="col">${escape(friendly(c))}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(c=>`<td>${escape(cellText(row[c]))||'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="dc-pager"><span>Page ${viewPage} · ${bounded(rows.length)} rows shown</span><button class="button button-outline button-sm" data-dc-page="restart" type="button" ${viewPage===1||busy?'disabled':''}>First page</button><button class="button button-sm" data-dc-page="next" type="button" ${!next||busy?'disabled':''}>Next page</button></div>`:'<p>No matching records. Try a different dataset or date range.</p>';
    return `<section class="dc-workspace" aria-label="Data Center">
      <div class="section-heading"><div><span class="eyebrow">ADMINISTRATION</span><h1>Data Center</h1><p>Find club records, review changes, and export data for analysis.</p></div><a class="button button-outline button-sm" href="#admin">Admin overview</a></div>
      ${catalog?`<div class="card dc-controls"><div role="group" aria-label="Data Center views" class="dc-actions">${tabs}</div>
      <p class="subtle">${escape(modes[draft.mode].detail)}</p>
      <form data-dc-filters class="dc-filters">
       <label>Dataset<select name="dataset" ${busy?'disabled':''}>${draft.mode!=='records'?'<option value="">All areas</option>':''}${Array.from(groups,([area,items])=>`<optgroup label="${escape(area)}">${items.map(d=>`<option value="${escape(d.id)}" ${draft.dataset===d.id?'selected':''}>${escape(d.title)}</option>`).join('')}</optgroup>`).join('')}</select></label>
       <label>From (UTC)<input type="date" name="from" value="${escape(draft.from)}" max="${dateKey(now())}" required ${busy?'disabled':''}></label>
       <label>To (UTC)<input type="date" name="to" value="${escape(draft.to)}" max="${dateKey(now())}" required ${busy?'disabled':''}></label>
       <div class="dc-actions"><button class="button button-sm" type="submit" ${busy?'disabled':''}>Load records</button><button class="button button-outline button-sm" type="button" data-dc-export="csv" ${busy?'disabled':''}>Export CSV</button><button class="button button-outline button-sm" type="button" data-dc-export="json" ${busy?'disabled':''}>Export JSON</button></div>
      </form>
      <p class="hint">${draft.mode==='records'&&info&&!info.has_date?'This dataset has no record date; the date fields do not filter it.':draft.mode==='history'&&info&&!info.records?'This dataset records daily counts only. Open Daily activity for those totals.':'Use a date range of up to 366 days.'} History begins ${escape(String(catalog.started_at||'').slice(0,10))} (UTC). ${draft.mode==='records'?'Exports from this view contain operational records.':'Use Daily activity rather than record-level exports for model experiments.'}</p></div>`
      :`<div class="card">${loadingCatalog||!messages?'Loading datasets…':'<button type="button" class="button" data-dc-retry>Retry</button>'}</div>`}
      <p class="dc-status" role="status">${escape(busy||messages)}</p>${result}
      </section>`;
  }
  function bind(root=document){
    root.addEventListener('change',e=>{
      if(!valid(epoch)||busy)return;
      const form=e.target.closest?.('[data-dc-filters]');if(!form)return;
      capture(form);rows=null;applied=null;next=null;
      const results=root.querySelector?.('.dc-results');if(results)results.hidden=true;
      const pager=root.querySelector?.('.dc-pager');if(pager)pager.hidden=true;
    });
    root.addEventListener('submit',e=>{
      const form=e.target;if(!form.matches?.('[data-dc-filters]')||!valid(epoch)||busy)return;
      e.preventDefault();capture(form);void page(true);
    });
    root.addEventListener('click',e=>{
      if(busy||!valid(epoch))return;
      const el=e.target.closest?.('[data-dc-mode],[data-dc-page],[data-dc-export],[data-dc-retry]');
      if(!el)return;
      if(el.dataset.dcMode&&catalog){setMode(el.dataset.dcMode);return;}
      if(el.hasAttribute('data-dc-retry')&&!loadingCatalog){void loadCatalog();draw();return;}
      if(el.dataset.dcPage){void page(el.dataset.dcPage==='restart');return;}
      if(el.dataset.dcExport){
        const form=el.closest('[data-dc-filters]');
        if(form?.reportValidity()){capture(form);void exportRows(el.dataset.dcExport);}
      }
    });
  }
  return {sync,view,bind,reset};
}
