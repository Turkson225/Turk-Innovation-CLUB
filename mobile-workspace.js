/* SPACE's mobile shell: existing routes, current permissions, no extra queries. */
(() => {
  'use strict';
  function create(ctx) {
    const e=ctx.esc,icon=ctx.icon,mq=window.matchMedia?.('(max-width: 760px)');
    const $=selector=>document.querySelector(selector);
    const nav=$('#mobileNav'),sidebar=$('#sidebar'),backdrop=$('#mobileMenuBackdrop'),account=$('#mobileAccount'),search=$('#mobilePageSearch');
    let menuOpen=false,returnFocus=null,identity='',navMarkup='',accountMarkup='',savedGroups=null;
    const isPhone=()=>!!mq?.matches;
    const count=n=>Number.isFinite(Number(n))&&Number(n)>0?Math.min(Number(n),100):0;
    const badge=n=>count(n)?`<i class="mobile-tab-badge">${count(n)>99?'99+':count(n)}</i>`:'';
    const allowed=(state,href)=>(state.allowed||[]).includes(href.replace(/^#/,'').split('/')[0]);
    const primary=state=>state.admin?['admin','Manage']:state.teacher?['teaching','Teach']:state.founder?['founder-room','Lead']:state.investor?['investor-portal','Portal']:['courses','Learn'];
    function tabs(state) {
      if(!state.approved)return '';
      const work=primary(state),groups={home:['home'],messages:['messages','channels'],courses:['courses','classroom'],teaching:['teaching','classroom'],admin:['admin','applications','officers','moderation','shop-admin','order-desk','finance','system-health'],calendar:['calendar','events'],'founder-room':['founder-room'],'investor-portal':['investor-portal']};
      const rows=[['home','Home'],...(state.club?[['messages','Chat']]:[]),work,...(state.club?[['calendar','Calendar']]:state.investor?[['notifications','Updates']]:[])].filter(([page])=>allowed(state,'#'+page));
      let matched=false;
      const links=rows.map(([page,label])=>{
        const selected=(groups[page]||[page]).includes(state.page);matched||=selected;
        const n=page==='messages'?state.messages:page==='admin'?state.pending:0;
        return `<a href="#${page}" class="mobile-tab ${selected?'is-current':''}" ${selected?'aria-current="page"':''} aria-label="${e(label)}${count(n)?', '+e(count(n)>99?'99+':count(n))+' unread':''}">${icon(page)}<span class="mobile-tab-label">${e(label)}</span>${badge(n)}</a>`;
      }).join('');
      return links+`<button type="button" class="mobile-tab ${matched?'':'is-current'}" data-mobile-action="menu" aria-controls="sidebar" aria-expanded="${menuOpen}" aria-label="More pages and account settings">${icon('more')}<span class="mobile-tab-label">More</span></button>`;
    }
    function updateCounts() { sync(); }
    function sync() {
      const state=ctx.get(),key=state.id||'guest';
      if(identity!==key){if(menuOpen)ctx.menu(false);if(search)search.value='';filter('');identity=key;}
      document.documentElement.dataset.mobileReady='true';
      document.documentElement.dataset.mobileAccount=state.id?'signed-in':'guest';
      document.documentElement.dataset.mobileChat=state.page==='messages'&&state.peer?'thread':'list';
      if(nav){nav.hidden=!state.approved;const html=tabs(state);if(html!==navMarkup){nav.innerHTML=html;navMarkup=html;}}
      const html=state.id?`<strong>${e(state.name)}</strong><small>${e(state.role)}</small><div class="mobile-account-buttons">${state.approved?'<button type="button" data-mobile-action="memberId">My member ID</button>':''}${state.club?'<a href="#avatar-studio">Avatar studio</a><a href="#space-map">SPACE Map</a>':''}<button type="button" data-mobile-action="accounts">Accounts</button><button type="button" data-mobile-action="theme">Appearance</button>${state.admin?'<button type="button" data-mobile-action="sound">Alert sound</button>':''}<button type="button" data-mobile-action="signout">Sign out</button></div>`:`<strong>Your next build starts here.</strong><div class="mobile-account-buttons"><button type="button" data-mobile-action="signin">Sign in</button><button type="button" data-mobile-action="theme">Appearance</button></div>`;
      if(account&&html!==accountMarkup){account.innerHTML=html;accountMarkup=html;}
      if(sidebar&&!menuOpen)sidebar.inert=isPhone();
      filter(search?.value||'');
    }
    function home() {
      const state=ctx.get();
      if(!state.id)return `<section class="mobile-public-home"><span class="eyebrow">TURK INNOVATION CLUB</span><h1>Learn. Build.<br>Make it happen.</h1><p>Practical skills, shared projects and people to build with.</p><div class="mobile-public-actions"><button type="button" class="button" data-action="login">Join SPACE</button><button type="button" class="button button-outline" data-action="signin">Sign in</button></div><img src="assets/club-about-lab.webp" alt="Illustration of makers building a prototype" width="720" height="480"><a class="mobile-home-row" href="about/"><span><strong>Discover the club</strong><small>Our purpose, people and four learning tracks</small></span><span aria-hidden="true">→</span></a><a class="mobile-home-row" href="founders/"><span><strong>Meet the founders</strong><small>The people behind TURK INNOVATION CLUB</small></span><span aria-hidden="true">→</span></a></section>`;
      const work=primary(state);
      const shortcuts=state.club?[['channels','Team chat','Group conversations'],['feed','Community','Club activity'],['shop','Store','Products & orders'],[state.office?'office':'members/'+state.id,state.office?'My office':'My profile',state.office?'Your responsibilities':'Your club profile']]:[['investor-portal','Investor portal','Updates & inquiries'],['founders','Leadership','Meet the founders']];
      const row=item=>`<a class="mobile-home-row ${item.urgent?'is-urgent':''}" href="${e(item.href)}"><span><strong>${e(item.title)}</strong><small>${e(item.detail||'Open to see the latest details')}</small></span><span aria-hidden="true">→</span></a>`;
      const actions=(state.actions||[]).filter(item=>allowed(state,item.href)).slice(0,3);
      const agenda=(state.agenda||[]).filter(item=>allowed(state,item.href)).slice(0,2);
      return `<header class="mobile-home-greeting"><div><p>${e(state.day)}</p><h1>Hi, ${e(state.firstName)}.</h1></div><span class="mobile-role-pill">${e(state.role)}</span></header>
      <a class="mobile-home-primary" href="#${work[0]}"><span class="mobile-home-primary-icon">${icon(work[0])}</span><span><strong>${e(state.workTitle)}</strong><small>${e(state.workCopy)}</small></span><span aria-hidden="true">→</span></a>
      <section class="mobile-home-section" aria-labelledby="mobile-next-heading"><div class="mobile-section-heading"><h2 id="mobile-next-heading">Your next steps</h2><a href="#notifications">Updates${badge(state.notices)}</a></div><div class="mobile-home-list">${actions.length?actions.map(row).join(''):`<a class="mobile-home-row" href="#${work[0]}"><span><strong>Open your ${e(state.workLabel)}</strong><small>See your latest work and available activities.</small></span><span aria-hidden="true">→</span></a>`}</div></section>
      ${state.club?`<section class="mobile-home-section" aria-labelledby="mobile-shortcuts-heading"><div class="mobile-section-heading"><h2 id="mobile-shortcuts-heading">Jump back in</h2></div><div class="mobile-home-shortcuts" data-bento="shortcuts">${shortcuts.filter(([page])=>allowed(state,'#'+page)).map(([page,label,copy])=>`<a href="#${e(page)}"><span class="mobile-shortcut-icon">${icon(page.split('/')[0])}</span><strong>${e(label)}</strong><small>${e(copy)}</small></a>`).join('')}</div></section>`:''}
      ${state.club?`<section class="mobile-home-section" aria-labelledby="mobile-agenda-heading"><div class="mobile-section-heading"><h2 id="mobile-agenda-heading">Coming up</h2><a href="#calendar">Calendar →</a></div><div class="mobile-home-list">${agenda.length?agenda.map(row).join(''):'<a class="mobile-home-row" href="#calendar"><span><strong>Open your calendar</strong><small>Find workshops, events and scheduled sessions.</small></span><span aria-hidden="true">→</span></a>'}</div></section>`:''}`;
    }
    function filter(term) {
      if(!sidebar)return;
      const query=String(term).trim().toLowerCase(),links=[...sidebar.querySelectorAll('#nav a[data-page]')],sections=[...sidebar.querySelectorAll('details[data-nav-group]')];
      if(query&&!savedGroups)savedGroups=new Map(sections.map(section=>[section,section.open]));
      let matches=0;
      for(const link of links){const match=!query||String(link.textContent).toLowerCase().includes(query);link.dataset.mobileFiltered=String(!match);if(match&&!link.hidden)matches++;}
      for(const section of sections){const match=[...section.querySelectorAll('a[data-page]')].some(link=>!link.hidden&&link.dataset.mobileFiltered!=='true');section.dataset.mobileFiltered=String(!!query&&!match);if(query&&match)section.open=true;}
      if(!query&&savedGroups){for(const [section,open]of savedGroups)if(!section.hidden)section.open=open;savedGroups=null;}
      const empty=$('#mobileMenuEmpty');if(empty)empty.hidden=!query||matches>0;
    }
    function menuState(open) {
      const wasOpen=menuOpen;menuOpen=!!open&&isPhone();
      if(backdrop)backdrop.hidden=!menuOpen;
      document.documentElement.classList.toggle('mobile-menu-open',menuOpen);
      const main=$('.main');if(main)main.inert=menuOpen;
      if(nav)nav.inert=menuOpen;
      if(sidebar){sidebar.inert=isPhone()&&!menuOpen;if(menuOpen){sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');sidebar.setAttribute('aria-label','Pages and account settings');}else{sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');sidebar.removeAttribute('aria-label');}}
      if(menuOpen&&!wasOpen){returnFocus=document.activeElement;$('#mobileMenuClose')?.focus();}
      if(!menuOpen&&wasOpen){if(search)search.value='';filter('');if(sidebar?.contains(document.activeElement))((returnFocus?.isConnected?returnFocus:null)||$('#menuBtn'))?.focus();}
      nav?.querySelector('[data-mobile-action="menu"]')?.setAttribute('aria-expanded',String(menuOpen));
    }
    document.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-mobile-action]');
      if(button){event.preventDefault();const action=button.dataset.mobileAction;if(action==='menu')ctx.menu(!menuOpen);else if(action==='close')ctx.menu(false);else{ctx.menu(false);ctx.action(action);}return;}
      const summary=event.target.closest?.('#nav details > summary');
      if(summary&&isPhone()&&!summary.parentElement.open)for(const section of sidebar.querySelectorAll('details[data-nav-group]'))if(section!==summary.parentElement)section.open=false;
      const link=event.target.closest?.('#mobileNav a[href]');if(link)ctx.menu(false);
    });
    document.addEventListener('input',event=>{if(event.target===search)filter(search.value);});
    document.addEventListener('keydown',event=>{
      if(!menuOpen)return;
      if(event.key==='Escape'){event.preventDefault();ctx.menu(false);return;}
      if(event.key!=='Tab')return;
      const items=[...sidebar.querySelectorAll('a[href],button:not([disabled]),input,summary')].filter(item=>!item.hidden&&item.getClientRects().length);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    });
    const keyboard=()=>{const field=document.activeElement;document.documentElement.dataset.mobileKeyboard=field?.matches?.('textarea,select,[contenteditable="true"],input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])')?'open':'closed';};
    document.addEventListener('focusin',keyboard);document.addEventListener('focusout',()=>queueMicrotask(keyboard));
    mq?.addEventListener?.('change',()=>{ctx.menu(false);ctx.viewportChange?.();sync();});
    sync();
    return {sync,home,menuState,updateCounts};
  }
  window.SpaceMobile={create};
})();
