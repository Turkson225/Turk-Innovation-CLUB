/* The startup shell must recover even when the main module cannot download. */
(() => {
  const placeholder=document.querySelector('#content > .workspace-page-loading');
  if(!placeholder)return;
  function retry(){
    // Never replace a workspace that the app has already rendered.
    if(!placeholder.isConnected)return;
    placeholder.setAttribute('aria-busy','false');
    placeholder.innerHTML='<span class="eyebrow">CONNECTION CHECK</span><h1>SPACE is taking longer to open.</h1><p role="status">Check your connection, then reload. If SPACE finishes loading, this screen will close automatically.</p><button class="button button-outline" type="button">Reload SPACE</button>';
    placeholder.querySelector('button').addEventListener('click',()=>location.reload());
  }
  setTimeout(retry,12000);
  document.addEventListener('error',event=>{if(event.target?.matches?.('script[type="module"]'))retry();},true);
})();
