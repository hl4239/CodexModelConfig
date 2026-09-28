const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  sliders: '<path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  settings: '<path d="m9 3-1 3-3 1-2 4 2 2v3l4 3 3-1 3 1 4-3v-3l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="11" r="3"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 8a7 7 0 0 1 11.7-3L20 8M4 16l2.8 3A7 7 0 0 0 18.5 16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
$$('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
if (window.desktop) {
  $('.local-chip').innerHTML = '<span class="status-dot"></span>独立桌面应用 · 本地运行';
  $('.sidebar-footer').innerHTML = 'Windows 桌面版 <span>v1.0</span>';
}
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未读取';
const formatWindow = value => value ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : '—';
const pretty = value => JSON.stringify(value, null, 2);
let state, token, view = 'official', busy = false, search = '', showHidden = false, previewMode = 'table';
let editor = null, toastTimer;

async function api(route, body) {
  const response = await fetch('/api/' + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-App-Token': token || '', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error + (value.detail ? '\n' + value.detail : ''));
  return value;
}

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const node = $('#toast'); node.textContent = message; node.className = 'toast' + (error ? ' error' : ''); node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 10000 : 6000);
}

function setBusy(value) {
  busy = value;
  $$('button').forEach(button => {
    if (value) { button.dataset.wasDisabled = String(button.disabled); button.disabled = true; }
    else if (button.dataset.wasDisabled !== undefined) { button.disabled = button.dataset.wasDisabled === 'true'; delete button.dataset.wasDisabled; }
  });
  document.body.setAttribute('aria-busy', String(value));
}

async function mutate(route, body, message) {
  if (busy) return;
  setBusy(true);
  try {
    state = await api(route, body);
    if (message) toast(message);
    return true;
  } catch (error) {
    toast(error.message, true);
    try { state = await api('state'); } catch {}
    return false;
  } finally { setBusy(false); render(); }
}

function render() {
  if (!state) return;
  $('#loading').hidden = true; $('#app-content').hidden = false;
  const official = state.official?.models || [], enabled = state.custom.models.filter(x => x.enabled).length;
  $('#official-count').textContent = official.length;
  $('#custom-count').textContent = state.custom.models.length;
  $('#merged-count').textContent = state.preview?.models.length ?? '—';
  $('#nav-official-count').textContent = official.length;
  $('#nav-custom-count').textContent = state.custom.models.length;
  $('#official-foot').textContent = state.official ? `${state.official.version.replace('codex-cli ', 'v')} · 内置目录` : '请先读取官方目录';
  $('#custom-foot').textContent = `${enabled} 个已启用 · ${state.custom.models.length - enabled} 个已停用`;
  $('#merged-foot').textContent = state.preview ? `${state.preview.visibleCount} 个菜单可见 · 完整元数据` : '准备就绪后应用到 Codex';
  $('#global-errors').innerHTML = state.errors.map(err => `<div class="notice error"><strong>${escape(err.message)}</strong>${err.detail ? `<div class="detail">${escape(err.detail)}</div>` : ''}</div>`).join('');
  $('#provider').textContent = state.config.provider;
  $('#config-path').textContent = state.config.path;
  $('#merged-path').textContent = state.paths.merged;
  const status = $('#apply-status');
  status.textContent = state.isApplied ? '✓ 当前目录已应用' : state.config.managed ? '● 有更新待应用' : '○ 尚未应用此目录';
  status.classList.toggle('applied', state.isApplied);
  $('#apply-description').textContent = state.isApplied ? '当前合并结果已写入配置。重启 Codex 后即可使用。' : '检查合并结果，将官方模型和你的自定义模型一起交给 Codex。';
  $('#apply-btn').disabled = !state.canApply || busy || state.isApplied;
  $('#restore-btn').hidden = !state.canRestore;
  $('#restore-btn').disabled = busy;
  $('#new-btn').disabled = !official.length || state.custom.revision === 'invalid' || busy;
  $('#refresh-btn').disabled = busy;
  $('#last-applied').textContent = state.lastApplied ? `上次应用：${date(state.lastApplied.at)}\n备份：${state.lastApplied.backup}` : '';
  $('#sync-time').textContent = '上次读取：' + date(state.official?.fetchedAt);
  const titles = {
    official: ['模型目录', '保留官方能力，为你的工作流添加更多选择。', '官方模型'],
    custom: ['自定义模型', '从官方模板出发，只维护你需要修改的部分。', '自定义模型'],
    preview: ['合并预览', '检查最终交给 Codex 的完整模型目录。', '合并预览'],
    settings: ['工具设置', '管理本地运行环境与配置文件位置。', '工具设置']
  };
  $('#page-title').textContent = titles[view][0]; $('#page-description').textContent = titles[view][1]; $('#breadcrumb').textContent = titles[view][2];
  $$('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); });
  renderView();
}

function empty(title, description, action = '') {
  return `<div class="empty-state"><div class="empty-art">${icon('layers')}</div><h3>${escape(title)}</h3><p>${escape(description)}</p>${action}</div>`;
}

function tableRows(models, merged = false) {
  const customIds = new Set(state.custom.models.map(x => x.slug));
  return models.map(model => {
    const custom = merged && customIds.has(model.slug);
    return `<tr><td><div class="model-cell"><div class="model-icon ${custom ? 'custom' : ''}">${icon(custom ? 'sliders' : 'code')}</div><div><div class="model-name">${escape(model.display_name)}</div><div class="model-id mono">${escape(model.slug)}</div></div></div></td><td class="mono">${formatWindow(model.context_window)}</td><td class="reason-column"><div class="reason-chips">${model.supported_reasoning_levels.map(level => `<span class="${level.effort === model.default_reasoning_level ? 'default-level' : ''}" title="${escape(level.description)}">${escape(level.effort)}</span>`).join('')}</div></td><td><span class="mini-tag ${custom ? 'custom' : ''}">${merged ? (custom ? '自定义' : '官方') : model.visibility === 'list' ? '可见' : '隐藏'}</span></td><td><div class="row-actions"><button class="icon-button" data-action="detail" data-slug="${escape(model.slug)}" aria-label="查看 ${escape(model.slug)} 的详情" title="查看完整 JSON">${icon('code')}</button>${!merged ? `<button class="icon-button" data-action="clone" data-slug="${escape(model.slug)}" aria-label="使用 ${escape(model.slug)} 作为模板" title="用作自定义模板">${icon('plus')}</button>` : ''}</div></td></tr>`;
  }).join('');
}

function modelTable(models, merged = false) {
  return `<div class="table-wrap"><table><thead><tr><th>模型</th><th>上下文</th><th class="reason-column">推理档位</th><th>${merged ? '来源' : '菜单'}</th><th aria-label="操作"></th></tr></thead><tbody>${tableRows(models, merged)}</tbody></table>${!models.length ? '<div class="empty-state compact"><p>没有匹配的模型。</p></div>' : ''}</div>`;
}

function filteredOfficial() {
  return (state.official?.models || []).filter(model => (showHidden || model.visibility === 'list') && `${model.slug} ${model.display_name}`.toLowerCase().includes(search.toLowerCase()));
}

function renderView() {
  const container = $('#view-content');
  if (view === 'official') {
    const models = filteredOfficial();
    container.innerHTML = `<div class="panel"><div class="panel-header"><div><h2>官方模型<span class="count-tag">OFFICIAL</span></h2><p>当前安装的 Codex 自带模型目录</p></div><span class="small-badge">${state.errors.length ? '等待刷新' : '已同步'}</span></div><div class="panel-toolbar"><label class="search-wrap">${icon('search')}<input id="model-search" type="search" placeholder="搜索模型名称或 ID…" aria-label="搜索官方模型" value="${escape(search)}"></label><label class="checkbox-label"><input id="show-hidden" type="checkbox" ${showHidden ? 'checked' : ''}>包含隐藏模型</label></div><div id="official-table">${modelTable(models)}</div><div class="table-bottom"><span id="shown-count">显示 ${models.length} / ${state.official?.models.length ?? 0} 个模型</span><span><i class="source-dot"></i>官方条目只读</span></div></div><div class="under-panel-note">${icon('info')}<span>点击模型右侧的「＋」创建自定义副本。刷新官方目录会更新模板，自定义的覆盖字段会保留。</span></div>`;
    $('#model-search').addEventListener('input', event => { search = event.target.value; $('#official-table').innerHTML = modelTable(filteredOfficial()); $('#shown-count').textContent = `显示 ${filteredOfficial().length} / ${state.official?.models.length ?? 0} 个模型`; });
    $('#show-hidden').addEventListener('change', event => { showHidden = event.target.checked; renderView(); });
  } else if (view === 'custom') {
    container.innerHTML = `<div class="panel"><div class="panel-header"><div><h2>我的模型 <span class="count-tag">${state.custom.models.length}</span></h2><p>保存配置后，在右侧应用到 Codex</p></div><div class="import-controls"><button class="button" data-action="import">导入</button><button class="button" data-action="export-custom">导出</button></div></div>${state.custom.models.length ? state.custom.models.map(entry => {
      const model = state.preview?.resolved[entry.slug];
      const problem = state.preview?.errors.find(err => err.slug === entry.slug);
      return `<article class="custom-card"><div class="model-cell"><div class="model-icon custom">${icon('sliders')}</div><div><div class="model-name">${escape(model?.display_name || entry.overrides.display_name || entry.slug)}</div><div class="model-id mono">${escape(entry.slug)}</div><div class="custom-card-meta">模板 ${escape(entry.baseSlug)} · ${Object.keys(entry.overrides).length} 个覆盖字段</div>${problem ? `<div class="custom-problem">${escape(problem.message)}</div>` : ''}</div></div><div class="row-actions"><button class="toggle" role="switch" aria-checked="${entry.enabled}" aria-label="启用 ${escape(entry.slug)}" data-action="toggle" data-slug="${escape(entry.slug)}"></button><button class="icon-button" data-action="edit" data-slug="${escape(entry.slug)}" aria-label="编辑 ${escape(entry.slug)}">${icon('edit')}</button><button class="icon-button" data-action="duplicate" data-slug="${escape(entry.slug)}" aria-label="复制 ${escape(entry.slug)}">${icon('copy')}</button><button class="icon-button" data-action="delete" data-slug="${escape(entry.slug)}" aria-label="删除 ${escape(entry.slug)}">${icon('trash')}</button></div></article>`;
    }).join('') : empty('为你的目录添加一个新选择', '选择官方模型作为模板，填写自定义模型 ID，然后按需调整能力参数。', '<button class="button primary" data-action="new">' + icon('plus') + '添加第一个模型</button>')}<div class="table-bottom"><span>自定义配置独立保存</span><span>启用的条目参与合并</span></div></div><div class="under-panel-note">${icon('info')}<span>模型 ID 需要由当前 Provider 支持。此工具管理模型目录；接口地址和认证由 Codex 的 Provider 配置决定。</span></div><input id="import-file" type="file" accept=".json,application/json" hidden>`;
    $('#import-file').addEventListener('change', importCustom);
  } else if (view === 'preview') {
    const preview = state.preview;
    container.innerHTML = `<div class="view-actions"><button class="button" data-action="export-merged" ${!preview?.canApply ? 'disabled' : ''}>${icon('download')}导出合并 JSON</button></div>${preview?.errors.map(err => `<div class="notice ${err.blocking ? 'error' : ''}">${escape(err.message)}${err.blocking ? '' : '（已停用，不参与合并）'}</div>`).join('') || ''}<div class="panel"><div class="panel-header"><div><h2>最终模型目录<span class="count-tag">${preview?.models.length ?? 0}</span></h2><p>官方 ${preview?.officialCount ?? 0} + 自定义 ${preview?.customCount ?? 0}</p></div><div class="preview-tabs"><button data-preview-mode="table" class="${previewMode === 'table' ? 'active' : ''}">列表</button><button data-preview-mode="json" class="${previewMode === 'json' ? 'active' : ''}">JSON</button></div></div>${preview ? previewMode === 'table' ? modelTable(preview.models, true) : `<pre class="json-output preview-json">${escape(pretty({ models: preview.models }))}</pre>` : empty('暂时没有可预览的目录', '请先成功读取官方模型目录。')}<div class="table-bottom"><span>${preview?.canApply ? '✓ 合并规则检查通过' : '等待有效的目录'}</span><span>应用前由 Codex CLI 再次校验</span></div></div>`;
    $$('[data-preview-mode]').forEach(button => button.addEventListener('click', () => { previewMode = button.dataset.previewMode; renderView(); }));
  } else {
    container.innerHTML = `<div class="panel"><div class="panel-header"><div><h2>本地运行环境</h2><p>自动查找 Codex，也支持指定可执行文件</p></div></div><form id="settings-form" class="settings-body"><label>Codex CLI 路径<input id="cli-path" value="${escape(state.cliOverride)}" placeholder="留空自动检测；或填写 codex.exe 完整路径" autocomplete="off"></label><button class="button primary" type="submit">保存并读取目录</button><dl class="settings-info"><dt>当前 CLI</dt><dd><code>${escape(state.cli?.path || '未检测到')}</code></dd><dt>CLI 版本</dt><dd>${escape(state.cli?.version || '—')}</dd><dt>自定义配置</dt><dd><code>${escape(state.paths.custom)}</code></dd><dt>当前配置的目录路径</dt><dd><code>${escape(state.config.activeCatalog || '未设置，使用 Codex 默认目录')}</code></dd><dt>数据目录</dt><dd><code>${escape(state.paths.dataDir)}</code></dd></dl><p>目录固定通过 <code>codex debug models --bundled</code> 获取。升级 Codex 后，点击「刷新官方目录」，检查预览并重新应用。</p><p>本工具写入显示的 <code>config.toml</code> 顶层目录设置。若你使用单独的 Codex profile 配置覆盖了目录，请一并检查该 profile 的设置。</p></form></div>`;
    $('#settings-form').addEventListener('submit', event => { event.preventDefault(); mutate('settings', { cliPath: $('#cli-path').value }, '已更新运行环境并读取官方目录。'); });
    if (window.desktop) {
      $('#cli-path').insertAdjacentHTML('afterend', '<button type="button" class="button" id="pick-cli">选择可执行文件…</button>');
      $('#settings-form').insertAdjacentHTML('beforeend', '<button type="button" class="button" id="open-data">打开数据与备份目录</button>');
      $('#pick-cli').addEventListener('click', async () => { try { const file = await window.desktop.pickCli(); if (file) $('#cli-path').value = file; } catch (error) { toast(error.message, true); } });
      $('#open-data').addEventListener('click', async () => { try { await window.desktop.openData(); } catch (error) { toast(error.message, true); } });
    }
  }
}

function confirmAction(title, message, details = '', label = '确认', danger = false) {
  $('#confirm-title').textContent = title; $('#confirm-message').textContent = message; $('#confirm-details').textContent = details;
  $('#confirm-details').hidden = !details; $('#confirm-ok').textContent = label; $('#confirm-ok').className = 'button ' + (danger ? 'danger' : 'primary');
  const dialog = $('#confirm-dialog'); dialog.showModal();
  return new Promise(resolve => {
    const finish = result => { dialog.close(); $('#confirm-ok').onclick = null; $('#confirm-cancel').onclick = null; dialog.oncancel = null; resolve(result); };
    $('#confirm-ok').onclick = () => finish(true);
    $('#confirm-cancel').onclick = () => finish(false);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
  });
}

const numericFields = new Set(['context_window', 'max_context_window', 'effective_context_window_percent', 'priority']);
function editorBase() { return state.official?.models.find(model => model.slug === $('#edit-base').value); }

function syncForm() {
  const base = editorBase() || {};
  const fields = editor.overrides;
  const levels = fields.supported_reasoning_levels || base.supported_reasoning_levels || [];
  $('#edit-reasoning').innerHTML = `<option value="">继承模板（${escape(base.default_reasoning_level || '—')}）</option>` + [...new Set([...levels.map(level => level.effort), fields.default_reasoning_level].filter(Boolean))].map(level => `<option value="${escape(level)}">${escape(level)}</option>`).join('');
  $$('[data-field]').forEach(input => {
    const key = input.dataset.field;
    input.value = Object.hasOwn(fields, key) ? String(fields[key] ?? '') : '';
    if (input.tagName === 'INPUT') input.placeholder = base[key] == null ? '继承模板' : String(base[key]);
  });
  $('#edit-levels').value = fields.supported_reasoning_levels?.map(level => level.effort).join(', ') || '';
  $('#edit-levels').placeholder = (base.supported_reasoning_levels || []).map(level => level.effort).join(', ');
  $('#edit-modalities').value = fields.input_modalities?.join(', ') || '';
  $('#edit-modalities').placeholder = base.input_modalities?.join(', ') || 'text, image';
}

function editorError(message = '') {
  $('#editor-error').hidden = !message; $('#editor-error').textContent = message;
}

function safeOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('高级 JSON 必须是一个对象。');
  if (Object.hasOwn(value, 'slug')) throw new Error('请在上方的“模型 ID”字段编辑 ID。');
  if (Object.hasOwn(value, 'supported_reasoning_levels') && (!Array.isArray(value.supported_reasoning_levels) || value.supported_reasoning_levels.some(x => !x || typeof x.effort !== 'string' || typeof x.description !== 'string'))) throw new Error('推理档位需要 effort 和 description 字段。');
  if (Object.hasOwn(value, 'input_modalities') && (!Array.isArray(value.input_modalities) || value.input_modalities.some(x => typeof x !== 'string'))) throw new Error('input_modalities 必须是字符串数组。');
  return value;
}

function changedForm(event) {
  const input = event.target;
  if (!editor) return;
  editor.dirty = true; editorError(); $('#resolved-details').hidden = true;
  if (input.id === 'edit-json') {
    try { editor.overrides = safeOverrides(JSON.parse(input.value)); editor.jsonValid = true; syncForm(); }
    catch (error) { editor.jsonValid = false; editorError(error.message); }
    $('#editor-save').disabled = !editor.jsonValid;
    return;
  }
  if (!editor.jsonValid && (input.dataset.field || ['edit-levels', 'edit-modalities'].includes(input.id))) {
    editorError('请先修正高级 JSON，再编辑模型参数。'); return;
  }
  if (input.dataset.field) {
    const key = input.dataset.field;
    if (input.value === '') delete editor.overrides[key];
    else editor.overrides[key] = numericFields.has(key) ? Number(input.value) : input.dataset.type === 'boolean' ? input.value === 'true' : input.value;
  } else if (input.id === 'edit-levels') {
    if (!input.value.trim()) delete editor.overrides.supported_reasoning_levels;
    else {
      const known = [...(editorBase()?.supported_reasoning_levels || []), ...(editor.overrides.supported_reasoning_levels || [])];
      editor.overrides.supported_reasoning_levels = input.value.split(/[,，]/).map(x => x.trim()).filter(Boolean).map(effort => ({ effort, description: known.find(level => level.effort === effort)?.description || effort }));
    }
  } else if (input.id === 'edit-modalities') {
    if (!input.value.trim()) delete editor.overrides.input_modalities;
    else editor.overrides.input_modalities = input.value.split(/[,，]/).map(x => x.trim()).filter(Boolean);
  }
  if (input.id === 'edit-base') syncForm();
  if (input.id === 'edit-levels') {
    const current = $('#edit-reasoning').value;
    const levels = editor.overrides.supported_reasoning_levels || editorBase()?.supported_reasoning_levels || [];
    $('#edit-reasoning').innerHTML = `<option value="">继承模板（${escape(editorBase()?.default_reasoning_level || '—')}）</option>` + [...new Set([...levels.map(x => x.effort), current].filter(Boolean))].map(level => `<option value="${escape(level)}">${escape(level)}</option>`).join('');
    $('#edit-reasoning').value = current;
  }
  $('#edit-json').value = pretty(editor.overrides);
}

function uniqueSlug(base) {
  const taken = new Set([...(state.official?.models || []), ...state.custom.models].map(x => x.slug));
  let candidate = base, index = 2;
  while (taken.has(candidate)) candidate = base + '-' + index++;
  return candidate;
}

function openEditor(entry = null, baseSlug = null, duplicate = false) {
  if (!state.official?.models.length) { toast('请先读取官方目录。', true); return; }
  const base = baseSlug || entry?.baseSlug || state.official.models.find(x => x.visibility === 'list')?.slug || state.official.models[0].slug;
  editor = { originalSlug: entry && !duplicate ? entry.slug : null, overrides: structuredClone(entry?.overrides || { visibility: 'list', supported_in_api: true }), dirty: false, jsonValid: true };
  $('#editor-title').textContent = entry && !duplicate ? '编辑自定义模型' : '添加自定义模型';
  $('#edit-slug').value = entry ? duplicate ? uniqueSlug(entry.slug + '-copy') : entry.slug : '';
  $('#edit-base').innerHTML = state.official.models.map(model => `<option value="${escape(model.slug)}">${escape(model.display_name)} · ${escape(model.slug)}</option>`).join('');
  if (!state.official.models.some(model => model.slug === base)) $('#edit-base').insertAdjacentHTML('beforeend', `<option value="${escape(base)}">${escape(base)}（模板已不存在）</option>`);
  $('#edit-base').value = base; $('#edit-enabled').checked = entry?.enabled ?? true;
  $('#edit-json').value = pretty(editor.overrides); $('#editor-save').disabled = false;
  syncForm(); editorError(); $('#resolved-details').hidden = true;
  $('#editor-dialog').showModal(); $('#edit-slug').focus();
}

async function closeEditor() {
  if (editor?.dirty && !(await confirmAction('放弃未保存的修改？', '关闭后，本次编辑内容不会保存。', '', '放弃修改'))) return;
  $('#editor-dialog').close(); editor = null;
}

function editorEntries() {
  if (!editor.jsonValid) throw new Error('请先修正高级 JSON。');
  const entry = { slug: $('#edit-slug').value.trim(), baseSlug: $('#edit-base').value, enabled: $('#edit-enabled').checked, overrides: safeOverrides(JSON.parse($('#edit-json').value)) };
  const entries = structuredClone(state.custom.models);
  const index = editor.originalSlug ? entries.findIndex(item => item.slug === editor.originalSlug) : -1;
  if (index >= 0) entries[index] = entry; else entries.push(entry);
  return { entry, entries };
}

async function checkEditor() {
  try {
    const { entry, entries } = editorEntries();
    const preview = await api('preview', { models: entries });
    const problem = preview.errors.find(err => err.slug === entry.slug);
    if (problem) throw new Error(problem.message);
    $('#resolved-details').hidden = false; $('#resolved-details').open = true;
    $('#resolved-json').textContent = pretty(preview.resolved[entry.slug]); editorError();
  } catch (error) { editorError(error.message); }
}

async function saveEditor(event) {
  event.preventDefault();
  if (busy) return;
  try {
    const { entries } = editorEntries();
    setBusy(true);
    state = await api('custom', { revision: state.custom.revision, models: entries });
    $('#editor-dialog').close(); editor = null; view = 'custom'; toast('模型已保存。检查合并预览后，应用到 Codex。');
  } catch (error) { editorError(error.message); }
  finally { setBusy(false); render(); }
}

async function download(name, value) {
  if (window.desktop) {
    try {
      const result = await window.desktop.exportConfig(name === 'models.custom.json' ? 'custom' : 'merged');
      if (result) toast('已导出：' + result);
    } catch (error) { toast(error.message, true); }
    return;
  }
  const url = URL.createObjectURL(new Blob([pretty(value) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importCustom(event) {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('文件超过 4 MB。');
    const document = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
    if (document.version !== 1 || !Array.isArray(document.models)) throw new Error('需要本工具导出的 version: 1 自定义配置文件。');
    const ids = new Set(state.custom.models.map(x => x.slug));
    if (document.models.some(model => ids.has(model.slug))) throw new Error('导入的模型 ID 与现有自定义模型冲突。请修改 ID 或先删除对应条目。');
    const models = [...state.custom.models, ...document.models];
    const preview = await api('preview', { models });
    if (!preview.canApply) throw new Error(preview.errors.filter(x => x.blocking).map(x => x.message).join('\n'));
    if (await confirmAction('导入自定义模型', `将追加 ${document.models.length} 个模型到当前自定义配置。`, document.models.map(x => x.slug).join('\n'), '导入并保存')) await mutate('custom', { revision: state.custom.revision, models }, '导入完成。');
  } catch (error) { toast(error.message, true); }
  finally { if ($('#import-file')) $('#import-file').value = ''; }
}

$('#view-content').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || busy) return;
  const { action, slug } = button.dataset;
  const entry = state.custom.models.find(item => item.slug === slug);
  if (action === 'new') openEditor();
  if (action === 'clone') openEditor(null, slug);
  if (action === 'edit') openEditor(entry);
  if (action === 'duplicate') openEditor(entry, null, true);
  if (action === 'toggle') await mutate('custom', { revision: state.custom.revision, models: state.custom.models.map(item => item.slug === slug ? { ...item, enabled: !item.enabled } : item) }, entry.enabled ? '模型已停用。重新应用后更新 Codex 目录。' : '模型已启用。重新应用后更新 Codex 目录。');
  if (action === 'delete' && await confirmAction('删除自定义模型？', '删除后，重新应用即可从 Codex 目录中移除此模型。', slug, '删除模型', true)) await mutate('custom', { revision: state.custom.revision, models: state.custom.models.filter(item => item.slug !== slug) }, '自定义模型已删除。');
  if (action === 'detail') {
    const model = state.preview?.models.find(item => item.slug === slug) || state.official?.models.find(item => item.slug === slug);
    $('#detail-title').textContent = model.display_name; $('#detail-json').textContent = pretty(model); $('#detail-dialog').showModal();
  }
  if (action === 'export-custom') download('models.custom.json', { version: 1, models: state.custom.models });
  if (action === 'export-merged' && state.preview?.canApply) download('models.merged.json', { models: state.preview.models });
  if (action === 'import') $('#import-file').click();
});

$$('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; render(); }));
$('#refresh-btn').addEventListener('click', () => mutate('refresh', {}, '官方目录已刷新。检查合并预览后重新应用。'));
$('#new-btn').addEventListener('click', () => openEditor());
$('#editor-form').addEventListener('input', changedForm);
$('#editor-form').addEventListener('submit', saveEditor);
$('#editor-preview').addEventListener('click', checkEditor);
$('#editor-close').addEventListener('click', closeEditor);
$('#editor-cancel').addEventListener('click', closeEditor);
$('#editor-dialog').addEventListener('cancel', event => { event.preventDefault(); if (!busy) closeEditor(); });
$('#detail-close').addEventListener('click', () => $('#detail-dialog').close());
$('#detail-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#detail-json').textContent); toast('JSON 已复制。'); } catch { toast('复制失败，请在详情中选中并复制。', true); } });
$('#apply-btn').addEventListener('click', async () => {
  const request = { revision: state.custom.revision, officialFingerprint: state.official.fingerprint, configFingerprint: state.config.fingerprint };
  const count = state.preview;
  if (await confirmAction('应用模型目录到 Codex', `将写入 ${count.officialCount} 个官方模型和 ${count.customCount} 个自定义模型。工具会先用 Codex 校验目录，再备份并更新配置。应用后请重启 Codex。`, `配置：${state.config.path}\n当前目录：${state.config.activeCatalog || 'Codex 默认目录'}\n新目录：${state.paths.merged}`, '应用并备份')) await mutate('apply', request, '模型目录已应用，并已备份配置。请重启 Codex。');
});
$('#restore-btn').addEventListener('click', async () => {
  const request = { configFingerprint: state.config.fingerprint };
  if (await confirmAction('恢复原目录设置', '恢复首次应用前的模型目录设置。期间修改的其他 Codex 配置会保留。恢复后请重启 Codex。', state.config.path, '备份并恢复')) await mutate('restore', request, '原目录设置已恢复。请重启 Codex。');
});
window.addEventListener('beforeunload', event => { if (editor?.dirty || busy) { event.preventDefault(); event.returnValue = ''; } });

async function start() {
  try {
    token = (await api('session')).token;
    state = await api('state'); render();
  } catch (error) {
    $('#loading').innerHTML = `<div class="notice error">${escape(error.message)}\n请确认本地服务已启动，然后刷新页面。</div>`;
  }
}
start();
