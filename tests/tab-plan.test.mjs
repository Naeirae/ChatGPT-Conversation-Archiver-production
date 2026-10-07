import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMessageMap,
  buildTabbedSections,
  parseTabPlan,
  serializeTabPlan
} from '../lib/tab-plan.mjs';

test('parseTabPlan accepts Russian and reversed forms', () => {
  const events = parseTabPlan(
    [
      '4 | вкладка',
      '6 | подзаголовок | Картинки',
      'heading | 8 | Продолжение',
      'tab | 10'
    ].join('\n'),
    12
  );

  assert.deepEqual(events, [
    { type: 'tab', messageNumber: 4, lineNumber: 1 },
    { type: 'heading', messageNumber: 6, title: 'Картинки', lineNumber: 2 },
    { type: 'heading', messageNumber: 8, title: 'Продолжение', lineNumber: 3 },
    { type: 'tab', messageNumber: 10, lineNumber: 4 }
  ]);
});

test('parseTabPlan ignores first-tab marker and duplicate tab boundaries', () => {
  const events = parseTabPlan('1 | вкладка\n3 | вкладка\n3 | tab', 5);
  assert.deepEqual(events, [
    { type: 'tab', messageNumber: 3, lineNumber: 2 }
  ]);
});

test('buildTabbedSections decorates messages with headings and splits ranges', () => {
  const messages = Array.from({ length: 6 }, (_, index) => ({
    id: String(index + 1),
    role: index % 2 ? 'assistant' : 'user',
    text: 'm' + (index + 1)
  }));
  const events = parseTabPlan(
    '3 | вкладка\n4 | подзаголовок | Тема A\n5 | подзаголовок | Тема B',
    6
  );

  const sections = buildTabbedSections(messages, events);

  assert.equal(sections.length, 2);
  assert.deepEqual(
    sections.map(section => [section.startMessageNumber, section.endMessageNumber]),
    [[1, 2], [3, 6]]
  );
  assert.deepEqual(sections[1].messages[1].archiveHeadings, ['Тема A']);
  assert.deepEqual(sections[1].messages[2].archiveHeadings, ['Тема B']);
});

test('buildMessageMap includes role, number, and image-only marker', () => {
  const map = buildMessageMap([
    { role: 'user', text: 'Привет' },
    { role: 'assistant', text: '', images: [{ src: 'x' }] }
  ]);
  assert.match(map, /^1 · Пользователь · Привет/m);
  assert.match(map, /^2 · ChatGPT · \[изображение\]/m);
});


test('serializeTabPlan keeps tab before heading at the same message', () => {
  const text = serializeTabPlan([
    { type: 'heading', messageNumber: 7, title: 'Картинки' },
    { type: 'tab', messageNumber: 7 },
    { type: 'tab', messageNumber: 12 }
  ]);

  assert.equal(
    text,
    '7 | вкладка\n7 | подзаголовок | Картинки\n12 | вкладка'
  );
});


test('buildTabbedSections keeps a heading on the implicit first tab', () => {
  const messages = [
    { id: '1', role: 'user', text: 'm1' },
    { id: '2', role: 'assistant', text: 'm2' },
    { id: '3', role: 'user', text: 'm3' }
  ];
  const events = parseTabPlan(
    '1 | подзаголовок | Первая тема\n3 | вкладка\n3 | подзаголовок | Вторая тема',
    3
  );

  const sections = buildTabbedSections(messages, events);

  assert.equal(sections.length, 2);
  assert.deepEqual(sections[0].messages[0].archiveHeadings, ['Первая тема']);
  assert.deepEqual(sections[1].messages[0].archiveHeadings, ['Вторая тема']);
});


test('one implicit first tab plus every later tab marker defines the physical tab count', () => {
  const messages = Array.from({ length: 8 }, (_, index) => ({
    id: String(index + 1),
    role: index % 2 ? 'assistant' : 'user',
    text: 'm' + (index + 1)
  }));
  const events = parseTabPlan(
    '3 | вкладка\n5 | вкладка\n7 | вкладка',
    messages.length
  );

  const sections = buildTabbedSections(messages, events);
  const tabMarkers = events.filter(event => event.type === 'tab');

  assert.equal(sections.length, 1 + tabMarkers.length);
  assert.deepEqual(
    sections.map(section => section.startMessageNumber),
    [1, 3, 5, 7]
  );
});
