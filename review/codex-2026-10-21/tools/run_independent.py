from pathlib import Path
import datetime,json,shutil,subprocess,sys
root=Path(__file__).resolve().parents[3]
out=root/'review/codex-2026-10-21/evidence'
scratch=root/'artifacts/codex-review-independent-source'
scratch.mkdir(parents=True,exist_ok=True)
for name in ['go.mod','go.sum','internal','migrations','dev']:
    src=root/name
    if src.is_dir():shutil.copytree(src,scratch/name,dirs_exist_ok=True)
    else:shutil.copy2(src,scratch/name)
shutil.copy2(Path(__file__).with_name('independent_postgres_test.go.txt'),scratch/'internal/postgres/reviewer_independent_test.go')
suffix='-oracle' if '--oracle' in sys.argv else ''
args=['go','test','-v','-count=1','./internal/postgres','-run','^TestReviewerOracle' if suffix else '^TestReviewer']
record={'started_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'argv':args,'cwd':str(scratch),'source_sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'deviation':'Exact source copied; only reviewer_independent_test.go added; original application unchanged; real fresh Testcontainers.'}
with (out/('independent-tests'+suffix+'.log')).open('w',encoding='utf8') as f:
    f.write(json.dumps(record)+'\n');f.flush()
    result=subprocess.run(args,cwd=scratch,stdout=f,stderr=subprocess.STDOUT,timeout=180)
record.update(exit_code=result.returncode,finished_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
(out/('independent-tests'+suffix+'.json')).write_text(json.dumps(record,indent=2),encoding='utf8')
print(json.dumps(record,indent=2))
