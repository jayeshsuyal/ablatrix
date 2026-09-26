import React, { useEffect, useState } from 'react';

type TelemetryStatus = {
  enabled: boolean;
  ready: boolean;
  busy: boolean;
  reason: string;
  destination: string | null;
  deliveredTraces: number;
  deliveredScores: number;
  uncertain: number;
  rejected: number;
  lastSyncAt: string | null;
};

async function telemetryRequest(options?: RequestInit): Promise<TelemetryStatus> {
  const response = await fetch(`/api/loop/telemetry${options?.method === 'POST' ? '/sync' : ''}`, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Could not reach the telemetry service.');
  return value as TelemetryStatus;
}

export function LoopTelemetry({ workflowBusy }: { workflowBusy: boolean }) {
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    telemetryRequest({ signal: controller.signal }).then(setStatus).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load telemetry status.');
    });
    return () => controller.abort();
  }, []);

  async function sync() {
    if (!status?.ready || status.busy || workflowBusy || syncing) return;
    setSyncing(true);
    setError('');
    try { setStatus(await telemetryRequest({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sync could not be completed.');
      // A failed request can still have reached ingestion. Refresh the local delivery ledger.
      await telemetryRequest().then(setStatus).catch(() => {});
    } finally { setSyncing(false); }
  }

  const busy = syncing || !!status?.busy;
  return <section className="fl-panel fl-telemetry" aria-label="Langfuse integration">
    <div className="fl-section-heading"><div><span className="fl-eyebrow">OPTIONAL INTEGRATION</span><h2>Inspect this experiment in Langfuse.</h2></div><span className={`fl-badge ${status?.ready ? 'fl-badge-green' : ''}`}>{busy ? 'Syncing…' : status?.ready ? 'Ready to sync' : status ? 'Not connected' : error ? 'Status unavailable' : 'Checking configuration'}</span></div>
    <p className="fl-muted">Sync saved live questions, answers, policy and retrieval metadata, plus confirmed human scores to your configured Langfuse project. Blind comparisons export after their decision or report. AI review drafts are excluded. Sync makes no new model calls.</p>
    {status && <>
      <p className="fl-telemetry-reason" role="status">{status.reason}</p>
      {!status.ready && <p className="fl-help">Configure the Langfuse project on this server to enable sync.</p>}
      {status.destination && <p className="fl-telemetry-destination">Destination: <span>{status.destination}</span></p>}
      <dl className="fl-telemetry-counts">
        <div><dt>Accepted traces</dt><dd>{status.deliveredTraces}</dd></div>
        <div><dt>Accepted scores</dt><dd>{status.deliveredScores}</dd></div>
        <div><dt>Unconfirmed events</dt><dd>{status.uncertain}</dd></div>
        <div><dt>Rejected events</dt><dd>{status.rejected}</dd></div>
      </dl>
      <p className="fl-help">Accepted by ingestion; records may take time to appear in Langfuse.{status.lastSyncAt && <> Last sync: <time dateTime={status.lastSyncAt}>{new Date(status.lastSyncAt).toLocaleString()}</time>.</>}</p>
    </>}
    {error && <p className="fl-telemetry-error" role="alert">{error}</p>}
    <div className="fl-telemetry-action"><button className="fl-button fl-button-secondary" disabled={!status?.ready || busy || workflowBusy} onClick={sync}>{busy ? 'Syncing to Langfuse…' : 'Sync to Langfuse'}</button>{workflowBusy && <small>Available when the experiment finishes.</small>}</div>
  </section>;
}
