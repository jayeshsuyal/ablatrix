# Ablatrix contributor notes

Keep this a standalone project. Do not read credentials from unrelated repositories or commit secrets. Fixture output is synthetic and must be labeled. Production Sapiom research through `agents.run` requires a verified ready deployed agent, a credential, and verified charge and spending-cap contracts; keep the production provider closed while those contracts are missing. The separate local `/loop` product-QA experiment uses the Sapiom Router directly under explicit user approval, a server-side credential, `ABLATRIX_LOOP_LIVE=1`, and a bounded local planning ledger. Its allowances are neither settled charges nor a provider-enforced cap, and it must not be presented as a deployed production agent. Run `npm test` and `npm run build` before each slice. Keep the six-slice ledger in `docs/build-plan.md` current.

## Code Review Rules

- For production research, flag a path that can dispatch before the deployed agent and provider accounting/cap gates are verified. The exploratory `/loop` Router path is a separately approved local experiment; review it for explicit opt-in, credential handling, durable call reservations, call limits, and honest cost labeling instead of requiring an agent deployment.
- For answer-policy promotion or final quality claims, require source-checked human reviews and a gain on fresh, product-disjoint validation cases. Synthetic fixture outcomes and AI-only assessments do not establish answer improvement.
