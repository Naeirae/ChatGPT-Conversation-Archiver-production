export const FREE_SAVE_LIMIT = 5;
export const ENTITLEMENT_STORAGE_KEY = 'archiverEntitlement';

export const LICENSE_PUBLIC_KEY_JWK = {"kty":"EC","x":"zYSsOq_h2kA__TNI5xJfwgLPZ3nftS9_RoeSpKx3oZ4","y":"VZZQcmg1m480fMnzcY9t7cmuX5bYw3zRgLzG-m7_Yqc","crv":"P-256"};

const CREDITED_MODES = new Set(['full', 'continue', 'sync', 'resume-draft', 'retry-walk']);
const START_GATED_MODES = new Set(['full', 'continue', 'sync']);
const PRODUCT_ID = 'chatgpt-archiver';

function int(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function normalize(raw = {}) {
  return {
    freeUsed: int(raw.freeUsed),
    creditedJobs: Array.isArray(raw.creditedJobs) ? raw.creditedJobs.filter(Boolean).slice(-100) : [],
    licenseToken: String(raw.licenseToken || ''),
    activatedAt: Number(raw.activatedAt || 0),
    updatedAt: Number(raw.updatedAt || 0)
  };
}

function base64UrlToBytes(value = '') {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function base64UrlToText(value = '') {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function verifyLicenseToken(token = '', now = Date.now()) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'format', payload: null };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlToText(parts[0]));
  } catch (_) {
    return { valid: false, reason: 'payload', payload: null };
  }

  if (payload?.v !== 1 || payload?.product !== PRODUCT_ID || !payload?.licenseId || !payload?.plan) {
    return { valid: false, reason: 'claims', payload: null };
  }

  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      LICENSE_PUBLIC_KEY_JWK,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64UrlToBytes(parts[1]),
      new TextEncoder().encode(parts[0])
    );
    if (!verified) return { valid: false, reason: 'signature', payload: null };
  } catch (_) {
    return { valid: false, reason: 'crypto', payload: null };
  }

  if (payload.validUntil) {
    const until = Date.parse(payload.validUntil);
    if (!Number.isFinite(until)) return { valid: false, reason: 'expiry', payload: null };
    if (until <= now) return { valid: false, expired: true, reason: 'expired', payload };
  }

  return { valid: true, expired: false, reason: '', payload };
}

export function shouldConsumeSuccessfulSave({ mode = '', addedCount = 0, messageCount = 0 } = {}) {
  if (!CREDITED_MODES.has(mode)) return false;
  if (mode === 'continue' || mode === 'sync') return int(addedCount) > 0;
  return int(messageCount) > 0;
}

export function createEntitlementStore(storage) {
  if (!storage?.get || !storage?.set) throw new Error('Storage adapter is required.');

  async function read() {
    const result = await storage.get(ENTITLEMENT_STORAGE_KEY);
    return normalize(result?.[ENTITLEMENT_STORAGE_KEY]);
  }

  async function write(state) {
    const next = { ...normalize(state), updatedAt: Date.now() };
    await storage.set({ [ENTITLEMENT_STORAGE_KEY]: next });
    return next;
  }

  async function getStatus() {
    const state = await read();
    const license = state.licenseToken ? await verifyLicenseToken(state.licenseToken) : { valid: false, payload: null };
    const paid = Boolean(license.valid);
    const freeRemaining = Math.max(0, FREE_SAVE_LIMIT - state.freeUsed);
    return {
      plan: paid ? String(license.payload?.plan || 'paid') : 'free',
      licenseStatus: paid ? 'active' : (license.expired ? 'expired' : 'free'),
      paid,
      freeLimit: FREE_SAVE_LIMIT,
      freeUsed: state.freeUsed,
      freeTotal: FREE_SAVE_LIMIT,
      freeRemaining,
      canCreate: paid || freeRemaining > 0,
      validUntil: license.payload?.validUntil || '',
      licenseId: paid ? String(license.payload?.licenseId || '') : '',
      licenseExpired: Boolean(license.expired),
      hasLicenseToken: Boolean(state.licenseToken)
    };
  }

  async function assertCanStart(mode = '') {
    const status = await getStatus();
    if (!START_GATED_MODES.has(mode) || status.canCreate) return status;
    const error = new Error(
      status.licenseExpired
        ? 'Срок лицензии закончился. Для нового сохранения активируйте новую лицензию.'
        : 'Пять бесплатных сохранений закончились. Для нового сохранения нужна лицензия.'
    );
    error.code = 'ENTITLEMENT_REQUIRED';
    throw error;
  }

  async function recordSuccessfulSave({ jobId = '', mode = '', addedCount = 0, messageCount = 0 } = {}) {
    if (!shouldConsumeSuccessfulSave({ mode, addedCount, messageCount })) return getStatus();
    const state = await read();
    const key = String(jobId || '').trim();
    if (key && state.creditedJobs.includes(key)) return getStatus();

    const license = state.licenseToken ? await verifyLicenseToken(state.licenseToken) : { valid: false };
    if (!license.valid) state.freeUsed += 1;
    if (key) state.creditedJobs = [...state.creditedJobs, key].slice(-100);
    await write(state);
    return getStatus();
  }

  async function activateLicense(token = '') {
    const normalizedToken = String(token || '').trim();
    const result = await verifyLicenseToken(normalizedToken);
    if (!result.valid) {
      const message = result.expired
        ? 'Срок этой лицензии уже закончился.'
        : 'Лицензионный ключ не прошёл проверку.';
      const error = new Error(message);
      error.code = result.expired ? 'LICENSE_EXPIRED' : 'LICENSE_INVALID';
      throw error;
    }

    const state = await read();
    state.licenseToken = normalizedToken;
    state.activatedAt = Date.now();
    await write(state);
    return getStatus();
  }

  async function clearLicense() {
    const state = await read();
    state.licenseToken = '';
    state.activatedAt = 0;
    await write(state);
    return getStatus();
  }

  return { getStatus, assertCanStart, recordSuccessfulSave, activateLicense, clearLicense };
}

export { verifyLicenseToken };
