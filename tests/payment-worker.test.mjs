import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, checkoutSignatureBase, normalizeAmount, normalizePlan, resultSignatureBase, sortedShp } from '../payment-worker/src/core.mjs';

test('payment plans keep production prices and terms', () => {
  assert.equal(PLANS.monthly.amount, '249.00');
  assert.equal(PLANS.monthly.days, 30);
  assert.equal(PLANS.annual.amount, '1790.00');
  assert.equal(PLANS.annual.days, 365);
  assert.equal(PLANS.lifetime.amount, '3490.00');
  assert.equal(PLANS.lifetime.days, 0);
});
test('unknown payment plan is rejected', () => assert.equal(normalizePlan('other'), null));
test('amount normalization tolerates Robokassa decimal formatting', () => {
  assert.equal(normalizeAmount('249'), '249.00');
  assert.equal(normalizeAmount('249.000000'), '249.00');
  assert.equal(normalizeAmount('249,00'), '249.00');
});
test('Shp parameters are sorted alphabetically for signatures', () => {
  const params = new URLSearchParams('Shp_plan=annual&OutSum=1&Shp_order=abc');
  assert.deepEqual(sortedShp(params), ['Shp_order=abc', 'Shp_plan=annual']);
});
test('checkout and result signature bases follow Robokassa order', () => {
  const shp = ['Shp_order=abc', 'Shp_plan=monthly'];
  assert.equal(checkoutSignatureBase({ merchantLogin: 'shop', outSum: '249.00', invId: '123', password1: 'p1', shp }), 'shop:249.00:123:p1:Shp_order=abc:Shp_plan=monthly');
  assert.equal(resultSignatureBase({ outSum: '249.000000', invId: '123', password2: 'p2', shp }), '249.000000:123:p2:Shp_order=abc:Shp_plan=monthly');
});
