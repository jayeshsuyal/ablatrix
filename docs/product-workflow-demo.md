# Inspect the local product workflow

Run `npm ci` and `npm run demo`, then open [127.0.0.1:4184](http://127.0.0.1:4184). Node 24.10+ is required. The launcher builds the UI and runs a loopback-only synthetic server without loading `.env`, provider credentials or embedding weights. Each start creates fresh files under `work/demo/session-*`; these are disposable demonstration data, separate from saved live evidence.

## Five-minute route

1. **Recovered original.** The Thistle flask question starts from an injected interruption after the original receipt was persisted. Startup replays that exact receipt, saves the completed answer and resumes its requested automatic check. The UI labels the recovered run; the demo manifest keeps its original receipt ID.
2. **Bounded correction.** The original claims eight cups while the exact saved specification states six. Inspect why the scripted check requested correction. One revision is saved and independently rechecked. Open exact saved sources and compare the answer to the body text. Synthetic fixtures demonstrate transitions, not measured semantic reliability.
3. **Safe stop.** Select the Aster storage-box temperature question. Its scripted check remains uncertain and produces a safe stop. The original is still inspectable; uncertainty does not silently become a successful answer.
4. **New question.** Generate another synthetic answer with automatic checking enabled. Reloading or retrying after a lost response reuses the saved request key rather than requesting another original.
5. **Proof and export.** Compare paired wins/ties/regressions/unresolved cases, then inspect total time, provider calls, recorded operations, usage and planning allowances (live receipt counts are provider attempts; actual transport can remain unknown). Download the exact evidence bundle. Opening the proof or export does not start work.
6. **Workflow trace.** Select **Workflow trace** to load a read-only local preview. Choose a case and follow its original generation, check, repair and recheck stages. Inspect status, recorded elapsed time, token usage and check uncertainty. Snapshot timing remains **Unknown** rather than appearing as a zero-duration model call. **Download trace metadata** saves only allowlisted metadata; it is separate from the full proof download. The view is labeled **Local preview · not uploaded** and performs no cloud sync.
7. **Rejected future-policy candidate.** Expand Answer policy. A separate actual 13-operation synthetic trial evaluates a blanket-abstaining candidate, records the regression and unnecessary refusals, and rejects it. The baseline pointer remains active; no live quality gain or human review is created.

The proof export is available at `/api/workspace/proof/export`; `/api/workspace/proof` is the same inspectable JSON without the download header. The pure `verifyWorkspaceProof` function in `server/workspace-proof.ts` verifies saved bundles offline, without a provider or reservation. It preserves unresolved and missing measurements. This is a local consistency verifier, not provider attestation or independent correctness certification.

The trace view fetches `/api/workspace/observability` only when opened. `/api/workspace/observability/export` downloads the same metadata-only projection. Both routes verify saved evidence and preserve failed or unresolved records; opening, refreshing or downloading the preview starts no workflow operation. Questions, answers and source bodies are absent from the trace payload. The [trace preview guide](workspace-observability-preview.md) covers the local CLI and data boundary. Its Langfuse-compatible format has not been tested against remote ingestion.

The separate **recorded live answer** opens one already-public September 28 response with all its saved retrieved excerpts. It is read only and retains the older context limitation. The **recorded live qualification** panel shows the sanitized failed October 16 run. Neither panel generates, resumes or authorizes paid work.

## Evidence and limits

- Original source text, answer versions, exact request hashes and receipts remain saved.
- Synthetic transitions and scripted evaluation labels do not create human judgments or establish model improvement.
- A source quote matching literal text does not prove applicability, cited support, factual correctness or completeness.
- Failed and incomplete grader qualification cannot enable a live runtime grader or release a policy. Current live release remains closed.
- The product proof compares an original with its repair. A future-policy improvement requires a separate fresh comparison.
- The [current-results index](current-results.md) records live denominators, uncertainty and unsuccessful attempts. The [release plan](next-release-plan.md) defines the remaining evidence boundaries.

## Walkthrough artifacts

Watch the [actual 72-second synthetic browser walkthrough](assets/product-workflow-2026-10-17.webm), inspect the [full source-and-repair screenshot](assets/product-workflow-2026-10-17.png), or open the [mobile view](assets/product-workflow-mobile-2026-10-17.png). The [capture record](assets/product-workflow-capture-2026-10-17.json) binds artifact hashes, actual stage times, zero external requests and a successful current offline verification of the downloaded proof. These are browser recordings of scripted fixtures, never live-model evidence.

The October 17 recordings predate the Workflow trace tab; the current local demo includes the trace step above.

To reproduce a new capture while the isolated demo is running:

```sh
node --import tsx scripts/product-demo-walkthrough.ts --base http://127.0.0.1:4184 --out /tmp/new-ablatrix-capture
```

The output directory must not already exist. The recorder refuses non-loopback hosts, port 4194 and any session that is not the isolated synthetic demo. It blocks external browser requests and fails if the exported evidence cannot be verified.
