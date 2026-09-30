import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '@toon-format/toon';
import { run } from '../index.ts';

type Fixture = { name:string; args:string[]; responses:unknown[]; expected:Record<string,unknown>; exitCode:number };
const fixtures: Fixture[] = JSON.parse(readFileSync(new URL('./fixtures/commands.json',import.meta.url),'utf8'));
beforeEach(()=>{globalThis.fetch=async()=>{throw new Error('network denied');};});
function houseNulls(value:unknown): unknown {
  if(value===null) return '-';
  if(Array.isArray(value)) return value.map(houseNulls);
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,houseNulls(v)]));
  return value;
}
for(const f of fixtures) {
  test('authoritative JSON/TOON fixture: '+f.name,async()=>{
    for(const json of [false,true]) {
      const responses=[...f.responses];
      globalThis.fetch=async(input,init)=>{
        assert.equal(new URL(String(input)).origin,'https://slack.com');
        assert.equal(init!.method,'GET');
        assert.ok(responses.length);
        return Response.json(responses.shift());
      };
      const result=await run([...f.args,...(json ? ['--json'] : [])],{SLACK_AXI_TOKEN:'xoxp-fixture-secret'});
      assert.equal(result.exitCode,f.exitCode);
      assert.equal(responses.length,0);
      if(json) assert.deepEqual(JSON.parse(result.stdout),f.expected);
      else {
        assert.equal(result.stdout,readFileSync(new URL('./fixtures/'+f.name+'.toon',import.meta.url),'utf8'));
        assert.deepEqual(decode(result.stdout),houseNulls(f.expected));
      }
    }
  });
}
