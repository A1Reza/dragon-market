"""Reviewer execution recorder. Runs original checks, preserves prior evidence."""
from pathlib import Path
import datetime as dt
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'review/codex-2026-10-21/evidence'
OUT.mkdir(parents=True, exist_ok=True)
REPORT = OUT / 'executions.json'
records = []

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def run(name, args, timeout=1200, env=None):
    entry = {'id': name, 'argv': args, 'cwd': str(ROOT), 'started_at_utc': now()}
    print('START ' + name, flush=True)
    with (OUT / (name + '.log')).open('w', encoding='utf8') as log:
        log.write(json.dumps(entry) + '\n')
        log.flush()
        try:
            result = subprocess.run(args, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                    timeout=timeout, env=env)
            entry['exit_code'] = result.returncode
        except Exception as e:
            entry['exit_code'] = None
            entry['error'] = repr(e)
            log.write('\nRECORDER EXCEPTION ' + repr(e))
    entry['finished_at_utc'] = now()
    entry['status'] = 'PASS' if entry['exit_code'] == 0 else 'FAIL'
    entry['log'] = name + '.log'
    records.append(entry)
    REPORT.write_text(json.dumps(records, indent=2), encoding='utf8')
    print(entry['status'] + ' ' + name + ' exit=' + str(entry['exit_code']), flush=True)
    return entry

if __name__ == '__main__':
    env = os.environ.copy()
    env['PLAYWRIGHT_CHANNEL'] = 'chrome'
    (OUT / 'platform.json').write_text(json.dumps({
        'utc': now(), 'platform': platform.platform(), 'python': sys.version,
        'browser_channel': 'chrome', 'CGO_ENABLED_override': env.get('CGO_ENABLED'),
        'scope': 'AI review on existing local checkout; no human participation claimed'
    }, indent=2), encoding='utf8')
    for name, args in [
        ('git-version', ['git','--version']),
        ('go-version', ['go','version']),
        ('node-version', ['node','--version']),
        ('npm-version', ['npm.cmd','--version']),
        ('docker-version', ['docker','version']),
        ('compose-version', ['docker','compose','version']),
        ('go-cgo', ['go','env','CGO_ENABLED','CC']),
        ('gcc-version', ['gcc','--version']),
        ('docker-before', ['docker','ps','--format','{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Labels}}']),
        ('go-build', ['go','build','./...']),
        ('go-vet', ['go','vet','./...']),
        ('go-tests', ['go','test','-v','-count=1','./...']),
        ('go-race', ['go','test','-race','-count=1','./...']),
        ('wallet-regressions', ['go','test','-v','-count=1','./internal/guild','./internal/postgres','-run','^TestDailyLimit']),
        ('npm-ci', ['npm.cmd','--prefix','web','ci']),
        ('full-verifier', ['node','scripts/verify.mjs']),
        ('purchase-mutations', ['node','scripts/mutation-check.mjs']),
        ('wallet-mutations', ['node','scripts/check-daily-limit-mutations.mjs']),
    ]:
        run(name, args, env=env)
    for src, dest in [('artifacts/verification','full-verifier'),('artifacts/mutations','purchase-mutations'),('artifacts/daily-limit-mutations','wallet-mutations')]:
        p = ROOT / src
        if p.exists():
            shutil.copytree(p, OUT / dest, dirs_exist_ok=True)
    original = ROOT / 'docs/transactional-correctness-baseline/evidence'
    backup = OUT / 'historical-evidence-backup'
    shutil.copytree(original, backup, dirs_exist_ok=True)
    previous = {p.relative_to(original): p.read_bytes() for p in original.rglob('*') if p.is_file()}
    try:
        run('baseline-verifier', ['node','scripts/verify-transactional-baseline.mjs'], env=env)
        shutil.copytree(original, OUT / 'baseline-verifier', dirs_exist_ok=True)
    finally:
        for rel, content in previous.items():
            (original / rel).write_bytes(content)
        # This invocation should create no extra files. Preserve anything unexpected, do not delete it.
        extra = [str(p.relative_to(original)) for p in original.rglob('*') if p.is_file() and p.relative_to(original) not in previous]
        (OUT / 'historical-evidence-restoration.json').write_text(json.dumps({
            'restored_files': len(previous), 'unexpected_new_files': extra,
            'all_original_bytes_restored': all((original/p).read_bytes()==b for p,b in previous.items())
        }, indent=2), encoding='utf8')
    run('playwright', ['npm.cmd','--prefix','web','run','test:e2e'], env=env)
    for src, dest in [('artifacts/playwright-results.json','playwright-results.json'),('web/test-results','playwright-test-results'),('web/playwright-report','playwright-report')]:
        p = ROOT / src
        if p.is_dir():
            shutil.copytree(p, OUT / dest, dirs_exist_ok=True)
        elif p.is_file():
            shutil.copy2(p, OUT / dest)
    print('Recorded checks complete: ' + str(REPORT), flush=True)
