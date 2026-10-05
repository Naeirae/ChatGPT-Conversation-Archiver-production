export const FREE_SAVE_LIMIT = 5;
export const ENTITLEMENT_STORAGE_KEY = 'archiverEntitlement';

const CREDITED_MODES = new Set(['full', 'continue', 'sync', 'resume-draft', 'retry-walk']);
const START_GATED_MODES = new Set(['full', 'continue', 'sync']);

function int(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function normalize(raw = {}) {
  return {
    freeUsed: int(raw.freeUsed),
    bonusCredits: int(raw.bonusCredits),
    creditedJobs: Array.isArray(raw.creditedJobs) ? raw.creditedJobs.filter(Boolean).slice(-100) : [],
    server: raw.server && typeof raw.server === 'object' ? raw.server : null,
    updatedAt: Number(raw.updatedAt || 0)
  };
}

function paidActive(server, now = Date.now()) {
  if (!server) return false;
  const status = String(server.licenseStatus || '');
  if (!['active', 'lifetime'].includes(status)) return false;
  if (status === 'lifetime' || !server.validUntil) return true;
  const until = Date.parse(server.validUntil);
  return Number.isFinite(until) && until > now;
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
    const paid = paidActive(state.server);
    const freeTotal = FREE_SAVE_LIMIT + state.bonusCredits;
    const freeRemaining = Math.max(0, freeTotal - state.freeUsed);
    return {
      plan: paid ? (state.server?.plan || 'paid') : 'free',
      licenseStatus: paid ? String(state.server?.licenseStatus || 'active') : 'free',
      paid,
      freeLimit: FREE_SAVE_LIMIT,
      bonusCredits: state.bonusCredits,
      freeUsed: state.freeUsed,
      freeTotal,
      freeRemaining,
      canCreate: paid || freeRemaining > 0,
      serverConnected: Boolean(state.server),
      validUntil: state.server?.validUntil || '',
      serverUpdatedAt: state.server?.updatedAt || ''
    };
  }

  async function assertCanStart(mode = '') {
    const status = await getStatus();
    if (!START_GATED_MODES.has(mode) || status.canCreate) return status;
    const error = new Error('Бесплатные сохранения закончились. Для нового сохранения нужна активная лицензия.');
    error.code = 'ENTITLEMENT_REQUIRED';
    throw error;
  }

  async function recordSuccessfulSave({ jobId = '', mode = '', addedCount = 0, messageCount = 0 } = {}) {
    if (!shouldConsumeSuccessfulSave({ mode, addedCount, messageCount })) return getStatus();
    const state = await read();
    const key = String(jobId || '').trim();
    if (key && state.creditedJobs.includes(key)) return getStatus();
    if (!paidActive(state.server)) state.freeUsed += 1;
    if (key) state.creditedJobs = [...state.creditedJobs, key].slice(-100);
    await write(state);
    return getStatus();
  }

  async function cacheServerSnapshot(snapshot = null) {
    const state = await read();
    state.server = snapshot && typeof snapshot === 'object' ? { ...snapshot } : null;
    await write(state);
    return getStatus();
  }

  return { getStatus, assertCanStart, recordSuccessfulSave, cacheServerSnapshot };
}
