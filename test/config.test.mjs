import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectConfig, patchCatalog } from '../lib/config.mjs';
const bytes = text => Buffer.from(text, 'utf8');

test('inserts root catalog setting before tables, keeping comments, CRLF and BOM', () => {
  const original = bytes('\uFEFF# preserve\r\nmodel_provider = "custom"\r\n[model_providers.custom]\r\nname = "Proxy"\r\n');
  const changed = patchCatalog(original, 'D:\\space folder\\merged.json');
  assert.equal(changed.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.equal(inspectConfig(changed).value.value, 'D:/space folder/merged.json');
  assert.equal(inspectConfig(changed).provider, 'custom');
  assert.ok(changed.toString().includes('model_catalog_json = "D:/space folder/merged.json"\r\n[model_providers.custom]'));
  assert.deepEqual(patchCatalog(changed, null), original);
});

test('replaces quoted keys without rewriting the surrounding text', () => {
  const original = bytes('  "model_catalog_json"  = \'C:\\old.json\' # keep\n[profiles.work]\nmodel_catalog_json = "profile.json"\n');
  const changed = patchCatalog(original, 'D:/new.json');
  assert.equal(changed.toString(), '  "model_catalog_json"  = "D:/new.json" # keep\n[profiles.work]\nmodel_catalog_json = "profile.json"\n');
  assert.deepEqual(patchCatalog(changed, inspectConfig(original).value.raw, { rawValue: true }), original);
});

test('ignores fake settings and headers inside multiline strings and nested arrays', () => {
  const original = bytes('instructions = """\n[not_a_table]\nmodel_provider = "fake"\nmodel_catalog_json = "fake"\n"""\narrays = [\n [1, 2],\n [3, 4]\n]\nmodel_provider = "real"\n[real_table]\na = 1\n');
  const changed = patchCatalog(original, '/catalog.json');
  assert.equal(inspectConfig(changed).provider, 'real');
  assert.ok(changed.toString().includes('model_provider = "real"\nmodel_catalog_json = "/catalog.json"\n[real_table]'));
  assert.deepEqual(patchCatalog(changed, null), original);
});

test('understands escaped quoted keys and rejects duplicate or unsafe path values', () => {
  assert.equal(inspectConfig(bytes('"model_catalog_\\u006ason" = "old.json"')).value.value, 'old.json');
  assert.throws(() => inspectConfig(bytes('model_catalog_json = "a"\n"model_catalog_json" = "b"')), /重复/);
  assert.throws(() => inspectConfig(bytes('model_catalog_json = """a"""')), /多行/);
  assert.throws(() => inspectConfig(bytes('model_catalog_json = 42')), /字符串/);
  assert.throws(() => inspectConfig(bytes('model_catalog_json = "a" trailing')), /无效/);
  assert.throws(() => inspectConfig(Buffer.from([0xff, 0xfe, 0x41, 0])), /UTF-8/);
  assert.throws(() => inspectConfig(Buffer.from([0xc0, 0xaf])), /UTF-8/);
});

test('handles missing files, missing newline, Unicode, and path comments', () => {
  assert.equal(inspectConfig(null).fingerprint, 'missing');
  assert.equal(inspectConfig(patchCatalog(null, 'D:/模型 #1.json')).value.value, 'D:/模型 #1.json');
  assert.ok(patchCatalog(bytes('model = "x"'), '/x.json').toString().includes('model = "x"\nmodel_catalog_json'));
  assert.equal(patchCatalog(bytes('model_catalog_json = "a" # keep me\n'), null).toString(), '# keep me\n');
  assert.equal(inspectConfig(bytes('model_catalog_json = "C:\\U0000005cmodels.json"')).value.value, 'C:\\models.json');
  assert.equal(inspectConfig(bytes('model_catalog_json = "C:\\\\U00001234.json"')).value.value, 'C:\\U00001234.json');
  assert.throws(() => inspectConfig(bytes('model_catalog_json = "\\uD800"')), /转义/);
});
