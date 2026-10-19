# Prospective fresh-product validation v1

This is an unexecuted prospective workflow for the unchanged additive v5 candidate. No fresh question/source pool has been consumed. The official protocol/code/history freeze is saved with source-screening qualification still pending; no fresh financial proposal qualifies. The separate development diagnostic must be executed and reviewed first. The ordinary retriever/policy and production activation remain unchanged.

The implementation depends on the development/live-adapter changes in PR #50. Keep this next-protocol slice separate. Generate its official freeze only after the dependency and this slice's implementation are final; any later code, package, history or protocol change requires a new versioned freeze and review. Existing development freezes/results remain historical evidence.

## Fixed recipe and protections

The protocol freezes one externally committed, finite **24-packet source-only screening pool** and a deterministic SHA-256 order using `ablatrix-fresh-product-validation-2026-10-19-v1`. Pool records contain only a product ID/title, the original customer question and complete bounded literal sources with original CQA questions and byte hashes. Outcome/answer/candidate fields are rejected. The independent pool custodian must commit this one pool after protocol review and before any candidate observation; alternate pools, reseeding and replacement after a failed screen are prohibited. Every screened packet, exclusion and uncertain assessment stays in the denominator.

Source-only review selects exactly eight cases, with minima of one supported baseline gap, two baseline-complete controls, one conflicting-report case and one insufficient-evidence case. Tags may overlap; no model-detail-gap quota is required. The selector meets minima in the frozen tag order, fills remaining places by the same frozen question order, then presents selections in screening order. An unmet minimum or fewer than eight eligible packets stops the experiment. Candidate success never enters eligibility. Complete baseline/full-source/title/original-question/reference review for all 24 rows precedes candidate scoring; excluded rows retain an explicit exclusion status.

The history inventory derives an exact union from **every Git-tracked historical JSON artifact under `docs/evidence` and `data/product-qa`**, excluding this protocol's own evidence directory. It recursively verifies and decodes public bundles containing formerly ignored artifacts. It keeps earlier original studies and drafts, the paid eight-product study, the 44 development cases, unsuccessful decks and all twelve now-exposed v2 products. Counts are deduplicated projections, not sums of study denominators. Earlier selection audits also contain identifiers for screened metadata; those identifiers are conservatively protected without claiming that their complete source packets were reviewed. Literal body-plus-original-question fingerprints, canonical titles/families and exact/near model identifiers are separately protected. A matching model identifier is never compatibility evidence.

Both preparation and verification require the complete exact historical path set and raw artifact hashes. A self-consistent inventory that silently omits a nonmandatory historical file fails. New freeze generation requires Git's tracked manifest; a Gitless clean archive can verify an already frozen inventory against its complete public JSON file list. No ignored `work/`, `.data/`, environment file or credential is needed for public inventory verification. Current private inputs and prior failed pools must be preserved and published as appropriate before a later study can claim fresh eligibility.

The existing source-packet guard is integrated in the next selector rather than changing frozen old studies. Cross-product/source-ID changes cannot conceal repeated normalized bodies with the same original question; a different original question remains a distinct scope. NFKC/casefold normalization additionally protects historical compatibility-form variants. Within-pool protection includes earlier rejected rows, not just successful selections. Product IDs, families, models and packet hashes all exclude historical and within-pool overlaps.

## Candidate and reference contracts

V5's frozen model/revision, q8 CPU runtime, exact question-plus-title query, literal-body/original-question documents, 512-token rejection limit, relevance floor, MMR, duplicate rules and three-addition/eight-parent/12,000-character bounds are unchanged. Runtime uses cached BGE and cross-encoder artifacts with downloads disabled. No hosted reranker, generation or judge is available in these preparation commands.

Baseline verification reuses genuine FTS/scope/fusion/selection replay with the existing four-binary64-step tolerance **only for raw BM25 observations**. Identities, order, ranks, contexts and decisions remain exact. Editing baseline parent restoration and its own selected chunks together cannot invent a gap while leaving the trace unchanged. Candidate verification replays all eight rows from exact query/document-bound saved logits and compares every context, decision, scope and delivery result, excluding only observational `proposal.resources`. Saved model scores are replay inputs, not independently authenticated model observations. A separately reviewed raw context-result hash is also required before preparation; valid input/freeze metadata alone cannot authenticate generated output.

The source reviewer records literal designated report units, exact source IDs, applicability and qualifications; preserves conflicting reports and conditions; and explicitly records unknown facts. Reference context must contain every designated unit with its original scope. Insufficient evidence remains insufficient, including unknown population averages or compatibility. Reference sufficiency is an independent source-review attestation, not something citation membership can establish.

## Gates and commands

All commands run from the application checkout. Use fresh output paths. Do not run the screening, baseline or context commands until the exact protocol/code/history review and finite pool commitment exist.

1. After the dependency and next-protocol implementation are final, generate the official freeze without reading any fresh source:

   ```sh
   python3 scripts/prepare-fresh-validation-v1.py freeze --out-dir "$PWD/docs/evidence/retrieval-validation-prospective-2026-10-19"
   python3 scripts/prepare-fresh-validation-v1.py verify --freeze-dir docs/evidence/retrieval-validation-prospective-2026-10-19
   ```

   The committed executable is `9da668426581b8412398946ca0d96b33361d140e`. The saved [official freeze](evidence/retrieval-validation-prospective-2026-10-19/candidate-freeze-v1.json) binds 36 implementation files and the complete history: 212 public JSON artifacts plus nine embedded artifacts, 12,088 source occurrences, 5,389 protected product identifiers, 279 families, 705 model identifiers and 3,547 scoped normalized packet fingerprints. These are conservative exclusion projections, not an eligibility or feasibility claim. Raw protocol SHA-256: `54dc6122fc641448c9e190ca5dac21ee7a33ad79be2fc1d2e7b1202579d0b062`; candidate-freeze SHA-256: `37f4bdf7af6947704b913bf19df10bf727277afcc9ccbded4130fd73470cb752`; history SHA-256: `d2d4bb28fce604e2a979691a84125a00c00f6f56dc4ad9857f21a9a25bf84858`. Verification reproduces the exact inventory. The [pending stop record](evidence/retrieval-validation-prospective-2026-10-19/pending-stop-v1.json) records zero pool reads on the actual guarded screen path. Keep the pending qualification unchanged; the next gate is exact independent review plus one finite pool byte commitment.

2. A named independent reviewer creates a new `ablatrix-fresh-validation-source-screening-qualification-v1` record with status `reviewed_for_source_only_screening`, binding the exact raw protocol/freeze/history hashes, review evidence/timestamp and the one finite pool's SHA-256. Keep the pending record unchanged. The reviewed qualification must attest that fresh inputs were not inspected before protocol review. A pending/mismatched record fails **before the pool is read or stat'ed**.

3. Once qualified, screen that exact pool and prepare only the current baseline:

   ```sh
   python3 scripts/prepare-fresh-validation-v1.py screen --freeze-dir docs/evidence/retrieval-validation-prospective-2026-10-19 --qualification .data/FRESH-QUALIFICATION.json --pool .data/FRESH-POOL.json --out "$PWD/.data/FRESH-SCREENING.json"
   node --import tsx scripts/fresh-validation-contexts-v1.ts --baseline --freeze-dir docs/evidence/retrieval-validation-prospective-2026-10-19 --qualification .data/FRESH-QUALIFICATION.json --pool .data/FRESH-POOL.json --screening .data/FRESH-SCREENING.json --out "$PWD/.data/FRESH-BASELINE.json"
   ```

   The pool format is `ablatrix-fresh-source-only-pool-v1` with exactly 24 `cases`; each case has exactly `id`, `product:{id,title}`, `question`, `sources` and `sourcePoolSha256`. A source has exactly `id,label,text,originalQuestion,reference,sha256`; its SHA binds that ordered six-field record's first five values. `sourcePoolSha256` binds compact ordered source JSON. The independent custodian/source reviewer owns provenance and complete-packet verification; this tool does not download or read the original dataset automatically.

4. Save independent source review for every screened row in `ablatrix-fresh-validation-source-review-v1`. It binds screening identity and the **raw baseline file hash**. For accepted rows it records source/title/original-question/family/reference checks, tags, baseline completeness or semantic gap assessment, designated literal units with applicability/qualifications, reference source IDs and unknowns. Conflicting cases need separately scoped reports and conflict notes; insufficient cases need explicit insufficiency notes. Then freeze eligibility and run the unchanged candidate:

   ```sh
   python3 scripts/prepare-fresh-validation-v1.py select --freeze-dir docs/evidence/retrieval-validation-prospective-2026-10-19 --qualification .data/FRESH-QUALIFICATION.json --pool .data/FRESH-POOL.json --screening .data/FRESH-SCREENING.json --baseline .data/FRESH-BASELINE.json --review .data/FRESH-SOURCE-REVIEW.json --out "$PWD/.data/FRESH-SELECTION.json"
   node --import tsx scripts/fresh-validation-contexts-v1.ts --contexts --freeze-dir docs/evidence/retrieval-validation-prospective-2026-10-19 --qualification .data/FRESH-QUALIFICATION.json --pool .data/FRESH-POOL.json --screening .data/FRESH-SCREENING.json --baseline .data/FRESH-BASELINE.json --review .data/FRESH-SOURCE-REVIEW.json --selection .data/FRESH-SELECTION.json --out "$PWD/.data/FRESH-CONTEXTS.json"
   ```

   Selection invokes full baseline stage replay before accepting a gap. The context CLI recomputes selection before the first candidate score. It retains all eight candidate misses and every unattempted answer arm. A zero designated missing-unit delivery result blocks paid preparation. Model-cache, token-length or replay failure stops; preserve the frozen selection and all failure evidence rather than replacing the case. Baseline/contexts use no real provider calls.

5. Independently review the exact raw context result with `ablatrix-fresh-validation-context-review-v1`. The preparer mechanically replays it again; append-only literal-source forgery, altered delivery counts, mismatched original-question scope, stale parsed snapshots or conflicting hash maps reject. Create a fresh preparation-input manifest (`ablatrix-fresh-validation-preparation-inputs-v1`) listing freeze/qualification/pool/screening/baseline/source-review/selection/context/context-review paths and the real development plan, full checkpoint journal, result, anonymous review, private arm mapping, evaluation packet, imported source-review records and independent outcome-review paths.

   ```sh
   node --import tsx scripts/prepare-three-context-fresh-v1.ts .data/FRESH-PREPARATION-INPUTS.json .data/FRESH-UNQUALIFIED-PREPARATION.json
   ```

   The wrapper replays the real three-arm development receipts and source-aware evaluations and requires every saved attempt/receipt to equal its row in the canonical shared ledger; relabeling a mocked packet is insufficient. The canonical non-development history must still equal the development anchor; later unrelated ledger changes require separate read-only reconciliation, never redispatch. All three development answers must have completed and been judged. A mocked run, a source-delivery result alone, an unresolved material claim/applicability regression, or a preferred current answer cannot unlock fresh planning. Explicit anonymous comparative verdicts are interpreted only after private mapping. Ties/uncertainty need an explicit independent rationale for a bounded exploratory comparison; source-checked human resolution, a saved focused human comparison and explicit resolution rationale are required for substantive reviewer disagreements, including opposing comparative preferences when individual axes agree. This remains an exploratory decision, not a quality claim.

6. Review the exact new code/source/preparation bindings separately. A new `ablatrix-fresh-validation-code-qualification-v1` record can produce a new reviewed preparation only when the reviewed development outcome permits it:

   ```sh
   node --import tsx scripts/prepare-three-context-fresh-v1.ts .data/FRESH-PREPARATION-INPUTS.json .data/FRESH-REVIEWED-PREPARATION.json .data/FRESH-CODE-REVIEW.json EXACT_REVIEW_RECORD_RAW_SHA256
   node --import tsx scripts/three-context-live.ts --prepare --preparation .data/FRESH-REVIEWED-PREPARATION.json --out .data/FRESH-EXACT-PLAN.json
   ```

   Use the existing live CLI's actual usage for plan/verification/export/execution. The fresh diagnostic has format `ablatrix-three-context-fresh-validation-v1`, scope `prospective_fresh_validation` and `split:validation`; it never relabels fresh cases as development. No code/source qualification grants financial approval. Re-read the canonical shared ledger and present the exact fresh plan separately. There is currently **no qualifying fresh budget**; the maximum prospective design is 24 answer calls, zero retries/web/grader calls. Allowances remain local planning limits, not settled provider charges or provider-enforced caps.

Evaluation uses the shared anonymous source-aware importer/report: fact completeness, unsupported claims, exact applicability, uncertainty, relevance and mechanical citation membership stay distinct. Keep complete sources and qualifications with neutral answers; the arm mapping stays private. AI judgments are provisional and can use a small source-checked calibration/reference set plus focused human disagreement review. Agreement is not ground truth. AGENTS.md requires source-checked human reviews and fresh product-disjoint gains for final quality claims/promotion; neither exists here.

## Offline verification

These commands use only synthetic fixtures and temporary ledgers; they do not consume a real fresh pool:

```sh
python3 -m unittest discover -s scripts -p 'test_prepare_fresh_validation_v1.py'
node --import tsx --test server/fresh-validation-v1.test.ts
node --import tsx scripts/fresh-validation-mock.ts
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --skipLibCheck scripts/fresh-validation-contexts-v1.ts scripts/fresh-validation-mock.ts scripts/prepare-three-context-fresh-v1.ts server/fresh-validation-v1.ts
```

The mocked path retains 24 screened packets, selects eight validation cases and runs 24 synthetic answers through the existing provider, durable temporary planning ledger, checkpoints and receipt verifier. Failure on the first arm leaves the other 23 unattempted. Tests also cover pending review before source reads, history and within-deck packet/family/model protection, partial-history resealing, source-scope hashes, genuine baseline stage replay, candidate-output replay, exact parsed snapshots and conflicting raw bindings. No synthetic pass establishes retrieval generalization or answer improvement.

Final executable verification: **700 server passes/one platform skip**, **77 Python passes** (including 11 selector tests), 14 focused prospective TypeScript passes, strict script types, production build, saved-stage replay and the 24-answer synthetic workflow. No real answer, grader or web call has run; actual human source-checked answer judgments remain zero.

The saved [independent protocol-only review](evidence/retrieval-validation-prospective-2026-10-19/protocol-code-review-v1.json), raw SHA-256 `d9c789e6b9ce5cbc4cdcd006fac8f5236cbac8c4896f5575495711c35e25ae40`, verified the exact code/history bindings and found no blocker for the pending freeze. It creates no source-screening qualification. A Gitless export of executable9da6684 plus these public freeze files passed inventory/code verification, historical saved-stage replay and the 24-answer synthetic workflow using installed dependencies, with no ignored work, private ledger, model cache or environment file copied.
