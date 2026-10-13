import React, { useEffect, useState } from 'react';
import type { AutomaticSupportJob } from '../server/automatic-support.ts';
import './automatic-check.css';

type CheckOverview = { checks: AutomaticSupportJob[]; readiness: { ready: boolean; reason: string } };
type CheckState = { qid: string; job?: AutomaticSupportJob; error?: string };
const active = new Set(['queued', 'checking', 'repairing', 'rechecking']);

/** Reads saved jobs only. Polling never starts a check or a paid operation. */
export function useAutomaticCheck(qid?: string, initialJob?: AutomaticSupportJob) {
  const [state, setState] = useState<CheckState>({ qid: '' });
  useEffect(() => {
    if (!qid) { setState({ qid: '' }); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setState({ qid, ...(initialJob?.qid === qid ? { job: initialJob } : {}) });
    async function load() {
      try {
        const response = await fetch(`/api/workspace/automatic-checks?answer=${encodeURIComponent(qid!)}`, { signal: controller.signal });
        const value = await response.json() as CheckOverview & { error?: string };
        if (!response.ok) throw new Error(value.error ?? 'Could not load the saved automatic check.');
        if (cancelled) return;
        const job = value.checks.find(item => item.qid === qid);
        setState({ qid: qid!, ...(job ? { job } : {}) });
        if (job && active.has(job.status)) timer = setTimeout(() => { void load(); }, 2000);
      } catch (reason) {
        if (cancelled || controller.signal.aborted) return;
        setState(current => ({ ...current, qid: qid!, error: reason instanceof Error ? reason.message : 'Could not load the saved automatic check.' }));
      }
    }
    void load();
    return () => { cancelled = true; controller.abort(); if (timer) clearTimeout(timer); };
  }, [qid, initialJob?.id]);
  return state.qid === qid ? state : { qid: qid ?? '' };
}

function statusLabel(job: AutomaticSupportJob) {
  switch (job.status) {
    case 'queued': return 'Source check queued';
    case 'checking': return 'Checking claim support';
    case 'repairing': return 'Repairing once';
    case 'rechecking': return 'Checking the repair';
    case 'supported': return job.mode === 'synthetic' ? 'Synthetic check passed' : 'AI check passed';
    case 'repaired': return job.mode === 'synthetic' ? 'Repaired · synthetic check passed' : 'Repaired · AI check passed';
    case 'abstained': return 'Cannot support an answer';
    case 'reconciliation': return 'Check interrupted · outcome uncertain';
    default: return 'Check inconclusive';
  }
}

export function AutomaticCheck({ state, sourceAnchor = 'id', pending = false, mode }: { state: CheckState; sourceAnchor?: 'id' | 'sha256'; pending?: boolean; mode?: 'live' | 'synthetic' }) {
  const { job, error } = state;
  if (!job && !error && !pending) return null;
  const permitted = !error ? job?.delivery : undefined;
  const sources = job?.original.context.sources ?? [];
  const sourceLink = (id: string) => {
    const source = sources.find(item => item.id === id);
    return `#source-${sourceAnchor === 'id' ? id : source?.sha256 ?? id}`;
  };
  return <section className="automatic-check" aria-label="Automatic source check">
    <div className="automatic-check-heading" role="status" aria-live="polite"><span>AUTOMATIC SOURCE CHECK</span><h3>{error ? 'Check status unavailable' : job ? statusLabel(job) : pending ? 'Source check not confirmed' : 'Check unavailable'}</h3></div>
    <p className="automatic-check-limit">{(job?.mode ?? mode) === 'synthetic' ? 'Scripted demonstration. No model calls or measured answer improvement.' : 'AI estimate of claim support against saved sources. It can miss errors and does not verify whether the sources are true.'}</p>
    {permitted ? <div className="automatic-check-answer"><strong>{permitted.origin === 'safe_abstention' ? 'Response' : permitted.origin === 'repair' ? 'Checked repair' : 'Checked answer'}</strong><p>{permitted.answer.answer}</p>{permitted.answer.citations.map((citation, index) => <a key={index} href={sourceLink(citation.passageId)}>{sources.find(source => source.id === citation.passageId)?.label ?? 'Saved source'}: “{citation.quote}”</a>)}</div> : <p className="automatic-check-pending">{error ? 'The saved answer remains available below. Its automatic check could not be confirmed.' : job && active.has(job.status) ? 'The original is saved below while its claims are checked. At most one repair is attempted.' : pending ? 'Automatic checking was requested, but no saved check is available yet. The original is saved and has not passed a source check.' : 'No answer has been cleared by this check. The original remains saved below.'}</p>}
    {(error || job?.error) && <p className="automatic-check-error">{error ?? job?.error}</p>}
    {!!job?.assessments.length && <details className="automatic-check-assessments"><summary>Why this result?</summary>{job.assessments.map((entry, index) => <div key={index}><h4>{entry.phase === 'original' ? 'Original answer' : 'Repair'} · {entry.assessment.disposition.replaceAll('_', ' ')}</h4><p>{entry.assessment.reason}</p><small>Question coverage: {entry.assessment.questionCoverage} · Sources: {entry.assessment.answerability} · Calibration not measured</small><ol>{entry.assessment.units.map(unit => <li key={unit.unitId}><strong>{unit.verdict.replaceAll('_', ' ')}</strong> · {unit.reason}{unit.evidence.map((evidence, i) => <a key={i} href={sourceLink(evidence.sourceId)}>{sources.find(source => source.id === evidence.sourceId)?.label ?? 'Saved source'} ({evidence.relation}): “{evidence.quote}”</a>)}</li>)}</ol></div>)}</details>}
    {job && <details className="automatic-check-original"><summary>Original answer · {permitted?.origin === 'original' ? 'unchanged' : 'not cleared for use'}</summary><p>{job.original.answer.answer}</p><small>{job.original.model} · saved {new Date(job.original.createdAt).toLocaleString()}</small>{job.original.answer.citations.map((citation, index) => <a key={index} href={sourceLink(citation.passageId)}>{sources.find(source => source.id === citation.passageId)?.label ?? 'Saved source'}: “{citation.quote}”</a>)}</details>}
  </section>;
}
