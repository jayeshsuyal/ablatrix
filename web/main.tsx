import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Run = {
  id: string; taskId: string; mode: 'fixture' | 'live'; status: 'running' | 'completed' | 'failed';
  input: { entity: string; question: string }; output: null | {
    answer: string; facts: { claim: string; sourceUrls: string[] }[];
    sources: { title: string; url: string; snippet: string }[];
  }; error: string | null; durationMs: number | null; costUsd: number | null;
  costStatus: string; startedAt: string;
};
type Task = { id: string; split: string; entity: string; question: string };
type Report = { labelNote: string; sampleSize: number; correct: number; qualityRate: number | null; costPerCorrectUsd: number | null; costNote: string; uncertainty: string; evaluations: { taskId: string; split: string; correct: boolean; fixture: boolean; deterministic: { answerTermsPresent: boolean; approvedSourcePresent: boolean; citationsResolve: boolean } }[] };
type Experiment = { id: string; candidateId: string; mode: 'fixture' | 'live'; status: string; taskIds: string[]; runIds: string[]; steps: { at: string; message: string }[]; error: string | null; maxAttempts: number; maxDurationMs: number; maxSpendUsd: number; cancelRequested: boolean };
type Optimization = { id: string; status: string; baselineExperimentId: string; candidateExperimentId: string; candidateId: string; settings: { modelAssignment: string; promptStyle: string; cacheTtlMinutes: number; maxSources: number; parallelReads: boolean }; investigation: string; proposal: string; decision: string; challenge: string; error: string | null };
type ComparisonSide = { status: string; correct: boolean; attempts: number; durationMs: number | null; costUsd: number | null; errors: number; sources: { title: string; url: string }[] };
type Comparison = { id: string; mode: string; status: string; decision: string; baseline: { correct: number; total: number; qualityRate: number | null; costPerCorrectUsd: number | null; durationMs: number | null; failures: number }; candidate: { correct: number; total: number; qualityRate: number | null; costPerCorrectUsd: number | null; durationMs: number | null; failures: number }; rows: { taskId: string; baseline: ComparisonSide; candidate: ComparisonSide; regression: boolean }[]; uncertainty: string; costNote: string; experimentCostUsd: number | null; breakEvenTasks: number | null };
type LiveReadiness = { ready: boolean; reason: string; remoteCapEvidence: string | null; budget: { capCents: number; settledCents: number; reservedCents: number; unknownCents: number; availableCents: number; blocked: boolean } };
type HoldoutAssessment = { optimizationId: string; mode: string; sampleSize: number; correct: number; note: string };

function App() {
  const [mode, setMode] = useState<'fixture' | 'live'>('fixture');
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entity, setEntity] = useState('Example Company');
  const [question, setQuestion] = useState('What products does this company make?');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [optimizations, setOptimizations] = useState<Optimization[]>([]);
  const [experimentBusy, setExperimentBusy] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [maxDurationMs, setMaxDurationMs] = useState(30_000);
  const [maxSpendUsd, setMaxSpendUsd] = useState(1);
  const [fixtureDelayMs, setFixtureDelayMs] = useState(0);
  const [optimizationBusy, setOptimizationBusy] = useState(false);
  const [baselineExperimentId, setBaselineExperimentId] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [selectedOptimizationId, setSelectedOptimizationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [liveReadiness, setLiveReadiness] = useState<LiveReadiness | null>(null);
  const [holdout, setHoldout] = useState<HoldoutAssessment | null>(null);
  const [holdoutBusy, setHoldoutBusy] = useState(false);
  useEffect(() => {
    Promise.all([fetch('/api/health').then(r => r.json()), fetch('/api/runs').then(r => r.json()), fetch('/api/tasks').then(r => r.json()), fetch('/api/report').then(r => r.json()), fetch('/api/experiments').then(r => r.json()), fetch('/api/optimizations').then(r => r.json()), fetch('/api/live-readiness').then(r => r.json())])
      .then(([health, list, suite, summary, jobs, changes, readiness]) => { setMode(health.mode); setRuns(list.runs); setSelected(list.runs[0]?.id ?? null); setTasks([...suite.development, ...suite.validation]); setReport(summary); setExperiments(jobs.experiments); setOptimizations(changes.optimizations); setLiveReadiness(readiness); setSelectedOptimizationId(changes.optimizations[0]?.id ?? ''); setBaselineExperimentId(jobs.experiments.find((item: Experiment) => item.status === 'completed' && item.candidateId === 'baseline' && item.runIds.length >= 2)?.id ?? ''); })
      .catch(() => setError('Could not connect to the Ablatrix backend.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const id = selectedOptimizationId;
    if (!id) { setComparison(null); return; }
    let active = true;
    fetch(`/api/optimizations/${id}/comparison`).then(async r => { if (!r.ok) throw new Error('Comparison unavailable.'); return r.json(); }).then(value => { if (active) setComparison(value); }).catch(() => { if (active) { setComparison(null); setError('Could not load comparison.'); } });
    fetch(`/api/optimizations/${id}/holdout`).then(r => r.ok ? r.json() : null).then(value => { if (active) setHoldout(value); }).catch(() => { if (active) setHoldout(null); });
    return () => { active = false; };
  }, [selectedOptimizationId, optimizations]);
  useEffect(() => {
    if (!experiments.some(item => item.status === 'queued' || item.status === 'running') && !optimizations.some(item => item.status === 'running')) return;
    const timer = window.setInterval(() => {
      Promise.all([fetch('/api/experiments').then(r => r.json()), fetch('/api/runs').then(r => r.json()), fetch('/api/report').then(r => r.json()), fetch('/api/optimizations').then(r => r.json()), fetch('/api/live-readiness').then(r => r.json())])
        .then(([jobs, list, summary, changes, readiness]) => { setExperiments(jobs.experiments); setRuns(list.runs); setReport(summary); setOptimizations(changes.optimizations); setLiveReadiness(readiness); })
        .catch(() => setError('Could not refresh experiment progress.'));
    }, 500);
    return () => window.clearInterval(timer);
  }, [experiments, optimizations]);
  useEffect(() => {
    if (baselineExperimentId) return;
    const baseline = experiments.find(item => item.status === 'completed' && item.candidateId === 'baseline' && item.runIds.length >= 2);
    if (baseline) setBaselineExperimentId(baseline.id);
  }, [experiments, baselineExperimentId]);
  const current = runs.find(run => run.id === selected);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entity, question, ...(taskId ? { taskId } : {}) })
      });
      const run = await response.json() as Run;
      if (!response.ok && !run.id) throw new Error(run.error ?? 'Research failed.');
      if (!run.id) throw new Error('The backend did not return a run.');
      setRuns(previous => [run, ...previous]); setSelected(run.id);
      fetch('/api/report').then(r => r.json()).then(setReport).catch(() => {});
      if (!response.ok) setError(run.error ?? 'Research failed.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Request failed.'); }
    finally { setBusy(false); }
  }

  function selectTask(id: string) {
    setTaskId(id);
    const task = tasks.find(item => item.id === id);
    if (task) { setEntity(task.entity); setQuestion(task.question); }
  }
  async function startExperiment() {
    setExperimentBusy(true); setError('');
    try {
      const response = await fetch('/api/experiments', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskIds: tasks.map(task => task.id), maxAttempts, maxDurationMs, maxSpendUsd: mode === 'fixture' ? 0 : maxSpendUsd, fixtureDelayMs: mode === 'fixture' ? fixtureDelayMs : 0 })
      });
      const record = await response.json();
      if (!response.ok) throw new Error(record.error ?? 'Experiment could not start.');
      setExperiments(previous => [record, ...previous]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Experiment failed.'); }
    finally { setExperimentBusy(false); }
  }
  async function cancelExperiment(id: string) {
    const response = await fetch(`/api/experiments/${id}/cancel`, { method: 'POST' });
    const record = await response.json();
    if (!response.ok) { setError(record.error ?? 'Cancellation failed.'); return; }
    setExperiments(previous => previous.map(item => item.id === id ? record : item));
  }
  async function startOptimization() {
    setOptimizationBusy(true); setError('');
    try {
      const response = await fetch('/api/optimizations', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baselineExperimentId })
      });
      const record = await response.json();
      if (!response.ok) throw new Error(record.error ?? 'Optimizer could not start.');
      setOptimizations(previous => [record, ...previous]);
      setSelectedOptimizationId(record.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Optimizer failed.'); }
    finally { setOptimizationBusy(false); }
  }
  async function runHoldout(id: string) {
    setHoldoutBusy(true); setError('');
    try {
      const response = await fetch(`/api/optimizations/${id}/holdout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Holdout assessment failed.');
      setHoldout(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Holdout assessment failed.'); }
    finally { setHoldoutBusy(false); }
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="mark">A</span><div><strong>ablatrix</strong><small>Performance lab</small></div></div>
      <div className="sidebar-heading">RUN HISTORY</div>
      {runs.length === 0 && <p className="muted">No runs yet. Launch a baseline to begin.</p>}
      <div className="run-list">{runs.map(run => <button key={run.id} className={`run-item ${selected === run.id ? 'active' : ''}`} onClick={() => setSelected(run.id)}>
        <strong>{run.input.entity}</strong><span>{run.status} · {new Date(run.startedAt).toLocaleString()}</span>
      </button>)}</div>
      <div className="sidebar-foot">Local workspace<br/>Research agent · baseline</div>
    </aside>
    <main>
      <header><div><div className="eyebrow">WORKSPACE / BASELINE</div><h1>Research run</h1><p>Start with one task. Every response is saved with its sources and execution details.</p></div><span className={`mode ${mode}`}>{mode === 'fixture' ? '● Fixture mode' : '● Live mode'}</span></header>
      <div className="content">
        {loading && <div className="notice" role="status">Loading saved runs and experiments…</div>}
        {mode === 'fixture' && <div className="notice"><strong>Synthetic demonstration</strong><span>Fixture responses are for testing the workflow. They are not live research or benchmark evidence.</span></div>}
        {mode === 'live' && liveReadiness && <div className="notice" role="status"><strong>{liveReadiness.ready && !liveReadiness.budget.blocked ? 'Live metering ready' : 'Live spending blocked'}</strong><span>{liveReadiness.reason} Budget: ${(liveReadiness.budget.availableCents / 100).toFixed(2)} available · ${(liveReadiness.budget.reservedCents / 100).toFixed(2)} reserved · ${(liveReadiness.budget.settledCents / 100).toFixed(2)} settled · ${(liveReadiness.budget.unknownCents / 100).toFixed(2)} unknown. Remote cap: {liveReadiness.remoteCapEvidence ? 'verified' : 'not verified'}.</span></div>}
        <section className="panel form-panel"><div className="section-label">01 / CONFIGURE TASK</div><h2>Launch a baseline</h2>
          <form onSubmit={submit}>
            <label>Curated evaluation task<select value={taskId} onChange={e => selectTask(e.target.value)}><option value="">Custom task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.entity} · {task.split}</option>)}</select></label>
            <label>Company or product<input value={entity} onChange={e => setEntity(e.target.value)} minLength={2} maxLength={120} required readOnly={!!taskId} /></label>
            <label>Research question<textarea value={question} onChange={e => setQuestion(e.target.value)} minLength={8} maxLength={500} rows={3} required readOnly={!!taskId} /></label>
            <button className="primary" disabled={busy || mode === 'live'}>{busy ? 'Running research…' : mode === 'live' ? 'Use bounded experiment for live mode' : 'Run baseline'} <span aria-hidden="true">↗</span></button>
          </form>
        </section>
        {error && <div className="error" role="alert">{error}</div>}
        <section className="panel result-panel"><div className="section-label">02 / RESULT</div>
          {!current && <div className="empty"><span className="empty-icon">◇</span><h2>Awaiting first run</h2><p>The answer, citations and execution record will appear here.</p></div>}
          {current && <><div className="result-top"><div><h2>{current.input.entity}</h2><p>{current.input.question}</p></div><span className={`status ${current.status}`}>{current.status}</span></div>
            <div className="metrics"><div><span>Duration</span><strong>{current.durationMs === null ? '—' : `${current.durationMs} ms`}</strong></div><div><span>Cost</span><strong>{current.costUsd === null ? current.costStatus === 'fixture' ? 'Fixture' : 'Unknown' : `$${current.costUsd.toFixed(4)}`}</strong></div><div><span>Task ID</span><strong className="mono">{current.taskId.slice(0, 8)}</strong></div></div>
            {current.error && <p className="error">{current.error}</p>}
            {current.output && <><div className="answer"><span className="section-label">ANSWER</span><p>{current.output.answer}</p></div><div className="sources"><span className="section-label">SOURCES</span>{current.output.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}</strong><span>{source.url}</span><p>{source.snippet}</p></a>)}</div></>}
          </>}
        </section>
        <section className="panel quality-panel"><div className="section-label">03 / EVALUATION</div><h2>Quality evidence</h2>
          <div className="metrics"><div><span>Live sample</span><strong>{report?.sampleSize ?? 0}</strong></div><div><span>Correct</span><strong>{report?.correct ?? 0}</strong></div><div><span>Cost / correct</span><strong>{report?.costPerCorrectUsd === null || report?.costPerCorrectUsd === undefined ? 'Unknown' : `$${report.costPerCorrectUsd.toFixed(4)}`}</strong></div></div>
          <p className="muted-text">{report?.uncertainty ?? 'No report yet.'}</p>
          {report && <p className="muted-text">{report.costNote}</p>}
          {report && <p className="muted-text">{report.labelNote}</p>}
          {report?.evaluations.map(item => <div className="eval-row" key={item.taskId}><strong>{item.taskId}</strong><span>{item.fixture ? 'Fixture · excluded' : item.correct ? 'Passed checks' : 'Failed checks'}</span><small>Answer terms {item.deterministic.answerTermsPresent ? '✓' : '×'} · Approved source {item.deterministic.approvedSourcePresent ? '✓' : '×'} · Citations {item.deterministic.citationsResolve ? '✓' : '×'}</small></div>)}
        </section>
        <section className="panel quality-panel"><div className="section-label">04 / EXPERIMENT RUNNER</div><h2>Bounded comparison run</h2>
          <p className="muted-text">Runs the development and validation tasks serially. Cancellation stops future tasks.</p>
          <div className="runner-settings"><label>Attempts per task<select value={maxAttempts} onChange={e => setMaxAttempts(Number(e.target.value))}><option value={1}>1</option><option value={2}>2</option></select></label><label>Time limit<select value={maxDurationMs} onChange={e => setMaxDurationMs(Number(e.target.value))}><option value={30000}>30 seconds</option><option value={60000}>60 seconds</option></select></label>
            {mode === 'live' ? <label>Spend cap (USD)<input type="number" min="0.01" max="100" step="0.01" value={maxSpendUsd} onChange={e => setMaxSpendUsd(Number(e.target.value))} /></label> : <label>Fixture pacing<select value={fixtureDelayMs} onChange={e => setFixtureDelayMs(Number(e.target.value))}><option value={0}>Immediate</option><option value={2000}>2 seconds per task</option></select></label>}</div>
          <button className="primary experiment-start" onClick={startExperiment} disabled={experimentBusy || tasks.length === 0 || mode === 'live' && (!liveReadiness?.ready || liveReadiness.budget.blocked)}>{experimentBusy ? 'Queuing…' : 'Run experiment'} <span aria-hidden="true">↗</span></button>
          {experiments.length === 0 && <p className="muted-text">No experiments yet.</p>}
          {experiments.map(item => <div className="experiment" key={item.id}>
            <div className="experiment-head"><strong>{item.status}</strong><span>{item.runIds.length}/{item.taskIds.length} attempts · {item.candidateId}</span>{(item.status === 'queued' || item.status === 'running') && <button onClick={() => cancelExperiment(item.id)} disabled={item.cancelRequested}>{item.cancelRequested ? 'Cancellation requested' : 'Cancel'}</button>}</div>
            <p className="muted-text">Budget: {item.mode === 'fixture' ? 'fixture, no provider spend' : `$${item.maxSpendUsd.toFixed(2)} upstream cap required`} · Attempts/task ≤ {item.maxAttempts} · Time ≤ {Math.round(item.maxDurationMs / 1000)}s</p>
            {item.error && <p className="error">{item.error}</p>}
            <ol>{item.steps.map((step, index) => <li key={index}>{step.message}</li>)}</ol>
          </div>)}
        </section>
        <section className="panel quality-panel"><div className="section-label">05 / OPTIMIZE</div><h2>Investigate → propose → challenge</h2>
          <p className="muted-text">The modifier can change only one approved workflow setting. The challenger requires priced cost and no quality regression before accepting it.</p>
          <div className="opt-controls"><label>Baseline experiment<select value={baselineExperimentId} onChange={e => setBaselineExperimentId(e.target.value)}><option value="">Choose a completed baseline</option>{experiments.filter(item => item.status === 'completed' && item.candidateId === 'baseline' && item.runIds.length >= 2).map(item => <option key={item.id} value={item.id}>{item.id.slice(0, 8)} · {item.runIds.length} runs</option>)}</select></label><button className="primary" disabled={!baselineExperimentId || optimizationBusy || mode === 'live' && (!liveReadiness?.ready || liveReadiness.budget.blocked)} onClick={startOptimization}>{optimizationBusy ? 'Proposing…' : 'Propose candidate'} <span aria-hidden="true">↗</span></button></div>
          {optimizations.length === 0 && <p className="muted-text">No proposals yet.</p>}
          {optimizations.map(item => <div className="optimization" key={item.id}><div className="experiment-head"><strong>{item.candidateId}</strong><span>{item.status} · {item.decision}</span><button onClick={() => setSelectedOptimizationId(item.id)} aria-pressed={selectedOptimizationId === item.id}>View comparison</button></div>
            <div className="opt-stages"><div><span>INVESTIGATOR</span><p>{item.investigation}</p></div><div><span>MODIFIER</span><p>{item.proposal}</p><code>{JSON.stringify(item.settings)}</code></div><div><span>CHALLENGER</span><p>{item.challenge}</p></div></div>
            {item.error && <p className="error">{item.error}</p>}
          </div>)}
        </section>
        {comparison && <section className="panel quality-panel comparison-panel"><div className="section-label">06 / COMPARISON & EXPORT</div><h2>Baseline vs candidate</h2>
          <p className="muted-text">Selected candidate: {optimizations.find(item => item.id === comparison.id)?.candidateId ?? comparison.id}. {comparison.decision === 'accepted' ? 'Accepted by the challenger.' : 'Unvalidated candidate export; no measured improvement has been established.'}</p>
          {holdout ? <p className="muted-text">Final holdout: {holdout.correct}/{holdout.sampleSize} passed deterministic checks. {holdout.note}</p> : comparison.mode === 'fixture' && comparison.status === 'completed' ? <button onClick={() => runHoldout(comparison.id)} disabled={holdoutBusy}>{holdoutBusy ? 'Assessing holdout…' : 'Run final fixture holdout'}</button> : <p className="muted-text">Final holdout has not been assessed.</p>}
          <div className="comparison-summary"><div><span>BASELINE</span><strong>{comparison.baseline.correct}/{comparison.baseline.total} correct</strong><small>{comparison.baseline.durationMs ?? '—'} ms · {comparison.baseline.costPerCorrectUsd === null ? 'Cost unknown' : `$${comparison.baseline.costPerCorrectUsd.toFixed(4)}/correct`}</small></div><div><span>CANDIDATE</span><strong>{comparison.candidate.correct}/{comparison.candidate.total} correct</strong><small>{comparison.candidate.durationMs ?? '—'} ms · {comparison.candidate.costPerCorrectUsd === null ? 'Cost unknown' : `$${comparison.candidate.costPerCorrectUsd.toFixed(4)}/correct`}</small></div><div><span>DECISION</span><strong>{comparison.decision}</strong><small>{comparison.baseline.failures + comparison.candidate.failures} failed attempt(s)</small></div></div>
          <p className="muted-text">{comparison.uncertainty} {comparison.costNote} Experiment cost: {comparison.experimentCostUsd === null ? 'unknown' : `$${comparison.experimentCostUsd.toFixed(4)}`}. Break-even: {comparison.breakEvenTasks === null ? 'not calculable' : `${comparison.breakEvenTasks} tasks`}.</p>
          <div className="comparison-rows">{comparison.rows.map(row => <div className={`comparison-row ${row.regression ? 'regression' : ''}`} key={row.taskId}><strong>{row.taskId}{row.regression ? ' · regression' : ''}</strong><div><span>Baseline: {row.baseline.status} · {row.baseline.correct ? 'passed' : 'failed checks'} · {row.baseline.attempts} attempt(s) · {row.baseline.errors} error(s) · {row.baseline.durationMs ?? '—'} ms · {row.baseline.costUsd === null ? 'cost unknown' : `$${row.baseline.costUsd.toFixed(4)}`}</span><span>Candidate: {row.candidate.status} · {row.candidate.correct ? 'passed' : 'failed checks'} · {row.candidate.attempts} attempt(s) · {row.candidate.errors} error(s) · {row.candidate.durationMs ?? '—'} ms · {row.candidate.costUsd === null ? 'cost unknown' : `$${row.candidate.costUsd.toFixed(4)}`}</span></div><div className="source-links">{row.baseline.sources.map(source => <a key={`baseline-${source.url}`} href={source.url} target="_blank" rel="noreferrer">Baseline: {source.title} ↗</a>)}{row.candidate.sources.map(source => <a key={`candidate-${source.url}`} href={source.url} target="_blank" rel="noreferrer">Candidate: {source.title} ↗</a>)}</div></div>)}</div>
          <div className="export-actions"><a href={`/api/optimizations/${comparison.id}/export?format=candidate`}>Candidate config</a><a href={`/api/optimizations/${comparison.id}/export?format=original`}>Original config</a><a href={`/api/optimizations/${comparison.id}/export?format=patch`}>Patch</a><a href={`/api/optimizations/${comparison.id}/export?format=manifest`}>Reproducibility data</a></div>
        </section>}
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
