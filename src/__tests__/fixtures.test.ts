import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '@toon-format/toon';
import { run } from '../index.ts';

type Fixture = { name:string; args:string[]; responses:unknown[]; expected:Record<string,unknown>; exitCode:number };
const fixtures: Fixture[] = JSON.parse(readFileSync(new URL('./fixtures/commands.json',import.meta.url),'utf8'));
beforeEach(()=>{globalThis.fetch=async()=>{throw new Error('network denied');};});
for(const f of fixtures) {
  test('authoritative JSON/TOON fixture: '+f.name,async()=>{
    let decoded: unknown;
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
      if(json) {
        const data = JSON.parse(result.stdout);
        assert.deepEqual(data,f.expected);
        assert.deepEqual(decoded,data);
      }
      else {
        decoded = decode(result.stdout,{strict:true});
        assert.deepEqual(decoded,f.expected);
        assert.equal(result.stdout,readFileSync(new URL('./fixtures/'+f.name+'.toon',import.meta.url),'utf8'));
      }
    }
  });
}
