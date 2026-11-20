/* Give Home a clear reading order using the existing controls and cards. */
(() => {
  'use strict';
  const content=document.getElementById('content');
  if(!content)return;
  function layout(){
    const home=content.querySelector(':scope > .desktop-home');
    const intro=home?.querySelector(':scope > .home-personal-intro');
    if(!intro||home.classList.contains('space-home-main'))return;
    const summary=home.querySelector(':scope > .home-glance');
    const next=home.querySelector(':scope > .space-my-day');
    home.classList.add('space-home-main');
    // Move the nodes themselves so links, focus order and action attributes stay intact.
    const focused=document.activeElement;
    home.prepend(...[intro,summary,next].filter(Boolean));
    if(home.contains(focused)&&document.activeElement!==focused)focused.focus({preventScroll:true});
  }
  if(typeof MutationObserver==='function')new MutationObserver(layout).observe(content,{childList:true});
  layout();
})();
