# From a product answer to a reviewed revision

Completed answers from `/ask` enter `/review` automatically. The queue shows 20 answers per page, with previous/next controls and direct links to older answers. Pending, ready, accepted, and usage counts in a workspace review response describe its current page. Retrieval previews and failed generations have no completed answer to review. The historical 20-case packet at `/paid-review` retains its separate queue, source protocol, and result counts.

## One workflow

1. In `/ask`, save a product with its source excerpts. Include the original customer question for a Q&A excerpt. Preview the retrieved passages.
2. With explicitly approved local live access configured, generate an answer. Open **Review this answer** from its saved result.
3. Read its sources. Either accept the original after selecting a cited source, mark missing information, or explain a flaw and select **Investigate and revise**. Optional clarification and source excerpts are attached to that request.
4. Move to another answer. The shared worker investigates the saved context and either asks for missing information or requests one revised answer. A ready notice links back to the case.
5. Compare the previous and revised text, inspect the selected sources, and record a decision on the current version. Acceptance applies to that answer only; it neither changes the original nor promotes an answer policy.

The existing [live configuration](feedback-loop-local.md) and [investigation bounds](revision-investigation.md) apply. This implementation does not grant paid-call approval. Revisions share the local planning ledger with `/ask` and `/loop`, allow at most two generation attempts per answer, and retain uncertain provider outcomes for reconciliation. The allowance is not a settled charge or provider-enforced spending cap.

## Reproduce without paid calls

Requires Node.js 24.10+ and `npm ci`:

```sh
node --import tsx --test server/workspace-review-api.test.ts server/workspace-review.test.ts
npm run build
npx playwright test e2e/workspace-review.spec.ts
```

The HTTP tests create isolated SQLite files and inject synthetic provider responses. They create a product and answer, queue a rejection, wait for the real worker, accept the revised version after a source check, and restart the app. They also check that duplicate requests produce one job, stale decisions fail, previews stay out of the queue, a saved answer missed by the initial handoff is recovered at startup, and the pinned batch's counts remain unchanged. A forced review-database write failure verifies that the completed answer still returns successfully and later registers without another provider call. The browser tests use synthetic API fixtures to verify navigation, background ready notices, source controls, mobile layout, and that a saved answer stays visible when the review handoff and history refresh fail. These checks demonstrate mechanics, not model quality.

## Persistence and identity

- A review identity is `workspace-<run UUID>`. Registration atomically saves a frozen original answer and its snapshot; replaying an identical handoff is safe, while changing an existing snapshot is rejected.
- New live runs freeze the product title, question, and complete chunked source set before generation. `generationSourceIds` records the subset actually supplied to the model. Available source candidates are distinct from retrieved and cited passages.
- Older completed runs have only their saved retrieval imported. They are labeled `saved_retrieval_only`; an unavailable original product title or full source set is not reconstructed from current product data. The page reads this warning from the original version, so it remains visible after revisions, including previously saved children without their own provenance label.
- Startup and review reads reconcile completed runs into the review ledger. An interrupted handoff does not require another model call. Completed provider receipts replay into one child version; uncertain outcomes cannot be blindly redispatched.
- If review registration fails after generation succeeds, the question API still returns `201` with the saved answer and `reviewHandoff: "pending"`. `/ask` keeps that answer selected and explains that review is temporarily unavailable. Reopen its review after storage recovers; generating another answer is unnecessary.
- Interactive history reads only the newest 100 runs, with the limit applied before parsing stored snapshots. Recovery and review import still read the full history, including older completed and interrupted runs.
- Review polling loads at most 20 cases before reading their source snapshots, versions, jobs, and events. Full recovery runs on startup and after workspace database changes; unchanged polling reuses the completed import. Failed registration remains retryable, and changes from another SQLite connection invalidate the import cache.
- Review decisions name an exact answer version and checked source hashes. Workspace review hashes bind each excerpt to its source identity and original question, so identical answer text in different Q&A contexts remains distinguishable. Retrieval retains its original content hashes. Newer requests block acceptance of older answers. Source text, original questions, added information, events, and earlier versions remain available for inspection.

`ABLATRIX_WORKSPACE_DB` stores products and generated runs. `ABLATRIX_PAID_REVIEW_DB` holds the shared revision tables plus the separate historical review records. Back up both and the provider ledger together. This is still a local, single-worker prototype; the reviewer name is a local attribution field, not authenticated identity.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/workspace/reviews?page=1` | At most 20 workspace cases, page-scoped counts/usage, and pagination metadata |
| GET | `/api/workspace/reviews?answer=workspace-<run UUID>` | Locate the page containing a linked older answer |
| POST | `/api/workspace/reviews/:answerId/revisions` | Persist rejection and job; return `202` with job ID |
| POST | `/api/workspace/reviews/:answerId/decisions` | Save source-checked acceptance or missing-information decision |

Revision requests include `versionId`, `idempotencyKey`, `reviewer`, and `feedback`; optional investigation issue, clarification, and sources use the existing bounded schema. Decisions include `versionId`, `reviewer`, `decision`, `note`, and `checkedSourceShas`. Poll the overview to follow a queued job.

Exact quote membership, source applicability, answer correctness, and human preference remain separate claims. No new model-quality result is established by connecting these workflows.
