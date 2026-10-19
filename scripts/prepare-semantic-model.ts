/** Explicit public artifact preparation only. No provider, credentials or .env. */
import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { modelCachePath, EMBEDDING_MODEL, EMBEDDING_REVISION } from '../server/product-retrieval.ts';
import { RERANKER_FILES, SEMANTIC_RERANKER } from '../server/semantic-reranker.ts';
import { textHash } from '../server/product-corpus.ts';
for (const [model, revision] of [[SEMANTIC_RERANKER.model, SEMANTIC_RERANKER.revision], [EMBEDDING_MODEL, EMBEDDING_REVISION]]) {
  const directory = resolve(modelCachePath, model, revision), manifest: Record<string, string> = {};
  for (const file of RERANKER_FILES) {
    const path = resolve(directory, file);
    if (!existsSync(path)) {
      const response = await fetch(`https://huggingface.co/${model}/resolve/${revision}/${file}`, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Preparation failed ${response.status}: ${file}`);
      mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.${randomUUID()}.tmp`;
      writeFileSync(temporary, Buffer.from(await response.arrayBuffer())); renameSync(temporary, path);
    }
    manifest[file] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  writeFileSync(resolve(directory, 'asset-sha256.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log({ model, revision, manifest });
}
