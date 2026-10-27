// Administrator step-up UI. Authorisation is also enforced by the SQL migration.
// TOTP enrolment secrets live only in this controller's memory until verified.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createAdminSecurity({db, current, changed, verified, signOut}) {
  let epoch=0, owner='', blocked=false, busy=false, error='', factors=[], enrolment=null, checked=false;
  const active=(e,id)=>e===epoch&&owner===id&&current().id===id;
  const redraw=()=>changed?.();
  function reset(){epoch++;owner='';blocked=false;busy=false;error='';factors=[];enrolment=null;checked=false;}
  async function loadFactors(e,id){
    const result=await db.auth.mfa.listFactors();
    if(!active(e,id))return;
    if(result.error)throw result.error;
    factors=(result.data?.totp||[]).filter(f=>f.status==='verified');
    checked=true;
  }
  async function check(profile,{force=false}={}){
    if(owner!==profile?.id)reset();else{epoch++;busy=false;error='';checked=false;}
    if(profile?.role!=='admin'||profile.membership_status!=='approved'){reset();return true;}
    owner=profile.id;blocked=true;busy=true;const e=epoch,id=owner;
    try{
      const result=await db.auth.mfa.getAuthenticatorAssuranceLevel();
      if(!active(e,id))return false;
      if(result.error)throw result.error;
      if(result.data?.currentLevel==='aal2'&&!force){blocked=false;enrolment=null;factors=[];return true;}
      await loadFactors(e,id);
    }catch(err){if(active(e,id))error=err?.message||'Administrator verification could not load. Retry below.';}
    finally{if(active(e,id)){busy=false;redraw();}}
    return false;
  }
  async function enrol(){
    const e=epoch,id=owner;if(!active(e,id)||busy)return;
    busy=true;error='';redraw();
    try{
      // Reuse this screen's pending factor. Do not create another secret on retries.
      if(!enrolment){
        const result=await db.auth.mfa.enroll({factorType:'totp',friendlyName:'SPACE '+new Date().toISOString()});
        if(!active(e,id))return;
        if(result.error)throw result.error;
        enrolment=result.data;
      }
    }catch(err){if(active(e,id))error=err?.message||'Authenticator setup failed. Try again.';}
    finally{if(active(e,id)){busy=false;redraw();}}
  }
  async function verify(code,factorId){
    const e=epoch,id=owner;if(!active(e,id)||busy)return;
    if(!/^\d{6}$/.test(String(code||''))){error='Enter the six-digit code from your authenticator app.';redraw();return;}
    const selected=enrolment?.id||factors.find(f=>f.id===factorId)?.id||factors[0]?.id;
    if(!selected){error='Set up an authenticator first.';redraw();return;}
    busy=true;error='';redraw();
    try{
      const result=await db.auth.mfa.challengeAndVerify({factorId:selected,code:String(code)});
      if(!active(e,id))return;
      if(result.error)throw result.error;
      const assurance=await db.auth.mfa.getAuthenticatorAssuranceLevel();
      if(!active(e,id))return;
      if(assurance.error)throw assurance.error;
      if(assurance.data?.currentLevel!=='aal2')throw Error('Verification did not complete. Please retry.');
      enrolment=null;factors=[];blocked=false;
      await verified?.(id);
    }catch(err){if(active(e,id)){blocked=true;error=err?.message||'That code did not work. Try the latest code.';}}
    finally{if(active(e,id)){busy=false;redraw();}}
  }
  function view(){
    const setup=checked&&!factors.length;
    const qr=enrolment?.totp?.qr_code;
    const svg=qr?.startsWith('data:image/svg+xml;')?qr.slice(qr.indexOf(',')+1):qr;
    const image=svg?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg):'';
    return `<section class="security-check" aria-labelledby="securityTitle" aria-busy="${busy}"><span class="eyebrow">ADMINISTRATOR SECURITY</span><h1 id="securityTitle">${setup?'Protect your administrator account':'Verify it’s you'}</h1><p>${setup?'Connect an authenticator app, then enter its six-digit code to open your admin workspace.':'Enter the current code from your authenticator app to open your admin workspace.'}</p>${enrolment?`<div class="security-enrolment">${image?`<img src="${escape(image)}" width="208" height="208" alt="Scan this QR code with your authenticator app">`:''}<p>Or add this setup key manually:</p><code class="security-secret">${escape(enrolment.totp?.secret||'')}</code><p class="hint">Store the key somewhere secure. It is only shown during setup.</p></div>`:''}${enrolment||factors.length?`<form data-admin-security="verify" class="form-stack">${factors.length>1?`<label>Authenticator<select name="factor">${factors.map((f,i)=>`<option value="${escape(f.id)}">${escape(f.friendly_name||'Authenticator '+(i+1))}</option>`).join('')}</select></label>`:''}<label for="adminVerificationCode">Authenticator code</label><input id="adminVerificationCode" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus><button class="button" type="submit" ${busy?'disabled':''}>${busy?'Checking…':'Verify and continue'}</button></form>`:checked?`<button class="button" type="button" data-security-action="enrol" ${busy?'disabled':''}>${busy?'Opening setup…':'Set up authenticator'}</button>`:''}${error?`<p class="auth-feedback" role="alert">${escape(error)}</p>`:''}<div class="security-actions"><button class="text-button" type="button" data-security-action="retry" ${busy?'disabled':''}>Retry verification</button><button class="text-button" type="button" data-security-action="signout">Sign out</button></div><p class="hint">Lost access? The Supabase project owner can reset your enrolled factor after confirming your identity. Your administrator role and club records remain intact.</p></section>`;
  }
  function bind(root=document){
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-security-action]');if(!button||!blocked)return;
      const action=button.dataset.securityAction;
      if(action==='enrol')void enrol();
      if(action==='retry'&&!busy)void check({id:owner,role:'admin',membership_status:'approved'},{force:true});
      if(action==='signout'){reset();void signOut?.();}
    });
    root.addEventListener('submit',event=>{
      const form=event.target;if(!form.matches?.('[data-admin-security="verify"]')||!blocked)return;
      event.preventDefault();const code=form.elements.code.value,factor=form.elements.factor?.value;form.elements.code.value='';void verify(code,factor);
    });
  }
  return {check,reset,view,bind,enrol,verify,get blocked(){return blocked;},get busy(){return busy;}};
}
