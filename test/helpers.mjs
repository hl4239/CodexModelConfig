import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ModelManager } from '../lib/manager.mjs';

export const model = {
  slug: 'official-model', display_name: 'Official Model', description: 'Template',
  visibility: 'list', supported_in_api: true, priority: 1,
  context_window: 128000, max_context_window: 256000, effective_context_window_percent: 95,
  default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }, { effort: 'medium', description: 'Balanced' }],
  input_modalities: ['text', 'image'], base_instructions: 'Complete official metadata',
  future_metadata: { nested: { preserve: 1, update: 2 }, array: [1, 2] }
};
export const catalog = { models: [model, { ...structuredClone(model), slug: 'hidden-model', visibility: 'hide' }] };
export const custom = (overrides = {}) => ({ slug: 'my-model', baseSlug: model.slug, enabled: true, overrides: { display_name: 'My Model', ...overrides } });

export async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-model-manager-test-'));
  t.after(async () => {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('codex-model-manager-test-')) throw new Error('Unsafe cleanup path');
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

export async function setup(t, options = {}) {
  const directory = await temporary(t);
  const codexHome = path.join(directory, 'codex');
  await fs.mkdir(codexHome);
  const initial = Buffer.from('# original config\r\nmodel_provider = "custom"\r\n[model_providers.custom]\r\nname = "Local"\r\nbase_url = "http://localhost:9999"\r\n');
  await fs.writeFile(path.join(codexHome, 'config.toml'), initial);
  const runner = async (exe, args) => {
    if (args.includes('--bundled')) return JSON.stringify(catalog);
    const candidate = JSON.parse(args[1].slice('model_catalog_json='.length));
    return fs.readFile(candidate, 'utf8');
  };
  const manager = new ModelManager({ dataDir: path.join(directory, 'data'), codexHome, detector: async () => ({ path: 'fake-codex', version: 'codex-cli test' }), runner, ...options });
  await manager.initialize();
  return { manager, directory, initial, runner };
}

export const applyArgs = state => ({ revision: state.custom.revision, officialFingerprint: state.official.fingerprint, configFingerprint: state.config.fingerprint });
