import test from 'node:test';
import assert from 'node:assert/strict';

import {
  exportTailSignatures,
  findExportTailAnchor,
  messageSignature,
  normalizeDisplayText,
  normalizeMatchText
} from '../lib/text.mjs';

test('display normalization preserves meaningful paragraph breaks', () => {
  const input = '  Первый абзац  \r\n\r\n\r\nВторой\u00a0абзац  ';
  assert.equal(
    normalizeDisplayText(input),
    'Первый абзац\n\nВторой абзац'
  );
});

test('match normalization tolerates list formatting differences', () => {
  const a = '- Первый пункт\n- Второй пункт';
  const b = 'Первый пункт\nВторой пункт';
  assert.equal(normalizeMatchText(a), normalizeMatchText(b));
  assert.equal(messageSignature('assistant', a), messageSignature('assistant', b));
});

test('role remains part of the signature', () => {
  assert.notEqual(
    messageSignature('user', 'Одинаковый текст'),
    messageSignature('assistant', 'Одинаковый текст')
  );
});

test('tail anchor resolves after a local archive rebuild changes ids', () => {
  const messages = [
    { id: 'new-1', role: 'user', text: 'Начало разговора' },
    { id: 'new-2', role: 'assistant', text: 'Первый ответ' },
    { id: 'new-3', role: 'user', text: 'Последняя сохраненная реплика' },
    { id: 'new-4', role: 'assistant', text: 'Последний сохраненный ответ' },
    { id: 'new-5', role: 'user', text: 'Новое сообщение' }
  ];

  const exportedBefore = messages.slice(0, 4).map(({ role, text }, index) => ({
    id: 'old-' + index,
    role,
    text
  }));

  const tail = exportTailSignatures(exportedBefore, 4);
  assert.equal(findExportTailAnchor(messages, tail), 3);
});

test('tail anchor fails closed when only one signature remains', () => {
  const messages = [
    { role: 'user', text: 'Да' },
    { role: 'assistant', text: 'Окей' }
  ];
  assert.equal(
    findExportTailAnchor(messages, [messageSignature('assistant', 'Окей')]),
    -1
  );
});

test('tail anchor fails when the saved suffix is not present', () => {
  const current = [
    { role: 'user', text: 'A' },
    { role: 'assistant', text: 'B' },
    { role: 'user', text: 'C' }
  ];
  const other = [
    { role: 'user', text: 'X' },
    { role: 'assistant', text: 'Y' }
  ];
  assert.equal(
    findExportTailAnchor(current, exportTailSignatures(other)),
    -1
  );
});
