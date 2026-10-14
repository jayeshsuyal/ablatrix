# Runtime answer-policy trials

The runtime policy worker carries **answer instructions** into future `/ask` requests. It does not train model weights, change retrieval, add generated answers to sources, or modify the historical human-reviewed `/loop` experiment. The existing workspace baseline starts active in a separate live pointer and synthetic pointer.

Every newly generated workspace run captures a policy version, instruction hash, mode and exact instruction bytes **before retrieval**. Its review snapshot carries the binding. Activation or rollback changes a pointer for later requests; an in-flight request and its original answer/receipt retain their captured policy. Historical workspace runs and legacy provider wire bodies keep their existing provenance and behavior.

## Bounded flow and evidence

The background worker discovers only new completed automatic source-check jobs with a full original-snapshot hash and runtime policy binding. It replays their exact grade receipts and validates terminal phase topology, source/answer hashes, repair provenance and independent rechecks. Unknown transports, malformed grades, uncertain assessments, unbound historical records and duplicate run/job/receipt identities are excluded. Structured assessment fields select the recurring failure category; free-text critiques are not parsed into training labels.

Three independently bound failures under one parent policy/category freeze an eligible group. The group consumes those inputs once, permits one generic instruction addition, and has an explicit **13-operation ceiling** before any dispatch:

| Operation | Maximum |
| --- | ---: |
| Generic instruction addition proposal | 1 |
| Baseline answer and frozen source check, three cases | 6 |
| Candidate answer and frozen source check, same cases | 6 |
| Total | **13** |

Groups hold at most five failures; the current three-failure threshold freezes a group immediately. A database permits at most 32 groups over its lifetime. Repeated ticks and restarts cannot propose again for consumed inputs. The shared Router ledger reserves each live operation before transport, checks the complete remaining allowance, and retains unknown attempts without retries. The allowance is a local planning allowance, not a settled charge or provider-enforced cap. A worker performs one phase per durable lease, participates in the existing shared-provider exclusion, and pauses/drains before shutdown.

The validation packet, ordered cases, reference facts, expected answerability and grader identity freeze before the proposal. The proposer receives the category and opaque originating bindings; it cannot edit or inspect the validation labels. The three pairs include a targeted case, a known-correct answerable control and an unanswerable control. Literal frozen reference facts and the independent frozen source checker are used together. Decisions separately record useful supported answers, unsupported claim units, unnecessary abstentions, complete answers, regressions, uncertainty, elapsed phase time, token usage and labeled planning allowances. Aggregate checker pass rate alone cannot win: an always-abstaining candidate loses useful answers and fails the correct control.

## Activation boundary

Packet preflight requires exactly the three mandatory case roles and nonblank literal reference quotes; malformed configured packets are rejected before opening the worker database.

Evaluation writes an immutable, explicitly labeled automated **trial** decision. It does not activate itself. Activation replays all 13 distinct bound receipts and checks the exact policy lineage, packet, grader, references, saved outputs, metrics and current parent. Incomplete, invalid, uncertain, regressing or stale-parent trials cannot activate.

**Live activation is closed.** The current grader records `calibration=not_measured`; this build provides no separately qualified calibration/fresh-evaluation gate. An eligible live shadow is only an uncalibrated AI estimate, never a verified quality gain or a human promotion. A synthetic scripted decision may be released only into the synthetic pointer, with a distinct fixture-only gate and event label. Synthetic policies/decisions cannot enter the live pointer. Rollback requires the expected current active version and restores its parent for future requests.

Live shadow dispatch also defaults closed. Its future execution needs independent `ABLATRIX_ANSWER_POLICY_SHADOW_LIVE=1`, an explicitly approved 13-operation shared-ledger allowance, and a separately supplied frozen live packet with matching mode and fresh product-disjoint provenance. The application supplies no live packet by default and exposes no HTTP endpoint for clients to install packets, graders or labels. A later approved integration must qualify that packet and execution boundary; setting an environment flag alone cannot run a trial. This build changes no live environment settings.

## Inspection and offline reproduction

`/ask` has a collapsed **Answer policy** panel showing the active version/hash/instructions, candidate, latest trial decision and rollback. Unavailable or malformed inspection responses show a panel error while the question form remains usable. Hosted policy mutations remain operator-only. These endpoints provide inspection and exact evidence:

```text
GET  /api/workspace/answer-policy
GET  /api/workspace/answer-policy/export
POST /api/workspace/answer-policy/trials/<decision-id>/activate  {}
POST /api/workspace/answer-policy/rollback  {"expectedActiveId":"<active-id>"}
```

GET requests never aggregate failures, propose candidates or dispatch evaluation. Only worker ticks discover new bound automatic checks. The runtime SQLite path is `ABLATRIX_RUNTIME_POLICY_DB`, or a companion to the configured review database, or `.data/runtime-answer-policy.sqlite`. Hosted mode derives the path from its dedicated review directory and ignores inherited local policy paths. The runtime policy, group, decision and event tables are separate from human review, lab promotion and final benchmark tables.

Status and export check every saved policy version, trial decision and failure-group document against their stored identities before returning evidence. Each group write stores its document hash; aggregation, dispatch, recovery and decision synchronization check it too. A corrupted record produces an inspection error rather than presenting changed instructions or metrics as exact results. Upgrading an earlier group schema leaves existing unhashed rows unverified; explicit reconciliation or restoring a verified backup is required before those rows can be used.

Exports also revalidate originating automatic checks against their consumed bindings and replay completed phase receipts against the saved proposal, answers and assessments. Changed supporting records block the bundle. Receipts for invalid, interrupted or missing outcomes remain explicitly labeled `unaccepted_diagnostic`; they cannot establish an accepted phase or trial.

The checked group loader also matches indexed ID, status, mode, parent and category to the verified document. A changed index cannot route failures into another group or make a completed group dispatch again.

Policy hashes cover the complete document, including immutable rollback lineage. Event hashes and indexed identity/mode checks protect the pointer history. Active pointers have binding hashes and must match verified transition history; live capture additionally requires the fixed baseline while activation remains closed. Schema upgrades can independently verify only the exact code-defined baseline and its pointer; old unhashed candidates, events and candidate pointers remain untrusted until explicit reconciliation or restore.

Verified transition history must form a continuous chain from the baseline, with sequence numbers and previous-event links. The pointer checksum binds the current event ID and sequence even after rollback to baseline, so deleting a complete cycle cannot hide missing history. Every source and target policy must exist in the same mode; activation references must retain the eligible trial decision, and rollback must follow the immutable parent. Missing references or transitions block capture and inspection.

Run the fictional rehearsal without credentials, existing application databases, saved answers, fresh evaluation contexts or holdouts:

```sh
npm run answer-policy:rehearse -- --output /tmp/my-new-policy-rehearsal.json
node --import tsx --test server/answer-policy-worker.test.ts server/answer-policy-provider.test.ts
npm test
npm run build
npx playwright test
```

The CLI uses newly constructed fictional sources, isolated temporary SQLite databases, scripted transports and a global network prohibition. It asserts three completed bound failures → one candidate → all 13 paired phases → synthetic release during an in-flight ask → a later ask actually receiving candidate instructions → rollback restoring baseline. It preserves original snapshot/receipt bytes and repeats ingestion/ticks to check that no second proposal appears. Output creation is exclusive: use a new filename each time.

The saved [version 2 offline rehearsal](evidence/runtime-answer-policy-2026-10-13/offline-rehearsal-v2.json) includes exact fictional inputs, full decision/group evidence, receipt documents, policy lineage, sequenced pointer events and captured later/in-flight requests. The [initial rehearsal](evidence/runtime-answer-policy-2026-10-13/offline-rehearsal.json) remains unchanged as the earlier implementation checkpoint. Both record zero paid calls, network attempts, human judgments or human promotions. They demonstrate the workflow, **not** model correctness, calibrated grading or answer-quality improvement. The production Sapiom agent gate, model, source authority rules, citation validation and operator access remain in force.
