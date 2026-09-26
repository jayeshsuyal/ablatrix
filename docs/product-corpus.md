# Product corpus and hybrid retrieval

The localhost feedback-loop demo uses a small historical slice of Amazon Science's [ePQA](https://github.com/amazon-science/contextual-product-qa/tree/cec976cc2f2218aa76e562ecc9c7d79f1f3271bc/ePQA). These are real upstream passages and questions, not fabricated Amazon data. They are not current shopping advice.

## Snapshot and license

- Upstream commit: `cec976cc2f2218aa76e562ecc9c7d79f1f3271bc`.
- Upstream `train.csv`: 121,750 rows; SHA256 `b63de9681b770573240367e919f7f04f087f6a4745ab1f79a77e6b800105ea25`.
- Upstream `dev.csv`: 9,770 rows; SHA256 `ec5c486592b59f2efb30abceb57c76fa55c2ff55333720a41d347cec601b024a`.
- The upstream test split is not downloaded or used by this importer.
- Local corpus: 16 distinct ASINs, 304 deduplicated passages, 10 development questions from upstream train, 6 validation questions from upstream dev.
- Separate final corpus: 20 additional ASINs, 498 passages, and 20 unlabeled questions selected from pinned upstream train. It is loaded only for the final comparison and cannot enter proposals. This is an exploratory sample, not a representative benchmark.
- Data remains under CDLA-Sharing-1.0. The complete upstream license is included in `data/product-qa/LICENSE`.

`data/product-qa/manifest.json` records exact raw-file hashes, row numbers, candidate hashes, and text offsets for every passage. `corpus.json` contains the app's products, evidence passages, and separate review cases. `annotations.json` preserves the original labels and answers; the retriever never reads it.

Rebuild deterministically from the pinned upstream CSVs:

```sh
python3 scripts/import-epqa.py
python3 scripts/import-epqa-final.py
```

Raw CSVs are cached in ignored `work/epqa/`. The importer verifies their pinned hashes. The tracked compact corpus can be loaded without downloading these files. `loadProductCorpus()` verifies its manifest checksum, all passage hashes, reference ownership, and product split consistency.

`final-manifest.json` records the fixed seed, source hash, selection rule, selected question IDs, row provenance, and checksum. Its importer selects the first 20 SHA256-ranked eligible train questions with unique ASINs and unique first title tokens, excluding every development/validation ASIN. The first-token family check is only a heuristic; independent family and answer review remains necessary. Final reference answers and relevance labels are absent from `final-corpus.json`.

## Evidence selection and limitations

The selected cases cover low-stakes product attributes, dimensions, counts, compatibility, and conflicting source claims. Selection is purposive and small; it is not a representative benchmark. Development and validation ASINs are disjoint. The LG Defender and iPhone Commuter cases are different product families despite sharing the OtterBox brand. An exhaustive near-duplicate/product-family audit is still needed before a larger final evaluation.

For each selected ASIN, all available candidates in its assigned upstream split enter its searchable pool, including candidates from other questions and label-0 distractors. Selection does not retain only answer-bearing passages. Candidates repeated across questions are deduplicated by product, source type, and exact text hash; all original row references remain in the manifest.

The downloaded train/dev schema has no separate `context` column. Candidate text is preserved, including any embedded community-question context. Reference answers and relevance labels are never appended to passage text or supplied to the embedder. The same passage IDs are used for keyword and semantic ranking and for citations.

Original labels include contradictions and apparent errors. Examples include treating a package's weight as thread weight, or treating absence from a compatibility list as definite physical incompatibility. `referenceAnswer` therefore contains explicitly labeled AI-assisted guidance, not a claim of independently audited truth. Humans must verify guidance and cited evidence before recording live validation judgments. `referencePassageIds` preserve upstream label-2 membership; that is a retrieval annotation, not an endorsement of every claim in those passages.

## Chunking

Short native candidates remain intact. The current longest passage is 726 characters, so none needed splitting. The importer supports splitting longer candidates at whitespace with at most 850 characters per chunk and approximately 80 characters of overlap, recording offsets rather than dropping text.

Before embedding, the actual BGE tokenizer checks every passage against a 350-token limit and every prefixed question against its 512-token limit. Overlong input produces an explicit rechunk/shorten error. There is no blind truncation. Changing chunking requires regenerating the corpus and recording its new checksum/version.

## Local retrieval

`ProductRetriever(corpus, dbPath?, options?)` implements `LoopRetriever`.

1. Exact ASIN filtering restricts both methods' candidate sets before top-k selection.
2. SQLite FTS5 ranks keyword matches with BM25; up to 20 candidates.
3. Local BGE embeddings rank the same product's passages using cosine similarity; up to 20 candidates.
4. Reciprocal rank fusion uses `1 / (60 + rank)` per method, deduplicates IDs and then identical text, and selects up to 5 passages within a 6,000-character context budget.

Dense model: `Xenova/bge-small-en-v1.5` at revision `ea104dacec62c0de699686887e3f920caeb4f3e3`, q8 ONNX, CPU, CLS pooling, normalized 384-dimensional vectors. Queries use the prefix `Represent this sentence for searching relevant passages: `; passages do not. Local model files live in ignored `.data/models`. Missing assets are downloaded from exact revision URLs. Tokenizer and model are loaded explicitly from that absolute local directory with `local_files_only`; this avoids Transformers.js 4.3's pipeline metadata discovery, which otherwise consults unpinned `main` despite the revision setting. A fresh clone needs a one-time public model download. Cached retrieval has been smoke-tested with every network fetch forced to throw.

Vectors persist in SQLite under `(corpus version, model ID, model revision, passage SHA256)`. Query embeddings are computed at request time. A failed embedding operation remains a visible error; it never silently reports lexical-only retrieval as hybrid. Injection of a deterministic `EmbeddingFunction` is restricted to test configuration and is labeled as such in returned model metadata.

This is a product-filtered local scan over a small corpus. It does not demonstrate production-scale ANN performance. Retrieval quality is supporting infrastructure for the feedback-loop experiment, not the project's primary benchmark.
