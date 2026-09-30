import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../index.ts';
import { request, validateUrl } from '../transport.ts';
import { decode } from '@toon-format/toon';

const TOKEN = 'xoxp-synthetic-test-secret';
const channel = { id: 'C123', name: 'general', is_private: false, is_im: false, is_mpim: false };
const message = { ts: '123.000001', text: 'hello' };
let calls: { url: URL; init: RequestInit }[] = [];
beforeEach(() => {
  calls = [];
  globalThis.fetch = async () => { throw new Error('network denied by test'); };
});
function mock(responses: unknown[]) {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://slack.com');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'manual');
    assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer ' + TOKEN);
    calls.push({ url, init: init! });
    assert.ok(responses.length, 'unexpected fetch');
    const response = responses.shift();
    return response instanceof Response ? response : Response.json(response);
  };
}
async function invoke(args: string[], responses: unknown[] = []) {
  mock(responses);
  const result = await run(args, { SLACK_AXI_TOKEN: TOKEN });
  return { ...result, data: JSON.parse(result.stdout) };
}
test('side effect free import and credential-free help/version', async () => {
  assert.equal((await run(['--help'], {})).exitCode, 0);
  assert.equal((await run(['--version'], {})).exitCode, 0);
});
test('every command normalizes a mocked response', async () => {
  let r = await invoke(['status','--json'], [{ok:true,team_id:'T123',team:'team',user_id:'U123',user:'me',url:'https://team.slack.com/'}]);
  assert.equal(r.data.status.team_id, 'T123');
  r = await invoke(['channel','list','--json'], [{ok:true,channels:[channel],response_metadata:{next_cursor:'abc'}}]);
  assert.equal(r.data.channels[0].name, 'general');
  assert.equal(r.data.next_cursor,'abc');
  assert.equal(calls[0]!.url.searchParams.get('types'),'public_channel');
  r = await invoke(['channel','history','C123','--json'], [{ok:true,channel},{ok:true,messages:[message]}]);
  assert.equal(r.data.messages[0].ts,'123.000001');
  r = await invoke(['thread','replies','C123','123.000001','--json'], [{ok:true,channel},{ok:true,messages:[message]}]);
  assert.equal(r.data.messages.length,1);
  r = await invoke(['search','hello','--json'], [{ok:true,messages:{matches:[{...message,type:'message',channel}],paging:{page:1,pages:1}}}]);
  assert.equal(r.data.matches[0].channel_id,'C123');
  assert.equal(calls.length,1);
  assert.equal(calls[0]!.url.searchParams.get('highlight'),'false');
  r = await invoke(['user','W123','--json'], [{ok:true,user:{id:'W123',name:'me'}}]);
  assert.equal(r.data.user.display_name,null);
});
test('invalid syntax, writes and invalid credentials fail before fetch', async () => {
  for (const args of [['post'],['react'],['download'],['draft'],['auth'],['status','--wat','--help'],['status','--help','--version'],['search','a','b'],['search','a','--page','101'],['channel','list','--limit','1.5'],['channel','list','--limit','0'],['channel','list','--limit','101'],['channel','list','--json=true'],['status','--json','--json'],['status','-h','--help'],['channel','list','--cursor'],['user','x'],['thread','replies','C123','1.1']]) {
    const r = await run(args, {SLACK_AXI_TOKEN:TOKEN});
    assert.equal(r.exitCode,2, args.join(' '));
  }
  for (const token of [undefined,'xoxb-secret','xoxc-secret','xoxd-secret',TOKEN+'\n']) {
    const r = await run(['status','--json'],{SLACK_AXI_TOKEN:token});
    assert.equal(r.exitCode,1);
    if(token) assert.ok(!r.stdout.includes(token));
  }
  assert.equal(calls.length,0);
});
test('privacy guards precede history; search filters private and DMs', async () => {
  for(const c of [{...channel,is_private:true},{...channel,is_im:true},{...channel,is_mpim:true}]) {
    const r=await invoke(['channel','history','C123','--json'],[{ok:true,channel:c}]);
    assert.equal(r.exitCode,1);
    assert.equal(calls.length,1);
  }
  let r=await invoke(['channel','history','C123','--include-private','--json'],[{ok:true,channel:{...channel,is_private:true}},{ok:true,messages:[message]}]);
  assert.equal(r.exitCode,0);
  r=await invoke(['search','a','--json'],[{ok:true,messages:{matches:[
    {...message,type:'message',channel},
    {...message,type:'group',channel:{...channel,is_private:true}},
    {...message,type:'im',channel},
    {...message,type:'group',channel:{...channel,is_private:true,is_mpim:true}}
  ],paging:{page:1,pages:1}}}]);
  assert.equal(r.data.matches.length,1); assert.equal(r.data.filtered,3);
});
test('closed transport refuses forbidden URLs, methods and parameters without fetch', async () => {
  for (const url of ['http://slack.com/api/auth.test','https://evil.invalid/api/auth.test','https://slack.com:444/api/auth.test','https://a@slack.com/api/auth.test','https://slack.com/api/chat.postMessage','https://slack.com/','https://slack.com/api/auth.test#x']) {
    assert.throws(()=>validateUrl(new URL(url)));
  }
  await assert.rejects(()=>request('chat.postMessage' as never,{},TOKEN));
  await assert.rejects(()=>request('auth.test',{token:TOKEN},TOKEN));
  assert.equal(calls.length,0);
});
test('redirects never followed; URL next fields ignored and cursors opaque', async () => {
  let r=await invoke(['status','--json'],[new Response(null,{status:302,headers:{Location:'https://evil.invalid/'+TOKEN}})]);
  assert.equal(r.exitCode,1); assert.equal(calls.length,1); assert.ok(!r.stdout.includes(TOKEN));
  r=await invoke(['channel','list','--json','--cursor','https://evil.invalid/'],[{ok:true,channels:[],next:'https://evil.invalid/',response_metadata:{next_cursor:'https://evil.invalid/'}}]);
  assert.equal(r.exitCode,0); assert.equal(calls.length,1);
  assert.equal(calls[0]!.url.searchParams.get('cursor'),'https://evil.invalid/');
});
test('redaction, sanitation, clipping and TOON decoder compatibility', async () => {
  const dirty = 'a\u009b\u001b[31m\u007fb';
  const echo = TOKEN.slice(0,8)+'\u001b'+TOKEN.slice(8);
  const rows=[{...message,text:dirty+'\n\t'+echo+TOKEN+'😀'.repeat(2100)}];
  let r=await invoke(['channel','history','C123','--json'],[{ok:true,channel},{ok:true,messages:rows}]);
  assert.ok(!r.stdout.includes(TOKEN)); assert.ok(!r.stdout.includes('synthetic-test-secret'));
  assert.ok(!r.stdout.includes('\\u009b')); assert.ok(!r.stdout.includes('\\u001b'));
  assert.equal([...r.data.messages[0].text].length,2000);
  assert.equal(r.data.truncation[0].path,'messages[0].text');
  mock([{ok:true,channels:[{...channel,name:dirty,topic:{value:echo},purpose:{value:TOKEN}}]}]);
  const toon=await run(['channel','list'],{SLACK_AXI_TOKEN:TOKEN});
  const data=decode(toon.stdout) as any;
  assert.equal(data.channels[0].name,'a[31mb');
  assert.equal(data.channels[0].topic,'[REDACTED]');
  assert.ok(!toon.stdout.includes(TOKEN));
});
test('all error paths are safe, structured and nonzero', async () => {
  for(const response of [
    {ok:false,error:TOKEN},
    {ok:true},
    new Response('{',{headers:{'content-type':'application/json'}}),
    new Response('x'.repeat(2*1024*1024+1)),
    new Response(null,{status:429,headers:{'Retry-After':'30'}})
  ]) {
    const r=await invoke(['status','--json'],[response]);
    assert.equal(r.exitCode,1); assert.ok(!r.stdout.includes(TOKEN));
    assert.equal(typeof r.data.error,'string');
    assert.equal(typeof r.data.code,'string');
  }
  globalThis.fetch=async()=>{throw new Error(TOKEN);};
  const r=await run(['status','--json'],{SLACK_AXI_TOKEN:TOKEN});
  assert.equal(r.exitCode,1); assert.ok(!r.stdout.includes(TOKEN));
});
