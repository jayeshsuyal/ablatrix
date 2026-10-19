# Reviewed development proposal preparation

This path prepares an **unexecuted** three-context diagnostic for the complete independently designated v5 development gap group. It never reads credentials, loads an environment file or dispatches a request. It does not qualify fresh validation or establish answer quality.

The initial v5 preparation stays `codeReviewPassed:false`. A new code qualification must bind that preparation's exact raw bytes, the complete execution/qualification/evaluation code map, exact source artifacts, pinned official v5 result and mechanical review record, and a separate independent code-review report. The verifier reconstructs all gap cases and current/v5/reference contexts from the pinned producer inputs; an edited output row or self-consistent replacement context still rejects. Review artifacts use one hash/parse snapshot and their original expected hashes are retained through final binding. Changes to bound code, source, review record or package manifests require a new preparation and qualification; old private files are preserved.

The independent report records code review, not human source-checked answer judgments. It must explicitly cover source/question scope, complete gap retention, identical generation contracts, durable reservations/no retries, approval before credential access, receipt/unknown accounting, review anonymity and unchanged activation. A report/certificate checksum is an integrity binding, not cryptographic authentication of the reviewer. The parent must inspect its provenance and obtain separate exact financial approval for the resulting plan.

After review, the repeatable sequence is:

```sh
npm run diagnosis:prepare-v5 -- docs/evidence/retrieval-diagnosis-2026-10-19/semantic-supplement-v5-development-v2.json .data/NEW-unqualified-preparation.json
npm run diagnosis:qualify-v5 -- --qualify --preparation .data/NEW-unqualified-preparation.json --review-record docs/evidence/REVIEW/qualification.json --review-sha256 REVIEW_RAW_SHA256 --out .data/NEW-qualified-preparation.json
npm run diagnosis:live -- --prepare --preparation .data/NEW-qualified-preparation.json --out .data/NEW-plan.json
npm run diagnosis:qualify-v5 -- --proposal --plan .data/NEW-plan.json --out docs/evidence/REVIEW/financial-proposal.json
npm run diagnosis:live -- --verify --plan .data/NEW-plan.json
```

The qualification record is specific to the raw unqualified preparation from the first command. The parent can reuse the completed preparation recorded in the handoff; running the first command again creates different raw bytes if any bindings/ledger changed and requires a new review record. Every output is exclusive; no old plan or journal is overwritten/resumed.

The sanitized public proposal includes the exact request bodies/hashes, code/source/review bindings, aggregate ledger anchor, plan digest, maximum attempts and cumulative local planning allowance. It excludes private arm mappings, credential and ledger row contents. Proposal generation independently revalidates the qualified wrapper and report rather than accepting a bare `codeReviewPassed:true` assertion. Expected scope is three calls only if the canonical ledger and actual packet still qualify; the generated proposal is authoritative for the proposed numbers. No command here authorizes execution.

`npm run diagnosis:rehearse-v5` exercises the actual pinned sources through the real provider's **temporary synthetic 138-row ledger**, mocked transport, private durable journal, receipt recovery and anonymous evaluation. It makes zero real calls. Failure fixtures retain unknown/failed/unattempted arms and partial usage. `transportInvocations` (also historically named `observedDispatches`) counts entry into the local transport wrapper. `networkDispatches` is null when a durable intent or remote outcome remains unresolved; `remoteOutcomeUnknownAttempts` and `unresolvedDispatchIntents` are separate. Bound local receipts do not independently authenticate provider origin. Local allowance is neither a settled charge nor a provider-enforced cap.

After parent-run receipts exist, use [the offline evaluation/import/report workflow](three-context-evaluation.md). Preserve scoped duration reports, unknown population average and manually extinguished versus exhausted fuel. AI review remains provisional, and human judgments remain absent until actual bound records are saved. AGENTS.md governs final quality claims and promotion.
