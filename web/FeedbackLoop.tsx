import React, { useEffect, useRef, useState } from 'react';
import { LoopTelemetry } from './LoopTelemetry.tsx';
import type { LoopBatch, LoopDetailReview, LoopExternalComparison, LoopFeedback, LoopFinal, LoopMode, LoopOverview, LoopPolicy, LoopRun, LoopValidation, Passage, ProductCase, RetrievalResult } from '../server/loop-types.ts';
import './feedback-loop.css';
import './feedback-loop-v02.css';
import './feedback-workspace.css';

type View = 'answer' | 'compare' | 'improve' | 'validate' | 'final' | 'history';
type FeedbackInput = Pick<LoopFeedback, 'correct' | 'supported' | 'referenceChecked' | 'category' | 'correction' | 'sourceIds' | 'reviewer' | 'draftId' | 'details'>;
type DetailInput = { detail: string; evidence: LoopDetailReview['evidence'] | ''; response: LoopDetailReview['response'] | '' };
const categories: { value: LoopFeedback['category']; label: string }[] = [
  { value: 'none', label: 'No issue' }, { value: 'unsupported_claim', label: 'Unsupported claim' },
  { value: 'incomplete_answer', label: 'Incomplete answer' }, { value: 'missed_evidence', label: 'Missed evidence' },
  { value: 'source_conflict', label: 'Conflicting sources' }, { value: 'unnecessary_abstention', label: 'Unnecessary abstention' },
];
const priorityReviewCases = [
  { id: 'epqa-train-775', label: 'Cabinet materials' },
  { id: 'epqa-train-647', label: 'Native Union authenticity' },
];
const duration = (value: number | null) => value === null ? '—' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
const dateLabel = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const shortId = (value: string) => value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-5)}` : value;
const post = (body: unknown = {}): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'The request could not be completed.');
  return value as T;
}

function Arrow() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Badge({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`fl-badge ${tone ? `fl-badge-${tone}` : ''}`}>{children}</span>;
}

function PolicyName({ policy, overview }: { policy?: LoopPolicy; overview: LoopOverview }) {
  const ordered = overview.policies.filter(item => item.mode === policy?.mode).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return <>{policy ? policy.status === 'baseline' ? 'Baseline' : `Policy ${ordered.findIndex(item => item.id === policy.id) + 1}` : 'Unknown policy'}</>;
}

function QuotedSource({ passage, quotes, close }: { passage: Passage; quotes: string[]; close: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !drawer.current) return;
      const focusable = Array.from(drawer.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus(); };
  }, []);
  let parts: React.ReactNode[] = [passage.text];
  for (const quote of quotes.filter(Boolean)) {
    parts = parts.reduce<React.ReactNode[]>((next, part, index) => {
      if (typeof part !== 'string') { next.push(part); return next; }
      const at = part.indexOf(quote);
      if (at < 0) next.push(part);
      else next.push(part.slice(0, at), <mark key={`${index}-${quote}`}>{quote}</mark>, part.slice(at + quote.length));
      return next;
    }, []);
  }
  return <div className="fl-source-backdrop" onClick={close}><aside ref={drawer} className="fl-source-drawer" role="dialog" aria-modal="true" aria-label={`Source ${passage.id}`} onClick={event => event.stopPropagation()}><div className="fl-source-top"><div><span className="fl-eyebrow">SAVED SOURCE EXCERPT</span><h3>{passage.source}</h3><small>{passage.id}</small></div><button ref={closeButton} onClick={close} aria-label="Close source">×</button></div><p>{parts}</p>{/^https?:\/\//i.test(passage.reference) ? <a href={passage.reference} target="_blank" rel="noreferrer">Open original source ↗</a> : <small>{passage.reference}</small>}</aside></div>;
}

function RetrievalMap({ retrieval, openSource }: { retrieval: RetrievalResult | null; openSource: (id: string) => void }) {
  if (!retrieval) return null;
  const max = Math.max(...retrieval.passages.map(item => item.score), 0);
  return <details className="fl-retrieval-map"><summary>Retrieval diagnostics · {retrieval.passages.length} selected passages · {duration(retrieval.durationMs)}</summary><div className="fl-retrieval-content"><div className="fl-section-heading"><div><span className="fl-eyebrow">HYBRID RETRIEVAL / SAVED SELECTION</span><h3>How these passages surfaced</h3></div></div><p>Keyword (BM25) and semantic ranks feed reciprocal rank fusion. Bars show recorded fusion scores within these selected passages. The full candidate lists were not saved.</p><div className="fl-rank-legend"><span>Keyword rank</span><span>Semantic rank</span><span>Fused selection</span></div><div className="fl-rank-rows">{retrieval.passages.map((passage, index) => <button key={passage.id} type="button" onClick={() => openSource(passage.id)} aria-label={`Open source ${passage.id}`}><span className="fl-rank-name"><b>{String(index + 1).padStart(2, '0')}</b>{passage.source}</span><span>#{passage.lexicalRank ?? '—'}</span><span>#{passage.semanticRank ?? '—'}</span><span className="fl-fusion"><i style={{ width: `${max ? passage.score / max * 100 : 0}%` }} /><small>{passage.score.toFixed(4)}</small></span></button>)}</div><small>Ranks may be absent when a passage was not returned by that retrieval arm. Raw BM25 and semantic scores are on different scales and are not compared here.</small></div></details>;
}

function ReviewForm({ run, reference, passages, disabled, save }: { run: LoopRun; reference?: ProductCase; passages: Passage[]; disabled: boolean; save: (value: FeedbackInput) => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [correct, setCorrect] = useState<boolean | null>(run.feedback?.correct ?? null);
  const [supported, setSupported] = useState<boolean | null>(run.feedback?.supported ?? null);
  const [referenceChecked, setReferenceChecked] = useState(run.feedback?.referenceChecked ?? false);
  const [category, setCategory] = useState<LoopFeedback['category']>(run.feedback?.category ?? 'none');
  const [correction, setCorrection] = useState(run.feedback?.correction ?? '');
  const [sourceIds, setSourceIds] = useState<string[]>(run.feedback?.sourceIds ?? []);
  const [reviewer, setReviewer] = useState(run.feedback?.reviewer ?? '');
  const [draftId, setDraftId] = useState<string | undefined>(run.feedback?.draftId);
  const [details, setDetails] = useState<DetailInput[]>(run.feedback?.details ?? []);
  const draft = run.split === 'development' && !run.validationId && !run.finalId ? run.reviewDraft : undefined;
  const isFailure = correct === false || supported === false;
  const ready = correct !== null && supported !== null && referenceChecked && reviewer.trim().length >= 2 && sourceIds.length > 0 && details.every(item => item.detail.trim().length >= 2 && item.evidence !== '' && item.response !== '') && (isFailure ? category !== 'none' && correction.trim().length > 0 : category === 'none');
  const updateDetail = (index: number, change: Partial<DetailInput>) => setDetails(items => items.map((item, position) => position === index ? { ...item, ...change } : item));
  const featuredIds = new Set([...(draft?.sourceIds ?? run.retrieval?.passages.map(item => item.id) ?? passages.slice(0, 5).map(item => item.id)), ...(run.feedback?.sourceIds ?? [])]);
  const featuredPassages = passages.filter(passage => featuredIds.has(passage.id));
  const otherPassages = passages.filter(passage => !featuredIds.has(passage.id));
  const sourceOption = (passage: Passage) => <label key={passage.id}><input type="checkbox" aria-label={`${passage.id} · ${passage.source}`} checked={sourceIds.includes(passage.id)} onChange={event => setSourceIds(previous => event.target.checked ? [...previous, passage.id] : previous.filter(id => id !== passage.id))} disabled={disabled} /><span><strong>{passage.source} · {shortId(passage.id)}</strong><small>{passage.text.length > 180 ? `${passage.text.slice(0, 180)}…` : passage.text}</small></span></label>;
  return <section className="fl-review-section" aria-labelledby="fl-review-title">
    <div className="fl-section-heading"><div><span className="fl-eyebrow">02 / REVIEW</span><h2 id="fl-review-title">What should change?</h2></div>{run.feedback && <Badge tone="green">{run.feedback.kind === 'synthetic' ? 'Synthetic review saved' : 'Review saved'}</Badge>}</div>
    <p className="fl-muted">Check the answer against the source text. A useful correction explains the mistake and points to evidence.</p>
    {run.feedback?.draftId && <p className="fl-review-provenance">AI-assisted review · confirmed by {run.feedback.reviewer} · draft {shortId(run.feedback.draftId)}</p>}
    {reference && <details className="fl-reference"><summary>Review reference <span>{reference.labelStatus}</span></summary><p>{reference.referenceAnswer}</p><small>Reference passages: {reference.referencePassageIds.join(', ')}. Check the original evidence before accepting this label.</small></details>}
    {draft && <details className="fl-review-draft" aria-label="AI review draft"><summary>View AI assessment · separate from your review</summary><aside>
      <div className="fl-draft-heading"><h3>{run.feedback ? 'AI review draft — review saved' : 'AI review draft — awaiting your review'}</h3><Badge tone="amber">{draft.confidence} AI confidence</Badge></div>
      <p className="fl-draft-explanation">These are suggestions. Inspect the source evidence and record your own judgment. An AI draft does not count as reviewed feedback.</p>
      <p className="fl-draft-verdict"><strong>AI opinion:</strong> {draft.correct ? 'Answer looks correct' : 'Possible answer error'} · {draft.supported ? 'claims supported' : 'support concern'}{draft.category !== 'none' ? ` · ${categories.find(item => item.value === draft.category)?.label ?? draft.category}` : ''}.</p>
      <details className="fl-draft-more"><summary>Why the AI thinks this · source excerpts</summary><div className="fl-draft-notes"><strong>Rationale</strong><p>{draft.rationale}</p>{draft.correction && <><strong>Suggested correction or notes</strong><p>{draft.correction}</p></>}</div>
      <div className="fl-draft-sources"><strong>Sources cited by the draft</strong>{draft.sourceIds.length ? draft.sourceIds.map(id => {
        const passage = passages.find(item => item.id === id);
        return <details key={id}><summary>{id}{passage && <span> · {passage.source}</span>}</summary>{passage ? <><p>{passage.text}</p>{/^https?:\/\//i.test(passage.reference) ? <a href={passage.reference} target="_blank" rel="noreferrer">Source reference ↗</a> : <small>{passage.reference}</small>}</> : <p>Source text is not currently available. Check the complete product evidence before confirming this source.</p>}</details>;
      }) : <p>No source IDs supplied.</p>}</div></details>
      <p className="fl-draft-byline">Draft by {draft.reviewer} · {dateLabel(draft.createdAt)}</p>
      {!run.feedback && <><button type="button" className="fl-button fl-button-secondary" disabled={disabled} onClick={() => { setCorrect(draft.correct); setSupported(draft.supported); setCategory(draft.category); setCorrection(draft.correction); setDraftId(draft.id); }}>Use suggested judgments <Arrow /></button>{draftId === draft.id && <p className="fl-draft-applied" role="status">Suggested judgments loaded. Select the evidence you personally checked, confirm your source review, and enter your name below.</p>}</>}
    </aside></details>}
    <nav className="fl-review-steps" aria-label="Review steps">{['Judgment', 'Evidence checked', 'Confirm'].map((label, index) => <button type="button" key={label} className={step === index ? 'active' : ''} onClick={() => setStep(index)} aria-current={step === index ? 'step' : undefined}><span>{index + 1}</span>{label}</button>)}</nav>
    <form className={`fl-review-form fl-review-stage-${step}`} onSubmit={async event => { event.preventDefault(); if (ready && correct !== null && supported !== null) await save({ correct, supported, referenceChecked, category, correction: correction.trim(), sourceIds, reviewer: reviewer.trim(), ...(draftId ? { draftId } : {}), ...(details.length ? { details: details.map(item => ({ detail: item.detail.trim(), evidence: item.evidence as LoopDetailReview['evidence'], response: item.response as LoopDetailReview['response'] })) } : {}) }); }}>
      <div className="fl-review-judgments">
        <fieldset><legend>Is the answer correct?</legend><div className="fl-radio-group">{[true, false].map(value => <label key={String(value)}><input type="radio" name={`correct-${run.id}`} checked={correct === value} onChange={() => setCorrect(value)} disabled={disabled} />{value ? 'Yes' : 'No'}</label>)}</div></fieldset>
        <fieldset><legend>Is it supported by the evidence?</legend><div className="fl-radio-group">{[true, false].map(value => <label key={String(value)}><input type="radio" name={`supported-${run.id}`} checked={supported === value} onChange={() => setSupported(value)} disabled={disabled} />{value ? 'Yes' : 'No'}</label>)}</div></fieldset>
      </div>
      <label className="fl-review-issue">Issue category<select value={category} onChange={event => setCategory(event.target.value as LoopFeedback['category'])} disabled={disabled}>{categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="fl-review-correction">Correction or review notes <span className="fl-field-hint">{isFailure ? 'Required for a failed answer' : 'Optional'}</span><textarea rows={3} maxLength={4000} value={correction} onChange={event => setCorrection(event.target.value)} disabled={disabled} placeholder="Describe the supported answer and what the agent missed…" /></label>
      <details className="fl-detail-review" open={details.length > 0}><summary>Requested details · {details.length} assessed</summary><p className="fl-muted">Assess the shopper's specific requests. A listing claim, conflicting reports, and missing evidence are different outcomes.</p>{details.map((item, index) => <div className="fl-detail-row" key={index}><label>Requested detail<input value={item.detail} maxLength={140} onChange={event => updateDetail(index, { detail: event.target.value })} disabled={disabled} placeholder="e.g. Is the glass real?" /></label><label>Evidence<select value={item.evidence} required onChange={event => updateDetail(index, { evidence: event.target.value as LoopDetailReview['evidence'] })} disabled={disabled}><option value="">Choose evidence…</option><option value="listing">Listing states it</option><option value="customer_report">Customer report</option><option value="conflicting">Sources conflict</option><option value="missing">No supporting evidence</option></select></label><label>Answer<select value={item.response} required onChange={event => updateDetail(index, { response: event.target.value as LoopDetailReview['response'] })} disabled={disabled}><option value="">Choose answer assessment…</option><option value="addressed">Clearly addressed</option><option value="qualified">Qualified appropriately</option><option value="missed">Useful detail missed</option><option value="overstated">Overstated conclusion</option></select></label><button type="button" className="fl-text-button" onClick={() => setDetails(items => items.filter((_, position) => position !== index))} disabled={disabled}>Remove</button></div>)}<button type="button" className="fl-text-button" onClick={() => setDetails(items => [...items, { detail: '', evidence: '', response: '' }])} disabled={disabled || details.length >= 6}>Add requested detail</button></details>
      <fieldset className="fl-source-checks"><legend>Evidence you personally checked</legend>{passages.length ? <>{featuredPassages.map(sourceOption)}{otherPassages.length > 0 && <details className="fl-more-sources"><summary>Show {otherPassages.length} more product sources</summary><div>{otherPassages.map(sourceOption)}</div></details>}</> : <p className="fl-muted">No product passages are available for an evidence-backed review.</p>}</fieldset>
      <label className="fl-checkbox fl-reference-check"><input type="checkbox" checked={referenceChecked} onChange={event => setReferenceChecked(event.target.checked)} disabled={disabled} /><span>I checked the reference or correction against the source evidence.</span></label>
      {step === 2 && <p className="fl-review-summary">{correct === null ? 'Correctness not yet judged' : correct ? 'Marked correct' : 'Marked incorrect'} · {supported === null ? 'Support not yet judged' : supported ? 'Evidence supported' : 'Support concern'} · {sourceIds.length} checked {sourceIds.length === 1 ? 'source' : 'sources'} · {referenceChecked ? 'Reference confirmed' : 'Reference confirmation needed'}</p>}
      <label className="fl-reviewer-name">Reviewer name<input value={reviewer} onChange={event => setReviewer(event.target.value)} maxLength={100} autoComplete="name" disabled={disabled} placeholder="Your name" /></label>
      {step < 2 && <button type="button" className="fl-button fl-button-secondary fl-review-next" onClick={() => setStep(previous => previous + 1)}>{step === 0 ? 'Continue to checked evidence' : 'Continue to confirmation'} <Arrow /></button>}
      <div className="fl-form-footer"><small>{run.mode === 'fixture' ? 'This review concerns a synthetic answer. No model improvement is established.' : 'This review becomes part of the saved experiment evidence.'}</small><button className="fl-button fl-button-primary" type="submit" disabled={disabled || !ready}>{run.feedback ? 'Update review' : 'Save feedback'}<Arrow /></button></div>
    </form>
  </section>;
}

function RunDetail({ run, overview, disabled, save }: { run: LoopRun; overview: LoopOverview; disabled: boolean; save: (value: FeedbackInput) => Promise<void> }) {
  const [productEvidence, setProductEvidence] = useState<Passage[] | null>(null);
  const [evidenceError, setEvidenceError] = useState('');
  const [sourceId, setSourceId] = useState('');
  useEffect(() => {
    let active = true;
    setProductEvidence(null); setEvidenceError('');
    request<{ passages: Passage[] }>(run.finalId ? `/api/loop/final/products/${encodeURIComponent(run.productId)}/evidence` : `/api/loop/products/${encodeURIComponent(run.productId)}/evidence`).then(value => { if (active) setProductEvidence(value.passages); }).catch(reason => { if (active) setEvidenceError(reason instanceof Error ? reason.message : 'Product evidence could not be loaded.'); });
    return () => { active = false; };
  }, [run.productId]);
  const reviewPassages = productEvidence ?? run.retrieval?.passages ?? [];
  const reference = overview.cases.find(item => item.id === run.caseId);
  const policy = overview.policies.find(item => item.id === run.policyId);
  const validation = overview.validations.find(item => item.id === run.validationId);
  const final = overview.finals.find(item => item.id === run.finalId);
  const frozenReview = overview.policies.some(item => item.feedbackRunIds.includes(run.id)) || (!!validation && validation.status !== 'awaiting_review') || (!!final && final.status !== 'awaiting_review');
  const selectedSource = reviewPassages.find(item => item.id === sourceId);
  const retrievalMs = run.timings?.retrievalStartedAt && run.timings.retrievalEndedAt ? new Date(run.timings.retrievalEndedAt).getTime() - new Date(run.timings.retrievalStartedAt).getTime() : null;
  const generationMs = run.timings?.generationStartedAt && run.timings.generationEndedAt ? new Date(run.timings.generationEndedAt).getTime() - new Date(run.timings.generationStartedAt).getTime() : null;
  return <div className="fl-run-detail">
    <div className="fl-section-heading"><div><span className="fl-eyebrow">{run.mode === 'live' ? 'LIVE EXPERIMENT' : 'SYNTHETIC DEMO'} / {run.split} / {overview.products.find(item => item.id === run.productId)?.title ?? run.productId}</span><h2>{run.question}</h2></div><Badge tone={run.status === 'failed' || run.status === 'interrupted' ? 'red' : ''}>{run.status.replaceAll('_', ' ')}</Badge></div>
    <div className="fl-run-meta"><span>{run.blindLabel ?? <PolicyName policy={policy} overview={overview} />}</span>{!run.blindLabel && <><span>{run.model ?? 'Awaiting model'}</span><span>{duration(run.durationMs)}</span>{run.usage && <span>{run.usage.inputTokens + run.usage.outputTokens} tokens</span>}</>}</div>
    {run.error && <div className="fl-alert" role="alert">{run.error}</div>}
    {run.answer ? <div className="fl-answer"><Badge tone={run.feedback ? run.feedback.correct && run.feedback.supported ? 'green' : 'red' : 'amber'}>{run.feedback ? run.feedback.correct && run.feedback.supported ? 'Reviewed: supported' : 'Reviewed: issue found' : run.answer.status === 'insufficient_evidence' ? 'Model marked uncertain' : 'Model marked answered'}</Badge><p>{run.answer.answer}</p>{run.answer.citations.length > 0 && <div className="fl-citations">{run.answer.citations.map((citation, index) => <blockquote key={`${citation.passageId}-${index}`}><p>“{citation.quote}”</p><button className="fl-text-button" onClick={() => setSourceId(citation.passageId)}>{citation.passageId} ↗</button></blockquote>)}</div>}</div> : <div className="fl-empty fl-empty-small"><span aria-hidden="true">◌</span><h3>{run.status === 'running' ? 'Retrieving evidence and preparing an answer…' : 'This run has no answer.'}</h3></div>}
    <div className="fl-measured"><span>Retrieval <strong>{run.timings?.retrievalReused ? 'reused for pair' : duration(retrievalMs ?? run.retrieval?.durationMs ?? null)}</strong></span><span>Generation <strong>{duration(generationMs)}</strong></span><span>Total <strong>{duration(run.durationMs)}</strong></span></div>
    <RetrievalMap retrieval={run.retrieval} openSource={setSourceId} />
    {selectedSource && <QuotedSource passage={selectedSource} quotes={run.answer?.citations.filter(item => item.passageId === sourceId).map(item => item.quote) ?? []} close={() => setSourceId('')} />}
    {run.retrieval && <details className="fl-evidence" open><summary><span>Retrieved evidence <b>{run.retrieval.passages.length}</b></span><small>{run.retrieval.method} · {duration(run.retrieval.durationMs)}</small></summary><div className="fl-passages">{run.retrieval.passages.map((passage, index) => <article key={passage.id} id={`fl-passage-${passage.id}`} className="fl-passage"><div className="fl-passage-heading"><span className="fl-passage-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{passage.source}</strong><span>{passage.id}</span></div><span className="fl-ranks">BM25 #{passage.lexicalRank ?? '—'} · Semantic #{passage.semanticRank ?? '—'}</span></div><p>{passage.text}</p>{/^https?:\/\//i.test(passage.reference) ? <a href={passage.reference} target="_blank" rel="noreferrer">Source reference ↗</a> : <small>{passage.reference}</small>}</article>)}</div><p className="fl-corpus-note">Corpus {run.retrieval.corpusVersion} · {run.retrieval.embeddingModel}</p></details>}
    <details className="fl-evidence fl-all-evidence"><summary><span>All product evidence <b>{reviewPassages.length}</b></span><small>Review sources the retriever may have missed</small></summary>{!productEvidence && !evidenceError && <p className="fl-help" role="status">Loading the complete product evidence…</p>}<div className="fl-passages">{reviewPassages.map(passage => <article key={passage.id} className="fl-passage"><div className="fl-passage-heading"><div><strong>{passage.source}</strong><span>{passage.id}</span></div><Badge>{run.retrieval?.passages.some(item => item.id === passage.id) ? 'Retrieved' : 'Not retrieved'}</Badge></div><p>{passage.text}</p>{/^https?:\/\//i.test(passage.reference) ? <a href={passage.reference} target="_blank" rel="noreferrer">Source reference ↗</a> : <small>{passage.reference}</small>}</article>)}</div></details>
    {evidenceError && <p className="fl-help fl-help-alert" role="alert">Full product evidence is unavailable: {evidenceError} Review choices currently include retrieved passages only.</p>}
    {run.status === 'completed' && <>{frozenReview && <p className="fl-help">This review is frozen because its proposal, validation decision, or final report is saved.</p>}<ReviewForm key={run.id} run={run} reference={reference} passages={reviewPassages} disabled={disabled || frozenReview} save={save} /></>}
  </div>;
}

function Comparison({ overview, comparisonId, caseId, openRun, selectCase }: { overview: LoopOverview; comparisonId: string; caseId: string; openRun: (id: string) => void; selectCase: (id: string) => void }) {
  const [source, setSource] = useState<{ passage: Passage; quotes: string[] } | null>(null);
  const comparison = [...overview.validations, ...overview.finals].find(item => item.id === comparisonId);
  if (!comparison) return <div className="fl-panel">Comparison unavailable. Select a saved validation or final comparison.</div>;
  const blind = comparison.status === 'awaiting_review';
  const runs = blind ? overview.reviewCards[comparison.id] ?? [] : comparison.runIds.map(id => overview.runs.find(item => item.id === id)).filter((item): item is LoopRun => !!item);
  const selectedCaseId = comparison.caseIds.includes(caseId) ? caseId : comparison.caseIds[0];
  const pair = runs.filter(item => item.caseId === selectedCaseId);
  const passedExecution = runs.filter(item => item.status === 'completed').length;
  const humanReviewedPairs = comparison.caseIds.filter(id => runs.filter(item => item.caseId === id && item.feedback?.kind === 'human').length === 2).length;
  const getName = (run: LoopRun) => run.blindLabel ?? ('parentId' in comparison ? run.policyId === comparison.parentId ? 'Baseline' : 'Candidate' : run.policyId === comparison.baselineId ? 'Baseline' : 'Candidate');
  return <section className="fl-comparison"><div className="fl-section-heading"><div><span className="fl-eyebrow">{comparison.mode === 'live' ? 'LIVE EXPERIMENT' : 'SYNTHETIC DEMO'} / RECORDED COMPARISON</span><h2>Same question. Two saved attempts.</h2></div><Badge tone={comparison.status === 'rejected' ? 'red' : comparison.status === 'accepted' || comparison.status === 'reported' ? 'green' : 'amber'}>{comparison.status.replaceAll('_', ' ')}</Badge></div><p className="fl-muted">{blind ? 'Anonymous labels and hidden run associations remain in place until the saved decision is resolved.' : 'This comparison has been resolved. Policy associations shown below come from the public saved record.'}</p><div className="fl-comparison-measures"><div><strong>{comparison.caseIds.length}</strong><span>Question pairs</span></div><div><strong>{runs.length}/{comparison.caseIds.length * 2}</strong><span>Attempts saved</span></div><div><strong>{passedExecution}/{runs.length}</strong><span>Passed execution checks</span></div><div><strong>{humanReviewedPairs}</strong><span>Human reviewed pairs</span></div></div><div className="fl-quality-empty"><strong>Quality wins and losses</strong><span>{humanReviewedPairs ? 'See the saved human review and decision for each completed pair.' : 'No completed human reviewed comparison. No quality margin can be calculated.'}</span></div><div className="fl-case-pills">{comparison.caseIds.map((id, index) => <button key={id} className={id === selectedCaseId ? 'active' : ''} onClick={() => selectCase(id)}>{index + 1}. {overview.products.find(item => item.id === overview.cases.find(c => c.id === id)?.productId)?.title ?? id}</button>)}</div><h3 className="fl-comparison-question">{overview.cases.find(item => item.id === selectedCaseId)?.question ?? selectedCaseId}</h3><div className="fl-comparison-cards">{pair.length ? pair.map(run => <article key={run.id}><div className="fl-comparison-card-top"><strong>{getName(run)}</strong><Badge tone={run.feedback ? run.feedback.correct && run.feedback.supported ? 'green' : 'red' : run.status === 'failed' ? 'red' : ''}>{run.feedback ? run.feedback.correct && run.feedback.supported ? 'Human reviewed: supported & correct' : 'Human reviewed: issue' : run.status === 'completed' ? 'Unreviewed' : run.status}</Badge></div>{run.answer ? <><p className="fl-comparison-answer">{run.answer.answer}</p><div className="fl-comparison-sources">{run.answer.citations.map((citation, index) => <button key={`${citation.passageId}-${index}`} onClick={() => { const passage = run.retrieval?.passages.find(item => item.id === citation.passageId); if (passage) setSource({ passage, quotes: [citation.quote] }); }}>{citation.passageId} · saved quote ↗</button>)}</div></> : <p className="fl-comparison-absent">{run.error ?? 'No answer was saved for this attempt.'}</p>}<div className="fl-comparison-card-foot"><span>{run.feedback ? `Reviewed by ${run.feedback.reviewer}` : run.status === 'completed' ? 'Awaiting human judgment' : 'Execution check failed'}</span>{run.status === 'completed' && <button className="fl-text-button" onClick={() => openRun(run.id)}>Inspect & review <Arrow /></button>}</div></article>) : <div className="fl-panel">The pair is still being prepared.</div>}</div>{source && <QuotedSource passage={source.passage} quotes={source.quotes} close={() => setSource(null)} />}{comparison.status === 'rejected' && <div className="fl-comparison-verdict"><strong>Candidate rejected · baseline active</strong><p>{comparison.reason} Passing execution checks does not establish answer correctness. No reviewed quality margin is available.</p></div>}</section>;
}

function ExploratoryComparison({ overview, comparison, caseId, selectCase }: { overview: LoopOverview; comparison: LoopExternalComparison; caseId: string; selectCase: (id: string) => void }) {
  const [source, setSource] = useState<{ passage: Passage; quotes: string[] } | null>(null);
  const selected = comparison.cases.find(item => item.caseId === caseId) ?? comparison.cases[0];
  if (!selected) return <section className="fl-panel">This saved comparison has no question pairs.</section>;
  const product = overview.products.find(item => item.id === selected.productId);
  const openSource = (id: string, quote = '') => { const passage = selected.retrieval.passages.find(item => item.id === id); if (passage) setSource({ passage, quotes: quote ? [quote] : [] }); };
  return <section className="fl-comparison fl-exploratory"><div className="fl-section-heading"><div><span className="fl-eyebrow">LIVE / EXPLORATORY PAIRED ROUND / SAVED REPLAY</span><h2>Two questions. Four cited answers.</h2></div><Badge tone="amber">No observed gain</Badge></div>
    <p className="fl-muted">The same saved retrieval was supplied to both policy arms for each question. A separate Astra reviewer judged anonymous A/B answers. This is an AI assessment, not human review or an official promotion score.</p>
    <div className="fl-comparison-measures"><div><strong>2</strong><span>Question pairs</span></div><div><strong>4/4</strong><span>Execution checks passed</span></div><div><strong>1–1</strong><span>Narrow AI preferences</span></div><div><strong>0</strong><span>Human reviewed pairs</span></div></div>
    <div className="fl-quality-empty"><strong>Assessment</strong><span>Both arms passed support, adequacy, and citations on both questions. The split AI preference shows no supported-correctness improvement.</span></div>
    <div className="fl-case-pills">{comparison.cases.map((item, index) => <button key={item.caseId} className={item.caseId === selected.caseId ? 'active' : ''} onClick={() => { setSource(null); selectCase(item.caseId); }}>{index + 1}. {overview.products.find(product => product.id === item.productId)?.title ?? item.caseId}</button>)}</div>
    <div className="fl-exploratory-context"><span className="fl-eyebrow">{product?.title ?? selected.productId} / {selected.caseId}</span><h3 className="fl-comparison-question">{selected.question}</h3><small>Recorded retrieval: {selected.retrieval.method}. This historical result is displayed as saved.</small></div>
    <RetrievalMap retrieval={selected.retrieval} openSource={openSource} />
    <div className="fl-exploratory-heading"><span className="fl-eyebrow">BLIND ANSWERS / ARM REVEAL AFTER AI REVIEW</span><small>Both calls used {selected.answers[0]?.model}; exact quoted text appears in the saved passage.</small></div>
    <div className="fl-comparison-cards">{selected.answers.map(item => <article key={item.arm}><div className="fl-comparison-card-top"><strong>Answer {item.blindLabel} · {item.arm === 'baseline' ? 'Active baseline' : 'Revision 2 candidate'}</strong><Badge tone="green">Passed execution</Badge></div><p className="fl-comparison-answer">{item.answer.answer}</p><div className="fl-comparison-sources">{item.answer.citations.map((citation, index) => <button key={`${citation.passageId}-${index}`} onClick={() => openSource(citation.passageId, citation.quote)}>{citation.passageId} · saved quote ↗</button>)}</div><div className="fl-comparison-card-foot"><span>Support · adequacy · citations: AI pass</span><span>{duration(item.durationMs)}</span></div></article>)}</div>
    <div className="fl-exploratory-review"><span className="fl-eyebrow">ASTRA BLIND ASSESSMENT / AI ONLY</span><strong>Answer {selected.aiReview.preferredBlindLabel} narrowly preferred · {selected.aiReview.preferredArm === 'baseline' ? 'baseline' : 'candidate'}</strong><p>{selected.aiReview.rationale}</p></div>
    <div className="fl-comparison-verdict"><strong>Split preference · no promotion</strong><p>No supported-correctness gain was observed on these two purposively selected products. Both are consumed for validation. The active policy remains {overview.activePolicyIds.live}. Human review remains outstanding.</p></div>
    <details className="fl-exploratory-provenance"><summary>Saved evidence provenance</summary><p>Packet SHA-256: <code>{comparison.packetSha256}</code></p><p>AI review SHA-256: <code>{comparison.reviewSha256}</code></p><p>Corpus: <code>{comparison.corpusVersion}</code> · finished {dateLabel(comparison.finishedAt)}</p></details>
    {source && <QuotedSource passage={source.passage} quotes={source.quotes} close={() => setSource(null)} />}
  </section>;
}

export default function FeedbackLoop() {
  const [overview, setOverview] = useState<LoopOverview | null>(null);
  const [mode, setMode] = useState<LoopMode>('live');
  const [view, setView] = useState<View>('answer');
  const [productId, setProductId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [question, setQuestion] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [comparisonId, setComparisonId] = useState('');
  const [comparisonCaseId, setComparisonCaseId] = useState('');
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState<string[] | null>(null);
  const [regressionSelection, setRegressionSelection] = useState<{ key: string; caseIds: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() { const value = await request<LoopOverview>('/api/loop'); setOverview(value); return value; }
  useEffect(() => {
    let active = true;
    request<LoopOverview>('/api/loop').then(value => {
      if (!active) return;
      setOverview(value);
      const params = new URLSearchParams(window.location.search);
      const requestedMode = params.get('mode');
      const requestedRun = params.get('run');
      const requestedCard = params.get('card');
      const requestedCase = params.get('case');
      const requestedView = params.get('view');
      const publicRuns = [...value.runs, ...Object.values(value.reviewCards).flat()];
      if (requestedMode === 'fixture' || requestedMode === 'live') setMode(requestedMode);
      if (requestedMode && requestedMode !== 'fixture' && requestedMode !== 'live') setError('Unknown execution mode in this link. Choose Live experiment or Synthetic demo.');
      else if (requestedRun) {
        const target = publicRuns.find(item => item.id === requestedRun && (!requestedMode || item.mode === requestedMode));
        if (target) { setMode(target.mode); setSelectedRunId(target.id); setView('answer'); }
        else { setSelectedRunId('unavailable'); setError('This saved answer is unavailable in the selected mode. Check the link or choose another saved answer.'); }
      } else if (requestedCard) {
        const comparison = [...value.validations, ...value.finals, ...(value.externalComparisons ?? [])].find(item => item.id === requestedCard && (!requestedMode || item.mode === requestedMode));
        if (comparison) { const ids = 'caseIds' in comparison ? comparison.caseIds : comparison.cases.map(item => item.caseId); setMode(comparison.mode); setComparisonId(comparison.id); setComparisonCaseId(requestedCase && ids.includes(requestedCase) ? requestedCase : ids[0]); setView('compare'); }
        else { setSelectedRunId('unavailable'); setError('This public comparison card is unavailable. It may be incomplete or the link may be invalid.'); }
      } else {
        if (requestedMode) setMode(requestedMode as LoopMode);
        if (requestedView && ['answer', 'compare', 'improve', 'validate', 'final', 'history'].includes(requestedView)) setView(requestedView as View);
        else if (!requestedMode || requestedMode === 'live') { const recorded = value.validations.find(item => item.mode === 'live' && item.status === 'rejected') ?? value.externalComparisons?.[0]; if (recorded) { setMode('live'); setComparisonId(recorded.id); setComparisonCaseId('caseIds' in recorded ? recorded.caseIds.at(-1) ?? '' : recorded.cases[0]?.caseId ?? ''); setView('compare'); } else if (!requestedMode) setMode('fixture'); }
      }
      const firstCase = value.cases.find(item => item.split === 'development');
      setProductId(firstCase?.productId ?? value.products.find(item => item.split === 'development')?.id ?? '');
      setCaseId(firstCase?.id ?? ''); setQuestion(firstCase?.question ?? '');
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load the feedback loop.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { const back = () => window.location.reload(); window.addEventListener('popstate', back); return () => window.removeEventListener('popstate', back); }, []);
  const polling = !!pending || !!overview?.busy;
  useEffect(() => {
    if (!polling) return;
    let active = true;
    const timer = window.setInterval(() => { request<LoopOverview>('/api/loop').then(value => { if (active) setOverview(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not refresh progress.'); }); }, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [polling]);

  async function mutate<T>(label: string, url: string, body: unknown = {}, done?: (value: T) => void) {
    setPending(label); setError(''); setNotice('');
    try { const value = await request<T>(url, post(body)); await refresh(); done?.(value); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The action could not be completed.'); await refresh().catch(() => {}); }
    finally { setPending(''); }
  }

  const busy = !!pending || !!overview?.busy;
  const activePolicy = overview?.policies.find(item => item.id === overview.activePolicyIds[mode]);
  const runs = overview?.runs.filter(item => item.mode === mode) ?? [];
  const blindRuns = Object.values(overview?.reviewCards ?? {}).flat().filter(item => item.mode === mode);
  const developmentRuns = runs.filter(item => item.split === 'development' && !item.validationId);
  const selectedRun = selectedRunId ? [...runs, ...blindRuns].find(item => item.id === selectedRunId) : developmentRuns[0];
  const policies = overview?.policies.filter(item => item.mode === mode) ?? [];
  const candidates = policies.filter(item => item.parentId !== null).slice().reverse();
  const candidate = candidates.find(item => item.id === selectedPolicyId) ?? candidates[0];
  const regressionScope = `${mode}:${candidate?.id ?? ''}`;
  useEffect(() => { setRegressionSelection({ key: regressionScope, caseIds: [] }); }, [regressionScope]);
  const parentPolicy = policies.find(item => item.id === candidate?.parentId);
  const eligibleFeedback = developmentRuns.filter(item => item.status === 'completed' && item.policyId === activePolicy?.id && item.feedback?.referenceChecked && (!item.feedback.correct || !item.feedback.supported));
  const proposalIds = (selectedFeedbackIds ?? eligibleFeedback.map(item => item.id)).filter(id => eligibleFeedback.some(item => item.id === id));
  const validations = overview?.validations.filter(item => item.mode === mode) ?? [];
  const recordedValidation = validations.find(item => item.status === 'rejected') ?? validations[0];
  const recordedPolicy = policies.find(item => item.id === recordedValidation?.candidateId);
  const recordedFailure = developmentRuns.find(item => recordedPolicy?.feedbackRunIds.includes(item.id));
  const finals = overview?.finals.filter(item => item.mode === mode) ?? [];
  const holdoutExposed = (overview?.finals.length ?? 0) > 0;
  const otherComparisons = [...(mode === 'live' ? overview?.externalComparisons ?? [] : []), ...validations, ...finals].filter(item => item.id !== comparisonId);
  const candidateValidations = validations.filter(item => item.candidateId === candidate?.id);
  const liveUnavailable = mode === 'live' && !overview?.readiness.ready;
  const existingCandidate = candidates.some(item => item.status === 'candidate' && item.parentId === activePolicy?.id);
  const reviewedFailures = developmentRuns.filter(item => item.feedback && (!item.feedback.correct || !item.feedback.supported));
  const reviewedControls = developmentRuns.filter(item => item.policyId === parentPolicy?.id && item.feedback?.referenceChecked && item.feedback.correct && item.feedback.supported && item.caseId);
  const regressionCaseIds = (regressionSelection?.key === regressionScope ? regressionSelection.caseIds : []).filter(id => reviewedControls.some(item => item.caseId === id));
  const products = overview?.products.filter(item => item.split === 'development') ?? [];
  const developmentCases = overview?.cases.filter(item => item.split === 'development' && item.productId === productId) ?? [];
  const batches = overview?.batches.filter(item => item.mode === mode) ?? [];
  const activeBatch = batches.find(item => item.policyId === activePolicy?.id);
  const usedValidationProducts = new Set([
    ...(overview?.validations.flatMap(item => item.caseIds.map(id => overview.cases.find(entry => entry.id === id && entry.split === 'validation')?.productId).filter((id): id is string => !!id)) ?? []),
    ...(overview?.externalValidationCases ?? []).map(item => item.productId)
  ]);
  const validationProductCount = overview?.cases.filter(item => item.split === 'validation').length ?? 0;

  function setLink(params: Record<string, string>) { const url = new URL(window.location.href); url.search = new URLSearchParams(params).toString(); window.history.pushState(null, '', url); }
  function changeMode(value: LoopMode) { setMode(value); setSelectedRunId(''); const recorded = value === 'live' ? overview?.validations.find(item => item.mode === 'live' && item.status === 'rejected') ?? overview?.externalComparisons?.[0] : undefined; const recordedCase = recorded ? 'caseIds' in recorded ? recorded.caseIds.at(-1) ?? '' : recorded.cases[0]?.caseId ?? '' : ''; setComparisonId(recorded?.id ?? ''); setComparisonCaseId(recordedCase); setView(recorded ? 'compare' : 'answer'); setSelectedPolicyId(''); setSelectedFeedbackIds(null); setError(''); setNotice(''); setLink({ mode: value, ...(recorded ? { card: recorded.id, case: recordedCase } : {}) }); }
  function changeProduct(id: string) { setProductId(id); const first = overview?.cases.find(item => item.productId === id && item.split === 'development'); setCaseId(first?.id ?? ''); setQuestion(first?.question ?? ''); }
  function openRun(id: string) { setSelectedRunId(id); setView('answer'); setNotice(''); setLink({ mode, run: id }); window.scrollTo({ top: 150, behavior: 'smooth' }); }
  function openComparison(id: string, caseId = '') { const item = [...(overview?.validations ?? []), ...(overview?.finals ?? []), ...(overview?.externalComparisons ?? [])].find(entry => entry.id === id); if (!item) return; const ids = 'caseIds' in item ? item.caseIds : item.cases.map(entry => entry.caseId); const nextCase = caseId && ids.includes(caseId) ? caseId : ids[0]; setComparisonId(id); setComparisonCaseId(nextCase); setView('compare'); setLink({ mode: item.mode, card: id, case: nextCase }); window.scrollTo({ top: 150, behavior: 'smooth' }); }
  async function saveReview(value: FeedbackInput) {
    if (!selectedRun) return;
    await mutate('Saving feedback…', `/api/loop/runs/${selectedRun.id}/review`, value, () => setNotice(selectedRun.finalId ? 'Blind review saved. Return to final evaluation for the next answer.' : selectedRun.validationId ? 'Review saved. Return to validation to inspect the decision.' : 'Feedback saved. Use reviewed failures to propose one policy update.'));
  }

  function renderValidation(validation: LoopValidation) {
    const validationRuns = validation.status === 'awaiting_review' ? overview?.reviewCards[validation.id] ?? [] : validation.runIds.map(id => runs.find(item => item.id === id)).filter((item): item is LoopRun => !!item);
    const reviewed = validationRuns.filter(item => item.feedback?.referenceChecked).length;
    const allReviewed = validationRuns.length === validation.runIds.length && validationRuns.length > 0 && reviewed === validationRuns.length && validationRuns.every(item => item.status === 'completed');
    const canDecide = validation.status === 'awaiting_review' && allReviewed;
    return <article className="fl-validation" key={validation.id}><div className="fl-section-heading"><div><span className="fl-eyebrow">PAIRED VALIDATION</span><h3>{dateLabel(validation.createdAt)}</h3></div><Badge tone={validation.status === 'accepted' ? 'green' : validation.status === 'rejected' || validation.status === 'interrupted' ? 'red' : 'amber'}>{validation.status.replaceAll('_', ' ')}</Badge></div>
      <div className="fl-validation-stats"><div><span>Parent supported & correct</span><strong>{validation.parentCorrect === null ? 'Awaiting review' : `${validation.parentCorrect}/${validation.caseIds.length}`}</strong></div><div><span>Candidate supported & correct</span><strong>{validation.candidateCorrect === null ? 'Awaiting review' : `${validation.candidateCorrect}/${validation.caseIds.length}`}</strong></div><div><span>Regressions</span><strong>{validation.regressions ?? '—'}</strong></div></div>
      {validation.reason && <p className="fl-decision-reason">{validation.reason}</p>}
      <div className="fl-validation-cases">{validation.caseIds.map(id => {
        const reference = overview?.cases.find(item => item.id === id);
        const pair = validationRuns.filter(item => item.caseId === id);
        return <div className="fl-validation-case" key={id}><h4>{reference?.question ?? id}</h4><div className="fl-validation-pair">{pair.map(run => <div key={run.id}><div className="fl-pair-heading"><strong>{run.blindLabel ?? (run.policyId === validation.parentId ? 'Parent' : 'Candidate')}</strong><Badge tone={run.feedback ? run.feedback.correct && run.feedback.supported ? 'green' : 'red' : ''}>{run.feedback ? run.feedback.correct && run.feedback.supported ? 'Supported & correct' : 'Issue found' : run.status === 'completed' ? 'Needs review' : run.status}</Badge></div><p>{run.answer?.answer ?? run.error ?? 'Preparing answer…'}</p><button className="fl-text-button" onClick={() => openRun(run.id)} disabled={run.status !== 'completed'}>{run.feedback ? 'Inspect answer & review' : 'Review answer'} <Arrow /></button></div>)}</div></div>;
      })}</div>
      <div className="fl-validation-footer"><span>{reviewed}/{validation.runIds.length} reviewed{mode === 'fixture' ? ' · synthetic outcomes' : ''}</span>{validation.status === 'awaiting_review' && <button className="fl-button fl-button-primary" disabled={busy || !canDecide} onClick={() => mutate('Evaluating promotion gate…', `/api/loop/validations/${validation.id}/decide`, {}, () => setNotice('Decision saved. The active policy changes only when the candidate passes.'))}>Apply promotion gate <Arrow /></button>}</div>{validation.status === 'awaiting_review' && !allReviewed && <p className="fl-help">Review every completed answer and verify its evidence before applying the gate.</p>}
    </article>;
  }

  function renderFinal(final: LoopFinal) {
    const cards = final.status === 'awaiting_review' ? overview?.reviewCards[final.id] ?? [] : final.runIds.map(id => runs.find(item => item.id === id)).filter((item): item is LoopRun => !!item);
    const reviewed = cards.filter(item => item.feedback?.referenceChecked).length;
    const canReport = final.status === 'awaiting_review' && cards.length === final.caseIds.length * 2 && reviewed === cards.length;
    const result = final.result;
    return <div className="fl-final-body"><div className="fl-section-heading"><div><span className="fl-eyebrow">FROZEN COMPARISON</span><h3>Twenty unseen products</h3></div><Badge tone={final.status === 'reported' ? 'green' : final.status === 'interrupted' ? 'red' : 'amber'}>{final.status.replaceAll('_', ' ')}</Badge></div>
      <p className="fl-muted">{final.reason}</p><p className="fl-help">Corpus {final.corpusVersion} · manifest {final.manifestSha256.slice(0, 16)} · {cards.length}/{final.caseIds.length * 2} answers saved</p>
      {result && <div className="fl-final-report"><h3>{mode === 'fixture' ? 'Synthetic report demonstration' : result.verdict.replaceAll('_', ' ')}</h3><div className="fl-final-metrics"><div><span>Original supported & correct</span><strong>{result.baselineCorrect}/{final.caseIds.length}</strong></div><div><span>Updated supported & correct</span><strong>{result.candidateCorrect}/{final.caseIds.length}</strong></div><div><span>Improved / regressed / tied</span><strong>{result.wins} / {result.losses} / {result.ties}</strong></div><div><span>Paired difference</span><strong>{result.pairedDifferencePoints > 0 ? '+' : ''}{result.pairedDifferencePoints.toFixed(1)} points</strong></div></div><p>Exploratory paired bootstrap 95% interval: {result.interval95[0].toFixed(1)} to {result.interval95[1].toFixed(1)} points. Product selection is purposive; this interval does not establish population performance.</p><p>Model-marked answered: {result.baselineAnswered} → {result.candidateAnswered}. Responses with unsupported content: {result.baselineUnsupported} → {result.candidateUnsupported}. Median latency: {duration(result.baselineMedianMs)} → {duration(result.candidateMedianMs)}. Tokens: {result.baselineTokens ?? 'unknown'} → {result.candidateTokens ?? 'unknown'}. Actual billed cost: unavailable.</p></div>}
      <div className="fl-final-cases">{final.caseIds.map((caseId, index) => { const pair = cards.filter(card => card.caseId === caseId); return <details key={caseId}><summary>{index + 1}. {pair[0]?.question ?? caseId} <small>{pair.filter(card => card.feedback).length}/2 reviewed</small></summary><div className="fl-validation-pair">{pair.map(card => <div key={card.id}><div className="fl-pair-heading"><strong>{card.blindLabel ?? (card.policyId === final.baselineId ? 'Original' : 'Updated')}</strong><Badge tone={card.feedback ? card.feedback.correct && card.feedback.supported ? 'green' : 'red' : ''}>{card.feedback ? card.feedback.correct && card.feedback.supported ? 'Supported & correct' : 'Issue found' : 'Needs review'}</Badge></div><p>{card.answer?.answer ?? card.error ?? 'No answer saved.'}</p><button className="fl-text-button" disabled={card.status !== 'completed'} onClick={() => openRun(card.id)}>{card.feedback ? 'Inspect answer & review' : 'Review answer'} <Arrow /></button></div>)}</div></details>; })}</div>
      {final.status === 'awaiting_review' && <div className="fl-validation-footer"><span>{reviewed}/{final.caseIds.length * 2} reviewed · identities hidden until report</span><button className="fl-button fl-button-primary" disabled={busy || !canReport} onClick={() => mutate<LoopFinal>('Computing the final comparison…', `/api/loop/final/${final.id}/report`, {}, () => setNotice('Final report saved. The identities and paired outcomes are now visible.'))}>Reveal final report <Arrow /></button></div>}
    </div>;
  }

  return <div className="fl-app">
    <nav className="fl-nav" aria-label="Main navigation"><a className="fl-brand" href="/loop"><span className="fl-logo" aria-hidden="true">a<span>↗</span></span>ablatrix<span className="fl-nav-label">Feedback lab</span></a><div className="fl-nav-right"><a href="/ask">Product QA ↗</a><a href="/pilot">Retrieval pilot ↗</a><span className="fl-local"><i />LOCALHOST</span></div></nav>
    <main className="fl-main">
      <header className="fl-project-head"><div><span className="fl-eyebrow">ABLATRIX / LOCAL EXPERIMENT WORKSPACE</span><h1>Evidence to decision</h1><p>Inspect saved answers, the policy change they prompted, and the test that rejected it.</p></div><div className="fl-project-state"><span>ACTIVE {mode.toUpperCase()} POLICY</span><strong>{overview ? <PolicyName policy={activePolicy} overview={overview} /> : 'Loading'}</strong><small>{mode === 'live' ? 'Recorded live evidence' : 'Synthetic mechanism exercise'}</small></div></header>

      <div className="fl-toolbar"><div className="fl-mode-switch" aria-label="Execution mode"><button className={mode === 'fixture' ? 'fl-selected' : ''} aria-pressed={mode === 'fixture'} disabled={busy} onClick={() => changeMode('fixture')}>Synthetic demo</button><button className={mode === 'live' ? 'fl-selected' : ''} aria-pressed={mode === 'live'} disabled={busy} onClick={() => changeMode('live')}>Live experiment</button></div><a className="fl-export" href="/api/loop/export" download>Export evidence <span aria-hidden="true">↓</span></a></div>
      <div className={`fl-disclosure ${mode === 'live' ? 'fl-disclosure-live' : ''}`}><span aria-hidden="true">{mode === 'fixture' ? '◇' : '◉'}</span><p>{mode === 'fixture' ? <><strong>Synthetic demo:</strong> answers and feedback outcomes do not establish model improvement.</> : <><strong>Recorded live experiment:</strong> Saved evidence is available. {usedValidationProducts.size}/{validationProductCount} validation products used across app and imported experiments. {overview?.readiness.ready ? 'New live calls are configured.' : 'New live calls are currently unavailable.'}</>}</p></div>
      {loading && <p role="status" className="fl-loading">Loading saved policies and experiment evidence…</p>}
      {error && <div className="fl-alert" role="alert"><div><strong>Something needs attention</strong><p>{error}</p></div><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {notice && <div className="fl-notice" role="status"><span>{notice}</span>{view === 'answer' && <button className="fl-text-button" onClick={() => setView(selectedRun?.finalId ? 'final' : selectedRun?.validationId ? 'validate' : 'improve')}>{selectedRun?.finalId ? 'Back to final evaluation' : selectedRun?.validationId ? 'Back to validation' : 'Propose an update'} <Arrow /></button>}</div>}
      {busy && <div className="fl-busy" role="status"><span className="fl-pulse" />{pending || 'An experiment is running. Progress is saved locally.'}</div>}

      {mode === 'live' && overview && (recordedValidation || overview.externalComparisons?.length) && <section className="fl-story" aria-label="Recorded experiments"><div><span className="fl-eyebrow">RECORDED EXPERIMENTS</span><strong>Follow each saved decision.</strong><small>Replay saved records; no model calls.</small></div>{recordedValidation && <div className="fl-story-group"><span>Official policy round · {recordedValidation.status}</span><div className="fl-story-steps">{recordedFailure && <button onClick={() => openRun(recordedFailure.id)}>Reviewed failure</button>}{recordedPolicy && <button onClick={() => { setSelectedPolicyId(recordedPolicy.id); setView('improve'); setLink({ mode, view: 'improve' }); }}>Candidate policy</button>}<button onClick={() => openComparison(recordedValidation.id)}>Validation decision</button></div></div>}{overview.externalComparisons?.[0] && <div className="fl-story-group"><span>Separate exploratory round · AI assessment only</span><div className="fl-story-steps"><button onClick={() => openComparison(overview.externalComparisons![0].id)}>Inspect paired answers</button></div></div>}</section>}
      <nav className="fl-tabs" aria-label="Feedback loop stages">{([{ id: 'answer', number: '01', label: 'Answer & review' }, { id: 'compare', number: '02', label: 'Compare answers' }, { id: 'improve', number: '03', label: 'Policy change' }, { id: 'validate', number: '04', label: 'Decision' }, { id: 'final', number: '05', label: 'Final evaluation' }, { id: 'history', number: '↺', label: 'History' }] as const).map(item => <button key={item.id} aria-current={view === item.id ? 'page' : undefined} className={view === item.id ? 'fl-tab-active' : ''} onClick={() => { setView(item.id); setLink(item.id === 'answer' && selectedRun ? { mode, run: selectedRun.id } : item.id === 'compare' && comparisonId ? { mode, card: comparisonId, case: comparisonCaseId } : { mode, view: item.id }); }}><span>{item.number}</span>{item.label}</button>)}</nav>

      {view === 'compare' && overview && <>{comparisonId ? (overview.externalComparisons?.find(item => item.id === comparisonId) ? <ExploratoryComparison overview={overview} comparison={overview.externalComparisons.find(item => item.id === comparisonId)!} caseId={comparisonCaseId} selectCase={id => openComparison(comparisonId, id)} /> : <Comparison overview={overview} comparisonId={comparisonId} caseId={comparisonCaseId} openRun={openRun} selectCase={id => openComparison(comparisonId, id)} />) : <section className="fl-panel"><span className="fl-eyebrow">SAVED PAIRS</span><h2>Select a recorded comparison</h2><p className="fl-muted">Select a saved baseline and candidate pair. Single development answers are in Answer & review.</p></section>}{otherComparisons.length > 0 && <section className="fl-comparison-index" aria-label="Saved comparisons"><span className="fl-eyebrow">OTHER SAVED COMPARISONS</span>{otherComparisons.map(item => <button className="fl-comparison-choice" key={item.id} onClick={() => openComparison(item.id)}>{'cases' in item ? `Exploratory live · ${item.cases.length} pairs · AI assessment only` : `${dateLabel(item.createdAt)} · ${item.caseIds.length} pairs · ${item.status}`} <Arrow /></button>)}</section>}</>}

      {view === 'answer' && <div className="fl-workspace"><aside className="fl-panel fl-ask"><span className="fl-eyebrow">{liveUnavailable ? 'SAVED DEVELOPMENT ANSWERS' : `NEW QUESTION / ${mode === 'live' ? 'LIVE' : 'SYNTHETIC'}`}</span><h2>{liveUnavailable ? 'Inspect saved answers.' : 'Ask with saved evidence.'}</h2><p className="fl-muted">{liveUnavailable ? 'Live answering is unavailable in this local session. The saved answers remain available for inspection.' : 'This action runs the active policy. Explore saved answers below without generating.'}</p>{!liveUnavailable && <><form onSubmit={event => { event.preventDefault(); mutate<LoopRun>('Retrieving evidence and answering…', '/api/loop/runs', { mode, productId, question: question.trim(), ...(caseId ? { caseId } : {}) }, run => { openRun(run.id); setNotice(run.status === 'completed' ? 'Answer saved. Inspect the evidence, then add your feedback.' : ''); }); }}>
        <label>Product<select value={productId} onChange={event => changeProduct(event.target.value)} disabled={loading || busy}>{!products.length && <option value="">No development products</option>}{products.map(product => <option key={product.id} value={product.id}>{product.title}</option>)}</select></label>
        <label>Development case<select value={caseId} onChange={event => { const value = event.target.value; setCaseId(value); const selected = developmentCases.find(item => item.id === value); if (selected) setQuestion(selected.question); }} disabled={loading || busy}><option value="">Custom question</option>{developmentCases.map(item => <option key={item.id} value={item.id}>{item.question}</option>)}</select></label>
        <label>Question<textarea rows={4} value={question} maxLength={2000} onChange={event => { setQuestion(event.target.value); setCaseId(''); }} disabled={busy} placeholder="What would you like to know about this product?" /></label>
        <button className="fl-button fl-button-primary" disabled={loading || busy || !productId || !question.trim() || liveUnavailable}>Get an answer <Arrow /></button>
      </form><p className="fl-help">Development cases teach the optimizer. Separate products are reserved for validation.</p><div className="fl-batch-launch"><button className="fl-button fl-button-secondary" disabled={loading || busy || !!activeBatch} onClick={() => mutate<LoopBatch>('Running the frozen development batch…', '/api/loop/batches', { mode }, batch => setNotice(`${batch.runIds.length}/${batch.caseIds.length} development answers attempted. Review the saved answers below.`))}>Run all 10 development questions</button><small>{activeBatch ? `${activeBatch.runIds.length}/${activeBatch.caseIds.length} saved · ${activeBatch.status} · manifest ${activeBatch.manifestSha256.slice(0, 12)}` : 'One frozen batch per active policy. Each live question makes a model call.'}</small></div></>}
      {mode === 'live' && priorityReviewCases.some(item => developmentRuns.some(run => run.caseId === item.id)) && <div className="fl-priority-reviews"><strong>Review these saved answers first</strong><small>Opens existing results. No model call.</small>{priorityReviewCases.map(item => { const run = developmentRuns.find(saved => saved.caseId === item.id); return run ? <button type="button" key={item.id} onClick={() => openRun(run.id)}>{item.label}<span>{run.feedback ? 'Reviewed' : 'Needs review'} ↗</span></button> : null; })}</div>}
      {developmentRuns.length > 0 && <div className="fl-saved-runs"><span className="fl-eyebrow">SAVED ANSWERS</span>{developmentRuns.slice(0, 20).map(run => <button key={run.id} className={selectedRun?.id === run.id ? 'fl-run-selected' : ''} onClick={() => openRun(run.id)}><strong>{run.question}</strong><span>{run.feedback ? run.feedback.draftId ? 'Reviewed · AI-assisted' : 'Reviewed' : run.status === 'completed' ? run.reviewDraft ? 'AI draft ready' : 'Needs review' : run.status} · {dateLabel(run.createdAt)}</span></button>)}</div>}</aside>
      <section className="fl-panel fl-answer-panel" aria-label="Answer and feedback">{selectedRun && overview ? <RunDetail key={selectedRun.id} run={selectedRun} overview={overview} disabled={busy} save={saveReview} /> : <div className="fl-empty"><div className="fl-empty-glyph" aria-hidden="true">↗</div><span className="fl-eyebrow">A BETTER NEXT ANSWER STARTS HERE</span><h2>Find a failure worth learning from.</h2><p>Ask a product question, inspect the retrieved evidence,<br className="fl-desktop-break" /> and tell the agent exactly what it missed.</p><div className="fl-empty-steps"><span>01 Answer</span><Arrow /><span>02 Review</span><Arrow /><span>03 Improve</span></div></div>}</section></div>}

      {view === 'improve' && <div className="fl-improve-grid"><section className="fl-panel"><span className="fl-eyebrow">02 / PROPOSE</span><h2>One change. Grounded in feedback.</h2><p className="fl-muted">{liveUnavailable ? 'These saved reviews explain the policy change. New live proposals are unavailable in this local session.' : 'Select reviewed failures from the active policy. The optimizer proposes a revised answer policy and explains its change.'}</p><div className="fl-feedback-selection">{eligibleFeedback.length ? eligibleFeedback.map(run => <label key={run.id}><input type="checkbox" checked={proposalIds.includes(run.id)} disabled={busy || liveUnavailable} onChange={event => setSelectedFeedbackIds(event.target.checked ? [...proposalIds, run.id] : proposalIds.filter(id => id !== run.id))} /><span><strong>{run.question}</strong><small>{categories.find(item => item.value === run.feedback?.category)?.label}</small><p>{run.feedback?.correction}</p></span></label>) : <div className="fl-empty fl-empty-small"><h3>No reviewed failures for this policy yet.</h3><p>Save a source-checked correction on a development answer to start an update.</p><button className="fl-text-button" onClick={() => setView('answer')}>Answer & review <Arrow /></button></div>}</div>{!liveUnavailable && <><button className="fl-button fl-button-primary" disabled={busy || !proposalIds.length || existingCandidate} onClick={() => mutate<LoopPolicy>('Proposing one policy update…', '/api/loop/proposals', { mode, runIds: proposalIds }, policy => { setSelectedPolicyId(policy.id); setNotice('Candidate saved. Inspect the policy change before validating it.'); })}>Propose an update <Arrow /></button><p className="fl-help">{proposalIds.length} reviewed {proposalIds.length === 1 ? 'failure' : 'failures'} selected. This creates a candidate; the active policy stays in use until validation passes.</p>{existingCandidate && <p className="fl-help">A candidate already awaits a decision. Continue to validation before proposing another update.</p>}</>}</section>
      <section className="fl-panel fl-policy-preview"><div className="fl-section-heading"><div><span className="fl-eyebrow">THE PROPOSED CHANGE</span><h2>Inspect before you test.</h2></div>{candidate && <Badge>{candidate.status}</Badge>}</div>{candidate && overview ? <>{candidates.length > 1 && <label className="fl-candidate-select">Candidate<select value={candidate.id} onChange={event => setSelectedPolicyId(event.target.value)}>{candidates.map(item => <option key={item.id} value={item.id}>{shortId(item.id)} · {item.status} · {dateLabel(item.createdAt)}</option>)}</select></label>}<div className="fl-rationale"><span className="fl-eyebrow">WHY THIS CHANGE</span><p>{candidate.rationale}</p></div><div className="fl-policy-diff"><div><span className="fl-eyebrow">PARENT INSTRUCTIONS</span><pre>{parentPolicy?.instructions ?? 'Parent policy unavailable.'}</pre></div><div><span className="fl-eyebrow">CANDIDATE INSTRUCTIONS</span><pre>{candidate.instructions}</pre></div></div><p className="fl-help">Based on {candidate.feedbackRunIds.length} reviewed development {candidate.feedbackRunIds.length === 1 ? 'run' : 'runs'} · {dateLabel(candidate.createdAt)}</p><button className="fl-button fl-button-secondary" onClick={() => setView('validate')}>Continue to validation <Arrow /></button></> : <div className="fl-empty fl-empty-small"><span aria-hidden="true">⌁</span><h3>A proposal will appear here.</h3><p>Compare the current instructions with the candidate and inspect the rationale.</p></div>}</section></div>}

      {view === 'validate' && <section className="fl-panel fl-validation-panel"><div className="fl-section-heading"><div><span className="fl-eyebrow">03 / VALIDATE & RELEASE</span><h2>Does the change earn its place?</h2></div><Badge>Separate validation products</Badge></div><p className="fl-muted">Run the parent and candidate on the same held-back validation questions. Review their evidence, then let the promotion gate accept or reject the update.</p>{candidate ? <>{candidate.status === 'candidate' && !liveUnavailable && <><div className="fl-validation-launch"><label>Candidate policy<select value={candidate.id} onChange={event => setSelectedPolicyId(event.target.value)} disabled={busy}>{candidates.map(item => <option key={item.id} value={item.id}>{shortId(item.id)} · {item.status} · {dateLabel(item.createdAt)}</option>)}</select></label><button className="fl-button fl-button-primary" disabled={busy || liveUnavailable || candidate.status !== 'candidate' || candidateValidations.length > 0 || (reviewedControls.length > 0 && regressionCaseIds.length === 0)} onClick={() => mutate<LoopValidation>('Running paired validation…', `/api/loop/policies/${candidate.id}/validate`, { regressionCaseIds }, () => setNotice(mode === 'fixture' ? 'Synthetic validation saved. Inspect the simulated answers and decision.' : 'Validation answers saved. Review each answer before applying the promotion gate.'))}>Run paired validation <Arrow /></button></div><details className="fl-regression-controls" open={reviewedControls.length > 0 && regressionCaseIds.length === 0}><summary>Regression controls · {regressionCaseIds.length} selected</summary><p className="fl-muted">Choose up to two reviewed correct development questions that this policy must preserve.</p>{reviewedControls.length > 0 && regressionCaseIds.length === 0 && <p className="fl-help" role="status">Select at least one regression control to run validation.</p>}{reviewedControls.length ? reviewedControls.map(run => <label key={run.id}><input type="checkbox" checked={regressionCaseIds.includes(run.caseId!)} disabled={busy || !!candidateValidations.length || (!regressionCaseIds.includes(run.caseId!) && regressionCaseIds.length >= 2)} onChange={event => setRegressionSelection({ key: regressionScope, caseIds: event.target.checked ? [...regressionCaseIds, run.caseId!] : regressionCaseIds.filter(id => id !== run.caseId) })} /><span>{run.question}</span></label>) : <p className="fl-help">No reviewed correct development cases are available yet.</p>}</details></>}<p className="fl-help">A passing update must improve supported correctness on fresh validation products without introducing a regression. The final holdout remains outside this loop.</p>{candidateValidations.length ? candidateValidations.map(renderValidation) : <div className="fl-empty fl-empty-small"><span aria-hidden="true">⇄</span><h3>Put the candidate to the test.</h3><p>The same questions. The same retrieved context.<br />Only the answer policy changes.</p></div>}</> : <div className="fl-empty fl-empty-small"><h3>Create a candidate first.</h3><p>A reviewed failure and a proposed policy update are the starting point.</p><button className="fl-button fl-button-secondary" onClick={() => setView('improve')}>Propose an update <Arrow /></button></div>}</section>}

      {view === 'final' && <section className="fl-panel fl-validation-panel"><div className="fl-section-heading"><div><span className="fl-eyebrow">04 / FINAL EVALUATION</span><h2>Does feedback transfer to new products?</h2></div><Badge>20 unseen products</Badge></div><p className="fl-muted">Compare the original policy with a frozen promoted version. Each product uses the same retrieval for both answers. Human reviewers judge randomized A/B cards before policy identities are revealed.</p>{finals.length ? finals.map(renderFinal) : <div className="fl-final-launch"><p>{holdoutExposed ? 'This final holdout was already exposed by a comparison in the other mode. Use a separate sealed corpus and workspace for another final evaluation.' : 'A promoted policy is required. The live run requires 40 model calls, and the server checks the full local allowance before starting. Historical product evidence and review guidance still need independent audit.'}</p><button className="fl-button fl-button-primary" disabled={busy || holdoutExposed || liveUnavailable || activePolicy?.status !== 'promoted'} onClick={() => mutate<LoopFinal>('Running the 20-product paired comparison…', '/api/loop/final', { mode }, () => setNotice(mode === 'fixture' ? 'Synthetic final comparison saved. The report demonstrates mechanics only.' : 'Forty answers saved. Review each blind card against the source evidence.'))}>Run final paired comparison <Arrow /></button></div>}</section>}

      {view === 'history' && <div className="fl-history-grid"><section className="fl-panel"><span className="fl-eyebrow">VERSION HISTORY</span><h2>Every decision leaves a trail.</h2><p className="fl-muted">Inspect instructions and restore a previously accepted policy in this environment.</p><div className="fl-policy-history">{policies.slice().reverse().map(policy => <article key={policy.id}><div className="fl-section-heading"><div><h3>{overview && <PolicyName policy={policy} overview={overview} />}</h3><small>{dateLabel(policy.createdAt)}</small></div><Badge tone={policy.id === activePolicy?.id ? 'green' : policy.status === 'rejected' ? 'red' : ''}>{policy.id === activePolicy?.id ? 'Active' : policy.status}</Badge></div><p>{policy.rationale}</p><details><summary>View instructions</summary><pre>{policy.instructions}</pre><small>{policy.id}</small></details>{policy.id !== activePolicy?.id && (policy.status === 'baseline' || policy.status === 'promoted') && <button className="fl-text-button" disabled={busy} onClick={() => mutate('Restoring accepted policy…', '/api/loop/rollback', { mode, policyId: policy.id }, () => setNotice('Policy restored. The rollback is recorded in the event history.'))}>Restore this policy ↺</button>}</article>)}</div></section><section className="fl-panel"><span className="fl-eyebrow">EVENT LOG</span><h2>The experiment, recorded.</h2><ol className="fl-events">{overview?.events.filter(event => !event.policyId || policies.some(policy => policy.id === event.policyId)).map(event => <li key={event.id}><span className="fl-event-dot" /><time dateTime={event.at}>{dateLabel(event.at)}</time><strong>{event.kind.replaceAll('_', ' ')}</strong><p>{event.message}</p></li>)}</ol>{!overview?.events.length && <p className="fl-muted">Events appear as you answer, review, and update.</p>}</section></div>}

      {view === 'history' && <LoopTelemetry workflowBusy={busy} />}

      <footer className="fl-footer"><span><strong>ablatrix</strong> / Better answers need evidence.</span><span>{overview ? `${overview.corpus.passageCount} passages · ${overview.corpus.license}` : 'Local experiment workspace'}</span></footer>
    </main>
  </div>;
}
