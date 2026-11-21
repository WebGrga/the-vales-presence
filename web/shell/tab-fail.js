// What a tab that did not open says (pure, tested in tab-fail.test.js): why, in plain words, and what to try.
// stage: 'load' (the module could not be fetched or parsed), 'mount' (it loaded and threw), 'shape' (it has no mount()).
export function explain(label, stage, err) {
  const m = String(err?.message || err || '').replace(/\s+/g, ' ').trim();
  if (stage === 'shape') return { title: `${label} has no screen`, why: 'Its file loaded but does not offer a screen to show. This is a fault in the app, not in your project.', hint: 'Retry once; if it stays, copy the Setup report when you ask for help.' };
  if (stage === 'mount') return { title: `${label} could not open`, why: m ? `It started and then stopped with: ${m.slice(0, 240)}` : 'It started and then stopped without saying why.', hint: 'Your project is not touched. Retry, or open another tab and come back.' };
  if (/failed to fetch|networkerror|load failed|404|not found|cannot find/i.test(m)) return { title: `${label} did not load`, why: 'The server did not send the file for this room: it may have stopped, or the file is missing.', hint: 'Check that the app is still running, then Retry.' };
  if (/syntaxerror|unexpected token|unexpected identifier|does not provide an export|importing a module/i.test(m)) return { title: `${label} did not load`, why: `The file for this room has a mistake in it: ${m.slice(0, 200)}`, hint: 'This is a fault in the app. Retry after it is fixed, and copy the Setup report when you ask for help.' };
  return { title: `${label} did not load`, why: m ? m.slice(0, 240) : 'No reason was given.', hint: 'Retry.' };
}
