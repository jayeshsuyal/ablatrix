import React, { useEffect, useState } from 'react';
import type { PilotMetrics, PilotOverview, PilotPublicRun, PilotReviewCard } from '../server/pilot-types.ts';
import './pilot.css';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'The request could not be completed.');
  return value as T;
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const money = (value: number | null) => value === null ? 'Unmeasured' : `$${value.toFixed(4)}`;
const duration = (value: number | null) => value === null ? 'Unmeasured' : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
const dateLabel = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Arrow({ down = false }: { down?: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={down ? 'pilot-arrow-down' : undefined}><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Workflow({ candidate }: { candidate?: boolean }) {
  return <div className={`pilot-workflow ${candidate ? 'pilot-workflow-candidate' : ''}`}>
    <div className="pilot-workflow-heading"><span className="pilot-arm-label">{candidate ? 'B' : 'A'}</span><div><h3>{candidate ? 'Candidate' : 'Baseline'}</h3><p>{candidate ? 'Use the evidence already in hand' : 'Look for more evidence'}</p></div><span className="pilot-workflow-tag">{candidate ? 'Search removed' : 'Current workflow'}</span></div>
    <div className="pilot-flow"><span className="pilot-flow-step"><span className="pilot-step-icon">▤</span>Checked excerpt</span><Arrow />{!candidate && <><span className="pilot-flow-step pilot-search"><span className="pilot-step-icon">⌕</span>Web search</span><Arrow /></>}<span className="pilot-flow-step pilot-model"><span className="pilot-step-icon">✧</span>gpt-luna</span><Arrow /><span className="pilot-flow-output">Answer</span></div>
    <p className="pilot-workflow-foot">{candidate ? 'Same question. Same source excerpt. Same model request.' : 'One search is added before the model answers.'}</p>
  </div>;
}

function SideResult({ metrics, reviewed, synthetic }: { metrics: PilotMetrics; reviewed: boolean; synthetic: boolean }) {
  return <div className="pilot-side-result"><strong>{reviewed ? `${metrics.supportedCorrect}/${metrics.completed + metrics.failed} supported & correct` : 'Awaiting review'}</strong><span>{synthetic ? 'Timing and cost unmeasured' : `${duration(metrics.medianMs)} · ${money(metrics.costUsd)}`}</span><small>{synthetic ? 'Simulated calls · ' : ''}{metrics.searchCalls ?? 'Unknown'} search {metrics.searchCalls === 1 ? 'call' : 'calls'} · {metrics.modelCalls ?? 'unknown'} model {metrics.modelCalls === 1 ? 'call' : 'calls'}{metrics.failed > 0 ? ` · ${metrics.failed} failed` : ''}</small></div>;
}

function BlindReview({ run, onChange, onError }: { run: PilotPublicRun; onChange: (run: PilotPublicRun) => void; onError: (message: string) => void }) {
  const [cards, setCards] = useState<PilotReviewCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [referenceCorrect, setReferenceCorrect] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const card = cards.find(item => !item.review);
  useEffect(() => {
    let active = true;
    request<{ cards: PilotReviewCard[] }>(`/api/pilot/runs/${run.id}/review`).then(value => { if (active) setCards(value.cards); }).catch(reason => { if (active) onError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [run.id]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!card || correct === null || supported === null) return;
    setSaving(true);
    try {
      const updated = await request<PilotPublicRun>(`/api/pilot/runs/${run.id}/review`, post({ cardId: card.id, correct, supported, referenceCorrect, notes }));
      const next = await request<{ cards: PilotReviewCard[] }>(`/api/pilot/runs/${run.id}/review`);
      setCards(next.cards); setCorrect(null); setSupported(null); setReferenceCorrect(false); setNotes(''); onChange(updated);
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Could not save the review.'); }
    finally { setSaving(false); }
  }

  return <section className="pilot-panel pilot-review" aria-labelledby="pilot-review-title">
    <div className="pilot-section-heading"><div><div className="pilot-kicker">REVIEW / ANSWER QUALITY</div><h2 id="pilot-review-title">Judge the answer before the workflow.</h2></div><span className="pilot-neutral-pill">{run.reviewCount}/{run.reviewsNeeded} reviewed</span></div>
    <p className="pilot-secondary">Answers are shuffled and the workflow is hidden. Check both accuracy and support before the comparison is revealed.</p>
    {loading ? <p role="status" className="pilot-secondary">Loading answers for review…</p> : card ? <>
      <div className="pilot-review-question"><span className="pilot-kicker">QUESTION</span><h3>{card.question}</h3></div>
      <div className="pilot-review-grid"><div className="pilot-review-answer"><span className="pilot-kicker">ANONYMOUS ANSWER</span><p>{card.answer.answer}</p>{card.answer.citations.map((citation, index) => <blockquote key={`${citation.url}-${index}`}><p>“{citation.quote}”</p><a href={citation.url} target="_blank" rel="noreferrer">Cited source ↗</a></blockquote>)}</div><div className="pilot-review-evidence"><span className="pilot-kicker">CHECKED SOURCE</span><a href={card.source.url} target="_blank" rel="noreferrer">{card.source.title} ↗</a><p>{card.source.text}</p><details><summary>Expected answer and required facts</summary><p>{card.expectedAnswer}</p><ul>{card.requiredFacts.map(fact => <li key={fact}>{fact}</li>)}</ul></details></div></div>
      <form onSubmit={save} className="pilot-review-form"><fieldset><legend>Is the answer correct?</legend><div>{[true, false].map(value => <label key={String(value)}><input type="radio" name="correct" checked={correct === value} onChange={() => setCorrect(value)} />{value ? 'Yes' : 'No'}</label>)}</div></fieldset><fieldset><legend>Does the cited evidence support it?</legend><div>{[true, false].map(value => <label key={String(value)}><input type="radio" name="supported" checked={supported === value} onChange={() => setSupported(value)} />{value ? 'Yes' : 'No'}</label>)}</div></fieldset><label className="pilot-reference-check"><input type="checkbox" checked={referenceCorrect} onChange={event => setReferenceCorrect(event.target.checked)} />I checked the reference answer against the excerpt</label><label className="pilot-review-notes">Notes <span>Optional</span><textarea rows={2} maxLength={1500} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Any missing facts or unsupported claims…" /></label><button className="pilot-primary" disabled={correct === null || supported === null || saving}>{saving ? 'Saving review…' : 'Save & review next'}<Arrow /></button></form>
    </> : <p className="pilot-secondary">All available answers have been reviewed.</p>}
  </section>;
}

export default function Pilot() {
  const [overview, setOverview] = useState<PilotOverview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const run = overview?.runs.find(item => item.id === selectedId) ?? overview?.runs[0] ?? null;
  const activeRun = overview?.runs.find(item => item.status === 'running');
  const synthetic = run?.mode === 'fixture';
  const protocol = overview?.protocol;

  function updateRun(updated: PilotPublicRun) {
    setOverview(previous => previous ? { ...previous, runs: previous.runs.some(item => item.id === updated.id) ? previous.runs.map(item => item.id === updated.id ? updated : item) : [updated, ...previous.runs] } : previous);
  }

  useEffect(() => {
    let active = true;
    request<PilotOverview>('/api/pilot').then(value => { if (active) { setOverview(value); setSelectedId(value.runs[0]?.id ?? null); } }).catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!activeRun) return;
    let active = true;
    const timer = window.setInterval(() => { request<PilotOverview>('/api/pilot').then(value => { if (active) setOverview(value); }).catch(reason => { if (active) setError(reason.message); }); }, 500);
    return () => { active = false; window.clearInterval(timer); };
  }, [activeRun?.id]);

  async function start(mode: 'fixture' | 'live') {
    setBusy(true); setError('');
    try {
      const created = await request<PilotPublicRun>('/api/pilot/runs', post({ mode }));
      updateRun(created); setSelectedId(created.id);
      setOverview(await request<PilotOverview>('/api/pilot'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start the experiment.'); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!activeRun) return;
    setCancelling(true); setError('');
    try { updateRun(await request<PilotPublicRun>(`/api/pilot/runs/${activeRun.id}/cancel`, post())); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not cancel the experiment.'); }
    finally { setCancelling(false); }
  }

  const quality = (metrics: PilotMetrics | undefined) => !run || !run.reviewComplete ? 'Awaiting review' : `${metrics?.supportedCorrect ?? 0}/${(metrics?.completed ?? 0) + (metrics?.failed ?? 0)}`;
  const statusLabel = run ? run.status === 'running' ? 'Experiment in progress' : synthetic ? 'Synthetic demo' : run.decision === 'accepted' ? 'Candidate accepted' : run.decision === 'rejected' ? 'Candidate rejected' : 'Inconclusive' : 'Awaiting evidence';

  return <div className="pilot-app">
    <nav className="pilot-nav" aria-label="Main navigation"><a className="pilot-brand" href="/pilot"><span className="pilot-logo" aria-hidden="true">A</span>ablatrix<span className="pilot-brand-divider" /><span className="pilot-nav-context">Experiment lab</span></a><div className="pilot-nav-right"><a href="/loop">Feedback loop ↗</a><a href="/">Research workspace <span aria-hidden="true">↗</span></a><span className="pilot-local"><i />LOCAL PILOT</span></div></nav>
    <main className="pilot-main">
      <div className="pilot-hero"><div><div className="pilot-kicker"><span className="pilot-small-line" />ONE CHANGE. A FAIR COMPARISON.</div><h1>Does the extra search<br />earn its keep<span className="pilot-green">?</span></h1><p className="pilot-lede">A research answer already has a checked source excerpt.<br className="pilot-desktop-break" /> Test whether another web search improves the answer enough to keep.</p><div className="pilot-hero-tags"><span><i />Same model request</span><span>Same questions</span><span>One step removed</span></div></div><div className="pilot-hypothesis"><span className="pilot-kicker">THE HYPOTHESIS</span><div className="pilot-hypothesis-symbol" aria-hidden="true"><span>−</span>1</div><h2>One less search.<br />Just as good an answer.</h2><p>Keep the change only if quality holds<br />and measured latency improves.</p></div></div>

      {loading && <div className="pilot-banner" role="status">Loading the experiment and saved reports…</div>}
      {error && <div className="pilot-alert" role="alert"><strong>Something needs attention</strong><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}

      <div className="pilot-setup-grid"><section className="pilot-panel pilot-design" aria-labelledby="pilot-design-title"><div className="pilot-section-heading"><div><div className="pilot-kicker">01 / THE CHANGE</div><h2 id="pilot-design-title">Remove the extra search.</h2></div><span className="pilot-neutral-pill">Requested model · gpt-luna</span></div><Workflow /><Workflow candidate /><div className="pilot-scope-note"><span aria-hidden="true">ⓘ</span><p>Both workflows start with the same saved excerpt. Source collection happens beforehand and is excluded from the comparison.</p></div></section>

      <aside className="pilot-panel pilot-launch" aria-labelledby="pilot-launch-title"><div className="pilot-kicker">02 / THE EXPERIMENT</div><h2 id="pilot-launch-title">Small. Paired. Repeatable.</h2><div className="pilot-protocol-grid"><div><strong>{protocol?.developmentQuestions ?? 4}</strong><span>development questions</span></div><div><strong>{protocol?.evaluationQuestions ?? 8}</strong><span>evaluation questions</span></div><div><strong>{protocol?.repetitions ?? 2}</strong><span>repeats per workflow</span></div><div><strong>{protocol?.measuredRuns ?? 32}</strong><span>measured runs</span></div></div><p className="pilot-launch-note">Development questions are kept outside the measured evaluation.</p><button className="pilot-primary pilot-launch-button" onClick={() => start('fixture')} disabled={busy || !!activeRun || loading || !overview}>{busy ? 'Starting…' : 'Run local demo'}<Arrow /></button><p className="pilot-demo-disclosure"><span>SYNTHETIC DEMO</span>Example answers and reviews. No provider spend or measured savings.</p><div className="pilot-live"><button className="pilot-secondary-button" onClick={() => start('live')} disabled={busy || !!activeRun || !overview?.readiness.ready} aria-describedby="pilot-live-reason">Run live experiment<Arrow /></button><p id="pilot-live-reason">{overview?.readiness.reason ?? 'Checking live experiment availability…'}</p></div><details className="pilot-protocol-details"><summary>What earns a recommendation?<span>+</span></summary><p>All answers supported and correct in both workflows, no quality regressions, and at least {protocol?.latencyTargetPercent ?? 20}% lower median paired latency, backed by complete live results and blind review.</p><p>Model: gpt-luna · 2 repetitions per question and workflow. Live spend cap: ${protocol?.spendCapUsd ?? 10}.</p></details></aside></div>

      {activeRun && <section className="pilot-progress-panel" aria-label="Experiment progress"><div className="pilot-progress-top"><div><span className="pilot-running-dot" /><strong>{activeRun.mode === 'fixture' ? 'Running the synthetic demo' : 'Running the live experiment'}</strong><span>{activeRun.completedRuns} of {activeRun.plannedRuns} runs complete</span></div><button className="pilot-secondary-button" onClick={cancel} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Cancel run'}</button></div><progress value={activeRun.completedRuns} max={activeRun.plannedRuns}>{activeRun.completedRuns}/{activeRun.plannedRuns}</progress><p>Progress is saved locally. Cancellation stops the remaining runs.</p></section>}

      {run && run.mode === 'live' && run.status !== 'running' && !run.reviewComplete && <BlindReview key={run.id} run={run} onChange={updateRun} onError={setError} />}

      <section className="pilot-panel pilot-results" aria-labelledby="pilot-results-title"><div className="pilot-section-heading"><div><div className="pilot-kicker">03 / THE EVIDENCE</div><h2 id="pilot-results-title">Baseline vs. candidate</h2></div><div className="pilot-report-actions">{overview && overview.runs.length > 1 && <label className="pilot-sr-only" htmlFor="pilot-report-select">Saved report</label>}{overview && overview.runs.length > 1 && <select id="pilot-report-select" value={run?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>{overview.runs.map(item => <option key={item.id} value={item.id}>{item.mode === 'fixture' ? 'Demo' : 'Live'} · {dateLabel(item.createdAt)} · {item.status}</option>)}</select>}{run?.exportReady && <a className="pilot-export" href={`/api/pilot/runs/${run.id}/export`}>Export report <Arrow down /></a>}</div></div>
      {!run ? <div className="pilot-empty"><div className="pilot-empty-bars" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div><h3>The result is still an open question.</h3><p>Run the local demo to explore the comparison.<br />A live experiment is needed to establish quality, time, or cost savings.</p><span className="pilot-neutral-pill">No evidence collected yet</span></div> : <>
        <div className={`pilot-verdict ${synthetic ? 'pilot-verdict-demo' : run.decision === 'accepted' ? 'pilot-verdict-accepted' : ''}`}><span className="pilot-verdict-icon" aria-hidden="true">{synthetic ? '◇' : run.decision === 'accepted' ? '✓' : '○'}</span><div><strong>{statusLabel}</strong><p>{run.reason}</p>{synthetic && <p>Answers and quality checks are simulated. This report does not establish a quality improvement or savings.</p>}</div><span className="pilot-status-pill">{run.status}</span></div>
        {run.error && <p className="pilot-alert" role="alert">{run.error}</p>}
        <div className="pilot-scorecard"><div className="pilot-scorecard-cell pilot-scorecard-head"><span>RESULT</span><strong>{synthetic ? 'Demo only' : run.reviewComplete ? 'Reviewed evidence' : 'Review pending'}</strong><small>{run.completedRuns}/{run.plannedRuns} runs complete</small></div><div className="pilot-scorecard-cell"><span>SUPPORTED & CORRECT</span><div><span>A <strong>{quality(run.baseline)}</strong></span><span>B <strong>{quality(run.candidate)}</strong></span></div><small>{synthetic ? 'Simulated review' : `${run.reviewCount}/${run.reviewsNeeded} blind reviews`}</small></div><div className="pilot-scorecard-cell"><span>MEDIAN ANSWER TIME</span><div><span>A <strong>{duration(run.baseline.medianMs)}</strong></span><span>B <strong>{duration(run.candidate.medianMs)}</strong></span></div><small>{synthetic || run.medianPairedReductionPercent === null ? 'No measured latency reduction' : `${run.medianPairedReductionPercent.toFixed(1)}% median paired reduction`}</small></div><div className="pilot-scorecard-cell"><span>PROVIDER COST</span><div><span>A <strong>{money(run.baseline.costUsd)}</strong></span><span>B <strong>{money(run.candidate.costUsd)}</strong></span></div><small>{synthetic ? 'No provider calls made' : 'Source collection excluded'}</small></div></div>
        {run.rows.length > 0 ? <div className="pilot-table-wrap"><table className="pilot-comparison-table"><thead><tr><th scope="col">Evaluation question</th><th scope="col"><span className="pilot-table-arm">A</span> Baseline</th><th scope="col"><span className="pilot-table-arm pilot-table-arm-b">B</span> Candidate</th><th scope="col">Quality check</th></tr></thead><tbody>{run.rows.map((row, index) => <tr key={row.taskId}><th scope="row"><div className="pilot-question-title"><span>{String(index + 1).padStart(2, '0')}</span><strong>{row.question}</strong></div><div className="pilot-row-sources">{row.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}</div></th><td data-label="A · Baseline"><SideResult metrics={row.baseline} reviewed={run.reviewComplete} synthetic={!!synthetic} /></td><td data-label="B · Candidate"><SideResult metrics={row.candidate} reviewed={run.reviewComplete} synthetic={!!synthetic} /></td><td data-label="Quality check"><span className={`pilot-quality-status ${row.regression ? 'pilot-quality-regression' : ''}`}>{row.regression ? 'Regression' : synthetic ? 'Simulated pass' : 'No regression'}</span></td></tr>)}</tbody></table></div> : <div className="pilot-results-pending"><span aria-hidden="true">◌</span><p>{run.status === 'running' ? 'The comparison will appear after the experiment finishes.' : !run.reviewComplete ? 'Complete the blind review to reveal the workflow comparison.' : 'No completed evaluation pairs are available.'}</p></div>}
        <div className="pilot-report-footer"><span>Saved locally · {dateLabel(run.updatedAt)}</span><span>{synthetic ? 'Synthetic data · no benchmark claim' : 'Small evaluation · results apply to this question set'}</span></div>
      </>}
      </section>
      <footer className="pilot-footer"><span>ablatrix <span>/</span> Question the workflow.</span><span>Research pilot · gpt-luna</span></footer>
    </main>
  </div>;
}
