import React, { useEffect, useState } from 'react';
import type { WorkspaceProduct, WorkspaceRun } from '../server/product-workspace.ts';
import './ask.css';

type WorkspaceOverview = { products: WorkspaceProduct[]; runs: WorkspaceRun[]; readiness: { ready: boolean; reason: string }; busy: boolean };
type SourceDraft = { label: string; text: string; originalQuestion: string };
type QuestionResponse = WorkspaceRun & { reviewHandoff?: 'pending' };
const withSavedRun = (overview: WorkspaceOverview, run: WorkspaceRun): WorkspaceOverview => ({ ...overview, runs: [run, ...overview.runs.filter(item => item.id !== run.id)].slice(0, 100) });

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Request failed.');
  return value as T;
}

export default function Ask() {
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [title, setTitle] = useState('');
  const [sources, setSources] = useState<SourceDraft[]>([{ label: 'Product listing', text: '', originalQuestion: '' }]);
  const [productId, setProductId] = useState('');
  const [question, setQuestion] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { request<WorkspaceOverview>('/api/workspace').then(value => { setOverview(value); setProductId(value.products[0]?.id ?? ''); setSelectedRunId(value.runs[0]?.id ?? ''); }).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load workspace.')); }, []);
  const selectedProduct = overview?.products.find(item => item.id === productId);
  const selectedRun = overview?.runs.find(item => item.id === selectedRunId);
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
  async function ask(mode: 'preview' | 'live') {
    if (!productId || !question.trim()) return;
    setBusy(true); setError(''); setNotice('');
    let run: QuestionResponse;
    try {
      run = await request<QuestionResponse>('/api/workspace/questions', { productId, question, mode });
    } catch (reason) {
      const value = await refresh().catch(() => null);
      if (value?.runs[0]?.status === 'failed') setSelectedRunId(value.runs[0].id);
      setError(reason instanceof Error ? reason.message : 'Question failed.');
      setBusy(false);
      return;
    }
    // The POST already saved this result. A later review or history failure must not suggest regenerating it.
    setOverview(current => current ? withSavedRun(current, run) : current);
    setSelectedRunId(run.id);
    const savedNotice = run.reviewHandoff === 'pending'
      ? 'Answer saved. Review is temporarily unavailable; try opening its review again later.'
      : mode === 'preview' ? 'Evidence retrieved. No model call was made.' : 'Answer saved. Open its review to accept it or request a background revision.';
    setNotice(savedNotice);
    try {
      const value = await request<WorkspaceOverview>('/api/workspace');
      setOverview(withSavedRun(value, run));
    } catch {
      if (run.reviewHandoff !== 'pending') setNotice(`${savedNotice} The saved question list could not refresh; your result is shown below.`);
    } finally { setBusy(false); }
  }
  return <div className="ask-app">
    <nav className="ask-nav" aria-label="Main navigation"><a className="ask-brand" href="/ask"><span>a↗</span> ablatrix <small>Product QA</small></a><div><a href="/review">Answer review ↗</a><a href="/paid-review">Pinned evaluation ↗</a><a href="/loop">Feedback lab ↗</a><a href="/pilot">Search pilot ↗</a><span className="ask-local">LOCAL WORKSPACE</span></div></nav>
    <main className="ask-main">
      <header className="ask-hero"><span className="ask-kicker">PRODUCT EVIDENCE → GROUNDED ANSWER</span><h1>Ask your product evidence.</h1><p>Add a product’s source text, find the relevant passages, and inspect an answer with citations. This local workspace is separate from Ablatrix’s frozen evaluation sets.</p></header>
      {error && <p className="ask-alert" role="alert">{error}</p>}{notice && <p className="ask-notice" role="status">{notice}</p>}
      <div className="ask-grid">
        <section className="ask-panel" aria-labelledby="ask-import-title"><div className="ask-panel-heading"><span>01 / EVIDENCE</span><h2 id="ask-import-title">Add a product</h2><p>Paste source text you have permission to use. Each source stays attached to this product and is kept out of the evaluation corpus.</p></div>
          <form onSubmit={addProduct}><label>Product name<input value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Trail running jacket" minLength={3} maxLength={160} required /></label>
            {sources.map((source, index) => <fieldset key={index}><legend>Source {index + 1}</legend><label>Source label<input value={source.label} onChange={event => setSources(items => items.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} maxLength={80} required /></label><label>Evidence text<textarea value={source.text} onChange={event => setSources(items => items.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} placeholder="Paste the product specification, listing detail, or customer answer…" minLength={30} maxLength={1500} rows={5} required /></label><label>Original customer question (optional)<textarea value={source.originalQuestion} onChange={event => setSources(items => items.map((item, i) => i === index ? { ...item, originalQuestion: event.target.value } : item))} placeholder="For a customer answer, paste the question it answered…" maxLength={500} rows={2} /><small className="ask-field-help">Keeps model numbers and conditions attached to the answer. A question alone does not establish a product fact.</small></label>{sources.length > 1 && <button type="button" className="ask-text-button" onClick={() => setSources(items => items.filter((_, i) => i !== index))}>Remove source</button>}</fieldset>)}
            <div className="ask-form-actions"><button type="button" className="ask-secondary" disabled={sources.length >= 8 || busy} onClick={() => setSources(items => [...items, { label: '', text: '', originalQuestion: '' }])}>+ Add source</button><button className="ask-primary" disabled={busy || !title.trim() || sources.some(source => source.text.trim().length < 30 || source.label.trim().length < 2)}>{busy ? 'Saving…' : 'Save product'}</button></div>
          </form>
        </section>
        <section className="ask-panel ask-question-panel" aria-labelledby="ask-question-title"><div className="ask-panel-heading"><span>02 / QUESTION</span><h2 id="ask-question-title">Find an answer</h2><p>Preview evidence without a model call, or generate one answer when the local Sapiom plan is configured.</p></div>
          <label>Product<select value={productId} onChange={event => setProductId(event.target.value)} disabled={!overview?.products.length || busy}><option value="">Choose a saved product</option>{overview?.products.map(product => <option value={product.id} key={product.id}>{product.title}</option>)}</select></label>
          {selectedProduct && <div className="ask-source-count">{selectedProduct.sources.length} saved {selectedProduct.sources.length === 1 ? 'source' : 'sources'} · added {new Date(selectedProduct.createdAt).toLocaleDateString()}</div>}
          <label>Question<textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder="What does the evidence say about…?" minLength={5} maxLength={500} rows={4} /></label>
          <div className="ask-form-actions"><button className="ask-secondary" disabled={busy || !productId || question.trim().length < 5} onClick={() => ask('preview')}>{busy ? 'Working…' : 'Preview evidence'}</button><button className="ask-primary" disabled={busy || !productId || question.trim().length < 5 || !overview?.readiness.ready} onClick={() => ask('live')}>Generate cited answer ↗</button></div>
          <p className="ask-readiness">{overview?.readiness.ready ? 'Live answer ready. A model call uses the shared local planning allowance; actual billed charges are unavailable.' : liveReason ?? 'Checking model readiness…'}</p>
          <div className="ask-history"><h3>Saved questions</h3>{overview?.runs.length ? overview.runs.map(run => <button key={run.id} aria-pressed={selectedRunId === run.id} onClick={() => setSelectedRunId(run.id)}><strong>{run.question}</strong><span>{run.mode === 'live' ? 'Model answer' : 'Evidence preview'} · {run.status.replaceAll('_', ' ')}</span></button>) : <p>No questions yet. Start with an evidence preview.</p>}</div>
        </section>
      </div>
      <section className="ask-panel ask-result" aria-labelledby="ask-result-title"><div className="ask-panel-heading"><span>03 / RESULT</span><h2 id="ask-result-title">{selectedRun ? selectedRun.question : 'Evidence and answer'}</h2><p>{selectedRun?.mode === 'preview' ? 'Retrieval preview · no model call or quality score.' : selectedRun ? 'Saved local model attempt. Citations verify quote membership, not full semantic correctness.' : 'Select a saved question to inspect its answer and source passages.'}</p></div>
        {selectedRun?.answer && <div className="ask-answer"><span>{selectedRun.answer.status === 'answered' ? 'ANSWERED FROM EVIDENCE' : 'INSUFFICIENT EVIDENCE'}</span><p>{selectedRun.answer.answer}</p><small>{selectedRun.model} · {selectedRun.usage ? `${selectedRun.usage.inputTokens + selectedRun.usage.outputTokens} tokens` : 'token usage unavailable'}</small></div>}
        {selectedRun?.status === 'completed' && selectedRun.mode === 'live' && selectedRun.answer && <p className="ask-review-link"><a className="ask-primary" href={`/review?answer=${encodeURIComponent(`workspace-${selectedRun.id}`)}`}>Review this answer ↗</a><span>Check its sources, record a decision, or request a background revision.</span></p>}
        {selectedRun?.error && <p className="ask-alert">{selectedRun.error}</p>}
        {selectedRun?.retrieval && <div className="ask-evidence"><h3>Retrieved product evidence</h3>{selectedRun.retrieval.passages.map((passage, index) => { const citations = selectedRun.answer?.citations.filter(item => item.passageId === passage.id) ?? []; return <article key={passage.id} id={`source-${passage.id}`}><div><span>#{index + 1} · {passage.reference}</span>{citations.length > 0 && <strong>CITED</strong>}</div>{passage.originalQuestion && <p className="ask-original-question"><strong>Original customer question:</strong> {passage.originalQuestion}<small>Context for this answer; the question is not a confirmed product fact.</small></p>}<p>{passage.text}</p>{citations.map((citation, i) => <blockquote key={i}>“{citation.quote}”</blockquote>)}</article>; })}</div>}
      </section>
    </main>
  </div>;
}
