import { loadFinalProductCorpus, loadProductCorpus } from './product-corpus.ts';
import { ProductRetriever } from './product-retrieval.ts';

const final = process.argv.includes('--final');
const corpus = final ? loadFinalProductCorpus() : loadProductCorpus();
const retriever = new ProductRetriever(corpus, final ? process.env.ABLATRIX_FINAL_RETRIEVAL_DB ?? '.data/product-final-retrieval.sqlite' : process.env.ABLATRIX_RETRIEVAL_DB);
const products = final ? corpus.products : corpus.products.filter(product => product.split !== 'holdout');
try {
  for (const [index, product] of products.entries()) {
    const result = await retriever.retrieve(product.id, 'What features does this product have?');
    console.log(JSON.stringify({ prepared: index + 1, total: products.length, productId: product.id, embeddingModel: result.embeddingModel }));
  }
  console.log(JSON.stringify({ ready: true, corpusVersion: corpus.version, products: products.length, passages: corpus.passages.length, note: 'Index preparation only; no answer generation or quality evaluation.' }));
} finally { retriever.close(); }
