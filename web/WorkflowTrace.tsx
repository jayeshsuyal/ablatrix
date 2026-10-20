import { useEffect, useId, useState } from 'react';
import type { buildWorkspaceObservabilityPreview } from '../server/workspace-observability-v1.ts';
import './workflow-trace.css';

type Preview = ReturnType<typeof buildWorkspaceObservabilityPreview>;
type Span = Preview['otlp']['resourceSpans'][number]['scopeSpans'][number]['spans'][number];
type Workflow = { root: Span; stages: Span[] };
type AttributeValue = string | number | boolean | undefined;
class TraceMetadataFormatError extends Error {}
const traceUnavailable = 'Saved workflow traces are unavailable.';
const traceUnexpectedFormat = 'The saved trace metadata has an unexpected format.';

const metadataPrefix = 'langfuse.observation.metadata.';
const hash = /^[a-f0-9]{64}$/;
const spanNames = new Set(['workspace-answer', 'original-generation-snapshot', 'check-original', 'check-original-snapshot', 'repair-answer', 'repair-answer-snapshot', 'recheck-repair', 'recheck-repair-snapshot', 'unknown-phase', 'unknown-phase-snapshot']);
const labels: Record<string, string> = {
  retrieving: 'Retrieving', evidence_ready: 'Evidence ready', completed: 'Completed', failed: 'Failed',
  pending: 'Pending', interrupted: 'Interrupted', started: 'Started', invalid: 'Invalid', unknown: 'Unknown',
  queued: 'Queued', checking: 'Checking', repairing: 'Repairing', rechecking: 'Rechecking',
  supported: 'Supported', repaired: 'Repaired', abstained: 'Abstained', inconclusive: 'Inconclusive', reconciliation: 'Reconciliation',
  not_requested_or_unavailable: 'Check unavailable', win: 'Improved', tie: 'Tied', regression: 'Regressed', unresolved: 'Unresolved',
  complete: 'Complete', incomplete: 'Incomplete', uncertain: 'Uncertain', answerable: 'Answerable', insufficient: 'Insufficient', conflicting: 'Conflicting',
  consistent_with_sources: 'Consistent with sources', contradicted_by_sources: 'Contradicted by sources',
  appropriate: 'Appropriate', overconfident: 'Overconfident', unnecessary_abstention: 'Unnecessary abstention',
  pass: 'Pass', repair: 'Repair requested', abstain: 'Abstain',
};

function attribute(span: Span, key: string): AttributeValue {
  const value = span.attributes.find(item => item.key === `${metadataPrefix}${key}`)?.value;
  if (!value) return undefined;
  return 'stringValue' in value ? value.stringValue : 'boolValue' in value ? value.boolValue : value.doubleValue;
}

function category(span: Span, key: string): string {
  const value = attribute(span, key);
  return typeof value === 'string' && Object.hasOwn(labels, value) ? value : 'unknown';
}

function numberAttribute(span: Span, key: string): number | null {
  const value = attribute(span, key);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function elapsed(span: Span, root = false): string {
  const known = attribute(span, root ? 'workflow_elapsed_ms_known' : 'stage_duration_known') === true;
  const value = numberAttribute(span, root ? 'workflow_elapsed_ms' : 'operation_elapsed_ms');
  return !known || value === null ? 'Unknown' : value < 1000 ? `${value.toLocaleString()} ms` : `${(value / 1000).toFixed(2)} s`;
}

function tokens(span: Span): { input: number; output: number } | null {
  if (attribute(span, 'token_usage_known') !== true) return null;
  const value = span.attributes.find(item => item.key === 'langfuse.observation.usage_details')?.value;
  if (!value || !('stringValue' in value)) return null;
  try {
    const usage = JSON.parse(value.stringValue);
    return Number.isSafeInteger(usage.input) && usage.input >= 0 && Number.isSafeInteger(usage.output) && usage.output >= 0 ? usage : null;
  } catch { return null; }
}

function stageName(span: Span): string {
  const phase = attribute(span, 'phase');
  return phase === 'original_generation' ? 'Original generation' : phase === 'grade_original' ? 'Check original' : phase === 'repair' ? 'Repair answer' : phase === 'grade_repair' ? 'Recheck repair' : 'Unknown stage';
}

function mode(span: Span): string {
  const value = attribute(span, 'execution_mode');
  return value === 'synthetic' ? 'Scripted synthetic' : value === 'live' ? 'Recorded live' : 'Mode unknown';
}

function tone(value: string): string {
  return ['failed', 'invalid', 'interrupted', 'regression', 'overconfident', 'contradicted_by_sources'].includes(value) ? 'negative'
    : ['unresolved', 'unknown', 'uncertain', 'inconclusive', 'reconciliation', 'abstained'].includes(value) ? 'uncertain'
      : ['completed', 'supported', 'repaired', 'pass'].includes(value) ? 'positive' : 'neutral';
}

function Badge({ value }: { value: string }) {
  return <span className={`trace-badge trace-badge-${tone(value)}`}>{labels[value] ?? 'Unknown'}</span>;
}

function isPreview(value: unknown): value is Preview {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Preview;
  if (candidate.format !== 'ablatrix-workspace-observability-preview-v1' || candidate.transport !== 'otlp_http_json_preview' || candidate.privacy !== 'metadata_only' || candidate.providerCalls !== 0 || candidate.exported !== false || !hash.test(candidate.sourceProofSha256)) return false;
  const resources = candidate.otlp?.resourceSpans;
  if (!Array.isArray(resources) || resources.length !== 1 || !Array.isArray(resources[0]?.scopeSpans) || resources[0].scopeSpans.length !== 1 || !Array.isArray(resources[0].scopeSpans[0]?.spans)) return false;
  const spans = resources[0].scopeSpans[0].spans;
  if (!spans.every(span => span && spanNames.has(span.name) && /^[a-f0-9]{32}$/.test(span.traceId) && /^[a-f0-9]{16}$/.test(span.spanId) && (!span.parentSpanId || /^[a-f0-9]{16}$/.test(span.parentSpanId)) && Array.isArray(span.attributes) && span.attributes.every(item => item && typeof item.key === 'string' && item.value && typeof item.value === 'object'))) return false;
  const roots = spans.filter(span => span.name === 'workspace-answer');
  return roots.length <= 1000 && roots.every(span => !span.parentSpanId) && new Set(roots.map(span => span.traceId)).size === roots.length && spans.every(span => span.name === 'workspace-answer' || roots.some(root => span.traceId === root.traceId && span.parentSpanId === root.spanId));
}

function workflows(preview: Preview): Workflow[] {
  const spans = preview.otlp.resourceSpans[0].scopeSpans[0].spans;
  return spans.filter(span => span.name === 'workspace-answer').map(root => ({ root, stages: spans.filter(span => span.traceId === root.traceId && span.parentSpanId === root.spanId) }));
}

function Resources({ span, root = false }: { span: Span; root?: boolean }) {
  const usage = tokens(span);
  const duration = elapsed(span, root);
  return <dl className="trace-resources">
    <div><dt>{root ? 'Workflow elapsed' : 'Stage elapsed'}</dt><dd>{duration}</dd>{duration === 'Unknown' && <small>{root ? 'Snapshot; elapsed time unavailable' : 'Snapshot; stage timing unavailable'}</small>}</div>
    <div><dt>Recorded tokens</dt><dd>{usage ? (usage.input + usage.output).toLocaleString() : 'Unknown'}</dd>{usage && <small>{usage.input.toLocaleString()} input · {usage.output.toLocaleString()} output</small>}</div>
  </dl>;
}

function Check({ span }: { span: Span }) {
  if (attribute(span, 'assessment_available') !== true) return null;
  const kind = attribute(span, 'assessment_kind');
  return <details className="trace-check"><summary>Inspect recorded check</summary><p>{kind === 'synthetic_scripted_claim_support' ? 'Scripted synthetic check' : kind === 'ai_claim_support_estimate' ? 'AI source-support estimate' : 'Assessment provenance unknown'} · calibration not measured</p><dl>
    {([['question_coverage', 'Question coverage'], ['answerability', 'Answerability'], ['correctness', 'Source consistency'], ['uncertainty_handling', 'Uncertainty handling']] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd><Badge value={category(span, key)} /></dd></div>)}
  </dl></details>;
}

/** Read-only local evidence projection; mounting this component never starts generation. */
export function WorkflowTrace({ refreshKey }: { refreshKey?: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const detailId = useId();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setPreview(null);
    fetch('/api/workspace/observability', { signal: controller.signal, cache: 'no-store', headers: { accept: 'application/json' } })
      .then(async response => {
        if (!response.ok) throw new Error(traceUnavailable);
        const value: unknown = await response.json();
        if (!isPreview(value)) throw new TraceMetadataFormatError();
        return value;
      })
      .then(value => { if (!controller.signal.aborted) setPreview(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof TraceMetadataFormatError ? traceUnexpectedFormat : traceUnavailable); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey, attempt]);

  const items = preview ? workflows(preview) : [];
  const selected = items.find(item => item.root.traceId === selectedId) ?? items[0];
  const index = selected ? items.indexOf(selected) : -1;
  const stageCount = items.reduce((sum, item) => sum + item.stages.length, 0);
  const unresolved = items.filter(item => category(item.root, 'automated_paired_outcome') === 'unresolved').length;
  const failed = items.reduce((sum, item) => sum + [item.root, ...item.stages].filter(span => ['failed', 'invalid', 'interrupted'].includes(category(span, 'status'))).length, 0);

  return <section className="workflow-trace" aria-label="Saved workflow traces" aria-busy={loading}>
    <div className="trace-intro"><div><span className="trace-eyebrow">FOLLOW THE WORKFLOW</span><h3>Every recorded step, in view.</h3><p>Inspect generation, source checks, repairs and unresolved outcomes.</p></div><span className="trace-local"><i aria-hidden="true" />Local preview · not uploaded</span></div>
    {loading && <p className="trace-state" role="status">Loading saved trace metadata…</p>}
    {error && <div className="trace-state trace-error" role="alert"><strong>Trace preview unavailable.</strong><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry inspection</button></div>}
    {!loading && !error && !items.length && <div className="trace-state"><strong>No saved workflow traces yet.</strong><p>A saved answer will appear here with its recorded checks and any repairs.</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Refresh saved traces</button></div>}
    {!loading && !error && !!items.length && <>
      <div className="trace-summary" aria-label="Trace summary"><div><strong>{items.length}</strong><span>Workflows</span></div><div><strong>{stageCount}</strong><span>Recorded stages</span></div><div className="trace-summary-uncertain"><strong>{unresolved}</strong><span>Unresolved outcomes</span></div><div className={failed ? 'trace-summary-negative' : ''}><strong>{failed}</strong><span>Failed or invalid records</span></div></div>
      <div className="trace-browser"><nav className="trace-cases" aria-label="Select a saved workflow">{items.map((item, position) => <button type="button" key={item.root.traceId} aria-pressed={item === selected} aria-controls={detailId} onClick={() => setSelectedId(item.root.traceId)}><span><strong>Case {position + 1}</strong><small>{mode(item.root)}</small></span><Badge value={category(item.root, 'automated_paired_outcome')} /></button>)}</nav>
        {selected && <section id={detailId} className="trace-detail" aria-label={`Case ${index + 1} workflow`}><div className="trace-detail-heading"><div><span className="trace-eyebrow">CASE {index + 1} · {mode(selected.root)}</span><h4>Answer workflow</h4></div><Badge value={category(selected.root, 'status')} /></div>
          <div className="trace-root"><div className="trace-root-label"><span className="trace-root-icon" aria-hidden="true">↳</span><strong>Saved workflow</strong><Badge value={category(selected.root, 'automatic_status')} /></div><Resources span={selected.root} root /><p className="trace-outcome">Paired outcome: <Badge value={category(selected.root, 'automated_paired_outcome')} /> <span>Automated assessment</span></p></div>
          {selected.stages.length ? <ol className="trace-timeline" aria-label="Recorded child stages">{selected.stages.map((span, position) => <li key={span.spanId}><span className="trace-step-number" aria-hidden="true">{position + 1}</span><div className="trace-stage"><div className="trace-stage-heading"><h5>{stageName(span)}</h5><Badge value={category(span, 'status')} /></div><Resources span={span} /><Check span={span} /></div></li>)}</ol> : <p className="trace-no-stages">No child-stage records are available for this workflow.</p>}
          <details className="trace-identities"><summary>Inspect trace identity</summary><dl><dt>Opaque trace ID</dt><dd><code>{selected.root.traceId}</code></dd><dt>Source proof SHA-256</dt><dd><code>{preview?.sourceProofSha256}</code></dd></dl></details>
        </section>}
      </div>
    </>}
    <div className="trace-footer"><div><strong>Saved metadata, with its limits.</strong><p>Missing timing and token measurements remain unknown. AI checks are provisional; synthetic cases are labeled.</p></div><a href="/api/workspace/observability/export" className="ask-secondary">Download trace metadata <span aria-hidden="true">↗</span></a><small>Langfuse-compatible preview · downloading saves a local file.</small></div>
  </section>;
}
