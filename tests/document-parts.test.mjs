import test from 'node:test';
import assert from 'node:assert/strict';

import {
  documentBoundaryMessageNumbers,
  estimateMessageChars,
  partTitle,
  planGoogleDocParts
} from '../lib/document-parts.mjs';

function msg(text) {
  return { role: 'user', text };
}

test('planGoogleDocParts keeps a small archive in one document', () => {
  const parts = planGoogleDocParts([msg('a'), msg('b')], [], { maxChars: 1000 });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].startMessageNumber, 1);
  assert.equal(parts[0].endMessageNumber, 2);
});

test('planGoogleDocParts splits before a message that would exceed the budget', () => {
  const parts = planGoogleDocParts(
    [msg('a'.repeat(600)), msg('b'.repeat(600)), msg('c'.repeat(100))],
    [],
    { maxChars: 1000 }
  );
  assert.equal(parts.length, 2);
  assert.deepEqual(
    parts.map(part => [part.startMessageNumber, part.endMessageNumber]),
    [[1, 1], [2, 3]]
  );
});

test('document split localizes tab and heading events and resets first tab', () => {
  const messages = [msg('a'.repeat(600)), msg('b'.repeat(600)), msg('c')];
  const events = [
    { type: 'tab', messageNumber: 2, title: '' },
    { type: 'heading', messageNumber: 2, title: 'Вторая часть' },
    { type: 'tab', messageNumber: 3 }
  ];
  const parts = planGoogleDocParts(messages, events, { maxChars: 1000 });

  assert.equal(parts.length, 2);
  assert.deepEqual(parts[1].events, [
    { type: 'heading', messageNumber: 1, title: 'Вторая часть' },
    { type: 'tab', messageNumber: 2, title: '' }
  ]);
});

test('documentBoundaryMessageNumbers exposes starts of later docs for planner', () => {
  const parts = planGoogleDocParts(
    [msg('a'.repeat(600)), msg('b'.repeat(600)), msg('c'.repeat(600))],
    [],
    { maxChars: 1000 }
  );
  assert.deepEqual(documentBoundaryMessageNumbers(parts), [2, 3]);
});

test('partTitle numbers only multi-document chains', () => {
  assert.equal(partTitle('Тема', 1, 1), 'Тема');
  assert.equal(partTitle('Тема', 1, 3), 'Тема — 1');
  assert.equal(partTitle('Тема', 2, 3), 'Тема — 2');
});

test('estimateMessageChars includes reasoning, headings and images', () => {
  const plain = estimateMessageChars({ text: 'abc' });
  const rich = estimateMessageChars(
    { text: 'abc', reasoningHtml: '<p>reason</p>', images: [{}, {}] },
    ['Заголовок']
  );
  assert.ok(rich > plain + 80);
});
