export function parseUrl(url = '') {
  try {
    return new URL(url);
  } catch (_) {
    return null;
  }
}

export function isChatGptHost(url = '') {
  const parsed = parseUrl(url);
  return Boolean(
    parsed &&
    parsed.protocol === 'https:' &&
    (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com')
  );
}

export function isConversationUrl(url = '') {
  const parsed = parseUrl(url);
  if (!parsed || !isChatGptHost(url)) return false;
  if (/(?:^|\/)c\/[^/]+(?:\/|$)/.test(parsed.pathname)) return true;
  return Boolean(parsed.searchParams.get('conversationId'));
}

export function conversationKey(url = '') {
  const parsed = parseUrl(url);
  if (!parsed || !isChatGptHost(url)) return '';
  const match = parsed.pathname.match(/(?:^|\/)c\/([^/]+)(?:\/|$)/);
  const id = match?.[1] || parsed.searchParams.get('conversationId') || '';
  return id ? parsed.hostname + ':' + id : '';
}

export function googleDocKey(url = '') {
  const parsed = parseUrl(url);
  if (!parsed || parsed.hostname !== 'docs.google.com') return '';
  const match = parsed.pathname.match(/\/document\/d\/([^/]+)/);
  return match?.[1] || '';
}

export function googleDocTabToken(url = '') {
  const parsed = parseUrl(url);
  if (!parsed) return '';
  return parsed.searchParams.get('tab') || 't.0';
}

export function unseenGoogleDocTabToken(url = '', seenTokens = []) {
  const token = googleDocTabToken(url);
  if (!token) return '';
  const seen = seenTokens instanceof Set ? seenTokens : new Set(seenTokens || []);
  return seen.has(token) ? '' : token;
}

export function normalizeGoogleDocUrl(url = '') {
  const parsed = parseUrl(String(url).trim());
  if (!parsed || parsed.protocol !== 'https:' || parsed.hostname !== 'docs.google.com') return '';
  return googleDocKey(parsed.href) ? parsed.href : '';
}
