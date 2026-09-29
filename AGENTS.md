# Ablatrix contributor notes

Keep this a standalone project. Do not read credentials from unrelated repositories or commit secrets. Fixture output is synthetic and must be labeled. Production Sapiom research through `agents.run` requires a verified ready deployed agent, a credential, and verified charge and spending-cap contracts; keep the production provider closed while those contracts are missing.

The separate local product-QA prototype includes `/loop` experiments, `/ask` answers, and `/paid-review` revisions. These use the Sapiom Router directly under explicit user approval for live execution, a server-side credential, `ABLATRIX_LOOP_LIVE=1`, and a bounded shared local planning ledger. The optional `/paid-review` investigation also uses Sapiom search/page-read capabilities, requiring its own `ABLATRIX_REVISION_WEB=1` opt-in and exact approved source hosts. It permits at most one search, two reads, and one answer per request, with every operation reserved in the same ledger. Building or reviewing this feature does not itself authorize paid execution. Local allowances are neither settled charges nor a provider-enforced cap, and these workflows must not be presented as a deployed production agent. See `docs/revision-investigation.md` for limits.

Run `npm test` and `npm run build` before each slice. Keep the six-slice ledger in `docs/build-plan.md` current.

## Code Review Rules

- For production research, flag a path that can dispatch before the deployed agent and provider accounting/cap gates are verified. For the separate local prototype paths above, require explicit live authorization and opt-in, private credential handling, durable call reservations, bounded operations, and honest cost labeling. Also check the investigation's source-host restrictions and independent web opt-in. The production `SapiomLiveProvider` remains closed; the local capability adapter does not change those gates.
- For answer-policy promotion or final quality claims, require source-checked human reviews and a gain on fresh, product-disjoint validation cases. Synthetic fixture outcomes and AI-only assessments do not establish answer improvement.
