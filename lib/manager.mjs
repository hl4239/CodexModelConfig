import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, hash, parseCatalog, normalizeEntries, makePreview, isObject } from './catalog.mjs';
import { inspectConfig, patchCatalog } from './config.mjs';
import { runCli, detectCli, defaultCodexHome, samePath } from './runtime.mjs';

export async function readOptional(file) {
  try { return await fs.readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(temporary, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function decode(bytes, label, fallback) {
  if (bytes === null) return fallback;
  try { return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, '')); }
  catch (error) { throw new AppError(label + '不是有效的 JSON。', 400, error.message); }
}

async function rollbackFile(file, expected, previous) {
  const current = await readOptional(file);
  if ((current === null ? null : hash(current)) !== (expected === null ? null : hash(expected))) throw new Error('文件在操作中被其他程序修改：' + file);
  if (previous === null) await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  else await atomicWrite(file, previous);
}

export class ModelManager {
  constructor({ dataDir, codexHome = defaultCodexHome(), cliPath = '', runner = runCli, detector = detectCli } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.codexHome = path.resolve(codexHome);
    this.configPath = path.join(this.codexHome, 'config.toml');
    this.mergedPath = path.join(this.dataDir, 'models.merged.json');
    this.customPath = path.join(this.dataDir, 'models.custom.json');
    this.officialPath = path.join(this.dataDir, 'models.official.json');
    this.settingsPath = path.join(this.dataDir, 'settings.json');
    this.metaPath = path.join(this.dataDir, 'application.json');
    this.cliOverride = cliPath;
    this.runner = runner;
    this.detector = detector;
    this.official = null;
    this.cli = null;
    this.error = null;
    this.busy = false;
    this.settings = { cliPath: '' };
    this.meta = { restore: null, lastApplied: null };
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const settings = decode(await readOptional(this.settingsPath), '工具设置', { cliPath: '' });
      const meta = decode(await readOptional(this.metaPath), '应用记录', { restore: null, lastApplied: null });
      if (!isObject(settings) || typeof settings.cliPath !== 'string') throw new AppError('工具设置格式无效，请检查 settings.json。');
      if (!isObject(meta) || (meta.restore != null && (!isObject(meta.restore) || typeof meta.restore.configPath !== 'string' || (meta.restore.rawValue !== null && typeof meta.restore.rawValue !== 'string'))) || (meta.lastApplied != null && !isObject(meta.lastApplied))) throw new AppError('应用记录格式无效，请检查 application.json。');
      this.settings = settings;
      this.meta = meta;
      if (this.meta.restore && this.meta.restore.configPath !== this.configPath) {
        throw new AppError('此数据目录已用于另一份 Codex 配置，请为当前配置选择独立的数据目录。');
      }
      // A saved snapshot may be displayed, but it never counts as a successful current refresh.
      const snapshot = decode(await readOptional(this.officialPath), '官方目录快照', null);
      if (snapshot) {
        this.official = { ...snapshot, catalog: parseCatalog(snapshot.catalog) };
        this.error = { message: '等待读取当前 Codex 的官方目录。', detail: '' };
      }
    } catch (error) {
      this.error = { message: error.message, detail: error.detail || '' };
      this.initializationError = error;
      return;
    }
    try { await this.refresh(); } catch {}
  }

  async exclusive(action) {
    if (this.busy) throw new AppError('另一个操作正在进行，请稍后再试。', 409);
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }

  async customState() {
    const bytes = await readOptional(this.customPath);
    const document = decode(bytes, '自定义模型配置', { version: 1, models: [] });
    if (!isObject(document) || document.version !== 1) throw new AppError('不支持的自定义配置版本。');
    return { models: normalizeEntries(document.models), revision: bytes === null ? 'new' : hash(bytes) };
  }

  async configState() {
    const bytes = await readOptional(this.configPath);
    const info = inspectConfig(bytes);
    const active = info.value?.value ?? null;
    return {
      path: this.configPath, home: this.codexHome, provider: info.provider,
      activeCatalog: active, fingerprint: info.fingerprint,
      managed: !!active && samePath(path.resolve(this.codexHome, active), this.mergedPath)
    };
  }

  async getState() {
    const problems = [];
    let custom = { models: [], revision: 'invalid' };
    let config = { path: this.configPath, home: this.codexHome, provider: '', activeCatalog: null, fingerprint: 'invalid', managed: false };
    try { custom = await this.customState(); } catch (error) { problems.push({ message: error.message, detail: error.detail || '' }); }
    try { config = await this.configState(); } catch (error) { problems.push({ message: error.message, detail: error.detail || '' }); }
    const preview = this.official ? makePreview(this.official.catalog, custom.models) : null;
    if (this.error) problems.unshift(this.error);
    let fileMatches = false;
    if (this.meta.lastApplied) {
      const bytes = await readOptional(this.mergedPath);
      fileMatches = !!bytes && hash(bytes) === this.meta.lastApplied.fileHash;
    }
    const isApplied = !!(preview && config.managed && fileMatches && this.meta.lastApplied?.fingerprint === preview.fingerprint);
    return {
      version: '1.0.0', cli: this.cli, cliOverride: this.cliOverride || this.settings.cliPath || '',
      paths: { dataDir: this.dataDir, custom: this.customPath, merged: this.mergedPath },
      config, custom,
      official: this.official ? {
        version: this.official.version, fetchedAt: this.official.fetchedAt,
        fingerprint: this.official.fingerprint, models: this.official.catalog.models,
        source: 'codex debug models --bundled'
      } : null,
      preview, errors: problems, busy: this.busy, isApplied,
      canApply: !!preview && preview.canApply && problems.length === 0,
      canRestore: !!this.meta.restore && config.managed,
      lastApplied: this.meta.lastApplied
    };
  }

  async refresh() {
    await this.exclusive(async () => {
      if (this.initializationError) throw this.initializationError;
      try {
        this.cli = await this.detector(this.cliOverride || this.settings.cliPath || '');
        const raw = await this.runner(this.cli.path, ['debug', 'models', '--bundled'], { codexHome: this.codexHome });
        const catalog = parseCatalog(raw);
        const snapshot = {
          version: this.cli.version, fetchedAt: new Date().toISOString(),
          fingerprint: hash({ version: this.cli.version, catalog }), catalog
        };
        await atomicWrite(this.officialPath, encode(snapshot));
        this.official = snapshot;
        this.error = null;
      } catch (error) {
        this.error = { message: error.message, detail: error.detail || '' };
        throw error;
      }
    });
    return this.getState();
  }

  async setCli(cliPath) {
    if (typeof cliPath !== 'string' || cliPath.length > 2000) throw new AppError('CLI 路径无效。');
    await this.exclusive(async () => {
      const chosen = await this.detector(cliPath.trim());
      const catalog = parseCatalog(await this.runner(chosen.path, ['debug', 'models', '--bundled'], { codexHome: this.codexHome }));
      const snapshot = { version: chosen.version, fetchedAt: new Date().toISOString(), fingerprint: hash({ version: chosen.version, catalog }), catalog };
      await atomicWrite(this.settingsPath, encode({ cliPath: cliPath.trim() }));
      await atomicWrite(this.officialPath, encode(snapshot));
      this.settings = { cliPath: cliPath.trim() }; this.cliOverride = '';
      this.cli = chosen; this.official = snapshot; this.error = null;
    });
    return this.getState();
  }

  async saveCustom({ revision, models }) {
    await this.exclusive(async () => {
      if (this.initializationError) throw this.initializationError;
      const current = await this.customState();
      if (current.revision !== revision) throw new AppError('自定义配置已发生变化，请刷新页面后重试。', 409);
      const entries = normalizeEntries(models);
      if (this.official) {
        const preview = makePreview(this.official.catalog, entries);
        if (!preview.canApply) throw new AppError(preview.errors.filter(error => error.blocking).map(error => error.message).join('\n'));
      } else if (entries.some(entry => entry.enabled)) throw new AppError('请先成功读取官方目录，再保存启用的自定义模型。');
      await atomicWrite(this.customPath, encode({ version: 1, models: entries }));
    });
    return this.getState();
  }

  async previewDraft(models) {
    if (!this.official) throw new AppError('请先读取官方目录。');
    return makePreview(this.official.catalog, normalizeEntries(models));
  }

  async backupConfig(bytes) {
    const name = 'config-' + new Date().toISOString().replace(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8) + (bytes === null ? '.missing' : '.toml');
    const target = path.join(this.dataDir, 'backups', name);
    await atomicWrite(target, bytes ?? Buffer.from('The config.toml file did not exist before this operation.\n'));
    return target;
  }

  async apply({ revision, officialFingerprint, configFingerprint }) {
    await this.exclusive(async () => {
      if (this.initializationError) throw this.initializationError;
      if (!this.official || this.error) throw new AppError('请先成功执行“刷新官方目录”，再应用配置。');
      if (this.official.fingerprint !== officialFingerprint) throw new AppError('官方目录已刷新，请检查最新预览后重试。', 409);
      const custom = await this.customState();
      if (custom.revision !== revision) throw new AppError('自定义配置已变化，请刷新页面后重试。', 409);
      const preview = makePreview(this.official.catalog, custom.models);
      if (!preview.canApply) throw new AppError(preview.errors.filter(error => error.blocking).map(error => error.message).join('\n'));
      const originalConfig = await readOptional(this.configPath);
      const info = inspectConfig(originalConfig);
      if (info.fingerprint !== configFingerprint) throw new AppError('Codex 配置已被其他程序修改，请刷新页面后重试。', 409);
      const mergedBytes = encode({ models: preview.models });
      const candidate = path.join(this.dataDir, 'candidate-' + randomUUID() + '.json');
      try {
        await atomicWrite(candidate, mergedBytes);
        const argument = 'model_catalog_json=' + JSON.stringify(candidate.replaceAll('\\', '/'));
        const verified = parseCatalog(await this.runner(this.cli.path, ['-c', argument, 'debug', 'models'], { codexHome: this.codexHome }));
        const actualIds = new Set(verified.models.map(model => model.slug));
        if (actualIds.size !== preview.models.length || preview.models.some(model => !actualIds.has(model.slug))) throw new AppError('Codex 校验返回的模型列表与合并结果不一致，已停止应用。');
      } finally { await fs.unlink(candidate).catch(() => {}); }
      const currentConfig = await readOptional(this.configPath);
      if (inspectConfig(currentConfig).fingerprint !== info.fingerprint) throw new AppError('校验期间 Codex 配置发生变化，请刷新页面后重试。', 409);
      if ((await this.customState()).revision !== custom.revision) throw new AppError('校验期间自定义配置发生变化，请刷新页面后重试。', 409);
      const previousMerged = await readOptional(this.mergedPath);
      const nextConfig = patchCatalog(originalConfig, this.mergedPath);
      const backup = await this.backupConfig(originalConfig);
      const nextMeta = {
        restore: this.meta.restore ?? { configPath: this.configPath, rawValue: info.value?.raw ?? null, recordedAt: new Date().toISOString() },
        lastApplied: {
          at: new Date().toISOString(), fingerprint: preview.fingerprint, fileHash: hash(mergedBytes),
          officialVersion: this.official.version, officialCount: preview.officialCount, customCount: preview.customCount, backup
        }
      };
      let catalogWritten = false, configWritten = false;
      try {
        await atomicWrite(this.mergedPath, mergedBytes); catalogWritten = true;
        // Narrow the external-edit race before replacing the user's config.
        if (inspectConfig(await readOptional(this.configPath)).fingerprint !== info.fingerprint) throw new AppError('Codex 配置已变化，请刷新页面后重试。', 409);
        await atomicWrite(this.configPath, nextConfig); configWritten = true;
        await atomicWrite(this.metaPath, encode(nextMeta));
        this.meta = nextMeta;
      } catch (error) {
        const recoveryErrors = [];
        if (configWritten) await rollbackFile(this.configPath, nextConfig, originalConfig).catch(failure => recoveryErrors.push(failure.message));
        if (catalogWritten) await rollbackFile(this.mergedPath, mergedBytes, previousMerged).catch(failure => recoveryErrors.push(failure.message));
        throw new AppError('应用失败：' + error.message, 400, recoveryErrors.length ? '自动恢复未全部完成。备份：' + backup + '\n' + recoveryErrors.join('\n') : '已恢复此次操作写入的内容。配置备份：' + backup);
      }
    });
    return this.getState();
  }

  async restore({ configFingerprint }) {
    await this.exclusive(async () => {
      if (!this.meta.restore) throw new AppError('没有可恢复的原目录设置。');
      const original = await readOptional(this.configPath);
      const info = inspectConfig(original);
      if (info.fingerprint !== configFingerprint) throw new AppError('Codex 配置已变化，请刷新页面后重试。', 409);
      if (!info.value || !samePath(path.resolve(this.codexHome, info.value.value), this.mergedPath)) throw new AppError('Codex 当前未使用本工具的目录，已停止恢复。');
      const next = patchCatalog(original, this.meta.restore.rawValue, { rawValue: true });
      await this.backupConfig(original);
      const nextMeta = { restore: null, lastApplied: null };
      if (inspectConfig(await readOptional(this.configPath)).fingerprint !== info.fingerprint) throw new AppError('备份期间 Codex 配置发生变化，请刷新页面后重试。', 409);
      await atomicWrite(this.configPath, next);
      try { await atomicWrite(this.metaPath, encode(nextMeta)); }
      catch (error) {
        await rollbackFile(this.configPath, next, original);
        throw error;
      }
      this.meta = nextMeta;
    });
    return this.getState();
  }
}

