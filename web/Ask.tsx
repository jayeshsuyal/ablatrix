import React, { useEffect, useState } from 'react';
import type { WorkspaceProduct, WorkspaceRun } from '../server/product-workspace.ts';
import type { AutomaticSupportJob } from '../server/automatic-support.ts';
import { AutomaticCheck, useAutomaticCheck } from './AutomaticCheck';
import './ask.css';
import { useDemoSession } from './DemoSession';
import { AnswerPolicy } from './AnswerPolicy';
import { WorkflowProof } from './WorkflowProof';

type WorkspaceOverview = { products: WorkspaceProduct[]; runs: QuestionResponse[]; readiness: { ready: boolean; reason: string }; automaticCheckReadiness?: { ready: boolean; reason: string }; busy: boolean };
type SourceDraft = { label: string; text: string; originalQuestion: string };
type QuestionResponse = WorkspaceRun & { reviewHandoff?: 'pending'; automaticCheck?: AutomaticSupportJob; automaticCheckRequested?: true; automaticCheckHandoff?: 'pending' | 'enqueued' | 'unavailable'; automaticCheckError?: string };
const withSavedRun = (overview: WorkspaceOverview, run: QuestionResponse): WorkspaceOverview => ({ ...overview, runs: [run, ...overview.runs.filter(item => item.id !== run.id)].slice(0, 100) });
type QuestionIntent = { idempotencyKey: string; payload: { productId: string; question: string; mode: 'preview' | 'live' | 'synthetic'; automaticCheck?: boolean } };
const intentStorage = 'ablatrix.question-intents.v1';
function pendingIntents(): QuestionIntent[] {
  try { const value = JSON.parse(sessionStorage.getItem(intentStorage) ?? '[]'); return Array.isArray(value) ? value.filter(item => typeof item?.idempotencyKey === 'string' && item.payload && typeof item.payload.question === 'string' && typeof item.payload.productId === 'string' && ['preview', 'live', 'synthetic'].includes(item.payload.mode)).slice(0, 20) : []; }
  catch { return []; }
}
function questionIntent(payload: QuestionIntent['payload']) {
  const pending = pendingIntents(), prior = pending.find(item => JSON.stringify(item.payload) === JSON.stringify(payload));
  if (prior) return prior;
  if (pending.length >= 20) throw new Error('Twenty requests still need confirmation in this tab. Retry an earlier request before starting another.');
  const intent = { idempotencyKey: crypto.randomUUID(), payload };
  // Persistence must succeed before dispatch so a connection loss can be retried safely.
  sessionStorage.setItem(intentStorage, JSON.stringify([...pending, intent])); return intent;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Request failed.');
  return value as T;
}

export default function Ask() {
  const session = useDemoSession();
  const synthetic = session.providerMode === 'synthetic';
  const canWrite = !session.hosted || session.actor?.role === 'operator';
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [title, setTitle] = useState('');
  const [sources, setSources] = useState<SourceDraft[]>([{ label: 'Product listing', text: '', originalQuestion: '' }]);
  const [productId, setProductId] = useState('');
  const [question, setQuestion] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [automatic, setAutomatic] = useState(false);
  const [automaticChecks, setAutomaticChecks] = useState<Record<string, AutomaticSupportJob>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  useEffect(() => { request<WorkspaceOverview>('/api/workspace').then(value => {
    const preferred = synthetic ? value.runs.find(item => item.generation?.recovered) ?? value.runs[0] : value.runs[0];
    setOverview(value); setProductId((synthetic ? preferred?.productId : undefined) ?? value.products[0]?.id ?? ''); setSelectedRunId(preferred?.id ?? '');
    const pending = pendingIntents().at(-1);
    if (pending && value.products.some(item => item.id === pending.payload.productId)) { setProductId(pending.payload.productId); setQuestion(pending.payload.question); setAutomatic(pending.payload.automaticCheck ?? false); setNotice('An earlier request needs confirmation. Retrying the same question reuses its saved request identity.'); }
    else if (synthetic && session.localDemo) { setQuestion('What capacity and lid are listed for the Thistle flask?'); setAutomatic(true); }
  }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load workspace.')); }, [synthetic, session.localDemo]);
  useEffect(() => { setSourcesOpen(overview?.runs.find(item => item.id === selectedRunId)?.mode === 'preview'); }, [selectedRunId]);
  const selectedProduct = overview?.products.find(item => item.id === productId);
  const selectedRun = overview?.runs.find(item => item.id === selectedRunId);
  const checkQid = selectedRun?.status === 'completed' && selectedRun.mode !== 'preview' ? `workspace-${selectedRun.id}` : undefined;
  const check = useAutomaticCheck(checkQid, checkQid ? automaticChecks[checkQid] : undefined);
  const checkForDisplay = !check.job && selectedRun?.automaticCheckError ? { ...check, error: selectedRun.automaticCheckError } : check;
  const unconfirmedCheck = Boolean(selectedRun?.automaticCheckRequested && !check.job);
  const displayedCitations = (!check.error ? check.job?.delivery?.answer.citations : undefined) ?? selectedRun?.answer?.citations ?? [];
  const displayedSources = check.job?.original.context.sources.map(source => ({ id: source.id, reference: source.label, text: source.text, originalQuestion: source.originalQuestion })) ?? (selectedRun as WorkspaceRun & { generationPassages?: NonNullable<WorkspaceRun['retrieval']>['passages'] } | undefined)?.generationPassages ?? selectedRun?.retrieval?.passages;
  const liveReason = overview?.readiness.reason === 'Live mode is not configured. The synthetic demo is available locally.' ? 'Live answers need explicit local Sapiom configuration. Evidence preview remains available without a model call.' : overview?.readiness.reason;
  async function refresh() { const value = await request<WorkspaceOverview>('/api/workspace'); setOverview(value); return value; }
  async function addProduct(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const product = await request<WorkspaceProduct>('/api/workspace/products', { title, sources: sources.map(({ originalQuestion, ...source }) => ({ ...source, ...(originalQuestion.trim() ? { originalQuestion: originalQuestion.trim() } : {}) })) });
      await refresh(); setProductId(product.id); setTitle(''); setSources([{ label: 'Product listing', text: '', originalQuestion: '' }]); setNotice('Product evidence saved. Ask a question to inspect the matching passages.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save product.'); }
    finally { setBusy(false); }
  }
  async function ask(mode: 'preview' | 'live' | 'synthetic') {
    if (!productId || !question.trim()) return;
    setBusy(true); setError(''); setNotice('');
    let run: QuestionResponse;
    let intent: QuestionIntent | undefined;
    try {
      intent = questionIntent({ productId, question: question.trim(), mode, ...(mode !== 'preview' ? { automaticCheck: automatic } : {}) });
      const response = await fetch('/api/workspace/questions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...intent.payload, idempotencyKey: intent.idempotencyKey }) });
      run = await response.json();
      const matches = run && typeof run.id === 'string' && run.id && run.productId === intent.payload.productId && run.question === intent.payload.question && run.mode === intent.payload.mode;
      // A matching saved failure confirms the attempt even though the API uses
      // HTTP 502. Only ambiguous/mismatched replies retain the retry identity.
      const confirmedFailure = response.status === 502 && matches && run.status === 'failed' && run.requestIdentity?.idempotencyKey === intent.idempotencyKey;
      if (!response.ok && !confirmedFailure) throw new Error(run?.error ?? 'Question failed.');
      if (!matches) throw new Error('The saved response identity could not be confirmed.');
      sessionStorage.setItem(intentStorage, JSON.stringify(pendingIntents().filter(item => item.idempotencyKey !== intent!.idempotencyKey)));
    } catch (reason) {
      const value = await refresh().catch(() => null);
      if (value?.runs[0]?.status === 'failed') setSelectedRunId(value.runs[0].id);
      setError(`${reason instanceof Error ? reason.message : 'Question failed.'}${intent ? ' The request identity is saved in this tab; retry the same question to recover its result.' : ''}`);
      setBusy(false);
      return;
    }
    // The POST already saved this result. A later review or history failure must not suggest regenerating it.
    setOverview(current => current ? withSavedRun(current, run) : current);
    if (run.automaticCheck) setAutomaticChecks(current => ({ ...current, [run.automaticCheck!.qid]: run.automaticCheck! }));
    setSelectedRunId(run.id);
    if (run.status === 'failed') {
      setError(`This attempt was saved as failed. ${run.error ?? 'Inspect the saved attempt for details.'}`);
      setBusy(false);
      return;
    }
    const savedNotice = run.automaticCheckError
      ? `Answer saved. ${run.automaticCheckError}${run.reviewHandoff === 'pending' ? ' Review is temporarily unavailable.' : ''}` : run.reviewHandoff === 'pending'
      ? 'Answer saved. Review is temporarily unavailable; try opening its review again later.'
      : run.automaticCheck ? 'Answer saved. Its sources will be checked automatically, with at most one repair.' : mode === 'preview' ? 'Evidence retrieved. No model call was made.' : mode === 'synthetic' ? 'Synthetic answer saved. Review its source excerpts or request a scripted background correction.' : 'Answer saved. Open its review to accept it or request a background revision.';
    setNotice(savedNotice);
    try {
      const value = await request<WorkspaceOverview>('/api/workspace');
      setOverview(withSavedRun(value, run));
    } catch {
      if (run.reviewHandoff !== 'pending') setNotice(`${savedNotice} The saved question list could not refresh; your result is shown below.`);
    } finally { setBusy(false); }
  }
  return <div className="ask-app" onClickCapture={event => {
    const link = (event.target as Element).closest('a[href^="#source-"]');
    if (link) { setSourcesOpen(true); setTimeout(() => document.getElementById(link.getAttribute('href')!.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }
  }}>
    <nav className="ask-nav" aria-label="Main navigation"><a className="ask-brand" href="/"><span>a↗</span> ablatrix <small>Product answers</small></a><div><a href="/ask" aria-current="page">Ask</a><a href="#proof">Workflow proof</a><a href="/review">Answer review ↗</a>{!session.hosted && <details className="ask-research-nav"><summary>Research</summary><div><a href="/research">Research archive</a><a href="/compare">Paired comparison</a>{!session.localDemo && <><a href="/loop">Policy lab</a><a href="/paid-review">Pinned evaluation</a><a href="/pilot">Search ablation</a></>}</div></details>}<span className="ask-local">{synthetic ? 'SYNTHETIC DEMO' : 'LOCAL WORKSPACE'}</span></div></nav>
    <main className="ask-main">
      <header className="ask-hero"><div><span className="ask-kicker">PRODUCT EVIDENCE → ANSWER → CHECK</span><h1>Answers you can trace.</h1><p>Ask a product question. Inspect the exact sources, see a bounded correction, and keep the original record.</p></div><div className="ask-hero-note"><span className="ask-status-dot" />{synthetic ? 'Offline demonstration' : 'Inspectable local workflow'}<small>{synthetic ? 'Scripted answers · zero provider calls' : 'Live policy release remains closed'}</small></div></header>
      {synthetic && <p className="ask-notice"><strong>Synthetic demonstration.</strong> Deterministic fictional examples demonstrate the workflow. No credentials, embedding download, model calls, billing, or measured quality gain.</p>}{!canWrite && <p className="ask-notice">Operators can add products and generate answers. Your role can inspect the saved workspace.</p>}
      {error && <p className="ask-alert" role="alert">{error}</p>}{notice && <p className="ask-notice" role="status">{notice}</p>}
      <div className="ask-workbench">
        <aside className="ask-compose">
          <section className="ask-panel ask-question-panel" aria-labelledby="ask-question-title"><div className="ask-panel-heading"><span>YOUR QUESTION</span><h2 id="ask-question-title">Find an answer</h2></div>
            <label>Product<select value={productId} onChange={event => setProductId(event.target.value)} disabled={!overview?.products.length || busy}><option value="">Choose a saved product</option>{overview?.products.map(product => <option value={product.id} key={product.id}>{product.title}</option>)}</select></label>
            {selectedProduct && <div className="ask-source-count">{selectedProduct.sources.length} saved {selectedProduct.sources.length === 1 ? 'source' : 'sources'}</div>}
            <label>Question<textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder="What does the evidence say about…?" minLength={5} maxLength={500} rows={3} /></label>
            <label className="ask-check-option"><input type="checkbox" checked={automatic} disabled={!canWrite || busy || (!automatic && !overview?.automaticCheckReadiness?.ready)} onChange={event => setAutomatic(event.target.checked)} /> Automatically check sources and repair once</label>
            <p className="ask-check-help">{synthetic ? 'Scripted source checks and one repair use no model calls or billing.' : 'Uses at most 3 additional model calls to check, repair once, and recheck. AI estimates can miss errors.'} {!overview?.automaticCheckReadiness?.ready && (overview?.automaticCheckReadiness?.reason ?? 'Automatic checks are unavailable.')}</p>
            <div className="ask-form-actions"><button className="ask-primary" disabled={!canWrite || busy || !productId || question.trim().length < 5 || !overview?.readiness.ready || (automatic && !overview?.automaticCheckReadiness?.ready)} onClick={() => ask(synthetic ? 'synthetic' : 'live')}>{busy ? 'Saving your request…' : synthetic ? 'Generate synthetic answer' : 'Generate cited answer ↗'}</button><button className="ask-secondary" disabled={!canWrite || busy || !productId || question.trim().length < 5} onClick={() => ask('preview')}>Preview evidence</button></div>
            <p className="ask-readiness">{synthetic ? 'Offline scripted output only. No model tokens, provider charges, or planning reservations.' : overview?.readiness.ready ? 'One answer uses the shared local planning allowance. Actual billed charges are unavailable.' : liveReason ?? 'Checking model readiness…'}</p>
            <div className="ask-history"><h3>Saved questions</h3>{overview?.runs.length ? overview.runs.map(run => <button key={run.id} aria-pressed={selectedRunId === run.id} onClick={() => setSelectedRunId(run.id)}><strong>{run.question}</strong><span>{run.mode === 'synthetic' ? 'Synthetic' : run.mode === 'live' ? 'Model answer' : 'Evidence preview'} · {run.status.replaceAll('_', ' ')}</span></button>) : <p>No questions yet. Add a product below, then ask its sources.</p>}</div>
          </section>
          <details className="ask-panel ask-import" open={overview?.products.length === 0}><summary>Add product evidence</summary><div className="ask-panel-heading"><p>Paste source text you have permission to use. It stays separate from the evaluation corpus.</p></div>
            <form onSubmit={addProduct}><label>Product name<input value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Trail running jacket" minLength={3} maxLength={160} required /></label>
              {sources.map((source, index) => <fieldset key={index}><legend>Source {index + 1}</legend><label>Source label<input value={source.label} onChange={event => setSources(items => items.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} maxLength={80} required /></label><label>Evidence text<textarea value={source.text} onChange={event => setSources(items => items.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} placeholder="Paste the product specification, listing detail, or customer answer…" minLength={30} maxLength={1500} rows={5} required /></label><label>Original customer question (optional)<textarea value={source.originalQuestion} onChange={event => setSources(items => items.map((item, i) => i === index ? { ...item, originalQuestion: event.target.value } : item))} placeholder="The question this customer answer addressed…" maxLength={500} rows={2} /><small className="ask-field-help">Keeps models and conditions attached to the answer. A question alone does not establish a product fact.</small></label>{sources.length > 1 && <button type="button" className="ask-text-button" onClick={() => setSources(items => items.filter((_, i) => i !== index))}>Remove source</button>}</fieldset>)}
              <div className="ask-form-actions"><button type="button" className="ask-secondary" disabled={!canWrite || sources.length >= 8 || busy} onClick={() => setSources(items => [...items, { label: '', text: '', originalQuestion: '' }])}>+ Add source</button><button className="ask-primary" disabled={!canWrite || busy || !title.trim() || sources.some(source => source.text.trim().length < 30 || source.label.trim().length < 2)}>Save product</button></div>
            </form>
          </details>
        </aside>
        <section className="ask-panel ask-result" aria-labelledby="ask-result-title"><div className="ask-panel-heading"><span>{selectedRun?.mode === 'synthetic' ? 'SYNTHETIC SAVED RESULT' : 'ANSWER & EVIDENCE'}</span><h2 id="ask-result-title">{selectedRun ? selectedRun.question : 'Your answer starts with a source.'}</h2><p>{selectedRun?.mode === 'synthetic' ? 'Scripted workflow output. It does not enter live quality results.' : selectedRun?.mode === 'preview' ? 'Retrieval preview · no model call or quality score.' : selectedRun ? 'Saved attempt. Literal citations and semantic support are checked separately.' : 'Choose a saved product and ask a question. The source packet and original answer remain inspectable.'}</p></div>
          {!selectedRun && <div className="ask-empty"><span>↗</span><p>Evidence in. A clear answer out.<br />Every correction leaves a record.</p></div>}
          {selectedRun?.generation?.recovered && <p className="ask-recovery-note"><strong>Recovered after interruption.</strong> The completed original receipt was reused. Recovery made no additional generation call.</p>}
          {selectedRun?.answer && !check.job && <div className="ask-answer"><span>{selectedRun.automaticCheckError ? 'ORIGINAL ANSWER · AUTOMATIC CHECK UNAVAILABLE' : unconfirmedCheck ? 'ORIGINAL ANSWER · SOURCE CHECK NOT CONFIRMED' : selectedRun.mode === 'synthetic' ? 'SYNTHETIC ANSWER' : selectedRun.answer.status === 'answered' ? 'ANSWERED FROM EVIDENCE' : 'INSUFFICIENT EVIDENCE'}</span><p>{selectedRun.answer.answer}</p><small>{selectedRun.model} · {selectedRun.mode === 'synthetic' ? 'no model tokens or charges' : selectedRun.usage ? `${selectedRun.usage.inputTokens + selectedRun.usage.outputTokens} tokens` : 'token usage unavailable'}</small></div>}
          {selectedRun && <AutomaticCheck state={checkForDisplay} pending={unconfirmedCheck} mode={selectedRun.mode === 'synthetic' ? 'synthetic' : 'live'} />}
          {selectedRun?.error && <p className="ask-alert">{selectedRun.error}</p>}
          {displayedSources && <details className="ask-sources-details" open={sourcesOpen} onToggle={event => setSourcesOpen(event.currentTarget.open)}><summary>Inspect {displayedSources.length} exact saved {displayedSources.length === 1 ? 'source' : 'sources'} <span>{displayedCitations.length} citations</span></summary><div className="ask-evidence"><h3>{check.job ? 'Saved sources used for checking' : 'Retrieved product evidence'}</h3>{displayedSources.map((passage, index) => { const citations = displayedCitations.filter(item => item.passageId === passage.id); return <article key={passage.id} id={`source-${passage.id}`}><div><span>#{index + 1} · {passage.reference}</span>{citations.length > 0 && <strong>{check.job && !check.job.delivery ? 'CITED BY ORIGINAL' : 'CITED'}</strong>}</div>{passage.originalQuestion && <p className="ask-original-question"><strong>Original customer question:</strong> {passage.originalQuestion}<small>Context for this answer; the question is not a confirmed product fact.</small></p>}<p>{passage.text}</p>{citations.map((citation, i) => <blockquote key={i}>“{citation.quote}”</blockquote>)}</article>; })}</div></details>}
          {selectedRun?.status === 'completed' && selectedRun.mode !== 'preview' && selectedRun.answer && <p className="ask-review-link"><a className="ask-primary" href={`/review?answer=${encodeURIComponent(`workspace-${selectedRun.id}`)}`}>Review this answer ↗</a><span>Inspect versions, request a revision, or export the saved evidence.</span></p>}
          {selectedRun?.runtimePolicy && <details className="ask-run-identity"><summary>Captured policy and request identity</summary><p className="ask-policy-binding">{selectedRun.runtimePolicy.id}<br />SHA-256 {selectedRun.runtimePolicy.instructionSha256}<br />Run {selectedRun.id}</p></details>}
        </section>
      </div>
      <WorkflowProof refreshKey={`${selectedRunId}:${check.job?.status ?? ''}`} />
      <AnswerPolicy canWrite={canWrite} refreshKey={selectedRunId} />
    </main>
  </div>;
}
