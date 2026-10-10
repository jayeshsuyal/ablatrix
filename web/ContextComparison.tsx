import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextComparisonDetail, ContextComparisonReport, ContextComparisonSummary } from '../server/context-comparison.ts';
import './context-comparison.css';
import { useDemoSession } from './DemoSession';

type ComparisonCase = ContextComparisonDetail['cases'][number];
type BlindAnswer = ComparisonCase['answers'][number];
type SavedReview = NonNullable<BlindAnswer['review']>;
const words = (value: string) => value.replaceAll('_', ' ');
async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'The comparison request could not be completed.');
  return value as T;
}

function AnswerJudgment({ comparison, item, answer, checked, reviewer, refresh }: {
  comparison: ContextComparisonDetail; item: ComparisonCase; answer: BlindAnswer; checked: string[]; reviewer: string; refresh: () => Promise<void>;
}) {
  const session = useDemoSession();
  const canReview = !session.hosted || session.actor?.role !== 'viewer';
  const [correctness, setCorrectness] = useState<'' | SavedReview['correctness']>('');
  const [support, setSupport] = useState<'' | SavedReview['support']>('');
  const [adequacy, setAdequacy] = useState<'' | SavedReview['adequacy']>('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [savedHere, setSavedHere] = useState<SavedReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saved = answer.review ?? savedHere;
  const synthetic = comparison.mode === 'fixture';
  const negative = correctness !== 'correct' || support !== 'supported' || adequacy !== 'adequate';
  const citedSources = item.sources.filter(source => answer.answer?.citations.some(citation => citation.passageId === source.id));
  const sourcesChecked = checked.length > 0 && citedSources.every(source => checked.includes(source.sha256));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const review = await request<SavedReview>(`/api/context-comparisons/${encodeURIComponent(comparison.id)}/reviews`, {
        manifestSha256: comparison.manifestSha256, caseId: item.id, versionId: answer.versionId,
        reviewer, correctness, support, adequacy, checkedSourceShas: checked, note, referenceChecked: confirmed, ...(!synthetic ? { independentReview: confirmed } : {})
      });
      setSavedHere(review);
      try { await refresh(); } catch { setError('Review saved. Reload the comparison to refresh its results.'); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this review.'); }
    finally { setBusy(false); }
  }
  if (answer.status !== 'completed' || !answer.answer) return null;
  if (saved) return <section className="cc-saved" aria-label={`Saved answer ${answer.label} review`}><h3>Answer {answer.label} · {saved.kind === 'synthetic' ? 'Synthetic review saved' : 'Human review saved'}</h3><p>{words(saved.correctness)} · {words(saved.support)} · {words(saved.adequacy)}</p>{saved.note && <p>{saved.note}</p>}<small>{saved.reviewer} · {new Date(saved.createdAt).toLocaleString()}</small>{error && <p className="cc-error" role="alert">{error}</p>}</section>;
  return <form className="cc-form" aria-label={`Review answer ${answer.label}`} onSubmit={submit}><fieldset disabled={!canReview}><legend>Answer {answer.label} assessment</legend><div className="cc-axis-grid">
    <label className="cc-field">Answer {answer.label} correctness<select value={correctness} onChange={event => setCorrectness(event.target.value as typeof correctness)}><option value="">Choose a verdict</option><option value="correct">Correct</option><option value="incorrect">Incorrect</option><option value="uncertain">Uncertain</option></select></label>
    <label className="cc-field">Answer {answer.label} claim support<select value={support} onChange={event => setSupport(event.target.value as typeof support)}><option value="">Choose a verdict</option><option value="supported" disabled={!answer.citationCheck || answer.citationCheck.matching !== answer.citationCheck.total || !answer.citationCheck.answeredHasCitation}>Supported</option><option value="unsupported">Unsupported</option><option value="uncertain">Uncertain</option></select></label>
    <label className="cc-field">Answer {answer.label} adequacy<select value={adequacy} onChange={event => setAdequacy(event.target.value as typeof adequacy)}><option value="">Choose a verdict</option><option value="adequate">Adequate</option><option value="inadequate">Inadequate</option><option value="uncertain">Uncertain</option></select></label>
  </div><label className="cc-field">Answer {answer.label} review note<textarea rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="Explain any error, missing answer, or uncertainty. At least 10 characters for a nonpositive verdict." /></label>
    <label className="cc-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{synthetic ? `I checked the selected sources for synthetic answer ${answer.label}. This is a practice judgment.` : `I personally checked the selected sources for answer ${answer.label} without AI review suggestions.`}</label>
    {!sourcesChecked && <p className="cc-muted">Check at least one source and every source cited by answer {answer.label} before saving.</p>}
    {error && <p className="cc-error" role="alert">{error}</p>}
    <button className="cc-primary" disabled={busy || !correctness || !support || !adequacy || !sourcesChecked || !confirmed || reviewer.trim().length < 2 || (negative && note.trim().length < 10)}>{busy ? 'Saving…' : synthetic ? `Save synthetic review for ${answer.label}` : `Save human review for ${answer.label}`}</button>
  </fieldset></form>;
}

function PairReview({ comparison, item, refresh }: { comparison: ContextComparisonDetail; item: ComparisonCase; refresh: () => Promise<void> }) {
  const session = useDemoSession();
  const [checked, setChecked] = useState<string[]>([]);
  const [reviewer, setReviewer] = useState(session.actor?.reviewer ?? '');
  const reviewable = item.answers.some(answer => answer.status === 'completed' && !answer.review);
  return <div className="cc-detail"><section className="cc-card cc-question"><span className="cc-kicker">FROZEN QUESTION · {item.id}</span><h2>{item.question}</h2><p>{item.product.title}</p><div className="cc-answers">{item.answers.map(answer => <article className="cc-answer" key={answer.versionId} aria-label={`Blind answer ${answer.label}`}><h3>Answer {answer.label}</h3>
    {answer.status === 'completed' && answer.answer ? <><p>{answer.answer.answer}</p><small>{words(answer.answer.status)}</small>{answer.answer.citations.map((citation, index) => { const sourceIndex = item.sources.findIndex(source => source.id === citation.passageId); return sourceIndex >= 0 ? <a className="cc-citation" key={index} href={`#cc-source-${sourceIndex}`}>{item.sources[sourceIndex].label}: “{citation.quote}”</a> : <p className="cc-muted" key={index}>Unresolved citation: “{citation.quote}”</p>; })}
      <small>{answer.citationCheck ? `${answer.citationCheck.matching}/${answer.citationCheck.total} citation quotes match saved sources${answer.citationCheck.answeredHasCitation ? '' : ' · answered response lacks a citation'}.` : 'Citation matching unavailable.'}</small></> : <><p>{answer.status === 'uncertain' ? 'The attempt outcome is uncertain.' : 'The attempt failed.'}</p><small>No completed answer to review. This attempt cannot count as a tie or a quality win.</small></>}
  </article>)}</div><p className="cc-muted">A matching quotation checks source membership. It does not establish answer correctness, claim support, or adequacy. Arm identities stay hidden until the review packet is complete.</p></section>
    <section className="cc-card" aria-label="Frozen source context"><h3>Read the full source context</h3><p className="cc-muted">Judge both answers against the same saved question and sources. A customer question provides context; it does not establish a product fact.</p>{item.sources.map((source, index) => <article className="cc-source" id={`cc-source-${index}`} key={source.id}><h4>{index + 1}. {source.label}</h4>{source.originalQuestion && <p className="cc-original-question"><strong>Original customer question:</strong> {source.originalQuestion}</p>}<p>{source.text}</p>{source.reference && <p className="cc-muted">Reference: {source.reference}</p>}{reviewable && <label className="cc-check"><input type="checkbox" checked={checked.includes(source.sha256)} onChange={event => setChecked(current => event.target.checked ? [...new Set([...current, source.sha256])] : current.filter(sha => sha !== source.sha256))} />Checked source: {source.label}</label>}</article>)}</section>
    <section className="cc-card" aria-label="Source checked assessments"><h3>{comparison.mode === 'fixture' ? 'Practice the review' : 'Record a source checked review'}</h3><p className="cc-muted">Correctness asks whether the answer is right. Support asks whether its claims follow from these sources. Adequacy asks whether it addresses the question, including an appropriate abstention when facts are missing. Each saved judgment is final for this frozen packet.</p>{comparison.mode === 'fixture' && <p className="cc-notice">Every judgment on this fixture is saved as synthetic. It never becomes a human quality result.</p>}{reviewable && <label className="cc-field">{session.hosted ? `Signed in as ${session.actor?.name}` : comparison.mode === 'fixture' ? 'Synthetic reviewer label' : 'Reviewer name'}<input readOnly={session.hosted} value={reviewer} onChange={event => setReviewer(event.target.value)} maxLength={100} /></label>}{item.answers.map(answer => <AnswerJudgment key={answer.versionId} comparison={comparison} item={item} answer={answer} checked={checked} reviewer={reviewer} refresh={refresh} />)}</section>
  </div>;
}

function Results({ report, comparison }: { report: ContextComparisonReport | null; comparison: ContextComparisonDetail }) {
  if (!comparison.reportAvailable) return <section className="cc-card cc-results" aria-label="Comparison results"><h2>Results wait for the reviews.</h2><p>{Math.max(0, comparison.reviewableAnswers - comparison.reviewedAnswers)} completed answers still need a source checked judgment. Quality differences and arm identities remain hidden.</p><button disabled>Export reviewed result</button></section>;
  if (!report) return <section className="cc-card cc-results" aria-label="Comparison results"><p>Loading reviewed results…</p></section>;
  return <section className="cc-card cc-results" aria-label="Comparison results"><span className="cc-kicker">{report.mode === 'fixture' ? 'SYNTHETIC WALKTHROUGH' : 'REVIEWED FROZEN PACKET'}</span><h2>{report.mode === 'fixture' ? 'Practice packet complete.' : 'Comparison results'}</h2>{report.mode === 'live' && <p className="cc-notice">Retrospective comparison. These outcomes describe this imported packet and cannot establish a general quality gain.</p>}{report.mode === 'fixture' && <p className="cc-notice">These answers and judgments are synthetic. They demonstrate the workflow and do not measure model quality.</p>}
    {report.quality ? <><p>{report.quality.eligiblePairs}/{report.quality.totalPairs} pairs with resolved judgments · {report.quality.uncertainPairs} uncertain. Verdict: {words(report.quality.verdict)}.</p><div className="cc-result-counts" aria-label="Paired quality outcomes">{[['Candidate wins', report.quality.wins], ['Candidate losses', report.quality.losses], ['Ties', report.quality.ties], ['Regressions', report.quality.regressions]].map(([name, value]) => <div key={name}><strong>{value}</strong><span>{name}</span></div>)}</div><div className="cc-table-wrap"><table><caption>Human judgments by answer dimension</caption><thead><tr><th scope="col">Arm</th><th scope="col">Correct</th><th scope="col">Supported</th><th scope="col">Adequate</th><th scope="col">Passes all three</th></tr></thead><tbody>{(['baseline', 'candidate'] as const).map(arm => <tr key={arm}><th scope="row">{words(arm)}</th><td>{report.quality![arm].correct}</td><td>{report.quality![arm].supported}</td><td>{report.quality![arm].adequate}</td><td>{report.quality![arm].good}</td></tr>)}</tbody></table></div></> : <p className="cc-muted">No eligible human quality difference is reported for this packet.</p>}
    <p className="cc-muted">Citation matching: baseline {report.citationMatching.baseline.matching}/{report.citationMatching.baseline.total}; candidate {report.citationMatching.candidate.matching}/{report.citationMatching.candidate.total}. These are quote checks, separate from the review verdicts. Billed cost is unavailable.</p>
    <details className="cc-meta"><summary>Inspect revealed arms and limitations</summary><div className="cc-table-wrap"><table><thead><tr><th scope="col">Question</th><th scope="col">Baseline label</th><th scope="col">Candidate label</th></tr></thead><tbody>{report.cases.map(item => <tr key={item.id}><td>{item.question}</td><td>{item.arms.baseline.label}</td><td>{item.arms.candidate.label}</td></tr>)}</tbody></table></div><ul>{report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul><p>{report.timing.definition}</p></details><a className="cc-export" href={`/api/context-comparisons/${encodeURIComponent(comparison.id)}/export`}>Export reviewed result (JSON) ↗</a>
  </section>;
}

export default function ContextComparison() {
  const session = useDemoSession();
  const canCreate = !session.hosted || session.actor?.role === 'operator';
  const [comparisons, setComparisons] = useState<ContextComparisonSummary[]>([]);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('packet') ?? '');
  const [comparison, setComparison] = useState<ContextComparisonDetail | null>(null);
  const [report, setReport] = useState<ContextComparisonReport | null>(null);
  const [caseId, setCaseId] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const selection = useRef(selectedId);
  const refreshNumber = useRef(0);
  const refresh = useCallback(async () => {
    const id = selection.current, refreshId = ++refreshNumber.current;
    if (!id) return;
    const detail = await request<ContextComparisonDetail>(`/api/context-comparisons/${encodeURIComponent(id)}`);
    if (selection.current !== id || refreshId !== refreshNumber.current) return;
    const results = detail.reportAvailable ? await request<ContextComparisonReport>(`/api/context-comparisons/${encodeURIComponent(id)}/report`) : null;
    if (selection.current !== id || refreshId !== refreshNumber.current) return;
    setComparison(detail); setReport(results);
    setCaseId(current => detail.cases.some(item => item.id === current) ? current : detail.cases[0]?.id ?? '');
  }, []);
  useEffect(() => { let active = true; void request<{ comparisons: ContextComparisonSummary[] }>('/api/context-comparisons').then(value => { if (!active) return; setComparisons(value.comparisons); setSelectedId(current => current || value.comparisons[0]?.id || ''); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load comparison packets.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  useEffect(() => { selection.current = selectedId; refreshNumber.current++; setComparison(null); setReport(null); setCaseId(''); if (!selectedId) return; setLoading(true); void refresh().catch(reason => { if (selection.current === selectedId) setError(reason instanceof Error ? reason.message : 'Could not load this comparison.'); }).finally(() => { if (selection.current === selectedId) setLoading(false); }); }, [selectedId, refresh]);
  async function createFixture() {
    setCreating(true); setError('');
    try {
      const created = await request<ContextComparisonSummary>('/api/context-comparisons/fixture', {});
      const list = await request<{ comparisons: ContextComparisonSummary[] }>('/api/context-comparisons');
      setComparisons(list.comparisons); setSelectedId(created.id);
      window.history.replaceState(null, '', `/compare?packet=${encodeURIComponent(created.id)}`);
      if (selection.current === created.id) await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not prepare the synthetic packet.'); }
    finally { setCreating(false); }
  }
  const selected = comparison?.cases.find(item => item.id === caseId);
  return <div className="cc-app"><nav className="ask-nav" aria-label="Main navigation"><a className="ask-brand" href="/ask"><span>a↗</span> ablatrix <small>Context comparison</small></a><div><a href="/ask">Product QA ↗</a><a href="/review">Answer review ↗</a><span className="ask-local">{session.hosted ? 'SYNTHETIC DEMO' : 'LOCAL EXPERIMENT'}</span></div></nav><main className="cc-main"><header className="cc-hero"><span className="cc-kicker">FROZEN INPUTS → BLIND REVIEW → PAIRED RESULTS</span><h1>Compare the same question.</h1><p>Test one source-context change against a fixed baseline. Inspect the answers and original source context before revealing which arm produced each answer.</p></header>
    {error && <p className="cc-error" role="alert">{error}</p>}
    <section className="cc-card"><div className="cc-controls"><label className="cc-field">Saved comparison<select value={selectedId} onChange={event => { setError(''); selection.current = event.target.value; refreshNumber.current++; setSelectedId(event.target.value); window.history.replaceState(null, '', `/compare?packet=${encodeURIComponent(event.target.value)}`); }} disabled={!comparisons.length || creating}><option value="">Choose a comparison</option>{comparisons.map(item => <option key={item.id} value={item.id}>{item.title} · {item.mode === 'fixture' ? 'synthetic' : 'saved live packet'}</option>)}</select></label><button type="button" onClick={() => void createFixture()} disabled={creating || !canCreate}>{creating ? 'Preparing sample…' : 'Load synthetic example (no model calls)'}</button></div></section>
    {loading && <p role="status">Loading frozen comparison…</p>}
    {!loading && !comparison && !error && <section className="cc-card cc-empty"><h2>No comparison packet yet.</h2><p>Load the synthetic example to practice reviewing a frozen pair. Completed live-output packets can be imported separately; their provider provenance remains unverified.</p><p className="cc-muted">This page makes no paid generation calls.</p></section>}
    {comparison && <><section className="cc-card"><span className="cc-kicker">{comparison.mode === 'fixture' ? 'SYNTHETIC FIXTURE' : 'SAVED LIVE OUTPUTS'}</span><h2>{comparison.title}</h2><p><strong>Hypothesis:</strong> Does preserving the original customer question reduce unsupported model or compatibility claims?</p><div className={`cc-notice ${comparison.mode === 'live' ? 'live' : ''}`}><strong>{comparison.mode === 'fixture' ? 'Synthetic answers · no provider calls' : 'Imported live answers · review does not generate new answers'}</strong>{' '}{comparison.provenance.note}{comparison.mode === 'fixture' && <span> Fixture judgments are synthetic and are excluded from human quality claims.</span>}</div><div className="cc-progress" role="status"><strong>{comparison.reviewedAnswers}/{comparison.reviewableAnswers} answers reviewed</strong><span>{Math.max(0, comparison.reviewableAnswers - comparison.reviewedAnswers)} pending · {comparison.caseCount} frozen pairs · {comparison.attempts.failed} failed and {comparison.attempts.uncertain} uncertain attempts</span></div><details className="cc-meta"><summary>Inspect frozen packet identity</summary><dl><dt>Manifest SHA-256</dt><dd><code>{comparison.manifestSha256}</code></dd><dt>Source packet</dt><dd>{comparison.provenance.sourcePacketSha256 ? <code>{comparison.provenance.sourcePacketSha256}</code> : comparison.mode === 'fixture' ? 'Synthetic fixture; no live source packet.' : 'Withheld during blind review; included in the reviewed export.'}</dd><dt>Review provenance</dt><dd>{comparison.mode === 'fixture' ? 'Synthetic practice judgments' : 'Explicit human source checks'}</dd></dl></details></section>
      <div className="cc-layout"><aside className="cc-queue" aria-label="Comparison pair queue"><h2>Frozen pairs</h2>{comparison.cases.map((item, index) => { const completed = item.answers.filter(answer => answer.status === 'completed'); return <button key={item.id} aria-current={item.id === caseId ? 'true' : undefined} onClick={() => setCaseId(item.id)}><small>{String(index + 1).padStart(2, '0')} · {completed.filter(answer => answer.review).length}/{completed.length} reviewed</small><strong>{item.question}</strong></button>; })}</aside>{selected && <PairReview key={`${comparison.manifestSha256}-${selected.id}`} comparison={comparison} item={selected} refresh={refresh} />}</div>
      <Results report={report} comparison={comparison} />
    </>}
  </main></div>;
}
