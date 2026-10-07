import { readFile } from 'node:fs/promises';
import { randomUUID, sign } from 'node:crypto';

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : '';
}

const keyPath = arg('key');
const plan = arg('plan');
const validUntil = arg('valid-until');
const days = Number(arg('days') || 0);
const licenseId = arg('id') || randomUUID();

if (!keyPath || !plan) {
  console.error('Usage: node scripts/license-tool.mjs --key /path/private-key.pem --plan monthly|annual|lifetime [--days N | --valid-until ISO] [--id ID]');
  process.exit(2);
}

if (!['monthly', 'annual', 'lifetime'].includes(plan)) {
  console.error('Unknown plan:', plan);
  process.exit(2);
}

let expiry = '';
if (plan !== 'lifetime') {
  if (validUntil) {
    const parsed = new Date(validUntil);
    if (!Number.isFinite(parsed.getTime())) {
      console.error('Invalid --valid-until date.');
      process.exit(2);
    }
    expiry = parsed.toISOString();
  } else if (days > 0) {
    expiry = new Date(Date.now() + days * 86400000).toISOString();
  } else {
    const defaultDays = plan === 'monthly' ? 30 : 365;
    expiry = new Date(Date.now() + defaultDays * 86400000).toISOString();
  }
}

const payload = {
  v: 1,
  product: 'chatgpt-archiver',
  licenseId,
  plan,
  issuedAt: new Date().toISOString(),
  validUntil: expiry
};

const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
const privateKey = await readFile(keyPath, 'utf8');
const signature = sign('sha256', Buffer.from(body), {
  key: privateKey,
  dsaEncoding: 'ieee-p1363'
}).toString('base64url');

console.log(body + '.' + signature);
