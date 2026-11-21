"""Your edits on top of the visuals' events.json, applied wherever the engine reads the events (check, render, compose, the cut check).

    video/out/event-edits.json   {"version": 1, "edits": {"L3": {"at": 149.7, "end": 154.3, "text": "...", "props": {"text": "..."}, "hide": false}}}
                                 made in the overlay inspector: an event's timing, its words and its props (merged over the event's own), or hidden
    video/out/redactions.json    the blur boxes you drew in the viewer (redact.py)

events.json stays as the visuals stage wrote it (a make_overlays.py run writes it again); these files sit beside it and win. With neither file,
load() is exactly events.json, so nothing changes for a cut without your edits. An edit names its event by id: one whose id is gone is skipped
and said so.
"""
import copy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import redact
from pipelib import read_json

EDITABLE = ('at', 'end', 'text')


def edits_path(cut):
    return os.path.join(cut.out, 'event-edits.json')


def apply_edits(doc, edits):
    """(doc with the edits applied, [ids not found]). Pure: the doc passed in is not changed."""
    table = (edits or {}).get('edits') if isinstance(edits, dict) else None
    if not isinstance(table, dict) or not table:
        return doc, []
    out = copy.deepcopy(doc)
    byid = {e.get('id'): e for e in out.get('events', [])}
    missing, hidden = [], set()
    for i, ed in table.items():
        e = byid.get(i)
        if e is None or not isinstance(ed, dict):
            missing.append(i)
            continue
        if ed.get('hide') is True:
            hidden.add(i)
            continue
        for k in ('at', 'end'):
            if isinstance(ed.get(k), (int, float)):
                e[k] = round(float(ed[k]), 3)
        if isinstance(ed.get('text'), str):
            e['text'] = ed['text']
        if isinstance(ed.get('props'), dict):
            e['props'] = {**(e.get('props') or {}), **ed['props']}
    if hidden:
        out['events'] = [e for e in out['events'] if e.get('id') not in hidden]
    return out, missing


def merge(doc, edits=None, redactions=None):
    """events.json + your edits + your blur boxes -> (doc, notes). Pure."""
    notes = []
    d, missing = apply_edits(doc, edits)
    if missing:
        notes.append(f'event-edits.json names events that are gone: {", ".join(missing)} (skipped)')
    if redactions:
        evs, skipped = redact.box_events(redactions, doc.get('width', 0), doc.get('height', 0))
        if skipped:
            notes.append('redactions.json: ' + '; '.join(skipped))
        if evs:
            if d is doc:
                d = copy.deepcopy(doc)
            mine = {e['id'] for e in evs}
            d['events'] = [e for e in d['events'] if e.get('id') not in mine] + evs
    return d, notes


def load(cut, notes=None):
    """The events the engine works from: events.json with event-edits.json and redactions.json applied."""
    doc = read_json(cut.events)
    ed = read_json(edits_path(cut)) if os.path.isfile(edits_path(cut)) else None
    rd = read_json(redact.redactions_path(cut)) if os.path.isfile(redact.redactions_path(cut)) else None
    if ed is None and rd is None:
        return doc
    d, n = merge(doc, ed, rd)
    if notes is not None:
        notes.extend(n)
    return d
