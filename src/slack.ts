import { channelInput, CHANNEL_ID, USER_ID, TS, cursorValue } from './args.ts';
import type { Args } from './args.ts';
import { Failure } from './errors.ts';
import { object, request } from './transport.ts';
import { Cleaner } from './output.ts';
import type { Output, Row, Scalar } from './output.ts';

type Obj = Record<string, unknown>;
export const SEARCH_MAX_PAGES = 5;
const DM_LOOKUPS = 10;
function requiredString(o: Obj, key: string): string {
  const value = o[key];
  if (typeof value !== 'string' || !value) throw new Failure('Missing or invalid response string.');
  return value;
}
function optionalString(o: Obj, key: string): string | null {
  if (o[key] === undefined || o[key] === null) return null;
  if (typeof o[key] !== 'string') throw new Failure('Invalid response string.');
  return o[key];
}
function boolean(o: Obj, key: string, required = false): boolean | null {
  const value = o[key];
  if (value == null && !required) return null;
  if (typeof value !== 'boolean') throw new Failure('Missing or invalid classification boolean.');
  return value;
}
function number(o: Obj, key: string, required = false): number | null {
  const value = o[key];
  if (value == null && !required) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Failure('Invalid response integer.');
  return value;
}
function collection(o: Obj, key: string): Obj[] {
  if (!Array.isArray(o[key])) throw new Failure('Invalid response collection.');
  return o[key].map(object);
}
function exact(value: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new Failure('Invalid response identifier or timestamp.');
  return value;
}
function nextCursor(data: Obj): string | null {
  if (data.response_metadata == null) return null;
  const metadata = object(data.response_metadata);
  const cursor = optionalString(metadata,'next_cursor');
  if (!cursor) return null;
  try { return cursorValue(cursor); } catch { throw new Failure('Invalid response cursor.'); }
}
function eligible(c: Obj, includePrivate: boolean, includeDms: boolean): boolean {
  const privateChannel = boolean(c,'is_private',true)!;
  const im = boolean(c,'is_im',true)!;
  const mpim = boolean(c,'is_mpim',true)!;
  return im || mpim ? includeDms : (!privateChannel || includePrivate);
}
function nestedString(o: Obj, field: string, child: string): string | null {
  if (o[field] == null) return null;
  return optionalString(object(o[field]),child);
}
function display(cleaner: Cleaner, value: string | null, path: string, cap = 200): Scalar {
  return value === null ? null : cleaner.field(value,path,cap);
}
// Bot and integration posts often carry their content only in attachments or blocks.
const str = (v: unknown): string => typeof v === 'string' ? v : '';
const obj = (v: unknown): Obj | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined;
const objs = (v: unknown): Obj[] => Array.isArray(v) ? v.map(obj).filter((x): x is Obj => x !== undefined) : [];
function richText(node: Obj): string {
  const children = objs(node.elements);
  switch (node.type) {
    case 'text': return str(node.text);
    case 'link': return str(node.text) || str(node.url);
    case 'rich_text': case 'rich_text_list': return children.map(richText).join('\n');
    case 'rich_text_section': case 'rich_text_quote': case 'rich_text_preformatted': return children.map(richText).join('');
    default: return '';
  }
}
function blockLines(block: Obj): string[] {
  switch (block.type) {
    case 'section': return [str(obj(block.text)?.text), ...objs(block.fields).map(f => str(f.text))];
    case 'context': return objs(block.elements).filter(e => e.type === 'mrkdwn' || e.type === 'plain_text').map(e => str(e.text));
    case 'rich_text': return [richText(block)];
    default: return [];
  }
}
function attachmentLines(a: Obj): string[] {
  const fields = a.fields == null ? [] : collection(a,'fields').map(f => [optionalString(f,'title'),optionalString(f,'value')].filter(Boolean).join(': '));
  const structured = [optionalString(a,'pretext'),optionalString(a,'title'),optionalString(a,'text'),...fields].filter(Boolean) as string[];
  // fallback is Slack's plain-text rendering of the same parts, so it only stands in when they are absent.
  return structured.length ? structured : [optionalString(a,'fallback') ?? ''];
}
function derivedText(m: Obj): string {
  const blocks = m.blocks == null ? [] : collection(m,'blocks').flatMap(blockLines);
  const attachments = m.attachments == null ? [] : collection(m,'attachments').flatMap(attachmentLines);
  return [...blocks,...attachments].filter(line => line.trim()).join('\n');
}
function message(m: Obj, path: string, c: Cleaner): Row {
  const thread = optionalString(m,'thread_ts');
  const user = optionalString(m,'user');
  const bot = optionalString(m,'bot_id');
  const raw = typeof m.text === 'string' ? m.text : requiredString(m,'text');
  const text = raw.trim() ? raw : derivedText(m) || raw;
  return {
    ts: exact(requiredString(m,'ts'),TS),
    thread_ts: thread === null ? null : exact(thread,TS),
    user: user === null ? null : exact(user,USER_ID),
    bot_id: bot === null ? null : exact(bot,/^B[A-Z0-9]+$/),
    text: c.field(text,path+'.text',2000),
    reply_count: number(m,'reply_count'),
  };
}
function listParams(includePrivate: boolean, includeDms: boolean, limit: number, cursor?: string): Record<string,string> {
  const types = ['public_channel', ...(includePrivate ? ['private_channel'] : []), ...(includeDms ? ['im','mpim'] : [])].join(',');
  return {types,exclude_archived:'true',limit:String(limit),...(cursor ? {cursor} : {})};
}
async function resolveChannel(input: string, includePrivate: boolean, includeDms: boolean, token: string): Promise<string> {
  const parsed = channelInput(input);
  let id = parsed.id;
  if (!id) {
    const matches: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const data = await request('conversations.list',listParams(includePrivate,includeDms,100,cursor),token);
      for (const c of collection(data,'channels')) {
        const name = boolean(c,'is_im',true) ? optionalString(c,'name') : requiredString(c,'name');
        const candidate = exact(requiredString(c,'id'),CHANNEL_ID);
        const archived = boolean(c,'is_archived');
        if (eligible(c,includePrivate,includeDms) && !archived && name === parsed.name) matches.push(candidate);
      }
      cursor = nextCursor(data) ?? undefined;
      if (!cursor) break;
      if (page === 9) throw new Failure('Channel lookup exhausted ten pages; use an explicit channel ID.', 'lookup_budget');
    }
    if (matches.length > 1) throw new Failure('Channel name is ambiguous.', 'lookup');
    if (!matches.length) throw new Failure('Channel name was not found.', 'lookup');
    id = matches[0]!;
  }
  const info = object((await request('conversations.info',{channel:id},token)).channel);
  if (exact(requiredString(info,'id'),CHANNEL_ID) !== id) throw new Failure('Channel metadata ID mismatch.');
  if (!boolean(info,'is_im',true)) requiredString(info,'name');
  if (!eligible(info,includePrivate,includeDms)) throw new Failure('Conversation refused: DMs require --include-dms and private channels require --include-private.', 'privacy');
  return id;
}
// Search matches do not document bot markers; these are the fields Slack sets on bot_message objects.
function isBot(m: Obj): boolean {
  return !!optionalString(m,'bot_id') || optionalString(m,'subtype') === 'bot_message';
}
// IM matches name the counterpart by bare user ID; resolve a bounded number of them via users.info.
async function dmLabels(matches: Obj[], token: string): Promise<Map<string,string>> {
  const ids = new Set<string>();
  for (const m of matches) {
    const name = m.type === 'im' ? optionalString(object(m.channel),'name') : null;
    if (name !== null && USER_ID.test(name)) ids.add(name);
  }
  const labels = new Map<string,string>();
  for (const id of [...ids].slice(0,DM_LOOKUPS)) {
    const u = object((await request('users.info',{user:id},token)).user);
    if (exact(requiredString(u,'id'),USER_ID) !== id) throw new Failure('User response ID mismatch.');
    const label = nestedString(u,'profile','display_name') || optionalString(u,'real_name') || requiredString(u,'name');
    labels.set(id,'@'+label);
  }
  return labels;
}
export async function execute(args: Args, token: string, c: Cleaner): Promise<Output> {
  const p = args.positionals;
  let output: Output;
  switch(args.command) {
    case 'status': {
      const data = await request('auth.test',{},token);
      const status: Row = {
        team_id: exact(requiredString(data,'team_id'),/^T[A-Z0-9]+$/),
        team: display(c,requiredString(data,'team'),'status.team'),
        user_id: exact(requiredString(data,'user_id'),USER_ID),
        user: display(c,requiredString(data,'user'),'status.user'),
        url: display(c,optionalString(data,'url'),'status.url',2048),
      };
      output = {status}; break;
    }
    case 'list': {
      const data = await request('conversations.list',listParams(args.includePrivate,args.includeDms,args.limit,args.cursor),token);
      const channels = collection(data,'channels').filter(ch => eligible(ch,args.includePrivate,args.includeDms) && !boolean(ch,'is_archived')).slice(0,args.limit).map((ch,i) => ({
        id: exact(requiredString(ch,'id'),CHANNEL_ID),
        name: display(c,boolean(ch,'is_im',true) ? optionalString(ch,'name') : requiredString(ch,'name'),`channels[${i}].name`),
        is_private: boolean(ch,'is_private',true),
        num_members: number(ch,'num_members'),
        topic: display(c,nestedString(ch,'topic','value'),`channels[${i}].topic`),
        purpose: display(c,nestedString(ch,'purpose','value'),`channels[${i}].purpose`),
      }));
      output = {channels,next_cursor:nextCursor(data)}; break;
    }
    case 'history': case 'replies': {
      const id = await resolveChannel(p[0]!,args.includePrivate,args.includeDms,token);
      const params = {channel:id,limit:String(args.limit),...(args.cursor ? {cursor:args.cursor} : {})};
      const data = args.command === 'history' ? await request('conversations.history',params,token) : await request('conversations.replies',{...params,ts:p[1]!},token);
      output = {channel_id:id,messages:collection(data,'messages').slice(0,args.limit).map((m,i)=>message(m,`messages[${i}]`,c)),next_cursor:nextCursor(data)};
      break;
    }
    case 'search': {
      const admitted: Obj[] = [];
      let filtered = 0, firstPage: number | null = null, pages = 0, read = args.page;
      for (let n = args.page; n < args.page + SEARCH_MAX_PAGES; n++) {
        read = n;
        const data = object((await request('search.messages',{query:p[0]!,count:String(args.limit),page:String(n),sort:args.sort,sort_dir:args.sortDir,highlight:'false'},token)).messages);
        const paging = object(data.paging);
        const page = number(paging,'page',true)!;
        pages = number(paging,'pages',true)!;
        if (page < 1 || page > 100) throw new Failure('Invalid search page.');
        firstPage ??= page;
        for (const m of collection(data,'matches')) {
          const type = requiredString(m,'type');
          if (type !== 'message' && type !== 'group' && type !== 'im') { filtered++; continue; }
          if (type === 'im' && !args.includeDms) { filtered++; continue; }
          const ch = object(m.channel);
          const priv = boolean(ch,'is_private',true)!;
          const mpim = boolean(ch,'is_mpim',true)!;
          const im = boolean(ch,'is_im');
          if (type === 'group' && !mpim && !priv) throw new Failure('Contradictory search classification.');
          if ((mpim || im || type === 'im') ? !args.includeDms : (priv && !args.includePrivate)) { filtered++; continue; }
          if (!args.includeBots && isBot(m)) { filtered++; continue; }
          admitted.push(m);
        }
        if (admitted.length >= args.limit || read >= pages || read >= 100) break;
      }
      const emitted = admitted.slice(0,args.limit);
      // An overshot page is re-requested rather than skipped, so its emitted head repeats.
      const nextPage = admitted.length > args.limit ? read : read < pages && read < 100 ? read + 1 : null;
      const labels = await dmLabels(emitted,token);
      const matches = emitted.map((m,i) => {
        const ch = object(m.channel);
        const name = m.type === 'im' ? optionalString(ch,'name') : requiredString(ch,'name');
        return {...message(m,`matches[${i}]`,c),
          channel_id:exact(requiredString(ch,'id'),CHANNEL_ID),
          channel_name:display(c,name !== null && labels.get(name) || name,`matches[${i}].channel_name`),
          permalink:display(c,optionalString(m,'permalink'),`matches[${i}].permalink`,2048)};
      });
      output = {matches,page:firstPage!,pages,next_page:nextPage,filtered}; break;
    }
    case 'user': {
      const u = object((await request('users.info',{user:p[0]!},token)).user);
      const id = exact(requiredString(u,'id'),USER_ID);
      if (id !== p[0]) throw new Failure('User response ID mismatch.');
      const user: Row = {id,name:display(c,requiredString(u,'name'),'user.name'),
        real_name:display(c,optionalString(u,'real_name'),'user.real_name'),
        display_name:display(c,nestedString(u,'profile','display_name'),'user.display_name'),
        title:display(c,nestedString(u,'profile','title'),'user.title'),
        tz:display(c,optionalString(u,'tz'),'user.tz'),deleted:boolean(u,'deleted'),is_bot:boolean(u,'is_bot')};
      output = {user}; break;
    }
  }
  output.truncation = c.truncation;
  return output;
}
