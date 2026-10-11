# Context comparison import and review contract

This workbench imports experiment records for review. It has no provider, background generation worker or paid execution route. Imported live packets are **unverified records**: hashes establish internal consistency, not provider authenticity, preregistration, or representative fresh-product selection. Two explicitly tagged experiments share the workbench:

| Packet format | Controlled change |
| --- | --- |
| `ablatrix-context-comparison-v1` | Original customer-question metadata omitted versus retained; existing protocol unchanged. |
| `ablatrix-correction-comparison-v1` | Baseline versus candidate revision instructions; both receive identical original answers, critiques and source context. |

See the [original-question protocol](context-comparison-protocol.md) and [correction-policy experiment](correction-policy-experiment.md). Importing either format grants no authority to generate answers or promote a policy.

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

## Original-question packet (unchanged)

Format is `ablatrix-context-comparison-v1`. A packet contains `id`, `title`, `mode` (`fixture` or `live`), `createdAt`, fixed hypothesis `preserve_original_customer_question`, `protocol`, `provenance` and 1–20 cases. See the exported `ContextComparisonPacket` type for exact fields.

Each case freezes product identity, question, complete source snapshots, ordered retrieval source IDs and both attempts: `without_context` and `with_context`. Sources retain a separate `originalQuestion`; legacy inline `Question:` text is rejected. Both controlled inputs use identical source bodies, quote options, policy and declared model alias. Only the separate customer-question metadata varies. `contextComparisonInput()` and `contextComparisonHash()` construct and hash this declared projection. A hash does not prove that a historical provider received those inputs.

Each attempt has an ID, input hash, status (`completed`, `failed`, `uncertain`), answer or null, model, answer-stage latency, token usage, provider-call ID and error. Completed imported live attempts require recorded provider IDs and a matching supported model identity. Missing arms, conflicting input hashes and duplicate identities are rejected. Failed or uncertain attempts remain explicit and cannot become ties. Invalid literal citations remain inspectable but cannot receive a `supported` judgment.

Import rejects the 56 products in the existing development/validation corpus, final corpus and pinned paid batch for live packets. A caller may supply additional `excludedProductIds`, such as prior workspace exposures. The comparison database also reserves product IDs and normalized complete-source fingerprints across imports. Fixture exposure uses a separate namespace. These checks cannot establish real-world product-family independence or authenticate caller-supplied identities; they do not certify freshness.

## Correction-policy packet

`CorrectionComparisonPacket` uses `ablatrix-correction-comparison-v1`, hypothesis `compare_correction_policy`, and 1–20 distinct product cases. Each case binds:

- A completed shared `original` answer and its recorded identity and receipt fingerprints; an explicitly `ai_assisted` critique.
- A full reviewer source pool of at most 128 chunks, retaining separate `originalQuestion` fields, and at most eight ordered `generationSourceIds`.
- One shared investigation whose ordered `selectedSourceIds` equal those generation IDs. This format permits no added sources or clarifications.
- Sibling `baseline` and `candidate` revision attempts, each starting from that same original. The candidate never receives the baseline revision as its original.

Both arms retain original customer questions. Only the selected revision instructions and prompt-version label differ: `baseline` uses the existing revision policy; `candidate` selects `candidate_v4`. The protocol binds both full system instructions, their hashes, the full generation-configuration hashes, model alias and citation interface. Import checks these against the versioned implementation. Model route, settings, response schema and output handling are shared within an experiment.

The same packet tag supports three explicit `protocol.citationInterface` values:

| Interface | Citation delivery and import validation |
| --- | --- |
| `passage_quotes` | Existing copied passage IDs/quotes, prompt identities, request hashes and substring checks remain unchanged. This is the helper's default. |
| `source_ids_v1` | Separately versioned original and revision interfaces offer one whole literal body per selected source. The model selects scoped quote-option IDs; the server resolves them to passage IDs and exact quote text. |
| `source_ids_v2` | Retains the identical v1 catalog, scoped IDs and server resolver; new original/revision request schemas enumerate exactly the ordered IDs offered for that case. Prompt/tool identities are separately versioned. |

Select an interface explicitly with `correctionComparisonProtocol(modelAlias, codeCommit, 'source_ids_v1')` or `'source_ids_v2'`. The shared original and both revision arms must use the same declared interface. V2 preserves the earlier interfaces' exact helpers, configuration hashes and frozen records. An interface change belongs to a separately frozen experiment, not a retry or reinterpretation of an existing packet.

For both source-ID interfaces, options bind product, question, ordered selected bodies, source labels/references and original-question context. Original questions remain context and never enter quote text. The comparison still permits at most eight generation sources of at most 2,000 characters each, with an additional 12,000-character total body bound. No sentence splitting or silent clipping occurs. The full reviewer pool remains separate. Every citation in the shared original and completed revisions must resolve to a distinct **actually offered** `{passageId, quote}` option. A literal substring, citation to a review-only source, duplicate selection, unresolved internal ID in answer prose, or unsupported interface/configuration fails import. This mechanical check does not establish semantic support.

`correctionComparisonInput()` defines each controlled input. Its `inputSha256` uses `contextComparisonHash()`; source-ID interfaces additionally bind the interface label and derived quote menu. `correctionComparisonRequestHash()` computes SHA-256 of the serialized request body constructed by `revisionRequestBody()`, `sourceIdRevisionRequestBody()` or `constrainedSourceIdRevisionRequestBody()`, according to the declared interface, with the protocol's model alias. For live packets this is the exact transport-body projection; fixtures use a synthetic model and never dispatch it.

V2's configuration hash uses a deterministic one-source synthetic configuration to bind the version, instructions, generation settings and schema construction. Its **per-case request hash** binds the actual ordered `quoteId.enum` and all case inputs. Reordering, removing or replacing enum entries changes that hash and fails validation against the reconstructed request. An enum sent in a tool schema is not proof that a provider enforces constrained decoding; server validation remains required.

Completed live arms retain separate provider-call IDs. These checks reconstruct declared revision requests; they cannot authenticate dispatch or provider responses. The original-generation input/request fingerprints are recorded declarations, not a reconstruction of its transport body; source-ID original citations are nevertheless checked against the frozen offered options.

Correction arms additionally support `not_attempted`: answer, model, latency, usage and provider-call ID must be null, with an explanation. Its request hash describes the planned request only. It is neither a failed provider call nor a completed answer. If original generation fails, retain that execution record outside this import format, which requires a completed shared original; do not silently shrink the planned cohort.

The same CLI `import` command and product-exposure checks accept this tag. `createCorrectionComparisonFixture()` supplies an explicitly synthetic, no-call test packet; the browser's existing sample button still loads the original-question example. Reviewed exports use `ablatrix-correction-comparison-evidence-v1`; the original format retains its existing export tag.

## Blind review

Public cards contain `label` (`A` or `B`), an opaque `versionId`, attempt status, answer, mechanical `citationCheck`, and saved review. A private persisted key determines A/B assignment. Public cards and lists omit model, timing, arm identity, attempt IDs and input hashes. Full context is available to check both answers.

Correction cards additionally hide the shared original answer, AI-authored critique, investigation, selected generation IDs, offered quote-option IDs, interface/policy/configuration metadata and request hashes until every completed answer has a locked judgment. The reviewer sees both final answers and the full source pool. The revealed critique remains an AI-authored generation input, never a human judgment.

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

While completed answers remain unreviewed, report/export are locked. If an attempt failed, is uncertain, or was `not_attempted`, the unlocked report is `incomplete` and quality is null. Fully completed fixture reports are `synthetic_only` with quality null. Missing attempts never become ties.

Fully completed imported records show separate correctness, support and adequacy counts. The descriptive composite requires all three positive judgments. An uncertain judgment excludes that pair from wins/losses/ties and makes the verdict `inconclusive`. Otherwise the verdict is `exploratory_only`. `qualityClaimEligible` is always false and `interval95` is null: imported packets do not establish a prospective quality gain. Mechanical citation counts remain separate. Billed cost is unknown; recorded answer-stage latency excludes shared retrieval and is not independently verified.

Correction reports instead label recorded **revision-stage** latency, excluding both shared original-answer generation and retrieval. Even with a separate pre-generation manifest, the importer does not independently verify prospectivity or provider authenticity. Neither format produces an automatic quality-gain claim, accepts a product answer, or promotes a policy.
