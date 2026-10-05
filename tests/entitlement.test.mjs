import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_SAVE_LIMIT,
  createEntitlementStore,
  shouldConsumeSuccessfulSave,
  verifyLicenseToken
} from '../lib/entitlement.mjs';

const EXPIRED_SIGNED_TOKEN = 'eyJ2IjoxLCJwcm9kdWN0IjoiY2hhdGdwdC1hcmNoaXZlciIsImxpY2Vuc2VJZCI6InRlc3QtZXhwaXJlZCIsInBsYW4iOiJtb250aGx5IiwiaXNzdWVkQXQiOiIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJ2YWxpZFVudGlsIjoiMjAyNi0wMS0zMVQyMzo1OTo1OS4wMDBaIn0.zgr03jvEn5ScOkVOQonvxm58mGhmHeRxQaFKXU_j7C2m_Ps2aLaAv0mqFWidb0EUxs0zPS846ySrWRmOyqyiDQ';

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
  assert.equal(status.paid, false);
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
  for (let i = 0; i < 5; i++) {
    await store.recordSuccessfulSave({ jobId: 'j' + i, mode: 'full', messageCount: 1 });
  }
  assert.equal((await store.getStatus()).canCreate, false);
  await assert.rejects(() => store.assertCanStart('full'), /Пять бесплатных сохранений закончились/);
});

test('compare and image recovery are not gated', async () => {
  const store = createEntitlementStore(memoryStorage());
  for (let i = 0; i < 5; i++) {
    await store.recordSuccessfulSave({ jobId: 'j' + i, mode: 'full', messageCount: 1 });
  }
  await assert.doesNotReject(() => store.assertCanStart('images'));
  await assert.doesNotReject(() => store.assertCanStart('compare'));
});

test('signed but expired license is recognized and rejected', async () => {
  const result = await verifyLicenseToken(EXPIRED_SIGNED_TOKEN, Date.parse('2026-02-01T00:00:00.000Z'));
  assert.equal(result.valid, false);
  assert.equal(result.expired, true);
  assert.equal(result.payload?.licenseId, 'test-expired');

  const store = createEntitlementStore(memoryStorage());
  await assert.rejects(() => store.activateLicense(EXPIRED_SIGNED_TOKEN), /Срок этой лицензии уже закончился/);
});

test('tampered license is rejected', async () => {
  const tampered = EXPIRED_SIGNED_TOKEN.replace('test', 'best');
  const result = await verifyLicenseToken(tampered);
  assert.equal(result.valid, false);
});
