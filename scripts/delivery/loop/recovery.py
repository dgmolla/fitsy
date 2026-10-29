"""Deterministic recovery policy used by the existing loop, with no new scheduler."""
import hashlib
import json
import re
import time

MAX_ROUNDS = 8
MAX_SIM_REPAIRS = 4
MAX_RERUNS = 2
RETRIAGE_SECONDS = 15 * 60
MAX_REQUEUES_PER_DAY = 3
STRATEGIES = (
    ('targeted', 'Fix the observed failing step using the attached failure image and logs.'),
    ('host-reproduce', 'Reproduce the failing step on the sim-capable host runner before editing. '
     'Require a local Maestro pass before push; candidate Codex keeps its sandbox.'),
    ('compare-main', 'Compare the merge-base run with the candidate: diff/bisect relevant hunks '
     'and compare attached screenshots against the passing main run.'),
    ('split-strategy', 'Use a different strategy: isolate the smallest causal change and propose '
     'a coherent PR split if needed. Preserve every required flow and assertion.'),
)


def redact(text):
    text = re.sub(r'(?i)(bearer\s+)[\w.\-]+', r'\1[redacted]', str(text))
    text = re.sub(r'(?i)((?:token|password|secret|api[_-]?key)["\']?\s*[=:]\s*["\']?)[^\s,"\']+',
                  r'\1[redacted]', text)
    return re.sub(r'([a-z]+://)[^\s/@]+:[^\s/@]+@', r'\1[redacted]@', text)


def classify_failure(evidence):
    """Only positive candidate evidence authorizes a code repair."""
    status = str(evidence.get('sim_state', '')).lower()
    logs = str(evidence.get('logs', '')).lower()
    api = evidence.get('api_status')
    if (status == 'error' or evidence.get('free_disk_gb', 100) < 5 or
            evidence.get('simulator_booted') is False or
            evidence.get('missing_env') or
            re.search(r'enospc|no space left|missing.*(?:env|upstash|redis)|'
                      r'(?:env|upstash|redis).*not (?:set|configured)|sandbox.*denied|'
                      r'coresimulator.*(?:unavailable|refused)|no ready fitsy-api preview|'
                      r'backend.*source.*mismatch', logs)):
        return 'env'
    if isinstance(api, int) and api >= 500 and not evidence.get('candidate_stack'):
        return 'env'
    if evidence.get('main_same_failure'):
        return 'stale_test' if evidence.get('assertion_failure') else 'env'
    if evidence.get('rerun_passed'):
        return 'flaky'
    if evidence.get('stale_assertion'):
        return 'stale_test'
    if (status == 'failure' and evidence.get('main_passed')) or evidence.get('candidate_stack'):
        return 'app_bug'
    return 'unknown'


def failure_fingerprint(evidence):
    keys = ('sim_state', 'flow', 'step', 'api_status', 'missing_env', 'deploy_state',
            'simulator_booted', 'main_same_failure', 'main_passed', 'candidate_stack', 'logs')
    value = {key: evidence.get(key) for key in keys}
    value['low_disk'] = evidence.get('free_disk_gb', 100) < 5
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def repair_prompt(evidence, history, attempt, original):
    required = ['flow', 'step', 'logs', 'diff_stat', 'diff_hunks']
    missing = [key for key in required if not str(evidence.get(key) or '').strip()]
    if not evidence.get('images'):
        missing.append('attached failure image/video frame')
    if missing:
        raise ValueError('Missing repair evidence: ' + ', '.join(missing))
    tag, strategy = STRATEGIES[min(attempt, len(STRATEGIES) - 1)]
    media = '\n'.join(f'![Attached failure/main frame]({path})' for path in evidence['images'])
    videos = '\n'.join(f'Video: {path}' for path in evidence.get('videos', []))
    return tag, redact(f'''**TL;DR:** Repair the observed failure with strategy {tag}.

Triage: {classify_failure(evidence)}
Strategy [{tag}]: {strategy}
Failing flow: {evidence['flow']}
Failing step: {evidence['step']}
{media}
{videos}
App/device/runner log excerpt:
{evidence['logs']}
git diff origin/main...HEAD --stat:
{evidence['diff_stat']}
Relevant diff hunks:
{evidence['diff_hunks']}
Main comparison: {evidence.get('main_comparison', 'Not yet available; collect on the host.')}
Prior attempts and outcomes:
{json.dumps(history, sort_keys=True)}
Never skip or disable flows, remove assertions, bypass checks, or weaken gates to get green.
If blocked by environment, change no app code and write the diagnosis to .infra-blocked.
Original task:
{original}
''')


def gating_failures(checks, triage):
    return [name for name, value in checks.items()
            if value in ('FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT') and
            name not in ('Simulator', 'Sim scope') and
            (not name.startswith('Vercel') or triage == 'app_bug')]


def record_attempt(st, kind, **details):
    st.setdefault('attempts', []).append({'at': time.time(), 'kind': kind, **details})


def park(st, reason, evidence, blocked_on, main, now=None):
    now = time.time() if now is None else now
    st.update(blocked=redact(reason), blocked_on=blocked_on, triage=classify_failure(evidence),
              parked_at=now, triaged_at=now, parked_main=main,
              blocked_fingerprint=failure_fingerprint(evidence))
    record_attempt(st, 'park', reason=redact(reason), blocked_on=blocked_on, triage=st['triage'],
                   simrepair=st.get('simrepair', 0), fix_rounds=st.get('fix_rounds', 0))
    st['park_notice'] = {'id': f'{int(now * 1000)}-{len(st["attempts"])}', 'sent': []}


def requeue(st, evidence, main, dependency_state=None, check_passed=False, now=None):
    now = time.time() if now is None else now
    if not st.get('blocked') or st.get('done'):
        return False
    observed_change = bool(main and main != st.get('triaged_main', st.get('parked_main')))
    main_changed = bool(main and main != st.get('parked_main'))
    if not observed_change and now - st.get('triaged_at', 0) < RETRIAGE_SECONDS:
        return False
    st['triaged_at'] = now
    st['triaged_main'] = main
    condition = st.get('blocked_on', '')
    if condition.startswith('PR#'):
        changed = dependency_state == 'MERGED'
    elif condition.startswith('check:'):
        changed = check_passed
    elif condition == 'env:preparation':
        changed = evidence.get('preparation_ready') is True
    elif condition == 'env:api-config':
        # A stale error status cannot hide recovery of the measured blocking API.
        changed = isinstance(evidence.get('api_status'), int) and 200 <= evidence['api_status'] < 500
    elif condition == 'environment' or condition.startswith('env:'):
        prior = st.get('blocked_evidence', {})
        changed = (evidence.get('rerun_passed') or
                   (prior.get('free_disk_gb', 100) < 5 <= evidence.get('free_disk_gb', 0)) or
                   (prior.get('simulator_booted') is False and evidence.get('simulator_booted') is True) or
                   (classify_failure(evidence) != 'env' and
                    failure_fingerprint(evidence) != st.get('blocked_fingerprint')))
    elif condition == 'baseline':
        changed = evidence.get('main_passed') or evidence.get('main_same_failure')
    elif condition == 'evidence':
        changed = all(evidence.get(key) for key in ('flow', 'step', 'images', 'logs', 'diff_stat', 'diff_hunks'))
    else:
        changed = main_changed and classify_failure(evidence) != 'env'
    requeues = [at for at in st.get('requeues', []) if at > now - 24 * 3600]
    if not changed or len(requeues) >= MAX_REQUEUES_PER_DAY:
        return False
    record_attempt(st, 'requeue', previous_reason=st['blocked'], blocked_on=condition, main=main)
    st['requeues'] = requeues + [now]
    for key in ('blocked', 'blocked_on', 'simrepair', 'fix_rounds', 'reruns', 'env_retries'):
        st.pop(key, None)
    return True


def parking_body(name, st, evidence):
    links = '\n'.join(evidence.get('links', [])) or 'Private local evidence retained by the host owner.'
    return redact(f'''**TL;DR:** Delivery stopped for {name}; the existing owner will re-triage the blocker.

Triage: {st['triage']}; blocked_on: {st['blocked_on']}.
Diagnosis: {st['blocked']}
Attempts: {st.get('simrepair', 0)} simulator repairs; {st.get('fix_rounds', 0)} general fix rounds; {len(st.get('attempts', []))} recorded events.
Failing flow/step: {evidence.get('flow', 'unavailable')} / {evidence.get('step', 'unavailable')}.
Evidence:
{links}
Suggested human action: {evidence.get('human_action', 'None required now; host owner checks environment, runner logs and API configuration before retrying.')}
Automatic re-triage runs on main advance or every {RETRIAGE_SECONDS // 60} minutes; at most {MAX_REQUEUES_PER_DAY} requeues per rolling day.
<!-- fitsy-loop-park:{name}:{st['park_notice']['id']} -->
''')
