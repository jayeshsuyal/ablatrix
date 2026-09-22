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

function App() {
  const [mode, setMode] = useState<'fixture' | 'live'>('fixture');
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entity, setEntity] = useState('Example Company');
  const [question, setQuestion] = useState('What products does this company make?');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([fetch('/api/health').then(r => r.json()), fetch('/api/runs').then(r => r.json())])
      .then(([health, list]) => { setMode(health.mode); setRuns(list.runs); setSelected(list.runs[0]?.id ?? null); })
      .catch(() => setError('Could not connect to the Ablatrix backend.'));
  }, []);
  const current = runs.find(run => run.id === selected);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entity, question })
      });
      const run = await response.json() as Run;
      if (!run.id) throw new Error('The backend did not return a run.');
      setRuns(previous => [run, ...previous]); setSelected(run.id);
      if (!response.ok) setError(run.error ?? 'Research failed.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Request failed.'); }
    finally { setBusy(false); }
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
            <label>Company or product<input value={entity} onChange={e => setEntity(e.target.value)} minLength={2} maxLength={120} required /></label>
            <label>Research question<textarea value={question} onChange={e => setQuestion(e.target.value)} minLength={8} maxLength={500} rows={3} required /></label>
            <button className="primary" disabled={busy}>{busy ? 'Running research…' : 'Run baseline'} <span aria-hidden="true">↗</span></button>
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
      </div>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
