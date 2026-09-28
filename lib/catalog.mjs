import { createHash } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400, detail = '') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.detail = detail;
  }
}

export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const clone = value => structuredClone(value);
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function checkSafeJson(value, depth = 0) {
  if (depth > 80) throw new AppError('JSON 嵌套过深，请简化配置。');
  if (Array.isArray(value)) {
    for (const item of value) checkSafeJson(item, depth + 1);
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (unsafeKeys.has(key)) throw new AppError('JSON 包含不支持的字段：' + key);
      checkSafeJson(item, depth + 1);
    }
  }
}

export function mergeFields(base, overrides) {
  checkSafeJson(overrides);
  const result = clone(base);
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = isObject(value) && isObject(result[key]) ? mergeFields(result[key], value) : clone(value);
  }
  return result;
}

export function validSlug(slug) {
  return typeof slug === 'string' && slug.length > 0 && slug === slug.trim() && slug.length <= 256 && !/[\u0000-\u0020\u007f]/u.test(slug);
}

export function validateModel(model, label = '模型') {
  if (!isObject(model) || !validSlug(model.slug)) throw new AppError(label + '的模型 ID 无效；不能包含空格或控制字符。');
  if (typeof model.display_name !== 'string' || !model.display_name.trim()) throw new AppError(label + '需要显示名称。');
  for (const field of ['context_window', 'max_context_window']) {
    if (model[field] != null && (!Number.isSafeInteger(model[field]) || model[field] <= 0)) throw new AppError(label + '的 ' + field + ' 必须为正整数。');
  }
  if (model.context_window != null && model.max_context_window != null && model.context_window > model.max_context_window) throw new AppError(label + '的上下文长度不能大于最大上下文长度。');
  if (model.effective_context_window_percent != null && (!Number.isInteger(model.effective_context_window_percent) || model.effective_context_window_percent < 1 || model.effective_context_window_percent > 100)) throw new AppError(label + '的有效上下文比例必须在 1–100 之间。');
  if (model.priority != null && !Number.isSafeInteger(model.priority)) throw new AppError(label + '的排序值必须为整数。');
  if (!['list', 'hide'].includes(model.visibility)) throw new AppError(label + '的 visibility 必须是 list 或 hide。');
  if (!Array.isArray(model.supported_reasoning_levels) || !model.supported_reasoning_levels.length) throw new AppError(label + '至少需要一个推理档位。');
  const levels = model.supported_reasoning_levels.map(level => {
    if (!isObject(level) || typeof level.effort !== 'string' || !level.effort || typeof level.description !== 'string') throw new AppError(label + '的推理档位需要 effort 和 description 字段。');
    return level.effort;
  });
  if (new Set(levels).size !== levels.length) throw new AppError(label + '的推理档位重复。');
  if (!levels.includes(model.default_reasoning_level)) throw new AppError(label + '的默认推理档位必须包含在支持的档位中。');
  if (!Array.isArray(model.input_modalities) || !model.input_modalities.length || model.input_modalities.some(value => typeof value !== 'string' || !value)) throw new AppError(label + '需要有效的输入类型。');
  for (const field of ['supported_in_api', 'supports_parallel_tool_calls', 'supports_image_detail_original', 'support_verbosity']) {
    if (model[field] != null && typeof model[field] !== 'boolean') throw new AppError(label + '的 ' + field + ' 必须为布尔值。');
  }
}

export function parseCatalog(raw) {
  let catalog;
  try { catalog = typeof raw === 'string' ? JSON.parse(raw.replace(/^\uFEFF/u, '').trim()) : clone(raw); }
  catch (error) { throw new AppError('Codex 返回的内容不是有效的 JSON。', 400, error.message); }
  if (!isObject(catalog) || !Array.isArray(catalog.models) || catalog.models.length === 0) throw new AppError('官方目录格式不符合预期：需要包含非空 models 数组。');
  const seen = new Set();
  for (const model of catalog.models) {
    validateModel(model, '官方模型 ' + (model?.slug ?? ''));
    if (seen.has(model.slug)) throw new AppError('官方目录包含重复的模型 ID：' + model.slug);
    seen.add(model.slug);
  }
  return catalog;
}

export function normalizeEntries(entries) {
  if (!Array.isArray(entries)) throw new AppError('自定义配置需要一个模型数组。');
  if (entries.length > 500) throw new AppError('自定义模型数量不能超过 500 个。');
  const seen = new Set();
  return entries.map(entry => {
    if (!isObject(entry) || !validSlug(entry.slug)) throw new AppError('自定义模型 ID 无效；不能包含空格或控制字符。');
    if (seen.has(entry.slug)) throw new AppError('自定义模型 ID 重复：' + entry.slug);
    seen.add(entry.slug);
    if (!validSlug(entry.baseSlug)) throw new AppError('请选择一个官方模型作为模板：' + entry.slug);
    if (typeof entry.enabled !== 'boolean') throw new AppError('模型启用状态必须为布尔值：' + entry.slug);
    if (!isObject(entry.overrides)) throw new AppError('高级 JSON 必须是一个对象：' + entry.slug);
    if (own(entry.overrides, 'slug')) throw new AppError('请在“模型 ID”字段编辑 ID，不要在高级 JSON 中设置 slug。');
    checkSafeJson(entry.overrides);
    return { slug: entry.slug, baseSlug: entry.baseSlug, enabled: entry.enabled, overrides: clone(entry.overrides) };
  });
}

export function makePreview(catalog, entries) {
  const models = clone(catalog.models);
  const errors = [];
  const official = new Map(catalog.models.map(model => [model.slug, model]));
  const resolved = Object.create(null);
  let customCount = 0;
  for (const entry of normalizeEntries(entries)) {
    const base = official.get(entry.baseSlug);
    let problem = null;
    if (official.has(entry.slug)) problem = 'ID 与官方模型冲突：' + entry.slug + '。请使用新的 ID。';
    else if (!base) problem = '官方模板已不存在：' + entry.baseSlug + '。请重新选择模板。';
    if (!problem) {
      try {
        const model = mergeFields(base, entry.overrides);
        model.slug = entry.slug;
        validateModel(model, '自定义模型 ' + entry.slug);
        resolved[entry.slug] = model;
        if (entry.enabled) { models.push(model); customCount++; }
      } catch (error) { problem = error.message; }
    }
    if (problem) errors.push({ slug: entry.slug, message: problem, blocking: entry.enabled });
  }
  return {
    models, errors, resolved,
    officialCount: catalog.models.length,
    customCount,
    visibleCount: models.filter(model => model.visibility === 'list').length,
    fingerprint: hash({ models }),
    canApply: !errors.some(error => error.blocking)
  };
}

