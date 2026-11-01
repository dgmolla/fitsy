#!/usr/bin/env python3
"""Loop: for each task file, codex implements on fresh branch, PR, wait CI + AI review, fix rounds, merge (no admin)."""
import json, os, subprocess, time, re, threading, shlex, tempfile
from contextlib import nullcontext
from pathlib import Path
import context
import worktrees
from install import merged_source, install_merged
from lifecycle import Lifecycle, IDLE_SECONDS, ACTIVE_SECONDS
from open_prs import OpenPRSweep
from taskfiles import read_task, task_files, migrate_notes, issue_number
from recovery import (MAX_ROUNDS, MAX_SIM_REPAIRS, MAX_RERUNS, RETRIAGE_SECONDS,
                      classify_failure, gating_failures, repair_prompt, record_attempt,
                      park, requeue, parking_body, redact)
LOCK=threading.RLock(); MERGE_LOCK=threading.Lock()
def group(lane): return 'data' if re.match(r'(pipeline|data)',lane or '') else 'app'
ROOT=os.path.expanduser(os.environ.get('FITSY_LOOP_ROOT', '~/fitsy-refactor'))
L=os.environ.get('FITSY_LOOP_DIR', ROOT+'/loop'); REPO='dgmolla/fitsy'
ENV=dict(os.environ, PATH=os.path.expanduser('~/.local/bin')+':/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin')
def log(*a):
    with open(L+'/driver.log','a') as f: print(time.strftime('%H:%M:%S'),*a,file=f,flush=True)
def sh(cmd,cwd=None,check=True,inp=None,timeout=None):
    # Candidate commit/merge hooks are as untrusted as its pre-push verifier.
    boundary=context.host.git_environment(cwd,ENV) if cwd and cmd.startswith('git ') else nullcontext(ENV)
    with boundary as selected:
        r=subprocess.run(cmd,shell=True,cwd=cwd,env=selected,capture_output=True,text=True,input=inp,timeout=timeout)
    if check and r.returncode: raise RuntimeError(f'{cmd[:120]} -> {r.returncode}: {(r.stderr or r.stdout)[-1500:]}')
    return r.stdout.strip()
def codex(wt,prompt,tag,images=()):
    p=f'{L}/{tag}.prompt'; Path(p).write_text(prompt)
    args=['codex','exec','-m','gpt-6.1-sol','-s','workspace-write','-C',wt]
    for path in images: args.extend(['--image',path])
    # Issue-derived prompts get core/provider auth only; privileged controls are separate.
    worker_env={key:value for key,value in ENV.items()
                if key in {'PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR','CODEX_HOME','OPENAI_API_KEY'}}
    with open(p) as source, open(f'{L}/{tag}.log','w') as output:
        subprocess.run(args+['-'],env=worker_env,stdin=source,stdout=output,stderr=subprocess.STDOUT,timeout=5400)
    out=Path(f'{L}/{tag}.log').read_text(); return out[-3000:]
def state():
    try: value=json.loads(Path(L+'/state.json').read_text())
    except FileNotFoundError: return {}
    if not isinstance(value,dict): raise ValueError('Loop state must be an object')
    return value
def save(s):
    with LOCK:
        t=L+'/state.json.tmp'
        with open(t,'w') as f: json.dump(s,f,indent=1); f.flush(); os.fsync(f.fileno())
        os.replace(t,L+'/state.json')
def request_install(s):
    with LOCK:
        s['_loop_install']=time.time(); save(s)
def checks(pr):
    j=json.loads(sh(f'gh pr view {pr} -R {REPO} --json statusCheckRollup,headRefOid,mergeable,state,mergeStateStatus'))
    res={}
    for c in j['statusCheckRollup']:
        n=c.get('name') or c.get('context'); v=c.get('conclusion') or c.get('state') or ''
        if c.get('status') and c['status']!='COMPLETED': v='PENDING'
        res[n]=v.upper()
    return j,res
def wait(pr,head=None):
    t0=time.time(); time.sleep(120)
    while time.time()-t0<3*3600:
        j,res=checks(pr)
        if head and j['headRefOid']!=head:
            if time.time()-t0>900: head=None
            time.sleep(30); continue
        if j.get('mergeStateStatus')=='DIRTY': return j,res,['DIRTY']
        if j.get('mergeStateStatus')=='BEHIND':
            subprocess.run(f'gh pr update-branch {pr} -R {REPO}',shell=True,env=ENV,capture_output=True); log('PR',pr,'behind main -> updated branch'); head=None; time.sleep(90); continue
        v=res.get('Verify',''); a=res.get('AI review','')
        bad=[k for k,x in res.items() if x in('FAILURE','ERROR','CANCELLED','TIMED_OUT')]
        if v in('SUCCESS',) and a in('SUCCESS','FAILURE','ERROR'): return j,res,bad
        if v in('FAILURE','CANCELLED','TIMED_OUT') and a not in('PENDING',''): return j,res,bad
        time.sleep(60)
    return j,res,['timeout']
def sim_gate(pr,sha):
    "('ok'|'wait'|'fail', why). Merge waits for local Simulator status when CI's Sim scope is not none."
    st=json.loads(sh(f"gh api 'repos/{REPO}/commits/{sha}/statuses?per_page=100'",check=False) or '[]')
    latest={}
    for x in st: latest.setdefault(x['context'],x)
    sc=latest.get('Sim scope')
    if not sc or sc.get('state')!='success': return 'wait','Waiting for trusted Sim scope status'
    scope=(re.search(r'scope=(\w+)',sc.get('description') or '') or [None,'unclassified'])[1]
    if scope not in ('none','smoke','flow','full'): return 'wait','Waiting for valid Sim scope classification'
    if scope=='none': return 'ok','sim scope none'
    sim=latest.get('Simulator')
    if not sim or sim['state']=='pending': return 'wait',f'sim scope {scope}; waiting for local Simulator status'
    if sim['state']=='success': return 'ok','Simulator passed'
    if sim['state']=='error': return 'env','Simulator error: '+(sim.get('description') or '')
    return 'fail','Simulator failed: '+(sim.get('description') or '')


def evidence(wt, sha, res, why=''):
    return context.collect(wt, ROOT+'/sim-review/evidence', sha, res, why, ENV)


def current_repair_evidence(wt, ev, st):
    """Reuse source-bound artifacts, preserving today's measured environment."""
    fresh=st.get('repair_evidence',{})
    if (fresh.get('source') and fresh.get('head')==ev.get('head') and
            fresh['source']==context.source_hash(wt,ENV)):
        for key in ('sim_state','status','source','flow','step','images','videos','logs','assertion_failure','rerun_passed'):
            if key in fresh: ev[key]=fresh[key]
        if fresh.get('merge_base') and fresh['merge_base']==ev.get('merge_base'):
            for key in ('main_passed','main_same_failure','main_comparison'):
                if key in fresh: ev[key]=fresh[key]
    return ev


def notify_park(name, st, ev, meta):
    """The existing worker sends one diagnosis per destination and parking episode."""
    notice=st.get('park_notice')
    if not notice or time.time()<notice.get('retry_at',0): return
    destinations={n for n in (st.get('pr'), issue_number(name,meta)) if n}
    body=parking_body(name,st,ev)
    marker=body.split('<!--')[-1].split('-->')[0].strip()
    for number in sorted(destinations):
        if number in notice['sent']: continue
        try:
            old=context.run(['gh','api',f'repos/{REPO}/issues/{number}/comments','--paginate'],ROOT,ENV)
            if marker not in old:
                with tempfile.NamedTemporaryFile(mode='w',suffix='.md') as text:
                    text.write(body); text.flush()
                    context.run(['gh','issue','comment',str(number),'--repo',REPO,'--body-file',text.name],ROOT,ENV)
            notice['sent'].append(number)
        except (RuntimeError,OSError,subprocess.TimeoutExpired) as error:
            log(name,'parking notification pending:',redact(str(error))[:500])
            notice['retry_at']=time.time()+RETRIAGE_SECONDS


def block(name, st, s, reason, ev, meta, condition=None):
    if not condition:
        condition='env:api-config' if ev.get('api_status',0)>=500 else ('environment' if classify_failure(ev)=='env' else 'source')
    park(st,reason,ev,condition,ev.get('main'))
    st['blocked_evidence']=ev
    save(s)
    notify_park(name,st,ev,meta)
    save(s)
    log(name,'BLOCKED',st['triage'],reason)
    return 'blocked'


def repair_sim(name, wt, st, s, ev, meta, prompt):
    """Triage is a branch in the actual consumer, before any code-fix invocation."""
    triage=classify_failure(ev)
    record_attempt(st,'triage',triage=triage,head=ev.get('head'),step=ev.get('step'))
    log(name,'TRIAGE',triage,ev.get('step',''))
    save(s)
    if triage in ('env','unknown'):
        # The host owns environment reproduction. Never ask sandboxed Codex to fix setup.
        retries=st.get('env_retries',0)
        if retries<MAX_RERUNS:
            st['env_retries']=retries+1
            replay=context.host_replay(wt,L+'/sim.lock',ev,ENV)
            record_attempt(st,'environment-replay',outcome=replay['status'],logs=replay.get('logs',''))
            save(s)
            if replay['status']=='pass':
                ev={**ev,'rerun_passed':True,'sim_state':'failure','logs':replay.get('logs','')}
                triage=classify_failure(ev)
            elif replay['status']=='failure' and replay.get('head')==ev.get('head'):
                ev={**ev,**replay,'sim_state':'failure','rerun_passed':False,
                    'main_passed':False,'main_same_failure':False}
                ev.update(context.compare_main(wt,L+'/sim.lock',ev,ENV))
                triage=classify_failure(ev)
            elif triage=='unknown':
                comparison=context.compare_main(wt,L+'/sim.lock',ev,ENV)
                ev.update(comparison)
                triage=classify_failure(ev)
            else:
                return block(name,st,s,'Environment recovery requires host configuration: '+replay.get('logs','')[-1000:],ev,meta)
        if triage=='unknown':
            return block(name,st,s,'Merge-base comparison requires host preparation; no code repair authorized.',ev,meta,'baseline')
        if triage=='env':
            return block(name,st,s,'Environment/diagnostic recovery exhausted; no code repair authorized.',ev,meta)
    if triage=='flaky':
        reruns=st.get('reruns',0)
        if reruns<MAX_RERUNS:
            st['reruns']=reruns+1
            replay=context.host_replay(wt,L+'/sim.lock',ev,ENV)
            record_attempt(st,'flake-confirmation',outcome=replay['status'])
            file_flake(name,st,ev)
            save(s)
            if replay['status']=='pass': return 'retry'
        return block(name,st,s,'Intermittent flow needs host investigation; assertions preserved.',ev,meta,'check:Simulator')
    sr=st.get('simrepair',0)
    if sr>=MAX_SIM_REPAIRS:
        return block(name,st,s,f'{sr} distinct simulator repair strategies exhausted.',ev,meta)
    if sr>=1:
        replay=context.host_replay(wt,L+'/sim.lock',ev,ENV)
        record_attempt(st,'before-repair-reproduction',outcome=replay['status'])
        if replay['status']=='pass':
            return repair_sim(name,wt,st,s,{**ev,'rerun_passed':True},meta,prompt)
        if replay['status']=='error':
            return block(name,st,s,'Host reproduction unavailable: '+replay.get('logs',''),{**ev,'sim_state':'error'},meta)
    if sr>=2:
        ev.update(context.compare_main(wt,L+'/sim.lock',ev,ENV))
        if not ev.get('main_passed') and not ev.get('main_same_failure'):
            return block(name,st,s,'Merge-base comparison needs environment investigation.',ev,meta,'baseline')
    try:
        context.video_frame(ev,wt)
        strategy,repair=repair_prompt(ev,st.get('attempts',[]),sr,prompt)
    except (ValueError,OSError,RuntimeError) as error:
        return block(name,st,s,str(error),ev,meta,'evidence')
    st['simrepair']=sr+1
    st['needs_local_validation']=True
    record_attempt(st,'code-repair',strategy=strategy,head=ev.get('head'))
    save(s)
    codex(wt,repair+COMMON,f'{name}-simfix{sr}-{strategy}',images=ev['images'])
    reason=context.blocker_reason(wt)
    if reason is not None:
        return block(name,st,s,reason,{**ev,'sim_state':'error'},meta)
    # Only the host runner can validate the repaired journey before commit/push.
    replay=context.host_replay(wt,L+'/sim.lock',ev,ENV)
    record_attempt(st,'local-validation',strategy=strategy,outcome=replay['status'])
    save(s)
    if replay['status']!='pass':
        if replay['status']=='failure':
            st['repair_evidence']={**ev,**replay,'sim_state':'failure'}
            save(s)
            return 'retry'
        return block(name,st,s,'Local Maestro validation did not pass: '+replay.get('logs',''),{**ev,'sim_state':'error'},meta)
    st.pop('needs_local_validation',None)
    st.pop('repair_evidence',None)
    st['local_validation_source']=replay['source']
    st['local_validation_required']=True
    save(s)
    return 'fixed'


def file_flake(name,st,ev):
    if st.get('flake_issue'): return
    marker=f'<!-- fitsy-loop-flake:{name} -->'
    try:
        old=json.loads(context.run(['gh','issue','list','--repo',REPO,'--state','all','--search',
                                    f'"{marker}" in:body','--json','number,body'],ROOT,ENV))
        prior=next((row['number'] for row in old if marker in row.get('body','')),None)
        if prior: st['flake_issue']=prior; return
        with tempfile.NamedTemporaryFile(mode='w',suffix='.md') as text:
            text.write(redact(f'**TL;DR:** The same source passed a rerun after a local flow failure.\n\nFlow: {ev.get("flow")}; step: {ev.get("step")}.\nEvidence: {ev.get("links",[])}\nPreserve all assertions and investigate nondeterminism.\n{marker}\n')); text.flush()
            st['flake_issue']=context.run(['gh','issue','create','--repo',REPO,'--title',f'Flaky simulator flow: {ev.get("flow",name)}','--body-file',text.name],ROOT,ENV)
    except (RuntimeError,OSError,ValueError,subprocess.TimeoutExpired) as error:
        log(name,'flake issue pending:',redact(str(error))[:500])


def prepare_task(wt,meta,merge_main=True):
    """Retry the same bounded source prerequisite before implementation or requeue."""
    with LOCK, worktrees.lease(L,meta['branch']):
        def merge(path, ref):
            result=context.host.git(path,['merge','-q','--no-edit',ref],ENV)
            if result.returncode:
                raise RuntimeError(f'Merge {ref} stopped: {(result.stderr or result.stdout)[-1500:]}')
        worktrees.prepare(ROOT+'/wt3',L,wt,meta,ENV,log,merge,merge_main)


def refresh_pr_head(wt, branch, head):
    """Advance only a clean, owned checkout, preserving unpublished work on mismatch."""
    if not re.fullmatch(r'[a-f0-9]{40}', head):
        raise ValueError('PR head is not a full commit identity')
    if context.run(['git','status','--porcelain'],wt,ENV):
        raise ValueError('Parked checkout has unfinished edits; preserve them before current-head replay')
    if context.run(['git','rev-parse','HEAD'],wt,ENV)==head:
        return
    context.run(['git','fetch','-q','origin',f'refs/heads/{branch}:refs/remotes/origin/{branch}'],wt,ENV)
    remote=context.run(['git','rev-parse',f'refs/remotes/origin/{branch}'],wt,ENV)
    if remote!=head:
        raise ValueError('PR advanced during checkout refresh; retry with the newly observed head')
    # Never reset, stash, discard or merge unpublished divergent work to obtain evidence.
    context.run(['git','-c','core.hooksPath=/dev/null','merge','-q','--ff-only',head],wt,ENV)
    if context.run(['git','rev-parse','HEAD'],wt,ENV)!=head:
        raise ValueError('Owned checkout contains unpublished commits; current-head replay remains pending')


def retriage(files,s):
    if any(s.get(Path(f).stem,{}).get('blocked') and time.time()-s.get(Path(f).stem,{}).get('triaged_at',0)>=RETRIAGE_SECONDS for f in files):
        sh('git fetch -q origin main',cwd=ROOT+'/wt3',check=False)
    main=sh('git rev-parse origin/main',cwd=ROOT+'/wt3',check=False)
    for f in files:
        name=Path(f).stem; st=s.get(name,{})
        if not st.get('blocked') or st.get('done'): continue
        meta,_=read_task(f)
        ev=st.get('blocked_evidence',{})
        if not st.get('park_notice'):
            block(name,st,s,st['blocked'],ev,meta,st.get('blocked_on','environment'))
        notify_park(name,st,ev,meta)
        if main==st.get('triaged_main',st.get('parked_main')) and time.time()-st.get('triaged_at',0)<RETRIAGE_SECONDS: continue
        dependency=None; passed=False
        condition=st.get('blocked_on','')
        wt=ROOT+'/loop/wt-'+name
        if re.fullmatch(r'PR#\d+',condition):
            dependency=sh(f'gh pr view {condition[3:]} -R {REPO} --json state -q .state',check=False)
        elif condition=='env:preparation' or (condition=='environment' and not Path(wt).is_dir()):
            # Older preparation failures were parked as generic environment errors.
            st['blocked_on']='env:preparation'
            ev={**ev,'sim_state':'error','preparation_ready':False}
            try:
                prepare_task(wt,meta)
                ev.update(preparation_ready=True,logs='Task fetch and checkout preparation succeeded.')
            except (RuntimeError,OSError,subprocess.TimeoutExpired) as error:
                ev['logs']=redact(str(error))
            record_attempt(st,'preparation-retriage',outcome='ready' if ev['preparation_ready'] else 'error',logs=ev['logs'])
        else:
            try:
                if st.get('checkout_removed') and not Path(wt).is_dir():
                    # Replay the published PR head before merging main for new work.
                    prepare_task(wt,meta,merge_main=False)
                    st.pop('checkout_removed',None)
                if st.get('pr'):
                    j,res=checks(st['pr'])
                    refresh_pr_head(wt,meta['branch'],j['headRefOid'])
                else:
                    head=sh('git rev-parse HEAD',cwd=wt,check=False)
                    j,res={'headRefOid':head},{}
                if Path(wt).is_dir():
                    ev=current_repair_evidence(wt,evidence(wt,j['headRefOid'],res),st)
                    if condition=='environment' or condition.startswith('env:'):
                        # A stale GitHub error cannot observe a repaired host dependency.
                        replay=context.host_replay(wt,L+'/sim.lock',{**ev,'require_native':True},ENV)
                        record_attempt(st,'environment-retriage',outcome=replay['status'],
                                       head=replay.get('head'),source=replay.get('source'),logs=replay.get('logs',''))
                        if replay['status'] in ('pass','failure') and replay.get('head')!=j['headRefOid']:
                            raise ValueError('Host replay does not match the current PR head')
                        ev['rerun_passed']=replay['status']=='pass' and replay.get('head')==j['headRefOid']
                        if replay['status']=='failure':
                            ev={**ev,**replay,'sim_state':'failure','main_passed':False,'main_same_failure':False}
                            ev.update(context.compare_main(wt,L+'/sim.lock',ev,ENV))
                            st['repair_evidence']=ev
                if condition=='baseline':
                    ev.update(context.compare_main(wt,L+'/sim.lock',ev,ENV))
                    if ev.get('source'): st['repair_evidence']=ev
                passed=res.get(condition.removeprefix('check:'))=='SUCCESS'
            except (RuntimeError,ValueError,OSError,subprocess.TimeoutExpired) as error:
                record_attempt(st,'retriage-prerequisite',outcome='error',logs=redact(str(error)))
                st['triaged_at']=time.time()
                st['triaged_main']=main
                log(name,'current-head re-triage pending:',redact(str(error))[:500])
                continue
        if requeue(st,ev,main,dependency,passed): log(name,'REQUEUED',condition)
        st['blocked_evidence']=ev
        st['triage']=classify_failure(ev)
    save(s)
def review_text(pr):
    return sh(f"gh api repos/{REPO}/issues/{pr}/comments --jq '[.[]|select(.body|contains(\"fitsy-simple-review\"))][-1].body'",check=False)[-6000:]
def failed_log(pr,sha):
    ids=sh(f"gh run list -R {REPO} --commit {sha} --json databaseId,conclusion --jq '.[]|select(.conclusion==\"failure\")|.databaseId'",check=False).split()
    return '\n'.join(sh(f'gh run view {i} -R {REPO} --log-failed',check=False)[-5000:] for i in ids[:2])


def execute_task(f,s):
    """Keep branch ownership through all terminal outcomes, including exceptions."""
    task=read_task(f)
    name=Path(f).stem
    if not task or s.get(name,{}).get('done') or s.get(name,{}).get('blocked'):
        return run_task(f,s)
    meta,_=task
    with worktrees.lease(L,meta['branch']):
        try:
            return run_task(f,s)
        except Exception as error:
            record_attempt(s.setdefault(name,{}),'execution-error',reason=redact(str(error)))
            save(s)
            raise
        finally:
            with LOCK:
                try:
                    removed=worktrees.cleanup(ROOT+'/wt3',L,meta['branch'],ENV,log)
                    if f'{ROOT}/loop/wt-{name}' in removed:
                        s.setdefault(name,{})['checkout_removed']=True
                        save(s)
                except (RuntimeError,OSError,subprocess.TimeoutExpired) as error:
                    log(name,'STOPPED worktree cleanup:',redact(str(error)))
                    s.setdefault(name,{})['cleanup_error']=redact(str(error))
                    save(s)
                    raise


def run_task(f,s):
    task=read_task(f)
    if not task: log('SKIP non-task',os.path.basename(f)); return 'skipped'
    name=os.path.basename(f)[:-3]; meta,prompt=task
    st=s.setdefault(name,{})
    if st.get('done') or st.get('blocked'): return
    # A supported unpark clears only active counters; raw outcome history survives.
    if st.get('parked_at') and not st.get('blocked') and st.get('park_notice'):
        for key in ('simrepair','fix_rounds','reruns','env_retries'): st.pop(key,None)
        st.pop('park_notice',None)
    if 'attempts' not in st and any(st.get(key) for key in ('simrepair','fix_rounds')):
        record_attempt(st,'legacy-counters',simrepair=st.get('simrepair',0),fix_rounds=st.get('fix_rounds',0))
        st.pop('simrepair',None); st.pop('fix_rounds',None)
    br=meta['branch']; wt=f'{ROOT}/loop/wt-{name}'
    try: prepare_task(wt,meta)
    except (RuntimeError,OSError,subprocess.TimeoutExpired) as error:
        return block(name,st,s,'Task preparation failed: '+str(error),
                     {'sim_state':'error','preparation_ready':False,'logs':redact(str(error))},meta,'env:preparation')
    while True:
        orphan=subprocess.run(['pgrep','-f',f'codex exec .*-C {re.escape(wt)} '],capture_output=True,env=ENV)
        if orphan.returncode==1: break
        if orphan.returncode!=0: raise RuntimeError('Cannot establish whether an orphan worker owns this checkout')
        time.sleep(30)
    pr=st.get('pr') or (int(meta['pr']) if meta.get('pr') else None)
    if pr and st.get('pr')!=pr:
        st['pr']=pr; save(s)
    if not st.get('implemented') and os.path.exists(f'{L}/{name}-impl.log') and sh('git status --porcelain',cwd=wt):
        st['implemented']=1; st['summary']=Path(f'{L}/{name}-impl.log').read_text()[-1500:]; save(s); log(name,'adopted finished implementation')
    if not st.get('implemented'):
        log(name,'codex implement'); out=codex(wt,prompt+COMMON,name+'-impl')
        st['summary']=out[-1500:]; st['implemented']=1; save(s)
    m=re.search(r'SUPERSEDED: (.*)',st.get('summary',''))
    if m and pr:
        sh(f'gh pr close {pr} -R {REPO} --comment '+shlex.quote('**TL;DR:** Closing as superseded by main: '+m.group(1)[:400]))
        st['done']=1; st['closed']=m.group(1)[:300]; save(s); log(name,'CLOSED superseded',pr); return
    def commit_push(msg):
        sh('git add -A',cwd=wt)
        if sh('git status --porcelain',cwd=wt): sh(f'git commit -q -m {shlex.quote(msg)}',cwd=wt)
        sh('git fetch -q origin',cwd=wt,check=False)
        sh(f'git rev-parse -q --verify origin/{br} && git merge -q --no-edit origin/{br}',cwd=wt,check=False)
        if subprocess.run('git merge-base --is-ancestor origin/main HEAD',shell=True,cwd=wt).returncode and context.host.git(wt,['merge','-q','--no-edit','origin/main'],ENV).returncode:
            log(name,'pre-push merge of main conflicts; codex resolving')
            codex(wt,f"This branch has merge conflicts with origin/main (a merge is in progress). Resolve every conflict keeping both this branch's intent and main's changes (main may have deleted legacy files: keep them deleted unless this task needs them). Remove all conflict markers, run the affected tests. Original task:\n{prompt}"+COMMON,f'{name}-conflict')
            sh('git add -A && (git -c core.editor=true merge --continue || git commit -q --no-edit)',cwd=wt,check=False)
        # A resumed PR must reach its repair feedback even when its published
        # source currently fails Maestro. There is no publication to validate.
        remote=sh(f'git rev-parse --verify refs/remotes/origin/{br}',cwd=wt,check=False)
        if remote==sh('git rev-parse HEAD',cwd=wt): return
        for tryn in range(4):
            # Every entrypoint, including general, conflict and hook repairs, uses
            # trusted current-source selection. Attempt counters cannot bypass it.
            if context.source_hash(wt,ENV)!=st.get('local_validation_source'):
                validation={**st.get('repair_evidence',{}), 'require_native': bool(st.get('needs_local_validation') or
                            st.get('local_validation_required', bool(st.get('local_validation_source'))))}
                replay=context.host_replay(wt,L+'/sim.lock',validation,ENV)
                record_attempt(st,'pre-push-validation',outcome=replay['status'])
                save(s)
                if replay['status']!='pass':
                    st['needs_local_validation']=True
                    raise RuntimeError('Current-source local Maestro pass required before push: '+replay.get('logs',''))
                st['local_validation_source']=replay['source']
                st['local_validation_required']=replay.get('required',True)
                st.pop('needs_local_validation',None)
                save(s)
            r=context.host.publish(wt,br,ENV)
            if not r.returncode: return
            err=(r.stdout+r.stderr)[-4000:]
            if classify_failure({'logs':err})=='env':
                raise RuntimeError('Isolated pre-push environment recovery required: '+err)
            if tryn==3: break
            log(name,f'pre-push hook failed (repair {tryn+1}/3); codex fixing')
            codex(wt,"git push was rejected by the repo pre-push hook. Fix the reported failures in code (never bypass or edit the hook, never --no-verify, never push another way). Hook output tail:\n"+err+"\nOriginal task:\n"+prompt+COMMON,f'{name}-hookfix{tryn}')
            sh('git add -A',cwd=wt)
            if sh('git status --porcelain',cwd=wt): sh('git commit -q -m "Fix pre-push checks"',cwd=wt)
        tail=[l for l in err.strip().splitlines() if l.strip()][-3:]
        raise RuntimeError('pre-push hook still failing after 3 codex repairs: '+' | '.join(tail)[:600])
    if st.get('needs_local_validation'):
        replay=context.host_replay(wt,L+'/sim.lock',
                                   {**st.get('repair_evidence',st.get('blocked_evidence',{})), 'require_native':True},ENV)
        if replay['status']!='pass':
            return block(name,st,s,'Pending local validation still requires host recovery.',
                         {**st.get('blocked_evidence',{}),'sim_state':'error'},meta)
        st.pop('needs_local_validation',None)
        st['local_validation_source']=replay['source']
        st['local_validation_required']=True
        save(s)
    commit_push(meta['title'])
    if not pr:
        body=f"**TL;DR:** {meta['title']}\n\n{meta.get('body','')}\n\nCodex summary:\n```\n{st['summary'][-1200:]}\n```"
        url=sh(f"gh pr create -R {REPO} --base main --head {br} --title {shlex.quote(meta['title'])} --body-file -",inp=body,cwd=wt)
        pr=int(url.rstrip('/').split('/')[-1]); st['pr']=pr; st['opened_by_loop']=True; save(s); log(name,'PR',url)
    def refresh():
        sh(f'git fetch -q origin && git merge -q --ff-only origin/{br}',cwd=wt,check=False)
        if context.host.git(wt,['merge','-q','--no-edit','origin/main'],ENV).returncode:
            log(name,'conflicts with main; codex resolving')
            codex(wt,f"This branch has merge conflicts with origin/main (a merge is in progress). Resolve every conflict keeping both this branch's intent and main's changes (main may have deleted legacy files: keep them deleted unless this task needs them). Remove all conflict markers, run the affected tests. Original task:\n{prompt}"+COMMON,f'{name}-conflict')
            sh('git add -A && (git -c core.editor=true merge --continue || git commit -q --no-edit)',cwd=wt,check=False)
        commit_push(f"{meta['title']} (merge main)")
    for rnd in range(MAX_ROUNDS):
        j,res,bad=wait(pr,sh('git rev-parse HEAD',cwd=wt)); log(name,'checks',res,j.get('mergeStateStatus'),bad)
        sh(f'git fetch -q origin && git merge -q --ff-only origin/{br}',cwd=wt,check=False)
        if subprocess.run(f"gh pr view {pr} -R {REPO} --json state -q .state",shell=True,env=ENV,capture_output=True,text=True).stdout.strip()=='MERGED':
            st['done']=1; request_install(s); log(name,'already MERGED',pr); return
        if res.get('Simulator')=='ERROR':
            ev=current_repair_evidence(wt,evidence(wt,j['headRefOid'],res),st)
            result=repair_sim(name,wt,st,s,ev,meta,prompt)
            if result=='blocked': return result
            if result=='fixed': commit_push(f"{meta['title']} (fix sim gate {st['simrepair']})")
            continue
        if res.get('Verify')=='SUCCESS' and res.get('AI review')=='SUCCESS' and not gating_failures(res,'unknown'):
            g,why=sim_gate(pr,j['headRefOid']); n0=0
            while g=='wait' and n0<120:
                if n0%10==0: log(name,why)
                time.sleep(60); n0+=1
                if checks(pr)[0]['headRefOid']!=j['headRefOid']: break
                g,why=sim_gate(pr,j['headRefOid'])
            if g=='wait' and n0<120: continue
            if g!='ok':
                ev=evidence(wt,j['headRefOid'],res,why)
                if st.get('needs_local_validation') and st.get('repair_evidence',{}).get('head')==j['headRefOid']:
                    ev={**ev,**st['repair_evidence']}
                # The wait may have observed a newer Simulator state than the rollup.
                if g=='fail': ev['sim_state']='failure'
                if g=='env': ev['sim_state']='error'
                result=repair_sim(name,wt,st,s,ev,meta,prompt)
                if result=='blocked': return result
                if result=='fixed': commit_push(f"{meta['title']} (fix sim gate {st['simrepair']})")
                continue
            with MERGE_LOCK: r=subprocess.run(f'gh pr merge {pr} -R {REPO} --squash --delete-branch',shell=True,env=ENV,capture_output=True,text=True)
            if r.returncode:
                log(name,'merge refused, refreshing from main and retrying:',r.stderr[-300:].replace('\n',' '))
                refresh(); continue
            st['done']=1; request_install(s); log(name,'MERGED',pr)
            subprocess.Popen(f'python3 {L}/evidence.py {pr} >> {L}/evidence.log 2>&1',shell=True,env=ENV)
            return
        if 'DIRTY' in bad: refresh(); continue
        fb=''
        if res.get('AI review')!='SUCCESS': fb+='AI review (fix every CONFIRMED P0/P1; address cheap P2s):\n'+review_text(pr)+'\n'
        ev=evidence(wt,j['headRefOid'],res)
        triage=classify_failure(ev)
        relevant=gating_failures(res,triage)
        if relevant: fb+='Failed CI checks '+str(relevant)+':\n'+failed_log(pr,j['headRefOid'])+'\n'
        if not fb: continue
        if triage=='env': return block(name,st,s,'Environment failure precedes code feedback.',ev,meta)
        sh(f'git fetch -q origin && git merge -q --ff-only origin/{br}; git merge -q --no-edit origin/main',cwd=wt,check=False)
        st['fix_rounds']=st.get('fix_rounds',0)+1
        if ev.get('sim_state')=='failure':
            st['repair_evidence']=ev
            st['needs_local_validation']=True
        record_attempt(st,'general-repair',round=st['fix_rounds'],checks=relevant)
        save(s)
        log(name,'fix round',st['fix_rounds']); codex(wt,f"Continue task on this branch. Original task:\n{prompt}\n\nFeedback to fix now:\n{fb}\nLocal evidence:\n{redact(json.dumps(ev))}\nPrior attempts:\n{redact(json.dumps(st.get('attempts',[])))}\nIf a finding is wrong, add a brief code comment/explanation rather than over-engineering. If a CI failure is pre-existing on main and unrelated, say so in your summary and don't hack around it."+COMMON,f'{name}-fix{rnd}',images=ev.get('images',[]))
        commit_push(f"{meta['title']} (address review/CI round {rnd+1})")
    ev=evidence(wt,j['headRefOid'],res)
    return block(name,st,s,f'{MAX_ROUNDS} check rounds without all required gates green.',ev,meta)
COMMON="""
Loop recovery: use scripts/delivery/loop/SKILL.md and the existing host owner for simulator/DB/environment recovery. Never widen candidate sandbox permissions.
Two workers run in parallel lanes. Data lane (pipeline) owns scripts/pipeline*, scripts/pipeline-v2/, scripts/preload*, scripts/hex-*, docs/engineering/pipeline, and pipeline services/tests. App lane owns apps/mobile, apps/api/app, apps/api/lib, apps/api/components, packages/shared, scripts/sim. Stay inside your lane's paths; keep edits to shared files (package.json, package-lock.json, prisma/, AGENTS.md, .github/, scripts/verify, scripts/deploy) small and additive so the other lane merges cleanly. Only one simulator user at a time: wrap any iOS simulator/Maestro command you run as `lockf -t 3600 ~/fitsy-refactor/loop/sim.lock <command>`.
Never change the dev.fitsy.org domain or its git branch on Vercel (it stays pinned to `dev`, the mirror of main). If the simulator needs this branch's API code, point the sim run at this PR's own Vercel preview deployment URL instead.
Read the GitHub issue's comments (gh issue view N --comments) for the latest product/design decisions before implementing. When you make or change a product/design decision, or have feedback/open questions on the design, post a short comment on the issue via gh issue comment (what and why).

Rules: repo dgmolla/fitsy. Use `git grep` to find every caller/reference (workflows, hooks, registry.yml, run.mjs, package.json, docs, AGENTS.md, skills) and update them together with tests. Never touch: rollback.sh, routine-release.py admission, branch protection, scripts/review/simple-review.mjs, scripts/route-reviewers.sh, REVIEW.md severity rules, verify.yml's final Verify job semantics. Do not weaken production DB target checks, migration safety, OTA native compatibility. If you touch auth, payments, subscriptions or entitlements, state in the PR summary the impact on TestFlight, App Review and RevenueCat sandbox, and add a test covering a sandbox entitlement in production mode. New required env vars must be added to the deploy preflight (scripts/deploy/rate-limit-preflight.ts pattern, PR 587). Run the relevant remaining tests and make them pass. Don't commit or push. End with a short summary: what was deleted/changed, LOC delta, tests run + results, anything pre-existing broken.
"""
LANES={'01':'verify','02':'verify','09':'verify','16':'verify','03':'review','04':'review','05':'review','06':'delivery','07':'delivery','08':'flags','10':'mobile','11':'mobile','12':'mobile','13':'mobile','14':'mobile','15':'docs','17':'backend'}
def lane_of(f):
    n=os.path.basename(f)[:-3]
    try: lm=re.search(r'^lane: (.*)$',Path(f).read_text(),re.M)
    except OSError: lm=None
    return lm.group(1).strip() if lm else LANES.get(n[:2],n)
def main(*, idle_seconds=IDLE_SECONDS, active_seconds=ACTIVE_SECONDS):
    import fcntl
    import planner
    # The compatibility entrypoint and canonical entrypoint share one host lock.
    with open(L+'/driver.lock','a') as owner, Lifecycle(L).signals() as lifecycle:
        try: fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('Existing loop owner is already running')
        s=state(); busy={}; MAX=2
        pr_sweep=OpenPRSweep(L,env=ENV,gate=sim_gate,merge_lock=MERGE_LOCK,log=log,
                            on_merge=lambda: request_install(s))
        migrate_notes(L+'/tasks')
        skipped=set()
        def task_log(*args):
            if args not in skipped: log(*args); skipped.add(args)
        def work(f,n):
            try: execute_task(f,s)
            except Exception as error:
                log(n,'ERROR',redact(str(error))[-2000:])
                meta,_=read_task(f)
                block(n,s.setdefault(n,{}),s,'Worker execution stopped: '+str(error),
                      {'sim_state':'error','logs':redact(str(error))},meta)
            try: subprocess.run(['python3',L+'/progress.py'],env=ENV)
            except OSError: pass
        idle=False
        while not lifecycle.stopping():
            for lane,thread in list(busy.items()):
                if not thread.is_alive(): del busy[lane]; s.pop('_noplan_until',None)
            pr_sweep(s, running={thread.name for thread in busy.values()})
            requested=s.get('_loop_install',float('inf'))
            if requested<=time.time():
                changed=False
                try:
                    update=merged_source(ROOT+'/wt3',ENV)
                    if update and busy:
                        lifecycle.wait(active_seconds); continue
                    if update: changed=install_merged(L,update,ENV,owner)
                except (OSError,ValueError,subprocess.SubprocessError) as error:
                    with LOCK:
                        if s.get('_loop_install')==requested: s['_loop_install']=time.time()+IDLE_SECONDS
                    detail=getattr(error,'stderr',None) or str(error)
                    if isinstance(detail,bytes): detail=detail.decode(errors='replace')
                    log('SELF-INSTALL deferred:',redact(detail)[-800:])
                else:
                    with LOCK:
                        if s.get('_loop_install')==requested: s.pop('_loop_install',None)
                save(s)
                if changed:
                    log('SELF-INSTALL installed merged loop source; restarting through LaunchAgent')
                    return 0 if lifecycle.stopping() else 75
            files=task_files(L+'/tasks',task_log)
            running={thread.name for thread in busy.values()}
            retriage([f for f in files if Path(f).stem not in running],s)
            if lifecycle.stopping(): break
            todo=[f for f in files if not (s.get(Path(f).stem,{}).get('done') or s.get(Path(f).stem,{}).get('blocked'))]
            pending=[f for f in todo if Path(f).stem not in running]
            free=[g for g in ('app','data') if g not in busy]
            if free and not [f for f in pending if group(lane_of(f)) in free] and not s.get('_planner_off') and time.time()>s.get('_noplan_until',0):
                taken={issue_number(f,read_task(f)[0]) for f in files}
                taken|={466,443,483,269,444}
                inflight={thread.name:lane_of(L+'/tasks/'+thread.name+'.md') for thread in busy.values()}
                inflight['_need']='Free worker lane(s): '+' or '.join(free)+'. Pick an issue for a free lane only.'
                result=planner.pick(inflight,taken)
                if result and result!='fail' and group(result[1]) not in free:
                    log('PLANNER pick',result[0],result[1],'is for a busy lane; retry later')
                    s['_noplan_until']=time.time()+600
                elif result and result!='fail':
                    n,lane,reason,iss=result; planner.make_task(n,lane,reason,iss)
                    s.setdefault('_picks',[]).append({'issue':n,'lane':lane,'reason':reason,'at':time.strftime('%H:%M')})
                    save(s); log('PLANNER picked',n,lane,reason); continue
                else: s['_noplan_until']=time.time()+900
            for f in todo:
                n=Path(f).stem; lane=lane_of(f); g=group(lane)
                if lifecycle.stopping() or len(busy)>=MAX: break
                if g in busy or n in running: continue
                thread=threading.Thread(target=work,args=(f,n),name=n,daemon=False)
                busy[g]=thread; running.add(n); thread.start(); log('START',n,'lane',lane,'group',g)
            empty=not todo and not busy
            if empty and not idle: log('IDLE queue empty; re-scan in',idle_seconds,'seconds')
            idle=empty
            lifecycle.wait(idle_seconds if empty else active_seconds)
        log('STOPPING',lifecycle.reason)
        # Retain the owner lock while in-flight tasks finish their existing gates.
        for thread in busy.values(): thread.join()
        log('STOPPED',lifecycle.reason)


if __name__=='__main__':
    raise SystemExit(main())
