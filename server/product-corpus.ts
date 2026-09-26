import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProductCorpus } from './loop-types.ts';

const corpusPath = fileURLToPath(new URL('../data/product-qa/corpus.json', import.meta.url));
const manifestPath = fileURLToPath(new URL('../data/product-qa/manifest.json', import.meta.url));
const finalCorpusPath = fileURLToPath(new URL('../data/product-qa/final-corpus.json', import.meta.url));
const finalManifestPath = fileURLToPath(new URL('../data/product-qa/final-manifest.json', import.meta.url));
export const textHash = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Labels and reference answers remain separate from the retriever's passage projection. */
export function loadProductCorpus(): ProductCorpus {
  const raw = readFileSync(corpusPath, 'utf8');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { corpusSha256: string };
  if (textHash(raw) !== manifest.corpusSha256) throw new Error('Product corpus checksum mismatch; rebuild with scripts/import-epqa.py.');
  const corpus = JSON.parse(raw) as ProductCorpus;
  validateProductCorpus(corpus);
  return corpus;
}

export function loadFinalProductCorpus(): ProductCorpus {
  const raw = readFileSync(finalCorpusPath, 'utf8');
  const manifest = JSON.parse(readFileSync(finalManifestPath, 'utf8')) as { corpusSha256: string };
  if (textHash(raw) !== manifest.corpusSha256) throw new Error('Final corpus checksum mismatch; rebuild with scripts/import-epqa-final.py.');
  const corpus = JSON.parse(raw) as ProductCorpus;
  validateProductCorpus(corpus);
  if (corpus.cases.length !== 20 || corpus.products.length !== 20 || corpus.products.some(item => item.split !== 'holdout') || corpus.cases.some(item => item.split !== 'holdout' || item.referenceAnswer || item.referencePassageIds.length)) throw new Error('Final corpus must contain 20 product-disjoint, unlabeled holdout cases.');
  const development = loadProductCorpus();
  const used = new Set(development.products.map(item => item.id));
  if (corpus.products.some(item => used.has(item.id))) throw new Error('Final product overlaps development or validation.');
  return corpus;
}

export function validateProductCorpus(corpus: ProductCorpus): void {
  if (!corpus.version || !corpus.products.length || !corpus.passages.length) throw new Error('Empty product corpus.');
  const products = new Map(corpus.products.map(product => [product.id, product]));
  const passages = new Map(corpus.passages.map(passage => [passage.id, passage]));
  if (products.size !== corpus.products.length || passages.size !== corpus.passages.length) throw new Error('Duplicate product or passage ID.');
  for (const passage of corpus.passages) {
    if (!products.has(passage.productId)) throw new Error(`Unknown product for passage ${passage.id}.`);
    if (!passage.text.trim() || textHash(passage.text) !== passage.sha256) throw new Error(`Passage checksum mismatch: ${passage.id}.`);
  }
  for (const item of corpus.cases) {
    if (products.get(item.productId)?.split !== item.split) throw new Error(`Product split leakage for ${item.id}.`);
    if (item.referencePassageIds.some(id => passages.get(id)?.productId !== item.productId)) throw new Error(`Reference passage product mismatch: ${item.id}.`);
  }
}
