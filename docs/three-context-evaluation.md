# Offline three-context answer review

This path consumes an already saved execution. It makes zero provider calls and reads no credential, environment file, canonical ledger or arm mapping. The exposed development diagnostic remains development evidence. The same commands preserve the prospective validation scope if a separately qualified fresh run later exists.

Use the plan and the execution directory returned by the actual live CLI. Keep them private. First verify every journal checkpoint, exact request-bound receipt and saved result, then export a reviewer packet:

```sh
node --import tsx scripts/three-context-evaluation.ts prepare \
  --plan .data/EXACT-PLAN.json \
  --checkpoint .data/EXECUTION/checkpoint.jsonl \
  --result .data/EXECUTION/result.json \
  --review .data/EXECUTION/review.json \
  --out .data/NEW-evaluation-packet.json
```

The packet retains the execution's neutral labels, complete literal source bodies, original customer questions, independently designated fact qualifications and unknowns. It excludes arm names, operation/attempt IDs, model/usage metadata, ranks and the private mapping. The complete planned denominator includes failed and unattempted answers. A completed receipt with unknown usage can still be reviewed; unknown cost never becomes zero. A recovered receipt requires its reconciled checkpoint and recomputed result as a new saved input pair, leaving the old files intact.

A reviewer writes a JSON record with this contract. Replace placeholder hashes, labels, IDs and judgments with the packet's exact values; every designated fact and unknown for each reviewed answer must appear exactly once. Reviewing only a focused subset is allowed. No entry is accepted for a failed or unattempted answer.

```json
{
  "format": "ablatrix-source-checked-review-v1",
  "packetSha256": "PACKET_SHA256",
  "reviewer": "REVIEWER_ID",
  "provenance": "ai_provisional",
  "purpose": "independent_review",
  "recordedAt": "2026-10-19T12:00:00Z",
  "sourceChecked": true,
  "entries": [{
    "label": "Answer 1",
    "sourcePoolSha256": "ANSWER_SOURCE_POOL_SHA256",
    "answerSha256": "ANSWER_SHA256",
    "facts": [{
      "factId": "PACKET_FACT_ID",
      "status": "covered",
      "rationale": "Explain whether the answer preserves this fact's qualification.",
      "evidence": [{"sourceId": "SOURCE_ID", "quote": "LITERAL_SOURCE_EXCERPT", "originalQuestion": null}]
    }],
    "unsupportedClaims": [],
    "exactApplicability": {"judgment": "uncertain", "rationale": "Check exact model, part and workflow; shared identifiers are insufficient.", "evidence": []},
    "appropriateUncertainty": {"judgment": "uncertain", "rationale": "Check conflicts, conditions, manual stopping and unknown average.", "evidence": []},
    "directRelevance": {"judgment": "uncertain", "rationale": "Check the actual customer question.", "evidence": []},
    "unknowns": [{"unknown": "EXACT_PREDECLARED_UNKNOWN", "status": "preserved", "rationale": "Explain how the answer handles this unknown."}]
  }]
}
```

Fact statuses are `covered`, `missing`, `distorted`, `uncertain`. Covered/distorted entries require literal evidence from a designated source. Axis judgments are `pass`, `fail`, `uncertain`. Unknown statuses are `preserved`, `missing`, `contradicted`, `not_relevant`. Evidence excerpts must be literal and bind the exact saved `originalQuestion` (use `null` only when absent). List every substantive unsupported claim with a literal `claim` excerpt from the answer, `severity` (`material`/`minor`) and `rationale`. Empty unsupported-claim lists mean the reviewer found none, not that a script established support.

Import and report without exposing the arm mapping:

```sh
node --import tsx scripts/three-context-evaluation.ts import \
  --packet .data/NEW-evaluation-packet.json --judgments .data/REVIEWER-judgments.json \
  --out .data/NEW-imported-review.json
node --import tsx scripts/three-context-evaluation.ts report \
  --packet .data/NEW-evaluation-packet.json --import .data/NEW-imported-review.json \
  --out .data/NEW-evaluation-report.json
```

Repeat `--import FILE` to compare independent reviewers. Use one consolidated record per reviewer. Outputs are exclusive, mode `0600`; a new filename is required for revisions. All six measures remain separate: useful fact completeness, unsupported claims, exact applicability, appropriate uncertainty, direct relevance and mechanical citation matching. The last measure verifies offered IDs and literal body equality, never semantic support. Reports retain each reviewer's measurements, incomplete review coverage and disagreements, with no composite winner.

A record may additionally include explicit anonymous pairwise `comparisons`. Both distinct labels must be completed answers from `caseId`, with individual source-checked entries in that same record. Supply a substantive source/answer-based rationale (at least 20 characters). Example:

```json
"comparisons": [{
  "caseId": "PACKET_CASE_ID",
  "firstLabel": "Answer 1",
  "secondLabel": "Answer 2",
  "outcome": "tie",
  "rationale": "Both preserve the scoped reports and the unknown population average."
}]
```

Outcomes are `first_preferred`, `second_preferred`, `tie`, `uncertain`; each reviewer may judge an unordered pair only once. Per-case reports retain every reviewer's verdict/rationale and translate that explicit verdict to anonymous win/loss/tie/uncertain outcomes for the pair. Reversed label order is normalized when detecting reviewer disagreement. Missing comparisons remain missing, and failures remain in the denominator without being scored as losses. Comparative disagreements join the focused human-review queue even if all six individual axes agree. No preference is calculated from the axes, no arm mapping is read, and no combined gain or promotion conclusion is produced.

For a small independently source-checked calibration set, save a human record with `provenance: source_checked_human` and `purpose: calibration_reference`; AI records always use `ai_provisional`. Only overlapping, hash-bound answers are compared. Reports label uncalibrated AI judgments and preserve disagreement axes for focused human review. `focused_disagreement` is available as a review purpose. A human provenance value is a saved reviewer attestation, not automatic identity verification. Synthetic fixture attestations never count as human review of actual answers.

AI agreement, receipt validity and scripted tests do not establish ground truth or answer improvement. Both `qualityClaimEligible` and `activationAllowed` remain false. AGENTS.md still requires source-checked human review and gains on fresh product-disjoint validation for final quality claims or promotion.

Verification: `node --import tsx --test server/three-context-evaluation.test.ts` exercises source/answer/journal/accounting tampering, privacy, failed/unattempted arms, six separate measures, source-question scope, calibration/disagreements and the full offline CLI round trip using labeled synthetic receipts.
