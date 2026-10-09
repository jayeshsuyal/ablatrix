# Context comparison import and review contract

This workbench imports completed experiment records. It has no provider, background generation worker or paid execution route. Imported live packets are **retrospective, unverified records**: hashes establish internal consistency, not provider authenticity, preregistration, an exact historical system prompt, or representative fresh-product selection.

## Service and routes

`ContextComparisonStore` in `server/context-comparison.ts` exports packet, summary, detail, review and report types.

| Method | Purpose |
| --- | --- |
| `importPacket(raw)` | Validate and atomically freeze a packet with product-exposure reservations; return a summary. Identical replay is safe. |
| `list()` | Return `{ comparisons }`, newest 100 comparisons. |
| `get(id)` | Return blinded case/source cards and progress. |
| `review(id, raw)` | Save one immutable, source-checked answer judgment. |
| `report(id)` | Reveal arms and descriptive results after every completed answer has a judgment. |
| `exportPacket(id)` | Export packet, sorted judgments and report under the same gate; repeated exports are identical. |
| `close()` | Close local SQLite state. |

IDs match `[A-Za-z0-9_-]{1,120}`. Service errors start with `Context comparison:`. HTTP base: `/api/context-comparisons`; detail `GET /:id`, review `POST /:id/reviews`, report `GET /:id/report`, export `GET /:id/export`. Packet import belongs to the CLI. The browser's explicit `POST /fixture` action imports `createContextComparisonFixture()`; it accepts only an empty JSON object and makes no provider call.

## Reproduce without provider calls

```sh
npm ci
npm run compare -- fixture --db .data/context-comparisons.sqlite
npm run local
```

Open `/compare`, inspect both frozen pairs, and submit the four synthetic practice judgments. The first pair tests a customer answer's model-specific scope; the second is an answerable capacity control. All practice records remain synthetic. After the four judgments are saved, inspect the report and download the reviewed JSON. The equivalent CLI export is:

```sh
npm run compare -- export --db .data/context-comparisons.sqlite --id synthetic-context-demo-v1 --out /tmp/ablatrix-context-example.json
```

The output path must be new; the CLI never overwrites an existing export. Every CLI command requires `--db`. The app uses `ABLATRIX_COMPARISON_DB`, defaulting to `.data/context-comparisons.sqlite`. To import an external completed packet, use `npm run compare -- import --db .data/context-comparisons.sqlite --packet /absolute/path/packet.json`; this does not run or retry any model call.

## Frozen packet

Format is `ablatrix-context-comparison-v1`. A packet contains `id`, `title`, `mode` (`fixture` or `live`), `createdAt`, fixed hypothesis `preserve_original_customer_question`, `protocol`, `provenance` and 1–20 cases. See the exported `ContextComparisonPacket` type for exact fields.

Each case freezes product identity, question, complete source snapshots, ordered retrieval source IDs and both attempts: `without_context` and `with_context`. Sources retain a separate `originalQuestion`; legacy inline `Question:` text is rejected. Both controlled inputs use identical source bodies, quote options, policy and declared model alias. Only the separate customer-question metadata varies. `contextComparisonInput()` and `contextComparisonHash()` construct and hash this declared projection. A hash does not prove that a historical provider received those inputs.

Each attempt has an ID, input hash, status (`completed`, `failed`, `uncertain`), answer or null, model, answer-stage latency, token usage, provider-call ID and error. Completed imported live attempts require recorded provider IDs and a matching supported model identity. Missing arms, conflicting input hashes and duplicate identities are rejected. Failed or uncertain attempts remain explicit and cannot become ties. Invalid literal citations remain inspectable but cannot receive a `supported` judgment.

Import rejects the 56 products in the existing development/validation corpus, final corpus and pinned paid batch for live packets. A caller may supply additional `excludedProductIds`, such as prior workspace exposures. The comparison database also reserves product IDs and normalized complete-source fingerprints across imports. Fixture exposure uses a separate namespace. These checks cannot establish real-world product-family independence or authenticate caller-supplied identities; they do not certify freshness.

## Blind review

Public cards contain `label` (`A` or `B`), an opaque `versionId`, attempt status, answer, mechanical `citationCheck`, and saved review. A private persisted key determines A/B assignment. Public cards and lists omit model, timing, arm identity, attempt IDs and input hashes. Full context is available to check both answers.

Review payload:

```json
{
  "manifestSha256": "<packet hash>",
  "caseId": "<case ID>",
  "versionId": "<opaque card version>",
  "reviewer": "Reviewer name",
  "correctness": "correct",
  "support": "supported",
  "adequacy": "adequate",
  "checkedSourceShas": ["<frozen source hash>"],
  "note": "",
  "referenceChecked": true,
  "independentReview": true
}
```

Correctness accepts `correct`, `incorrect`, `uncertain`; support accepts `supported`, `unsupported`, `uncertain`; adequacy accepts `adequate`, `inadequate`, `uncertain`. At least one distinct source and every known cited source must be checked. Negative or uncertain judgments require a note of at least ten characters. Live judgments require an explicit independent source check without AI review suggestions. This is an attestation, not authenticated identity or proof of independence. Fixture judgments always have `kind: synthetic`; live declarations have `kind: human`. A changed manifest, cross-case answer, foreign source or conflicting repeat judgment is rejected.

## Results

While completed answers remain unreviewed, report/export are locked. If an attempt failed or is uncertain, the unlocked report is `incomplete` and quality is null. Fixture reports are `synthetic_only` with quality null.

Fully completed imported records show separate correctness, support and adequacy counts. The descriptive composite requires all three positive judgments. An uncertain judgment excludes that pair from wins/losses/ties and makes the verdict `inconclusive`. Otherwise the verdict is `exploratory_only`. `qualityClaimEligible` is always false and `interval95` is null: imported packets do not establish a prospective quality gain. Mechanical citation counts remain separate. Billed cost is unknown; recorded answer-stage latency excludes shared retrieval and is not independently verified.
