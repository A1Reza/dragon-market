from pathlib import Path
import importlib.util,json,shutil
p=Path(__file__).with_name('run_checks.py')
spec=importlib.util.spec_from_file_location('recorder',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.REPORT=m.OUT/'baseline-retry-execution.json'
original=m.ROOT/'docs/transactional-correctness-baseline/evidence'
previous={p.relative_to(original):p.read_bytes() for p in original.rglob('*') if p.is_file()}
try:
    m.run('baseline-verifier-retry',['node','scripts/verify-transactional-baseline.mjs'])
    shutil.copytree(original,m.OUT/'baseline-verifier-retry',dirs_exist_ok=True)
finally:
    for p,b in previous.items():(original/p).write_bytes(b)
