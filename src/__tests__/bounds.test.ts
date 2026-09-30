import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../index.ts';
import { Cleaner, serialize } from '../output.ts';
import { request, validateUrl, TIMEOUT_MS } from '../transport.ts';
import { parse } from '../args.ts';
import { decode } from '@toon-format/toon';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const token='xoxp-boundary-secret';
const ch={id:'C123',name:'general',is_private:false,is_im:false,is_mpim:false};
const dm={id:'D123',is_private:true,is_im:true,is_mpim:false};
const mpim={...ch,id:'G123',name:'group',is_private:true,is_mpim:true};
const msg={ts:'123.000001',text:'hello'};
let urls:URL[]=[];
beforeEach(()=>{
  urls=[];
  globalThis.fetch=async()=>{throw new Error('default deny');};
});
function mocked(responses:unknown[]) {
  globalThis.fetch=async(input,init)=>{
    urls.push(new URL(String(input)));
    assert.equal(init!.method,'GET');
    assert.equal(init!.redirect,'manual');
    const response=responses.shift();
    assert.ok(response);
    return response instanceof Response ? response : Response.json(response);
  };
}
async function invoke(args:string[],responses:unknown[]) {
  mocked(responses);
  const r=await run([...args,'--json'],{SLACK_AXI_TOKEN:token});
  return {...r,data:JSON.parse(r.stdout)};
}
test('DM and group DM opt-in, independent of private-channel opt-in',async()=>{
  let r=await invoke(['channel','list','--include-dms'],[{ok:true,channels:[ch,dm,mpim]}]);
  assert.equal(r.exitCode,0); assert.equal(r.data.channels.length,3);
  assert.equal(r.data.channels[1].name,null);
  assert.equal(urls[0]!.searchParams.get('types'),'public_channel,im,mpim');
  for(const c of [dm,mpim]) {
    urls=[];
    r=await invoke(['channel','history',c.id],[{ok:true,channel:c}]);
    assert.equal(r.exitCode,1);assert.equal(urls.length,1);
    r=await invoke(['channel','history',c.id,'--include-dms'],[{ok:true,channel:c},{ok:true,messages:[msg]}]);
    assert.equal(r.exitCode,0);
    r=await invoke(['thread','replies',c.id,msg.ts,'--include-dms'],[{ok:true,channel:c},{ok:true,messages:[msg]}]);
    assert.equal(r.exitCode,0);
  }
  r=await invoke(['search','x','--include-dms'],[{ok:true,messages:{matches:[
    {...msg,type:'im',channel:dm},
    {...msg,type:'group',channel:mpim},
    {...msg,type:'group',channel:{...ch,is_private:true}},
  ],paging:{page:1,pages:1}}}]);
  assert.equal(r.data.matches.length,2);assert.equal(r.data.filtered,1);
});
test('parser arities, help validation, equals flags and literal dash query',()=>{
  assert.equal(parse(['search','--','-query']).positionals[0],'-query');
  assert.equal(parse(['channel','list','--limit=100']).limit,100);
  assert.equal(parse(['thread','replies','--help']).help,true);
  assert.throws(()=>parse(['thread','replies','C bad','--help']));
  assert.throws(()=>parse(['status','--include-dms']));
  for(const cursor of ['x'.repeat(2049),'x\u009b','\n']) assert.throws(()=>parse(['channel','list','--cursor='+cursor]));
});
test('per-invocation env and safe parse error echoes',async()=>{
  mocked([{ok:true,team_id:'T123',team:'team',user_id:'U123',user:'me'}]);
  assert.equal((await run([], {SLACK_AXI_TOKEN:token})).exitCode,0);
  assert.equal((await run([], {})).exitCode,1);
  const r=await run(['status','--json='+token],{SLACK_AXI_TOKEN:token});
  assert.equal(r.exitCode,2);assert.ok(!r.stdout.includes(token));assert.match(r.stdout,/^error:/);
});
test('name lookup completes scan including empty pages, rejects ambiguity/budget',async()=>{
  let r=await invoke(['channel','history','#general'],[
    {ok:true,channels:[],response_metadata:{next_cursor:'a'}},
    {ok:true,channels:[ch]}, {ok:true,channel:ch}, {ok:true,messages:[msg]}
  ]);
  assert.equal(r.exitCode,0);assert.equal(urls.length,4);
  assert.equal(urls[1]!.searchParams.get('cursor'),'a');
  assert.equal(urls[0]!.searchParams.get('limit'),'100');
  r=await invoke(['channel','history','general'],[{ok:true,channels:[ch,{...ch,id:'C234'}]}]);
  assert.equal(r.exitCode,1);assert.equal(r.data.code,'lookup');
  r=await invoke(['channel','history','general'],Array.from({length:10},()=>({ok:true,channels:[ch],response_metadata:{next_cursor:'more'}})));
  assert.equal(r.data.code,'lookup_budget');
});
test('explicit archived IDs, continuation reply order and timestamp strings',async()=>{
  const r=await invoke(['thread','replies','C123','000123.000001','--cursor','slice'],[
    {ok:true,channel:{...ch,is_archived:true}},
    {ok:true,messages:[{...msg,ts:'000124.000001'},{...msg,ts:'000125.000002'}],response_metadata:{next_cursor:'more'}}
  ]);
  assert.equal(r.exitCode,0);assert.equal(r.data.messages[0].ts,'000124.000001');
  assert.equal(urls[1]!.searchParams.get('ts'),'000123.000001');
});
test('malformed response schemas fail closed',async()=>{
  for(const response of [
    {ok:true,messages:{matches:[{...msg,type:'message',channel:{id:'C123',name:'general',is_mpim:false}}],paging:{page:1,pages:1}}},
    {ok:true,messages:{matches:[{...msg,type:'group',channel:ch}],paging:{page:1,pages:1}}},
    {ok:true,messages:{matches:'bad',paging:{page:1,pages:1}}},
    {ok:true,messages:{matches:[],paging:{page:'1',pages:1}}},
  ]) {
    const r=await invoke(['search','x'],[response]);assert.equal(r.exitCode,1);
  }
  for(const bad of [{...msg,text:3},{...msg,reply_count:'2'},{...msg,thread_ts:1}]) {
    const r=await invoke(['channel','history','C123'],[{ok:true,channel:ch},{ok:true,messages:[bad]}]);
    assert.equal(r.exitCode,1);
  }
});
test('output cap fails before any oversized serialized result is returned',async()=>{
  assert.throws(()=>serialize({x:'😀'.repeat(300_000)},true,new Cleaner(token)),/1 MiB/);
  const rows=Array.from({length:100},()=>({...msg,text:'😀'.repeat(2000),type:'message',channel:ch,permalink:'😀'.repeat(2048)}));
  const r=await invoke(['search','x','--limit','100'],[{ok:true,messages:{matches:rows,paging:{page:1,pages:1}}}]);
  assert.equal(r.exitCode,1);assert.equal(r.data.code,'output_limit');
  assert.ok(Buffer.byteLength(r.stdout)<1024);
});
test('timeout policy signals abort, GET allowlist and response streaming cap',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  globalThis.fetch=async(_input,init)=>new Promise((_resolve,reject)=>{
    assert.equal(init!.method,'GET');
    init!.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
  });
  const waiting=run(['status','--json'],{SLACK_AXI_TOKEN:token});
  t.mock.timers.tick(TIMEOUT_MS);
  const timed=await waiting;
  assert.equal(JSON.parse(timed.stdout).code,'timeout');
  t.mock.timers.reset();
  let canceled=false;
  const stream=new ReadableStream<Uint8Array>({
    pull(controller){controller.enqueue(new Uint8Array(1024*1024));},
    cancel(){canceled=true;}
  });
  const r=await invoke(['status'],[new Response(stream)]);
  assert.equal(r.data.code,'response_limit');assert.equal(canceled,true);
  validateUrl(new URL('https://slack.com:443/api/auth.test'));
  await assert.rejects(()=>request('users.info',{user:'U123',cookies:'bad'},token));
});
test('uniform scalar sanitation and token-redaction before clipping',async()=>{
  const dirty='a\u001b[31m\u009bb';
  const r=await invoke(['user','U123'],[{ok:true,user:{id:'U123',name:dirty,real_name:'z'.repeat(195)+token,title:'ignored',profile:{display_name:dirty,title:dirty},tz:dirty}}]);
  assert.equal(r.exitCode,0);
  for(const field of ['name','display_name','title','tz']) assert.equal(r.data.user[field],'a[31mb');
  assert.ok(!r.stdout.includes('xoxp-'));assert.equal(r.data.user.real_name.length,200);
  assert.equal(r.data.truncation.length,1);
});
test('launcher load failures are structured stdout without exception details',()=>{
  const dir=mkdtempSync(join(process.cwd(),'.test-launch-'));
  try {
    mkdirSync(join(dir,'bin'));
    const launcher=join(dir,'bin','slack-axi.mjs');
    const deny='data:text/javascript,'+encodeURIComponent('globalThis.fetch=async()=>{throw new Error("network denied");};');
    copyFileSync(new URL('../../bin/slack-axi',import.meta.url),launcher);
    const r=spawnSync(process.execPath,['--import',deny,launcher,'--json'],{encoding:'utf8',env:{SLACK_AXI_TOKEN:token}});
    assert.equal(r.status,1);assert.equal(r.stderr,'');assert.equal(JSON.parse(r.stdout).code,'load');
    assert.ok(!r.stdout.includes(token));
    const toon=spawnSync(process.execPath,['--import',deny,launcher,'--json='+token],{encoding:'utf8',env:{SLACK_AXI_TOKEN:token}});
    assert.equal(toon.status,1);assert.match(toon.stdout,/^error:/);assert.equal(toon.stderr,'');
    assert.deepEqual(decode(toon.stdout,{strict:true}),JSON.parse(r.stdout));
  } finally { rmSync(dir,{recursive:true}); }
});
