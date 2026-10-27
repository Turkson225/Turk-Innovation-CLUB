// Remember the main account; isolate explicit additional accounts in their tabs.
export function createAuthPersistence({cfg,configured,startupAuthCallback,startupRecovery,navigationPending=()=>false}){
const authMemory=new Map(),authPersistentMemory=new Map();
// The main account is remembered. Separate account tabs never share its tokens.
const authTabStorage={
  getItem(key){try{return sessionStorage.getItem(key);}catch{return authMemory.get(key)??null;}},
  setItem(key,value){authMemory.set(key,value);try{sessionStorage.setItem(key,value);}catch{}},
  removeItem(key){authMemory.delete(key);try{sessionStorage.removeItem(key);}catch{}}
};
const authBrowserStorage={
  getItem(key){try{return localStorage.getItem(key);}catch{return authPersistentMemory.get(key)??null;}},
  setItem(key,value){authPersistentMemory.set(key,value);try{localStorage.setItem(key,value);}catch{}},
  removeItem(key){authPersistentMemory.delete(key);try{localStorage.removeItem(key);}catch{}}
};
const authBaseStorageKey=configured?`sb-${new URL(cfg.supabaseUrl).hostname.split('.')[0]}-auth-token`:'';
const separateAccountMarker=authBaseStorageKey+'-space-separate-mode';
// Opening a confirmation link must not replace another remembered account.
const separateAccountTab=/[?&]account=separate(?:&|$)/.test(location.search||'')||authTabStorage.getItem(separateAccountMarker)==='1'||!!(startupAuthCallback&&!startupRecovery&&authBrowserStorage.getItem(authBaseStorageKey));
if(separateAccountTab)authTabStorage.setItem(separateAccountMarker,'1');
const separateSessionKey=authBaseStorageKey+'-space-tab-session';
// Supabase also broadcasts by storageKey. A fresh channel per document prevents
// copied/duplicated tabs from changing one another's active account.
const authStorageKey=separateAccountTab?authBaseStorageKey+'-tab-'+crypto.randomUUID():authBaseStorageKey;
const authPersistentStorage=separateAccountTab?{
  getItem(key){return navigationPending()?null:authTabStorage.getItem(key.startsWith(authStorageKey)?separateSessionKey+key.slice(authStorageKey.length):key);},
  setItem(key,value){if(!navigationPending())authTabStorage.setItem(key.startsWith(authStorageKey)?separateSessionKey+key.slice(authStorageKey.length):key,value);},
  removeItem(key){authTabStorage.removeItem(key.startsWith(authStorageKey)?separateSessionKey+key.slice(authStorageKey.length):key);}
}:authBrowserStorage;
const SIGNED_OUT_KEY=authStorageKey?authStorageKey+'-space-signed-out':'';
function clearSavedAuthTokens(){
  if(!authStorageKey)return;
  for(const suffix of ['', '-code-verifier', '-user']){authPersistentStorage.removeItem(authStorageKey+suffix);authTabStorage.removeItem(authStorageKey+suffix);}
}
function migrateSavedAuth(){
  if(!authStorageKey)return;
  if(authPersistentStorage.getItem(SIGNED_OUT_KEY))clearSavedAuthTokens();
  else if(!separateAccountTab)for(const suffix of ['', '-code-verifier', '-user']){
    const key=authStorageKey+suffix,tab=authTabStorage.getItem(key);
    if(!authPersistentStorage.getItem(key)&&tab)authPersistentStorage.setItem(key,tab);
    authTabStorage.removeItem(key);
  }
  authTabStorage.removeItem('space.auth.tab-clock.v1');
}
function clearTabEntries(prefix){
  try{const keys=[];for(let i=0;i<sessionStorage.length;i++){const key=sessionStorage.key(i);if(key?.startsWith(prefix))keys.push(key);}for(const key of keys)authTabStorage.removeItem(key);}catch{}
  for(const key of [...authMemory.keys()])if(key.startsWith(prefix))authTabStorage.removeItem(key);
}
migrateSavedAuth();
return {authTabStorage,authBrowserStorage,authBaseStorageKey,separateAccountMarker,separateAccountTab,separateSessionKey,authStorageKey,authPersistentStorage,SIGNED_OUT_KEY,clearSavedAuthTokens,migrateSavedAuth,clearTabEntries};
}
