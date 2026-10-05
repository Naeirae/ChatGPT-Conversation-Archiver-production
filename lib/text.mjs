export function hashText(text = '') {
  let hash = 2166136261;
  const value = String(text);
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function normalizeDisplayText(text = '') {
  return String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeMatchText(text = '') {
  return normalizeDisplayText(text)
    .split('\n')
    .map(line => line
      .replace(/^\s*(?:[-*•▪◦]|\d+[.)])\s+/u, '')
      .trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function messageSignature(role, text = '') {
  return String(role || 'unknown') + ':' + hashText(normalizeMatchText(text));
}

export function externalMatchSignature(role, text = '') {
  const normalized = normalizeMatchText(text);
  return String(role || 'unknown') + ':p:' + hashText(normalized.slice(0, 240));
}

export function exportTailSignatures(messages = [], limit = 4) {
  return messages
    .filter(item => normalizeMatchText(item?.text || ''))
    .slice(-limit)
    .map(item => messageSignature(item.role, item.text));
}

export function findExportTailAnchor(messages = [], tailSignatures = []) {
  const tail = (tailSignatures || []).filter(Boolean);
  if (tail.length < 2) return -1;

  const signatures = messages.map(item => messageSignature(item.role, item.text));
  for (let start = signatures.length - tail.length; start >= 0; start--) {
    let same = true;
    for (let offset = 0; offset < tail.length; offset++) {
      if (signatures[start + offset] !== tail[offset]) {
        same = false;
        break;
      }
    }
    if (same) return start + tail.length - 1;
  }
  return -1;
}
