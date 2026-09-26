import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { LoopValidation, ProductCase, ProductCorpus } from './loop-types.ts';

export type ExternalValidationCase = Pick<ProductCase, 'id' | 'productId' | 'question'>;
export type ExternalValidationReservation = { caseId: string; productId: string; sourceId: string; sourceSha256: string; reservedAt: string };

export function ensureValidationLedger(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS loop_external_validation_cases (
    corpus_version TEXT NOT NULL,
    product_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    reserved_at TEXT NOT NULL,
    PRIMARY KEY (corpus_version, product_id),
    UNIQUE (corpus_version, case_id)
  )`);
}

function officialValidations(db: DatabaseSync): LoopValidation[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='loop_documents'").get()) return [];
  return (db.prepare("SELECT document FROM loop_documents WHERE kind='validation'").all() as { document: string }[])
    .map(row => JSON.parse(row.document) as LoopValidation);
}

export function externalValidationProducts(db: DatabaseSync, corpusVersion: string): Set<string> {
  ensureValidationLedger(db);
  return new Set((db.prepare('SELECT product_id FROM loop_external_validation_cases WHERE corpus_version=?').all(corpusVersion) as { product_id: string }[]).map(row => row.product_id));
}

export function externalValidationReservations(db: DatabaseSync, corpusVersion: string): ExternalValidationReservation[] {
  ensureValidationLedger(db);
  const rows = db.prepare('SELECT case_id,product_id,source_id,source_sha256,reserved_at FROM loop_external_validation_cases WHERE corpus_version=? ORDER BY reserved_at,case_id').all(corpusVersion) as { case_id: string; product_id: string; source_id: string; source_sha256: string; reserved_at: string }[];
  return rows.map(row => ({ caseId: row.case_id, productId: row.product_id, sourceId: row.source_id, sourceSha256: row.source_sha256, reservedAt: row.reserved_at }));
}

export function externalValidationRounds(db: DatabaseSync, corpusVersion: string): number {
  ensureValidationLedger(db);
  return (db.prepare('SELECT COUNT(DISTINCT source_id) AS count FROM loop_external_validation_cases WHERE corpus_version=?').get(corpusVersion) as { count: number }).count;
}

/** Reserve before dispatch. A started round stays consumed even if its calls fail. */
export function reserveExternalValidation(db: DatabaseSync, corpus: ProductCorpus, sourceId: string, sourceSha256: string, cases: ExternalValidationCase[]): void {
  if (!sourceId || !/^[a-f0-9]{64}$/.test(sourceSha256) || cases.length !== 2 || new Set(cases.map(item => item.productId)).size !== 2) throw new Error('Invalid external validation reservation.');
  ensureValidationLedger(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT product_id,case_id,source_sha256 FROM loop_external_validation_cases WHERE corpus_version=? AND source_id=?').all(corpus.version, sourceId) as { product_id: string; case_id: string; source_sha256: string }[];
    if (existing.length) {
      if (existing.length !== cases.length || existing.some(row => row.source_sha256 !== sourceSha256 || !cases.some(item => item.id === row.case_id && item.productId === row.product_id))) throw new Error('Existing reservation differs from this packet.');
      db.exec('COMMIT'); return;
    }
    const official = officialValidations(db);
    if (official.length + externalValidationRounds(db, corpus.version) >= 3) throw new Error('Three validation rounds are already consumed.');
    const used = new Set(official.flatMap(validation => validation.caseIds.map(id => corpus.cases.find(item => item.id === id)?.productId).filter((id): id is string => !!id)));
    for (const item of cases) {
      const expected = corpus.cases.find(entry => entry.id === item.id);
      if (!expected || expected.split !== 'validation' || expected.productId !== item.productId || expected.question !== item.question || used.has(item.productId)) throw new Error(`Validation case is not fresh: ${item.id}.`);
    }
    const insert = db.prepare('INSERT INTO loop_external_validation_cases(corpus_version,product_id,case_id,source_id,source_sha256,reserved_at) VALUES(?,?,?,?,?,?)');
    for (const item of cases) insert.run(corpus.version, item.productId, item.id, sourceId, sourceSha256, new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/** Replay the completed standalone round into new checkouts before any app selection. */
export function importKnownValidationPacket(db: DatabaseSync, corpus: ProductCorpus): void {
  if (corpus.version !== 'epqa-demo-v1-cec976cc2f22') return;
  const packet = JSON.parse(readFileSync(new URL('../docs/evidence/answer-calibration-revision2-validation-2026-09-25.json', import.meta.url), 'utf8')) as {
    format: string; phase: string; corpusVersion: string; policyId: string; startedAt: string | null;
    cases: { caseId: string; productId: string; question: string }[];
    steps: { caseId: string; status: string }[];
  };
  if (packet.format !== 'ablatrix-answer-calibration-revision2-v1' || packet.phase !== 'validation' || packet.corpusVersion !== corpus.version || !packet.startedAt || packet.cases.length !== 2 || packet.steps.length !== 4 || packet.steps.some(step => !packet.cases.some(item => item.caseId === step.caseId) || step.status === 'planned')) throw new Error('The recorded revision 2 validation packet is incomplete.');
  const manifest = { corpusVersion: packet.corpusVersion, policyId: packet.policyId, cases: packet.cases.map(item => [item.caseId, item.productId, item.question]) };
  const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  reserveExternalValidation(db, corpus, `packet:${packet.policyId}`, digest, packet.cases.map(item => ({ id: item.caseId, productId: item.productId, question: item.question })));
}
