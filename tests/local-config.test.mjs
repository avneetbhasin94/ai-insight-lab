import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLocalRuntime } from '../server/local-config.mjs';
import { createApplication } from '../server/application.mjs';

test('managed preview cannot pick up a provider or model key from its environment', () => {
  const result=getLocalRuntime([], {BALLDONTLIE_API_KEY:'synthetic-provider-key',OPENAI_API_KEY:'synthetic-model-key',AI_API_ENABLED:'true'});
  assert.deepEqual(result,{host:'0.0.0.0',bindings:{}});
});
test('explicit local mode binds to loopback and forwards only the NBA key', () => {
  const result=getLocalRuntime(['--use-local-nba-key'], {BALLDONTLIE_API_KEY:'  synthetic-provider-key  ',OPENAI_API_KEY:'synthetic-model-key',AI_API_ENABLED:'true',AI_SPENDING_APPROVED:'true'});
  assert.deepEqual(result,{host:'127.0.0.1',bindings:{BALLDONTLIE_API_KEY:'synthetic-provider-key'}});
});
test('blank local keys fail without echoing any other environment value', () => {
  assert.throws(()=>getLocalRuntime(['--use-local-nba-key'],{BALLDONTLIE_API_KEY:' ',OPENAI_API_KEY:'synthetic-model-key'}),/ignored .env.local/);
  assert.throws(()=>getLocalRuntime(null,{}),TypeError);
});
test('a local NBA key never appears in status output or enables model calls', async () => {
  const {bindings}=getLocalRuntime(['--use-local-nba-key'],{BALLDONTLIE_API_KEY:'synthetic-provider-key'});
  const response=await createApplication().fetch(new Request('http://127.0.0.1:4173/api/nba/status'),bindings);
  const text=await response.text();const status=JSON.parse(text);
  assert.equal(status.provider.configured,true);assert.equal(status.model.paidCallsEnabled,false);assert.ok(!text.includes('synthetic-provider-key'));
});
