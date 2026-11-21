// Never lose typed text: a draft is kept in this browser as it is typed (localStorage, at once) and on the server when
// the server has the drafts route (POST /api/projects/:id/drafts { key, text }, GET -> { key: text }); a server without
// it is asked once and then left alone. Read back on every mount: the newer of the two wins.
import { api } from './api.js';
import { debounce } from './dom.js';

const LS = 'presence.draft.';
let serverHas = (() => { try { return sessionStorage.getItem('presence.drafts404') ? false : null; } catch { return null; } })(); // null = not asked yet

function local(key) {
  try { return JSON.parse(localStorage.getItem(LS + key) || 'null'); } catch { return null; }
}

export function createDraft(pid, key) {
  const projectId = pid && pid !== '-' ? pid : null;
  const full = `${projectId || '-'}.${key}`;
  const toServer = debounce((text) => {
    if (serverHas === false || !projectId) return;
    api(`/api/projects/${encodeURIComponent(projectId)}/drafts`, { key, text })
      .then(() => { serverHas = true; })
      .catch((e) => { if (e.status === 404) serverHas = false; });
  }, 600);
  return {
    get() { return local(full)?.text || ''; },
    set(text) {
      try { if (text) localStorage.setItem(LS + full, JSON.stringify({ text, at: Date.now() })); else localStorage.removeItem(LS + full); } catch {}
      toServer(text);
    },
    clear() { this.set(''); toServer.flush(); },
    flush() { toServer.flush(); },
    // the server's copy when it is newer than this browser's (another window, another browser)
    async fromServer() {
      if (serverHas === false || !projectId) return null;
      try {
        const all = await api(`/api/projects/${encodeURIComponent(projectId)}/drafts`);
        serverHas = true;
        const v = all?.[key];
        const t = typeof v === 'string' ? v : v?.text;
        const at = typeof v === 'object' ? Number(v?.at) || 0 : 0;
        if (t && (!local(full) || at > (local(full)?.at || 0))) return t;
      } catch (e) { if (e.status === 404) { serverHas = false; try { sessionStorage.setItem('presence.drafts404', '1'); } catch {} } }
      return null;
    },
  };
}

// a textarea bound to a draft: filled at once, saved on every keystroke
export function bindDraft(textarea, draft) {
  textarea.value = draft.get();
  textarea.addEventListener('input', () => draft.set(textarea.value));
  textarea.addEventListener('blur', () => draft.flush());
  draft.fromServer().then((t) => { if (t != null && !textarea.value) { textarea.value = t; draft.set(t); } });
  return textarea;
}
