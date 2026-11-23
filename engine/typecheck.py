"""Type-check a template's Remotion components the way a workshop would build them, without making a workshop.

    python typecheck.py <template dir> [<template dir> ...]      e.g. python typecheck.py ../kit/templates/<name>

Makes a scratch project in <temp>/presence-typecheck/<name>/ with the shared tsconfig, a link to the node_modules with Remotion and TypeScript
($PRESENCE_REMOTION_MODULES, else engine/remotion/node_modules: run `npm install` in engine/remotion once), the template's .ts/.tsx files in src/
(components.tsx at the root of the template is src/components.tsx) and the engine's shared files in src/pipeline/, then runs `tsc --noEmit`.
Exit 1 when any template has errors.
"""
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipelib import PIPE, env

MODULES = os.path.expanduser(env('REMOTION_MODULES') or os.path.join(PIPE, 'remotion', 'node_modules'))


def link_dir(link, target):
    """A directory link: a junction on Windows (no admin rights needed), a symlink elsewhere."""
    if sys.platform == 'win32':
        subprocess.run(['cmd', '/c', 'mklink', '/J', link, os.path.abspath(target)], capture_output=True)
    else:
        os.symlink(os.path.abspath(target), link, target_is_directory=True)


def tsc_path():
    b = os.path.join(MODULES, '.bin')
    return os.path.join(b, 'tsc.cmd') if sys.platform == 'win32' else os.path.join(b, 'tsc')


def check(tdir):
    name = os.path.basename(os.path.abspath(tdir))
    base = os.path.join(tempfile.gettempdir(), 'presence-typecheck', name)
    shutil.rmtree(base, ignore_errors=True)
    src = os.path.join(base, 'src')
    os.makedirs(os.path.join(src, 'pipeline'))
    for n in os.listdir(os.path.join(PIPE, 'remotion')):
        if n.endswith(('.ts', '.tsx')):
            shutil.copy2(os.path.join(PIPE, 'remotion', n), os.path.join(src, 'pipeline', n))
    n_files = 0
    for n in os.listdir(tdir):
        if n.endswith(('.ts', '.tsx')) and n not in ('Root.tsx', 'index.ts', 'theme.ts') or n == 'theme.ts':
            shutil.copy2(os.path.join(tdir, n), os.path.join(src, n))
            n_files += 1
    shared = os.path.join(os.path.dirname(os.path.abspath(tdir)), '..', 'show', 'show.tsx')   # kit/show/show.tsx: a template's components import ./show
    if os.path.isfile(shared) and not os.path.isfile(os.path.join(src, 'show.tsx')):
        shutil.copy2(shared, os.path.join(src, 'show.tsx'))
        n_files += 1
    if not os.path.isfile(os.path.join(src, 'components.tsx')):
        print(f'{name}: no components.tsx')
        return 1
    shutil.copy2(os.path.join(PIPE, 'remotion', 'tscheck', 'tsconfig.json'), os.path.join(base, 'tsconfig.json'))
    with open(os.path.join(base, 'package.json'), 'w') as f:
        f.write('{"name":"tc","private":true}\n')
    if not os.path.isfile(tsc_path()):
        print(f'{name}: no TypeScript in {MODULES}: run `npm install` in engine/remotion (or set PRESENCE_REMOTION_MODULES)')
        return 1
    link_dir(os.path.join(base, 'node_modules'), MODULES)
    r = subprocess.run([tsc_path(), '--noEmit', '-p', base], capture_output=True, text=True, encoding='utf-8', errors='replace', cwd=base)
    out = (r.stdout + r.stderr).strip()
    if r.returncode:
        print(f'{name}: TYPE ERRORS\n{out[:3000]}')
    else:
        print(f'{name}: types fine ({n_files} files)')
    return r.returncode


if __name__ == '__main__':
    rc = 0
    for d in sys.argv[1:]:
        rc |= 1 if check(d) else 0
    sys.exit(rc)
