# Preserving source context and filling evidence gaps

Q19's original paid answer cited a customer answer about a different refrigerator. The customer question had been stripped before import. Restoring that question removes an unsupported model match, but the pinned packet still does not establish that drawer 240337103 replaces part 241543917.

## Product sources

In `/ask`, a source can carry an optional original customer question. Keep the customer answer in the evidence-text field and its question in the contextual field. The question remains attached to each chunk through retrieval and saved runs. Ranking still indexes the answer text; identical answers with different parent questions are retained separately.

The provider receives that context and instructions to check the exact model/part relationship. Question text is excluded from snippet choices and exact-quote validation. Older frozen corpora with an inline `Question:` suffix are separated at the provider boundary; the files themselves remain unchanged. This preserves citation integrity; it does not mechanically prove that a model interpreted a compatibility claim correctly.

## Revisions with additional information

Open **Add missing information or a source** on `/paid-review`. Add a model clarification, a source label and excerpt, and optionally a document/page/URL reference or the source's original customer question. A reference URL is saved as provenance and is not fetched. The UI accepts one new excerpt per request; the API accepts up to three, each up to 2,000 characters, with a bounded combined prompt.

A clarification supplies customer context, not proof that a part fits. Source excerpts are labeled as reviewer supplied. Reviewers must assess their authority and applicability before accepting the answer.

Each job saves a complete context snapshot before dispatch. A resulting answer version retains the same snapshot and a digest. A later attempt inherits sources and clarifications, including additions from a failed output. Pending or failed requests expose their saved additions separately from the current answer. Checked-source identifiers and quote validation resolve against the version's own snapshot. Existing per-case attempt limits and shared planning allowances still apply.

Historical jobs and receipts remain readable under their recorded provenance. New revisions record `answer-revision-v2-context`; the structured response tool remains `answer_revision_v1` because its response shape has not changed. New answer calls record `product-answer-v2-context` in receipts, and live workspace records carry that generation protocol. New generation behavior should be evaluated with fresh runs; old and new answers are not interchangeable measurements under one frozen generation protocol.

## What this establishes

Synthetic tests cover metadata preservation, source-specific quote checks, idempotency, restart/replay, inherited context, size bounds, and source display. They establish implementation behavior. No live call was made for this change, and it does not establish a measured quality gain or the correct replacement part for Q19. That case needs model-specific compatibility information before a definite recommendation can be supported.
