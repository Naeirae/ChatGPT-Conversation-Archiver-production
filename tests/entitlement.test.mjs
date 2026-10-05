import test from 'node:test';
import assert from 'node:assert/strict';
import { FREE_SAVE_LIMIT, createEntitlementStore, shouldConsumeSuccessfulSave } from '../lib/entitlement.mjs';

function memoryStorage() {
  const data = {};
  return {
    async get(key) { return { [key]: data[key] }; },
    async set(patch) { Object.assign(data, patch); }
  };
}

test('free tier starts with five saves', async () => {
  const store = createEntitlementStore(memoryStorage());
  const status = await store.getStatus();
  assert.equal(status.freeLimit, FREE_SAVE_LIMIT);
  assert.equal(status.freeRemaining, 5);
  assert.equal(status.canCreate, true);
});

test('completed save consumes one credit only once', async () => {
  const store = createEntitlementStore(memoryStorage());
  await store.recordSuccessfulSave({ jobId: 'a', mode: 'full', messageCount: 10 });
  await store.recordSuccessfulSave({ jobId: 'a', mode: 'full', messageCount: 10 });
  const status = await store.getStatus();
  assert.equal(status.freeUsed, 1);
  assert.equal(status.freeRemaining, 4);
});

test('empty continuation does not consume credit', async () => {
  assert.equal(shouldConsumeSuccessfulSave({ mode: 'continue', addedCount: 0, messageCount: 20 }), false);
  const store = createEntitlementStore(memoryStorage());
  await store.recordSuccessfulSave({ jobId: 'b', mode: 'continue', addedCount: 0, messageCount: 20 });
  assert.equal((await store.getStatus()).freeUsed, 0);
});

test('sixth new save is blocked', async () => {
  const store = createEntitlementStore(memoryStorage());
  for (let i = 0; i < 5; i++) await store.recordSuccessfulSave({ jobId: 'j'+i, mode: 'full', messageCount: 1 });
  assert.equal((await store.getStatus()).canCreate, false);
  await assert.rejects(() => store.assertCanStart('full'), /Бесплатные сохранения закончились/);
});

test('compare and image recovery are not gated', async () => {
  const store = createEntitlementStore(memoryStorage());
  for (let i = 0; i < 5; i++) await store.recordSuccessfulSave({ jobId: 'j'+i, mode: 'full', messageCount: 1 });
  await assert.doesNotReject(() => store.assertCanStart('images'));
  await assert.doesNotReject(() => store.assertCanStart('compare'));
});
