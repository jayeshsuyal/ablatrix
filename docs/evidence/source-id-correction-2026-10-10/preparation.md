# Source-ID comparison: source preparation

**Frozen offline; paid execution is not authorized.** Eight products, 175 full-pool source chunks and 190 upstream rows are preserved in [cohort.json](cohort.json). No originals or revision arms have been generated for this cohort. There are zero human judgments and no answer-quality result.

## Selection and exposure

The seed is `ablatrix-source-id-correction-2026-10-10-v1`. Selection uses the pinned ePQA **train** file and SHA256 ranking within fixed strata: two capacity/dimension questions, two appearance/material questions, two explicit model-scope questions, one missing-information question and one preservation control. Relevance labels, answer columns, generated outputs and the upstream test split do not enter selection or retrieval.

[exposure-audit.json](exposure-audit.json) records 67 protected products: the historical/reserved 56, all eight products in the stopped comparison plan, and three additional products inspected during its preparation. All eight old planned products are excluded even if no call reached them. Read-only inventories cover three existing workspaces and the comparison store; their public metadata allow replay without those databases. One protected product is absent from pinned train, so the inventory records 66 exact ASIN exclusions within that file.

The rules compare full source/question/title model identifiers, near model families, source-provided manufacturer/brand and title families. They also exclude overlapping selected families. All source bodies, distractors, conflicting reports and original CQA questions are retained. The [AI source/family audit](manual-family-audit.json) checks coverage and provenance; it is not a human answer review or proof of complete commercial-family independence.

| Case | Intended probe | Sources |
| --- | --- | ---: |
| Q8297 | Beach cart chair/accessory capacity | 20 |
| Q12820 | Gift-box dimensions and differently scoped CQA | 10 |
| Q10021 | Play-mat material and conflicting texture reports | 29 |
| Q12547 | Glass-board color descriptions | 17 |
| Q14506 | Nintendo DS game and named DS Lite model | 27 |
| Q11847 | Brita filter versus named Great Value replacement | 29 |
| Q8746 | Drive compatibility with a named ThinkPad | 26 |
| Q12894 | Lash subscription glue inclusion | 17 |

Missing or conflicting support remains eligible within the intended topic. Products were not chosen because a model failed or because improvement looked easy.

## Recorded preparation repairs

The immutable [legacy preparation script](../../../scripts/prepare-correction-cohort.py) is reused by a [new wrapper](../../../scripts/prepare-source-id-cohort.py). Both source hashes are bound in the cohort. The wrapper changes eligibility and prospective source-ID instructions; it does not change the previous experiment.

Two source-only drafts were rejected before generation:

- [Draft 1](cohort-preparation-v1.json) / [audit](failed-coverage-audit-v1.json): availability and dye-performance questions entered the appearance stratum; a gallon measurement entered model scope. The first amendment tightened question intent and filtered measurement tokens.
- [Draft 2](cohort-preparation-v2.json) / [audit](failed-coverage-audit-v2.json): a rust-resistance predicate still passed, and a `GENUINE` title prefix hid a protected Frigidaire family. A separately recorded amendment tightened performance exclusions and added manufacturer/brand plus prefix-normalized family checks.

A [source-only domain decision](manual-eligibility-decisions.json) also rejected a firearm-mounted accessory question. The same consumer-demo domain rule applies before ranking. The seed, counts and budget stayed fixed. Sources inspected within this preparation remained eligible under the repaired rules; no model outcome existed or drove replacement. Rejected drafts and their hashes remain available.

## Reproduce without model calls

Use the existing pinned train CSV, whose URL, upstream commit and checksum are stored in the cohort:

```sh
python3 scripts/prepare-source-id-cohort.py \
  --train /path/to/pinned/train.csv \
  --exposure-audit docs/evidence/source-id-correction-2026-10-10/exposure-audit.json \
  --prepare-dir /tmp/ablatrix-source-id-replay
```

The output directory must be new. This command opens no provider, credential file or real database. Replay of the public exposure metadata produced byte-identical cohort and exposure files. All 175 source hashes also matched the TypeScript `workspaceReviewSourceHash` implementation, and every source body, original question, row reference and character range matched the pinned input.

Raw cohort SHA256: `9cc29d9987f8e76245d7ac89d32db13fa998d0e6ff9357eab88bda8889785fba`.

Canonical cohort SHA256: `6b336ab83740b17cc7b949f6ae719f5001a2399f984dd803f14540a53ce39d77`.

Publication required the passed [offline citation qualification](offline-qualification.json), unchanged qualified implementation hashes and the exact cohort-bound family audit. The separate [execution manifest](execution-plan.json) now freezes five retrieved sources per case and request identities at implementation commit `6ce8e28278a91020acd72fa645078c025c1de0c7`. Its plan SHA256 is `0d32ec0deba075cb3cf8ffa38fa0e96bc7288d03c834a0cdc8c5f00fcb0e128e`. Neither packet permits dispatch without separate approval.

## Future execution and interpretation

A separately approved round would use eight shared fresh originals and two sibling revisions per original: **24 attempts maximum**, with the same selected sources and frozen AI-authored critique for both revision arms. The critique requests supporting supplied source IDs; the server resolves their literal source bodies. That ensures accepted citation membership, not factual correctness or claim support.

The proposed allowance is **$2.40 in local planning reservations**. Starting from 73 shared attempts, the proposed ceiling would be 97, beyond the stopped round's authorized ceiling of 93. With the recorded prior-spend adjustment, the proposed planning total is $9.900281 within the $10 planning cap. These are not settled charges or a provider-enforced cap. Unused prior allowance is not permission for a new round: `paidExecutionAuthorized` remains `false`.

No automatic retry, case replacement or web call is planned. A dispatch/validation failure stops the round. Future source-checked human judgments must distinguish citation matching, factual correctness, support and adequacy; this small cohort can provide an initial descriptive comparison, not a broad generalization claim.

The final retrieval snapshot selects five sources per case. It omits Q12820's item-dimensions attribute and Q11847's customer-answer mismatch reports, although those sources remain in the full review pool. Interpretation is conditional on the frozen retrieval: the comparison does not measure retrieval completeness or guarantee that all intended source conflicts reach generation. These observations did not trigger replacement or retrieval changes.
