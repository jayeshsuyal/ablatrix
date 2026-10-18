# Architecture and operating boundaries

Ablatrix is one Node process serving a React UI and JSON API, with SQLite persistence and bounded background workers. The primary product is the saved product-QA workflow at `/` and `/ask`. The older generic research path is available at `/research`; its evaluation suite and accounting rules are separate.

## Product request and recovery

A product stores supplied source bodies and optional original customer-question context. These sources never enter the authoritative evaluation corpus. A request captures its exact runtime-policy version and instruction hash **before retrieval can yield**. The request also freezes its generation contract, source selection and request hash before dispatch.

The browser retains a UUID and exact request payload in tab-scoped storage until the response is confirmed. Retrying that payload reuses the UUID. The server binds it to normalized product, question, mode and automatic-check intent; reusing a key for different input fails. Durable intent and receipt replay distinguish a completed original from a failed or unknown provider attempt. A matching completed receipt can restore an answer after a process interruption without another generation. Unknown or mismatched outcomes require reconciliation and cannot trigger hidden redispatch.

The actual workspace generation path uses a separately versioned flat-source-ID contract. Retrieval retains its indexed chunks for inspection; selected parent source bodies remain reconstructable for generation and citation resolution. The server resolves known source IDs to exact saved text, checks bounds and rejects malformed or out-of-scope citation output. Literal membership establishes provenance, not semantic support or truth.

## Checks, one repair and delivery

An automatic-check job freezes the original answer and complete source context, model and grader identities, schema/prompt hashes, and qualification scope. Each leased phase can dispatch once: check original, repair once if permitted, then independently recheck. Persisted phase and terminal-state checks prevent a late overlapping response from reopening a completed job. The original version remains immutable.

The v4 grading contract separates factual consistency, support from the actual cited span, product/variant applicability, question coverage and appropriate uncertainty. Its finite answer/unit/response scope is explicit. Unsupported, malformed, unknown or uncertain results remain visible; only a qualifying delivery is shown as checked. The newly implemented live v4 scope is closed until independently qualified. Synthetic checks are labeled mechanics fixtures and do not require or create live qualification.

`/review` reuses the same saved source snapshots for reviewer feedback and bounded background revision. Optional external investigation is independently gated: one search, at most two approved-host reads and one revised answer, with every operation reserved in the shared planning ledger. Search snippets are leads, not citations. Synthetic mode disables external search and reads.

## Runtime policy release

Runtime answer instructions have their own immutable versions, lineage, hashes and per-mode active pointers. They remain separate from historical human-reviewed feedback-lab promotion records. A captured in-flight request keeps its version when a pointer changes. Later requests must cross the same verified release boundary used by activation and inspection. Operator attribution accompanies authenticated release and rollback actions.

Repeated new, contract-valid failures can form bounded groups. A group may propose one generic instruction addition and run one finite paired evaluation with frozen independent checks and references. A blanket-abstention control must fail. Incomplete, stale, altered, uncertain or incompatible evidence cannot activate a candidate. Qualification of a grader alone never activates an answer policy. Live release remains closed; synthetic release/rollback fixtures prove persistence mechanics only.

## Product proof and accounting

`/api/workspace/proof` and its export retain the original as paired control, repair-triggered and whole-workspace denominators, wins/ties/regressions/unresolved cases, exact source/version identities and recorded receipts. The UI provides a paired outcome view and a separate quality/time/planning-allowance view. Failed, rejected and uncertain operations remain in accounting. Missing time or usage is unknown. Unrelated or incomplete experiments are not plotted as a learning curve.

A local planning allowance is a reservation, not a settled charge or a provider-enforced dollar cap. Synthetic recorded operations produce zero actual provider calls. Read-only proof verification must not reserve capacity, construct a credential-owning provider or dispatch. A locally consistent bundle does not itself attest provider authenticity, external source truth or human-reviewed improvement.

## Isolated local and authenticated hosted modes

`npm run demo` creates a new `work/demo/session-*` directory for each launch and injects `SyntheticAnswerProvider` plus a source selector requiring no embedding download. It preloads a receipt-recovery example, one bounded correction and an uncertain-check stop. Every demo path uses its isolated SQLite files. The launcher does not load `.env`, change live settings or use the existing port 4194. It binds to `127.0.0.1:4184` by default. Legacy experiment endpoints are blocked in this mode.

Normal local mode trusts the local operator and binds to loopback. The separate restricted hosted mode authenticates gateway identity and enforces server-side viewer/reviewer/operator permissions, same-origin mutations and per-resource access. Credentials remain server-side. Hosted mode uses a dedicated persistent data directory, conservative restart recovery and coordinated backup/restore. External hosting and deployment remain separate release actions. See the [hosted operating guide](hosted-demo.md).

## Historical research path

The following statements apply to `/research` and its original six-task research suite, not to the product workspace:

- The suite contains six model-drafted official-source tasks across development, validation and a sealed holdout. Its deterministic rubric checks required terms, approved hosts and citation consistency. It does not semantically verify every claim or constitute independent human labels.
- Its optimizer can propose one allowlisted workflow-setting change and reject regression on baseline-correct tasks. Fixture or unpriced results do not establish improvement.
- Legacy research manifests record source URLs and returned provider metadata. They did not capture complete web-source snapshots, so changing web content prevents exact live reproduction. Product-QA source snapshots added later have a different, stronger local replay boundary.
- `SapiomLiveProvider` remains closed for production `agents.run` until deployed-agent, verified whole-call charge and remote-cap contracts are available. The explicit local Router prototype does not open that production gate.

The historical local research app had no multi-user authorization. That limitation must not be generalized to the later authenticated hosted package. Its experiments, public evidence, private artifacts and human events are retained separately from the isolated product demo.

## Results and next evidence

The latest live v3 qualification failed after 20/92 planned calls; the sanitized [current-results index](current-results.md) retains the complete denominators and disagreements. Natural-product retrieval coverage, whole-workflow correction benefit, critique versus matched rewrite benefit and future-policy benefit need distinct frozen evaluations. AI-only reference agreement stays labeled AI provenance. Final answer-quality claims and policy promotion require source-checked human reviews plus demonstrated gain on fresh, product-disjoint cases; this does not require a person to review every routine answer.

SQLite remains the intended single-process boundary. A database migration, additional orchestration framework, fine-tuning and external hosting are outside this release.
