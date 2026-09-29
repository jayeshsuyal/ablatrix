import React, { useEffect, useState } from 'react';
import type { PaidReview as SavedReview, PaidAiDraft } from '../server/paid-answer-review.ts';
import './paid-review.css';

type ReviewCase = { qid: string; asin: string; title: string; question: string; sources: { label: string; text: string; sha256: string; originalQuestion: string | null }[];
  result: { run: { answer: { answer: string; status: string; citations: { passageId: string; quote: string }[] }; retrieval: { passages: { id: string; sha256: string; text: string; reference: string }[] }; model: string }; clientMs: number | null }; review: SavedReview | null; aiDraft: PaidAiDraft | null };
type ReviewOverview = { manifestSha256: string; cases: ReviewCase[]; summary: { total: number; reviewed: number; judged: number; correct: number; incorrect: number; uncertain: number; aiDrafts: number; categories: Record<string, number> } };
const categories = [
  ['none', 'No issue'], ['unsupported_claim', 'Unsupported claim'], ['incomplete_answer', 'Incomplete answer'],
  ['missed_evidence', 'Missed evidence'], ['source_conflict', 'Source conflict'],
  ['unnecessary_abstention', 'Unnecessary abstention'], ['other', 'Other']
];
const label = (value: string) => value.replaceAll('_', ' ');

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
  const [qid, setQid] = useState('');
  const [checkedByQid, setCheckedByQid] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');
  async function refresh() {
    const response = await fetch('/api/paid-review');
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? 'Could not load saved batch.');
    setData(value); setQid(current => current || value.cases[0]?.qid || '');
  }
  useEffect(() => { refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load saved batch.')); }, []);
  const selected = data?.cases.find(item => item.qid === qid);
  const cited = new Set(selected?.result.run.answer.citations.map(item => item.passageId) ?? []);
  const reviewed = data?.summary.reviewed ?? 0;
  return <div className="pr-app"><nav className="ask-nav" aria-label="Main navigation"><a className="ask-brand" href="/ask"><span>a↗</span> ablatrix <small>Answer review</small></a><div><a href="/ask">Product QA ↗</a><a href="/loop">Feedback lab ↗</a><span className="ask-local">LOCAL EVIDENCE</span></div></nav>
    <main className="pr-main"><header className="pr-hero"><span>20 SAVED PAID ANSWERS · PINNED TRAIN SPLIT</span><h1>Check the answer,<br />not just the quote.</h1><p>This queue uses the fixed 20 product batch. Reviews are saved separately from its original answers. No model call is made here.</p></header>
      {error && <p className="pr-error" role="alert">{error}</p>}
      {data && <><div className="pr-metrics"><div><strong>{reviewed}/{data.summary.total}</strong><span>source checked reviews</span></div><div><strong>{data.summary.correct}/{data.summary.judged}</strong><span>correct among decisive reviews</span></div><div><strong>{data.summary.uncertain}</strong><span>uncertain reviews</span></div><div><strong>{data.summary.incorrect}</strong><span>reviewed incorrect</span></div></div>
        <p className="pr-caveat">These are judgments on a small, deliberately curated train split. They are not a population accuracy estimate or evidence that a candidate improved on baseline. <a href="/api/paid-review/export">Export review packet ↗</a></p>
        <p className="pr-ai-status"><strong>{data.summary.aiDrafts}/20 AI suggestions prepared.</strong> Human reviews remain {reviewed}/20. AI drafts never enter the correctness score or policy promotion gate.</p>
        <div className="pr-failures"><strong>Failure patterns</strong>{Object.entries(data.summary.categories).filter(([, count]) => count > 0).length ? <div>{Object.entries(data.summary.categories).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).map(([category, count]) => <span key={category}>{label(category)} <b>{count}</b></span>)}</div> : <p>Source checked reviews will show the most common issues here.</p>}</div>
        <div className="pr-layout"><aside className="pr-queue" aria-label="Answer review queue"><div className="pr-queue-head"><strong>Answer queue</strong><span>{data.summary.total - reviewed} waiting</span></div>{data.cases.map((item, index) => <button key={item.qid} className={item.qid === qid ? 'active' : ''} aria-current={item.qid === qid ? 'true' : undefined} onClick={() => setQid(item.qid)}><span>{String(index + 1).padStart(2, '0')} · {item.review ? 'HUMAN REVIEWED' : item.aiDraft ? 'AI DRAFT · HUMAN PENDING' : 'PENDING'}</span><strong>{item.question}</strong><small>{item.title}</small></button>)}</aside>
          {selected && <div className="pr-detail"><div className="pr-detail-head"><span>QUESTION {selected.qid} · PRODUCT {selected.asin}</span><h2>{selected.question}</h2><p>{selected.title}</p></div>
            <section className="pr-answer"><span>MODEL ANSWER · {label(selected.result.run.answer.status)}</span><p>{selected.result.run.answer.answer}</p><small>{selected.result.run.model} · {selected.result.run.answer.citations.length} citations · {selected.result.clientMs === null ? 'timing unavailable' : `${(selected.result.clientMs / 1000).toFixed(2)} s client time`}</small></section>
            <section className="pr-sources"><h3>Source text <small>Check at least one before submitting. Original customer Q&A questions are restored for review; they were not sent to the answer model.</small></h3>{selected.sources.map((source, index) => { const passages = selected.result.run.retrieval.passages.filter(item => item.sha256 === source.sha256 || source.text.includes(item.text)); const isCited = passages.some(item => cited.has(item.id)); const checked = checkedByQid[selected.qid] ?? []; return <article key={source.sha256}><div className="pr-source-head"><strong>{index + 1}. {source.label}</strong><span>{isCited ? 'CITED' : passages.length ? 'RETRIEVED' : 'NOT RETRIEVED'}</span></div>{source.originalQuestion && <p className="pr-original-question"><strong>Original customer question:</strong> {source.originalQuestion}</p>}<p>{source.text}</p>{selected.result.run.answer.citations.filter(item => passages.some(passage => passage.id === item.passageId)).map((citation, i) => <blockquote key={i}>“{citation.quote}”</blockquote>)}{!selected.review && <label className="pr-source-check"><input type="checkbox" checked={checked.includes(source.sha256)} onChange={event => setCheckedByQid(current => { const prior = current[selected.qid] ?? []; return { ...current, [selected.qid]: event.target.checked ? [...prior, source.sha256] : prior.filter(sha => sha !== source.sha256) }; })} /> I checked this source</label>}</article>; })}</section>
            <ReviewForm key={selected.qid} item={selected} saved={selected.review} refresh={refresh} checked={checkedByQid[selected.qid] ?? []} />
          </div>}</div></>}
    </main></div>;
}
