// Looks at every request the page makes (it wraps window.fetch once) and tells listeners how each one ended, so the
// save chip and Undo need no code in the editor, the Studio or the Context tab.
//   watch(fn)  fn({ url, method, ok, status, error, headers, init, input }) after each request ends; returns the way to stop
// Only the answer's headers are read, never its body, so the code that made the request is not disturbed.
const listeners = new Set();
let installed = false;

const pathOf = (input) => { try { return new URL(typeof input === 'string' ? input : input.url, location.href).pathname; } catch { return String(input); } };

export function watch(fn) {
  if (!installed && typeof window !== 'undefined' && window.fetch) {
    installed = true;
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const method = String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      const url = pathOf(input);
      const tell = (r) => { for (const f of [...listeners]) { try { f({ url, method, init, input, ...r }); } catch (e) { console.error(e); } } };
      if (method === 'GET' || method === 'HEAD') return real(input, init);
      tell({ phase: 'start' });
      try {
        const res = await real(input, init);
        tell({ phase: 'end', ok: res.ok, status: res.status, headers: res.headers });
        return res;
      } catch (e) {
        tell({ phase: 'end', ok: false, status: 0, error: String(e?.message || e) });
        throw e;
      }
    };
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}
