import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { hash } from '../lib/catalog.mjs';
import { inspectConfig } from '../lib/config.mjs';
import { ModelManager } from '../lib/manager.mjs';
import { setup, custom, applyArgs, catalog } from './helpers.mjs';

test('save does not change Codex; apply preserves official entries and restores the original setting', async t => {
  const { manager, initial } = await setup(t);
  let state = await manager.getState();
  state = await manager.saveCustom({ revision: state.custom.revision, models: [custom()] });
  assert.deepEqual(await fs.readFile(manager.configPath), initial);
  state = await manager.apply(applyArgs(state));
  assert.equal(state.isApplied, true); assert.equal(state.canRestore, true);
  const merged = JSON.parse(await fs.readFile(manager.mergedPath, 'utf8'));
  assert.deepEqual(merged.models.slice(0, 2), catalog.models); assert.equal(merged.models.length, 3);
  assert.deepEqual(await fs.readFile(state.lastApplied.backup), initial);
  await fs.appendFile(manager.configPath, '# subsequent external edit\r\n');
  state = await manager.getState();
  state = await manager.restore({ configFingerprint: state.config.fingerprint });
  assert.equal(state.isApplied, false); assert.equal(state.canRestore, false);
  assert.equal(inspectConfig(await fs.readFile(manager.configPath)).value, null);
  assert.equal((await fs.readFile(manager.configPath)).toString(), initial.toString() + '# subsequent external edit\r\n');
});

test('repeated applies preserve the initial custom catalog for restore', async t => {
  const { manager } = await setup(t);
  await fs.writeFile(manager.configPath, 'model_catalog_json = \'C:\\original.json\' # original\nmodel = "official-model"\n');
  let state = await manager.apply(applyArgs(await manager.getState()));
  state = await manager.saveCustom({ revision: state.custom.revision, models: [custom()] });
  assert.equal(state.isApplied, false);
  state = await manager.apply(applyArgs(state));
  await manager.restore({ configFingerprint: state.config.fingerprint });
  assert.equal(inspectConfig(await fs.readFile(manager.configPath)).value.raw, "'C:\\original.json'");
});

test('rejects stale custom, official and config revisions without writing', async t => {
  const { manager, initial } = await setup(t);
  const state = await manager.getState();
  await assert.rejects(manager.saveCustom({ revision: 'stale', models: [custom()] }), /变化/);
  for (const field of ['revision', 'officialFingerprint', 'configFingerprint']) {
    await assert.rejects(manager.apply({ ...applyArgs(state), [field]: 'stale' }), /变化|刷新|修改/);
  }
  assert.deepEqual(await fs.readFile(manager.configPath), initial);
  await assert.rejects(fs.stat(manager.mergedPath), { code: 'ENOENT' });
});

test('failed refresh retains snapshot but blocks application', async t => {
  const { manager, initial } = await setup(t);
  manager.runner = async () => { throw new Error('CLI unavailable'); };
  await assert.rejects(manager.refresh(), /unavailable/);
  const state = await manager.getState();
  assert.equal(state.official.models.length, 2); assert.equal(state.canApply, false);
  await assert.rejects(manager.apply(applyArgs(state)), /刷新官方目录/);
  assert.deepEqual(await fs.readFile(manager.configPath), initial);
});

test('CLI rejection and mismatched catalog stop before config mutation', async t => {
  const { manager, initial } = await setup(t);
  let state = await manager.saveCustom({ revision: 'new', models: [custom()] });
  manager.runner = async () => { throw new Error('unsupported model metadata'); };
  await assert.rejects(manager.apply(applyArgs(state)), /unsupported/);
  manager.runner = async () => JSON.stringify(catalog);
  await assert.rejects(manager.apply(applyArgs(state)), /不一致/);
  assert.deepEqual(await fs.readFile(manager.configPath), initial);
  assert.equal((await fs.readdir(manager.dataDir)).filter(x => x.startsWith('candidate-')).length, 0);
});

test('external edits during CLI verification are preserved and reported', async t => {
  const { manager, runner } = await setup(t);
  const state = await manager.getState();
  manager.runner = async (...args) => { const result = await runner(...args); await fs.appendFile(manager.configPath, '# concurrent edit\n'); return result; };
  await assert.rejects(manager.apply(applyArgs(state)), /校验期间/);
  assert.match(await fs.readFile(manager.configPath, 'utf8'), /concurrent edit/);
  assert.equal(inspectConfig(await fs.readFile(manager.configPath)).value, null);
});

test('partial apply failure rolls back config and merged catalog', async t => {
  const { manager, initial } = await setup(t);
  await fs.writeFile(manager.mergedPath, 'previous contents');
  await fs.mkdir(manager.metaPath);
  await assert.rejects(manager.apply(applyArgs(await manager.getState())), /应用失败/);
  assert.deepEqual(await fs.readFile(manager.configPath), initial);
  assert.equal(await fs.readFile(manager.mergedPath, 'utf8'), 'previous contents');
  assert.equal(manager.meta.lastApplied, null);
});

test('restore failure rolls back config and external changes after backup abort restore', async t => {
  const { manager } = await setup(t);
  let state = await manager.apply(applyArgs(await manager.getState()));
  const applied = await fs.readFile(manager.configPath);
  await fs.unlink(manager.metaPath); await fs.mkdir(manager.metaPath);
  await assert.rejects(manager.restore({ configFingerprint: state.config.fingerprint }));
  assert.deepEqual(await fs.readFile(manager.configPath), applied);
  const backup = manager.backupConfig.bind(manager);
  manager.backupConfig = async bytes => { const location = await backup(bytes); await fs.appendFile(manager.configPath, '# changed during backup\n'); return location; };
  state = await manager.getState();
  await assert.rejects(manager.restore({ configFingerprint: state.config.fingerprint }), /备份期间/);
  assert.match(await fs.readFile(manager.configPath, 'utf8'), /changed during backup/);
});

test('concurrent mutations are rejected; missing config can be applied and restored', async t => {
  const { manager } = await setup(t);
  await fs.unlink(manager.configPath);
  const state = await manager.getState();
  let finish;
  const lock = manager.exclusive(() => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(manager.saveCustom({ revision: 'new', models: [] }), /另一个操作/);
  finish(); await lock;
  const applied = await manager.apply(applyArgs(state));
  assert.match(applied.lastApplied.backup, /\.missing$/);
  await manager.restore({ configFingerprint: applied.config.fingerprint });
  assert.equal(inspectConfig(await fs.readFile(manager.configPath)).value, null);
});

test('manual edits to the generated file make application status stale', async t => {
  const { manager } = await setup(t);
  await manager.apply(applyArgs(await manager.getState()));
  await fs.appendFile(manager.mergedPath, '\n');
  assert.equal((await manager.getState()).isApplied, false);
  assert.equal(typeof hash(await fs.readFile(manager.configPath)), 'string');
});

test('application state and restoration survive a process restart', async t => {
  const { manager, initial, runner } = await setup(t);
  await manager.apply(applyArgs(await manager.getState()));
  const reopened = new ModelManager({ dataDir: manager.dataDir, codexHome: manager.codexHome, runner, detector: manager.detector });
  await reopened.initialize();
  const state = await reopened.getState();
  assert.equal(state.isApplied, true); assert.equal(state.canRestore, true);
  await reopened.restore({ configFingerprint: state.config.fingerprint });
  assert.deepEqual(await fs.readFile(manager.configPath), initial);
});

test('malformed application metadata is displayed as a blocking error', async t => {
  const { manager, runner } = await setup(t);
  await fs.writeFile(manager.metaPath, 'null');
  const reopened = new ModelManager({ dataDir: manager.dataDir, codexHome: manager.codexHome, runner, detector: manager.detector });
  await reopened.initialize();
  const state = await reopened.getState();
  assert.equal(state.canApply, false); assert.match(state.errors[0].message, /应用记录格式无效/);
});
