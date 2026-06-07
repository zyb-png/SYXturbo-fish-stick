const state = {
  assets: [],
  pollingTimer: null,
  lastJson: {},
  history: JSON.parse(localStorage.getItem('manfei_history') || '[]'),
  taskRecords: readLocalJson('manfei_task_records', []).filter(record => (
    record.source === 'submitted' || record.params || record.prompt
  )).map(record => ({ ...record, source: 'submitted' })),
  logs: JSON.parse(localStorage.getItem('manfei_logs') || '[]'),
  resources: readLocalJson('manfei_resources', []),
  promptPresets: JSON.parse(localStorage.getItem('manfei_prompt_presets') || '[]'),
  activeTab: 'tasks',
  mentionResults: [],
  mentionIndex: 0,
  mentionRange: null,
  expandedResourceGroupId: null,
  activeResourceGroupId: localStorage.getItem('manfei_active_resource_group') || null,
  filePickerTarget: 'library',
};

const $ = (id) => document.getElementById(id);
let resourceSaveChain = Promise.resolve(true);

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function readLocalJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

const roles = {
  image_url: 'reference_image',
  video_url: 'reference_video',
  audio_url: 'reference_audio',
};

const labels = {
  image_url: '图片',
  video_url: '视频',
  audio_url: '音频',
};

document.addEventListener('DOMContentLoaded', async () => {
  localStorage.setItem('manfei_task_records', JSON.stringify(state.taskRecords));
  bindEvents();
  renderAssets();
  renderHistory();
  renderTaskRecords();
  renderLogs();
  switchSideTab(state.activeTab);
  renderResources();
  renderPromptPresets();
  syncResolution();
  await restoreResourcesFromServer();
  addLog('info', '页面已就绪', '本地代理与页面脚本加载完成');
});

function bindEvents() {
  $('model').addEventListener('change', syncResolution);
  $('duration').addEventListener('change', normalizeDuration);
  $('clearAssetsBtn').addEventListener('click', () => {
    state.assets = [];
    renderAssets();
  });
  $('submitBtn').addEventListener('click', submitTask);
  $('fillDemoBtn').addEventListener('click', fillDemo);
  $('queryBtn').addEventListener('click', () => queryTask($('taskId').value.trim()));
  $('cancelBtn').addEventListener('click', cancelTask);
  $('balanceBtn').addEventListener('click', getBalance);
  $('usageBtn').addEventListener('click', getUsage);
  $('uploadAssetBtn').addEventListener('click', uploadAsset);
  $('queryAssetBtn').addEventListener('click', () => queryAsset($('queryAssetId').value.trim()));
  $('pullAssetBtn').addEventListener('click', pullAssetToResource);
  $('createGroupBtn').addEventListener('click', createResourceGroup);
  $('uploadFilesBtn').addEventListener('click', () => openFilePicker('library'));
  $('toggleLibraryToolsBtn').addEventListener('click', toggleLibraryTools);
  $('filePicker').addEventListener('change', (event) => {
    handleLocalFiles([...event.target.files], {
      addToGeneration: state.filePickerTarget === 'generation',
    });
  });
  setupDropZone();
  setupGenerationDropZone();
  $('savePromptBtn').addEventListener('click', saveCurrentPromptPreset);
  $('applyPromptBtn').addEventListener('click', applyPromptPreset);
  $('deletePromptBtn').addEventListener('click', deletePromptPreset);
  $('promptPresetSelect').addEventListener('change', previewPromptPreset);
  setupPromptMentions();
  $('tasksTabBtn').addEventListener('click', () => switchSideTab('tasks'));
  $('logsTabBtn').addEventListener('click', () => switchSideTab('logs'));
  $('historyTabBtn').addEventListener('click', () => switchSideTab('history'));
  $('clearRecordsBtn').addEventListener('click', clearActiveRecords);
  $('copyJsonBtn').addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(state.lastJson, null, 2));
    setStatus('JSON 已复制', 'success');
  });
  $('closePreviewBtn').addEventListener('click', closeVideoPreview);
  document.querySelector('[data-close-preview]').addEventListener('click', closeVideoPreview);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('previewModal').hidden) closeVideoPreview();
  });
}

function saveCurrentPromptPreset() {
  const prompt = $('prompt').value.trim();
  if (!prompt) return setStatus('请先输入提示词', 'error');
  const defaultName = prompt.slice(0, 24).replace(/\s+/g, ' ');
  const name = window.prompt('给这条提示词起个名字', defaultName) || defaultName;
  const preset = {
    id: createId(),
    name,
    prompt,
    createdAt: new Date().toLocaleString(),
  };
  state.promptPresets.unshift(preset);
  state.promptPresets = state.promptPresets.slice(0, 80);
  savePromptPresets();
  renderPromptPresets();
  $('promptPresetSelect').value = preset.id;
  setStatus(`已保存提示词：${name}`, 'success');
  addLog('info', `保存提示词：${name}`, prompt.slice(0, 180));
}

function renderPromptPresets() {
  const select = $('promptPresetSelect');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">选择复用提示词</option>';
  state.promptPresets.forEach(preset => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    select.appendChild(option);
  });
  if (state.promptPresets.some(preset => preset.id === current)) {
    select.value = current;
  }
}

function applyPromptPreset() {
  const preset = getSelectedPromptPreset();
  if (!preset) return setStatus('请选择要复用的提示词', 'error');
  $('prompt').value = preset.prompt;
  syncMentionBindings();
  setStatus(`已套用提示词：${preset.name}`, 'success');
  addLog('info', `套用提示词：${preset.name}`, preset.prompt.slice(0, 180));
}

function setupPromptMentions() {
  const prompt = $('prompt');
  Object.defineProperty(prompt, 'value', {
    configurable: true,
    get: getPromptText,
    set: setPromptText,
  });
  prompt.addEventListener('input', () => {
    syncMentionBindings();
    updateMentionMenu();
  });
  prompt.addEventListener('click', updateMentionMenu);
  prompt.addEventListener('keydown', event => {
    if (event.key === '@' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      insertPromptTextAtCaret('@');
      updateMentionMenu();
      return;
    }
    handleMentionKeys(event);
  });
  prompt.addEventListener('paste', event => {
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  });
  prompt.addEventListener('blur', () => {
    window.setTimeout(hideMentionMenu, 140);
  });
}

function getMentionableResources() {
  return state.assets.map(asset => ({
    ...asset,
    id: asset.url.startsWith('asset://') ? asset.url.slice('asset://'.length) : asset.id,
    mentionSourceId: asset.id,
    assetType: labels[asset.type] || '素材',
    groupName: '本次参考素材',
  }));
}

function getMentionName(item) {
  return String(item.name || item.id || '图片')
    .replace(/[\r\n@]/g, ' ')
    .trim()
    .replace(/\s+/g, '_');
}

function getMentionContext() {
  const prompt = $('prompt');
  const selection = window.getSelection();
  if (!selection.rangeCount || !prompt.contains(selection.anchorNode)) return null;
  const caretRange = selection.getRangeAt(0);
  if (!caretRange.collapsed) return null;

  const caret = resolvePromptTextCaret(selection.anchorNode, selection.anchorOffset);
  if (!caret) return null;
  const before = caret.node.textContent.slice(0, caret.offset);
  const match = before.match(/(^|[\s，。！？、；：,.!?;:])@([^\s@\n]*)$/);
  if (!match) return null;
  const query = match[2];
  const replaceRange = document.createRange();
  replaceRange.setStart(caret.node, caret.offset - query.length - 1);
  replaceRange.setEnd(caret.node, caret.offset);
  return {
    query: query.trim().toLowerCase(),
    replaceRange,
  };
}

function insertPromptTextAtCaret(text) {
  const prompt = $('prompt');
  prompt.focus();
  const selection = window.getSelection();
  let range;
  if (selection.rangeCount && prompt.contains(selection.anchorNode)) {
    range = selection.getRangeAt(0);
    range.deleteContents();
  } else {
    range = document.createRange();
    range.selectNodeContents(prompt);
    range.collapse(false);
  }

  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStart(textNode, textNode.textContent.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  prompt.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: text,
  }));
}

function resolvePromptTextCaret(node, offset) {
  if (node.nodeType === Node.TEXT_NODE) return { node, offset };
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const previous = node.childNodes[offset - 1];
  if (previous?.nodeType === Node.TEXT_NODE) {
    return { node: previous, offset: previous.textContent.length };
  }
  const current = node.childNodes[offset];
  if (current?.nodeType === Node.TEXT_NODE) {
    return { node: current, offset: 0 };
  }
  return null;
}

function updateMentionMenu() {
  const context = getMentionContext();
  if (!context) return hideMentionMenu();

  const resources = getMentionableResources();
  state.mentionResults = resources.filter(item => {
    const searchable = `${getMentionName(item)} ${item.id} ${item.groupName || ''}`.toLowerCase();
    return searchable.includes(context.query);
  });
  state.mentionRange = context;
  state.mentionIndex = Math.min(state.mentionIndex, Math.max(0, state.mentionResults.length - 1));
  renderMentionMenu();
}

function renderMentionMenu() {
  const menu = $('mentionMenu');
  if (state.mentionResults.length === 0) {
    menu.innerHTML = '<div class="mention-empty">暂无本次参考素材，请先拖入或从资源库添加</div>';
    menu.hidden = false;
    return;
  }

  menu.innerHTML = '';
  state.mentionResults.forEach((item, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `mention-option${index === state.mentionIndex ? ' active' : ''}`;
    option.innerHTML = `
      ${renderMediaPreview(item.type, item.previewUrl || item.url, item.name)}
      <span>
        <strong>@${escapeHtml(getMentionName(item))}</strong>
        <small>本次参考素材 · ${escapeHtml(item.assetType)} · ${escapeHtml(item.id)}</small>
      </span>
    `;
    option.addEventListener('mousedown', event => {
      event.preventDefault();
      selectMention(index);
    });
    menu.appendChild(option);
  });
  menu.hidden = false;
}

function handleMentionKeys(event) {
  if ($('mentionMenu').hidden) return;
  if (state.mentionResults.length === 0) {
    if (event.key === 'Escape') hideMentionMenu();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    state.mentionIndex = (state.mentionIndex + direction + state.mentionResults.length) % state.mentionResults.length;
    renderMentionMenu();
  } else if ((event.key === 'Enter' || event.key === 'Tab') && state.mentionResults.length > 0) {
    event.preventDefault();
    selectMention(state.mentionIndex);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    hideMentionMenu();
  }
}

function selectMention(index) {
  const item = state.mentionResults[index];
  const range = state.mentionRange;
  if (!item || !range) return;

  const prompt = $('prompt');
  const mention = `@${getMentionName(item)}`;
  const chip = createPromptMentionChip(item);
  const trailingSpace = document.createTextNode(' ');
  range.replaceRange.deleteContents();
  range.replaceRange.insertNode(trailingSpace);
  range.replaceRange.insertNode(chip);

  prompt.focus();
  const selection = window.getSelection();
  const caret = document.createRange();
  caret.setStart(trailingSpace, trailingSpace.textContent.length);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  syncMentionBindings();
  hideMentionMenu();
  setStatus(`已在提示词中引用 ${mention}`, 'success');
}

function createPromptMentionChip(item) {
  const chip = document.createElement('span');
  chip.className = 'prompt-mention-chip';
  chip.contentEditable = 'false';
  chip.dataset.mentionName = getMentionName(item);
  chip.dataset.sourceId = item.mentionSourceId || item.id;
  chip.title = item.name || item.id || '参考素材';

  if (item.type === 'image_url' && item.previewUrl) {
    const image = document.createElement('img');
    image.src = item.previewUrl;
    image.alt = '';
    chip.appendChild(image);
  } else if (item.type === 'video_url' && item.previewUrl) {
    const video = document.createElement('video');
    video.src = item.previewUrl;
    video.muted = true;
    video.preload = 'metadata';
    chip.appendChild(video);
  } else {
    chip.textContent = item.type === 'audio_url' ? '♪' : '◇';
  }
  return chip;
}

function getPromptText() {
  const prompt = $('prompt');
  const readNode = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.classList.contains('prompt-mention-chip')) return `@${node.dataset.mentionName}`;
    if (node.tagName === 'BR') return '\n';
    const text = [...node.childNodes].map(readNode).join('');
    return ['DIV', 'P'].includes(node.tagName) ? `${text}\n` : text;
  };
  return [...prompt.childNodes].map(readNode).join('').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function setPromptText(value) {
  const prompt = $('prompt');
  const text = String(value || '');
  const mentions = getMentionableResources()
    .map(item => ({ item, token: `@${getMentionName(item)}` }))
    .sort((a, b) => b.token.length - a.token.length);
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  while (cursor < text.length) {
    let next = null;
    for (const mention of mentions) {
      const index = text.indexOf(mention.token, cursor);
      if (index >= 0 && (!next || index < next.index || (index === next.index && mention.token.length > next.token.length))) {
        next = { ...mention, index };
      }
    }
    if (!next) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
      break;
    }
    if (next.index > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, next.index)));
    }
    fragment.appendChild(createPromptMentionChip(next.item));
    cursor = next.index + next.token.length;
  }

  prompt.replaceChildren(fragment);
}

function removePromptMention(asset) {
  const chip = $('prompt').querySelector(`.prompt-mention-chip[data-source-id="${CSS.escape(asset.id)}"]`);
  if (chip) chip.remove();
  const token = `@${getMentionName(asset)}`;
  const text = getPromptText();
  if (text.includes(token)) setPromptText(text.replaceAll(token, '').replace(/ {2,}/g, ' '));
}

function hideMentionMenu() {
  const menu = $('mentionMenu');
  menu.hidden = true;
  state.mentionResults = [];
  state.mentionRange = null;
  state.mentionIndex = 0;
}

function syncMentionBindings() {
  // @ 只引用已经存在于“本次参考素材”的项目，不自动增删素材。
}

function normalizeDuration() {
  const input = $('duration');
  const value = Number(input.value);
  input.value = String(Number.isFinite(value) ? Math.min(15, Math.max(4, Math.round(value))) : 5);
}

function previewPromptPreset() {
  const preset = getSelectedPromptPreset();
  if (preset) {
    setStatus(`已选择提示词：${preset.name}`, 'success');
  }
}

function deletePromptPreset() {
  const preset = getSelectedPromptPreset();
  if (!preset) return setStatus('请选择要删除的提示词', 'error');
  if (!window.confirm(`删除提示词「${preset.name}」？`)) return;
  state.promptPresets = state.promptPresets.filter(item => item.id !== preset.id);
  savePromptPresets();
  renderPromptPresets();
  setStatus(`已删除提示词：${preset.name}`, 'success');
  addLog('info', `删除提示词：${preset.name}`, '');
}

function getSelectedPromptPreset() {
  const id = $('promptPresetSelect').value;
  return state.promptPresets.find(item => item.id === id);
}

function savePromptPresets() {
  localStorage.setItem('manfei_prompt_presets', JSON.stringify(state.promptPresets));
}

function setupDropZone() {
  const zone = $('dropZone');
  zone.addEventListener('click', () => openFilePicker('library'));
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragging');
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dragging');
    handleLocalFiles([...event.dataTransfer.files], { addToGeneration: false });
  });
}

function openFilePicker(target) {
  state.filePickerTarget = target;
  $('filePicker').click();
}

function setupGenerationDropZone() {
  const zone = $('generationDropZone');
  const openPicker = () => openFilePicker('generation');
  zone.addEventListener('click', openPicker);
  zone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  });
  zone.addEventListener('dragover', event => {
    event.preventDefault();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', event => {
    event.preventDefault();
    zone.classList.remove('dragging');
    handleLocalFiles([...event.dataTransfer.files], { addToGeneration: true });
  });
}

async function handleLocalFiles(files, options = {}) {
  const accepted = files.filter(file => /^(image|video|audio)\//.test(file.type));
  if (accepted.length === 0) {
    setStatus('请拖入图片、视频或音频文件', 'error');
    return;
  }

  for (const file of accepted) {
    await uploadLocalFileToAsset(file, options);
  }
  $('filePicker').value = '';
  state.filePickerTarget = 'library';
}

async function uploadLocalFileToAsset(file, options = {}) {
  const assetType = inferAssetTypeFromFile(file);
  const assetKind = assetType === 'Video' ? 'video_url' : assetType === 'Audio' ? 'audio_url' : 'image_url';
  setStatus(`正在上传本地文件：${file.name}`, 'running');
  addLog('info', `本地文件上传开始：${file.name}`, `${assetType} · ${(file.size / 1024 / 1024).toFixed(2)}MB`);

  try {
    const dataBase64 = await readFileAsDataUrl(file);
    const objectResult = await apiFetch('/api/upload-object', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        dataBase64,
      }),
    });

    addLog('success', `对象存储上传完成：${file.name}`, objectResult.url);

    const assetResult = await apiFetch('/api/assets', {
      method: 'POST',
      body: JSON.stringify({
        url: objectResult.url,
        asset_type: assetType,
      }),
    });

    const assetId = assetResult.asset_id;
    const assetUrl = `asset://${assetId}`;
    if (options.addToGeneration) {
      state.assets.push({
        id: createId(),
        resourceId: assetId,
        type: assetKind,
        url: assetUrl,
        previewUrl: objectResult.url,
        name: file.name,
      });
      renderAssets();
    }
    addResourceToSelectedGroup({
      id: assetId,
      assetType,
      url: objectResult.url,
      name: file.name,
      status: 'Created',
      createdAt: new Date().toLocaleString(),
      raw: assetResult,
    });
    $('queryAssetId').value = assetId;
    showJson({ object: objectResult, asset: assetResult });
    setStatus(
      options.addToGeneration
        ? `已加入资源组和本次参考素材：${assetUrl}`
        : `已上传到资源组：${assetUrl}`,
      'success'
    );
    addLog('success', `asset 创建完成：${assetId}`, assetUrl);
  } catch (error) {
    setStatus(error.message, 'error');
    addLog('error', `本地文件处理失败：${file.name}`, error.message);
  }
}

function inferAssetTypeFromFile(file) {
  if (file.type.startsWith('video/')) return 'Video';
  if (file.type.startsWith('audio/')) return 'Audio';
  return 'Image';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取本地文件失败'));
    reader.readAsDataURL(file);
  });
}

function syncResolution() {
  const model = $('model').value;
  const resolution = $('resolution');
  const old = resolution.value;
  resolution.innerHTML = '';
  const values = model === 'moon-manfei-new' ? ['480p', '720p'] : ['480p', '720p', '1080p'];
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    resolution.appendChild(option);
  }
  resolution.value = values.includes(old) ? old : '720p';
}

function addAsset() {
  const type = $('assetKind').value;
  const url = $('assetUrl').value.trim();
  if (!url) return setStatus('请填写素材 URL 或 asset://id', 'error');

  const limits = { image_url: 9, video_url: 3, audio_url: 3 };
  const count = state.assets.filter(item => item.type === type).length;
  if (count >= limits[type]) {
    return setStatus(`${labels[type]}最多 ${limits[type]} 个`, 'error');
  }

  state.assets.push({
    id: createId(),
    type,
    url,
    previewUrl: url.startsWith('asset://') ? '' : url,
    name: url.startsWith('asset://') ? '' : getFileNameFromUrl(url),
  });
  $('assetUrl').value = '';
  renderAssets();
}

function renderAssets() {
  const list = $('assetList');
  if (state.assets.length === 0) {
    list.className = 'asset-list empty';
    list.textContent = '暂无参考素材';
    return;
  }

  list.className = 'asset-list';
  list.innerHTML = '';
  state.assets.forEach((asset, index) => {
    const row = document.createElement('div');
    row.className = 'asset-item';
    const assetId = asset.url.startsWith('asset://') ? asset.url.slice('asset://'.length) : asset.url;
    row.title = `${index + 1}. ${asset.name || labels[asset.type]}\n${assetId}`;
    row.innerHTML = `
      ${renderMediaPreview(asset.type, asset.previewUrl, asset.name)}
      <span class="asset-index">${index + 1}</span>
      <div class="asset-id-overlay">${escapeHtml(asset.name || labels[asset.type] || '参考素材')}</div>
      <button class="asset-remove-button" type="button" title="清除此参考素材" aria-label="清除此参考素材">×</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      removePromptMention(asset);
      state.assets = state.assets.filter(item => item.id !== asset.id);
      renderAssets();
      hideMentionMenu();
    });
    list.appendChild(row);
  });
}

function buildContent() {
  const prompt = $('prompt').value.trim();
  if (!prompt) throw new Error('请输入提示词');

  const content = [{ type: 'text', text: prompt }];
  for (const asset of state.assets) {
    const key = asset.type;
    content.push({
      type: key,
      [key]: { url: asset.url },
      role: roles[key],
    });
  }
  return content;
}

function buildRequestBody() {
  const duration = Number($('duration').value || 5);
  if (!Number.isFinite(duration) || duration < 4 || duration > 15) {
    throw new Error('视频时长必须为 4–15 秒');
  }
  return {
    model: $('model').value,
    content: buildContent(),
    duration,
    ratio: $('ratio').value,
    watermark: $('watermark').checked,
    resolution: $('resolution').value,
  };
}

async function submitTask() {
  clearPolling();
  const isSync = $('syncMode').checked;
  const btn = $('submitBtn');
  btn.disabled = true;
  setStatus(isSync ? '正在同步生成...' : '正在创建异步任务...', 'running');
  addLog('info', isSync ? '同步生成开始' : '异步任务提交开始', $('prompt').value.trim().slice(0, 160));

  try {
    const body = buildRequestBody();
    if (isSync) {
      body.poll_interval_seconds = Number($('pollInterval').value || 2);
      body.timeout_seconds = Number($('timeoutSeconds').value || 600);
    }

    const result = await apiFetch(isSync ? '/api/video/tasks/generate' : '/api/video/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    showJson(result);
    const taskId = result.id || result.task_id || result.detail?.task_id;
    if (taskId) $('taskId').value = taskId;
    if (taskId) {
      upsertTaskRecord({
        id: taskId,
        source: 'submitted',
        status: result.status || 'queued',
        model: body.model,
        prompt: $('prompt').value.trim(),
        params: body,
        createdAt: new Date().toLocaleString(),
        createdAtMs: Date.now(),
        updatedAt: new Date().toLocaleString(),
        response: result,
      }, { allowCreate: true });
      addLog('success', `任务已提交：${taskId}`, JSON.stringify({ model: body.model, ratio: body.ratio, duration: body.duration, resolution: body.resolution }, null, 2));
    }

    if (result.status === 'succeeded') {
      handleVideoResult(result);
    } else if (taskId) {
      setStatus(`任务已创建：${taskId}，开始轮询`, 'running');
      startPolling(taskId);
    } else {
      setStatus('任务已提交，但响应中没有任务 ID', 'error');
    }
  } catch (error) {
    setStatus(error.message, 'error');
    showJson({ error: error.message });
    addLog('error', '任务提交失败', error.message);
  } finally {
    btn.disabled = false;
  }
}

function startPolling(taskId) {
  clearPolling();
  const interval = Math.max(1000, Number($('pollInterval').value || 2) * 1000);
  state.pollingTimer = setInterval(() => queryTask(taskId, { quiet: true }), interval);
  queryTask(taskId, { quiet: true });
}

async function queryTask(taskId, options = {}) {
  if (!taskId) return setStatus('请输入任务 ID', 'error');
  if (!options.quiet) setStatus(`正在查询：${taskId}`, 'running');

  try {
    const previousRecord = state.taskRecords.find(record => record.id === taskId);
    const wasCompleted = previousRecord?.status === 'succeeded';
    const result = await apiFetch(`/api/video/tasks/${encodeURIComponent(taskId)}`);
    showJson(result);

    const status = result.status;
    updateSubmittedTaskRecord({
      id: taskId,
      status: status || 'unknown',
      model: result.model,
      updatedAt: new Date().toLocaleString(),
      completedAtMs: status === 'succeeded' ? (previousRecord?.completedAtMs || Date.now()) : previousRecord?.completedAtMs,
      response: result,
      videoUrl: result.content?.video_url || result.video_url || result.url,
    });
    if (!options.quiet) {
      addLog('info', `任务查询：${taskId}`, `状态：${status || 'unknown'}`);
    }
    if (status === 'succeeded') {
      clearPolling();
      handleVideoResult(result, { notify: !wasCompleted });
      addLog('success', `任务完成：${taskId}`, result.content?.video_url || result.video_url || '');
    } else if (['failed', 'cancelled', 'expired'].includes(status)) {
      clearPolling();
      setStatus(`任务结束：${status}`, 'error');
      addLog('error', `任务结束：${taskId}`, status);
    } else {
      setStatus(`任务状态：${status || 'unknown'}`, 'running');
    }
  } catch (error) {
    if (!options.quiet) setStatus(error.message, 'error');
    showJson({ error: error.message });
    if (!options.quiet) addLog('error', `任务查询失败：${taskId}`, error.message);
  }
}

async function cancelTask() {
  const taskId = $('taskId').value.trim();
  if (!taskId) return setStatus('请输入任务 ID', 'error');
  clearPolling();

  try {
    const result = await apiFetch(`/api/video/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
    showJson(result);
    setStatus(`已发送取消请求：${taskId}`, 'success');
    updateSubmittedTaskRecord({
      id: taskId,
      status: 'cancel_requested',
      updatedAt: new Date().toLocaleString(),
      response: result,
    });
    addLog('info', `取消任务：${taskId}`, JSON.stringify(result, null, 2));
  } catch (error) {
    setStatus(error.message, 'error');
    addLog('error', `取消失败：${taskId}`, error.message);
  }
}

function handleVideoResult(result, options = {}) {
  const videoUrl = result.content?.video_url || result.video_url || result.url;
  if (!videoUrl) {
    setStatus('任务成功，但响应中没有 video_url', 'error');
    return;
  }

  const taskId = result.id || result.task_id || $('taskId').value.trim();
  setStatus('视频生成成功', 'success');
  updateSubmittedTaskRecord({
    id: taskId,
    status: 'succeeded',
    model: result.model || $('model').value,
    videoUrl,
    updatedAt: new Date().toLocaleString(),
    completedAtMs: Date.now(),
    response: result,
  });
  addHistory({
    id: taskId,
    videoUrl,
    model: result.model || $('model').value,
    time: new Date().toLocaleString(),
    prompt: $('prompt').value.trim(),
  });
  if (options.notify !== false) showTaskCompletionToast(taskId);
}

async function uploadAsset() {
  const url = $('uploadAssetUrl').value.trim();
  const assetType = $('uploadAssetType').value;
  if (!url) return setStatus('请填写素材 URL', 'error');

  try {
    const result = await apiFetch('/api/assets', {
      method: 'POST',
      body: JSON.stringify({ url, asset_type: assetType }),
    });
    showJson(result);
    const assetUrl = `asset://${result.asset_id}`;
    $('queryAssetId').value = result.asset_id || '';
    setStatus(`素材已上传：${assetUrl}`, 'success');
    addResourceToSelectedGroup({
      id: result.asset_id,
      assetType,
      url,
      name: getFileNameFromUrl(url),
      status: 'Created',
      createdAt: new Date().toLocaleString(),
    });
    addLog('success', `素材创建成功：${result.asset_id}`, `${assetType} · ${url}`);
  } catch (error) {
    setStatus(error.message, 'error');
    addLog('error', '素材创建失败', error.message);
  }
}

async function queryAsset(assetId) {
  if (!assetId) return setStatus('请输入 asset-id', 'error');
  try {
    const result = await apiFetch(`/api/assets/${encodeURIComponent(assetId)}`);
    showJson(result);
    setStatus(`素材状态：${result.status || 'unknown'}`, 'success');
    addLog('info', `素材查询：${assetId}`, JSON.stringify(result, null, 2));
  } catch (error) {
    setStatus(error.message, 'error');
    addLog('error', `素材查询失败：${assetId}`, error.message);
  }
}

async function getBalance() {
  try {
    const result = await apiFetch('/api/me');
    showJson(result);
    setStatus(`余额：${result.balance_rmb ?? '-'} 元`, 'success');
    addLog('info', '余额查询', `${result.balance_rmb ?? '-'} 元`);
  } catch (error) {
    setStatus(error.message, 'error');
    addLog('error', '余额查询失败', error.message);
  }
}

async function getUsage() {
  try {
    const result = await apiFetch('/api/usage?limit=20&charged_only=true');
    showJson(result);
    setStatus(`用量记录：${result.items?.length ?? 0} 条`, 'success');
    addLog('info', '用量查询', `${result.items?.length ?? 0} 条记录`);
  } catch (error) {
    setStatus(error.message, 'error');
    addLog('error', '用量查询失败', error.message);
  }
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(data.detail?.message || data.error || data.message || `HTTP ${response.status}`);
  }
  return data;
}

function showJson(value) {
  state.lastJson = value;
  $('jsonOut').textContent = JSON.stringify(value, null, 2);
}

function setStatus(message, type = 'idle') {
  $('statusLine').textContent = message;
  $('statusLine').className = `status ${type}`;
}

function clearPolling() {
  if (state.pollingTimer) clearInterval(state.pollingTimer);
  state.pollingTimer = null;
}

function addHistory(item) {
  const existingIndex = state.history.findIndex(historyItem => historyItem.id === item.id);
  if (existingIndex >= 0) state.history.splice(existingIndex, 1);
  state.history.unshift(item);
  state.history = state.history.slice(0, 20);
  saveHistory();
  renderHistory();
}

function saveHistory() {
  localStorage.setItem('manfei_history', JSON.stringify(state.history));
}

function switchSideTab(tab) {
  state.activeTab = tab;
  const views = {
    tasks: { button: $('tasksTabBtn'), panel: $('taskRecords') },
    logs: { button: $('logsTabBtn'), panel: $('logRecords') },
    history: { button: $('historyTabBtn'), panel: $('history') },
  };
  Object.entries(views).forEach(([name, view]) => {
    const active = name === tab;
    view.button.classList.toggle('active', active);
    view.button.setAttribute('aria-selected', String(active));
    view.panel.hidden = !active;
    view.panel.classList.toggle('active-record-view', active);
  });
  $('taskQueryControls').hidden = tab !== 'tasks';
}

function clearActiveRecords() {
  if (state.activeTab === 'tasks') {
    state.taskRecords = [];
    localStorage.setItem('manfei_task_records', '[]');
    renderTaskRecords();
    addLog('info', '已清空任务记录', '');
  } else if (state.activeTab === 'logs') {
    state.logs = [];
    localStorage.setItem('manfei_logs', '[]');
    renderLogs();
  } else {
    state.history = [];
    saveHistory();
    renderHistory();
  }
}

function upsertTaskRecord(update, options = {}) {
  if (!update.id) return;
  const existing = state.taskRecords.find(item => item.id === update.id);
  if (existing) {
    Object.assign(existing, update);
  } else if (options.allowCreate && update.source === 'submitted') {
    state.taskRecords.unshift({
      id: update.id,
      source: 'submitted',
      status: 'queued',
      createdAt: new Date().toLocaleString(),
      ...update,
    });
  } else {
    return;
  }
  state.taskRecords = state.taskRecords.slice(0, 50);
  localStorage.setItem('manfei_task_records', JSON.stringify(state.taskRecords));
  renderTaskRecords();
}

function updateSubmittedTaskRecord(update) {
  const existing = state.taskRecords.find(record => (
    record.id === update.id && record.source === 'submitted'
  ));
  if (!existing) return false;
  upsertTaskRecord(update);
  return true;
}

function renderTaskRecords() {
  const box = $('taskRecords');
  if (!box) return;
  if (state.taskRecords.length === 0) {
    box.className = `record-list empty${state.activeTab === 'tasks' ? ' active-record-view' : ''}`;
    box.textContent = '暂无任务记录';
    return;
  }
  box.className = `record-list${state.activeTab === 'tasks' ? ' active-record-view' : ''}`;
  box.innerHTML = '';
  state.taskRecords.forEach(record => {
    const row = document.createElement('div');
    const presentation = getTaskPresentation(record.status);
    const elapsed = getTaskElapsed(record);
    row.className = `record-item task-card task-${presentation.tone}`;
    row.innerHTML = `
      <div class="task-card-head">
        <strong title="${escapeHtml(record.id)}">${escapeHtml(shortTaskId(record.id))}</strong>
        <span class="task-state-icon" title="${escapeHtml(presentation.label)}">${presentation.icon}</span>
      </div>
      <div class="task-status-row">
        <span class="task-status-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(presentation.label)}</strong>
        ${elapsed ? `<span>· ${escapeHtml(elapsed)}</span>` : ''}
      </div>
      <div class="task-time">${escapeHtml(record.createdAt || record.updatedAt || '')}</div>
      <div class="record-actions">
        ${record.videoUrl ? '<button class="task-play" type="button" data-action="video">▷ 查看视频</button>' : '<button type="button" data-action="query">↻ 查询</button>'}
        <button type="button" data-action="reuse">↻ 复用</button>
        <button type="button" data-action="json">⚙ 调试</button>
        <button class="task-delete" type="button" data-action="delete" title="删除任务记录" aria-label="删除任务记录">⌫</button>
      </div>
    `;
    const queryBtn = row.querySelector('[data-action="query"]');
    if (queryBtn) {
      queryBtn.addEventListener('click', () => {
        $('taskId').value = record.id;
        queryTask(record.id);
      });
    }
    row.querySelector('[data-action="reuse"]').addEventListener('click', () => reuseTask(record));
    row.querySelector('[data-action="json"]').addEventListener('click', () => {
      openTaskDebug(record);
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', () => {
      state.taskRecords = state.taskRecords.filter(item => item.id !== record.id);
      localStorage.setItem('manfei_task_records', JSON.stringify(state.taskRecords));
      renderTaskRecords();
      setStatus(`已删除任务记录：${record.id}`, 'success');
    });
    const videoBtn = row.querySelector('[data-action="video"]');
    if (videoBtn) {
      videoBtn.addEventListener('click', () => {
        openVideoPreview(record);
      });
    }
    box.appendChild(row);
  });
}

function getTaskPresentation(status = '') {
  const value = String(status).toLowerCase();
  if (value === 'succeeded') return { label: '已完成', tone: 'completed', icon: '✓' };
  if (['running', 'processing', 'in_progress'].includes(value)) return { label: '生成中', tone: 'running', icon: '↻' };
  if (['queued', 'pending', 'created'].includes(value)) return { label: '等待生成', tone: 'queued', icon: '…' };
  if (value === 'failed') return { label: '生成失败', tone: 'failed', icon: '!' };
  if (value === 'cancel_requested') return { label: '取消中', tone: 'cancelled', icon: '…' };
  if (value === 'cancelled') return { label: '已取消', tone: 'cancelled', icon: '×' };
  if (value === 'expired') return { label: '已过期', tone: 'cancelled', icon: '×' };
  return { label: status || '未知状态', tone: 'queued', icon: '…' };
}

function shortTaskId(taskId = '') {
  const value = String(taskId);
  return value.length > 22 ? `${value.slice(0, 19)}...` : value;
}

function getTaskElapsed(record) {
  const started = Number(record.createdAtMs) || Date.parse(record.createdAt || '');
  const finished = Number(record.completedAtMs)
    || (record.status === 'succeeded' ? Date.parse(record.updatedAt || '') : Date.now());
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return '';
  const seconds = Math.max(0, Math.round((finished - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
}

function reuseTask(record) {
  const params = record.params || {};
  restoreTaskReferenceAssets(record);
  if (record.prompt) setPromptText(record.prompt);
  if (record.model || params.model) $('model').value = record.model || params.model;
  syncResolution();
  if (params.resolution) $('resolution').value = params.resolution;
  if (params.ratio) $('ratio').value = params.ratio;
  if (params.duration) $('duration').value = params.duration;
  if (typeof params.watermark === 'boolean') $('watermark').checked = params.watermark;
  $('prompt').dispatchEvent(new Event('input', { bubbles: true }));
  setStatus(`已复用任务参数：${record.id}`, 'success');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function restoreTaskReferenceAssets(record) {
  const content = Array.isArray(record.params?.content) ? record.params.content : [];
  const resourceItems = state.resources.flatMap(group => group.items || []);
  const restored = [];

  content.forEach(entry => {
    const type = entry?.type;
    if (!['image_url', 'video_url', 'audio_url'].includes(type)) return;
    const url = entry[type]?.url || '';
    if (!url) return;
    const assetId = url.startsWith('asset://') ? url.slice('asset://'.length) : '';
    const resource = resourceItems.find(item => item.id === assetId || item.url === url);
    restored.push({
      id: createId(),
      resourceId: resource?.id || assetId || undefined,
      type,
      url,
      previewUrl: resource?.url || (url.startsWith('asset://') ? '' : url),
      name: resource?.name || (url.startsWith('asset://') ? assetId : getFileNameFromUrl(url)),
    });
  });

  if (restored.length > 0) {
    state.assets = restored;
    renderAssets();
  }
}

function openTaskDebug(record) {
  const payload = record.response || record;
  showJson(payload);
  $('previewTitle').textContent = '任务调试';
  $('previewTaskId').textContent = record.id || '';
  $('video').removeAttribute('src');
  $('video').hidden = true;
  $('download').hidden = true;
  $('openVideoLink').hidden = true;
  $('previewModal').hidden = false;
  document.body.classList.add('preview-open');
}

function openVideoPreview(record) {
  showJson(record.response || record);
  $('previewTitle').textContent = '视频预览';
  $('previewTaskId').textContent = record.id || '';
  $('video').src = record.videoUrl;
  $('video').hidden = false;
  $('openVideoLink').href = record.videoUrl;
  $('openVideoLink').hidden = false;
  const filename = `${String(record.id || 'seedance-video').replace(/[^\w.-]+/g, '-')}.mp4`;
  $('download').href = `/api/download-video?url=${encodeURIComponent(record.videoUrl)}&filename=${encodeURIComponent(filename)}`;
  $('download').setAttribute('download', filename);
  $('download').hidden = false;
  $('previewModal').hidden = false;
  document.body.classList.add('preview-open');
  setStatus(`正在预览任务：${record.id}`, 'success');
}

function closeVideoPreview() {
  $('previewModal').hidden = true;
  $('video').pause();
  document.body.classList.remove('preview-open');
}

let taskToastTimer;
function showTaskCompletionToast(taskId) {
  clearTimeout(taskToastTimer);
  $('taskToastText').textContent = `${shortTaskId(taskId)} 已生成，可在任务列表查看视频`;
  $('taskToast').hidden = false;
  taskToastTimer = setTimeout(() => {
    $('taskToast').hidden = true;
  }, 6000);
}

function addLog(level, title, detail = '') {
  state.logs.unshift({
    id: createId(),
    level,
    title,
    detail,
    time: new Date().toLocaleTimeString(),
  });
  state.logs = state.logs.slice(0, 120);
  localStorage.setItem('manfei_logs', JSON.stringify(state.logs));
  renderLogs();
}

function renderLogs() {
  const box = $('logRecords');
  if (!box) return;
  if (state.logs.length === 0) {
    box.className = `record-list empty${state.activeTab === 'logs' ? ' active-record-view' : ''}`;
    box.textContent = '暂无日志';
    return;
  }
  box.className = `record-list${state.activeTab === 'logs' ? ' active-record-view' : ''}`;
  box.innerHTML = '';
  state.logs.forEach(log => {
    const row = document.createElement('div');
    row.className = `record-item log-${log.level}`;
    row.innerHTML = `
      <div class="record-title">
        <strong>${escapeHtml(log.title)}</strong>
        <span>${escapeHtml(log.time)}</span>
      </div>
      ${log.detail ? `<div class="record-meta">${escapeHtml(log.detail).slice(0, 600)}</div>` : ''}
    `;
    box.appendChild(row);
  });
}

function createResourceGroup() {
  const defaultName = `资源组 ${state.resources.length + 1}`;
  const name = window.prompt('资源组名称', defaultName)?.trim();
  if (!name) return;
  const id = createId();
  state.resources.unshift({
    id,
    name,
    items: [],
    createdAt: new Date().toLocaleString(),
  });
  state.expandedResourceGroupId = id;
  setActiveResourceGroup(id);
  saveResources();
  renderResources();
  addLog('info', `新建资源组：${name}`, '');
}

function toggleLibraryTools() {
  const panel = $('libraryToolsPanel');
  const button = $('toggleLibraryToolsBtn');
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  button.setAttribute('aria-expanded', String(willOpen));
  button.setAttribute('aria-label', willOpen ? '收起资源工具' : '展开资源工具');
  button.classList.toggle('active', willOpen);
}

function getSelectedResourceGroup() {
  if (state.resources.length === 0) {
    const id = createId();
    state.resources.unshift({
      id,
      name: '默认资源组',
      items: [],
      createdAt: new Date().toLocaleString(),
    });
    state.expandedResourceGroupId = id;
    setActiveResourceGroup(id);
  }
  const selected = state.resources.find(group => group.id === state.activeResourceGroupId);
  if (selected) return selected;
  setActiveResourceGroup(state.resources[0].id);
  return state.resources[0];
}

function addResourceToSelectedGroup(item) {
  const group = getSelectedResourceGroup();
  group.items.unshift(item);
  state.expandedResourceGroupId = group.id;
  saveResources();
  renderResources();
}

function setActiveResourceGroup(groupId) {
  state.activeResourceGroupId = groupId;
  localStorage.setItem('manfei_active_resource_group', groupId || '');
  updateUploadTarget();
}

function updateUploadTarget() {
  const label = $('uploadTargetName');
  if (!label) return;
  const group = state.resources.find(item => item.id === state.activeResourceGroupId);
  label.textContent = group ? `上传到：${group.name}` : '请先选择资源组';
}

async function pullAssetToResource() {
  const assetId = $('queryAssetId').value.trim();
  if (!assetId) return setStatus('请输入 asset-id', 'error');
  try {
    const result = await apiFetch(`/api/assets/${encodeURIComponent(assetId)}`);
    showJson(result);
    addResourceToSelectedGroup({
      id: result.id || assetId,
      assetType: result.asset_type || 'Asset',
      status: result.status || 'Unknown',
      createdAt: result.created_at || new Date().toLocaleString(),
      raw: result,
    });
    setStatus(`已拉取到资源库：${assetId}`, 'success');
    addLog('success', `拉取资源：${assetId}`, JSON.stringify(result, null, 2));
  } catch (error) {
    setStatus(error.message, 'error');
    addLog('error', `拉取资源失败：${assetId}`, error.message);
  }
}

function saveResources() {
  localStorage.setItem('manfei_resources', JSON.stringify(state.resources));
  persistResourcesToServer();
}

async function restoreResourcesFromServer() {
  try {
    const response = await apiFetch('/api/app-state');
    if (response.updatedAt && Array.isArray(response.resources)) {
      state.resources = response.resources;
      if (!state.resources.some(group => group.id === state.activeResourceGroupId)) {
        setActiveResourceGroup(state.resources[0]?.id || null);
      }
      localStorage.setItem('manfei_resources', JSON.stringify(state.resources));
      renderResources();
      addLog('success', '资源库已从服务端恢复', `${state.resources.length} 个资源组`);
      return;
    }
    if (state.resources.length > 0) {
      await persistResourcesToServer();
      addLog('success', '本地资源库已迁移到服务端', `${state.resources.length} 个资源组`);
    }
  } catch (error) {
    addLog('error', '资源库服务端恢复失败', error.message);
  }
}

function persistResourcesToServer() {
  const resources = JSON.parse(JSON.stringify(state.resources));
  resourceSaveChain = resourceSaveChain.then(async () => {
    try {
      await apiFetch('/api/app-state', {
        method: 'PUT',
        body: JSON.stringify({ resources }),
      });
      return true;
    } catch (error) {
      addLog('error', '资源库服务端保存失败', error.message);
      return false;
    }
  });
  return resourceSaveChain;
}

function renderResources() {
  const box = $('resourceGroups');
  if (!box) return;
  const totalResources = state.resources.reduce((total, group) => total + (group.items?.length || 0), 0);
  $('resourceCount').textContent = String(totalResources);
  if (state.resources.length === 0) {
    box.className = 'resource-groups empty';
    box.textContent = '暂无资源组';
    updateUploadTarget();
    return;
  }
  if (!state.resources.some(group => group.id === state.activeResourceGroupId)) {
    setActiveResourceGroup(state.resources[0].id);
  }
  box.className = 'resource-groups';
  box.innerHTML = '';
  state.resources.forEach(group => {
    group.items = group.items || [];
    const isExpanded = state.expandedResourceGroupId === group.id;
    const isActive = state.activeResourceGroupId === group.id;
    const groupEl = document.createElement('div');
    groupEl.className = `resource-group${isExpanded ? ' expanded' : ''}${isActive ? ' active' : ''}`;
    groupEl.innerHTML = `
      <button class="resource-head" type="button" aria-expanded="${isExpanded}">
        <span class="group-chevron">›</span>
        <strong>${escapeHtml(group.name)}</strong>
        <span class="resource-count">${group.items.length}</span>
      </button>
      <div class="resource-items" ${isExpanded ? '' : 'hidden'}></div>
    `;
    const itemsEl = groupEl.querySelector('.resource-items');
    groupEl.querySelector('.resource-head').addEventListener('click', () => {
      setActiveResourceGroup(group.id);
      state.expandedResourceGroupId = isExpanded ? null : group.id;
      renderResources();
    });
    if (group.items.length === 0) {
      itemsEl.className = 'resource-items empty';
      itemsEl.textContent = '暂无资源';
    } else {
      group.items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'resource-item';
        const itemName = item.name || item.id || labels[assetTypeToKind(item.assetType)] || '素材';
        row.title = `${itemName}\n${item.assetType || ''} · ${item.status || ''}\n${item.id || ''}`.trim();
        row.innerHTML = `
          ${renderMediaPreview(assetTypeToKind(item.assetType), item.url, item.name)}
          <div class="resource-item-caption">${escapeHtml(itemName)}</div>
          <div class="resource-item-actions">
            <button class="resource-action add-resource-button" data-action="add" type="button" title="加入生成" aria-label="加入生成">＋</button>
            <button class="resource-action delete-resource-button" data-action="delete" type="button" title="从本地资源组移除" aria-label="从本地资源组移除">×</button>
          </div>
        `;
        row.querySelector('[data-action="add"]').addEventListener('click', () => {
          const type = assetTypeToKind(item.assetType);
          state.assets.push({
            id: createId(),
            resourceId: item.id,
            type,
            url: `asset://${item.id}`,
            previewUrl: item.url || '',
            name: item.name || '',
          });
          renderAssets();
          setStatus(`已加入生成素材：${item.id}`, 'success');
        });
        row.querySelector('[data-action="delete"]').addEventListener('click', () => {
          removeLocalResource(group.id, item.id, itemName);
        });
        itemsEl.appendChild(row);
      });
    }
    box.appendChild(groupEl);
  });
  updateUploadTarget();
}

function removeLocalResource(groupId, itemId, itemName) {
  if (!window.confirm(`从本地资源组移除「${itemName}」？\n远端 asset 和 TOS 文件不会被删除。`)) return;
  const group = state.resources.find(resourceGroup => resourceGroup.id === groupId);
  if (!group) return;

  const item = group.items.find(resource => resource.id === itemId);
  group.items = group.items.filter(resource => resource.id !== itemId);
  state.assets = state.assets.filter(asset => asset.resourceId !== itemId);

  if (item) {
    const linkedAsset = state.assets.find(asset => asset.resourceId === itemId);
    if (linkedAsset) removePromptMention(linkedAsset);
  }

  saveResources();
  renderResources();
  renderAssets();
  hideMentionMenu();
  setStatus(`已从本地资源组移除：${itemName}`, 'success');
  addLog('info', `移除本地资源：${itemName}`, itemId);
}

function assetTypeToKind(assetType) {
  if (assetType === 'Video') return 'video_url';
  if (assetType === 'Audio') return 'audio_url';
  return 'image_url';
}

function renderMediaPreview(type, url, name = '') {
  const safeUrl = url ? escapeHtml(url) : '';
  const safeName = escapeHtml(name || labels[type] || '素材');
  if (type === 'image_url' && safeUrl) {
    return `<div class="media-thumb"><img src="${safeUrl}" alt="${safeName}" loading="lazy"></div>`;
  }
  if (type === 'video_url' && safeUrl) {
    return `<div class="media-thumb"><video src="${safeUrl}" preload="metadata" muted playsinline></video><span class="media-badge">VIDEO</span></div>`;
  }
  if (type === 'audio_url') {
    return `<div class="media-thumb media-placeholder"><span>AUDIO</span></div>`;
  }
  return `<div class="media-thumb media-placeholder"><span>ASSET</span></div>`;
}

function getFileNameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.split('/').pop() || '') || '远程素材';
  } catch {
    return '远程素材';
  }
}

function renderHistory() {
  const box = $('history');
  if (state.history.length === 0) {
    box.className = `record-list history empty${state.activeTab === 'history' ? ' active-record-view' : ''}`;
    box.textContent = '暂无历史';
    return;
  }
  box.className = `record-list history${state.activeTab === 'history' ? ' active-record-view' : ''}`;
  box.innerHTML = '';
  state.history.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item';
    row.innerHTML = `
      <strong>${escapeHtml(item.model || '')}</strong>
      <div class="history-meta">${escapeHtml(item.id || '')}</div>
      <div class="history-meta">${escapeHtml(item.time || '')}</div>
      <div class="history-meta">${escapeHtml((item.prompt || '').slice(0, 90))}</div>
      <button type="button">查看视频</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      openVideoPreview(item);
    });
    box.appendChild(row);
  });
}

function fillDemo() {
  $('prompt').value = '夕阳下的海浪拍打沙滩，镜头缓慢推进，浪花晶莹，暖色电影光，真实自然。';
  $('model').value = 'sun-manfei-new';
  syncResolution();
  $('resolution').value = '720p';
  $('ratio').value = '16:9';
  $('duration').value = '5';
  setStatus('示例已填入', 'success');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[ch]));
}
