import React, { useCallback, useEffect, useState } from 'react';
import { RevisionPanel, type RevisionCase, type RevisionOverview } from './PaidReview';
import './paid-review.css';

const describe = (value: string) => value.replaceAll('_', ' ');
function reviewStatus(item: RevisionCase) {
  const latest = item.versions.at(-1), job = item.jobs.at(-1);
  if (item.events.some(event => event.versionId === latest?.id && event.kind === 'accept')) return 'Accepted';
  if (job && job.versionId !== latest?.id) return describe(job.status);
  if (job?.status === 'needs_information') return 'Needs information';
  if (item.events.some(event => event.versionId === latest?.id && event.kind === 'needs_information')) return 'Needs information';
  return item.versions.length > 1 ? 'Ready to recheck' : 'Awaiting review';
}

export default function WorkspaceReview() {
  const [data, setData] = useState<RevisionOverview | null>(null);
  const [qid, setQid] = useState(() => new URLSearchParams(window.location.search).get('answer') ?? '');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const response = await fetch('/api/workspace/reviews');
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? 'Could not load workspace reviews.');
    setData(value);
    setQid(current => current || value.cases[0]?.qid || '');
    setError('');
  }, []);
  useEffect(() => {
    const load = () => { void refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not refresh workspace reviews.')); };
    load();
    // Keep ready revisions and answers created in another tab visible without changing selection.
    const timer = window.setInterval(load, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);
  function selectAnswer(id: string) {
    setQid(id);
    window.history.replaceState(null, '', `/review?answer=${encodeURIComponent(id)}`);
  }
  const selected = data?.cases.find(item => item.qid === qid);
  const latest = selected?.versions.at(-1);
  const context = latest?.context;
  const ready = data?.cases.filter(item => reviewStatus(item) === 'Ready to recheck') ?? [];
  const hasRevision = (selected?.versions.length ?? 0) > 1;
  const panel = selected && context ? <RevisionPanel key={`${selected.qid}-${latest?.id}`} item={{ qid: selected.qid, sources: context.sources }} state={selected} refresh={refresh} endpoint="/api/workspace/reviews" allowOriginalDecision /> : null;
  return <div className="pr-app"><nav className="ask-nav" aria-label="Main navigation"><a className="ask-brand" href="/ask"><span>a↗</span> ablatrix <small>Answer review</small></a><div><a href="/ask">Product QA ↗</a><a href="/paid-review">Pinned evaluation ↗</a><a href="/loop">Feedback lab ↗</a><span className="ask-local">LOCAL WORKSPACE</span></div></nav>
    <main className="pr-main"><header className="pr-hero"><span>ASK → REVIEW → REVISE</span><h1>Make the next answer better.</h1><p>Check an answer against its saved sources. Explain a flaw, then keep reviewing while the revision runs in the background.</p></header>
      {error && <p className="pr-error" role="alert">{error}</p>}
      {!data && !error && <p role="status">Loading saved answers…</p>}
      {data && <><div className="wr-status" role="status" aria-live="polite"><strong>{data.cases.length} saved answers · {data.pending} pending · {ready.length} ready to recheck</strong><span>{data.summary.accepted} accepted. Acceptance records a human decision on one answer; it does not establish a general quality gain.</span>{ready.map(item => <button type="button" className="pr-ready-link" key={item.qid} onClick={() => selectAnswer(item.qid)}>Recheck: {item.versions.at(-1)?.context?.question ?? 'Revised answer'} ↗</button>)}</div>
        <p className="pr-caveat">This queue contains completed answers from Product QA. The <a href="/paid-review">20-answer pinned evaluation</a> keeps its own review results. Exact citation matching and human answer quality are separate checks.</p>
        {data.cases.length === 0 ? <section className="wr-empty"><h2>No answers to review yet.</h2><p>Generate an answer from your saved product sources in Product QA. Retrieval previews do not create an answer or enter this queue.</p><a href="/ask">Open Product QA ↗</a></section> : <>
          <p className="pr-ai-status">{data.readiness.ready ? 'Background answer dispatch is available.' : data.readiness.reason} {data.investigationReadiness?.reason} Revisions use the shared local planning allowance, with at most two answer attempts per case. Actual charges are unavailable.</p>
          <div className="pr-layout"><aside className="pr-queue" aria-label="Workspace answer review queue"><div className="pr-queue-head"><strong>Answer queue</strong><span>{data.cases.length} saved</span></div>{data.cases.map((item, index) => { const saved = item.versions.at(-1)?.context; return <button key={item.qid} className={item.qid === qid ? 'active' : ''} aria-current={item.qid === qid ? 'true' : undefined} onClick={() => selectAnswer(item.qid)}><span>{String(index + 1).padStart(2, '0')} · {reviewStatus(item).toUpperCase()}</span><strong>{saved?.question ?? 'Saved answer'}</strong><small>{saved?.product.title}</small></button>; })}</aside>
            {selected && latest && context ? <div className="pr-detail"><div className="pr-detail-head"><span>{reviewStatus(selected).toUpperCase()} · {selected.versions.length} SAVED {selected.versions.length === 1 ? 'VERSION' : 'VERSIONS'}</span><h2>{context.question}</h2><p>{context.product.title}</p></div>
              {hasRevision ? panel : <section className="pr-answer"><span>ORIGINAL ANSWER · {describe(latest.answer.status)}</span><p>{latest.answer.answer}</p><small>{latest.model} · saved {new Date(latest.createdAt).toLocaleString()}</small></section>}
              {latest.contextProvenance === 'saved_retrieval_only' && <p className="pr-caveat">This older answer retains its retrieved passages. Its full product source snapshot was not saved at generation time.</p>}
              <section className="pr-sources"><h3>Saved source text <small>Check applicability and claim support before deciding.</small></h3>{context.sources.map((source, index) => { const citations = latest.answer.citations.filter(citation => citation.passageId === source.id); return <article id={`source-${source.sha256}`} key={source.id}><div className="pr-source-head"><strong>{index + 1}. {source.label}</strong><span>{citations.length ? 'CITED' : latest.investigation && !latest.investigation.selectedSourceIds.includes(source.id) ? 'EXCLUDED FROM REVISION' : latest.generationSourceIds?.includes(source.id) ? 'SUPPLIED TO MODEL' : 'AVAILABLE SOURCE'}</span></div>
                {source.origin === 'reviewer_added' && <p className="pr-source-provenance">Source added by {source.addedBy}. {source.reference && <>Reference: {source.reference}.</>} Check its authority and applicability.</p>}
                {source.origin === 'agent_retrieved' && <p className="pr-source-provenance">Retrieved by the agent{source.retrievedAt ? ` on ${new Date(source.retrievedAt).toLocaleString()}` : ''}. {source.reference && <>Source: {source.reference}.</>} Check its authority and applicability.</p>}
                {source.originalQuestion && <p className="pr-original-question"><strong>Original customer question:</strong> {source.originalQuestion}</p>}<p>{source.text}</p>{citations.map((citation, i) => <blockquote key={i}>“{citation.quote}”</blockquote>)}</article>; })}</section>
              {!hasRevision && panel}
            </div> : <div className="pr-detail"><h2>Saved answer not found.</h2><p>Select an answer from the queue. The link may belong to a different local workspace.</p></div>}
          </div>
        </>}</>}
    </main>
  </div>;
}
