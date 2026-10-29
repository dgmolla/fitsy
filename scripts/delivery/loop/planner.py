"""LLM task picker: read-only codex call returns {issue, lane, reason}."""
import json,os,subprocess,time,re
from pathlib import Path
from taskfiles import priority_notes
L=os.environ.get('FITSY_LOOP_DIR',os.path.expanduser('~/fitsy-refactor/loop')); REPO='dgmolla/fitsy'
PATH=os.path.expanduser('~/.local/bin')+':/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
def gh(a): return subprocess.run('gh '+a,shell=True,capture_output=True,text=True,env=dict(os.environ,PATH=PATH)).stdout
def pick(inflight,exclude):
    issues=json.loads(gh(f"issue list -R {REPO} --state open --limit 80 --json number,title,labels,body") or '[]')
    issues=[{'number':i['number'],'title':i['title'],'labels':[l['name'] for l in i['labels']],'body':(i['body'] or '')[:400]} for i in issues if i['number'] not in exclude]
    if not issues: return None
    merged=gh(f"pr list -R {REPO} --state merged --limit 15 --json number,title --jq '.[]|\"#\\(.number) \\(.title)\"'")
    prompt=f"""You pick the next task for an autonomous coding loop on repo {REPO}. Choose ONE open issue: highest value, not overlapping files/areas with in-flight tasks. Prefer product and data-pipeline issues over tooling. Skip issues labeled blocked/dispatch-hold-only-if-truly-blocked, and anything that needs human action or App Store submission. Lanes: mobile, backend, pipeline, verify, review, delivery, docs, flags (or a new short lane name). Two tasks in the same lane never run together.
In-flight (task: lane): {json.dumps(inflight)}
Human priority notes (honor this order among eligible issues):
{priority_notes(L+'/tasks')}
Recently merged PRs:
{merged}
Open issues (JSON): {json.dumps(issues)}
Reply with ONLY JSON: {{"issue": <number or null>, "lane": "<lane>", "reason": "<one short sentence>"}}"""
    out=L+'/planner-last.json'
    if os.path.exists(out): os.remove(out)
    env=dict(PATH=PATH,HOME=os.environ['HOME'],CODEX_HOME=L+'/planner-home',ZDOTDIR=L+'/planner-zdot',SHELL='/bin/zsh',USER=os.environ.get('USER',''),LANG='en_US.UTF-8',TMPDIR=os.environ.get('TMPDIR','/tmp'))
    try:
        subprocess.run(['codex','exec','-m','gpt-6.1-sol','--sandbox','read-only','--skip-git-repo-check','-C',L,'-o',out,'-'],input=prompt,text=True,capture_output=True,env=env,timeout=600)
        txt=Path(out).read_text(); j=json.loads(re.search(r'\{.*\}',txt,re.S).group(0))
        ok={i['number']:i for i in issues}
        if j.get('issue') is None: return None
        n=int(j['issue']); assert n in ok and isinstance(j.get('lane'),str) and j['lane'] and j['lane'] not in [v for k,v in inflight.items() if k!='_need']
        return n,re.sub(r'[^a-z0-9-]','',j['lane'].lower())[:20] or 'misc',str(j.get('reason',''))[:200],ok[n]
    except Exception as e:
        with open(L+'/driver.log','a') as log: log.write(time.strftime('%H:%M:%S')+f' planner failed: {str(e)[:300]}\n')
        return 'fail'
def make_task(n,lane,reason,issue):
    body=gh(f"issue view {n} -R {REPO} --json body --jq .body")[:6000]
    f=f"{L}/tasks/5{n:04d}-issue-{n}.md"
    title=' '.join(issue['title'].splitlines())
    reason=' '.join(reason.splitlines())
    Path(f).write_text(f"---\nbranch: codex/issue-{n}\ntitle: {title} (#{n})\nbody: Closes #{n}\nlane: {lane}\nreason: {reason}\n---\nImplement GitHub issue #{n} in {REPO} end to end (code + tests, follow existing patterns; for mobile journey changes update Maestro flows in apps/mobile/e2e). Do not perform App Store submission or anything needing human sign-off. Issue #{n}: {title}\n{body}\n")
    return f
