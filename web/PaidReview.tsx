import React, { useEffect, useState } from 'react';
import type { PaidReview as SavedReview, PaidAiDraft } from '../server/paid-answer-review.ts';
import type { RevisionContext, RevisionSource } from '../server/answer-revisions.ts';
import type { InvestigationIssue, InvestigationTrace } from '../server/revision-investigation.ts';
import './paid-review.css';
import { useDemoSession } from './DemoSession';

type ReviewCase = { qid: string; asin: string; title: string; question: string; sources: { label: string; text: string; sha256: string; originalQuestion: string | null }[];
  result: { run: { answer: { answer: string; status: string; citations: { passageId: string; quote: string }[] }; retrieval: { passages: { id: string; sha256: string; text: string; reference: string }[] }; model: string }; clientMs: number | null }; review: SavedReview | null; historicalReview: SavedReview | null; aiDraft: PaidAiDraft | null };
type ReviewOverview = { manifestSha256: string; cases: ReviewCase[]; summary: { total: number; reviewed: number; historicalReviewed: number; historicalCorrect: number; historicalIncorrect: number; historicalUncertain: number; judged: number; correct: number; incorrect: number; uncertain: number; aiDrafts: number; categories: Record<string, number> } };
export type RevisionVersion = { mode?: 'live' | 'synthetic'; id: string; parentId: string | null; answer: { answer: string; status: string; citations: { passageId: string; quote: string }[] }; model: string; createdAt: string; context?: RevisionContext; contextProvenance?: 'workspace_source_snapshot' | 'saved_retrieval_only'; generationSourceIds?: string[]; investigation?: InvestigationTrace };
type RevisionJob = { mode?: 'live' | 'synthetic'; reviewKind?: 'human' | 'ai_assisted'; id: string; status: string; feedback: string; error?: string; createdAt: string; finishedAt?: string; versionId?: string; context?: RevisionContext; phase?: string; investigation?: InvestigationTrace; externalUsage?: {kind:string;status:string;planningAllowanceUsd:number}[] };
export type RevisionCase = { mode?: 'live' | 'synthetic'; qualityClaimEligible?: boolean; qid: string; generationAttempts?: number; versions: RevisionVersion[]; jobs: RevisionJob[]; events: { mode?: 'live' | 'synthetic'; reviewKind?: 'human' | 'ai_assisted'; qualityClaimEligible?: boolean; kind: string; versionId: string; note: string; reviewer: string }[] };
export type RevisionOverview = { cases: RevisionCase[]; ready: number; pending: number; readiness: {ready:boolean;reason:string}; investigationReadiness?:{ready:boolean;reason:string}; summary: { syntheticOperations?:number; syntheticAccepted?:number; liveAccepted?:number; requested:number; accepted:number; unresolved:number; providerCalls:number; answerCalls?:number;searchAndReadCalls?:number; planningAllowanceUsd:number; actualProviderCharges:string } };
const categories = [
  ['none', 'No issue'], ['unsupported_claim', 'Unsupported claim'], ['incomplete_answer', 'Incomplete answer'],
  ['missed_evidence', 'Missed evidence'], ['source_conflict', 'Source conflict'],
  ['unnecessary_abstention', 'Unnecessary abstention'], ['other', 'Other']
];
const label = (value: string) => value.replaceAll('_', ' ');
type RevisionPanelItem = Pick<ReviewCase, 'qid' | 'sources'>;
const sourcesForVersion = (item: RevisionPanelItem, version?: RevisionVersion): RevisionSource[] => version?.context?.sources ?? item.sources.map(source => ({ ...source, id: `${item.qid}:${source.sha256}`, origin: 'pinned' }));
function ChangedText({before,after}:{before:string;after:string}) {
  const a=before.split(/(\s+)/),b=after.split(/(\s+)/);let start=0,end=0;
  while(start<a.length && start<b.length && a[start]===b[start]) start++;
  while(end<a.length-start && end<b.length-start && a[a.length-1-end]===b[b.length-1-end]) end++;
  return <>{b.slice(0,start).join('')}<mark>{b.slice(start,b.length-end).join('')}</mark>{end ? b.slice(b.length-end).join('') : ''}</>;
}

function InvestigationPanel({trace, sources}:{trace:InvestigationTrace;sources:RevisionSource[]}) {
  return <aside className="pr-investigation" aria-label="Source investigation"><h4>Source investigation <small>Rule-based diagnosis</small></h4><p><strong>{trace.status === 'ready_to_revise' ? 'Candidate sources selected for revision' : label(trace.status)}</strong> · {label(trace.issue)}</p>{trace.stopReason && <p>{trace.stopReason}</p>}{trace.clarificationQuestion && <p className="pr-clarification"><strong>Information needed:</strong> {trace.clarificationQuestion}</p>}<p>{trace.addedSourceIds.length ? `${trace.addedSourceIds.length} source excerpt(s) retrieved.` : trace.newEvidence ? 'Newly supplied source candidates selected.' : 'No new source evidence added.'} Sources still need to support the revised answer's claims.</p><details><summary>See search and source decisions</summary><p>Query: {trace.query}</p><ol>{trace.steps.map((step,i)=><li key={i}><strong>{label(step.kind)} · {step.status}</strong><p>{step.detail}</p>{step.url && <small>{step.url}</small>}</li>)}</ol><p>Selected: {trace.selectedSourceIds.map(id=>sources.find(source=>source.id===id)?.label ?? id).join('; ') || 'none'}</p></details></aside>;
}

export function RevisionPanel({ item, state, refresh, endpoint = '/api/paid-review', allowOriginalDecision = false }: { item: RevisionPanelItem; state?: RevisionCase; refresh: () => Promise<void>; endpoint?: string; allowOriginalDecision?: boolean }) {
  const session = useDemoSession();
  const canRequest = !session.hosted || session.actor?.role === 'operator';
  const canDecide = !session.hosted || session.actor?.role === 'reviewer' || session.actor?.role === 'operator';
  const synthetic = state?.mode === 'synthetic' || state?.versions[0]?.mode === 'synthetic';
  const [feedback, setFeedback] = useState(''); const [reviewer, setReviewer] = useState(session.actor?.reviewer ?? ''); const [note, setNote] = useState(''); const [checked, setChecked] = useState<string[]>([]);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [issue, setIssue] = useState<InvestigationIssue>('auto');
  const [clarification, setClarification] = useState('');
  const [sourceLabel, setSourceLabel] = useState(''); const [sourceText, setSourceText] = useState('');
  const [sourceReference, setSourceReference] = useState(''); const [sourceQuestion, setSourceQuestion] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const latest = state?.versions.at(-1), job = state?.jobs.at(-1);
  const sources = sourcesForVersion(item, latest);
  const reviewSources = latest?.investigation ? sources.filter(source => latest.investigation!.selectedSourceIds.includes(source.id)) : sources;
  const addingSource = !!(sourceLabel.trim() || sourceText.trim() || sourceReference.trim() || sourceQuestion.trim());
  const sourceIncomplete = addingSource && (sourceLabel.trim().length < 2 || sourceText.trim().length < 30);
  const accepted = state?.events.some(event => event.kind === 'accept' && event.versionId === latest?.id);
  const decided = state?.events.some(event => ['accept','needs_information'].includes(event.kind) && event.versionId === latest?.id);
  const newerRequest = !!job && job.versionId !== latest?.id;
  const checkedForAcceptance = checked.length > 0 && (!allowOriginalDecision || (state?.versions.length ?? 0) > 1 || !latest?.answer.citations.length || sources.some(source => checked.includes(source.sha256) && latest.answer.citations.some(citation => citation.passageId === source.id)));
  async function submit(path: string, payload: object) { setBusy(true); setError(''); try { const response = await fetch(`${endpoint}/${encodeURIComponent(item.qid)}/${path}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Action failed.'); await refresh(); if(path==='revisions') setRequestKey(crypto.randomUUID()); } catch(reason) { setError(reason instanceof Error ? reason.message : 'Action failed.'); } finally { setBusy(false); } }
  if (!latest || !state) return null;
  return <section className="pr-revision" aria-label={state.versions.length > 1 ? 'Revised answer for review' : 'Answer revision'}><h3>{accepted ? 'Review recorded' : state.versions.length > 1 ? 'Recheck the revised answer' : allowOriginalDecision ? 'Review or improve this answer' : 'Reject and improve'}</h3><p>{accepted ? 'This answer was accepted by a reviewer. Its saved versions and review notes remain available.' : state.versions.length > 1 ? 'Compare the new answer with the original. Check the source text below before using the decision controls in this panel.' : synthetic ? 'Scripted revisions run in the background using saved sources only. No model calls or planning reservations are made.' : 'Revisions run in the background under the shared local call allowance. Review other answers while this case is queued.'}</p>
    {synthetic && <p className="pr-clarification"><strong>Synthetic answer and correction.</strong> Your review is a human decision on a scripted example and is excluded from live quality claims.</p>}
    {job?.reviewKind === 'ai_assisted' && <p className="pr-clarification"><strong>AI-authored development feedback.</strong> {decided ? 'A human decision is recorded below.' : 'Human decision pending.'}</p>}
    {job && <p className="pr-job"><strong>{job.status === 'ready' ? 'Ready to recheck' : job.status === 'running' && job.phase === 'investigation' ? 'Investigating sources' : label(job.status)}</strong> · Requested {new Date(job.createdAt).toLocaleString()}{job.error && <> · {job.error}</>}{!!job.externalUsage?.length && <> · {job.externalUsage.length} search/read call(s)</>}</p>}
    {(job?.investigation ?? latest.investigation) && <InvestigationPanel trace={(job?.investigation ?? latest.investigation)!} sources={job?.context?.sources ?? sources} />}
    {job?.context && !job.versionId && <details className="pr-add-context"><summary>Information saved for this revision request</summary><p>This request has not produced a new answer yet. Its additional information will carry into another attempt.</p>{job.context.clarifications.map((entry,i) => <p key={i}>Customer clarification from {entry.reviewer}: {entry.text}</p>)}{job.context.sources.filter(source => source.origin === 'reviewer_added').map(source => <div key={source.id}><strong>{source.label}</strong><p>{source.text}</p>{source.originalQuestion && <p>Original customer question: {source.originalQuestion}</p>}<p>Provided by {source.addedBy}{source.reference ? ` · ${source.reference}` : ''}</p></div>)}</details>}
    {latest.context?.clarifications.map((entry,i) => <p className="pr-event" key={`clarification-${i}`}><strong>Customer clarification</strong> from {entry.reviewer}: {entry.text}</p>)}
    {state.versions.length > 1 && <div className="pr-compare"><div><strong>Previous answer</strong><p>{state.versions.at(-2)?.answer.answer}</p></div><div><strong>Revised answer · {latest.model}</strong><p><ChangedText before={state.versions.at(-2)?.answer.answer ?? ''} after={latest.answer.answer} /></p><small>{latest.answer.status} · changed text highlighted</small>{latest.answer.citations.map((citation,i) => { const source = sources.find(s => citation.passageId === s.id); return <a key={i} href={`#source-${source?.sha256}`} className="pr-quote-link">{source?.label ?? 'Source'}: “{citation.quote}”</a>; })}</div></div>}
    {state.events.map((event,i) => <p className="pr-event" style={{ overflowWrap: 'anywhere' }} key={i}>{event.reviewKind === 'ai_assisted' && 'AI-authored feedback · '}{label(event.kind)} by {event.reviewer}: {event.note}</p>)}
    {canRequest && !accepted && !['queued','running','reconciliation'].includes(job?.status ?? '') && (state.generationAttempts ?? state.jobs.length) < 2 && <form aria-label="Request answer revision" onSubmit={event => { event.preventDefault(); void submit('revisions',{ versionId:latest.id, idempotencyKey:requestKey, reviewer, feedback, investigate:true, issue, ...(clarification.trim() ? { clarification:clarification.trim() } : {}), ...(addingSource ? { additionalSources:[{label:sourceLabel.trim(),text:sourceText.trim(),...(sourceReference.trim() ? {reference:sourceReference.trim()} : {}),...(sourceQuestion.trim() ? {originalQuestion:sourceQuestion.trim()} : {})}] } : {}) }); }}><label className="pr-field">What needs fixing?<select value={issue} onChange={event=>setIssue(event.target.value as InvestigationIssue)}><option value="auto">Suggest from my feedback</option><option value="wrong_model">Wrong model or product context</option><option value="missing_evidence">Missing compatibility or other facts</option><option value="conflicting_sources">Sources disagree</option><option value="missed_source">A useful source was missed</option><option value="answer_quality">Answer clarity or unsupported wording</option></select></label><label className="pr-field">What is wrong or missing?<textarea rows={3} maxLength={2000} value={feedback} onChange={event => setFeedback(event.target.value)} placeholder={synthetic ? "Describe the flaw. The workflow will select saved excerpts for a scripted correction." : "Describe the flaw. The agent will inspect sources before revising."} /></label>
      <details className="pr-add-context"><summary>Add missing information or a source</summary><p>A revision uses saved sources. Add a model clarification or paste a relevant source excerpt when those sources cannot answer the question. A URL alone does not supply new facts.</p><label className="pr-field">Customer clarification (optional)<input maxLength={500} value={clarification} onChange={event => setClarification(event.target.value)} placeholder="For example, the refrigerator's full model number" /></label><label className="pr-field">New source label<input maxLength={80} value={sourceLabel} onChange={event => setSourceLabel(event.target.value)} placeholder="For example, a model-specific parts manual" /></label><label className="pr-field">Source reference (optional)<input maxLength={500} value={sourceReference} onChange={event => setSourceReference(event.target.value)} placeholder="Document title, page, or URL" /></label><label className="pr-field">New source text<textarea rows={4} maxLength={2000} value={sourceText} onChange={event => setSourceText(event.target.value)} placeholder="Paste the actual excerpt, including model and part numbers." /></label><label className="pr-field">Original question for new Q&A source (optional)<input maxLength={500} value={sourceQuestion} onChange={event => setSourceQuestion(event.target.value)} /></label></details>
      <label className="pr-field">Revision reviewer name<input value={reviewer} readOnly={session.hosted} onChange={event => setReviewer(event.target.value)} /></label><button className="pr-save" disabled={busy || sourceIncomplete || feedback.trim().length < 10 || reviewer.trim().length < 2}>Investigate and revise</button></form>}
    {(allowOriginalDecision || state.versions.length > 1) && newerRequest && <p className="pr-clarification">This answer has a newer revision request. Its investigation must produce a new answer before acceptance is available.</p>}
    {canDecide && (allowOriginalDecision || state.versions.length > 1) && !newerRequest && !decided && !['queued','running','reconciliation'].includes(job?.status ?? '') && <form aria-label="Review answer decision" onSubmit={event => event.preventDefault()}><h4>Record your decision</h4><p>Check the source text and select the sources you checked before accepting this answer.</p><label className="pr-field">Review note<input value={note} onChange={event => setNote(event.target.value)} /></label><label className="pr-field">Revision reviewer name<input value={reviewer} readOnly={session.hosted} onChange={event => setReviewer(event.target.value)} /></label><div className="pr-checks">{reviewSources.map(source => <label key={source.id}><input type="checkbox" checked={checked.includes(source.sha256)} onChange={event => setChecked(old => event.target.checked ? [...old,source.sha256] : old.filter(s => s !== source.sha256))} /> {source.label}</label>)}</div><button type="button" className="pr-save" disabled={busy || !checkedForAcceptance || reviewer.trim().length < 2} onClick={() => void submit('decisions',{versionId:latest.id,reviewer,decision:'accept',note,checkedSourceShas:checked})}>{state.versions.length > 1 ? 'Accept revision' : 'Accept answer'}</button> <button type="button" disabled={busy || !checked.length || reviewer.trim().length < 2} onClick={() => void submit('decisions',{versionId:latest.id,reviewer,decision:'needs_information',note,checkedSourceShas:checked})}>Mark missing information</button></form>}
    {error && <p className="pr-error" role="alert">{error}</p>}
  </section>;
}

function ReviewForm({ item, saved, refresh, checked }: { item: ReviewCase; saved: SavedReview | null; refresh: () => Promise<void>; checked: string[] }) {
  const [reviewer, setReviewer] = useState('');
  const [answerVerdict, setAnswerVerdict] = useState('');
  const [supportVerdict, setSupportVerdict] = useState('');
  const [category, setCategory] = useState('none');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`/api/paid-review/${item.qid}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewer, answerVerdict, supportVerdict, category, checkedSourceShas: checked, note, referenceChecked: confirmed }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Could not save review.');
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save review.'); }
    finally { setBusy(false); }
  }
  if (saved) return <section className="pr-verdict" aria-label="Saved review"><span>REVIEW SAVED · {new Date(saved.createdAt).toLocaleString()}</span><strong>{label(saved.answerVerdict)} · {label(saved.supportVerdict)}</strong><p>{saved.note || 'No correction needed.'}</p><small>{label(saved.category)} · {saved.reviewer} · {saved.checkedSourceShas.length} checked source{saved.checkedSourceShas.length === 1 ? '' : 's'}</small></section>;
  return <form className="pr-form" onSubmit={submit}>
    {item.aiDraft && <aside className="pr-ai-draft"><span>AI SOURCE READ · SUGGESTION ONLY</span><strong>{label(item.aiDraft.answerVerdict)} · {label(item.aiDraft.supportVerdict)} · {item.aiDraft.confidence} confidence</strong><p>{item.aiDraft.note}</p><small>Based on {item.aiDraft.sourceShas.length} supplied sources. This does not count as a human review.</small><button type="button" onClick={() => { setAnswerVerdict(item.aiDraft!.answerVerdict); setSupportVerdict(item.aiDraft!.supportVerdict); setCategory(item.aiDraft!.category); setNote(item.aiDraft!.note); }}>Prefill my review fields</button></aside>}
    <h3>Record a source checked judgment</h3><p>Read the full source text. A citation matching a passage does not prove the answer is correct.</p>
    <div className="pr-form-grid"><fieldset><legend>Answer correctness</legend>{['correct', 'incorrect', 'uncertain'].map(value => <label key={value}><input type="radio" name={`answer-${item.qid}`} checked={answerVerdict === value} onChange={() => { setAnswerVerdict(value); if (value === 'correct') { setSupportVerdict('supported'); setCategory('none'); setNote(''); } else setCategory('other'); }} />{label(value)}</label>)}</fieldset>
      <fieldset><legend>Claim support</legend>{['supported', 'unsupported', 'uncertain'].map(value => <label key={value}><input type="radio" name={`support-${item.qid}`} checked={supportVerdict === value} disabled={answerVerdict === 'correct' && value !== 'supported'} onChange={() => setSupportVerdict(value)} />{label(value)}</label>)}</fieldset></div>
    <label className="pr-field">Failure category<select value={category} onChange={event => setCategory(event.target.value)} disabled={answerVerdict === 'correct'}>{categories.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
    <label className="pr-field">Correction or uncertainty note<textarea value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={2000} placeholder="Which claim is wrong or missing? What does the source actually support?" /></label>
    <label className="pr-field">Reviewer name<input value={reviewer} onChange={event => setReviewer(event.target.value)} maxLength={100} placeholder="Your name" /></label>
    <label className="pr-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I checked the selected source text before judging this answer.</label>
    {error && <p className="pr-error" role="alert">{error}</p>}
    <button className="pr-save" disabled={busy || !confirmed || !answerVerdict || !supportVerdict || reviewer.trim().length < 2 || checked.length === 0 || (answerVerdict !== 'correct' && note.trim().length < 10)}>{busy ? 'Saving…' : 'Save review'}</button>
  </form>;
}

export default function PaidReview() {
  const [data, setData] = useState<ReviewOverview | null>(null);
  const [revisions, setRevisions] = useState<RevisionOverview | null>(null);
  const [qid, setQid] = useState('');
  const [checkedByQid, setCheckedByQid] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');
  async function refresh() {
    const [response, revisionResponse] = await Promise.all([fetch('/api/paid-review'), fetch('/api/paid-review/revisions')]);
    const [value, revisionValue] = await Promise.all([response.json(), revisionResponse.json()]);
    if (!response.ok) throw new Error(value.error ?? 'Could not load saved batch.');
    if (!revisionResponse.ok) throw new Error(revisionValue.error ?? 'Could not load revisions.');
    setRevisions(revisionValue);
    setData(value);
  }
  useEffect(() => { refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load saved batch.')); }, []);
  useEffect(() => { if (!revisions?.pending) return; const timer = setInterval(() => { refresh().catch(() => {}); }, 2500); return () => clearInterval(timer); }, [revisions?.pending]);
  useEffect(() => {
    if (!data || !revisions) return;
    const syncSelection = () => {
      const url = new URL(window.location.href);
      const requested = url.searchParams.get('qid');
      const ready = revisions.cases.find(item => item.jobs.at(-1)?.status === 'ready' && item.versions.length > 1 && data.cases.some(saved => saved.qid === item.qid));
      const next = data.cases.find(item => item.qid === requested)?.qid ?? ready?.qid ?? data.cases[0]?.qid ?? '';
      setQid(next);
      if (next && requested !== next) {
        url.searchParams.set('qid', next);
        window.history.replaceState(window.history.state, '', url);
      }
    };
    syncSelection();
    window.addEventListener('popstate', syncSelection);
    return () => window.removeEventListener('popstate', syncSelection);
  }, [data, revisions]);
  function selectCase(next: string) {
    if (!data?.cases.some(item => item.qid === next)) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('qid') !== next) {
      url.searchParams.set('qid', next);
      window.history.pushState(window.history.state, '', url);
    }
    setQid(next);
  }
  const selected = data?.cases.find(item => item.qid === qid);
  const selectedRevision = revisions?.cases.find(item => item.qid === qid);
  const selectedVersion = selectedRevision?.versions.at(-1);
  const selectedSources = selected ? sourcesForVersion(selected, selectedVersion) : [];
  const hasRevisedAnswer = (selectedRevision?.versions.length ?? 0) > 1;
  const showRevisionFirst = hasRevisedAnswer || !!selectedRevision?.jobs.at(-1)?.investigation;
  const latestCitations = hasRevisedAnswer ? selectedRevision?.versions.at(-1)?.answer.citations ?? [] : null;
  const cited = new Set(selected?.result.run.answer.citations.map(item => item.passageId) ?? []);
  const readyCase = revisions?.cases.find(item => item.jobs.at(-1)?.status === 'ready' && item.versions.length > 1);
  const reviewed = data?.summary.reviewed ?? 0;
  return <div className="pr-app"><nav className="ask-nav" aria-label="Main navigation"><a className="ask-brand" href="/ask"><span>a↗</span> ablatrix <small>Answer review</small></a><div><a href="/ask">Product QA ↗</a><a href="/review">Workspace review ↗</a><a href="/loop">Feedback lab ↗</a><span className="ask-local">LOCAL EVIDENCE</span></div></nav>
    <main className="pr-main"><header className="pr-hero"><span>20 SAVED PAID ANSWERS · PINNED TRAIN SPLIT</span><h1>Check the answer,<br />not just the quote.</h1><p>Review the pinned answers and request a bounded background revision for a flawed answer.</p></header>
      {error && <p className="pr-error" role="alert">{error}</p>}
      {data && <><div className="pr-metrics"><div><strong>{reviewed}/{data.summary.total}</strong><span>source checked reviews</span></div><div><strong>{data.summary.correct}/{data.summary.judged}</strong><span>correct among decisive reviews</span></div><div><strong>{data.summary.uncertain}</strong><span>uncertain reviews</span></div><div><strong>{data.summary.incorrect}</strong><span>reviewed incorrect</span></div></div>
        <p className="pr-caveat">These are judgments on a small, deliberately curated train split. They are not a population accuracy estimate or evidence that a candidate improved on baseline. <a href="/api/paid-review/export">Export review packet ↗</a></p>
        <p className="pr-ai-status"><strong>{data.summary.aiDrafts}/20 AI suggestions prepared.</strong> Human reviews remain {reviewed}/20. AI drafts never enter the correctness score or policy promotion gate.</p>
        {data.summary.historicalReviewed > 0 && <p className="pr-ai-status"><strong>{data.summary.historicalReviewed} historical human reviews saved: {data.summary.historicalCorrect} correct, {data.summary.historicalIncorrect} incorrect, {data.summary.historicalUncertain} uncertain.</strong> These were recorded before original customer questions were restored. Their notes remain visible on each card; confirm or correct them with a new source checked review under the current protocol.</p>}
        {revisions && <p className="pr-ai-status"><strong>{revisions.ready} ready to recheck · {revisions.pending} pending.</strong> {readyCase && <button type="button" className="pr-ready-link" onClick={() => selectCase(readyCase.qid)}>Open revised answer for Q{readyCase.qid} ↗</button>} {revisions.readiness.ready ? 'Background dispatch is available.' : revisions.readiness.reason} {revisions.summary.accepted} accepted · {revisions.summary.unresolved} unresolved · {revisions.summary.providerCalls} provider calls · ${revisions.summary.planningAllowanceUsd.toFixed(2)} planning allowance. Actual charges unavailable.</p>}
        {revisions?.investigationReadiness && <p className="pr-ai-status">Saved sources can be investigated before generation. {revisions.investigationReadiness.reason} · {revisions.summary.searchAndReadCalls ?? 0} search/read calls.</p>}
        <div className="pr-failures"><strong>Failure patterns</strong>{Object.entries(data.summary.categories).filter(([, count]) => count > 0).length ? <div>{Object.entries(data.summary.categories).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).map(([category, count]) => <span key={category}>{label(category)} <b>{count}</b></span>)}</div> : <p>Source checked reviews will show the most common issues here.</p>}</div>
        <div className="pr-layout"><aside className="pr-queue" aria-label="Answer review queue"><div className="pr-queue-head"><strong>Answer queue</strong><span>{data.summary.total - reviewed} waiting</span></div>{data.cases.map((item, index) => { const job = revisions?.cases.find(c => c.qid === item.qid)?.jobs.at(-1); return <button key={item.qid} className={item.qid === qid ? 'active' : ''} aria-current={item.qid === qid ? 'true' : undefined} onClick={() => selectCase(item.qid)}><span>{String(index + 1).padStart(2, '0')} · {job?.status === 'ready' ? 'READY TO RECHECK' : job ? label(job.status).toUpperCase() : item.review ? 'HUMAN REVIEWED' : item.historicalReview ? 'HISTORICAL REVIEW' : item.aiDraft ? 'AI DRAFT · HUMAN PENDING' : 'PENDING'}</span><strong>{item.question}</strong><small>{item.title}</small></button>; })}</aside>
          {selected && <div className="pr-detail"><div className="pr-detail-head"><span>QUESTION {selected.qid} · PRODUCT {selected.asin}</span><h2>{selected.question}</h2><p>{selected.title}</p></div>
            {showRevisionFirst && <RevisionPanel key={`revision-${selected.qid}-${selectedVersion?.id}`} item={selected} state={selectedRevision} refresh={refresh} />}
            {!hasRevisedAnswer && <section className="pr-answer"><span>ORIGINAL MODEL ANSWER · {label(selected.result.run.answer.status)}</span><p>{selected.result.run.answer.answer}</p><small>{selected.result.run.model} · {selected.result.run.answer.citations.length} citations · {selected.result.clientMs === null ? 'timing unavailable' : `${(selected.result.clientMs / 1000).toFixed(2)} s client time`}</small></section>}
            <section className="pr-sources"><h3>Source text <small>{hasRevisedAnswer ? 'Citation labels refer to the revised answer. ' : ''}Check at least one before submitting. Original customer Q&A questions are included for revision.</small></h3>{selectedSources.map((source, index) => { const passages = selected.result.run.retrieval.passages.filter(item => item.sha256 === source.sha256 || source.text.includes(item.text)); const isCited = latestCitations ? latestCitations.some(item => item.passageId === source.id) : passages.some(item => cited.has(item.id)); const checked = checkedByQid[selected.qid] ?? []; const revisionQuote = latestCitations?.find(c => c.passageId === source.id)?.quote; const parts = revisionQuote && source.text.includes(revisionQuote) ? source.text.split(revisionQuote) : null; return <article id={`source-${source.sha256}`} key={source.sha256}><div className="pr-source-head"><strong>{index + 1}. {source.label}</strong><span>{isCited ? (hasRevisedAnswer ? 'CITED BY REVISION' : 'CITED') : hasRevisedAnswer ? (selectedVersion?.investigation && !selectedVersion.investigation.selectedSourceIds.includes(source.id) ? 'EXCLUDED FROM REVISION' : 'AVAILABLE TO REVISION') : passages.length ? 'RETRIEVED' : 'NOT RETRIEVED'}</span></div>{source.origin === 'reviewer_added' && <p className="pr-source-provenance">Source added by {source.addedBy}. {source.reference && <>Reference: {source.reference}. </>}Supplied by the reviewer; authority and applicability need checking.</p>}{source.origin === 'agent_retrieved' && <p className="pr-source-provenance">Retrieved by the agent{source.retrievedAt ? ` on ${new Date(source.retrievedAt).toLocaleString()}` : ''}. {source.reference && <span>Source: {source.reference}</span>} This is a candidate source; check its applicability.</p>}{source.originalQuestion && <p className="pr-original-question"><strong>Original customer question:</strong> {source.originalQuestion}</p>}<p>{parts ? <>{parts[0]}<mark>{revisionQuote}</mark>{parts.slice(1).join(revisionQuote)}</> : source.text}</p>{!hasRevisedAnswer && !selected.review && <label className="pr-source-check"><input type="checkbox" checked={checked.includes(source.sha256)} onChange={event => setCheckedByQid(current => { const prior = current[selected.qid] ?? []; return { ...current, [selected.qid]: event.target.checked ? [...prior, source.sha256] : prior.filter(sha => sha !== source.sha256) }; })} /> I checked this source</label>}</article>; })}</section>
            {selected.historicalReview && <section className="pr-verdict"><span>HISTORICAL HUMAN REVIEW · RECONFIRM UNDER CURRENT SOURCE CONTEXT</span><strong>{label(selected.historicalReview.answerVerdict)}</strong><p>{selected.historicalReview.note}</p></section>}
            {!hasRevisedAnswer && <ReviewForm key={selected.qid} item={selected} saved={selected.review} refresh={refresh} checked={checkedByQid[selected.qid] ?? []} />}
            {!showRevisionFirst && <RevisionPanel key={`revision-${selected.qid}-${selectedVersion?.id}`} item={selected} state={selectedRevision} refresh={refresh} />}
          </div>}</div></>}
    </main></div>;
}
