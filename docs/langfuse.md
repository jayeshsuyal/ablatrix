# Langfuse integration

Ablatrix can export saved product-QA runs and confirmed human feedback to a Langfuse project. Open **/loop → History → Sync to Langfuse**. Sync reads existing experiment records; it does not call Sapiom, generate new answers, or change a policy or review.

The integration is optional. With the default settings it makes no outbound requests. Langfuse does not need to be available for the local experiment to work.

## Connect a project

Create project API keys in the Langfuse project you want to use, or use an existing project's keys. Put the following settings in this repository's ignored `.env` file. Keep real keys out of source control and browser code.

```dotenv
ABLATRIX_LANGFUSE_ENABLED=1
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=your-project-public-key
LANGFUSE_SECRET_KEY=your-project-secret-key
ABLATRIX_LANGFUSE_DB=.data/langfuse-export.sqlite
```

Set the base URL to your project's actual regional endpoint or self-hosted origin. The URL above is an example, not an inferred destination. HTTPS is required except for a local loopback server. Restart the app with `npm start`, open History, inspect the destination, and click **Sync to Langfuse**. Configuration readiness means the settings are present; successful ingestion is shown separately after sync. No automatic background export is performed.

The backend uses the public and secret keys for Basic authentication. The browser receives connection status and counts, never either key. Changing the destination or project public key selects a separate delivery ledger scope. Preserve the ledger when restarting or deploying the same experiment.

## Exported records

Eligible records are finished live runs. Development runs may be exported before review. Paired validation runs are eligible only after a reviewed decision has recorded its scores; final runs are eligible only after the final report. Running, unresolved, interrupted comparisons and synthetic runs are excluded. The exporter checks these conditions in addition to using the app's public projection.

Each trace records the question, answer and citations, run/product/case identity, policy identity and instructions, model identity, provider-reported token usage when available, retrieval method, and retrieved passage identities and hashes. These are saved experiment artifacts. Full source documents, AI review drafts, reviewer names, credentials and raw provider errors are excluded.

New runs record separate retrieval and model-call timestamps. Shared retrieval in paired comparisons is marked as reused. Historical runs without these timestamps have an overall run span and saved retrieval metadata; the exporter does not invent a model-only duration. Timing fields are concealed alongside policy identity in the app's blind review cards.

Confirmed, reference-checked human feedback creates correctness, support and failure-category scores. AI-assisted human reviews retain their draft provenance; an AI draft by itself never becomes a score. Scores describe the human judgment in the local experiment. Sync does not add ground-truth labels or complete the human review requirement.

Actual Sapiom billed cost remains unavailable. Any cost Langfuse estimates from model pricing and tokens must be identified as an estimate, not Sapiom settlement.

## Delivery and failure handling

Traces use OTLP/HTTP JSON at `/api/public/otel/v1/traces`. Human scores use score-only batches at `/api/public/ingestion`. No legacy trace-create or generation-create ingestion events are used, and no additional runtime dependency is required.

A separate SQLite ledger tracks delivery attempts. Accepted counts mean the ingestion endpoint acknowledged the records, including Langfuse Cloud's OTLP queue receipt; remote query views can take time to update. A timeout, partial acceptance or ambiguous response is surfaced as uncertain. An explicit rejection is surfaced separately. The exporter does not silently resend uncertain trace deliveries: current Langfuse tracing can duplicate metrics on re-ingestion even when IDs are reused. Keep the ledger and inspect the destination before attempting manual recovery. Local experiment results remain intact regardless of transport outcome.

Repeated syncs skip already accepted traces and unchanged scores. Later human feedback is sent as scores associated with the saved trace. The adapter uses stable score identity and timestamps to support updates; the actual review time is retained in score metadata. The UI's accepted-score count includes acknowledged update events, rather than counting unique judgments or questions. Trace data is finalized before export and is not rewritten as feedback changes.

After correcting a definite rejection (for example, a wrong project secret), another explicit sync may retry that rejected record. An uncertain trace remains blocked from resend. Score deliveries with an uncertain outcome can be retried with their stable score identity. Each sync processes at most 100 eligible runs with pending work; the status indicates when another sync is needed.

## Scope and verification

This slice supplies explicit export and an inspection surface. Policy proposals, blind review, promotion, rollback and the canonical experiment records remain in Ablatrix. It does not register Langfuse-managed prompts or create Langfuse dataset experiments. These can be added if the workflow needs them.

Transport tests use injected responses, including Cloud queue receipts, partial failures, timeouts and restart behavior. Browser tests mock Langfuse status/sync. The configured US project authenticated on 2026-09-25; its v2 observations API returned 22 observations across exact IDs for all 11 saved live traces. The local ledger records 11 accepted traces, zero uncertain deliveries and zero rejected deliveries. The connection test made no paid model calls.

The live development batch currently contains ten answers and ten AI review drafts, with zero confirmed human judgments. The next experiment step is human source review. A policy update requires a reviewed failure, and a positive result requires completing the paired evaluation. Langfuse integration alone establishes no answer-quality improvement.

## Protocol references

- [Langfuse OTLP quickstart](https://langfuse.com/docs/observability/get-started)
- [OpenTelemetry attribute mapping](https://langfuse.com/integrations/native/opentelemetry)
- [Trace update and duplicate behavior](https://langfuse.com/faq/all/tracing-data-updates)
- [Score API and SDK behavior](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk)
- [Public API and ingestion migration](https://langfuse.com/docs/api-and-data-platform/features/public-api)
- [OTLP response and partial success specification](https://opentelemetry.io/docs/specs/otlp/)
