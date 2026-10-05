import {
  externalMatchSignature,
  hashText,
  messageSignature,
  normalizeDisplayText,
  normalizeMatchText
} from './text.mjs';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function googleDocMarkerRole(line = '') {
  const value = normalizeMatchText(line);
  if (/^Пользователь(?:\s*\/\s*[^:]+)?:$/i.test(value)) return 'user';
  if (/^ChatGPT(?:\s*\/\s*[^:]+)?:$/i.test(value)) return 'assistant';
  return '';
}

export function plainMessageHtml(text = '') {
  return normalizeDisplayText(text)
    .split(/\n{2,}/)
    .map(part => '<p>' + escapeHtml(part).replace(/\n/g, '<br>') + '</p>')
    .join('');
}

export function parseGoogleDocTabMessages(
  text = '',
  tabUrl = '',
  tabIndex = 0,
  { ignoredStandaloneLines = [] } = {}
) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const ignored = new Set(
    (ignoredStandaloneLines || [])
      .map(value => normalizeMatchText(value))
      .filter(Boolean)
  );
  const messages = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const body = normalizeDisplayText(current.lines.join('\n'));
    messages.push({
      id:
        'doc:' +
        tabIndex +
        ':' +
        messages.length +
        ':' +
        hashText(messageSignature(current.role, body)),
      role: current.role,
      text: body,
      html: plainMessageHtml(body),
      images: [],
      reasoningHtml: '',
      reasoningText: '',
      reasoningLabel: '',
      reasoningCount: 0,
      baselineTabUrl: tabUrl
    });
    current = null;
  };

  for (const raw of lines) {
    const line = normalizeMatchText(raw);
    const role = googleDocMarkerRole(line);

    if (role) {
      flush();
      current = { role, lines: [] };
      continue;
    }

    if (!current) continue;
    if (/^ChatGPT сказал:$/i.test(line) || /^ChatGPT said:$/i.test(line)) continue;
    if (ignored.has(line)) continue;
    current.lines.push(raw);
  }

  flush();
  return messages;
}

export function buildGoogleDocBaseline(
  tabs = [],
  { tailLimit = 6, ignoredStandaloneLines = [] } = {}
) {
  const messages = [];

  for (const item of tabs) {
    messages.push(
      ...parseGoogleDocTabMessages(
        item?.text || '',
        item?.url || '',
        Number(item?.index || 0),
        { ignoredStandaloneLines }
      )
    );
  }

  const meaningful = messages.filter(item => normalizeMatchText(item.text));
  const tail = meaningful.slice(-Math.max(2, tailLimit));
  const target = tail[tail.length - 1] || null;

  return {
    messages,
    meaningfulCount: meaningful.length,
    tailSignatures: tail.map(item =>
      externalMatchSignature(item.role, item.text)
    ),
    targetTabUrl:
      target?.baselineTabUrl ||
      tabs[tabs.length - 1]?.url ||
      ''
  };
}
