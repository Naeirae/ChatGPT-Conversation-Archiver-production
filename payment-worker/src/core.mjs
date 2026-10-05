export const PRODUCT_ID = 'chatgpt-archiver';

export const PLANS = Object.freeze({
  monthly: Object.freeze({ id: 'monthly', amount: '249.00', days: 30, title: 'Архиватор ChatGPT — 30 дней' }),
  annual: Object.freeze({ id: 'annual', amount: '1790.00', days: 365, title: 'Архиватор ChatGPT — 1 год' }),
  lifetime: Object.freeze({ id: 'lifetime', amount: '3490.00', days: 0, title: 'Архиватор ChatGPT — бессрочная лицензия' })
});

export function normalizePlan(value = '') {
  const key = String(value || '').trim().toLowerCase();
  return PLANS[key] || null;
}

export function normalizeAmount(value = '') {
  const n = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(n) ? n.toFixed(2) : '';
}

export function sortedShp(params) {
  return [...params.entries()]
    .filter(([key]) => key.startsWith('Shp_'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + '=' + value);
}

export function checkoutSignatureBase({ merchantLogin, outSum, invId, password1, shp = [] }) {
  return [merchantLogin, outSum, invId, password1, ...shp].join(':');
}

export function resultSignatureBase({ outSum, invId, password2, shp = [] }) {
  return [outSum, invId, password2, ...shp].join(':');
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlText(value) {
  return base64Url(new TextEncoder().encode(value));
}

export async function issueLicenseToken({ privateJwk, plan, licenseId, issuedAt = new Date() }) {
  const selected = normalizePlan(plan);
  if (!selected) throw new Error('Unknown license plan.');
  const issued = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
  if (!Number.isFinite(issued.getTime())) throw new Error('Invalid issuedAt.');

  const payload = {
    v: 1,
    product: PRODUCT_ID,
    licenseId: String(licenseId || crypto.randomUUID()),
    plan: selected.id,
    issuedAt: issued.toISOString(),
    validUntil: selected.days ? new Date(issued.getTime() + selected.days * 86400000).toISOString() : ''
  };

  const body = base64UrlText(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'jwk',
    typeof privateJwk === 'string' ? JSON.parse(privateJwk) : privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(body)
  );

  return { token: body + '.' + base64Url(new Uint8Array(signature)), payload };
}
