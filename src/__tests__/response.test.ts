import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { decode, encode } from '@toon-format/toon';
import { run } from '../index.ts';
import { Cleaner, serialize, toon } from '../output.ts';
import type { Output } from '../output.ts';

const token = 'xoxp-response-fixture';
const channel = {id:'C123',name:'general',is_private:false,is_im:false,is_mpim:false};
beforeEach(()=>{globalThis.fetch=async()=>{throw new Error('network denied');};});
function mock(responses:unknown[]) {
  globalThis.fetch=async()=>{
    assert.ok(responses.length,'unexpected request');
    return Response.json(responses.shift());
  };
}
test('official encoding preserves null, quotes ambiguous strings and heterogeneous rows',()=>{
  const data: Output = {null_value:null,strings:[{text:'-',value:'null'},{text:'01',value:'a,b\n\t"\\'}],rows:[{a:1},{b:2}]};
  assert.equal(toon(data),encode(data));
  assert.deepEqual(decode(serialize(data,false,new Cleaner(token)),{strict:true}),data);
  assert.throws(()=>serialize({x:'😀'.repeat(300_000)},false,new Cleaner(token)),/1 MiB/);
});
test('no arguments returns content with concrete next steps, not a help banner',async()=>{
  mock([{ok:true,team_id:'T123',team:'Example',user_id:'U123',user:'reader'}]);
  const result = await run([],{SLACK_AXI_TOKEN:token});
  const data = decode(result.stdout,{strict:true}) as any;
  assert.equal(result.exitCode,0);
  assert.equal(data.status.team_id,'T123');
  assert.deepEqual(data.help,['Run `slack-axi channel list`','Run `slack-axi search <query>`']);
});
test('empty collections are explicit and next steps preserve privacy flags',async()=>{
  for(const [args,responses,key] of [
    [['channel','list'],[{ok:true,channels:[]}],'channels'],
    [['channel','history','C123'],[{ok:true,channel},{ok:true,messages:[]}],'messages'],
    [['thread','replies','C123','123.000001'],[{ok:true,channel},{ok:true,messages:[]}],'messages'],
    [['search','hello'],[{ok:true,messages:{matches:[],paging:{page:1,pages:1}}}],'matches'],
  ] as const) {
    mock([...responses]);
    const r = await run([...args,'--include-private','--include-dms','--json'],{SLACK_AXI_TOKEN:token});
    const data = JSON.parse(r.stdout);
    assert.equal(r.exitCode,0);
    assert.deepEqual(data[key],[]);
    assert.equal(data.empty,'0 results on this page after filtering; continuation may still be available.');
    assert.ok(data.help.some((hint:string)=>hint.includes('--include-private --include-dms')));
  }
});
test('continuation hints use placeholders rather than echoing queries or cursors',async()=>{
  mock([{ok:true,messages:{matches:[],paging:{page:1,pages:9}}},...Array.from({length:4},(_,i)=>({ok:true,messages:{matches:[],paging:{page:i+2,pages:9}}}))]);
  const r = await run(['search',token,'--include-bots','--sort','timestamp','--sort-dir','asc','--json'],{SLACK_AXI_TOKEN:token});
  assert.ok(!r.stdout.includes(token));
  assert.ok(JSON.parse(r.stdout).help.includes('Run `slack-axi search <query> --page <next_page> --sort timestamp --sort-dir asc --include-bots`'));
});
test('cursor continuation hints retain privacy opt-ins without echoing the cursor',async()=>{
  for(const [args,responses,command] of [
    [['channel','list'],[{ok:true,channels:[],response_metadata:{next_cursor:'opaque'}}],'channel list'],
    [['channel','history','C123'],[{ok:true,channel},{ok:true,messages:[],response_metadata:{next_cursor:'opaque'}}],'channel history <id|name>'],
    [['thread','replies','C123','123.000001'],[{ok:true,channel},{ok:true,messages:[],response_metadata:{next_cursor:'opaque'}}],'thread replies <id|name> <ts>'],
  ] as const) {
    mock([...responses]);
    const result = await run([...args,'--include-private','--include-dms','--json'],{SLACK_AXI_TOKEN:token});
    assert.ok(JSON.parse(result.stdout).help.includes('Run `slack-axi '+command+' --cursor <next_cursor> --include-private --include-dms`'));
  }
});
test('truncation keeps size metadata and gives an honest bounded-output hint',async()=>{
  mock([{ok:true,channel},{ok:true,messages:[{ts:'123.000001',text:'a'.repeat(2001)}]}]);
  const r = await run(['channel','history','C123','--json'],{SLACK_AXI_TOKEN:token});
  const data = JSON.parse(r.stdout);
  assert.equal(data.truncation[0].original_code_points,2001);
  assert.equal(data.truncation[0].emitted_code_points,2000);
  assert.ok(data.help.includes('Text was clipped; inspect the source in Slack. --full is not supported; safety caps always apply.'));
});
test('structured errors offer help in both formats without changing exit codes',async()=>{
  for(const json of [false,true]) {
    const result = await run(['unknown',...(json?['--json']:[])],{});
    const data = json ? JSON.parse(result.stdout) : decode(result.stdout,{strict:true}) as any;
    assert.equal(result.exitCode,2);
    assert.equal(data.retry_after,null);
    assert.deepEqual(data.help,['Run `slack-axi --help`']);
  }
  assert.equal((await run(['status','--full'],{SLACK_AXI_TOKEN:token})).exitCode,2);
});
