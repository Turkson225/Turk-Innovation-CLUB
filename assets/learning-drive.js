// Rebuild each URL from a supported Google file ID. Never embed a supplied URL
// directly or keep arbitrary query parameters from the share link.
const fileId = /^[A-Za-z0-9_-]{10,150}$/;
const editorPath = /^\/(presentation|document|spreadsheets)\/d\/([A-Za-z0-9_-]{10,150})(?:\/(?:edit|view|preview|present|embed))?\/?$/;

export function googleDriveMaterial(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input || input.length > 1000 || /[\s\\]/u.test(input)) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  let base;
  let editor;
  if (url.hostname === 'drive.google.com') {
    const id = url.pathname === '/open' ? url.searchParams.get('id')
      : url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,150})(?:\/(?:view|preview|edit))?\/?$/)?.[1];
    if (!id || !fileId.test(id)) return null;
    base = `https://drive.google.com/file/d/${id}`;
  } else if (url.hostname === 'docs.google.com') {
    const match = url.pathname.match(editorPath);
    if (!match) return null;
    editor = match[1];
    base = `https://docs.google.com/${editor}/d/${match[2]}`;
  } else return null;
  let query = '';
  if (url.searchParams.has('resourcekey')) {
    const key = url.searchParams.get('resourcekey');
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(key)) return null;
    query = `?resourcekey=${key}`;
  }
  return {
    open: `${base}/${editor ? 'edit' : 'view'}${query}`,
    preview: `${base}/preview${query}`
  };
}
