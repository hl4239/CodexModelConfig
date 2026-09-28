import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog, makePreview, normalizeEntries } from '../lib/catalog.mjs';
import { catalog, model, custom } from './helpers.mjs';

test('preserves all official metadata and recursively overlays only explicit fields', () => {
  const before = structuredClone(catalog);
  const entry = custom({ future_metadata: { nested: { update: 9 }, array: [3] } });
  const preview = makePreview(catalog, [entry]);
  assert.deepEqual(catalog, before);
  assert.deepEqual(preview.models.slice(0, 2), catalog.models);
  assert.equal(preview.models[2].base_instructions, model.base_instructions);
  assert.deepEqual(preview.models[2].future_metadata, { nested: { preserve: 1, update: 9 }, array: [3] });
  assert.equal(preview.customCount, 1); assert.equal(preview.visibleCount, 2);
});

test('refresh inherits changed official fields, preserving overrides', () => {
  const updated = structuredClone(catalog); updated.models[0].context_window = 200000; updated.models[0].base_instructions = 'New instructions';
  const preview = makePreview(updated, [custom({ display_name: 'Keep this' })]);
  assert.equal(preview.resolved['my-model'].context_window, 200000);
  assert.equal(preview.resolved['my-model'].display_name, 'Keep this');
  assert.equal(preview.resolved['my-model'].base_instructions, 'New instructions');
});

test('collisions and removed templates block enabled entries only', () => {
  assert.equal(makePreview(catalog, [{ ...custom(), slug: model.slug }]).canApply, false);
  assert.equal(makePreview(catalog, [{ ...custom(), baseSlug: 'missing' }]).canApply, false);
  const disabled = makePreview(catalog, [{ ...custom(), baseSlug: 'missing', enabled: false }]);
  assert.equal(disabled.canApply, true); assert.equal(disabled.customCount, 0); assert.equal(disabled.errors[0].blocking, false);
});

test('rejects malformed catalog, duplicate IDs, unsafe keys and invalid capabilities', () => {
  assert.throws(() => parseCatalog('not json'), /JSON/);
  assert.throws(() => parseCatalog({ models: [] }), /models/);
  assert.throws(() => parseCatalog({ models: [model, model] }), /重复/);
  assert.throws(() => normalizeEntries([custom(), custom()]), /重复/);
  assert.throws(() => normalizeEntries([{ ...custom(), slug: 'bad id' }]), /ID/);
  assert.throws(() => normalizeEntries([custom(JSON.parse('{"__proto__": {"polluted": true}}'))]), /不支持/);
  assert.throws(() => normalizeEntries([custom({ slug: 'different' })]), /模型 ID/);
  for (const overrides of [{ context_window: -1 }, { context_window: 999999 }, { effective_context_window_percent: 101 }, { default_reasoning_level: 'impossible' }, { priority: 1.5 }, { supported_in_api: 'yes' }, { supported_reasoning_levels: [] }]) {
    assert.equal(makePreview(catalog, [custom(overrides)]).canApply, false, JSON.stringify(overrides));
  }
});

test('unusual IDs cannot overwrite object prototypes', () => {
  const preview = makePreview(catalog, [{ ...custom(), slug: '__proto__' }]);
  assert.equal(Object.hasOwn(preview.resolved, '__proto__'), true);
  assert.equal(preview.models[2].slug, '__proto__');
  assert.equal({}.polluted, undefined);
});
