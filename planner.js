import {
  parseTabPlan,
  serializeTabPlan
} from './lib/tab-plan.mjs';

import {
  documentBoundaryMessageNumbers,
  planGoogleDocParts
} from './lib/document-parts.mjs';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const requestedArchiveId = params.get('archiveId') || '';
const PLAN_PREFIX = 'tabMarkers:';

let archive = null;
let markers = [];
let saveTimer = null;
let documentParts = [];

function setStatus(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function roleLabel(role) {
  return role === 'user' ? 'Пользователь' : 'ChatGPT';
}

function markerFor(type, messageNumber) {
  return markers.find(item => item.type === type && item.messageNumber === messageNumber) || null;
}

function updateMarkerSummary() {
  const headings = markers.filter(item => item.type === 'heading').length;
  const docs = Math.max(1, documentParts.length || 1);
  const physicalTabs = documentParts.length
    ? documentParts.reduce(
        (sum, part) => sum + 1 + part.events.filter(item => item.type === 'tab').length,
        0
      )
    : 1;
  $('markerSummary').textContent =
    docs + ' Google Doc · ' +
    physicalTabs + ' вкладок суммарно · ' + headings + ' подзаголовков';
  $('clearMarkers').disabled = !markers.length;
}

async function saveMarkers() {
  if (!archive?.id) return;
  await chrome.storage.local.set({
    [PLAN_PREFIX + archive.id]: markers
  });
  setStatus('Пометки сохранены локально.');
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveMarkers().catch(error => setStatus(error.message || String(error), true));
  }, 180);
}

function normalizeStoredMarkers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && (item.type === 'tab' || item.type === 'heading'))
    .map(item => ({
      type: item.type,
      messageNumber: Number(item.messageNumber),
      title: String(item.title || '')
    }))
    .filter(item =>
      Number.isInteger(item.messageNumber) &&
      item.messageNumber >= 1 &&
      item.messageNumber <= (archive?.messages?.length || 0) &&
      !(item.type === 'tab' && item.messageNumber === 1)
    );
}

async function loadArchive() {
  let archiveId = requestedArchiveId;
  if (!archiveId) {
    const last = await chrome.storage.local.get('lastArchiveId');
    archiveId = last.lastArchiveId || '';
  }
  if (!archiveId) throw new Error('Завершенный архив не найден.');

  const result = await chrome.storage.local.get([
    'archive:' + archiveId,
    PLAN_PREFIX + archiveId,
    'archiverSettings'
  ]);
  archive = result['archive:' + archiveId] || null;
  if (!archive) throw new Error('Архив ' + archiveId + ' не найден в локальном хранилище.');

  const planKey = PLAN_PREFIX + archiveId;
  const hasStoredPlan = Object.prototype.hasOwnProperty.call(result, planKey);
  markers = normalizeStoredMarkers(result[planKey]);

  // One-time migration from the short-lived 0.3.18 text-plan field.
  // An explicitly saved empty marker array must not resurrect that legacy plan.
  if (!hasStoredPlan) {
    const legacy = String(result.archiverSettings?.tabPlan || '').trim();
    if (legacy) {
      try {
        markers = parseTabPlan(legacy, archive.messages?.length || 0)
          .map(item => ({
            type: item.type,
            messageNumber: item.messageNumber,
            title: item.title || ''
          }));
        await saveMarkers();

        const nextSettings = { ...(result.archiverSettings || {}) };
        delete nextSettings.tabPlan;
        await chrome.storage.local.set({ archiverSettings: nextSettings });
      } catch (_) {}
    }
  }
}

function toggleTab(messageNumber) {
  if (messageNumber === 1) return;
  const existing = markerFor('tab', messageNumber);
  if (existing) {
    markers = markers.filter(item => item !== existing);
  } else {
    markers.push({ type: 'tab', messageNumber, title: '' });
  }
  scheduleSave();
  render();
}

function toggleHeading(messageNumber) {
  const existing = markerFor('heading', messageNumber);
  if (existing) {
    markers = markers.filter(item => item !== existing);
  } else {
    markers.push({ type: 'heading', messageNumber, title: '' });
  }
  scheduleSave();
  render();
  if (!existing) {
    requestAnimationFrame(() => {
      document.querySelector('[data-message-number="' + messageNumber + '"] .heading-input')?.focus();
    });
  }
}

function updateHeading(messageNumber, title) {
  const existing = markerFor('heading', messageNumber);
  if (!existing) return;
  existing.title = title;
  updateMarkerSummary();
  scheduleSave();
}

function addImagePreviews(container, message) {
  const images = (message.images || []).filter(image => image?.dataUrl).slice(0, 3);
  if (!images.length) return;
  container.classList.remove('hidden');
  for (const image of images) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = image.alt || 'Изображение из сообщения';
    img.src = image.dataUrl;
    container.appendChild(img);
  }
}

function render() {
  if (!archive) return;

  const planEvents = markers
    .filter(item => item.type !== 'heading' || String(item.title || '').trim())
    .map(item => ({ ...item }));
  documentParts = planGoogleDocParts(archive.messages || [], planEvents);
  const docBoundaries = new Set(documentBoundaryMessageNumbers(documentParts));

  $('archiveMeta').textContent =
    (archive.title || 'ChatGPT conversation') +
    ' · ' + (archive.messages?.length || 0) + ' сообщений' +
    (documentParts.length > 1 ? ' · ' + documentParts.length + ' документов' : '');

  const root = $('messages');
  root.replaceChildren();

  (archive.messages || []).forEach((message, index) => {
    const messageNumber = index + 1;
    const fragment = $('messageTemplate').content.cloneNode(true);
    const card = fragment.querySelector('.message-card');
    card.dataset.messageNumber = String(messageNumber);

    const tabMark = markerFor('tab', messageNumber);
    const headingMark = markerFor('heading', messageNumber);

    const documentBoundary = docBoundaries.has(messageNumber);
    card.classList.toggle('is-tab', Boolean(tabMark));
    card.classList.toggle('is-heading', Boolean(headingMark));
    card.classList.toggle('is-document-boundary', documentBoundary);
    fragment.querySelector('.boundary-label').classList.toggle('hidden', !tabMark);
    fragment.querySelector('.document-boundary-label').classList.toggle('hidden', !documentBoundary);

    fragment.querySelector('.message-number').textContent = '#' + messageNumber;
    fragment.querySelector('.message-role').textContent = roleLabel(message.role);

    const imageCount = (message.images || []).length;
    fragment.querySelector('.image-count').textContent =
      imageCount ? '· ' + imageCount + ' изобр.' : '';

    const body = fragment.querySelector('.message-body');
    const text = String(message.text || '').trim();
    const collapsedText = text.length > 1600 ? text.slice(0, 1600) + '…' : text;
    body.textContent = collapsedText || (imageCount ? '[сообщение с изображением]' : '[пустая реплика]');

    const tabButton = fragment.querySelector('.marker-tab');
    tabButton.classList.toggle('active', Boolean(tabMark) && !documentBoundary);
    tabButton.textContent = messageNumber === 1
      ? 'Первая вкладка уже есть'
      : documentBoundary
        ? 'Первая вкладка нового документа'
        : (tabMark ? 'Убрать вкладку' : 'Вкладка перед');
    tabButton.disabled = messageNumber === 1 || documentBoundary;
    tabButton.addEventListener('click', () => toggleTab(messageNumber));

    const headingButton = fragment.querySelector('.marker-heading');
    headingButton.classList.toggle('active', Boolean(headingMark));
    headingButton.textContent = headingMark ? 'Убрать подзаголовок' : 'Подзаголовок';
    headingButton.addEventListener('click', () => toggleHeading(messageNumber));

    const editor = fragment.querySelector('.heading-editor');
    editor.classList.toggle('hidden', !headingMark);
    const input = fragment.querySelector('.heading-input');
    input.value = headingMark?.title || '';
    input.addEventListener('input', event => updateHeading(messageNumber, event.target.value));

    addImagePreviews(fragment.querySelector('.image-preview'), message);

    const expand = fragment.querySelector('.expand-message');
    if (text.length > 1600) {
      expand.classList.remove('hidden');
      expand.addEventListener('click', () => {
        const expanded = card.classList.toggle('expanded');
        body.textContent = expanded ? text : collapsedText;
        expand.textContent = expanded ? 'Свернуть' : 'Показать полностью';
      });
    }

    root.appendChild(fragment);
  });

  updateMarkerSummary();
  $('exportTabbed').disabled = false;
}

$('clearMarkers').addEventListener('click', async () => {
  if (!markers.length) return;
  if (!confirm('Убрать все границы вкладок и подзаголовки для этого архива?')) return;
  markers = [];
  await saveMarkers();
  render();
});

$('exportTabbed').addEventListener('click', async () => {
  const emptyHeading = markers.find(item => item.type === 'heading' && !String(item.title || '').trim());
  if (emptyHeading) {
    const card = document.querySelector('[data-message-number="' + emptyHeading.messageNumber + '"]');
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card?.querySelector('.heading-input')?.focus();
    setStatus('Заполните текст подзаголовка у реплики #' + emptyHeading.messageNumber + '.', true);
    return;
  }

  $('exportTabbed').disabled = true;
  setStatus('Создаю Google Doc и раскладываю архив по отмеченным границам…');

  try {
    await saveMarkers();
    const planText = serializeTabPlan(markers);
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_EXPORT_TABBED_NEW_DOC',
      archiveId: archive?.id || requestedArchiveId || '',
      planText
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось выполнить экспорт.');

    const imagePart = (result.imageInsertedCount || result.imageFailedCount)
      ? ' Изображения: ' + (result.imageInsertedCount || 0) +
        ' вставлено, ' + (result.imageFailedCount || 0) + ' ошибок.'
      : '';

    setStatus(
      'Готово: ' + (result.documentCount || 1) + ' документов, ' +
      (result.tabCount || 1) + ' вкладок, ' +
      (result.headingCount || 0) + ' подзаголовков, ' +
      (result.addedCount || 0) + ' сообщений.' +
      imagePart +
      ' Названия вкладок можно переименовать вручную в Google Docs.'
    );
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('exportTabbed').disabled = false;
  }
});

(async () => {
  try {
    await loadArchive();
    render();
  } catch (error) {
    setStatus(error.message || String(error), true);
    $('archiveMeta').textContent = 'Архив не загружен';
  }
})();
