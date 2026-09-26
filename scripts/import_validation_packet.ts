import { DatabaseSync } from 'node:sqlite';
import { loadProductCorpus } from '../server/product-corpus.ts';
import { externalValidationReservations, importKnownValidationPacket } from '../server/validation-ledger.ts';

const corpus = loadProductCorpus();
const db = new DatabaseSync(process.env.ABLATRIX_LOOP_DB ?? '.data/feedback-loop.sqlite');
try {
  importKnownValidationPacket(db, corpus);
  console.log(JSON.stringify({ imported: true, reservations: externalValidationReservations(db, corpus.version) }));
} finally { db.close(); }
