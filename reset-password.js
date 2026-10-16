import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg=window.INNOVATEX_CONFIG||{};
const $=selector=>document.querySelector(selector);
const recoveryMemory=new Map();
// Never reuse a workspace session to change a password from a reset email.
const recoveryStorage={
  getItem(key){try{return sessionStorage.getItem(key)??recoveryMemory.get(key)??null;}catch{return recoveryMemory.get(key)??null;}},
  setItem(key,value){recoveryMemory.set(key,value);try{sessionStorage.setItem(key,value);}catch{}},
  removeItem(key){recoveryMemory.delete(key);try{sessionStorage.removeItem(key);}catch{}}
};
const project=/^https:\/\/.+\.supabase\.co\/?$/.test(cfg.supabaseUrl||'')?new URL(cfg.supabaseUrl).hostname.split('.')[0]:'';
const recoveryKey='space-password-recovery-'+project,verifiedKey=recoveryKey+'-verified';
const initialHash=location.hash||'';
let recoveryUserId='',finished=false,auth=null;
const status=message=>{$('#resetStatus').textContent=message;};
function forgetRecovery(){
  recoveryUserId='';
  for(const suffix of ['', '-code-verifier','-user'])recoveryStorage.removeItem(recoveryKey+suffix);
  recoveryStorage.removeItem(verifiedKey);
}
function enablePassword(session,remember=true){
  if(finished||!session?.user?.id)return;
  recoveryUserId=session.user.id;
  if(remember)recoveryStorage.setItem(verifiedKey,JSON.stringify({userId:recoveryUserId,until:Date.now()+20*60*1000}));
  $('#recoveryCodeForm').hidden=true;$('#newPasswordForm').hidden=false;
  $('#resetIntro').textContent='Email verified. Choose a password for your existing SPACE account.';
  status('You can now set your password.');
}
function hasRecovery(session){
  try{const saved=JSON.parse(recoveryStorage.getItem(verifiedKey)||'null');return !!session?.user?.id&&saved?.userId===session.user.id&&saved.until>Date.now();}catch{return false;}
}
function clearMatchingWorkspace(userId){
  const key='sb-'+project+'-auth-token';
  // Another account on this browser must not be signed out by this recovery.
  for(const name of ['localStorage','sessionStorage'])try{
    const storage=window[name];
    const saved=JSON.parse(storage.getItem(key)||'null');
    if(saved?.user?.id!==userId)continue;
    for(const suffix of ['', '-code-verifier','-user'])storage.removeItem(key+suffix);
    try{window.localStorage.setItem(key+'-space-signed-out',String(Date.now()));}catch{}
  }catch{}
}
async function verifyRecoveryCode(event){
  event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');if(button.disabled)return;
  const values=new FormData(form),email=String(values.get('email')||'').trim().toLowerCase(),token=String(values.get('code')||'').trim();
  if(!email||!/^[0-9]{6,10}$/.test(token)){status('Enter your account email and the numeric reset code from your email.');return;}
  if(!auth){status('Password recovery is unavailable. Reload and try again.');return;}
  button.disabled=true;status('Verifying your reset code…');
  try{
    const {data,error}=await auth.verifyOtp({email,token,type:'recovery'});if(error)throw error;
    if(!data.session)throw Error('No recovery session was returned. Request a new reset email.');
    enablePassword(data.session);form.reset();$('#newPassword')?.focus();
  }catch(error){status(error.message||'This reset code is invalid or expired. Request another email from SPACE sign in.');}
  finally{button.disabled=false;}
}
async function savePassword(event){
  event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');if(button.disabled)return;
  const values=new FormData(form),password=String(values.get('password')||''),confirmation=String(values.get('password_confirm')||'');
  if(password.length<8){status('Use at least 8 characters for your password.');return;}
  if(password!==confirmation){status('Your passwords do not match.');return;}
  if(!auth){status('Password recovery is unavailable. Reload and try again.');return;}
  button.disabled=true;
  try{
    const {data,error}=await auth.getSession();if(error)throw error;
    if(!recoveryUserId||data.session?.user?.id!==recoveryUserId||!hasRecovery(data.session)){
      forgetRecovery();$('#newPasswordForm').hidden=true;$('#recoveryCodeForm').hidden=false;
      throw Error('Your reset session has expired. Request a new reset email.');
    }
    status('Saving your password…');
    const result=await auth.updateUser({password});if(result.error)throw result.error;
    const userId=recoveryUserId;finished=true;form.reset();form.hidden=true;
    clearMatchingWorkspace(userId);recoveryStorage.removeItem(verifiedKey);
    // Revoke this account’s refresh sessions after a password change.
    try{await auth.signOut({scope:'global'});}catch{}
    // signOut may return an error offline; discard the isolated local tokens too.
    forgetRecovery();$('#resetTitle').textContent='Password saved';
    $('#resetIntro').textContent='Your existing profile, roles and records are ready.';
    status('Return to SPACE and sign in with your email and new password.');
  }catch(error){status(error.message||'Could not save your password. Please try again.');}
  finally{button.disabled=false;}
}
async function initRecovery(){
  $('#recoveryCodeForm').addEventListener('submit',verifyRecoveryCode);
  $('#newPasswordForm').addEventListener('submit',savePassword);
  document.querySelectorAll('[data-password-toggle]').forEach(button=>button.addEventListener('click',()=>{
    const input=document.getElementById(button.dataset.passwordToggle),show=input.type==='password';
    input.type=show?'text':'password';button.textContent=show?'Hide':'Show';button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',(show?'Hide':'Show')+' password');
  }));
  if(!project||!cfg.supabaseAnonKey){status('Password recovery is not configured. Contact the club administrator.');return;}
  try{
    const client=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,storage:recoveryStorage,storageKey:recoveryKey,autoRefreshToken:false,detectSessionInUrl:true}});
    auth=client.auth;
    auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY')enablePassword(session);});
    const {data,error}=await auth.getSession();
    // Strip tokens and errors before the member follows any links.
    if(initialHash||location.search)history.replaceState(null,'',location.pathname);
    if(error)throw error;
    if(hasRecovery(data.session))enablePassword(data.session,false);
    else{forgetRecovery();$('#recoveryCodeForm').hidden=false;status(initialHash?'This reset link is invalid or expired. Enter a reset code or request a new email from SPACE sign in.':'Enter the reset code from your email. If you haven’t requested one, return to SPACE and choose Forgot password / Set password.');}
  }catch{
    forgetRecovery();history.replaceState(null,'',location.pathname);$('#recoveryCodeForm').hidden=false;
    status('Could not verify this reset link. Check your connection, enter a reset code, or request a new email.');
  }
}
initRecovery();
