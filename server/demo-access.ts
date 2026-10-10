import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

export type DemoRole = 'viewer' | 'reviewer' | 'operator';
export type DemoActor = Readonly<{ subject: string; reviewer: string; role: DemoRole; name: string }>;
export type DemoAccessConfig = {
  origin: string;
  issuer: string;
  audience: string;
  jwksUrl: string;
  members: Array<{ subject: string; role: DemoRole; name: string }>;
};

export class DemoAccessError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'DemoAccessError'; }
}

const configSchema = z.object({
  origin: z.string().min(1), issuer: z.string().min(1), audience: z.string().min(1).max(1024), jwksUrl: z.string().min(1),
  members: z.array(z.object({ subject: z.string().min(1).max(1024), role: z.enum(['viewer', 'reviewer', 'operator']), name: z.string().trim().min(1).max(100) }).strict()).min(1).max(1000)
}).strict();

function configError(): never { throw new DemoAccessError(500, 'Hosted access configuration is invalid.'); }
function httpsUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) return configError();
    return url;
  } catch { return configError(); }
}

export function parseDemoAccessConfig(raw: unknown): DemoAccessConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) return configError();
  const config = parsed.data;
  if (httpsUrl(config.origin).origin !== config.origin) return configError();
  httpsUrl(config.issuer); httpsUrl(config.jwksUrl);
  if (config.members.some(member => !member.subject.trim()) || new Set(config.members.map(member => member.subject)).size !== config.members.length) return configError();
  return config;
}

/** No implicit hosted mode: either a complete config or no configured fields. */
export function loadDemoAccessConfig(env: NodeJS.ProcessEnv = process.env): DemoAccessConfig | undefined {
  const names = ['ABLATRIX_DEMO_ORIGIN', 'ABLATRIX_DEMO_ISSUER', 'ABLATRIX_DEMO_AUDIENCE', 'ABLATRIX_DEMO_JWKS_URL', 'ABLATRIX_DEMO_MEMBERS'] as const;
  const fieldsPresent = names.some(name => env[name] !== undefined);
  if (env.ABLATRIX_DEMO_ACCESS_CONFIG !== undefined) {
    if (fieldsPresent || !env.ABLATRIX_DEMO_ACCESS_CONFIG.trim()) return configError();
    try { return parseDemoAccessConfig(JSON.parse(readFileSync(env.ABLATRIX_DEMO_ACCESS_CONFIG, 'utf8'))); }
    catch { return configError(); }
  }
  if (!fieldsPresent) return undefined;
  let members: unknown;
  try { members = JSON.parse(env.ABLATRIX_DEMO_MEMBERS ?? ''); } catch { return configError(); }
  return parseDemoAccessConfig({ origin: env.ABLATRIX_DEMO_ORIGIN, issuer: env.ABLATRIX_DEMO_ISSUER, audience: env.ABLATRIX_DEMO_AUDIENCE, jwksUrl: env.ABLATRIX_DEMO_JWKS_URL, members });
}

function singleHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (typeof value !== 'string') return undefined;
  let occurrences = 0;
  for (let i = 0; i < (req.rawHeaders?.length ?? 0); i += 2) if (req.rawHeaders[i].toLowerCase() === name) occurrences++;
  return occurrences > 1 ? undefined : value;
}

const workspaceId = 'workspace-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const comparisonId = '[A-Za-z0-9_-]{1,120}';
const reads = new Set(['/api/session', '/api/health', '/api/workspace', '/api/workspace/reviews', '/api/workspace/reviews/export', '/api/context-comparisons', '/', '/ask', '/review', '/compare']);
const comparisonRead = new RegExp(`^/api/context-comparisons/${comparisonId}(?:/(?:report|export))?$`);
const reviewerWrite = new RegExp(`^(?:/api/workspace/reviews/${workspaceId}/decisions|/api/context-comparisons/${comparisonId}/reviews)$`);
const operatorWrite = new RegExp(`^(?:/api/workspace/(?:products|questions)|/api/workspace/reviews/${workspaceId}/revisions|/api/context-comparisons/fixture)$`);
const assetRead = /^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/;
const rank: Record<DemoRole, number> = { viewer: 0, reviewer: 1, operator: 2 };

/** Identity verification is separate from the application's synthetic-only execution gate. */
export class DemoAccess {
  private readonly config: DemoAccessConfig;
  private readonly members: Map<string, DemoActor>;
  private readonly keyResolver: JWTVerifyGetKey;
  constructor(config: DemoAccessConfig, options: { keyResolver?: JWTVerifyGetKey } = {}) {
    this.config = parseDemoAccessConfig(config);
    this.members = new Map(this.config.members.map(member => [member.subject, Object.freeze({ ...member, reviewer: `subject:${createHash('sha256').update(`${this.config.issuer}\0${member.subject}`).digest('hex')}` })]));
    this.keyResolver = options.keyResolver ?? createRemoteJWKSet(new URL(this.config.jwksUrl), { timeoutDuration: 5000 });
  }

  async authenticate(req: IncomingMessage): Promise<DemoActor> {
    // Proxy-forwarded authority is deliberately ignored. The configured public Host must survive proxying.
    if (singleHeader(req, 'host') !== new URL(this.config.origin).host) throw new DemoAccessError(403, 'Configured public host required.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')) {
      if (singleHeader(req, 'origin') !== this.config.origin) throw new DemoAccessError(403, 'Configured same-origin request required.');
      if (singleHeader(req, 'content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new DemoAccessError(415, 'JSON content type required.');
    }
    const assertion = singleHeader(req, 'cf-access-jwt-assertion');
    if (!assertion || assertion.length > 16_384) throw new DemoAccessError(401, 'Verified access identity required.');
    let subject: string;
    try {
      const { payload } = await jwtVerify(assertion, this.keyResolver, { algorithms: ['RS256'], issuer: this.config.issuer, audience: this.config.audience, requiredClaims: ['exp', 'sub', 'iat'] });
      if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now() / 1000)) throw new Error('Invalid identity claims.');
      subject = payload.sub;
    } catch { throw new DemoAccessError(401, 'Verified access identity required.'); }
    const actor = this.members.get(subject);
    if (!actor) throw new DemoAccessError(403, 'This identity is not a configured demo member.');
    return actor;
  }

  authorize(actor: DemoActor, method: string, path: string): void {
    const configured = this.members.get(actor.subject);
    if (!configured || actor.reviewer !== configured.reviewer || actor.role !== configured.role) throw new DemoAccessError(403, 'Configured demo member required.');
    if (method === 'GET' && (reads.has(path) || comparisonRead.test(path) || assetRead.test(path) || path === '/favicon.ico')) return;
    if (method === 'POST' && ((reviewerWrite.test(path) && rank[configured.role] >= rank.reviewer) || (operatorWrite.test(path) && configured.role === 'operator'))) return;
    throw new DemoAccessError(403, 'This action is unavailable for your role in the hosted demo.');
  }
}
