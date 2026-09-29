import React, { useEffect, useState } from 'react';
import type { PaidReview as SavedReview, PaidAiDraft } from '../server/paid-answer-review.ts';
import './paid-review.css';

type ReviewCase = { qid: string; asin: string; title: string; question: string; sources: { label: string; text: string; sha256: string; originalQuestion: string | null }[];
  result: { run: { answer: { answer: string; status: string; citations: { passageId: string; quote: string }[] }; retrieval: { passages: { id: string; sha256: string; text: string; reference: string }[] }; model: string }; clientMs: number | null }; review: SavedReview | null; historicalReview: SavedReview | null; aiDraft: PaidAiDraft | null };
type ReviewOverview = { manifestSha256: string; cases: ReviewCase[]; summary: { total: number; reviewed: number; historicalReviewed: number; historicalCorrect: number; historicalIncorrect: number; historicalUncertain: number; judged: number; correct: number; incorrect: number; uncertain: number; aiDrafts: number; categories: Record<string, number> } };
type RevisionVersion = { id: string; parentId: string | null; answer: { answer: string; status: string; citations: { passageId: string; quote: string }[] }; model: string; createdAt: string };
type RevisionJob = { id: string; status: string; feedback: string; error?: string; createdAt: string; finishedAt?: string };
type RevisionCase = { qid: string; versions: RevisionVersion[]; jobs: RevisionJob[]; events: { kind: string; versionId: string; note: string; reviewer: string }[] };
type RevisionOverview = { cases: RevisionCase[]; ready: number; pending: number; readiness: {ready:boolean;reason:string}; summary: { requested:number; accepted:number; unresolved:number; providerCalls:number; planningAllowanceUsd:number; actualProviderCharges:string } };
const categories = [
  ['none', 'No issue'], ['unsupported_claim', 'Unsupported claim'], ['incomplete_answer', 'Incomplete answer'],
  ['missed_evidence', 'Missed evidence'], ['source_conflict', 'Source conflict'],
  ['unnecessary_abstention', 'Unnecessary abstention'], ['other', 'Other']
];
const label = (value: string) => value.replaceAll('_', ' ');
function ChangedText({before,after}:{before:string;after:string}) {
  const a=before.split(/(\s+)/),b=after.split(/(\s+)/);let start=0,end=0;
  while(start<a.length && start<b.length && a[start]===b[start]) start++;
  while(end<a.length-start && end<b.length-start && a[a.length-1-end]===b[b.length-1-end]) end++;
  return <>{b.slice(0,start).join('')}<mark>{b.slice(start,b.length-end).join('')}</mark>{end ? b.slice(b.length-end).join('') : ''}</>;
}

function RevisionPanel({ item, state, refresh }: { item: ReviewCase; state?: RevisionCase; refresh: () => Promise<void> }) {
  const [feedback, setFeedback] = useState(''); const [reviewer, setReviewer] = useState(''); const [note, setNote] = useState(''); const [checked, setChecked] = useState<string[]>([]);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const latest = state?.versions.at(-1), job = state?.jobs.at(-1);
  const accepted = state?.events.some(event => event.kind === 'accept' && event.versionId === latest?.id);
  const decided = state?.events.some(event => ['accept','needs_information'].includes(event.kind) && event.versionId === latest?.id);
  async function submit(path: string, payload: object) { setBusy(true); setError(''); try { const response = await fetch(`/api/paid-review/${item.qid}/${path}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Action failed.'); await refresh(); if(path==='revisions') setRequestKey(crypto.randomUUID()); } catch(reason) { setError(reason instanceof Error ? reason.message : 'Action failed.'); } finally { setBusy(false); } }
  if (!latest || !state) return null;
  return <section className="pr-revision" aria-label={state.versions.length > 1 ? 'Revised answer for review' : 'Answer revision'}><h3>{state.versions.length > 1 ? 'Recheck the revised answer' : 'Reject and improve'}</h3><p>{state.versions.length > 1 ? 'Compare the new answer with the original. Check the source text below before using the decision controls in this panel.' : 'Revisions run in the background under the shared local call allowance. Review other answers while this case is queued.'}</p>
    {job && <p className="pr-job"><strong>{job.status === 'ready' ? 'Ready to recheck' : label(job.status)}</strong> · Requested {new Date(job.createdAt).toLocaleString()}{job.error && <> · {job.error}</>}</p>}
    {state.versions.length > 1 && <div className="pr-compare"><div><strong>Previous answer</strong><p>{state.versions.at(-2)?.answer.answer}</p></div><div><strong>Revised answer · {latest.model}</strong><p><ChangedText before={state.versions.at(-2)?.answer.answer ?? ''} after={latest.answer.answer} /></p><small>{latest.answer.status} · changed text highlighted</small>{latest.answer.citations.map((citation,i) => { const source = item.sources.find(s => citation.passageId === `${item.qid}:${s.sha256}`); return <a key={i} href={`#source-${source?.sha256}`} className="pr-quote-link">{source?.label ?? 'Source'}: “{citation.quote}”</a>; })}</div></div>}
    {state.events.map((event,i) => <p className="pr-event" key={i}>{label(event.kind)} by {event.reviewer}: {event.note}</p>)}
    {!accepted && !['queued','running','reconciliation'].includes(job?.status ?? '') && state.jobs.length < 2 && <form onSubmit={event => { event.preventDefault(); void submit('revisions',{ versionId:latest.id, idempotencyKey:requestKey, reviewer, feedback }); }}><label className="pr-field">What is wrong or missing?<textarea rows={3} maxLength={2000} value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="Name the flawed claim and the source that corrects it." /></label><label className="pr-field">Revision reviewer name<input value={reviewer} onChange={event => setReviewer(event.target.value)} /></label><button className="pr-save" disabled={busy || feedback.trim().length < 10 || reviewer.trim().length < 2}>Request revision</button></form>}
    {state.versions.length > 1 && !decided && !['queued','running','reconciliation'].includes(job?.status ?? '') && <form onSubmit={event => event.preventDefault()}><label className="pr-field">Review note<input value={note} onChange={event => setNote(event.target.value)} /></label><label className="pr-field">Revision reviewer name<input value={reviewer} onChange={event => setReviewer(event.target.value)} /></label><div className="pr-checks">{item.sources.map(source => <label key={source.sha256}><input type="checkbox" checked={checked.includes(source.sha256)} onChange={event => setChecked(old => event.target.checked ? [...old,source.sha256] : old.filter(s => s !== source.sha256))} /> {source.label}</label>)}</div><button type="button" className="pr-save" disabled={busy || !checked.length || reviewer.trim().length < 2} onClick={() => void submit('decisions',{versionId:latest.id,reviewer,decision:'accept',note,checkedSourceShas:checked})}>Accept revision</button> <button type="button" disabled={busy || !checked.length || reviewer.trim().length < 2} onClick={() => void submit('decisions',{versionId:latest.id,reviewer,decision:'needs_information',note,checkedSourceShas:checked})}>Mark missing information</button></form>}
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
    const readyCase = revisionValue.cases.find((item: RevisionCase) => item.jobs.at(-1)?.status === 'ready' && item.versions.length > 1);
    setData(value); setQid(current => current || readyCase?.qid || value.cases[0]?.qid || '');
  }
  useEffect(() => { refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load saved batch.')); }, []);
  useEffect(() => { if (!revisions?.pending) return; const timer = setInterval(() => { refresh().catch(() => {}); }, 2500); return () => clearInterval(timer); }, [revisions?.pending]);
  const selected = data?.cases.find(item => item.qid === qid);
  const selectedRevision = revisions?.cases.find(item => item.qid === qid);
  const hasRevisedAnswer = (selectedRevision?.versions.length ?? 0) > 1;
  const latestCitations = hasRevisedAnswer ? selectedRevision?.versions.at(-1)?.answer.citations ?? [] : null;
  const cited = new Set(selected?.result.run.answer.citations.map(item => item.passageId) ?? []);
  const readyCase = revisions?.cases.find(item => item.jobs.at(-1)?.status === 'ready' && item.versions.length > 1);
  const reviewed = data?.summary.reviewed ?? 0;
  return <div className="pr-app"><nav className="ask-nav" aria-label="Main navigation"><a className="ask-brand" href="/ask"><span>a↗</span> ablatrix <small>Answer review</small></a><div><a href="/ask">Product QA ↗</a><a href="/loop">Feedback lab ↗</a><span className="ask-local">LOCAL EVIDENCE</span></div></nav>
    <main className="pr-main"><header className="pr-hero"><span>20 SAVED PAID ANSWERS · PINNED TRAIN SPLIT</span><h1>Check the answer,<br />not just the quote.</h1><p>Review the pinned answers and request a bounded background revision for a flawed answer.</p></header>
      {error && <p className="pr-error" role="alert">{error}</p>}
      {data && <><div className="pr-metrics"><div><strong>{reviewed}/{data.summary.total}</strong><span>source checked reviews</span></div><div><strong>{data.summary.correct}/{data.summary.judged}</strong><span>correct among decisive reviews</span></div><div><strong>{data.summary.uncertain}</strong><span>uncertain reviews</span></div><div><strong>{data.summary.incorrect}</strong><span>reviewed incorrect</span></div></div>
        <p className="pr-caveat">These are judgments on a small, deliberately curated train split. They are not a population accuracy estimate or evidence that a candidate improved on baseline. <a href="/api/paid-review/export">Export review packet ↗</a></p>
        <p className="pr-ai-status"><strong>{data.summary.aiDrafts}/20 AI suggestions prepared.</strong> Human reviews remain {reviewed}/20. AI drafts never enter the correctness score or policy promotion gate.</p>
        {data.summary.historicalReviewed > 0 && <p className="pr-ai-status"><strong>{data.summary.historicalReviewed} historical human reviews saved: {data.summary.historicalCorrect} correct, {data.summary.historicalIncorrect} incorrect, {data.summary.historicalUncertain} uncertain.</strong> These were recorded before original customer questions were restored. Their notes remain visible on each card; confirm or correct them with a new source checked review under the current protocol.</p>}
        {revisions && <p className="pr-ai-status"><strong>{revisions.ready} ready to recheck · {revisions.pending} pending.</strong> {readyCase && <button type="button" className="pr-ready-link" onClick={() => setQid(readyCase.qid)}>Open revised answer for Q{readyCase.qid} ↗</button>} {revisions.readiness.ready ? 'Background dispatch is available.' : revisions.readiness.reason} {revisions.summary.accepted} accepted · {revisions.summary.unresolved} unresolved · {revisions.summary.providerCalls} provider calls · ${revisions.summary.planningAllowanceUsd.toFixed(2)} planning allowance. Actual charges unavailable.</p>}
        <div className="pr-failures"><strong>Failure patterns</strong>{Object.entries(data.summary.categories).filter(([, count]) => count > 0).length ? <div>{Object.entries(data.summary.categories).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).map(([category, count]) => <span key={category}>{label(category)} <b>{count}</b></span>)}</div> : <p>Source checked reviews will show the most common issues here.</p>}</div>
        <div className="pr-layout"><aside className="pr-queue" aria-label="Answer review queue"><div className="pr-queue-head"><strong>Answer queue</strong><span>{data.summary.total - reviewed} waiting</span></div>{data.cases.map((item, index) => { const job = revisions?.cases.find(c => c.qid === item.qid)?.jobs.at(-1); return <button key={item.qid} className={item.qid === qid ? 'active' : ''} aria-current={item.qid === qid ? 'true' : undefined} onClick={() => setQid(item.qid)}><span>{String(index + 1).padStart(2, '0')} · {job?.status === 'ready' ? 'READY TO RECHECK' : job ? label(job.status).toUpperCase() : item.review ? 'HUMAN REVIEWED' : item.historicalReview ? 'HISTORICAL REVIEW' : item.aiDraft ? 'AI DRAFT · HUMAN PENDING' : 'PENDING'}</span><strong>{item.question}</strong><small>{item.title}</small></button>; })}</aside>
          {selected && <div className="pr-detail"><div className="pr-detail-head"><span>QUESTION {selected.qid} · PRODUCT {selected.asin}</span><h2>{selected.question}</h2><p>{selected.title}</p></div>
            {hasRevisedAnswer && <RevisionPanel key={`revision-${selected.qid}`} item={selected} state={selectedRevision} refresh={refresh} />}
            {!hasRevisedAnswer && <section className="pr-answer"><span>ORIGINAL MODEL ANSWER · {label(selected.result.run.answer.status)}</span><p>{selected.result.run.answer.answer}</p><small>{selected.result.run.model} · {selected.result.run.answer.citations.length} citations · {selected.result.clientMs === null ? 'timing unavailable' : `${(selected.result.clientMs / 1000).toFixed(2)} s client time`}</small></section>}
            <section className="pr-sources"><h3>Source text <small>{hasRevisedAnswer ? 'Citation labels refer to the revised answer. ' : ''}Check at least one before submitting. Original customer Q&A questions are included for revision.</small></h3>{selected.sources.map((source, index) => { const passages = selected.result.run.retrieval.passages.filter(item => item.sha256 === source.sha256 || source.text.includes(item.text)); const isCited = latestCitations ? latestCitations.some(item => item.passageId === `${selected.qid}:${source.sha256}`) : passages.some(item => cited.has(item.id)); const checked = checkedByQid[selected.qid] ?? []; const revisionQuote = latestCitations?.find(c => c.passageId === `${selected.qid}:${source.sha256}`)?.quote; const parts = revisionQuote && source.text.includes(revisionQuote) ? source.text.split(revisionQuote) : null; return <article id={`source-${source.sha256}`} key={source.sha256}><div className="pr-source-head"><strong>{index + 1}. {source.label}</strong><span>{isCited ? (hasRevisedAnswer ? 'CITED BY REVISION' : 'CITED') : passages.length ? 'RETRIEVED' : 'NOT RETRIEVED'}</span></div>{source.originalQuestion && <p className="pr-original-question"><strong>Original customer question:</strong> {source.originalQuestion}</p>}<p>{parts ? <>{parts[0]}<mark>{revisionQuote}</mark>{parts.slice(1).join(revisionQuote)}</> : source.text}</p>{!selected.review && <label className="pr-source-check"><input type="checkbox" checked={checked.includes(source.sha256)} onChange={event => setCheckedByQid(current => { const prior = current[selected.qid] ?? []; return { ...current, [selected.qid]: event.target.checked ? [...prior, source.sha256] : prior.filter(sha => sha !== source.sha256) }; })} /> I checked this source</label>}</article>; })}</section>
            {selected.historicalReview && <section className="pr-verdict"><span>HISTORICAL HUMAN REVIEW · RECONFIRM UNDER CURRENT SOURCE CONTEXT</span><strong>{label(selected.historicalReview.answerVerdict)}</strong><p>{selected.historicalReview.note}</p></section>}
            {!hasRevisedAnswer && <ReviewForm key={selected.qid} item={selected} saved={selected.review} refresh={refresh} checked={checkedByQid[selected.qid] ?? []} />}
            {!hasRevisedAnswer && <RevisionPanel key={`revision-${selected.qid}`} item={selected} state={selectedRevision} refresh={refresh} />}
          </div>}</div></>}
    </main></div>;
}
