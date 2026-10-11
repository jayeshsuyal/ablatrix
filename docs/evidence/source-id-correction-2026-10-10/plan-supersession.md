# Prospective execution-plan correction

The [PR #27 bot review](https://github.com/jayeshsuyal/ablatrix/pull/27#discussion_r4240059478) found that the runner accepted only the returned string `gpt-5.6-luna`, although the provider and importer accept both that resolved identity and the requested `gpt-luna` alias. A valid alias response could therefore consume an attempt and stop the round.

Implementation commit `6be3416384059faf8f4efcdf61833287818af8d8` accepts either supported string while retaining the returned value and receipt. It also checks that the two revision arms return the same raw identity before continuing to later products, preserving the existing comparison contract. Different strings are not silently normalized or treated as proof of a pinned backend.

No call used either plan. Version 1 is retained byte for byte; [version 2](execution-plan-v2.json) is the current prospective manifest.

| Record | Plan SHA256 | File SHA256 |
| --- | --- | --- |
| Superseded [version 1](execution-plan.json) | `0d32ec0deba075cb3cf8ffa38fa0e96bc7288d03c834a0cdc8c5f00fcb0e128e` | `aac710eb9df6581fa291e3a645e1f864100240b96ebe9e044222da9032a247f1` |
| Current [version 2](execution-plan-v2.json) | `ce5c3d288781218dcf67e72ac77cbacb8c160e19a40384eaa2bf5d1722e489ee` | `9195102ca9065ed52dfc361608626777682ff590b96da1326cb064ef2872be13` |

The products, full sources, selected passages and order, citation catalogs, critiques, original request hashes, call order and spending limits are identical. Version 2 records the corrected runner fingerprint, implementation commit and fresh preparation timestamps. The qualified provider, prompts, request schema and retriever are unchanged.

Verification after the correction: 258 tests passed, one Linux-only test skipped; production build and strict standalone runner typecheck passed. The shared ledger remains 73 attempts with zero pending reservations. Execution remains unauthorized and would require approval for the current manifest's 24-call / $2.40 planning allowance, with ceiling 97.

Independent synthetic checks accepted both identities for two originals, four revisions and two in-memory packet imports. An unexpected model failed with `model_identity`, and a mixed-identity revision pair was rejected by the importer. Seven injected transports were used, with zero network calls or persistent writes. The runner's early sibling check was also reviewed to ensure it retains the raw result/receipt and stops before later cases.
