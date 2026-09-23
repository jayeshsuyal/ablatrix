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
type Report = { labelNote: string; sampleSize: number; correct: number; qualityRate: number | null; costPerCorrectUsd: number | null; uncertainty: string; evaluations: { taskId: string; split: string; correct: boolean; fixture: boolean; deterministic: { answerTermsPresent: boolean; approvedSourcePresent: boolean; citationsResolve: boolean } }[] };
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
  const [historyQuery, setHistoryQuery] = useState('');
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

  const filteredRuns = runs.filter(run => `${run.input.entity} ${run.taskId}`.toLowerCase().includes(historyQuery.toLowerCase()));
  const activeCount = experiments.filter(item => ['running', 'queued'].includes(item.status)).length;
  return <div className="shell" id="top">
    <a className="skip-link" href="#workbench">Skip to workbench</a>
    <aside className="sidebar">
      <a className="brand" href="#top" aria-label="Ablatrix home"><span className="mark" aria-hidden="true"><i /><i /><i /></span><strong>ablatrix<span> /</span></strong></a>
      <div className="edition">AGENT PERFORMANCE LAB<span>LOCAL / 0.1</span></div>
      <nav className="desk-nav" aria-label="Workspace sections"><a href="#workbench"><span>01</span> Workbench <b aria-hidden="true">↗</b></a><a href="#experiments"><span>02</span> Experiments <b>{activeCount > 0 ? activeCount : '↗'}</b></a><a href="#evidence"><span>03</span> Evidence <b aria-hidden="true">↗</b></a></nav>
      <div className="sidebar-heading">RUN INDEX <span>{String(runs.length).padStart(2, '0')}</span></div>
      <label className="history-search"><span className="sr-only">Search run history</span><input type="search" value={historyQuery} onChange={e => setHistoryQuery(e.target.value)} placeholder="Find a run…" /></label>
      {runs.length === 0 && <p className="muted">Your first run starts the record.</p>}
      {runs.length > 0 && filteredRuns.length === 0 && <p className="muted" role="status">No runs match “{historyQuery}”.</p>}
      <div className="run-list">{filteredRuns.map(run => <button key={run.id} aria-pressed={selected === run.id} className={`run-item ${selected === run.id ? 'active' : ''}`} onClick={() => setSelected(run.id)}>
        <span className={`run-dot ${run.status}`} aria-hidden="true" /><div><strong>{run.input.entity}</strong><span>{run.status} · {new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><small>{run.id.slice(0, 4)}</small>
      </button>)}</div>
      <div className="sidebar-foot"><span className="local-dot" /> LOCAL-FIRST WORKSPACE<p>One agent.<br/>Every change on the record.</p><span className="foot-index">ABL / RESEARCH SERIES</span></div>
    </aside>
    <main>
      <div className="utility-bar"><span>RESEARCH AGENT <span className="utility-slash">/</span> EXPERIMENT DESK</span><span className={`mode ${mode}`}>{loading ? 'Connecting…' : mode === 'fixture' ? 'Fixture mode' : 'Live mode'}</span></div>
      <header className="desk-header"><div><div className="eyebrow">MEASURE. CHANGE. CHALLENGE.</div><h1>Better, <em>by evidence.</em></h1><p>A working agent is the starting point.<br/>Find out whether the next change earns its place.</p></div><div className="desk-principle"><span className="principle-number">Δ</span><div><span>THE RULE OF THE DESK</span><p>Lower cost is only a win<br/>if the work still holds up.</p><a href="#evidence">Inspect the evidence <span aria-hidden="true">↗</span></a></div></div></header>
      <nav className="process-strip" aria-label="Experiment workflow"><a href="#workbench"><span className="process-number">01</span><div><strong>Record a baseline</strong><small>{runs.length ? `${runs.length} saved runs` : 'Establish the starting point'}</small></div><span aria-hidden="true">→</span></a><a href="#experiments"><span className={`process-number ${baselineExperimentId ? 'is-ready' : ''}`}>02</span><div><strong>Change one thing</strong><small>{baselineExperimentId ? 'Baseline ready for a proposal' : 'Run a bounded experiment'}</small></div><span aria-hidden="true">→</span></a><a href="#comparison"><span className={`process-number ${comparison ? 'is-ready' : ''}`}>03</span><div><strong>Make it prove itself</strong><small>{comparison ? comparison.decision.replaceAll('-', ' ') : 'Compare, challenge, export'}</small></div><span aria-hidden="true">↗</span></a></nav>
      <div className="content">
        {loading && <div className="notice" role="status">Loading saved runs and experiments…</div>}
        {mode === 'fixture' && <div className="notice fixture-notice"><span className="notice-symbol" aria-hidden="true">i</span><div><strong>Demonstration, not a benchmark.</strong><span>Fixture responses are for testing the workflow. They are not live research or benchmark evidence.</span></div><span className="notice-tail">NO PAID CALLS</span></div>}
        {mode === 'live' && liveReadiness && <div className="notice" role="status"><strong>{liveReadiness.ready && !liveReadiness.budget.blocked ? 'Live metering ready' : 'Live spending blocked'}</strong><span>{liveReadiness.reason} Budget: ${(liveReadiness.budget.availableCents / 100).toFixed(2)} available · ${(liveReadiness.budget.reservedCents / 100).toFixed(2)} reserved · ${(liveReadiness.budget.settledCents / 100).toFixed(2)} settled · ${(liveReadiness.budget.unknownCents / 100).toFixed(2)} unknown. Remote cap: {liveReadiness.remoteCapEvidence ? 'verified' : 'not verified'}.</span></div>}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="workbench-grid" id="workbench">
        <section className="panel form-panel"><div className="section-label"><span>01 / INPUT</span><span>RESEARCH BRIEF</span></div><h2>Launch a baseline</h2><p className="section-intro">Choose a task. Keep the first run as your reference.</p>
          <form onSubmit={submit}>
            <label>Curated evaluation task<select value={taskId} onChange={e => selectTask(e.target.value)}><option value="">Custom task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.entity} · {task.question} ({task.split})</option>)}</select></label>
            <label>Company or product<input value={entity} onChange={e => setEntity(e.target.value)} minLength={2} maxLength={120} required readOnly={!!taskId} /></label>
            <label>Research question<textarea value={question} onChange={e => setQuestion(e.target.value)} minLength={8} maxLength={500} rows={3} required readOnly={!!taskId} /></label>
            <button className="primary" disabled={busy || mode === 'live'}>{busy ? 'Running research…' : mode === 'live' ? 'Use bounded experiment for live mode' : 'Run baseline'} <span aria-hidden="true">↗</span></button>
            <span className="form-footnote">{mode === 'fixture' ? 'Synthetic response · saved locally · no provider spend' : 'Live work must use a metered, bounded experiment.'}</span>
          </form>
        </section>
        <section className="panel result-panel" aria-label="Selected run"><div className="section-label"><span>02 / OBSERVATION</span><span>{current ? `RUN ${current.id.slice(0, 8)}` : 'NO RECORD YET'}</span></div>
          {!current && <div className="empty"><div className="specimen" aria-hidden="true"><span>+</span><div className="specimen-lines"><i /><i /><i /><i /><i /></div><span>+</span></div><span className="empty-index">OBSERVATION / 001</span><h2>A clean starting point.</h2><p>Run the brief on the left.<br/>The answer, its sources, and its execution record will land here.</p><div className="empty-bottom"><span>ANSWER</span><span>SOURCES</span><span>RUN RECORD</span></div></div>}
          {current && <><div className="result-top"><div><h2>{current.input.entity}</h2><p>{current.input.question}</p></div><span className={`status ${current.status}`}>{current.status}</span></div>
            <div className="metrics"><div><span>Duration</span><strong>{current.durationMs === null ? '—' : `${current.durationMs} ms`}</strong></div><div><span>Cost</span><strong>{current.costUsd === null ? current.costStatus === 'fixture' ? 'Fixture' : 'Unknown' : `$${current.costUsd.toFixed(4)}`}</strong></div><div><span>Task ID</span><strong className="mono">{current.taskId.slice(0, 8)}</strong></div></div>
            {current.error && <p className="error">{current.error}</p>}
            {current.output && <><div className="answer"><span className="section-label">ANSWER</span><p>{current.output.answer}</p></div><div className="sources"><span className="section-label">SOURCES</span>{current.output.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}</strong><span>{source.url}</span><p>{source.snippet}</p></a>)}</div></>}
          </>}
        </section>
        </div>
        <div className="chapter-heading" id="experiments"><span>02</span><div><h2>One change. A fair trial.</h2><p>Set the boundaries before the experiment starts.</p></div><span className="chapter-meta">{tasks.length} AVAILABLE TASKS</span></div>
        <section className="panel runner-panel"><div className="section-label"><span>EXPERIMENT PROTOCOL</span><span>{activeCount ? `${activeCount} ACTIVE` : 'READY WHEN YOU ARE'}</span></div><h2>Bounded comparison run</h2>
          <p className="muted-text">Runs the development and validation tasks serially. Cancellation stops future tasks, not an already-running remote call.</p>
          <div className="runner-settings"><label>Attempts per task<select value={maxAttempts} onChange={e => setMaxAttempts(Number(e.target.value))}><option value={1}>1</option><option value={2}>2</option></select></label><label>Time limit<select value={maxDurationMs} onChange={e => setMaxDurationMs(Number(e.target.value))}><option value={30000}>30 seconds</option><option value={60000}>60 seconds</option></select></label>
            {mode === 'live' ? <label>Spend cap (USD)<input type="number" min="0.01" max="100" step="0.01" value={maxSpendUsd} onChange={e => setMaxSpendUsd(Number(e.target.value))} /></label> : <label>Fixture pacing<select value={fixtureDelayMs} onChange={e => setFixtureDelayMs(Number(e.target.value))}><option value={0}>Immediate</option><option value={2000}>2 seconds per task</option></select></label>}</div>
          <button className="primary experiment-start" onClick={startExperiment} disabled={experimentBusy || tasks.length === 0 || mode === 'live' && (!liveReadiness?.ready || liveReadiness.budget.blocked)}>{experimentBusy ? 'Queuing…' : 'Run experiment'} <span aria-hidden="true">↗</span></button>
          {experiments.length === 0 && <div className="inline-empty"><span>—</span><p>No experiments on the record yet.<small>The protocol above defines the limits for your first trial.</small></p></div>}
          {experiments.map(item => <div className="experiment" key={item.id}>
            <div className="experiment-head"><strong className={`status ${item.status}`}>{item.status}</strong><span>{item.runIds.length} attempts / {item.taskIds.length} tasks · {item.candidateId}</span>{(item.status === 'queued' || item.status === 'running') && <button onClick={() => cancelExperiment(item.id)} disabled={item.cancelRequested}>{item.cancelRequested ? 'Cancellation requested' : 'Cancel'}</button>}</div>
            <p className="muted-text">Budget: {item.mode === 'fixture' ? 'fixture, no provider spend' : `$${item.maxSpendUsd.toFixed(2)} upstream cap required`} · Attempts/task ≤ {item.maxAttempts} · Time ≤ {Math.round(item.maxDurationMs / 1000)}s</p>
            {item.error && <p className="error">{item.error}</p>}
            <ol>{item.steps.map((step, index) => <li key={index}>{step.message}</li>)}</ol>
          </div>)}
        </section>
        <section className="panel optimizer-panel"><div className="section-label"><span>THE OPTIMIZATION LOOP</span><span>BOUNDED BY DESIGN</span></div><h2>Investigate → propose → challenge</h2>
          <p className="muted-text">The modifier can change only one approved workflow setting. The challenger requires priced cost and no quality regression before accepting it.</p>
          <div className="opt-controls"><label>Baseline experiment<select value={baselineExperimentId} onChange={e => setBaselineExperimentId(e.target.value)}><option value="">Choose a completed baseline</option>{experiments.filter(item => item.status === 'completed' && item.candidateId === 'baseline' && item.runIds.length >= 2).map(item => <option key={item.id} value={item.id}>{item.id.slice(0, 8)} · {item.runIds.length} runs</option>)}</select></label><button className="primary" disabled={!baselineExperimentId || optimizationBusy || mode === 'live' && (!liveReadiness?.ready || liveReadiness.budget.blocked)} onClick={startOptimization}>{optimizationBusy ? 'Proposing…' : 'Propose candidate'} <span aria-hidden="true">↗</span></button></div>
          {optimizations.length === 0 && <div className="proposal-empty"><span>1</span><p>One considered change.<small>A completed baseline unlocks the first proposal. No performance claim until the evidence supports it.</small></p></div>}
          {optimizations.map(item => <div className="optimization" key={item.id}><div className="experiment-head"><strong>{item.candidateId}</strong><span>{item.status} · {item.decision}</span><button onClick={() => setSelectedOptimizationId(item.id)} aria-pressed={selectedOptimizationId === item.id}>View comparison</button></div>
            <div className="opt-stages"><div><span>INVESTIGATOR</span><p>{item.investigation}</p></div><div><span>MODIFIER</span><p>{item.proposal}</p><code>{JSON.stringify(item.settings)}</code></div><div><span>CHALLENGER</span><p>{item.challenge}</p></div></div>
            {item.error && <p className="error">{item.error}</p>}
          </div>)}
        </section>
        <section className="panel quality-panel" id="evidence"><div className="quality-heading"><div><div className="section-label">EVALUATION LEDGER</div><h2>Quality evidence</h2></div><span className="evidence-tag">DETERMINISTIC CHECKS ≠ VERIFIED TRUTH</span></div>
          <div className="metrics evidence-metrics"><div><span>Live sample</span><strong>{report?.sampleSize ?? '—'}</strong><small>Fixture runs excluded</small></div><div><span>Passed checks</span><strong>{report?.correct ?? '—'}</strong><small>Not semantic verification</small></div><div><span>Cost / passing task</span><strong>{report?.costPerCorrectUsd == null ? 'Unknown' : `$${report.costPerCorrectUsd.toFixed(4)}`}</strong><small>Requires provider cost evidence</small></div></div>
          <p className="muted-text">{report?.uncertainty ?? 'No report yet.'}</p>
          {report && <p className="muted-text">{report.labelNote}</p>}
          {report?.evaluations.map(item => <div className="eval-row" key={item.taskId}><strong>{item.taskId}</strong><span>{item.fixture ? 'Fixture · excluded' : item.correct ? 'Passed checks' : 'Failed checks'}</span><small>Answer terms {item.deterministic.answerTermsPresent ? '✓' : '×'} · Approved source {item.deterministic.approvedSourcePresent ? '✓' : '×'} · Citations {item.deterministic.citationsResolve ? '✓' : '×'}</small></div>)}
        </section>
        <section className="panel comparison-panel" id="comparison"><div className="section-label"><span>DECISION RECORD / EXPORT</span><span>{comparison ? comparison.decision.replaceAll('-', ' ') : 'AWAITING A CANDIDATE'}</span></div><h2>Baseline vs candidate</h2>
        {!comparison && <div className="comparison-placeholder"><div><span>A / BASELINE</span><strong>The reference.</strong><small>Keep the original run and configuration.</small></div><span className="versus" aria-hidden="true">↔</span><div><span>B / CANDIDATE</span><strong>The hypothesis.</strong><small>Complete a trial and propose a change to compare.</small></div></div>}
        {comparison && <>
          <p className="muted-text">Selected candidate: {optimizations.find(item => item.id === comparison.id)?.candidateId ?? comparison.id}. {comparison.decision === 'accepted' ? 'Accepted by the challenger.' : 'Unvalidated candidate export; no measured improvement has been established.'}</p>
          {holdout ? <p className="muted-text">Final holdout: {holdout.correct}/{holdout.sampleSize} passed deterministic checks. {holdout.note}</p> : comparison.mode === 'fixture' && comparison.status === 'completed' ? <button onClick={() => runHoldout(comparison.id)} disabled={holdoutBusy}>{holdoutBusy ? 'Assessing holdout…' : 'Run final fixture holdout'}</button> : <p className="muted-text">Final holdout has not been assessed.</p>}
          <div className="comparison-summary"><div><span>A / BASELINE</span><strong>{comparison.baseline.correct}/{comparison.baseline.total} passed checks</strong><small>{comparison.baseline.durationMs ?? '—'} ms · {comparison.baseline.costPerCorrectUsd === null ? 'Cost unknown' : `$${comparison.baseline.costPerCorrectUsd.toFixed(4)}/passing task`}</small></div><div><span>B / CANDIDATE</span><strong>{comparison.candidate.correct}/{comparison.candidate.total} passed checks</strong><small>{comparison.candidate.durationMs ?? '—'} ms · {comparison.candidate.costPerCorrectUsd === null ? 'Cost unknown' : `$${comparison.candidate.costPerCorrectUsd.toFixed(4)}/passing task`}</small></div><div><span>DECISION</span><strong>{comparison.decision}</strong><small>{comparison.baseline.failures + comparison.candidate.failures} failed attempt(s)</small></div></div>
          <p className="muted-text">{comparison.uncertainty} {comparison.costNote} Experiment cost: {comparison.experimentCostUsd === null ? 'unknown' : `$${comparison.experimentCostUsd.toFixed(4)}`}. Break-even: {comparison.breakEvenTasks === null ? 'not calculable' : `${comparison.breakEvenTasks} tasks`}.</p>
          <div className="comparison-rows">{comparison.rows.map(row => <div className={`comparison-row ${row.regression ? 'regression' : ''}`} key={row.taskId}><strong>{row.taskId}{row.regression ? ' · regression' : ''}</strong><div><span>Baseline: {row.baseline.status} · {row.baseline.correct ? 'passed' : 'failed checks'} · {row.baseline.attempts} attempt(s) · {row.baseline.errors} error(s) · {row.baseline.durationMs ?? '—'} ms · {row.baseline.costUsd === null ? 'cost unknown' : `$${row.baseline.costUsd.toFixed(4)}`}</span><span>Candidate: {row.candidate.status} · {row.candidate.correct ? 'passed' : 'failed checks'} · {row.candidate.attempts} attempt(s) · {row.candidate.errors} error(s) · {row.candidate.durationMs ?? '—'} ms · {row.candidate.costUsd === null ? 'cost unknown' : `$${row.candidate.costUsd.toFixed(4)}`}</span></div><div className="source-links">{row.baseline.sources.map(source => <a key={`baseline-${source.url}`} href={source.url} target="_blank" rel="noreferrer">Baseline: {source.title} ↗</a>)}{row.candidate.sources.map(source => <a key={`candidate-${source.url}`} href={source.url} target="_blank" rel="noreferrer">Candidate: {source.title} ↗</a>)}</div></div>)}</div>
          <div className="export-actions"><a href={`/api/optimizations/${comparison.id}/export?format=candidate`}>Candidate config</a><a href={`/api/optimizations/${comparison.id}/export?format=original`}>Original config</a><a href={`/api/optimizations/${comparison.id}/export?format=patch`}>Patch</a><a href={`/api/optimizations/${comparison.id}/export?format=manifest`}>Reproducibility data</a></div>
        </>}
        </section>
        <footer className="desk-footer"><strong>ablatrix</strong><span>Changes are hypotheses. Runs are evidence.</span><a href="#top">Back to the desk ↑</a></footer>
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
