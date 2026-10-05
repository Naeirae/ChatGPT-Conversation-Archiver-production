import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createArchiveStore,
  STORAGE_KEYS,
  summarizeArchive
} from '../lib/archive-store.mjs';

function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    async get(keys) {
      if (typeof keys === 'string') return { [keys]: data[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map(key => [key, data[key]]));
      }
      return structuredClone(data);
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(key) {
      delete data[key];
    },
    snapshot() {
      return structuredClone(data);
    }
  };
}

test('summarizeArchive exposes stable UI metadata only', () => {
  const summary = summarizeArchive({
    id: 'a1',
    title: 'Chat',
    sourceUrl: 'https://chatgpt.com/c/abc',
    capturedAt: '2026-10-01T00:00:00Z',
    messages: [{ id: 'm1' }, { id: 'm2' }],
    imageCount: 3,
    imageBinaryReady: 2,
    imageBinaryFailed: 1,
    reasoningMessageCount: 1,
    reasoningBlockCount: 2,
    lastCaptureMode: 'continue',
    lastCaptureAddedCount: 1
  });

  assert.equal(summary.messageCount, 2);
  assert.equal(summary.lastMessageId, 'm2');
  assert.equal(summary.imageBinaryReady, 2);
  assert.equal(summary.reasoningMessageCount, 1);
  assert.equal(summary.reasoningBlockCount, 2);
  assert.equal('messages' in summary, false);
});

test('archive index resolves the canonical archive for a conversation URL', async () => {
  const storage = fakeStorage();
  const store = createArchiveStore(storage);
  const archive = {
    id: 'archive-1',
    sourceUrl: 'https://chatgpt.com/g/tool/c/conv-1',
    messages: []
  };

  await store.putArchive(archive);
  await store.indexArchive(archive);

  assert.deepEqual(
    await store.getArchiveForUrl('https://chatgpt.com/c/conv-1'),
    archive
  );
});

test('legacy doc export mapping is recovered into linked-doc state', async () => {
  const storage = fakeStorage({
    [STORAGE_KEYS.docExports]: {
      'doc-1': {
        conversationKey: 'chatgpt.com:conv-1',
        lastMessageId: 'm9'
      }
    }
  });
  const store = createArchiveStore(storage, { now: () => 123 });

  const linked = await store.getLinkedDoc('https://chatgpt.com/c/conv-1');

  assert.equal(linked.docId, 'doc-1');
  assert.equal(linked.lastMessageId, 'm9');
  assert.equal(linked.recoveredFromLegacyExport, true);
  assert.equal(linked.updatedAt, 123);

  const snapshot = storage.snapshot();
  assert.equal(
    snapshot[STORAGE_KEYS.docLinks]['chatgpt.com:conv-1'].docId,
    'doc-1'
  );
});

test('recordDocExport stores a multi-message tail for duplicate-safe continuation', async () => {
  const storage = fakeStorage();
  const store = createArchiveStore(storage, { now: () => 456 });
  const conversation = {
    id: 'archive-2',
    sourceUrl: 'https://chatgpt.com/c/conv-2',
    messages: [
      { id: 'm1', role: 'user', text: 'Один' },
      { id: 'm2', role: 'assistant', text: 'Два' },
      { id: 'm3', role: 'user', text: 'Три' }
    ]
  };

  const linked = await store.recordDocExport(
    conversation,
    'https://docs.google.com/document/d/doc-2/edit?tab=t.abc'
  );

  assert.equal(linked.docId, 'doc-2');
  assert.equal(linked.lastMessageId, 'm3');
  assert.equal(linked.tailSignatures.length, 3);

  const saved = await store.getDocExport('doc-2');
  assert.equal(saved.archiveId, 'archive-2');
  assert.equal(saved.updatedAt, 456);
  assert.equal(saved.tailSignatures.length, 3);
});

test('one-off doc export records target without replacing canonical link', async () => {
  const storage = fakeStorage();
  const store = createArchiveStore(storage, { now: () => 789 });
  const conversation = {
    id: 'archive-3',
    sourceUrl: 'https://chatgpt.com/c/conv-3',
    messages: [
      { id: 'm1', role: 'user', text: 'Один' },
      { id: 'm2', role: 'assistant', text: 'Два' }
    ]
  };

  await store.recordDocExport(
    conversation,
    'https://docs.google.com/document/d/doc-primary/edit'
  );

  const oneOff = await store.recordDocExport(
    conversation,
    'https://docs.google.com/document/d/doc-other/edit',
    { link: false }
  );

  assert.equal(oneOff.docId, 'doc-other');
  assert.equal(oneOff.linked, false);
  assert.equal((await store.getDocExport('doc-other')).linkEligible, false);

  const linked = await store.getLinkedDoc(conversation.sourceUrl);
  assert.equal(linked.docId, 'doc-primary');
});

test('one-off doc export never becomes the recovered canonical link', async () => {
  const storage = fakeStorage();
  const store = createArchiveStore(storage);
  const conversation = {
    id: 'archive-4',
    sourceUrl: 'https://chatgpt.com/c/conv-4',
    messages: [{ id: 'm1', role: 'user', text: 'Один' }]
  };

  await store.recordDocExport(
    conversation,
    'https://docs.google.com/document/d/doc-once/edit',
    { link: false }
  );

  assert.equal(await store.getLinkedDoc(conversation.sourceUrl), null);
  assert.equal((await store.getDocExport('doc-once')).linkEligible, false);
});

test('temporary archives can be removed without touching other state', async () => {
  const storage = fakeStorage({
    [STORAGE_KEYS.archivePrefix + 'temp']: { id: 'temp' },
    [STORAGE_KEYS.archivePrefix + 'good']: { id: 'good' }
  });
  const store = createArchiveStore(storage);

  await store.removeArchive('temp');

  assert.equal(await store.getArchive('temp'), null);
  assert.equal((await store.getArchive('good')).id, 'good');
});


test('deleteArchive clears canonical index and last pointer without touching linked-doc state', async () => {
  const storage = fakeStorage({
    [STORAGE_KEYS.lastArchiveId]: 'bad',
    [STORAGE_KEYS.archiveIndex]: {
      'chatgpt.com:conv-bad': 'bad',
      'chatgpt.com:conv-good': 'good'
    },
    [STORAGE_KEYS.archivePrefix + 'bad']: {
      id: 'bad',
      sourceUrl: 'https://chatgpt.com/c/conv-bad'
    },
    [STORAGE_KEYS.archivePrefix + 'good']: {
      id: 'good',
      sourceUrl: 'https://chatgpt.com/c/conv-good'
    },
    [STORAGE_KEYS.docLinks]: {
      'chatgpt.com:conv-bad': {
        url: 'https://docs.google.com/document/d/doc/edit'
      }
    }
  });
  const store = createArchiveStore(storage);

  await store.deleteArchive('bad');

  const snapshot = storage.snapshot();
  assert.equal(snapshot[STORAGE_KEYS.archivePrefix + 'bad'], undefined);
  assert.equal(snapshot[STORAGE_KEYS.lastArchiveId], undefined);
  assert.equal(snapshot[STORAGE_KEYS.archiveIndex]['chatgpt.com:conv-bad'], undefined);
  assert.equal(snapshot[STORAGE_KEYS.archiveIndex]['chatgpt.com:conv-good'], 'good');
  assert.equal(snapshot[STORAGE_KEYS.docLinks]['chatgpt.com:conv-bad'].url, 'https://docs.google.com/document/d/doc/edit');
});

test('removeDraft deletes only the selected draft', async () => {
  const storage = fakeStorage({
    [STORAGE_KEYS.draftPrefix + 'd1']: { id: 'd1' },
    [STORAGE_KEYS.draftPrefix + 'd2']: { id: 'd2' }
  });
  const store = createArchiveStore(storage);

  await store.removeDraft('d1');

  assert.equal(await store.getDraft('d1'), null);
  assert.equal((await store.getDraft('d2')).id, 'd2');
});


test('listDrafts returns saved unfinished-pass payloads newest first', async () => {
  const storage = fakeStorage({
    [STORAGE_KEYS.draftPrefix + 'old']: {
      id: 'old',
      capturedAt: '2026-10-01T10:00:00Z',
      messages: [{ id: 'm1' }]
    },
    [STORAGE_KEYS.draftPrefix + 'new']: {
      id: 'new',
      capturedAt: '2026-10-02T10:00:00Z',
      messages: [{ id: 'm1' }, { id: 'm2' }]
    },
    unrelated: { id: 'ignore' }
  });
  const store = createArchiveStore(storage);

  const passes = await store.listDrafts();

  assert.deepEqual(passes.map(item => item.id), ['new', 'old']);
  assert.equal(passes[0].messages.length, 2);
});
