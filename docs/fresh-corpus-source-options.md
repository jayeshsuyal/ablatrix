# Next fresh-product source candidate

The previous fixed ePQA train attempt remains a failed experiment: its 256-question prefix supplied zero eligible packets, and every distinct product in that prefix had a direct historical metadata origin. Changing the seed or replacing its rejected products would not complete that frozen attempt.

This page records the metadata-only investigation before the [separate Amazon-PQA implementation](amazon-pqa-validation.md). The later pipeline uses a fixed versioned byte prefix and an honestly unpartitioned release; its current execution status is in that guide. No new paid comparison is authorized.

## Preferred candidate: Amazon-PQA

The [publisher's AWS open-data registry](https://registry.opendata.aws/amazon-pqa/) lists product questions, answers and public product information under **CDLA-Permissive-1.0**, with an anonymously accessible S3 bucket. The [publisher paper](https://www.amazon.science/publications/answering-product-questions-by-utilizing-questions-from-other-contextually-similar-products) documents the release's data construction and product-disjoint splits. A separate release or a larger published dataset does not demonstrate disjointness from Ablatrix's historical exposure.

A separate prospective protocol must bind a training-only source object, its exact version/checksum, fixed source-only scan order and finite inspection limit before new bodies are inspected. Existing sealed test splits remain untouched. The source custodian must exclude target answers from retrieval, keep customer statements attributed, preserve complete parent sources and their original question scope, and protect every inspected rejection.

Before any candidate scores or answers are read, the guard must compare product IDs, model/family aliases, scoped sources and true body-only fingerprints with the complete historical inventory. It must also incorporate private source-free projections from the failed fresh attempt and incidental documentation examples recorded during metadata research. Unresolved family separation cannot qualify a fresh case.

After source eligibility and a fixed selection receive two independent automated source reviews and third adjudication, v5 control and v6 candidate contexts can be compared under the same uncertainty instructions. The selected denominator retains candidate misses and uncertain outcomes. A positive source-only gate would permit preparation of an exact bounded financial proposal, rather than authorize dispatch.

## Backup candidate: AmazonQA

The [publisher repository](https://github.com/amazonqa/amazonqa) describes answer and review-snippet fields with product identifiers. These support an explicit target-answer exclusion boundary, but preselected snippets and classifier-produced answerability labels are not independent correctness references. Dataset reuse and redistribution terms still need an explicit review; public download availability alone does not settle those permissions.

## Current status

Amazon-PQA now has a separately versioned offline custody/import/review/preparation/report workflow; see its [protocol and current status](amazon-pqa-validation.md). Source-option metadata alone remains insufficient to qualify a fresh pool or establish answer quality. AmazonQA remains the unintegrated backup option. Preserve the original investigation and failed ePQA attempt as historical evidence.
