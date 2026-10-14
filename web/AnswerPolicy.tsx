import React, { useEffect, useState } from 'react';
import { z } from 'zod';

// Validate the fields rendered by this panel so an unavailable or malformed
// inspection response cannot remove the question form.
const modeSchema = z.enum(['live', 'synthetic']);
const bindingSchema = z.object({ id: z.string(), instructionSha256: z.string(), mode: modeSchema });
const policySchema = bindingSchema.extend({ instructions: z.string(), parentId: z.string().nullable(), status: z.enum(['baseline', 'candidate']),
  provenance: z.enum(['workspace_baseline', 'automated_instruction_proposal', 'synthetic_instruction_proposal']) });
const statusSchema = z.object({ mode: modeSchema,
  policies: z.object({ active: policySchema, versions: z.array(policySchema), decisions: z.array(z.object({ id: z.string(), mode: modeSchema,
    parent: bindingSchema, candidate: bindingSchema.nullable(), complete: z.boolean(), verdict: z.enum(['eligible_synthetic_trial', 'shadow_candidate', 'rejected', 'inconclusive']),
    callCeiling: z.literal(13), operations: z.array(z.unknown()), reasons: z.array(z.string()), baseline: z.object({ usefulSupportedAnswers: z.number() }),
    candidateMetrics: z.object({ usefulSupportedAnswers: z.number(), regressions: z.number() }) })) }),
  readiness: z.object({ ready: z.boolean(), reason: z.string() }) });
type Status = z.infer<typeof statusSchema>;
async function readStatus(): Promise<Status> {
  const response = await fetch('/api/workspace/answer-policy');
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Policy status is unavailable.');
  const parsed = statusSchema.safeParse(value);
  if (!parsed.success) throw new Error('Policy status is unavailable: invalid response.');
  return parsed.data;
}

/** A compact inspection view; reads never schedule policy work. */
export function AnswerPolicy({ canWrite, refreshKey }: { canWrite: boolean; refreshKey: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    readStatus().then(value => { if (alive) { setStatus(value); setError(''); } }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : 'Policy status is unavailable.'); });
    return () => { alive = false; };
  }, [refreshKey]);
  async function act(path: string, body: object) {
    setBusy(true); setError('');
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Policy action failed.');
      setStatus(await readStatus());
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Policy action failed.'); }
    finally { setBusy(false); }
  }
  const active = status?.policies.active, decision = status?.policies.decisions[0];
  const latestCandidate = status?.policies.versions.find(policy => policy.status === 'candidate');
  const candidate = decision?.candidate ? status?.policies.versions.find(policy => policy.id === decision.candidate!.id) : latestCandidate;
  const trialReady = status?.mode === 'synthetic' && decision?.verdict === 'eligible_synthetic_trial' && decision.complete && active?.id === decision.parent.id;
  return <details className="ask-policy" aria-label="Runtime answer policy">
    <summary>Answer policy · {active?.parentId ? 'automated synthetic trial' : 'workspace baseline'}</summary>
    <p>Each new answer captures its policy before retrieval. Activation and rollback affect later questions.</p>
    {active && <><dl><dt>Active version</dt><dd>{active.id}</dd><dt>Instruction hash</dt><dd>{active.instructionSha256}</dd><dt>Provenance</dt><dd>{active.provenance.replaceAll('_', ' ')} · {status!.mode}</dd></dl><details><summary>Exact active instructions</summary><p className="ask-policy-instructions">{active.instructions}</p></details></>}
    <p>{status?.mode === 'synthetic' ? 'Synthetic trial only. Scripted results do not establish answer quality.' : 'Live activation is closed. The AI grader has no measured calibration or separately qualified evaluation gate.'}</p>
    {latestCandidate && (!decision || latestCandidate.id !== decision.candidate?.id) && <p>Candidate: {latestCandidate.id}. Evaluation is pending; no trial activation is available.</p>}
    {decision && <div className="ask-policy-decision"><strong>Latest automated trial: {decision.verdict.replaceAll('_', ' ')}</strong><p>{candidate?.id ?? 'No candidate saved'} · {decision.operations.length}/{decision.callCeiling} recorded phases</p><p>{decision.reasons.join(' ')}</p><small>Useful supported answers: {decision.baseline.usefulSupportedAnswers} → {decision.candidateMetrics.usefulSupportedAnswers}. Regressions: {decision.candidateMetrics.regressions}. These are {decision.mode === 'synthetic' ? 'scripted fixture results' : 'uncalibrated AI estimates'}.</small></div>}
    <p className="ask-readiness">{status?.readiness.reason}</p>
    {error && <p className="ask-alert" role="alert">{error}</p>}
    <div className="ask-form-actions"><button className="ask-secondary" disabled={busy} onClick={() => { void readStatus().then(value => { setStatus(value); setError(''); }).catch(reason => setError(reason.message)); }}>Refresh status</button><a href="/api/workspace/answer-policy/export">Export exact trial evidence ↗</a>{trialReady && <button className="ask-secondary" disabled={!canWrite || busy} onClick={() => { void act(`/api/workspace/answer-policy/trials/${decision!.id}/activate`, {}); }}>Activate synthetic trial</button>}{active?.parentId && <button className="ask-secondary" disabled={!canWrite || busy} onClick={() => { void act('/api/workspace/answer-policy/rollback', { expectedActiveId: active.id }); }}>Roll back to parent policy</button>}</div>
  </details>;
}
