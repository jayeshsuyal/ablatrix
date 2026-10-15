# Sealed v3 benchmark — offline preparation

**Unexecuted qualification benchmark. Zero live calls. Qualification is pending.**

The sealed cohort contains **80 unique fictional packets** (60 flawed and 20 acceptable answers), plus **12 fixed repeat checks** with separate denominators. The v3 prompt is unchanged. The source/reference author and independent AI reviewer are separate; neither supplies human gold or externally verified product truth.

## Inspect

- [Plan, schedule, code/configuration hashes, scope and thresholds](seal-v1/plan.json).
- [Exact normalized inputs and grader requests](seal-v1/requests.json), with labels excluded from the payloads.
- [Separate frozen references and provenance](seal-v1/references.json).
- [Pending qualification record](seal-v1/record.json): `qualified=false`, scope `none`, live evidence null.
- [Detached completed AI source review](source-review-v1.json).
- [Full reference-scripted rehearsal](offline-rehearsal-v1.json) and [offline artifact/accounting audit](offline-audit-v1.json).
- [Contract, gates, limitations and reproduction](../../grader-qualification.md).

Plan identity: `bfd2f570499c83abd198b3347acb7b4ea36ea76728db4c5646abb7b67e5e7505`. The recorded implementation is `0f65fc2945e0bb1bcb8da32a780e0f4d17c6aedc`. Current committed code must match its manifest for verification.

The rehearsal generates expected outputs from references. Its passing mechanics do **not** measure model performance; no real grader has answered this cohort. Primary and repeat metrics, invalid/missing outcomes and immutable qualification flags are inspectable in the report. Review assertions and freshness history are provenance statements, not independently authenticated attestations. Construction-time pending review labels remain unchanged; the detached review records completed AI source checking separately.

## Reproduce without paid calls

```sh
npm ci
npm run grader:qualification -- --verify \
  --dir "$PWD/docs/evidence/grader-qualification-2026-10-15/seal-v1"
mkdir -p "$PWD/.data/grader-qualification"
npm run grader:qualification -- --rehearse \
  --dir "$PWD/docs/evidence/grader-qualification-2026-10-15/seal-v1" \
  --out "$PWD/.data/grader-qualification/new-rehearsal.json"
```

Use a new output path; overwriting is rejected. These commands need the recorded implementation bytes and Git object, and no credentials or private ledger. A normal full clone contains the implementation ancestor. For a shallow clone, first run `git fetch --unshallow origin` (substitute your remote name). CI fetches full history and runs both commands, comparing the rehearsal byte for byte. A future code change must retain the originating checkout for historical verification. The [additive review follow-up](review-followup-v1.json) records the shallow-checkout repair without changing the original seal.

Verification: 16 focused checks, 449 server tests passed with one platform skip, production build, CLI typecheck, exact seal verification and independent source/code/artifact reviews pass. All 135 protected historical artifacts remain unchanged, and the shared ledger stays at **102 attempts with zero pending**.

The proposed future benchmark is **92 grading calls / at most $9.20 added local planning allowance**, with no approved financial scope or execution path in this PR. A separately reviewed trusted live execution/verifier adapter is required first. Existing workers retain v1 and live policy activation remains closed.
