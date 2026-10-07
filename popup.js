const $ = id => document.getElementById(id);
let pollTimer = null;
let state = null;

const DEFAULT_INTERFACE_APPEARANCE = {
  palette: 'ocean',
  fontPreset: 'segoe',
  fontCustom: '',
  colors: {
    accent: '#1769e0',
    background: '#f4f8ff',
    panel: '#ffffff',
    text: '#12233f'
  }
};

const DEFAULT_SETTINGS = {
  userName: '',
  assistantName: '',
  palette: 'ocean',
  interfaceAppearance: DEFAULT_INTERFACE_APPEARANCE,
  alignUserRight: true,
  captureTarget: 'copy'
};

const INTERFACE_PALETTES = new Set([
  'ocean', 'cobalt', 'sky', 'violet', 'rose',
  'amber', 'forest', 'graphite', 'midnight',
  'gradient-ocean', 'gradient-sunset', 'gradient-mint', 'gradient-violet',
  'custom'
]);

const INTERFACE_FONT_PRESETS = new Set([
  'segoe', 'arial', 'verdana', 'tahoma', 'georgia', 'consolas'
]);

const INTERFACE_FONT_STACKS = {
  segoe: '"Segoe UI", system-ui, sans-serif',
  arial: 'Arial, sans-serif',
  verdana: 'Verdana, sans-serif',
  tahoma: 'Tahoma, sans-serif',
  georgia: 'Georgia, serif',
  consolas: 'Consolas, "Courier New", monospace'
};

const PHASE_LABELS = {
  top: 'Этап 1/3 · Загружаю начало',
  walk: 'Этап 2/3 · Собираю к зафиксированному концу',
  finalizing: 'Этап 3/3 · Сохраняю локальный архив',
  paused: 'Сбор приостановлен'
};

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  if (totalSeconds < 60) return totalSeconds + ' с';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return minutes + ' мин ' + seconds + ' с';
}

function renderCaptureProgress(job, running) {
  const box = $('captureProgress');
  if (!box) return;
  box.classList.toggle('hidden', !running);
  if (!running) return;

  $('capturePhase').textContent = PHASE_LABELS[job?.phase] || 'Сбор переписки';
  const parts = [];
  if (job?.navigationHighWater && job?.phase === 'walk') {
    parts.push('нашёл на первом проходе: ' + Number(job.navigationHighWater || 0));
    parts.push('собрано по порядку: ' + Number(job.chronologicalCount ?? job.count ?? 0));
  } else {
    parts.push((job?.count || 0) + ' сообщений');
  }
  if (job?.startedAt) {
    parts.push(formatDuration(Date.now() - job.startedAt));
  }
  if (job?.iteration) parts.push('проход ' + job.iteration);
  $('captureMeta').textContent = parts.join(' · ');
}
function renderRunLog(job) {
  const box = $('runLog');
  if (!box) return;
  box.classList.toggle('hidden', !job);
  if (!job) return;

  const statusLabels = {
    starting: 'Запуск',
    running: 'Идёт',
    paused: 'Пауза',
    done: 'Завершён',
    error: 'Ошибка',
    cancelled: 'Отменён'
  };
  $('runLogTitle').textContent = statusLabels[job.status] || job.status || 'Последний запуск';

  const meta = [];
  meta.push(
    job.captureMode === 'compare'
      ? 'сверка с локальным архивом'
      : job.captureMode === 'sync'
        ? 'восстановление по Google Doc'
        : job.captureMode === 'continue'
          ? 'продолжение'
          : job.captureMode === 'images'
            ? 'добор изображений'
            : job.captureMode === 'retry-walk'
              ? 'повтор только прохода вниз'
              : 'полный сбор'
  );
  if (job.captureTarget) meta.push(captureTargetLabel(job.captureTarget));
  if (job.phase) meta.push(PHASE_LABELS[job.phase] || job.phase);
  meta.push((job.count || 0) + ' собрано');
  if (job.draftCount) meta.push(job.draftCount + ' в незавершённом проходе');
  if (job.startedAt && (job.finishedAt || !['starting', 'running', 'paused'].includes(job.status))) {
    meta.push(formatDuration((job.finishedAt || Date.now()) - job.startedAt));
  }
  $('runLogMeta').textContent = meta.join(' · ');
  $('runLogMessage').textContent = job.message || '';
}

function renderDraft(draft) {
  const box = $('draft');
  if (!box) return;
  box.classList.toggle('hidden', !draft);
  if (!draft) return;
  $('draftTitle').textContent = 'Сбор не завершён' + (draft.title ? ' · ' + draft.title : '');
  $('draftMeta').textContent =
    (draft.messageCount || 0) + ' сообщений · ' + (draft.imageCount || 0) + ' изображений';
}

function renderUnfinishedPasses(items = []) {
  const list = $('unfinishedPassesList');
  const count = $('unfinishedPassesCount');
  if (!list || !count) return;

  const rows = Array.isArray(items) ? items : [];
  count.textContent = String(rows.length);
  list.textContent = '';

  if (!rows.length) return;

  for (const item of rows) {
    const row = document.createElement('div');
    row.className = 'history-item';

    const head = document.createElement('div');
    head.className = 'history-item-head';

    const title = document.createElement('div');
    title.className = 'history-item-title';
    title.textContent = item.title || 'Незавершённый проход';

    const status = document.createElement('div');
    status.className = 'history-item-status error';
    status.textContent = item.capturePhase || 'оборван';

    head.append(title, status);

    const meta = document.createElement('div');
    meta.className = 'history-item-meta';
    const when = item.capturedAt ? new Date(item.capturedAt).toLocaleString('ru-RU') : '—';
    const parts = [
      when,
      (item.messageCount || 0) + ' сообщений',
      (item.imageCount || 0) + ' изображений'
    ];
    if (item.navigationHighWater) parts.push('найдено на первом проходе: ' + item.navigationHighWater);
    if (item.hasBoundary) parts.push('конец исходного чата сохранён');
    meta.textContent = parts.join(' · ');

    const actions = document.createElement('div');
    actions.className = 'actions';

    const resume = document.createElement('button');
    resume.className = 'primary';
    resume.textContent = 'Продолжить';
    resume.onclick = async () => {
      resume.disabled = true;
      setStatus('Открываю исходный чат и ищу место остановки…');
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'ARCHIVER_RESUME_UNFINISHED_PASS',
          passId: item.id,
          captureTarget: $('captureTarget').value
        });
        if (!result?.ok) throw new Error(result?.error || 'Не удалось продолжить незавершённый проход.');
        render({ ...state, job: result.job });
        startPolling();
      } catch (error) {
        setStatus(error.message || String(error), true);
        resume.disabled = false;
      }
    };

    const view = document.createElement('button');
    view.textContent = 'Просмотреть';
    view.onclick = async () => {
      const url = chrome.runtime.getURL('unfinished.html?passId=' + encodeURIComponent(item.id));
      await chrome.tabs.create({ url });
    };

    const copy = document.createElement('button');
    copy.textContent = 'Скопировать';
    copy.onclick = async () => {
      const result = await chrome.runtime.sendMessage({
        type: 'ARCHIVER_COPY_UNFINISHED_PASS',
        passId: item.id
      });
      if (!result?.ok) {
        setStatus(result?.error || 'Не удалось скопировать незавершённый проход.', true);
        return;
      }
      setStatus('Незавершённый проход скопирован: ' + (result.count || 0) + ' сообщений.');
    };

    const remove = document.createElement('button');
    remove.className = 'danger-outline';
    remove.textContent = 'Удалить';
    remove.onclick = async () => {
      if (!confirm('Удалить этот сохранённый незавершённый проход?')) return;
      const result = await chrome.runtime.sendMessage({
        type: 'ARCHIVER_DELETE_UNFINISHED_PASS',
        passId: item.id
      });
      if (!result?.ok) {
        setStatus(result?.error || 'Не удалось удалить незавершённый проход.', true);
        return;
      }
      await getState();
      setStatus('Незавершённый проход удалён.');
    };

    actions.append(resume, view, copy, remove);
    row.append(head, meta, actions);
    list.appendChild(row);
  }
}


function renderSavedArchives(items = []) {
  const list = $('savedArchivesList');
  const count = $('savedArchivesCount');
  const notice = $('savedArchivesNotice');
  if (!list || !count) return;

  const rows = Array.isArray(items) ? items : [];
  count.textContent = String(rows.length);
  list.textContent = '';

  const withoutDocument = rows.filter(item => !item.destination?.saved).length;
  if (notice) {
    notice.classList.toggle('hidden', !withoutDocument);
    notice.textContent = withoutDocument
      ? (withoutDocument === 1
          ? '1 чат есть в Архиваторе, но ещё не перенесён в документ.'
          : withoutDocument + ' чатов есть в Архиваторе, но ещё не перенесены в документ.')
      : '';
  }

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'Сохранённых чатов пока нет.';
    list.appendChild(empty);
    return;
  }

  const busy = Boolean(state?.job && ['starting', 'running', 'paused'].includes(state.job.status));

  for (const item of rows) {
    const row = document.createElement('div');
    row.className = 'archive-link-row';

    const main = document.createElement('div');
    main.className = 'archive-link-main';

    const title = document.createElement('div');
    title.className = 'archive-link-title';
    title.textContent = item.title || 'Чат ChatGPT';

    const meta = document.createElement('div');
    meta.className = 'archive-link-meta';
    const parts = [];
    if (item.messageCount != null) parts.push(item.messageCount + ' сообщений');
    if (item.capturedAt) {
      try { parts.push(new Date(item.capturedAt).toLocaleString('ru-RU')); } catch (_) {}
    }
    meta.textContent = parts.join(' · ');

    const destination = document.createElement('div');
    destination.className = 'archive-destination';

    const destinationText = document.createElement('span');
    if (item.destination?.saved) {
      if (item.destination.kind === 'google-doc') {
        destinationText.textContent = 'Сохранён в Google Docs';
      } else if (item.destination.url) {
        destinationText.textContent = 'Сохранён отдельно';
      } else {
        destinationText.textContent = 'Сохранён отдельно';
      }
    } else {
      destinationText.textContent = 'Не перенесён в документ';
    }
    destination.appendChild(destinationText);

    const destinationUrl = item.destination?.url || item.docUrl || '';
    if (destinationUrl) {
      const destinationLink = document.createElement('a');
      destinationLink.href = destinationUrl;
      destinationLink.target = '_blank';
      destinationLink.rel = 'noopener noreferrer';
      destinationLink.textContent = item.destination?.kind === 'google-doc' ? 'Открыть Google Doc ↗' : 'Открыть ↗';
      destination.appendChild(destinationLink);
    }

    main.append(title, meta, destination);

    const actions = document.createElement('div');
    actions.className = 'archive-link-actions';

    const resume = document.createElement('button');
    resume.className = 'archive-link-open';
    resume.type = 'button';
    resume.textContent = 'Продолжить';
    resume.disabled = busy || state?.entitlement?.canCreate === false;
    resume.onclick = async () => {
      resume.disabled = true;
      setStatus('Открываю чат и ищу место продолжения…');
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'ARCHIVER_CONTINUE_SAVED_ARCHIVE',
          archiveId: item.id,
          captureTarget: $('captureTarget').value
        });
        if (!result?.ok) throw new Error(result?.error || 'Не удалось продолжить чат.');
        render({ ...state, job: result.job });
        startPolling();
      } catch (error) {
        setStatus(error.message || String(error), true);
        resume.disabled = false;
      }
    };
    actions.appendChild(resume);

    const copyButton = document.createElement('button');
    copyButton.className = 'archive-link-open';
    copyButton.type = 'button';
    copyButton.textContent = 'Скопировать';
    copyButton.disabled = busy;
    copyButton.onclick = async () => {
      copyButton.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'ARCHIVER_COPY_ARCHIVE',
          archiveId: item.id
        });
        if (!result?.ok) throw new Error(result?.error || 'Не удалось скопировать чат.');
        setStatus('Скопировано: ' + (result.count || 0) + ' сообщений.');
      } catch (error) {
        setStatus(error.message || String(error), true);
      } finally {
        copyButton.disabled = false;
      }
    };
    actions.appendChild(copyButton);

    if (item.docUrl) {
      const open = document.createElement('a');
      open.className = 'archive-link-open';
      open.href = item.docUrl;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.textContent = 'Google Doc ↗';
      actions.appendChild(open);
    } else {
      const exportButton = document.createElement('button');
      exportButton.className = 'archive-link-open';
      exportButton.type = 'button';
      exportButton.textContent = 'В Google Docs';
      exportButton.disabled = busy;
      exportButton.onclick = async () => {
        exportButton.disabled = true;
        setStatus('Создаю Google Doc…');
        try {
          const result = await exportToDoc('ARCHIVER_EXPORT_NEW_DOC', { archiveId: item.id });
          setStatus('Сохранено в Google Docs: ' + (result.addedCount || 0) + ' сообщений.');
          await getState();
        } catch (error) {
          setStatus(error.message || String(error), true);
          exportButton.disabled = false;
        }
      };
      actions.appendChild(exportButton);
    }

    const mark = document.createElement('button');
    mark.className = 'archive-link-more';
    mark.type = 'button';
    mark.textContent = item.destination?.saved ? 'Изменить' : 'Отметить как сохранённый';
    mark.disabled = busy;
    actions.appendChild(mark);

    const plan = document.createElement('button');
    plan.className = 'archive-link-more';
    plan.type = 'button';
    plan.textContent = 'Разбить по темам';
    plan.disabled = busy;
    plan.onclick = async () => {
      const url = chrome.runtime.getURL('planner.html?archiveId=' + encodeURIComponent(item.id));
      await chrome.tabs.create({ url });
    };
    actions.appendChild(plan);

    const destinationEditor = document.createElement('div');
    destinationEditor.className = 'archive-destination-editor hidden';

    const destinationInput = document.createElement('input');
    destinationInput.type = 'url';
    destinationInput.placeholder = 'Ссылка на документ или страницу — необязательно';
    destinationInput.value = item.destination?.kind === 'manual' ? (item.destination?.url || '') : '';
    destinationInput.autocomplete = 'off';

    const editorActions = document.createElement('div');
    editorActions.className = 'archive-destination-editor-actions';

    const saveDestination = document.createElement('button');
    saveDestination.type = 'button';
    saveDestination.className = 'primary';
    saveDestination.textContent = 'Сохранить отметку';
    saveDestination.onclick = async () => {
      saveDestination.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'ARCHIVER_SET_ARCHIVE_DESTINATION',
          archiveId: item.id,
          saved: true,
          url: destinationInput.value.trim()
        });
        if (!result?.ok) throw new Error(result?.error || 'Не удалось сохранить отметку.');
        await getState();
        setStatus('Отметка сохранена.');
      } catch (error) {
        setStatus(error.message || String(error), true);
        saveDestination.disabled = false;
      }
    };
    editorActions.appendChild(saveDestination);

    if (item.destination?.saved && item.destination.kind !== 'google-doc') {
      const clearDestination = document.createElement('button');
      clearDestination.type = 'button';
      clearDestination.className = 'danger-outline';
      clearDestination.textContent = 'Снять отметку';
      clearDestination.onclick = async () => {
        const result = await chrome.runtime.sendMessage({
          type: 'ARCHIVER_SET_ARCHIVE_DESTINATION',
          archiveId: item.id,
          saved: false
        });
        if (!result?.ok) {
          setStatus(result?.error || 'Не удалось снять отметку.', true);
          return;
        }
        await getState();
      };
      editorActions.appendChild(clearDestination);
    }

    const cancelDestination = document.createElement('button');
    cancelDestination.type = 'button';
    cancelDestination.textContent = 'Отмена';
    cancelDestination.onclick = () => destinationEditor.classList.add('hidden');
    editorActions.appendChild(cancelDestination);

    destinationEditor.append(destinationInput, editorActions);
    mark.onclick = () => {
      destinationEditor.classList.toggle('hidden');
      if (!destinationEditor.classList.contains('hidden')) destinationInput.focus();
    };

    row.append(main, actions, destinationEditor);
    list.appendChild(row);
  }
}

function renderHistory(history = []) {
  const list = $('captureHistory');
  const count = $('historyCount');
  if (!list || !count) return;

  const items = Array.isArray(history) ? history : [];
  count.textContent = String(items.length);
  list.textContent = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'История появится после завершённых, остановленных или ошибочных запусков.';
    list.appendChild(empty);
    return;
  }

  const statusLabels = {
    done: 'Завершён',
    error: 'Ошибка',
    cancelled: 'Остановлен'
  };
  const modeLabels = {
    full: 'Полный сбор',
    continue: 'Добор нового',
    compare: 'Сверка',
    sync: 'Восстановление',
    images: 'Добор изображений',
    'retry-walk': 'Повтор прохода вниз'
  };

  for (const item of items.slice(0, 10)) {
    const row = document.createElement('div');
    row.className = 'history-item';

    const head = document.createElement('div');
    head.className = 'history-item-head';

    const title = document.createElement('div');
    title.className = 'history-item-title';
    title.textContent = modeLabels[item.captureMode] || item.captureMode || 'Сбор';

    const status = document.createElement('div');
    status.className = 'history-item-status ' + (item.status || '');
    status.textContent = statusLabels[item.status] || item.status || '—';

    head.append(title, status);

    const meta = document.createElement('div');
    meta.className = 'history-item-meta';
    const when = item.finishedAt || item.startedAt;
    const time = when ? new Date(when).toLocaleString('ru-RU') : '—';
    const parts = [time, captureTargetLabel(item.captureTarget), (item.count || 0) + ' сообщений'];
    if (item.startedAt && item.finishedAt) parts.push(formatDuration(item.finishedAt - item.startedAt));
    if (item.addedCount) parts.push('+' + item.addedCount + ' новых');
    meta.textContent = parts.join(' · ');

    row.append(head, meta);

    if (item.message) {
      const message = document.createElement('div');
      message.className = 'history-item-message';
      message.textContent = item.message;
      row.appendChild(message);
    }

    list.appendChild(row);
  }
}

function renderCaptureState(job) {
  const badge = $('captureStateBadge');
  if (!badge) return;

  badge.className = 'state-badge';
  if (!job) {
    badge.textContent = 'Готово';
    return;
  }

  const labels = {
    starting: 'Запуск',
    running: 'Сбор идёт',
    paused: 'Пауза',
    done: 'Готово',
    error: 'Ошибка',
    cancelled: 'Остановлен'
  };
  badge.textContent = labels[job.status] || job.status || 'Готово';
  if (job.status === 'running' || job.status === 'starting') badge.classList.add('running');
  else if (job.status === 'paused') badge.classList.add('paused');
  else if (job.status === 'done') badge.classList.add('done');
  else if (job.status === 'error') badge.classList.add('error');
}

function setStatus(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function normalizeHex(value, fallback) {
  const raw = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
}

function mixHex(foreground, background, foregroundWeight = 0.5) {
  const fg = normalizeHex(foreground, '#000000').slice(1);
  const bg = normalizeHex(background, '#ffffff').slice(1);
  const weight = Math.max(0, Math.min(1, Number(foregroundWeight) || 0));
  const channel = offset => Math.round(
    parseInt(fg.slice(offset, offset + 2), 16) * weight +
    parseInt(bg.slice(offset, offset + 2), 16) * (1 - weight)
  ).toString(16).padStart(2, '0');
  return '#' + channel(0) + channel(2) + channel(4);
}

function isDarkHex(value) {
  const hex = normalizeHex(value, '#ffffff').slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function normalizeInterfaceAppearance(settings = {}) {
  const raw = settings.interfaceAppearance || {};
  const legacyPalette = raw.palette || settings.palette || DEFAULT_INTERFACE_APPEARANCE.palette;
  const palette = INTERFACE_PALETTES.has(legacyPalette)
    ? legacyPalette
    : DEFAULT_INTERFACE_APPEARANCE.palette;
  const fontPreset = INTERFACE_FONT_PRESETS.has(raw.fontPreset)
    ? raw.fontPreset
    : DEFAULT_INTERFACE_APPEARANCE.fontPreset;
  return {
    ...DEFAULT_INTERFACE_APPEARANCE,
    ...raw,
    palette,
    fontPreset,
    fontCustom: '',
    colors: {
      ...DEFAULT_INTERFACE_APPEARANCE.colors,
      ...(raw.colors || {})
    }
  };
}

function customFontStack(appearance) {
  return INTERFACE_FONT_STACKS[appearance.fontPreset] || INTERFACE_FONT_STACKS.segoe;
}

function applyInterfaceAppearance(settings = {}) {
  const appearance = normalizeInterfaceAppearance(settings);
  const root = document.documentElement;
  root.dataset.palette = appearance.palette;
  root.style.setProperty('--font-ui', customFontStack(appearance));

  const customVars = [
    '--bg', '--bg-gradient', '--panel', '--text', '--muted',
    '--accent', '--accent-2', '--soft', '--border', '--shadow'
  ];
  for (const name of customVars) root.style.removeProperty(name);

  if (appearance.palette === 'custom') {
    const accent = normalizeHex(appearance.colors.accent, DEFAULT_INTERFACE_APPEARANCE.colors.accent);
    const background = normalizeHex(appearance.colors.background, DEFAULT_INTERFACE_APPEARANCE.colors.background);
    const panel = normalizeHex(appearance.colors.panel, DEFAULT_INTERFACE_APPEARANCE.colors.panel);
    const text = normalizeHex(appearance.colors.text, DEFAULT_INTERFACE_APPEARANCE.colors.text);
    const dark = isDarkHex(background);

    root.style.setProperty('--bg', background);
    root.style.setProperty('--bg-gradient', 'linear-gradient(145deg,' + background + ' 0%,' + mixHex(accent, background, 0.10) + ' 52%,' + background + ' 100%)');
    root.style.setProperty('--panel', panel);
    root.style.setProperty('--text', text);
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-2', mixHex(accent, dark ? '#ffffff' : '#001a4d', 0.78));
    root.style.setProperty('--soft', mixHex(accent, background, 0.12));
    root.style.setProperty('--border', mixHex(accent, background, 0.24));
    root.style.setProperty('--muted', mixHex(text, background, 0.58));
    root.style.setProperty('--shadow', '0 14px 36px ' + mixHex(accent, background, 0.18) + '55');
    root.style.colorScheme = dark ? 'dark' : 'light';
  } else {
    root.style.colorScheme = appearance.palette === 'midnight' ? 'dark' : 'light';
  }
}

function updateInterfaceControlVisibility() {
  const palette = $('interfacePalette')?.value || 'ocean';
  $('interfaceCustomColors')?.classList.toggle('hidden', palette !== 'custom');
}

function readInterfaceAppearanceControls() {
  return {
    palette: $('interfacePalette').value,
    fontPreset: $('interfaceFontPreset').value,
    fontCustom: '',
    colors: {
      accent: $('interfaceAccent').value,
      background: $('interfaceBackground').value,
      panel: $('interfacePanel').value,
      text: $('interfaceText').value
    }
  };
}

function renderInterfaceAppearanceControls(settings) {
  const appearance = normalizeInterfaceAppearance(settings);
  $('interfacePalette').value = appearance.palette;
  $('interfaceFontPreset').value = appearance.fontPreset;
  $('interfaceFontCustom').value = '';
  $('interfaceAccent').value = normalizeHex(
    appearance.colors.accent,
    DEFAULT_INTERFACE_APPEARANCE.colors.accent
  );
  $('interfaceBackground').value = normalizeHex(
    appearance.colors.background,
    DEFAULT_INTERFACE_APPEARANCE.colors.background
  );
  $('interfacePanel').value = normalizeHex(
    appearance.colors.panel,
    DEFAULT_INTERFACE_APPEARANCE.colors.panel
  );
  $('interfaceText').value = normalizeHex(
    appearance.colors.text,
    DEFAULT_INTERFACE_APPEARANCE.colors.text
  );
  updateInterfaceControlVisibility();
}

function previewInterfaceAppearance() {
  applyInterfaceAppearance({
    interfaceAppearance: readInterfaceAppearanceControls()
  });
}

function captureTargetLabel(value) {
  return value === 'copy' ? 'в фоновой вкладке' : 'в текущей вкладке';
}

function updateCaptureTargetHint(value) {
  $('captureTargetHint').textContent = value === 'copy'
    ? 'Сбор идёт в отдельной вкладке.'
    : 'Сбор идёт в этой вкладке.';
  const info = $('captureInfoText');
  if (info) {
    info.textContent = value === 'copy'
      ? 'Архиватор откроет отдельную вкладку с этим чатом, физически прокрутит его от начала до зафиксированного конца и сохранит сообщения. Текущую вкладку можно не трогать.'
      : 'Архиватор физически прокрутит этот чат в текущей вкладке. Пока идёт сбор, лучше не прокручивать страницу вручную.';
  }
}

async function loadSettings() {
  const result = await chrome.storage.local.get('archiverSettings');
  const merged = { ...DEFAULT_SETTINGS, ...(result.archiverSettings || {}) };
  merged.interfaceAppearance = normalizeInterfaceAppearance(merged);
  return merged;
}

async function saveSettings(patch, noticeId = 'settingsSaved') {
  const current = await loadSettings();
  const next = { ...current, ...patch };

  if (patch.interfaceAppearance) {
    next.interfaceAppearance = normalizeInterfaceAppearance({
      ...next,
      interfaceAppearance: {
        ...current.interfaceAppearance,
        ...patch.interfaceAppearance,
        colors: {
          ...current.interfaceAppearance.colors,
          ...(patch.interfaceAppearance.colors || {})
        }
      }
    });
    // Keep the short-lived legacy key in sync so downgrading does not lose
    // the selected preset. Export logic never depends on this key.
    next.palette = next.interfaceAppearance.palette;
  }

  await chrome.storage.local.set({ archiverSettings: next });
  applyInterfaceAppearance(next);

  if (noticeId) {
    const target = $(noticeId);
    if (target) {
      target.textContent = 'Сохранено';
      saveSettings.timers ||= {};
      clearTimeout(saveSettings.timers[noticeId]);
      saveSettings.timers[noticeId] = setTimeout(() => {
        target.textContent = '';
      }, 900);
    }
  }
}

function renderEntitlement(entitlement = null) {
  const card = $('licenseCard');
  if (!card) return;
  const status = entitlement || {};
  const paid = Boolean(status.paid);
  const remaining = Number(status.freeRemaining || 0);
  const total = Number(status.freeTotal || status.freeLimit || 5);
  const used = Number(status.freeUsed || 0);

  $('licenseTitle').textContent = paid
    ? 'Лицензия активна'
    : (status.licenseExpired ? 'Срок лицензии закончился' : (remaining > 0 ? 'Бесплатный доступ' : 'Бесплатный лимит закончился'));
  $('licenseBadge').textContent = paid ? 'Активна' : (remaining + ' осталось');
  $('licenseUsage').textContent = paid
    ? (status.validUntil
        ? 'Новые сохранения доступны до ' + new Date(status.validUntil).toLocaleDateString('ru-RU') + '.'
        : 'Новые сохранения доступны без ограничения по сроку.')
    : ('Использовано ' + used + ' из ' + total + ' бесплатных сохранений.');

  $('removeLicense')?.classList.toggle('hidden', !status.hasLicenseToken);
}

function render(data) {
  state = data || {};
  const job = state.job;
  const archive = state.archive;
  const draft = state.unfinishedPass || state.draft || null;
  const running = job && ['starting', 'running', 'paused'].includes(job.status);
  const activelyRunning = job && ['starting', 'running'].includes(job.status);
  const paused = job?.status === 'paused';
  const done = job?.status === 'done' && archive;

  renderCaptureState(job);
  renderHistory(state.history || []);
  renderUnfinishedPasses(state.unfinishedPasses || []);
  renderEntitlement(state.entitlement || null);
  renderSavedArchives(state.savedArchives || []);
  const hasUnfinished = Boolean((state.unfinishedPasses || []).length);
  $('unfinishedPassesPanel')?.classList.toggle('hidden', !hasUnfinished);
  $('unfinishedPassesPanel')?.classList.toggle('has-items', hasUnfinished);

  const canCreate = state.entitlement?.canCreate !== false;
  $('capture').disabled = Boolean(running || !canCreate);
  $('capture').textContent = running
    ? (job?.captureTarget === 'copy' ? 'Сбор идёт в фоновой вкладке…' : 'Сбор идёт в текущей вкладке…')
    : 'Собрать чат';
  $('continue').disabled = Boolean(running || !state.canContinue || !canCreate);
  $('syncDoc').disabled = Boolean(running || !canCreate);
  $('docUrl').disabled = Boolean(running);
  $('captureTarget').disabled = Boolean(running);

  $('pauseCapture').classList.toggle('hidden', !activelyRunning);
  $('resumeCapture').classList.toggle('hidden', !paused);
  $('resumeCapture').disabled = Boolean(paused && job?.pauseReason && job.pauseReason !== 'user');
  $('cancel').classList.toggle('hidden', !running);
  $('resetCapture').disabled = Boolean(running || !job);
  $('clearHistory').disabled = Boolean(running || !(state.history || []).length);

  $('compareResult').textContent = '';

  $('linkedDocHint').textContent = state.linkedDoc?.url
    ? 'Связанный документ найден. Его ссылку можно заменить на другую только для этого запуска.'
    : 'Связанного Google Doc для этого чата сейчас нет.';
  const latestUnfinished = (state.unfinishedPasses || [])[0] || null;
  const canResumeUnfinished = Boolean(!running && latestUnfinished?.id);
  const canRetryCurrent = Boolean(
    !running &&
    !canResumeUnfinished &&
    job?.status === 'error' &&
    job?.captureTarget === 'copy'
  );
  $('retryCurrent').textContent = canResumeUnfinished ? 'Продолжить сбор' : 'Повторить в текущей вкладке';
  $('retryCurrent').classList.toggle('hidden', !(canResumeUnfinished || canRetryCurrent));
  if (!running && !$('docUrl').value && state.linkedDoc?.url) {
    $('docUrl').value = state.linkedDoc.url;
  }
  renderCaptureProgress(job, running);
  renderRunLog(job);
  renderDraft(draft);

  const recoverableDraft = Boolean(
    draft &&
    job?.status === 'error' &&
    job?.recoveryAvailable &&
    job?.captureTabId != null
  );
  $('openFailedCapture').classList.toggle('hidden', !recoverableDraft);
  $('resumeFailedCapture').classList.toggle('hidden', !recoverableDraft);
  $('resumeFailedCapture').disabled = Boolean(running || !recoverableDraft);
  $('draftRecoveryHint').classList.toggle('hidden', !draft);
  $('deleteDraft').disabled = Boolean(running || !draft);

  $('archive').classList.add('hidden');
  $('archiveTitle').textContent = archive?.title || '';
  $('archiveMeta').textContent = archive
    ? (`${archive.messageCount || 0} сообщений · ${archive.imageCount || 0} изображений` +
      (archive.lastImageRecoveredCount ? ` · добор изображений +${archive.lastImageRecoveredCount}` : ''))
    : '';
  const linkedUrl = state.linkedDoc?.url || '';
  $('archiveStateLabel').textContent = linkedUrl ? 'Сохранён в Google Docs' : 'Чат сохранён';
  $('archiveStateHint').textContent = linkedUrl ? 'локальная копия сохранена для продолжения' : '';
  $('archiveDocStatus').textContent = linkedUrl
    ? 'Google Doc связан с этим архивом. Локальная копия нужна, чтобы продолжать чат без повторного полного сбора.'
    : 'Архив пока хранится только локально.';
  $('archiveDocLink').classList.toggle('hidden', !linkedUrl);
  $('archiveDocLink').href = linkedUrl || '#';

  // A failed new capture must not hide or disable the previously completed
  // local archive. Export is disabled only while a capture is actively running.
  $('newDoc').disabled = Boolean(running || !archive);
  $('activeDoc').disabled = Boolean(running || !archive);
  $('openPlanner').disabled = Boolean(running || !archive);
  $('recoverImages').disabled = Boolean(running || !archive || !state.canContinue);
  $('deleteArchive').disabled = Boolean(running || !archive);
  $('patchRecoveredImages').disabled = Boolean(
    running ||
    !archive ||
    !state.linkedDoc?.url ||
    !(archive.recoveredImagePendingPatchCount || archive.lastImageRecoveredCount)
  );

  if (running) {
    setStatus(job.message || 'Сбор идет в фоне…');
  } else if (job?.status === 'error') {
    const attempted = Number(job.count || 0);
    const hasDraft = Boolean(draft?.messageCount);
    const attemptText = attempted
      ? `Сбор остановился после ${attempted} сообщений.`
      : 'Сбор остановился.';
    const nextText = hasDraft ? ' Незавершённый сбор можно продолжить ниже.' : '';
    setStatus(attemptText + nextText + ' ' + (job.message || ''), true);
  } else if (job?.status === 'cancelled') {
    const attempted = Number(job.count || 0);
    setStatus(attempted
      ? `Сбор отменён после ${attempted} сообщений.`
      : 'Сбор отменён.');
  } else if (job?.status === 'done' && job?.captureMode === 'compare') {
    const added = Number(job.addedCount || 0);
    setStatus(
      added
        ? `Сверка завершена: ${added} новых сообщений относительно локального архива. Архив не изменён.`
        : 'Сверка завершена: новых сообщений относительно локального архива нет. Архив не изменён.'
    );
  } else if (job?.status === 'done' && job?.captureMode === 'images') {
    const recovered = Number(job.imageRecoveredCount || archive?.lastImageRecoveredCount || 0);
    setStatus(
      recovered
        ? `Добор картинок завершён: найдено ${recovered} новых. Локальный архив обновлён.`
        : 'Добор картинок завершён: новых изображений не найдено.'
    );
  } else if (done) {
    const added = archive.lastCaptureMode === 'continue' || archive.lastCaptureMode === 'sync'
      ? ` · +${archive.lastCaptureAddedCount || 0} новых`
      : '';
    setStatus(`Готово: ${archive.messageCount || 0} сообщений${added}, ${archive.imageCount || 0} изображений. Сохранено локально в Chrome.`);
  } else if (archive) {
    setStatus(`Локальный архив: ${archive.messageCount || 0} сообщений, ${archive.imageCount || 0} изображений.`);
  } else {
    setStatus('Готово.');
  }
}

async function getState() {
  const result = await chrome.runtime.sendMessage({ type: 'ARCHIVER_GET_STATE' });
  if (!result?.ok) throw new Error(result?.error || 'Не удалось получить состояние.');
  render(result);
  return result;
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => getState().catch(() => {}), 650);
}

async function exportToDoc(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || 'Не удалось сохранить в Google Docs.');
  return result;
}

$('activateLicense').onclick = async () => {
  const token = $('licenseKey').value.trim();
  if (!token) {
    $('licenseMessage').textContent = 'Вставьте лицензионный ключ.';
    return;
  }
  $('activateLicense').disabled = true;
  $('licenseMessage').textContent = 'Проверяю ключ…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ARCHIVER_ACTIVATE_LICENSE', licenseToken: token });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось активировать лицензию.');
    $('licenseMessage').textContent = 'Лицензия активирована.';
    $('licenseKey').value = '';
    await getState();
  } catch (error) {
    $('licenseMessage').textContent = error.message || String(error);
  } finally {
    $('activateLicense').disabled = false;
  }
};

$('removeLicense').onclick = async () => {
  $('removeLicense').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ARCHIVER_CLEAR_LICENSE' });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось удалить лицензионный ключ.');
    $('licenseMessage').textContent = 'Лицензионный ключ удалён с этого устройства.';
    await getState();
  } catch (error) {
    $('licenseMessage').textContent = error.message || String(error);
  } finally {
    $('removeLicense').disabled = false;
  }
};

$('capture').onclick = async () => {
  $('capture').disabled = true;
  const captureTarget = $('captureTarget').value;
  setStatus(captureTarget === 'copy'
    ? 'Запускаю сбор в рабочей копии…'
    : 'Запускаю сбор в текущей вкладке…');
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_CAPTURE_CURRENT',
      captureTarget
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось запустить сбор.');
    render({
      ...state,
      job: result.job,
      archive: state?.archive || null,
      unfinishedPass: null
    });
    startPolling();
  } catch (error) {
    setStatus(error.message || String(error), true);
    $('capture').disabled = false;
  }
};

$('continue').onclick = async () => {
  $('continue').disabled = true;
  setStatus(
    $('docUrl').value.trim()
      ? 'Ищу последний сохранённый стык; новые сообщения добавлю в указанный Google Doc…'
      : 'Ищу последний сохранённый стык и добираю только новое…'
  );
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_CONTINUE_CURRENT',
      docUrl: $('docUrl').value.trim(),
      captureTarget: $('captureTarget').value
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось продолжить архив.');
    render({
      ...state,
      job: result.job,
      archive: state?.archive || null,
      unfinishedPass: null,
      canContinue: true,
      linkedDoc: result.linkedDoc || state?.linkedDoc || null
    });
    startPolling();
  } catch (error) {
    setStatus(error.message || String(error), true);
    $('continue').disabled = false;
  }
};

$('syncDoc').onclick = async () => {
  const docUrl = $('docUrl').value.trim();
  if (!docUrl) {
    setStatus('Для восстановления точки продолжения вставьте ссылку на Google Doc.', true);
    return;
  }

  $('syncDoc').disabled = true;
  $('continue').disabled = true;
  $('capture').disabled = true;
  setStatus('Читаю Google Doc как резервную точку продолжения и ищу его хвост в текущем чате…');

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_SYNC_CURRENT',
      docUrl,
      captureTarget: $('captureTarget').value
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось восстановить стык по Google Doc.');
    render({
      ...state,
      job: result.job,
      archive: result.archive || state?.archive || null,
      unfinishedPass: null,
      canContinue: true,
      linkedDoc: result.linkedDoc || state?.linkedDoc || null
    });
    startPolling();
  } catch (error) {
    setStatus(error.message || String(error), true);
    $('syncDoc').disabled = false;
    $('continue').disabled = false;
    $('capture').disabled = false;
  }
};

$('retryCurrent').onclick = async () => {
  const latestUnfinished = (state?.unfinishedPasses || [])[0] || null;
  $('retryCurrent').disabled = true;

  if (latestUnfinished?.id) {
    try {
      setStatus('Продолжаю незавершённый сбор…');
      const result = await chrome.runtime.sendMessage({
        type: 'ARCHIVER_RESUME_UNFINISHED_PASS',
        passId: latestUnfinished.id,
        captureTarget: $('captureTarget').value
      });
      if (!result?.ok) throw new Error(result?.error || 'Не удалось продолжить незавершённый сбор.');
      render({ ...state, job: result.job });
      startPolling();
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      $('retryCurrent').disabled = false;
    }
    return;
  }

  const previousMode = state?.job?.captureMode || 'full';
  $('captureTarget').value = 'current';
  updateCaptureTargetHint('current');

  try {
    let result;
    if (previousMode === 'sync') {
      const docUrl = $('docUrl').value.trim();
      if (!docUrl) throw new Error('Для восстановления по Google Doc нужна ссылка.');
      setStatus('Повторяю восстановление в текущей вкладке…');
      result = await chrome.runtime.sendMessage({
        type: 'ARCHIVER_SYNC_CURRENT',
        docUrl,
        captureTarget: 'current'
      });
    } else if (previousMode === 'continue') {
      setStatus('Повторяю продолжение в текущей вкладке…');
      result = await chrome.runtime.sendMessage({
        type: 'ARCHIVER_CONTINUE_CURRENT',
        docUrl: $('docUrl').value.trim(),
        captureTarget: 'current'
      });
    } else if (previousMode === 'images') {
      setStatus('Повторяю добор изображений в текущей вкладке…');
      result = await chrome.runtime.sendMessage({
        type: 'ARCHIVER_RECOVER_IMAGES_CURRENT',
        captureTarget: 'current'
      });
    } else {
      setStatus('Повторяю полный сбор в текущей вкладке…');
      result = await chrome.runtime.sendMessage({
        type: 'ARCHIVER_CAPTURE_CURRENT',
        captureTarget: 'current'
      });
    }

    if (!result?.ok) throw new Error(result?.error || 'Не удалось запустить сбор.');
    render({
      ...state,
      job: result.job,
      archive: state?.archive || null,
      unfinishedPass: null
    });
    startPolling();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('retryCurrent').disabled = false;
  }
};

$('pauseCapture').onclick = async () => {
  $('pauseCapture').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_PAUSE_CAPTURE',
      jobId: state?.job?.jobId
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось поставить сбор на паузу.');
    await getState();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('pauseCapture').disabled = false;
  }
};

$('resumeCapture').onclick = async () => {
  $('resumeCapture').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_RESUME_CAPTURE',
      jobId: state?.job?.jobId
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось продолжить сбор.');
    await getState();
    startPolling();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('resumeCapture').disabled = false;
  }
};

$('cancel').onclick = async () => {
  $('cancel').disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'ARCHIVER_CANCEL_CAPTURE', jobId: state?.job?.jobId });
    await getState();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('cancel').disabled = false;
  }
};

$('resetCapture').onclick = async () => {
  $('resetCapture').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ARCHIVER_RESET_CAPTURE_STATE' });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось сбросить состояние запуска.');
    await getState();
    setStatus('Состояние последнего запуска сброшено. Завершённый архив и история сохранены.');
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('resetCapture').disabled = false;
  }
};

$('clearHistory').onclick = async () => {
  $('clearHistory').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ARCHIVER_CLEAR_RUN_HISTORY' });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось очистить историю.');
    await getState();
    setStatus('История запусков очищена.');
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('clearHistory').disabled = false;
  }
};
$('recoverImages').onclick = async () => {
  if (!state?.archive) {
    setStatus('Сначала нужен локальный архив этого чата.', true);
    return;
  }
  $('recoverImages').disabled = true;
  setStatus('Повторно прохожу чат и добираю только изображения…');
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_RECOVER_IMAGES_CURRENT',
      captureTarget: $('captureTarget').value
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось запустить добор изображений.');
    render({
      ...state,
      job: result.job,
      archive: state?.archive || null,
      unfinishedPass: null,
      canContinue: true
    });
    startPolling();
  } catch (error) {
    setStatus(error.message || String(error), true);
    $('recoverImages').disabled = false;
  }
};

$('patchRecoveredImages').onclick = async () => {
  if (!state?.archive) {
    setStatus('Нет локального архива для довставки картинок.', true);
    return;
  }
  if (!state?.linkedDoc?.url) {
    setStatus('У этого чата нет связанного Google Doc.', true);
    return;
  }

  $('patchRecoveredImages').disabled = true;
  setStatus('Ищу сообщения в связанном Google Doc и довставляю только добранные картинки…');
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_PATCH_RECOVERED_IMAGES',
      archiveId: state.archive.id
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось довставить изображения.');
    if (result.noChanges) {
      setStatus('Новых добранных картинок для этого Google Doc нет.');
    } else {
      setStatus(
        `Довставка завершена: ${result.inserted || 0} изображений вставлено` +
        (result.failed ? `, ${result.failed} не вставлено.` : '.')
      );
    }
    await getState();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('patchRecoveredImages').disabled = false;
  }
};

$('copyArchive').onclick = async () => {
  $('copyArchive').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_COPY_ARCHIVE',
      archiveId: state?.archive?.id
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось скопировать архив.');
    setStatus('Архив скопирован: ' + (result.count || 0) + ' сообщений.');
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('copyArchive').disabled = false;
  }
};

$('openFailedCapture').onclick = async () => {
  $('openFailedCapture').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ARCHIVER_FOCUS_FAILED_CAPTURE_TAB' });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось открыть вкладку сбора.');
    setStatus('Рабочая вкладка открыта. При необходимости домотайте её ближе к месту обрыва, затем нажмите «Найти стык и продолжить».');
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('openFailedCapture').disabled = false;
  }
};

$('resumeFailedCapture').onclick = async () => {
  $('resumeFailedCapture').disabled = true;
  try {
    setStatus('Возвращаю сохранённую рабочую вкладку к началу без пересчёта сообщений; затем повторю только проход вниз…');
    const result = await chrome.runtime.sendMessage({ type: 'ARCHIVER_RESUME_FAILED_CAPTURE' });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось повторить хронологический проход.');
    await getState();
    startPolling();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('resumeFailedCapture').disabled = false;
  }
};

$('deleteDraft').onclick = async () => {
  const draft = state?.draft;
  if (!draft) return;
  if (!confirm('Удалить этот незавершённый проход? Сохранённая рабочая вкладка этого прохода тоже будет закрыта.')) return;

  $('deleteDraft').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_DELETE_UNFINISHED_PASS',
      passId: draft.id
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось удалить незавершённый проход.');
    await getState();
    setStatus('Незавершённый проход удалён.');
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('deleteDraft').disabled = false;
  }
};

$('deleteArchive').onclick = async () => {
  const archive = state?.archive;
  if (!archive) return;
  if (!confirm('Удалить этот локальный архив? Связанный Google Doc удалён не будет.')) return;

  $('deleteArchive').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_DELETE_ARCHIVE',
      archiveId: archive.id
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось удалить локальный архив.');
    await getState();
    setStatus('Локальный архив удалён. Связанный Google Doc, если он был, не изменён.');
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('deleteArchive').disabled = false;
  }
};

$('viewDraft').onclick = async () => {
  const passId = (state?.unfinishedPass || state?.draft)?.id;
  if (!passId) return;
  const url = chrome.runtime.getURL('unfinished.html?passId=' + encodeURIComponent(passId));
  await chrome.tabs.create({ url });
};

$('copyDraft').onclick = async () => {
  $('copyDraft').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ARCHIVER_COPY_UNFINISHED_PASS',
      passId: (state?.unfinishedPass || state?.draft)?.id
    });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось скопировать незавершённый проход.');
    setStatus('Незавершённый проход скопирован: ' + (result.count || 0) + ' сообщений.');
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('copyDraft').disabled = false;
  }
};

$('copyRunLog').onclick = async () => {
  $('copyRunLog').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ARCHIVER_COPY_RUN_LOG' });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось скопировать лог.');
    setStatus('Лог последнего запуска скопирован.');
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('copyRunLog').disabled = false;
  }
};


$('openPlanner').onclick = async () => {
  $('openPlanner').disabled = true;
  try {
    const archiveId = state?.archive?.id || '';
    const url = chrome.runtime.getURL(
      'planner.html' + (archiveId ? '?archiveId=' + encodeURIComponent(archiveId) : '')
    );
    await chrome.tabs.create({ url });
    setStatus('Открыла разметку архива в отдельной вкладке.');
  } catch (error) {
    setStatus(error.message || String(error), true);
    $('openPlanner').disabled = false;
  }
};

$('newDoc').onclick = async () => {
  $('newDoc').disabled = true;
  setStatus('Открываю Google Docs и вставляю переписку…');
  try {
    const result = await exportToDoc('ARCHIVER_EXPORT_NEW_DOC', { archiveId: state?.archive?.id || '' });
    const imagePart = (result.imageInsertedCount || result.imageFailedCount)
      ? ` Изображения: ${result.imageInsertedCount || 0} вставлено, ${result.imageFailedCount || 0} ошибок.`
      : '';
    setStatus(`Готово. В новый Google Doc вставлено ${result.addedCount || 0} сообщений.` + imagePart);
    await getState();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('newDoc').disabled = false;
  }
};

$('activeDoc').onclick = async () => {
  $('activeDoc').disabled = true;
  setStatus('Проверяю, что уже вставлено в этот Google Doc…');
  try {
    const result = await exportToDoc('ARCHIVER_EXPORT_ACTIVE_DOC', { archiveId: state?.archive?.id || '' });
    if (result.noChanges) {
      setStatus('В этом Google Doc уже есть все сообщения из локального архива.');
    } else if (result.exportMode === 'delta') {
      const imagePart = (result.imageInsertedCount || result.imageFailedCount)
        ? ` Изображения: ${result.imageInsertedCount || 0} вставлено, ${result.imageFailedCount || 0} ошибок.`
        : '';
      setStatus(`Готово. В конец документа добавлено ${result.addedCount || 0} новых сообщений.` + imagePart);
    } else {
      const imagePart = (result.imageInsertedCount || result.imageFailedCount)
        ? ` Изображения: ${result.imageInsertedCount || 0} вставлено, ${result.imageFailedCount || 0} ошибок.`
        : '';
      setStatus(`Готово. В документ вставлен полный архив: ${result.addedCount || 0} сообщений.` + imagePart);
    }
    await getState();
    await showWhatsNewIfNeeded();
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    $('activeDoc').disabled = false;
  }
};

$('captureInfoToggle').onclick = () => {
  const panel = $('captureInfo');
  const button = $('captureInfoToggle');
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !opening);
  button.setAttribute('aria-expanded', opening ? 'true' : 'false');
};

$('userName').oninput = e => saveSettings({ userName: e.target.value });
$('assistantName').oninput = e => saveSettings({ assistantName: e.target.value });
$('alignUserRight').onchange = e => saveSettings({ alignUserRight: e.target.checked });
$('captureTarget').onchange = e => {
  updateCaptureTargetHint(e.target.value);
  saveSettings({ captureTarget: e.target.value }, null);
};

async function saveInterfaceAppearanceFromControls() {
  const appearance = readInterfaceAppearanceControls();
  await saveSettings(
    { interfaceAppearance: appearance, palette: appearance.palette },
    'interfaceSettingsSaved'
  );
  renderInterfaceAppearanceControls({ interfaceAppearance: appearance });
}

$('interfacePalette').onchange = async () => {
  updateInterfaceControlVisibility();
  previewInterfaceAppearance();
  await saveInterfaceAppearanceFromControls();
};

$('interfaceFontPreset').onchange = async () => {
  updateInterfaceControlVisibility();
  previewInterfaceAppearance();
  await saveInterfaceAppearanceFromControls();
};

for (const id of ['interfaceAccent', 'interfaceBackground', 'interfacePanel', 'interfaceText']) {
  $(id).oninput = previewInterfaceAppearance;
  $(id).onchange = () => saveInterfaceAppearanceFromControls().catch(error => {
    setStatus(error.message || String(error), true);
  });
}

$('resetInterfaceAppearance').onclick = async () => {
  const appearance = {
    ...DEFAULT_INTERFACE_APPEARANCE,
    colors: { ...DEFAULT_INTERFACE_APPEARANCE.colors }
  };
  renderInterfaceAppearanceControls({ interfaceAppearance: appearance });
  await saveSettings(
    { interfaceAppearance: appearance, palette: appearance.palette },
    'interfaceSettingsSaved'
  );
};

const TOUR_STORAGE_KEY = 'archiverIntroSeen';
const WHATS_NEW_PENDING_KEY = 'archiverWhatsNewPending';
const TOUR_STEPS = [
  {
    selector: '#captureTarget',
    title: 'Выберите, где собирать',
    text: 'Фоновый режим собирает чат в отдельной рабочей вкладке и оставляет исходный диалог свободным. Текущая вкладка — резервный вариант.'
  },
  {
    selector: '#capture',
    title: 'Запустите сбор',
    text: 'Нажмите «Собрать чат». Архиватор зафиксирует конец переписки, дойдёт до начала и соберёт сообщения в хронологическом порядке.'
  },
  {
    selector: '',
    title: 'Оборванный проход не пропадает',
    text: 'Если сбор прервётся после сохранения части сообщений, появится отдельный незавершённый проход. Его можно продолжить, просмотреть, скопировать или удалить.'
  },
  {
    selector: '#savedArchivesPanel > summary',
    title: 'Готовые чаты — в одном списке',
    text: 'Здесь можно продолжить чат, скопировать его, сохранить в Google Docs или разбить по темам.'
  },
  {
    selector: '.accessibility-options > summary',
    title: 'Настройте подписи',
    text: 'Здесь можно изменить имена пользователя и ChatGPT в сохранённом тексте и выровнять реплики пользователя справа.'
  },
  {
    selector: '.settings-menu > summary',
    title: 'Оформление',
    text: 'Шестерёнка открывает настройки темы и шрифта.'
  },
  {
    selector: '.help-menu > summary',
    title: 'Справка всегда рядом',
    text: 'Знак вопроса открывает справку: здесь можно снова запустить знакомство, открыть полную инструкцию и скопировать контакт разработчика.'
  }
];
let tourIndex = 0;
let tourOpenedDetails = null;

function closeTourOpenedDetails() {
  if (tourOpenedDetails) {
    tourOpenedDetails.open = false;
    tourOpenedDetails = null;
  }
}

function clearTourTarget() {
  document.querySelectorAll('.tour-target').forEach(node => node.classList.remove('tour-target'));
  const spotlight = $('tourSpotlight');
  if (spotlight) spotlight.classList.add('hidden');
}

function positionTour(target) {
  const overlay = $('tourOverlay');
  const card = document.querySelector('.tour-card');
  if (!overlay || !card) return;

  const margin = 12;
  const interfaceWidth = 430;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const availableRail = Math.max(240, vw - interfaceWidth - margin * 2);
  const cardWidth = Math.min(280, availableRail);

  card.style.width = cardWidth + 'px';
  card.style.left = Math.max(interfaceWidth + margin, vw - cardWidth - margin) + 'px';

  const cr = card.getBoundingClientRect();
  const preferredTop = target ? target.getBoundingClientRect().top : Math.round((vh - cr.height) / 2);
  const top = Math.max(margin, Math.min(vh - cr.height - margin, preferredTop));
  card.style.top = top + 'px';
}

function renderTourStep() {
  const overlay = $('tourOverlay');
  const step = TOUR_STEPS[tourIndex];
  if (!overlay || !step) return;

  clearTourTarget();
  closeTourOpenedDetails();

  if (step.openDetails) {
    const details = document.querySelector(step.openDetails);
    if (details) {
      details.open = true;
      tourOpenedDetails = details;
    }
  }

  const target = step.selector ? document.querySelector(step.selector) : null;
  if (target && !target.classList.contains('hidden')) {
    target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    target.classList.add('tour-target');
  }

  $('tourStep').textContent = (tourIndex + 1) + ' из ' + TOUR_STEPS.length;
  $('tourTitle').textContent = step.title;
  $('tourText').textContent = step.text;
  $('tourPrev').disabled = tourIndex === 0;
  $('tourNext').textContent = tourIndex === TOUR_STEPS.length - 1 ? 'Готово' : 'Далее';

  requestAnimationFrame(() => positionTour(target && !target.classList.contains('hidden') ? target : null));
}

async function openTour() {
  tourIndex = 0;
  document.querySelectorAll('.header-menu[open]').forEach(details => {
    details.open = false;
  });
  document.body.classList.add('tour-open');
  $('tourOverlay').classList.remove('hidden');
  $('tourOverlay').setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => renderTourStep());
}

async function closeTour(markSeen = true) {
  clearTourTarget();
  closeTourOpenedDetails();
  $('tourOverlay').classList.add('hidden');
  $('tourOverlay').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('tour-open');
  if (markSeen) await chrome.storage.local.set({ [TOUR_STORAGE_KEY]: true });
}

const WHATS_NEW_COPY = {
  '0.3.47': [
    'После оборванного сбора Архиватор предлагает продолжить сохранённый проход, а не начинать заново.',
    'Знакомство больше не размывает интерфейс и подсвечивает сам элемент управления.'
  ],
  '0.3.46': [
    'Незавершённый сбор можно продолжить прямо из списка.',
    'В «Сохранённых архивах» видно, перенесён ли чат в документ. Можно отметить это вручную и добавить любую ссылку.',
    'Знакомство точнее подсвечивает элементы интерфейса.'
  ]
};

async function showWhatsNewIfNeeded() {
  const result = await chrome.storage.local.get(WHATS_NEW_PENDING_KEY);
  const pending = result[WHATS_NEW_PENDING_KEY];
  if (!pending?.version) return;

  const items = WHATS_NEW_COPY[pending.version] || ['Расширение обновлено. Изменения перечислены в журнале версии.'];
  $('whatsNewTitle').textContent = 'Новое в ' + pending.version;
  const list = $('whatsNewList');
  list.textContent = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }
  $('whatsNew').classList.remove('hidden');
}

$('dismissWhatsNew').onclick = async () => {
  $('whatsNew').classList.add('hidden');
  await chrome.storage.local.remove(WHATS_NEW_PENDING_KEY);
};

$('showTour').onclick = () => openTour();
$('tourSkip').onclick = () => closeTour(true);
$('tourPrev').onclick = () => {
  if (tourIndex > 0) {
    tourIndex--;
    renderTourStep();
  }
};
$('tourNext').onclick = () => {
  if (tourIndex >= TOUR_STEPS.length - 1) {
    closeTour(true);
    return;
  }
  tourIndex++;
  renderTourStep();
};

$('copyContact').onclick = async () => {
  const email = 'nekurismarieykjuri@gmail.com';
  try {
    await navigator.clipboard.writeText(email);
    $('contactCopied').textContent = 'Почта скопирована';
    setTimeout(() => { $('contactCopied').textContent = ''; }, 1200);
  } catch (_) {
    setStatus('Не удалось скопировать почту. Адрес: ' + email, true);
  }
};

$('localVersion').textContent = chrome.runtime.getManifest().version || '—';

$('reloadExtension').addEventListener('click', () => {
  setStatus('Перезагружаю расширение…');
  setTimeout(() => chrome.runtime.reload(), 120);
});

(async () => {
  try {
    const settings = await loadSettings();
    $('userName').value = settings.userName;
    $('assistantName').value = settings.assistantName;
    $('alignUserRight').checked = settings.alignUserRight;
    $('captureTarget').value = settings.captureTarget === 'current' ? 'current' : 'copy';
    updateCaptureTargetHint($('captureTarget').value);
    renderInterfaceAppearanceControls(settings);
    applyInterfaceAppearance(settings);
    await showWhatsNewIfNeeded();
    const result = await getState();
    if (result?.linkedDoc?.url && !$('docUrl').value) $('docUrl').value = result.linkedDoc.url;
    if (result?.job && ['starting', 'running', 'paused'].includes(result.job.status)) startPolling();

    const introState = await chrome.storage.local.get(TOUR_STORAGE_KEY);
    if (!introState[TOUR_STORAGE_KEY]) {
      setTimeout(() => openTour(), 180);
    }
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
})();
