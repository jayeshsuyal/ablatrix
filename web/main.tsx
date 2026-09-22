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
type Report = { sampleSize: number; correct: number; qualityRate: number | null; costPerCorrectUsd: number | null; uncertainty: string; evaluations: { taskId: string; split: string; correct: boolean; fixture: boolean; deterministic: { answerTermsPresent: boolean; approvedSourcePresent: boolean; citationsResolve: boolean } }[] };
type Experiment = { id: string; status: string; taskIds: string[]; runIds: string[]; steps: { at: string; message: string }[]; error: string | null; maxAttempts: number; maxDurationMs: number; cancelRequested: boolean };

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
  const [experimentBusy, setExperimentBusy] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [maxDurationMs, setMaxDurationMs] = useState(30_000);
  const [maxSpendUsd, setMaxSpendUsd] = useState(1);
  const [fixtureDelayMs, setFixtureDelayMs] = useState(0);
  useEffect(() => {
    Promise.all([fetch('/api/health').then(r => r.json()), fetch('/api/runs').then(r => r.json()), fetch('/api/tasks').then(r => r.json()), fetch('/api/report').then(r => r.json()), fetch('/api/experiments').then(r => r.json())])
      .then(([health, list, suite, summary, jobs]) => { setMode(health.mode); setRuns(list.runs); setSelected(list.runs[0]?.id ?? null); setTasks([...suite.development, ...suite.validation]); setReport(summary); setExperiments(jobs.experiments); })
      .catch(() => setError('Could not connect to the Ablatrix backend.'));
  }, []);
  useEffect(() => {
    if (!experiments.some(item => item.status === 'queued' || item.status === 'running')) return;
    const timer = window.setInterval(() => {
      Promise.all([fetch('/api/experiments').then(r => r.json()), fetch('/api/runs').then(r => r.json()), fetch('/api/report').then(r => r.json())])
        .then(([jobs, list, summary]) => { setExperiments(jobs.experiments); setRuns(list.runs); setReport(summary); })
        .catch(() => setError('Could not refresh experiment progress.'));
    }, 500);
    return () => window.clearInterval(timer);
  }, [experiments]);
  const current = runs.find(run => run.id === selected);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entity, question, ...(taskId ? { taskId } : {}) })
      });
      const run = await response.json() as Run;
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
        {mode === 'fixture' && <div className="notice"><strong>Synthetic demonstration</strong><span>Fixture responses are for testing the workflow. They are not live research or benchmark evidence.</span></div>}
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
          {report?.evaluations.map(item => <div className="eval-row" key={item.taskId}><strong>{item.taskId}</strong><span>{item.fixture ? 'Fixture · excluded' : item.correct ? 'Passed checks' : 'Failed checks'}</span><small>Answer terms {item.deterministic.answerTermsPresent ? '✓' : '×'} · Approved source {item.deterministic.approvedSourcePresent ? '✓' : '×'} · Citations {item.deterministic.citationsResolve ? '✓' : '×'}</small></div>)}
        </section>
        <section className="panel quality-panel"><div className="section-label">04 / EXPERIMENT RUNNER</div><h2>Bounded comparison run</h2>
          <p className="muted-text">Runs the development and validation tasks serially. Cancellation stops future tasks.</p>
          <div className="runner-settings"><label>Attempts per task<select value={maxAttempts} onChange={e => setMaxAttempts(Number(e.target.value))}><option value={1}>1</option><option value={2}>2</option></select></label><label>Time limit<select value={maxDurationMs} onChange={e => setMaxDurationMs(Number(e.target.value))}><option value={30000}>30 seconds</option><option value={60000}>60 seconds</option></select></label>
            {mode === 'live' ? <label>Spend cap (USD)<input type="number" min="0.01" max="100" step="0.01" value={maxSpendUsd} onChange={e => setMaxSpendUsd(Number(e.target.value))} /></label> : <label>Fixture pacing<select value={fixtureDelayMs} onChange={e => setFixtureDelayMs(Number(e.target.value))}><option value={0}>Immediate</option><option value={2000}>2 seconds per task</option></select></label>}</div>
          <button className="primary experiment-start" onClick={startExperiment} disabled={experimentBusy || tasks.length === 0}>{experimentBusy ? 'Queuing…' : 'Run experiment'} <span aria-hidden="true">↗</span></button>
          {experiments.length === 0 && <p className="muted-text">No experiments yet.</p>}
          {experiments.map(item => <div className="experiment" key={item.id}>
            <div className="experiment-head"><strong>{item.status}</strong><span>{item.runIds.length}/{item.taskIds.length} tasks</span>{(item.status === 'queued' || item.status === 'running') && <button onClick={() => cancelExperiment(item.id)}>Cancel</button>}</div>
            {item.error && <p className="error">{item.error}</p>}
            <ol>{item.steps.map((step, index) => <li key={index}>{step.message}</li>)}</ol>
          </div>)}
        </section>
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
