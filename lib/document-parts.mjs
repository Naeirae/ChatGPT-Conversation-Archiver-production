export const DEFAULT_GOOGLE_DOC_CHAR_BUDGET = 850000;

function stripHtml(value = '') {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function estimateMessageChars(message = {}, headings = []) {
  const text = String(message?.text || '');
  const reasoning = stripHtml(message?.reasoningHtml || '');
  const headingChars = (headings || []).reduce((sum, title) => sum + String(title || '').length + 3, 0);
  const imageChars = Math.max(0, Number(message?.images?.length || 0)) * 40;
  // Speaker label, separators and paragraph breaks add a small fixed overhead.
  return text.length + reasoning.length + headingChars + imageChars + 32;
}

function normalizedEvents(events = [], messageCount = 0) {
  return (events || [])
    .filter(event => event && ['tab', 'heading'].includes(event.type))
    .map(event => ({
      ...event,
      messageNumber: Number(event.messageNumber),
      title: String(event.title || '').trim()
    }))
    .filter(event =>
      Number.isInteger(event.messageNumber) &&
      event.messageNumber >= 1 &&
      event.messageNumber <= messageCount
    )
    .sort((a, b) => {
      if (a.messageNumber !== b.messageNumber) return a.messageNumber - b.messageNumber;
      if (a.type === b.type) return 0;
      return a.type === 'tab' ? -1 : 1;
    });
}

function localizeEvents(events, startMessageNumber, endMessageNumber) {
  const offset = startMessageNumber - 1;
  return events
    .filter(event =>
      event.messageNumber >= startMessageNumber &&
      event.messageNumber <= endMessageNumber
    )
    .map(event => ({
      ...event,
      messageNumber: event.messageNumber - offset
    }))
    // A new Google Doc already has its first tab.
    .filter(event => !(event.type === 'tab' && event.messageNumber === 1));
}

export function planGoogleDocParts(
  messages = [],
  events = [],
  { maxChars = DEFAULT_GOOGLE_DOC_CHAR_BUDGET } = {}
) {
  const rows = Array.isArray(messages) ? messages : [];
  if (!rows.length) throw new Error('Архив пуст.');

  const budget = Number(maxChars);
  if (!Number.isFinite(budget) || budget < 1000) {
    throw new Error('Некорректный лимит размера Google Doc.');
  }

  const normalized = normalizedEvents(events, rows.length);
  const headingsByMessage = new Map();
  for (const event of normalized) {
    if (event.type !== 'heading') continue;
    if (!headingsByMessage.has(event.messageNumber)) headingsByMessage.set(event.messageNumber, []);
    headingsByMessage.get(event.messageNumber).push(event.title);
  }

  const ranges = [];
  let start = 1;
  let chars = 0;

  for (let messageNumber = 1; messageNumber <= rows.length; messageNumber++) {
    const nextChars = estimateMessageChars(
      rows[messageNumber - 1],
      headingsByMessage.get(messageNumber) || []
    );

    if (chars > 0 && chars + nextChars > budget) {
      ranges.push({
        startMessageNumber: start,
        endMessageNumber: messageNumber - 1,
        estimatedChars: chars
      });
      start = messageNumber;
      chars = 0;
    }

    chars += nextChars;
  }

  ranges.push({
    startMessageNumber: start,
    endMessageNumber: rows.length,
    estimatedChars: chars
  });

  return ranges.map((range, index) => ({
    index,
    partNumber: index + 1,
    ...range,
    messages: rows.slice(range.startMessageNumber - 1, range.endMessageNumber),
    events: localizeEvents(
      normalized,
      range.startMessageNumber,
      range.endMessageNumber
    )
  }));
}

export function partTitle(baseTitle = 'ChatGPT conversation', partNumber = 1, partCount = 1) {
  const title = String(baseTitle || 'ChatGPT conversation').trim() || 'ChatGPT conversation';
  if (partCount <= 1) return title;
  return title + ' — ' + Number(partNumber || 1);
}

export function documentBoundaryMessageNumbers(parts = []) {
  return (parts || [])
    .slice(1)
    .map(part => Number(part.startMessageNumber))
    .filter(Number.isInteger);
}
