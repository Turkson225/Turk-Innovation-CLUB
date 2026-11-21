// The signed-in home is a directory of links. Pages keep their own data and actions.
const destinations = {
  courses: ['My learning', 'Workshops, assignments and feedback.', 'courses', 'violet'],
  classroom: ['Classrooms', 'Lessons, slides and your progress.', 'courses', 'violet'],
  teaching: ['Teaching studio', 'Manage workshops and review student work.', 'teaching', 'violet'],
  projects: ['Projects', 'Find a team and build something together.', 'projects', 'mint'],
  library: ['Shared files', 'Browse documents shared with the club.', 'library', 'mint'],
  messages: ['Direct messages', 'Continue a private conversation.', 'messages', 'blue'],
  channels: ['Team chat', 'Talk in group channels.', 'channels', 'blue'],
  feed: ['Member feed', 'Share progress and see what others are building.', 'feed', 'violet'],
  members: ['Members', 'Meet people and find teammates.', 'members', 'mint'],
  discussions: ['Discussion forum', 'Ask questions and share ideas.', 'discussions', 'amber'],
  calendar: ['Calendar', 'See workshops, deadlines and events.', 'calendar', 'amber'],
  events: ['Events', 'Find meetups and club sessions.', 'events', 'amber'],
  announcements: ['Announcements', 'Read updates from the club.', 'announcements', 'violet'],
  chapters: ['University chapters', 'Find and join a campus chapter.', 'chapters', 'mint'],
  shop: ['Club shop', 'Browse club merchandise and kits.', 'shop', 'blue'],
  'getting-started': ['Getting started', 'Learn your way around SPACE.', 'home', 'blue'],
  applications: ['Membership approvals', 'Review applicants waiting to join.', 'applications', 'amber'],
  admin: ['Admin overview', 'Manage the club workspace.', 'admin', 'violet'],
  'chapter-admin': ['Chapter control centre', 'Manage university chapters.', 'chapters', 'mint'],
  'order-desk': ['Orders & fulfilment', 'Process and track club orders.', 'shop', 'blue'],
  'founder-room': ['Founder meetings', 'Plan meetings and review decisions.', 'founders', 'violet'],
  office: ['My office', 'See your assigned work and records.', 'office', 'blue'],
  notifications: ['Notifications', 'Read your personal updates.', 'notifications', 'amber'],
  'investor-portal': ['Investor portal', 'Read club updates and send inquiries.', 'investors', 'violet'],
  founders: ['Club leadership', 'Meet the people behind SPACE.', 'founders', 'mint'],
  about: ['About SPACE', 'Learn what the club is building.', 'about', 'blue']
};

export function spaceHomeTabs(capabilities, allowed) {
  const {admin, teacher, founder, investor, office} = capabilities;
  const primary = investor ? 'investor-portal' : admin ? 'applications' : teacher ? 'teaching' : founder ? 'founder-room' : 'courses';
  const lists = investor
    ? [['overview', 'Overview', 'Start here', [primary, 'notifications', 'founders', 'about']]]
    : [
        ['overview', 'Overview', 'Start here', [primary, 'messages', 'calendar', admin ? 'admin' : 'projects']],
        ['learning', 'Learning', 'Learning & projects', ['courses', 'classroom', 'projects', 'library', ...(teacher ? ['teaching'] : [])]],
        ['community', 'Community', 'Club community', ['messages', 'channels', 'feed', 'members', 'discussions']],
        ['club', 'Club', 'Club life', ['announcements', 'events', 'chapters', 'shop', 'getting-started']],
        ['manage', 'Manage', 'Your responsibilities', [
          ...(admin ? ['applications', 'admin', 'chapter-admin', 'order-desk'] : []),
          ...(founder ? ['founder-room'] : []),
          ...(office ? ['office'] : [])
        ]]
      ];
  return lists.map(([id, label, heading, links]) => ({id, label, heading, links: links.filter(allowed)}))
    .filter(tab => tab.links.length);
}

export function renderSpaceHome({state, capabilities, allowed, esc, icon, selected, visitNext, pendingRole}) {
  const tabs = spaceHomeTabs(capabilities, allowed);
  const active = tabs.some(tab => tab.id === selected) ? selected : 'overview';
  const arrow = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>';
  const counts = {messages: state.messages, applications: state.pending, notifications: state.notices};
  const countCopy = {messages:'unread', applications:'pending', notifications:'unread'};
  const tabsVisible = tabs.length > 1;
  const card = route => {
    const [title, detail, symbol, tone] = destinations[route];
    const count = Number(counts[route]);
    return `<a class="space-home-card" data-home-card="${route}" href="#${route}">
      <span class="space-home-card-icon tone-${tone}">${icon(symbol)}</span>
      <span class="space-home-card-copy"><strong>${title}</strong><span>${detail}</span></span>
      <span class="space-home-card-end">${count > 0 ? `<small>${count > 99 ? '99+' : count} ${countCopy[route]}</small>` : ''}${arrow}</span>
    </a>`;
  };
  const next = pendingRole ? {href:'#role-updates', title:'Role update to review', detail:'Read and acknowledge your new responsibilities.'} : visitNext;
  const row = next && typeof next.href === 'string' && /^#[a-z-]+(?:\/[0-9a-f-]{36})?$/i.test(next.href)
    && allowed(next.href.slice(1).split('/')[0])
    ? `<a class="space-home-next" data-home-card="next" href="${esc(next.href)}"${next.courseId&&next.href==='#courses'
        ? ` data-action="focusCourse" data-id="${esc(next.courseId)}" data-view="${esc(next.view || 'overview')}"` : ''}>
        <span class="space-home-next-label">${pendingRole ? 'ACTION NEEDED' : 'UP NEXT'}</span>
        <span><strong>${esc(next.title)}</strong><small>${esc(next.detail || '')}</small></span>${arrow}
      </a>` : '';
  return `<div class="space-home">
    <header class="space-home-greeting">
      <div><p>${esc(state.day)}</p><h1>Hi, ${esc(state.firstName || 'there')}.</h1><p>Where would you like to go?</p></div>
      <div class="space-home-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
    </header>
    ${tabsVisible ? `<div class="space-home-tabs" role="tablist" aria-label="Home sections">${tabs.map(tab =>
      `<button id="space-home-tab-${tab.id}" type="button" role="tab" data-home-tab="${tab.id}" aria-controls="space-home-panel-${tab.id}" aria-selected="${tab.id === active}" tabindex="${tab.id === active ? 0 : -1}">${tab.label}</button>`
    ).join('')}</div>` : ''}
    ${tabs.map(tab => `<section id="space-home-panel-${tab.id}" class="space-home-panel" data-home-panel="${tab.id}"
      ${tabsVisible ? `role="tabpanel" aria-labelledby="space-home-tab-${tab.id}"` : 'aria-labelledby="space-home-section-title"'}${tab.id === active ? '' : ' hidden'}>
      <h2${tabsVisible ? '' : ' id="space-home-section-title"'}>${tab.heading}</h2>
      <div class="space-home-grid">${tab.links.map(card).join('')}</div>
      ${tab.id === 'overview' ? row : ''}
    </section>`).join('')}
  </div>`;
}

export function selectSpaceHomeTab(root, selected, focus = false) {
  const tabs = Array.from(root?.querySelectorAll('[data-home-tab]') || []);
  const next = tabs.find(tab => tab.dataset.homeTab === selected);
  if (!next) return false;
  for (const tab of tabs) {
    const active = tab === next;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of root.querySelectorAll('[data-home-panel]')) panel.hidden = panel.dataset.homePanel !== selected;
  if (focus) next.focus({preventScroll: true});
  return true;
}

export function spaceHomeKeyboardTarget(event, tab) {
  const key = event.key;
  if (!tab || !['ArrowLeft','ArrowRight','Home','End'].includes(key)) return '';
  const tabs = Array.from(tab.parentElement.querySelectorAll('[data-home-tab]'));
  const index = tabs.indexOf(tab);
  if (index < 0) return '';
  return tabs[key === 'Home' ? 0 : key === 'End' ? tabs.length - 1
    : (index + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].dataset.homeTab;
}
