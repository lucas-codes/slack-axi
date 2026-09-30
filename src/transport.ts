import { Failure } from './errors.ts';

const parameters = {
  'auth.test': [],
  'conversations.list': ['types','exclude_archived','limit','cursor'],
  'conversations.info': ['channel'],
  'conversations.history': ['channel','limit','cursor'],
  'conversations.replies': ['channel','ts','limit','cursor'],
  'search.messages': ['query','count','page','sort','sort_dir','highlight'],
  'users.info': ['user'],
} as const;
export type Method = keyof typeof parameters;
const RESPONSE_CAP = 2 * 1024 * 1024;
export const TIMEOUT_MS = 15_000;

export function validateUrl(url: URL): void {
  if (url.origin !== 'https://slack.com' || url.username || url.password || url.hash ||
    !Object.keys(parameters).some(method => url.pathname === '/api/' + method)) {
    throw new Failure('Request destination is not allowed.', 'transport');
  }
}
export function credential(token: string | undefined): string {
  if (!token || !token.startsWith('xoxp-') || token.length <= 5 || /[\s\x00-\x1f\x7f-\x9f]/u.test(token)) {
    throw new Failure('Set SLACK_AXI_TOKEN to a user OAuth xoxp- token via external environment injection. Session tokens and cookies are not accepted.', 'auth');
  }
  return token;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Failure('Invalid response object.');
  return value as Record<string, unknown>;
}
export async function request(method: Method, params: Record<string, string>, token: string): Promise<Record<string, unknown>> {
  if (!Object.hasOwn(parameters, method)) throw new Failure('API method is not allowed.', 'transport');
  const allowed: readonly string[] = parameters[method];
  if (Object.keys(params).some(key => !allowed.includes(key))) throw new Failure('API parameter is not allowed.', 'transport');
  const url = new URL('/api/' + method, 'https://slack.com');
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
  validateUrl(url);
  credential(token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'manual', signal: controller.signal });
    reader = response.body?.getReader();
    if (response.status >= 300 && response.status < 400) throw new Failure('Redirect refused.', 'transport');
    if (response.status === 429) {
      const raw = response.headers.get('retry-after');
      const n = raw !== null && /^[0-9]{1,10}$/.test(raw) ? Number(raw) : NaN;
      throw new Failure('Slack rate limit reached; no automatic retry.', 'rate_limit',1,Number.isSafeInteger(n) ? n : null);
    }
    if (!response.ok) throw new Failure('Slack returned an unsuccessful HTTP status.', 'http');
    if (!reader) throw new Failure('Empty response body.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > RESPONSE_CAP) throw new Failure('Response exceeds 2 MiB.', 'response_limit');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let data: Record<string,unknown>;
    try { data = object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))); }
    catch { throw new Failure('Malformed JSON response.'); }
    if (data.ok !== true) {
      if (data.ok === false && typeof data.error === 'string') throw new Failure('Slack API error: ' + data.error, 'slack');
      throw new Failure('Invalid Slack response envelope.');
    }
    return data;
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure(controller.signal.aborted ? 'Request timed out after 15 seconds.' : 'Slack request failed.', controller.signal.aborted ? 'timeout' : 'transport');
  } finally {
    clearTimeout(timer);
    if (reader) await reader.cancel();
  }
}
