function parsePositiveInt(value) {
  const parsed = Number(String(value || '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeType(value = '') {
  const type = String(value).trim().toLowerCase();
  if (['вкладка', 'tab'].includes(type)) return 'tab';
  if (['подзаголовок', 'заголовок', 'h2', 'heading'].includes(type)) return 'heading';
  return '';
}

function parsePlanLine(rawLine, lineNumber, messageCount) {
  const line = String(rawLine || '').trim();
  if (!line || line.startsWith('#')) return null;

  const parts = line.split('|').map(part => part.trim());
  if (parts.length < 2) {
    throw new Error(
      `Строка ${lineNumber}: используйте формат «41 | вкладка» или «57 | подзаголовок | Тема».`
    );
  }

  let index = parsePositiveInt(parts[0]);
  let type = normalizeType(parts[1]);
  let titleParts = parts.slice(2);

  if (!index || !type) {
    const reversedType = normalizeType(parts[0]);
    const reversedIndex = parsePositiveInt(parts[1]);
    if (reversedType && reversedIndex) {
      type = reversedType;
      index = reversedIndex;
      titleParts = parts.slice(2);
    }
  }

  if (!index || !type) {
    throw new Error(
      `Строка ${lineNumber}: не удалось определить номер сообщения и тип правила.`
    );
  }

  if (index < 1 || index > messageCount) {
    throw new Error(
      `Строка ${lineNumber}: сообщение ${index} вне диапазона 1–${messageCount}.`
    );
  }

  if (type === 'heading') {
    const title = titleParts.join(' | ').trim();
    if (!title) {
      throw new Error(
        `Строка ${lineNumber}: для подзаголовка нужен текст после второго «|».`
      );
    }
    return { type, messageNumber: index, title, lineNumber };
  }

  return { type, messageNumber: index, lineNumber };
}

export function parseTabPlan(text = '', messageCount = 0) {
  const count = Number(messageCount || 0);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('Для разбивки нужен непустой архив.');
  }

  const events = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line, index) => parsePlanLine(line, index + 1, count))
    .filter(Boolean);

  const seenTabs = new Set();
  const normalized = [];

  for (const event of events) {
    if (event.type === 'tab') {
      if (event.messageNumber === 1) continue;
      if (seenTabs.has(event.messageNumber)) continue;
      seenTabs.add(event.messageNumber);
    }
    normalized.push(event);
  }

  normalized.sort((a, b) => {
    if (a.messageNumber !== b.messageNumber) return a.messageNumber - b.messageNumber;
    if (a.type === b.type) return a.lineNumber - b.lineNumber;
    return a.type === 'tab' ? -1 : 1;
  });

  return normalized;
}

export function buildTabbedSections(messages = [], events = []) {
  const rows = Array.isArray(messages) ? messages : [];
  if (!rows.length) throw new Error('Архив пуст.');

  const tabStarts = new Set([1]);
  const headings = new Map();

  for (const event of events || []) {
    if (event?.type === 'tab') tabStarts.add(Number(event.messageNumber));
    if (event?.type === 'heading') {
      const key = Number(event.messageNumber);
      if (!headings.has(key)) headings.set(key, []);
      headings.get(key).push(String(event.title || '').trim());
    }
  }

  const starts = [...tabStarts]
    .filter(value => Number.isInteger(value) && value >= 1 && value <= rows.length)
    .sort((a, b) => a - b);

  const sections = [];
  for (let i = 0; i < starts.length; i++) {
    const startNumber = starts[i];
    const endNumber = i + 1 < starts.length ? starts[i + 1] - 1 : rows.length;
    const sectionMessages = rows
      .slice(startNumber - 1, endNumber)
      .map((message, offset) => {
        const messageNumber = startNumber + offset;
        const titles = headings.get(messageNumber) || [];
        return {
          ...message,
          archiveHeadings: titles
        };
      });

    sections.push({
      index: i,
      startMessageNumber: startNumber,
      endMessageNumber: endNumber,
      messages: sectionMessages
    });
  }

  return sections;
}

export function buildMessageMap(messages = [], { previewChars = 140 } = {}) {
  const limit = Math.max(40, Number(previewChars || 140));
  return (messages || []).map((message, index) => {
    const role = message?.role === 'user' ? 'Пользователь' : 'ChatGPT';
    const normalized = String(message?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    const preview = normalized
      ? normalized.slice(0, limit) + (normalized.length > limit ? '…' : '')
      : ((message?.images || []).length ? '[изображение]' : '[пустая реплика]');
    return `${index + 1} · ${role} · ${preview}`;
  }).join('\n');
}


export function serializeTabPlan(events = []) {
  const normalized = (events || [])
    .filter(event =>
      (event?.type === 'tab' || event?.type === 'heading') &&
      Number.isInteger(Number(event?.messageNumber)) &&
      Number(event.messageNumber) > 0
    )
    .map(event => ({
      type: event.type,
      messageNumber: Number(event.messageNumber),
      title: String(event.title || '').trim()
    }))
    .filter(event => event.type === 'tab' || event.title)
    .sort((a, b) => {
      if (a.messageNumber !== b.messageNumber) return a.messageNumber - b.messageNumber;
      if (a.type === b.type) return 0;
      return a.type === 'tab' ? -1 : 1;
    });

  return normalized.map(event =>
    event.type === 'tab'
      ? `${event.messageNumber} | вкладка`
      : `${event.messageNumber} | подзаголовок | ${event.title}`
  ).join('\n');
}
