import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RevisionPanel, type RevisionCase, type RevisionOverview } from './PaidReview';
import './paid-review.css';

type WorkspaceReviewOverview = RevisionOverview & { pagination?: { page: number; pageSize: number; total: number; hasMore: boolean } };
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
  const [initial] = useState(() => {
    const params = new URLSearchParams(window.location.search), page = Number(params.get('page') ?? 1);
    return { page: Number.isSafeInteger(page) && page > 0 ? page : 1, answer: params.get('answer') ?? '' };
  });
  const [data, setData] = useState<WorkspaceReviewOverview | null>(null);
  const [qid, setQid] = useState(initial.answer);
  const [error, setError] = useState('');
  const [changingPage, setChangingPage] = useState(false);
  const cursor = useRef<{ page: number; answer?: string }>({ page: initial.page, ...(initial.answer ? { answer: initial.answer } : {}) });
  const selectedId = useRef(initial.answer);
  const missingDeepLink = useRef(Boolean(initial.answer));
  const requestNumber = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const requestId = ++requestNumber.current, requested = cursor.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const params = new URLSearchParams({ page: String(requested.page) });
    const anchor = selectedId.current || requested.answer;
    if (anchor) params.set('answer', anchor);
    try {
      const response = await fetch(`/api/workspace/reviews?${params}`, { signal: controller.signal });
      const value = await response.json() as WorkspaceReviewOverview & { error?: string };
      if (requestId !== requestNumber.current) return;
      if (!response.ok) throw new Error(value.error ?? 'Could not load workspace reviews.');
      cursor.current = { page: value.pagination?.page ?? requested.page };
      const selectionPresent = value.cases.some(item => item.qid === selectedId.current);
      if (selectionPresent) missingDeepLink.current = false;
      else if (!missingDeepLink.current) selectedId.current = value.cases[0]?.qid ?? '';
      setData(value);
      setQid(selectedId.current);
      if (cursor.current.page !== requested.page) {
        const location = new URLSearchParams({ page: String(cursor.current.page) });
        if (selectedId.current) location.set('answer', selectedId.current);
        window.history.replaceState(null, '', `/review?${location}`);
      }
      setError('');
    } catch (reason) {
      if (controller.signal.aborted || requestId !== requestNumber.current) return;
      throw reason;
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (requestId === requestNumber.current) setChangingPage(false);
    }
  }, []);
  useEffect(() => {
    const load = () => { void refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not refresh workspace reviews.')); };
    load();
    // Anchor the bounded page to the answer being reviewed; new arrivals must not discard its form.
    const timer = window.setInterval(() => { if (!activeRequest.current) load(); }, 2500);
    return () => { window.clearInterval(timer); requestNumber.current++; activeRequest.current?.abort(); activeRequest.current = null; };
  }, [refresh]);
  function selectAnswer(id: string) {
    selectedId.current = id;
    missingDeepLink.current = false;
    setQid(id);
    window.history.replaceState(null, '', `/review?page=${cursor.current.page}&answer=${encodeURIComponent(id)}`);
  }
  function changePage(page: number) {
    cursor.current = { page };
    selectedId.current = '';
    missingDeepLink.current = false;
    setChangingPage(true);
    window.history.replaceState(null, '', `/review?page=${page}`);
    void refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load this review page.'));
  }
  const pagination = data?.pagination ?? { page: 1, pageSize: 20, total: data?.cases.length ?? 0, hasMore: false };
  const selected = data?.cases.find(item => item.qid === qid);
  const latest = selected?.versions.at(-1);
  const context = latest?.context;
  const sourceProvenance = selected?.versions[0]?.contextProvenance ?? latest?.contextProvenance;
  const ready = data?.cases.filter(item => reviewStatus(item) === 'Ready to recheck') ?? [];
  const hasRevision = (selected?.versions.length ?? 0) > 1;
  const panel = selected && context ? <RevisionPanel key={`${selected.qid}-${latest?.id}`} item={{ qid: selected.qid, sources: context.sources }} state={selected} refresh={refresh} endpoint="/api/workspace/reviews" allowOriginalDecision /> : null;
  return <div className="pr-app"><nav className="ask-nav" aria-label="Main navigation"><a className="ask-brand" href="/ask"><span>a↗</span> ablatrix <small>Answer review</small></a><div><a href="/ask">Product QA ↗</a><a href="/paid-review">Pinned evaluation ↗</a><a href="/loop">Feedback lab ↗</a><span className="ask-local">LOCAL WORKSPACE</span></div></nav>
    <main className="pr-main"><header className="pr-hero"><span>ASK → REVIEW → REVISE</span><h1>Make the next answer better.</h1><p>Check an answer against its saved sources. Explain a flaw, then keep reviewing while the revision runs in the background.</p></header>
      {error && <p className="pr-error" role="alert">{error}</p>}
      {!data && !error && <p role="status">Loading saved answers…</p>}
      {data && <><div className="wr-status" role="status" aria-live="polite"><strong>On this page: {data.cases.length} saved answers · {data.pending} pending · {ready.length} ready to recheck</strong><span>{data.summary.accepted} accepted on this page. Acceptance records a human decision on one answer; it does not establish a general quality gain.</span>{ready.map(item => <button type="button" className="pr-ready-link" disabled={changingPage} key={item.qid} onClick={() => selectAnswer(item.qid)}>Recheck: {item.versions.at(-1)?.context?.question ?? 'Revised answer'} ↗</button>)}</div>
        <p className="pr-caveat">This queue contains completed answers from Product QA. The <a href="/paid-review">20-answer pinned evaluation</a> keeps its own review results. Exact citation matching and human answer quality are separate checks.</p>
        {data.cases.length === 0 ? <section className="wr-empty"><h2>No answers to review yet.</h2><p>Generate an answer from your saved product sources in Product QA. Retrieval previews do not create an answer or enter this queue.</p><a href="/ask">Open Product QA ↗</a></section> : <>
          <p className="pr-ai-status">{data.readiness.ready ? 'Background answer dispatch is available.' : data.readiness.reason} {data.investigationReadiness?.reason} Revisions use the shared local planning allowance, with at most two answer attempts per case. Actual charges are unavailable.</p>
          <nav className="pr-ai-status" aria-label="Review queue pages"><button type="button" disabled={changingPage || pagination.page <= 1} onClick={() => changePage(pagination.page - 1)}>Previous page</button> <span>Page {pagination.page} of {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))} · {pagination.total} saved answers</span> <button type="button" disabled={changingPage || !pagination.hasMore} onClick={() => changePage(pagination.page + 1)}>Next page</button>{changingPage && <span role="status"> Loading page…</span>}</nav>
          <div className="pr-layout"><aside className="pr-queue" aria-label="Workspace answer review queue"><div className="pr-queue-head"><strong>Answer queue</strong><span>{data.cases.length} saved</span></div>{data.cases.map((item, index) => { const saved = item.versions.at(-1)?.context; return <button key={item.qid} disabled={changingPage} className={item.qid === qid ? 'active' : ''} aria-current={item.qid === qid ? 'true' : undefined} onClick={() => selectAnswer(item.qid)}><span>{String((pagination.page - 1) * pagination.pageSize + index + 1).padStart(2, '0')} · {reviewStatus(item).toUpperCase()}</span><strong>{saved?.question ?? 'Saved answer'}</strong><small>{saved?.product.title}</small></button>; })}</aside>
            {selected && latest && context ? <div className="pr-detail"><div className="pr-detail-head"><span>{reviewStatus(selected).toUpperCase()} · {selected.versions.length} SAVED {selected.versions.length === 1 ? 'VERSION' : 'VERSIONS'}</span><h2>{context.question}</h2><p>{context.product.title}</p></div>
              {hasRevision ? panel : <section className="pr-answer"><span>ORIGINAL ANSWER · {describe(latest.answer.status)}</span><p>{latest.answer.answer}</p><small>{latest.model} · saved {new Date(latest.createdAt).toLocaleString()}</small></section>}
              {sourceProvenance === 'saved_retrieval_only' && <p className="pr-caveat">This older answer retains its retrieved passages. Its full product source snapshot was not saved at generation time.</p>}
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
