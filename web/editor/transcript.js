// The transcript: every word of the recording against the working edit. Playing words are plain; words a cut removed
// are struck through in grey (Restore brings them back); words you struck are struck in red (Bring back undoes it);
// long stretches the edit never used are folded. Click a word to jump there (a word not in the edit plays in Before);
// drag or Shift-click to select, then Delete (or the Strike button) cuts the selection.
import { h, button, esc } from '../shell/dom.js';
import { tokens, blocks, selectionActions, tokenAt } from './words.js';
import { unstrike } from './edl-edit.js';
import { fmtTime } from './zoom.js';
import { recipeOf, isLocked } from '../shell/stages.js';

// the talk is locked once its gate is approved: striking words no longer changes the video
const lockedNow = () => { const p = window.presence?.project?.(); return !!p && isLocked(p, recipeOf(p)); };

export function createTranscript(store, ui) {
  const S = store.S;
  const pick = h('select.tr-src', { title: 'Which recording' });
  const strikeBtn = button('strike', 'Strike', 'Cut the selected words (Delete)', () => strikeSel(), 'small warn');
  const backBtn = button('restore', 'Bring back', 'Bring the selected words back (restores their cut, or undoes your strike)', () => bringBack(), 'small calm');
  const followBtn = button('eye', '', 'Follow the playhead', () => { follow = !follow; followBtn.classList.toggle('on', follow); });
  const info = h('span.tr-info.dim');
  const page = h('div.tr-page');
  const el = h('div.transcript', h('div.tr-bar', pick, strikeBtn, backBtn, followBtn, info), page);

  let src = null, toks = [], sel = new Set(), anchor = null, nowK = -1, follow = true, dragging = false, moved = false;
  const open = new Set(); // folded stretches the user opened (by their start)

  pick.addEventListener('change', () => { src = pick.value; sel.clear(); render(); });

  function render() {
    const keys = Object.keys(S.sources || {});
    if (!keys.length) { page.innerHTML = '<p class="tr-empty">No words yet. They come with the rough cut.</p>'; pick.hidden = true; toks = []; paintButtons(); return; }
    if (!src || !keys.includes(src)) src = keys[0];
    pick.replaceChildren(...keys.map((k) => h('option', { value: k, selected: k === src }, `${k} · ${S.sources[k].file?.split('/').pop() || ''}`)));
    pick.hidden = keys.length < 2;
    const words = S.words[src] || [];
    toks = tokens(src, words, S.ps, S.cuts, S.strikes);
    if (!words.length) { page.innerHTML = '<p class="tr-empty">This recording has no word file yet.</p>'; paintButtons(); return; }
    const top = page.scrollTop;
    let html = '';
    for (const b of blocks(toks)) {
      if (b.type === 'fold' && !open.has(b.from)) {
        html += `<p class="tr-fold" data-from="${b.from}">▸ ${b.tokens.length} words not in the edit · ${fmtTime(b.from)}–${fmtTime(b.to)}</p>`;
        continue;
      }
      html += '<p class="tr-para">' + b.tokens.map((t) => {
        const cls = 'w ' + t.state + (sel.has(t.k) ? ' sel' : '');
        const tip = t.state === 'cut' ? ` title="removed by ${esc(t.cut)}"` : t.state === 'struck' ? ' title="you struck this"' : t.state === 'out' ? ' title="not in the edit"' : '';
        return `<span class="${cls}" data-k="${t.k}"${tip}>${esc(t.w)}</span>`;
      }).join(' ') + '</p>';
    }
    page.innerHTML = html;
    page.scrollTop = top;
    nowK = -1;
    const n = toks.filter((t) => t.state === 'in').length;
    info.textContent = `${n} of ${toks.length} words play`;
    paintButtons();
  }

  page.addEventListener('click', (e) => {
    const f = e.target.closest('.tr-fold');
    if (f) { open.add(Number(f.dataset.from)); render(); }
  });
  page.addEventListener('pointerdown', (e) => {
    const w = e.target.closest('.w'); if (!w || e.button !== 0) return;
    ui.setScope('editor');
    e.preventDefault();
    const k = Number(w.dataset.k);
    if (e.shiftKey && anchor != null) { select(anchor, k); return; }
    anchor = k; dragging = true; moved = false; select(k, k);
  });
  page.addEventListener('pointerover', (e) => {
    if (!dragging) return;
    const w = e.target.closest('.w'); if (!w) return;
    const k = Number(w.dataset.k);
    if (k !== anchor) moved = true;
    select(anchor, k);
  });
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    if (!moved && anchor != null) { jump(toks[anchor]); }
  };
  addEventListener('pointerup', onUp);

  function select(a, b) {
    sel = new Set(); for (let k = Math.min(a, b); k <= Math.max(a, b); k++) sel.add(k);
    for (const s of page.querySelectorAll('.w.sel')) s.classList.remove('sel');
    for (const k of sel) page.querySelector(`.w[data-k="${k}"]`)?.classList.add('sel');
    paintButtons();
  }
  function paintButtons() {
    const states = new Set([...sel].map((k) => toks[k]?.state));
    const locked = lockedNow();
    strikeBtn.disabled = locked || !states.has('in');
    backBtn.disabled = locked || !(states.has('cut') || states.has('struck'));
    strikeBtn.classList.toggle('warn', !strikeBtn.disabled); // red only when it would cut something
    strikeBtn.classList.toggle('calm', strikeBtn.disabled);
    strikeBtn.title = locked ? 'The talk is locked: words can no longer be cut' : 'Cut the selected words (Delete)';
    backBtn.title = locked ? 'The talk is locked: words can no longer come back' : 'Bring the selected words back (restores their cut, or undoes your strike)';
  }
  function jump(t) {
    if (!t) return;
    if (t.state === 'in') ui.seek(t.t);
    else { ui.seekSource(t.src, t.s); if (t.cut) ui.selectCut(t.cut, { seek: false }); }
  }

  function strikeSel() {
    if (!sel.size) return false;
    if (lockedNow()) { ui.toast('The talk is locked: words can no longer be cut. Send the video back with a note instead.', 'warn'); return true; }
    const a = selectionActions(toks, S.words[src] || [], [...sel]);
    if (!a.strike.length) return false;
    store.strike(a.strike);
    sel.clear();
    ui.toast(`Struck ${a.strike.length === 1 ? 'one stretch' : a.strike.length + ' stretches'}: it plays without them now (Ctrl+Z undoes).`);
    return true;
  }
  function bringBack() {
    const a = selectionActions(toks, S.words[src] || [], [...sel]);
    if (a.unstrike.length) store.strike(a.unstrike, unstrike);
    for (const id of a.restore) if (S.review[id]?.keep !== false) ui.restoreCut(id);
    sel.clear();
    render();
  }

  // the word playing now: by edit time in After, by source time in Before
  function onTime({ t, mode, src: s, srcT }) {
    let k = -1;
    if (mode === 'before' && s === src && srcT != null) {
      let lo = 0, hi = toks.length - 1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (toks[m].s <= srcT + 0.02) { k = m; lo = m + 1; } else hi = m - 1; }
    } else if (mode !== 'before') k = tokenAt(toks, t);
    if (k === nowK) return;
    page.querySelector('.w.now')?.classList.remove('now');
    nowK = k;
    const w = k >= 0 ? page.querySelector(`.w[data-k="${k}"]`) : null;
    if (w) {
      w.classList.add('now');
      if (follow && !dragging) {
        const r = w.getBoundingClientRect(), pr = page.getBoundingClientRect();
        if (r.top < pr.top + 20 || r.bottom > pr.bottom - 20) page.scrollTo({ top: page.scrollTop + (r.top - pr.top) - pr.height / 3, behavior: 'smooth' });
      }
    }
  }

  followBtn.classList.add('on');
  return { el, render, onTime, strikeSel, hasSelection: () => sel.size > 0, dispose: () => removeEventListener('pointerup', onUp) };
}
