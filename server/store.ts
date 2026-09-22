import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExperimentRecord, RunRecord } from './contracts.ts';

export class RunStore {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL,
      started_at TEXT NOT NULL, document TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS runs_started_at ON runs(started_at DESC);
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, document TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS experiments_created_at ON experiments(created_at DESC);`);
  }
  save(run: RunRecord): void {
    this.db.prepare(`INSERT INTO runs (id,task_id,status,started_at,document) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, document=excluded.document`)
      .run(run.id, run.taskId, run.status, run.startedAt, JSON.stringify(run));
  }
  get(id: string): RunRecord | null {
    const row = this.db.prepare('SELECT document FROM runs WHERE id=?').get(id) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as RunRecord : null;
  }
  list(): RunRecord[] {
    return (this.db.prepare('SELECT document FROM runs ORDER BY started_at DESC LIMIT 100').all() as { document: string }[])
      .map(row => JSON.parse(row.document) as RunRecord);
  }
  saveExperiment(experiment: ExperimentRecord): void {
    this.db.prepare(`INSERT INTO experiments (id,status,created_at,document) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, document=excluded.document`)
      .run(experiment.id, experiment.status, experiment.createdAt, JSON.stringify(experiment));
  }
  getExperiment(id: string): ExperimentRecord | null {
    const row = this.db.prepare('SELECT document FROM experiments WHERE id=?').get(id) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as ExperimentRecord : null;
  }
  listExperiments(): ExperimentRecord[] {
    return (this.db.prepare('SELECT document FROM experiments ORDER BY created_at DESC LIMIT 100').all() as { document: string }[])
      .map(row => JSON.parse(row.document) as ExperimentRecord);
  }
  pendingExperiments(): ExperimentRecord[] {
    return (this.db.prepare("SELECT document FROM experiments WHERE status IN ('queued','running') ORDER BY created_at ASC").all() as { document: string }[])
      .map(row => JSON.parse(row.document) as ExperimentRecord);
  }
  hasInterruptedLiveExperiment(): boolean {
    return this.db.prepare("SELECT 1 FROM experiments WHERE status='interrupted' LIMIT 1").get() !== undefined;
  }
  close(): void { this.db.close(); }
}
