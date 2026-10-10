#!/usr/bin/env python3
"""Isolated Linux acceptance check. Uses only newly created test containers/volume."""
import argparse
import json
import subprocess
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--image', default='ablatrix-demo:local')
parser.add_argument('--context')
options = parser.parse_args()
docker = ['docker'] + (['--context', options.context] if options.context else [])
name = 'ablatrix-check-' + uuid.uuid4().hex[:10]
volume = name + '-data'
containers = []


def run(*args, expected=0):
    result = subprocess.run(docker + list(args), capture_output=True, text=True, timeout=90)
    if result.returncode != expected:
        raise RuntimeError(f'{args[0]} returned {result.returncode}, expected {expected}: {result.stdout}\n{result.stderr}')
    return result.stdout.strip()


def invocation(directory='/data/workspace'):
    return ['--mount', f'type=volume,source={volume},target=/data', '-e', f'ABLATRIX_DATA_DIR={directory}']


identity = [
    '-e', 'ABLATRIX_DEMO_ORIGIN=https://container.example.test',
    '-e', 'ABLATRIX_DEMO_ISSUER=https://identity.example.test',
    '-e', 'ABLATRIX_DEMO_AUDIENCE=container-check',
    '-e', 'ABLATRIX_DEMO_JWKS_URL=https://identity.example.test/certs',
    '-e', 'ABLATRIX_DEMO_MEMBERS=' + json.dumps([{'subject': 'fixture', 'role': 'operator', 'name': 'Synthetic tester'}]),
    # These inherited flags must not enable provider dispatch in hosted mode.
    '-e', 'ABLATRIX_LOOP_LIVE=1', '-e', 'ABLATRIX_REVISION_WEB=1', '-e', 'ABLATRIX_LANGFUSE_ENABLED=1',
]

seed = r"""
import {prepareDemoData,syntheticRetriever} from './server/hosted-demo.ts';
import {SyntheticAnswerProvider} from './server/synthetic-answer-provider.ts';
import {ProductWorkspace} from './server/product-workspace.ts';
import {PaidAnswerReview} from './server/paid-answer-review.ts';
import {AnswerRevisions} from './server/answer-revisions.ts';
const d=prepareDemoData(process.env.ABLATRIX_DATA_DIR);
const p=new SyntheticAnswerProvider(d+'/synthetic-receipts.sqlite');
const w=new ProductWorkspace(d+'/product-workspace.sqlite',p,syntheticRetriever);
const r=new PaidAnswerReview(d+'/paid-answer-review.sqlite');
const a=new AnswerRevisions(r,p,d+'/paid-answer-review.sqlite',false);
const product=w.createProduct({title:'Synthetic bottle',sources:[{label:'Fixture manual',text:'This synthetic travel bottle holds 600 ml. Hand wash the cap and body.'}]});
await w.ask({productId:product.id,question:'What is the capacity and care instruction?',mode:'synthetic'});
const snap=w.reviewSnapshots()[0], original=a.registerAnswer(snap);
a.request(snap.id,{versionId:original.id,idempotencyKey:'container-check-revision',reviewer:'Synthetic test operator',feedback:'Include the care instruction clearly.',issue:'answer_quality',investigate:false});
await a.tick();
const latest=a.overview('workspace').cases[0].versions.at(-1);
a.decide(snap.id,{versionId:latest.id,reviewer:'Synthetic test reviewer',decision:'accept',note:'Synthetic workflow check only.',checkedSourceShas:latest.context.sources.map(s=>s.sha256)});
await a.pauseAndDrain();a.close();r.close();w.close();p.close();
console.log('seeded one synthetic answer, one revision, and one decision');
"""

inspect_data = r"""
import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';
const d=process.env.ABLATRIX_DATA_DIR, result={};
for(const [file,tables] of Object.entries({'product-workspace.sqlite':['workspace_products','workspace_runs'],'paid-answer-review.sqlite':['workspace_review_answers','answer_versions','answer_revision_jobs','answer_review_events','answer_revision_attempts'],'synthetic-receipts.sqlite':['synthetic_answer_receipts']})){
 const db=new DatabaseSync(d+'/'+file,{readOnly:true});
 for(const table of tables){const rows=db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();result[table]={rows:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}db.close();
}console.log(JSON.stringify(result));
"""


def inspect(container):
    return json.loads(run('exec', container, 'node', '--input-type=module', '-e', inspect_data))


def ready(container):
    for _ in range(60):
        state = json.loads(run('inspect', '--format', '{{json .State}}', container))
        if not state['Running']:
            raise RuntimeError('Container stopped: ' + run('logs', container))
        probe = subprocess.run(docker + ['exec', container, 'node', '-e', "const s=require('node:net').connect(4173,'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"], capture_output=True, timeout=5)
        if probe.returncode == 0:
            return
        time.sleep(0.25)
    raise RuntimeError('Container did not become ready')


try:
    print('Running Linux lock, backup, and authenticated API tests…', flush=True)
    print(run('run', '--rm', '--entrypoint', 'node', options.image, '--import', 'tsx', '--test', 'server/demo-backup.test.ts', 'server/hosted-demo-api.test.ts'), flush=True)
    run('volume', 'create', volume)
    print(run('run', '--rm', *invocation(), options.image, 'node', '--import', 'tsx', '--input-type=module', '-e', seed), flush=True)
    containers.append(name)
    run('run', '-d', '--name', name, '--init', '--read-only', '--tmpfs', '/tmp:size=32m,mode=1777', *invocation(), *identity, options.image)
    ready(name)
    baseline = inspect(name)
    assert baseline['synthetic_answer_receipts']['rows'] == 2
    assert baseline['answer_revision_jobs']['rows'] == 1
    assert baseline['answer_review_events']['rows'] == 2
    pid_before = run('exec', name, 'cat', '/data/workspace/ablatrix.sqlite.lock')
    run('run', '--rm', *invocation(), options.image, 'node', '-e', 'process.exit(99)', expected=75)
    run('run', '--rm', *invocation(), options.image, 'node', '--import', 'tsx', 'scripts/demo-backup.ts', 'backup', '--destination', '/data/unsafe-backup', expected=75)
    run('kill', '--signal', 'KILL', name)
    run('start', name)
    ready(name)
    pid_after = run('exec', name, 'cat', '/data/workspace/ablatrix.sqlite.lock')
    assert inspect(name) == baseline, 'Crash restart changed durable answer/review/receipt identities'
    print(f'Crash restart preserved every record (Node PID {pid_before} → {pid_after}); second app and active backup blocked.', flush=True)
    run('stop', '--time', '45', name)
    state = json.loads(run('inspect', '--format', '{{json .State}}', name))
    assert state['ExitCode'] == 0, state
    print(run('run', '--rm', *invocation(), options.image, 'node', '--import', 'tsx', 'scripts/demo-backup.ts', 'backup', '--destination', '/data/snapshot'), flush=True)
    print(run('run', '--rm', *invocation('/data/restored'), options.image, 'node', '--import', 'tsx', 'scripts/demo-backup.ts', 'restore', '--source', '/data/snapshot'), flush=True)
    restored = name + '-restored'
    containers.append(restored)
    run('run', '-d', '--name', restored, '--init', '--read-only', '--tmpfs', '/tmp:size=32m,mode=1777', *invocation('/data/restored'), *identity, options.image)
    ready(restored)
    assert inspect(restored) == baseline, 'Restore changed durable records'
    run('stop', '--time', '45', restored)
    print('PASS: graceful stop, crash restart, exclusive ownership, complete backup/restore; 2 synthetic receipts, 0 provider calls.', flush=True)
finally:
    for container in containers:
        subprocess.run(docker + ['rm', '-f', container], capture_output=True, timeout=30)
    subprocess.run(docker + ['volume', 'rm', volume], capture_output=True, timeout=30)
