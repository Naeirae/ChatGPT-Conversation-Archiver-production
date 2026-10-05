import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGoogleDocBaseline,
  googleDocMarkerRole,
  parseGoogleDocTabMessages
} from '../lib/google-docs-baseline.mjs';

test('recognizes plain and named speaker markers', () => {
  assert.equal(googleDocMarkerRole('Пользователь:'), 'user');
  assert.equal(googleDocMarkerRole('Пользователь / Най:'), 'user');
  assert.equal(googleDocMarkerRole('ChatGPT:'), 'assistant');
  assert.equal(googleDocMarkerRole('ChatGPT / Арден:'), 'assistant');
  assert.equal(googleDocMarkerRole('Раздел 1'), '');
});

test('old ChatGPT said label is ignored inside an assistant block', () => {
  const messages = parseGoogleDocTabMessages(
    [
      'Пользователь:',
      'Привет',
      'ChatGPT:',
      'ChatGPT сказал:',
      'Ответ'
    ].join('\n'),
    'https://docs.google.com/document/d/doc/edit?tab=t.0',
    0
  );

  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].text, 'Ответ');
});

test('multi-tab baseline is one chronological message sequence', () => {
  const tabs = [
    {
      index: 0,
      url: 'https://docs.google.com/document/d/doc/edit?tab=t.one',
      text: [
        'Раздел: начало',
        'Пользователь:',
        'Первое сообщение',
        'ChatGPT:',
        'Первый ответ'
      ].join('\n')
    },
    {
      index: 1,
      url: 'https://docs.google.com/document/d/doc/edit?tab=t.two',
      text: [
        'Пользователь:',
        'Второе сообщение',
        'ChatGPT:',
        'Второй ответ'
      ].join('\n')
    }
  ];

  const baseline = buildGoogleDocBaseline(tabs);

  assert.deepEqual(
    baseline.messages.map(item => item.role),
    ['user', 'assistant', 'user', 'assistant']
  );
  assert.equal(baseline.meaningfulCount, 4);
  assert.equal(
    baseline.targetTabUrl,
    'https://docs.google.com/document/d/doc/edit?tab=t.two'
  );
  assert.equal(baseline.tailSignatures.length, 4);
});

test('empty final document tab does not move the continuation target', () => {
  const tabs = [
    {
      index: 0,
      url: 'https://docs.google.com/document/d/doc/edit?tab=t.one',
      text: [
        'Пользователь:',
        'Сообщение',
        'ChatGPT:',
        'Ответ'
      ].join('\n')
    },
    {
      index: 1,
      url: 'https://docs.google.com/document/d/doc/edit?tab=t.empty',
      text: 'Заголовок пустого раздела'
    }
  ];

  const baseline = buildGoogleDocBaseline(tabs);

  assert.equal(baseline.meaningfulCount, 2);
  assert.equal(
    baseline.targetTabUrl,
    'https://docs.google.com/document/d/doc/edit?tab=t.one'
  );
});

test('tail may span the boundary between document tabs', () => {
  const tabs = [
    {
      index: 0,
      url: 'https://docs.google.com/document/d/doc/edit?tab=t.one',
      text: [
        'Пользователь:',
        'A',
        'ChatGPT:',
        'B',
        'Пользователь:',
        'C'
      ].join('\n')
    },
    {
      index: 1,
      url: 'https://docs.google.com/document/d/doc/edit?tab=t.two',
      text: [
        'ChatGPT:',
        'D'
      ].join('\n')
    }
  ];

  const baseline = buildGoogleDocBaseline(tabs, { tailLimit: 4 });

  assert.equal(baseline.tailSignatures.length, 4);
  assert.equal(baseline.messages[2].text, 'C');
  assert.equal(baseline.messages[3].text, 'D');
});


test('known exported heading does not contaminate previous message signature', () => {
  const baseline = buildGoogleDocBaseline([
    {
      index: 0,
      url: 'https://docs.google.com/document/d/doc/edit?tab=t.one',
      text: [
        'Пользователь:',
        'Первое сообщение',
        'ChatGPT:',
        'Первый ответ',
        'Новая тема',
        'Пользователь:',
        'Второе сообщение'
      ].join('\n')
    }
  ], {
    ignoredStandaloneLines: ['Новая тема']
  });

  assert.equal(baseline.messages.length, 3);
  assert.equal(baseline.messages[1].text, 'Первый ответ');
  assert.equal(baseline.messages[2].text, 'Второе сообщение');
});

test('known inter-document navigation labels are ignored inside message flow', () => {
  const messages = parseGoogleDocTabMessages(
    [
      'ChatGPT:',
      'Ответ',
      'Разговор — 2'
    ].join('\n'),
    'https://docs.google.com/document/d/doc/edit',
    0,
    { ignoredStandaloneLines: ['Разговор — 2'] }
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'Ответ');
});
