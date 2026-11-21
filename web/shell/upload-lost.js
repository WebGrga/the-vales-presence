// An upload that was going when the page was reloaded or closed is lost: a browser cannot resume a file it streamed, and the
// server throws a half file away so no broken clip stays in the footage. This keeps the names, so the next load can say which
// file did not finish and offer "Add it again" (the browser has to be given the file again; a choice of file is all it takes).
//   began(project, name, size)   an upload starts      ended(project, name)   it finished or failed in plain view
//   lostFor(project) -> [{ name, size, at }]           clear(project, name)   forget one
// Pure rules (merge, drop) are exported for the tests (upload-lost.test.js); the storage is localStorage.
const INFLIGHT = 'presence.uploads.inflight', LOST = 'presence.uploads.lost';

// pure: add an entry (one per project and name)
export const withEntry = (list, project, name, size, at = Date.now()) => [...list.filter((e) => !(e.project === project && e.name === name)), { project, name, size: size || 0, at }];
export const withoutEntry = (list, project, name) => list.filter((e) => !(e.project === project && e.name === name));
// pure: what was in flight when the last page went away is lost now
export const mergeLost = (lost, inflight) => inflight.reduce((all, e) => withEntry(all, e.project, e.name, e.size, e.at), lost);

const read = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// at load: the uploads the previous page left in flight did not finish
if (typeof localStorage !== 'undefined') { write(LOST, mergeLost(read(LOST), read(INFLIGHT))); write(INFLIGHT, []); }

export const began = (project, name, size) => write(INFLIGHT, withEntry(read(INFLIGHT), project, name, size));
export const ended = (project, name) => write(INFLIGHT, withoutEntry(read(INFLIGHT), project, name));
export const lostFor = (project) => read(LOST).filter((e) => e.project === project);
export const clear = (project, name) => write(LOST, withoutEntry(read(LOST), project, name));
