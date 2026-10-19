# Retrieval coverage v2: fresh validation failed the paid-test gate

October 18, 2026. **The known development gaps are fixed, but fresh validation did not recover a useful missing fact. No fresh answer-quality gain is established.**

| Check | Result | Meaning |
| --- | ---: | --- |
| Exposed development regression | 4/4 designated fact units delivered across 3 products | Nested watch specs, conditional microphone load limit and scoped scan timing now reach context. These examples informed the implementation. |
| Fixed fresh validation | 12 products, 217 source bodies | Separate products; every case retained. |
| Independent source review | 1 specification-gap case, 6 complete controls, 5 uncertain cases | AI source assessments; no generated answers or candidate contexts were shown to reviewers. |
| Fresh candidate context changes | 3/12 | More context does not establish useful coverage. |
| Fresh designated missing-fact delivery | 0/3 units across 0/1 gap cases | The remaining runtime gap was not recovered. |
| Baseline source preservation | All 12 cases | Existing parent text, order and original question scope retained. |
| New paid calls / generated answers | 0 / 0 | Paid preparation rejected the packet before a live plan or provider was created. |

## What changed

The separate `workspace-source-coverage-v2` candidate handles nested specification paths, conditional numeric load limits in prose, scoped operation-duration reports, and exact model identifiers in original customer questions. It preserves literal source bodies and CQA question scope, adds at most three parents, and keeps the eight-parent / 1,500-character-per-parent / 12,000-body-character bounds. Matching identifiers selects context; it does not establish compatibility.

The actual workspace supports this through the internal constructor option `sourceCoverage: 'v2'`. Request identities distinguish default, v1 and v2 through receipt recovery and retries. The product default remains baseline retrieval.

## What the fresh result says

The [25-file candidate freeze](candidate-freeze-v1.json), [selection protocol](selection-protocol-v1.json) and [analysis protocol](analysis-protocol-v1.json) were committed and published before fresh source selection. The fixed recipe selected eight capacity/dimensions questions and four preservation questions from pinned ePQA train data. It protected all prior cohort products and all 44 newly exposed development products, along with model, family, source-packet and saved metadata exclusions. No reseeding, case replacement, candidate-success selection or official test split was used.

The only independently supported gap is `source-coverage-v2-train-12870`: runtime per fuel fill for a torch. The full packet contains a listing claim of more than six hours, a scoped customer report of five to six hours, and another report of nearly eight hours before manual extinguishing. Its candidate context equals baseline context and supplies none of those durations. A post-result source check confirmed that generic fuel-capacity and remaining-lit statements are not equivalent facts. These reports retain their conditions; they do not establish one universal runtime.

The fixed operation vocabulary did not recognize this duration request. The three changed contexts were outside the gap case and do not establish useful missing-fact delivery. In one fit control, added overall dimensions fail to answer hook clearance or attachment spacing and leave conflicting measurements unresolved. This is a limitation of intent matching and source relevance, not evidence that generated answers improved.

No fresh exact-model compatibility gain was demonstrated. Source relationships absent from the corpus remain unknown.

## Stop and accounting

The [paid-gate stop record](paid-gate-stop-v1.json) verifies that actual preparation rejects zero designated missing-fact delivery. No live plan, provider construction, credential access, retries, web calls or activation occurred. The shared ledger remains **138 attempts and $14.000281 combined local planning usage**, with no pending calls or owners. This amount is a planning allowance, not settled provider charges.

A separately reviewed bounded execution adapter has synthetic mechanics coverage. That does not qualify this retrieval candidate or authorize a paid run. Any future revised candidate needs a new freeze and separate fresh questions; these twelve products are now exposed development data.

## Engineering verification

The complete server suite passes **620 tests with one platform skip**. All **63 Python selector/verifier tests**, the six offline source-comparison checks, production build and standalone script types pass. Ten live-adapter tests use synthetic receipts and mocked transport only. The README replay below reproduces the saved comparison exactly. These gates establish mechanics, not answer quality.

## Reproduce the saved source comparison

From a checkout containing these artifacts, after `npm ci`, run this replay. It uses the supplied sources and saved baseline index selection, verifies the candidate's frozen implementation bytes, and requires no key, embedding download or paid call. This replays the result; original selection provenance additionally uses the local raw producer audits named in the deck.

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textHash } from './server/product-corpus.ts';
import { compareV2, verifyV2Implementation } from './scripts/source-coverage-v2-retrieval.ts';
const dir = 'docs/evidence/retrieval-source-coverage-v2-2026-10-18';
const artifact = name => {
  const path = `${dir}/${name}`, raw = readFileSync(path, 'utf8');
  return { path, fileSha256: textHash(raw), document: JSON.parse(raw) };
};
verifyV2Implementation(artifact('candidate-freeze-v1.json').document.implementationSha256);
const result = compareV2(artifact('deck-v1.json'), artifact('baseline-v1.json'), artifact('source-review-v1.json'));
assert.deepEqual(result, artifact('comparison-v1.json').document);
console.log(result.summary);
JS
```

[Full comparison](comparison-v1.json) · [Complete sources](deck-v1.json) · [Saved baseline](baseline-v1.json) · [Independent source review](source-review-v1.json) · [Review provenance](source-review-provenance-v1.json) · [Development regression](development-regression-v1.json)

Literal source delivery, citation matching, semantic support, answer correctness, wording preference and human-reviewed quality remain separate. No answers were generated in this phase; saved human quality judgments are zero. The earlier [16-call answer experiment](../answer-quality-source-calibration-2026-10-18/RESULTS.md) and [failed v1 retrieval study](../retrieval-source-gap-exploratory-2026-10-18/RESULTS.md) remain unchanged.
