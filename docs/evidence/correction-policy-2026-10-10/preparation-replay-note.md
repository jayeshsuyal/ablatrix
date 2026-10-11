# V3 preparation replay check

Replaying the public exposure audit reproduces all **eight selected IDs, products, questions, complete source pools and origins, source hashes, and shared critiques exactly**. The preparation code still matches its recorded hash, and all 174 source identity hashes also match the runtime JavaScript implementation.

The full preparation JSON is not byte-identical: two `closestProtectedTitle` diagnostics have a maximum title similarity of **0.0**, so every tied title is equally unrelated by that metric. The original historical inventory and the replayed sorted audit enumerate those ties differently. Only those two diagnostic strings and the resulting whole-document hash differ. No selection, exclusion verdict, retrieval input, critique, or generation input changes.

The immutable [cohort v3](cohort-v3.json) remains authoritative, with raw file SHA256 `9e930fe9841d4800f0abec10d9c8fcc62b4dead50bc670a77f2e86dbd4b9f1b3`, bound by the [passed source/family audit](manual-family-audit-v3.json). This qualifies the preparation instructions' hash-reproduction statement: model inputs reproduce exactly; the diagnostic-bearing packet hash does not. No frozen file or code was changed after this finding. A future preparation revision should make tie ordering explicit. This has no effect on the frozen live execution inputs.
