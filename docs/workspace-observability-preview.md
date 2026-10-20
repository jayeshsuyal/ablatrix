# Workspace observability preview

Ablatrix's **Workflow trace** view makes saved generation, check, repair and recheck stages inspectable in the product workspace. It is a read-only local preview of verified evidence. No telemetry account, cloud upload or new model call is needed.

The preview starts with `verifyWorkspaceProof`. It then maps each saved request into a workflow trace and its recorded generation/check/repair/recheck observations. Exact proof, source, request, policy and receipt hashes connect observations to the authoritative local records. Unknown timing or usage stays unknown; synthetic records remain labeled synthetic and failed or unresolved requests remain included. Source checks remain automated estimates, with no human provenance or answer-quality certification.

## Inspect in the workspace

Run `npm run demo`, open [the local demo](http://127.0.0.1:4184), and select **Workflow trace** under the workflow proof. Trace metadata loads only when that view opens. Selecting a case shows its parent workflow, every saved child stage, statuses, recorded elapsed time and known input/output token usage. Snapshot stages with no measured duration show **Unknown**, including original generation when separate stage timestamps are unavailable. Recorded checks retain their source-consistency, coverage, answerability and uncertainty categories, with AI or scripted provenance.

**Download trace metadata** saves the metadata-only preview. It is separate from **Export exact paired evidence**, which contains the full proof with saved answer/source content. The trace view uses opaque case labels and omits that content. Opening the view, retrying inspection or downloading metadata does not generate an answer, enqueue a check or upload to Langfuse.

The read-only endpoints are `GET /api/workspace/observability` and `GET /api/workspace/observability/export`; the latter adds a JSON download header. Both verify current saved evidence before projecting it, return uncached metadata and fail without a partial trace when evidence cannot be verified. Hosted reads use the existing authenticated reader permissions; they do not introduce a new public export surface. The isolated synthetic demo uses the same preview routes.

## Run locally

No new package, credential, account or model call is required:

```sh
node --import tsx scripts/workspace-observability-preview-v1.ts
node --import tsx scripts/workspace-observability-preview-v1.ts --preview --proof docs/evidence/workflow-engineering-2026-10-17/development-proof-v1.json --out "$PWD/.data/workspace-observability-preview-v1.json"
```

Choose a new absolute output file with a canonical existing parent. The supplied public fixture is synthetic. For a `development-proof-rehearsal-v1` wrapper, only its workspace proof is verified and previewed; the separately labeled rewrite control is outside this adapter's scope. A raw downloaded `workspace-paired-proof-v1` export is also accepted. Failed proof verification produces no preview.

The JSON contains an OTLP/HTTP JSON payload under `otlp`, plus local provenance fields. It is a local preview, not a delivery receipt. The CLI reads no telemetry configuration and sends no HTTP requests; the workspace view fetches metadata from its local application server. Neither path performs cloud ingestion. Remote Langfuse ingestion of this new workspace format has not been tested.

## Data boundary

The adapter constructs observations from an explicit metadata allowlist. It omits questions, answers, source bodies, citation text, policy instructions, critique, reviewer notes, product titles and credentials. Identifiers are hashed; categorical strings are constrained. Extra free-text fields never become observation metadata.

Missing separate generation timestamps cannot become a fabricated model duration. Snapshot observations are labeled accordingly. Recorded operation timestamps can describe their own phases, while known tokens, unknown usage and planning allowances retain distinct meanings. A local planning allowance is not a settled provider charge.

The existing SQLite source records, canonical call ledger and receipt replay remain authoritative. The preview does not alter historical freezes, enable a provider, activate an answer policy or create a paid plan. The optional [older `/loop` Langfuse exporter](langfuse.md) has a different payload scope, including saved question/answer text; it is not used by this preview.

## Tool choice

[Langfuse](https://langfuse.com/docs/observability/overview) fits trace inspection, token/latency monitoring and [dataset experiments](https://langfuse.com/docs/evaluation/overview). Its current [JavaScript tracing interfaces](https://langfuse.com/docs/observability/sdk/overview) build on OpenTelemetry. The existing direct OTLP path lets this preview stay dependency-free.

[LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) becomes useful if the product grows into dynamic graph execution or many additional workflows. The current bounded worker already has durable phases, leases, immutable inputs and receipt recovery, so this slice keeps that implementation.

[Promptfoo assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/) are an optional future convenience for prompt regression matrices. The current bounded comparison runner and accounting checks already cover this project's execution requirements. No additional evaluation runner is installed here.

## Verification

```sh
node --import tsx --test server/workspace-observability-v1.test.ts server/workspace-observability-cli-v1.test.ts server/workspace-observability-api.test.ts
npx tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2023 --strict --skipLibCheck scripts/workspace-observability-preview-v1.ts
```

The tests use synthetic records, privacy canaries and injected network rejection. Adapter and CLI checks cover proof tampering, stable identities, absent measurements, retained failures and new-file output behavior. API checks cover authenticated reads, metadata-only payloads, failed verification and unchanged workflow/provider ledgers. Browser checks cover lazy loading, case selection, missing measurements, sanitized errors, retry and metadata download. These checks do not establish remote ingestion, provider authenticity or model quality.
