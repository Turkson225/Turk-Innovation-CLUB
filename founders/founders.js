(() => {
    const container = document.querySelector('#founderDirectory');
    const cfg = window.INNOVATEX_CONFIG || {};
    const fallback = (title, message) => {
      container.replaceChildren();
      const box = document.createElement('div'); box.className = 'public-founder-empty';
      const heading = document.createElement('h3'); heading.textContent = title;
      const description = document.createElement('p'); description.textContent = message + ' ';
      const link = document.createElement('a'); link.href = '../#founders'; link.className = 'link'; link.textContent = 'Open the club directory →';
      description.append(link); box.append(heading, description); container.append(box);
    };
    const initials = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
    const externalUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
    const portraitUrl = (base, founder) => {
      const path = String(founder.portrait_path || '');
      if (!/^[0-9a-f-]{36}$/.test(String(founder.id || '')) || !path.startsWith(founder.id + '/') || !/^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/.test(path.slice(37))) return '';
      return base + '/storage/v1/object/public/club-founder-portraits/' + path.split('/').map(encodeURIComponent).join('/');
    };
    const card = (base, founder) => {
      const article = document.createElement('article'); article.className = 'public-card public-founder-profile';
      const imageWrap = document.createElement('div'); imageWrap.className = 'public-founder-photo';
      const fallbackMark = document.createElement('span'); fallbackMark.textContent = initials(founder.name) || 'IX'; fallbackMark.setAttribute('aria-hidden', 'true'); imageWrap.append(fallbackMark);
      const photo = portraitUrl(base, founder);
      if (photo) { const image = document.createElement('img'); image.alt = 'Portrait of ' + founder.name; image.loading = 'lazy'; image.addEventListener('error', () => image.remove()); image.src = photo; imageWrap.append(image); }
      const copy = document.createElement('div'); copy.className = 'public-founder-copy';
      const role = document.createElement('span'); role.className = 'eyebrow'; role.textContent = founder.role || 'Founder';
      const name = document.createElement('h3'); name.textContent = founder.name || 'Founder';
      const bio = String(founder.bio || 'Founding team member').trim();
      const preview = document.createElement('p');
      if (bio.length > 195) {
        preview.textContent = bio.slice(0, 195).replace(/\s+\S*$/, '').trim() + '…';
        const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Read full bio';
        const full = document.createElement('p'); full.textContent = bio; details.append(summary, full); copy.append(role, name, preview, details);
      } else { preview.textContent = bio; copy.append(role, name, preview); }
      const profile = externalUrl(founder.link_url);
      if (profile) { const link = document.createElement('a'); link.href = profile; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'View profile ↗'; copy.append(link); }
      article.append(imageWrap, copy); return article;
    };
    const base = typeof cfg.supabaseUrl === 'string' && /^https:\/\//.test(cfg.supabaseUrl) ? cfg.supabaseUrl.replace(/\/$/, '') : '';
    if (!base || !cfg.supabaseAnonKey) { fallback('Directory unavailable', 'The founder directory could not be loaded right now.'); return; }
    const load = async () => {
      const columns = ['id,name,role,bio,link_url,sort_order,portrait_path', 'id,name,role,bio,link_url,sort_order'];
      let records;
      for (const select of columns) {
        const url = base + '/rest/v1/founders?select=' + encodeURIComponent(select) + '&order=sort_order.asc&limit=100';
        const response = await fetch(url, { cache: 'no-store', headers: { apikey: cfg.supabaseAnonKey, Accept: 'application/json' } });
        if (response.ok) { records = await response.json(); break; }
        if (response.status !== 400 || select === columns[1]) throw new Error('Founder directory request failed');
      }
      if (!Array.isArray(records)) throw new Error('Invalid founder directory response');
      container.replaceChildren();
      if (records.length === 0) { fallback('Meet the team soon', 'Founder profiles will appear here after each person approves their public listing.'); return; }
      container.classList.toggle('single', records.length === 1);
      records.forEach(founder => container.append(card(base, founder)));
    };
    load().catch(() => fallback('Directory unavailable', 'The founder directory could not be loaded right now.'));
  })();
