import assert from 'node:assert/strict';
import { Agent as SystemHttpsAgent, request as systemHttpsRequest, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';

// Capture the built-in function once. Production never reads global fetch,
// globalAgent, a caller transport hook or an environment proxy configuration.
const directHttpsRequest = systemHttpsRequest;
const DirectHttpsAgent = SystemHttpsAgent;
type Request = (options: RequestOptions, response: (message: IncomingMessage) => void) => ClientRequest;
const endpoint = 'https://router.sapiom.ai/v1/chat/completions';
async function transport(request: Request, url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  assert.equal(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, endpoint);
  assert.ok(init?.method === 'POST' && typeof init.body === 'string' && init.redirect === 'error' && init.signal, 'Direct Router transport requires a bounded exact POST.');
  init.signal.throwIfAborted();
  const body = init.body, signal = init.signal, headers = Object.fromEntries(new Headers(init.headers));
  assert.deepEqual(Object.keys(headers).sort(), ['authorization', 'content-type', 'x-sapiom-lane']);
  assert.ok(headers.authorization.startsWith('Bearer ') && headers['content-type'] === 'application/json' && headers['x-sapiom-lane'] === 'run_now', 'Direct Router transport requires the existing provider header contract.');
  assert.ok(Buffer.byteLength(body) <= 128 * 1024, 'Frozen grading request exceeds its transport bound.');
  return new Promise((resolve, reject) => {
    // agent:false consults the mutable globalAgent.constructor in Node. Pass
    // an explicit private built-in agent and dispose it after this sole call.
    const agent = new DirectHttpsAgent({ keepAlive: false, maxSockets: 1, maxTotalSockets: 1 });
    let settled = false, response: IncomingMessage | undefined;
    const finish = (error?: Error, value?: Response) => {
      if (settled) return; settled = true; signal.removeEventListener('abort', abort); agent.destroy();
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => { const error = new Error('Router qualification transport aborted.'); response?.destroy(error); req.destroy(error); finish(error); };
    let req: ClientRequest;
    try { req = request({ protocol: 'https:', hostname: 'router.sapiom.ai', servername: 'router.sapiom.ai', port: 443, path: '/v1/chat/completions', method: 'POST', headers: { ...headers, 'accept-encoding': 'identity', 'content-length': Buffer.byteLength(body) }, agent, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, message => {
      response = message; let size = 0; const chunks: Buffer[] = [];
      message.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 128 * 1024) { const error = new Error('Router grading response exceeds 128 KiB.'); message.destroy(error); req.destroy(error); finish(error); } else chunks.push(Buffer.from(chunk));
      });
      message.on('error', error => finish(error));
      message.on('aborted', () => finish(new Error('Router response was interrupted.')));
      message.on('end', () => {
        if (settled) return;
        try {
          const responseHeaders = new Headers(); for (const [key, value] of Object.entries(message.headers)) if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
          const bytes = Buffer.concat(chunks, size); finish(undefined, new Response(bytes.length ? bytes : null, { status: message.statusCode, headers: responseHeaders }));
        } catch (error) { finish(error instanceof Error ? error : new Error('Invalid Router response.')); }
      });
    }); } catch (error) { finish(error instanceof Error ? error : new Error('Router request construction failed.')); return; }
    req.on('error', error => finish(error));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try { req.end(body); } catch (error) { req.destroy(); finish(error instanceof Error ? error : new Error('Router request write failed.')); }
  });
}
/** Fixed built-in HTTPS transport for the non-injectable production runner. */
export const qualificationRouterTransport: typeof fetch = (url, init) => transport(directHttpsRequest, url, init);

/** Wire mechanics only; this hook is never used by production execution and
 * cannot supply a transport to executeLiveQualification or certify evidence. */
export const qualificationTransportMechanics = (request: Request, url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => transport(request, url, init);
