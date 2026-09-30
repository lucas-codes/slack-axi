import { Failure } from './errors.ts';

export type Command = 'status' | 'list' | 'history' | 'replies' | 'search' | 'user';
export type Args = { command: Command; positionals: string[]; json: boolean; help: boolean; version: boolean; limit: number; includePrivate: boolean; includeDms: boolean; cursor?: string; page: number; sort: 'score' | 'timestamp'; sortDir: 'asc' | 'desc'; includeBots: boolean };
const flags: Record<Command, string[]> = {
  status: [], user: [], list: ['limit', 'include-private', 'cursor'],
  history: ['limit', 'include-private', 'cursor'], replies: ['limit', 'include-private', 'cursor'],
  search: ['limit', 'include-private', 'page', 'sort', 'sort-dir', 'include-bots'],
};
const arities: Record<Command, number> = { status: 0, list: 0, history: 1, replies: 2, search: 1, user: 1 };
export const CHANNEL_ID = /^[CGD][A-Z0-9]+$/;
export const USER_ID = /^[UW][A-Z0-9]+$/;
export const TS = /^[0-9]+\.[0-9]{6}$/;
function usage(message: string): never { throw new Failure(message, 'usage', 2); }
export function cursorValue(value: string): string {
  if (value.length > 2048 || /[^\x20-\x7e]/.test(value)) usage('Cursor must be printable ASCII, at most 2048 characters.');
  return value;
}
export function channelInput(value: string): { id?: string; name?: string } {
  if (!value.startsWith('#') && /^[CGD]/.test(value)) {
    if (!CHANNEL_ID.test(value)) usage('Invalid channel ID.');
    return { id: value };
  }
  const name = value.startsWith('#') ? value.slice(1) : value;
  if (!name || /[\s\x00-\x1f\x7f-\x9f]/u.test(name)) usage('Invalid channel name.');
  return { name };
}
export function parse(argv: string[]): Args {
  const values = new Map<string, string | boolean>();
  const words: string[] = [];
  let literal = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!literal && arg === '--') { literal = true; continue; }
    if (!literal && arg.startsWith('-')) {
      const normalized = arg === '-h' ? '--help' : arg === '-v' ? '--version' : arg;
      const [name, ...parts] = normalized.slice(2).split('=');
      if (!normalized.startsWith('--') || !name || !['help','version','json','include-private','include-dms','include-bots','limit','cursor','page','sort','sort-dir'].includes(name)) usage('Unknown flag.');
      if (values.has(name)) usage('Duplicate flag.');
      if (['help','version','json','include-private','include-dms','include-bots'].includes(name)) {
        if (parts.length) usage('Boolean flags do not accept values.');
        values.set(name, true);
      } else {
        const value = parts.length ? parts.join('=') : argv[++i];
        if (value === undefined || value === '' || (!parts.length && value.startsWith('-'))) usage('Missing flag value.');
        values.set(name, value);
      }
    } else words.push(arg);
  }
  let command: Command = 'status';
  if (words.length) {
    const first = words.shift();
    if (first === 'channel') {
      const second = words.shift();
      if (second !== 'list' && second !== 'history') usage('Expected channel list or channel history.');
      command = second;
    } else if (first === 'thread') {
      if (words.shift() !== 'replies') usage('Expected thread replies.');
      command = 'replies';
    } else if (first === 'status' || first === 'search' || first === 'user') command = first;
    else usage('Unknown command.');
  }
  for (const name of values.keys()) {
    if (!['help','version','json'].includes(name) && !(flags[command].includes(name) || (name === 'include-dms' && !['status','user'].includes(command)))) usage('Flag is not supported for this command.');
  }
  const help = values.has('help'), version = values.has('version');
  if (help && version) usage('Help and version cannot be combined.');
  if (words.length > arities[command] || (!help && words.length < arities[command])) usage('Incorrect argument count.');
  if ((command === 'history' || command === 'replies') && words[0] !== undefined) channelInput(words[0]);
  if (command === 'replies' && words[1] !== undefined && !TS.test(words[1])) usage('Invalid timestamp; use digits with six decimal places.');
  if (command === 'user' && words[0] !== undefined && !USER_ID.test(words[0])) usage('Invalid user ID.');
  if (command === 'search' && words[0] !== undefined && !words[0].trim()) usage('Query must not be empty.');
  function integer(name: string, fallback: number): number {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) usage('Expected an integer from 1 to 100.');
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 1 || n > 100) usage('Expected an integer from 1 to 100.');
    return n;
  }
  function choice<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) usage('Expected one of: ' + allowed.join(', ') + '.');
    return raw as T;
  }
  const cursor = values.get('cursor');
  return { command, positionals: words, json: values.has('json'), help, version, limit: integer('limit',20), includePrivate: values.has('include-private'), includeDms: values.has('include-dms'), page: integer('page',1), sort: choice('sort',['score','timestamp'],'score'), sortDir: choice('sort-dir',['asc','desc'],'desc'), includeBots: values.has('include-bots'), ...(typeof cursor === 'string' ? {cursor:cursorValue(cursor)} : {}) };
}

export function wantsJson(argv: string[]): boolean {
  const before = argv.slice(0, argv.indexOf('--') < 0 ? argv.length : argv.indexOf('--'));
  return before.filter(x => x === '--json').length === 1 && !before.some(x => x.startsWith('--json='));
}
