import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ModelManager } from '../lib/manager.mjs';
import { detectCli, runCli } from '../lib/runtime.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-model-manager-integration-'));
try {
  const cli = await detectCli();
  const codexHome = path.join(directory, 'codex');
  await fs.mkdir(codexHome);
  const original = '# Integration verification only\nmodel_provider = "openai"\n';
  await fs.writeFile(path.join(codexHome, 'config.toml'), original);
  const manager = new ModelManager({ dataDir: path.join(directory, 'data'), codexHome, cliPath: cli.path });
  await manager.initialize();
  let state = await manager.getState();
  assert.equal(state.errors.length, 0, JSON.stringify(state.errors));
  const base = state.official.models.find(model => model.visibility === 'list');
  state = await manager.saveCustom({ revision: state.custom.revision, models: [{ slug: 'integration-only-custom-model', baseSlug: base.slug, enabled: true, overrides: { display_name: 'Integration test', supported_in_api: true, visibility: 'list' } }] });
  state = await manager.apply({ revision: state.custom.revision, officialFingerprint: state.official.fingerprint, configFingerprint: state.config.fingerprint });
  assert.equal(state.isApplied, true);
  const loaded = JSON.parse(await runCli(cli.path, ['debug', 'models'], { codexHome }));
  assert.ok(loaded.models.some(model => model.slug === 'integration-only-custom-model'));
  assert.equal(loaded.models.length, state.official.models.length + 1);
  await manager.restore({ configFingerprint: state.config.fingerprint });
  assert.equal(await fs.readFile(manager.configPath, 'utf8'), original);
  console.log(`PASS: ${cli.version}; ${state.official.models.length} official models + 1 custom model loaded; restore verified in isolated CODEX_HOME.`);
} finally {
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('codex-model-manager-integration-')) throw new Error('Unsafe cleanup path');
  await fs.rm(directory, { recursive: true, force: true });
}
