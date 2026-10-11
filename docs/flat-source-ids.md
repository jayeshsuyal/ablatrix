# Flat source-ID citations

**Status: offline qualification only.** The explicit `source_ids_v3` interface addresses the citation-container failure in the [stopped live diagnostic](evidence/source-id-diagnostic-2026-10-11/live-report.md). No new paid calls or human quality judgments were made. Live output reliability, provider-enforced decoding and answer-quality improvement remain unverified.

## What changed

The diagnostic returned two valid offered IDs as strings, while v2 required objects such as `{"quoteId":"src_…"}`. V3 declares the string-array shape directly:

```json
{"answer":"A supported, attributed answer.","status":"answered","citations":["<actual offered source ID>"]}
```

The placeholder illustrates the format; it is not a legal citation. Each request's tool schema enumerates only that request's scoped IDs, limits the array to five unique entries, and supplies explicit shape examples. Original generation and both revision policies use the same interface. Prompt and tool identities are separately versioned.

The server resolves accepted IDs to the complete supplied bodies, producing the existing `{passageId, quote}` answer format. Original customer questions remain separate context. Unknown, shortened, foreign or duplicate IDs, citationless `answered` outputs, wrong citation shapes and unresolved answer markers fail validation without repair or retry. Legitimate uncertainty may have no citations.

The ordinary product methods and the passage-quote/v1/v2 contracts remain unchanged. V2 still rejects string-array responses; historical results are not reinterpreted. Select v3 explicitly through `answerWithFlatSourceIds()`, `reviseWithFlatSourceIds()` or `correctionComparisonProtocol(modelAlias, codeCommit, 'source_ids_v3')`.

## Reproduce the failure regression without paid calls

From the repository root after `npm ci`:

```sh
node --import tsx --test server/flat-source-ids.test.ts
```

The Q8746 regression reads the published source context and returned IDs, injects a **synthetic placeholder answer**, then verifies that v3 resolves both full bodies while v2 rejects the same citation shape. It does not read a private answer or assess compatibility, claim support or correctness. Other tests check exact request/receipt identities, request isolation, model aliases, bounds and historical hashes. Every provider response is injected; ledgers are temporary or in memory.

For the integration checks:

```sh
node --import tsx --test server/context-comparison.test.ts server/context-comparison-api.test.ts
```

The [existing comparison workbench](context-comparison-contract.md#correction-policy-packet) reconstructs v3 revision requests, rejects schema substitutions, hides shared originals/AI critiques and arm metadata during review, and gates exports on source-checked judgments. The importer checks submitted consistency; it does not authenticate a provider response or reconstruct original-generation transport.

## What counts as progress

Offline regression success establishes the local contract. Exact citation matching establishes literal membership. Neither establishes semantic support or answer correctness. The next quality milestone is the [proposed eight-product comparison](flat-source-quality-plan.md), with identical v3 formatting in both arms and sixteen independent blind human judgments. Fresh source preparation, a frozen execution plan and new budget approval precede paid execution.

See the [qualification record](evidence/flat-source-ids-2026-10-11/offline-qualification.json) for commands, file hashes and integrity checks.
