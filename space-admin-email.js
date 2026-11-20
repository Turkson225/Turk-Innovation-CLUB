/* Administrator email preferences and audit. All authorization is server-side. */
(() => {
  'use strict';
  const categories={
    updates:['Important updates','Club announcements and chapter changes'],
    alerts:['Alerts','Urgent announcements and new moderation reports'],
    errors:['Errors','Recent reports from multiple members about uploads or notification setup'],
    security:['Security','Account suspensions and role or office access changes'],
    service_status:['Service status','Approval email and push queue degradation or recovery']
  };
  const states={queued:'Queued',claimed:'Reserved',sending:'Sending',retry:'Waiting to retry',sent:'Accepted by mail server',
    failed:'Failed',uncertain:'Delivery unconfirmed',cancelled:'Cancelled'};
  const codes={settings_changed:'Email settings changed',event_expired:'Alert expired after 24 hours',lease_expired:'Worker reservation expired',
    confirmation_missing:'No final delivery confirmation',smtp_timeout:'Mail server timed out after dispatch',
    smtp_temporary:'Temporary mail server rejection',transport_before_message:'Connection failed before the message was sent',
    smtp_rejected:'Mail server permanently rejected the message',sender_rejected:'Mail server rejected the sender credentials',
    invalid_message:'Invalid email envelope'};
  const severity={info:'Info',warning:'Warning',high:'High'};
  const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
  const when=v=>{const d=new Date(v||'');return Number.isFinite(d.getTime())?d.toISOString().slice(0,19).replace('T',' ')+' UTC':'—';};
  const known=(map,value)=>Object.hasOwn(map,value)?map[value]:'';
  const missing=e=>['PGRST202','42883','42P01'].includes(e?.code);
  const volume=v=>Number.isSafeInteger(v)&&v>=0?v:0;
  function create(ctx){
    const e=ctx.esc;
    let owner='',model=null,draft=null,cursor=null,busy=false,request=0,problem='',notice='';
    const current=()=>{const s=ctx.get();return s.id&&s.admin&&s.approved?s.id+':'+s.generation:'';};
    function reset(){owner='';model=null;draft=null;cursor=null;busy=false;problem='';notice='';request++;}
    function ensure(){const id=current();if(id!==owner){reset();owner=id;}return id;}
    const valid=(id,seq)=>!!id&&id===current()&&seq===request;
    const host=()=>document.querySelector('[data-admin-mail]');
    const hasSetup=data=>!!data?.settings&&Number.isSafeInteger(data.settings.revision)&&Array.isArray(data.settings.categories)&&Array.isArray(data.jobs);
    const rpc=async(name,args={})=>{
      const r=await ctx.deadline(()=>ctx.db.rpc(name,args),8000,'Administrator email request timed out.');
      if(r.error)throw r.error;
      return r.data;
    };
    async function fetchPage(which=null){
      const data=await rpc('space_admin_mail_read',{p_before:which?.at||null,p_id:which?.id||null});
      if(!hasSetup(data))throw Error('Invalid response');
      return data;
    }
    function fromModel(s){
      return {recipient:s.recipient||'',confirm:'',enabled:s.enabled===true,categories:s.categories.filter(x=>known(categories,x))};
    }
    function paint(focus=''){
      const n=host();if(!n)return;
      n.outerHTML=view();
      if(focus)host()?.querySelector(`[data-admin-mail-action="${focus}"]`)?.focus({preventScroll:true});
    }
    async function load(which=null,{replaceDraft=false,paintNow=false}={}){
      const id=ensure();if(!id||busy)return;
      const seq=++request;busy=true;
      if(paintNow)paint();
      try{const data=await fetchPage(which);if(!valid(id,seq))return;
        if(replaceDraft||!model||model.settings.revision!==data.settings.revision)draft=fromModel(data.settings);
        model=data;cursor=which;problem='';
      }catch(error){if(!valid(id,seq))return;
        if(missing(error)){model=null;draft=null;problem='Apply the administrator email migration to open settings and delivery history.';}
        else if(error?.code==='42501'){model=null;draft=null;problem='Verify your administrator account to view email settings.';}
        else problem='Email settings could not refresh. Try again.';
      }finally{if(valid(id,seq)){busy=false;if(paintNow)paint();}}
    }
    function status(){
      if(!model)return '';
      const stamp=model.worker?.last_poll_at,age=Date.now()-new Date(stamp||'').getTime();
      const ready=model.worker?.sender_ready===true;
      const status= !stamp?'Worker has not checked in':age>6*60*1000?'Worker check-in is late':!ready?'Sender needs setup':'Worker checking in';
      const warning=!stamp||age>6*60*1000||!ready;
      return `<div class="admin-mail-status" role="status"><span class="tag ${warning?'gold':'blue'}">${e(status)}</span><span>Last check: ${e(when(stamp))}</span><span>${volume(model.queue?.waiting)} waiting · ${volume(model.queue?.attention)} need review (7 days)</span></div>`;
    }
    function jobMarkup(job){
      const title=known(severity,job.severity)||'Info',state=known(states,job.state)||'Unknown';
      const attemptRows=(Array.isArray(job.history)?job.history:[]).slice(0,4);
      return `<article class="admin-mail-job"><header><div><span class="tag ${job.severity==='high'?'gold':'blue'}">${e(title)}</span><h3>${e(job.title)}</h3><p>${e(job.resource)} · ${e(job.category==='test'?'Test':known(categories,job.category)?.[0]||'Alert')}</p></div><strong>${e(state)}</strong></header><p>Generated ${e(when(job.first_at))}${volume(job.occurrences)>1?' · '+volume(job.occurrences)+' grouped events':''} · ${volume(job.attempts)} attempts</p>${job.sent_at?`<p>Accepted ${e(when(job.sent_at))}</p>`:''}${known(codes,job.last_code)?`<p>${e(known(codes,job.last_code))}</p>`:''}${attemptRows.length?`<details><summary>Attempts and reference</summary><dl>${attemptRows.map(a=>`<dt>Attempt ${volume(a.attempt)} · ${e(known(states,a.outcome)||'In progress')}</dt><dd>${e(when(a.finished_at||a.started_at||a.claimed_at))}${known(codes,a.code)?' · '+e(known(codes,a.code)):''}</dd>`).join('')}</dl><small>Reference: ${e(job.id)}</small></details>`:''}</article>`;
    }
    function view(){
      if(!ensure())return '';
      const start='<section class="card admin-mail" data-admin-mail aria-labelledby="admin-mail-title"><span class="eyebrow">PLATFORM SETTINGS</span><h2 id="admin-mail-title">Administrator email alerts</h2><p>Send important SPACE events to a single administrator inbox.</p>';
      const banners=`<p class="admin-mail-feedback" role="status">${e(problem||notice||(busy?'Working…':''))}</p>`;
      if(!model)return start+banners+`<button type="button" class="button button-outline" data-admin-mail-action="refresh"${busy?' disabled':''}>Reload email settings</button></section>`;
      const s=model.settings,f=draft||fromModel(s),rows=model.jobs.slice(0,25),disabled=busy?' disabled':'';
      return start+status()+banners+`<form data-admin-mail-form>
        <label class="field">Administrator email<input type="email" name="recipient" maxlength="254" value="${e(f.recipient)}" placeholder="admin@example.org" autocomplete="off"${disabled}></label>
        <label class="field">Confirm a new email address<input type="email" name="confirm" maxlength="254" value="${e(f.confirm)}" autocomplete="off" aria-describedby="admin-mail-confirm-hint"${disabled}><small id="admin-mail-confirm-hint">Re-enter the address when changing it.</small></label>
        <label class="admin-mail-check"><input type="checkbox" name="enabled"${f.enabled?' checked':''}${disabled}><strong>Enable administrator emails</strong></label>
        <fieldset${disabled}><legend>Notification categories</legend><div class="admin-mail-categories">${Object.entries(categories).map(([key,[label,details]])=>`<label class="admin-mail-check"><input type="checkbox" name="category" value="${key}"${f.categories.includes(key)?' checked':''}><span><strong>${e(label)}</strong><small>${e(details)}</small></span></label>`).join('')}</div></fieldset>
        <p class="subtle">Changing the settings cancels pending alerts. An email already with the mail server can still arrive.</p>
        <div class="profile-buttons"><button type="submit" class="button"${disabled}>Save email settings</button>
        <button type="button" class="button button-outline" data-admin-mail-action="test"${busy||!s.enabled?' disabled':''}>Send test to saved inbox</button></div>
      </form>
      <div class="admin-mail-log-head"><div><h3>Delivery audit</h3><p>Last 90 days. Acceptance by the mail server does not confirm inbox delivery.</p></div><button type="button" class="button button-outline button-sm" data-admin-mail-action="refresh"${disabled}>Refresh audit</button></div>
      <div class="admin-mail-log">${rows.length?rows.map(jobMarkup).join(''):'<p>No administrator emails recorded yet.</p>'}</div>
      <div class="profile-buttons">${cursor?`<button type="button" class="text-button" data-admin-mail-action="newest"${disabled}>Back to latest</button>`:''}
      ${model.jobs.length>25?`<button type="button" class="text-button" data-admin-mail-action="older"${disabled}>Show older emails</button>`:''}</div></section>`;
    }
    function collect(form){
      const data=new FormData(form);
      return {recipient:String(data.get('recipient')||'').trim(),confirm:String(data.get('confirm')||'').trim(),
        enabled:data.get('enabled')!==null,categories:data.getAll('category').filter(k=>known(categories,k))};
    }
    function feedback(error){
      if(String(error?.details||error?.detail||'').includes('SPACE_ADMIN_MFA'))return 'Verify your authenticator again (sign out and sign back in), then retry.';
      if(error?.code==='40001')return 'Settings changed in another session. Refresh before saving again.';
      if(error?.code==='P0001')return 'A test was recently requested, or email is paused. Check the audit and saved settings.';
      return 'The action was not confirmed. Refresh the audit or settings before trying again.';
    }
    async function change(kind,form){
      const id=ensure();if(!id||busy||!model)return;
      let args={};
      if(kind==='save'){
        const entered=collect(form);draft=entered;
        if(entered.recipient&&(entered.recipient!==(model.settings.recipient||''))&&entered.confirm!==entered.recipient){
          problem='Re-enter the new email address to confirm it.';notice='';paint();host()?.querySelector('[name="confirm"]')?.focus();return;
        }
        if(entered.enabled&&(!entered.recipient||!entered.categories.length)){
          problem='Enter the recipient and select at least one category before enabling emails.';notice='';paint();return;
        }
        args={p_recipient:entered.recipient||null,p_enabled:entered.enabled,p_categories:entered.categories,p_revision:model.settings.revision};
      }else if(!model.settings.enabled)return;
      const seq=++request;busy=true;problem='';notice='';paint();
      let applied=false;
      try{
        await rpc(kind==='save'?'space_admin_mail_save':'space_admin_mail_test',args);
        applied=true;
        if(!valid(id,seq))return;
        const data=await fetchPage();
        if(!valid(id,seq))return;
        model=data;draft=fromModel(data.settings);cursor=null;
        notice=kind==='save'?'Administrator email settings saved.':'Test queued. Check the delivery audit and your inbox.';
      }catch(error){if(valid(id,seq))problem=applied?'Action accepted, but the view did not refresh. Refresh the audit before retrying.':feedback(error);}
      finally{if(valid(id,seq)){busy=false;paint(kind==='test'?'test':'');}}
    }
    document.addEventListener('input',event=>{
      const f=event.target.closest?.('[data-admin-mail-form]');if(f&&ensure()&&model&&!busy)draft=collect(f);
    });
    document.addEventListener('submit',event=>{
      if(!event.target.matches?.('[data-admin-mail-form]'))return;
      event.preventDefault();void change('save',event.target);
    });
    document.addEventListener('click',event=>{
      const b=event.target.closest?.('[data-admin-mail-action]');if(!b?.closest('[data-admin-mail]')||!ensure()||busy)return;
      const k=b.dataset.adminMailAction;
      if(k==='test'){void change('test');return;}
      if(k==='older'){
        const row=model?.jobs?.[24];if(row&&validId(row.id)&&when(row.first_at)!=='—')void load({at:row.first_at,id:row.id},{paintNow:true});
      }
      if(k==='refresh'||k==='newest'){notice='';void load(null,{paintNow:true,replaceDraft:k==='refresh'});}
    });
    return {view,load,reset};
  }
  window.SpaceAdminMail={create};
})();
