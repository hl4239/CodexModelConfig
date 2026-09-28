import { _electron as electron } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-model-manager-ui-'));
const codexHome = path.join(temporary, 'codex'), userData = path.join(temporary, 'profile');
await fs.mkdir(codexHome); await fs.mkdir(userData);
const configPath = path.join(codexHome, 'config.toml');
const original = '# UI integration test\nmodel_provider = "openai"\n';
await fs.writeFile(configPath, original);
const env = { ...process.env, CODEX_HOME: codexHome, MODEL_MANAGER_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.MODEL_MANAGER_TEST_EXE || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const packaged = !!process.env.MODEL_MANAGER_TEST_EXE;
async function downloadedJson(file, application) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('No completed JSON export: ' + file);
}
let application, passed = false;
try {
  application = await electron.launch({ executablePath, args: packaged ? [] : [root], env, timeout: 60000 });
  const page = await application.firstWindow({ timeout: 60000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#app-content').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#official-count').innerText(), '11');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.desktop.pickCli), 'function');
  await page.locator('#show-hidden').check();
  assert.equal(await page.locator('#official-table tbody tr').count(), 11);
  await page.locator('#model-search').fill('gpt-6-sol');
  assert.equal(await page.locator('#official-table tbody tr').count(), 1);
  await page.getByRole('button', { name: '使用 gpt-6-sol 作为模板', exact: true }).click();
  await page.locator('#edit-slug').fill('desktop-ui-test-model');
  await page.locator('#edit-name').fill('我的自定义模型');
  await page.locator('#edit-context').fill('128000');
  assert.equal(await page.locator('#edit-visibility').inputValue(), 'list', await page.locator('#edit-visibility').evaluate(element => element.outerHTML + '\n' + document.querySelector('#edit-json').value));
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts', packaged ? 'editor-packaged.png' : 'editor.png') });
  await page.locator('#editor-preview').click();
  await page.locator('#resolved-details').waitFor({ state: 'visible' });
  assert.match(await page.locator('#resolved-json').innerText(), /desktop-ui-test-model/);
  await page.locator('#editor-save').click();
  await page.locator('#editor-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#custom-count').innerText(), '1');
  assert.equal(await fs.readFile(configPath, 'utf8'), original);
  // Choose the native dialog destination in the test; the app performs the export.
  await application.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: destination + '/' + options.defaultPath.replaceAll('\\', '/').split('/').at(-1) });
  }, temporary.replaceAll('\\', '/'));
  await page.locator('[data-action="export-custom"]').click();
  const exportedCustom = await downloadedJson(path.join(temporary, 'models.custom.json'), application);
  assert.equal(exportedCustom.models[0].slug, 'desktop-ui-test-model');
  await page.locator('[data-view="preview"]').click();
  assert.equal(await page.locator('#view-content tbody tr').count(), 12);
  await page.locator('[data-action="export-merged"]').click();
  const exportedMerged = await downloadedJson(path.join(temporary, 'models.merged.json'), application);
  assert.equal(exportedMerged.models.length, 12);
  await page.locator('#apply-btn').click();
  await page.locator('#confirm-ok').click();
  await page.getByText('✓ 当前目录已应用', { exact: true }).waitFor();
  assert.match(await fs.readFile(configPath, 'utf8'), /model_catalog_json/);
  assert.equal(JSON.parse(await fs.readFile(path.join(userData, 'data', 'models.merged.json'), 'utf8')).models.length, 12);
  await page.locator('[data-view="custom"]').click();
  await page.getByRole('button', { name: '编辑 desktop-ui-test-model', exact: true }).click();
  await page.locator('details.advanced').first().locator('summary').click();
  await page.locator('#edit-json').fill('{invalid');
  assert.equal(await page.locator('#editor-save').isDisabled(), true);
  await page.locator('#edit-json').fill(JSON.stringify({ display_name: 'JSON 修改后的名称', context_window: 64000, supported_in_api: true, visibility: 'list' }, null, 2));
  assert.equal(await page.locator('#edit-name').inputValue(), 'JSON 修改后的名称');
  assert.equal(await page.locator('#edit-context').inputValue(), '64000');
  await page.locator('#editor-save').click();
  await page.locator('#editor-dialog').waitFor({ state: 'hidden' });
  await page.getByText('● 有更新待应用', { exact: true }).waitFor();
  await page.getByRole('switch', { name: '启用 desktop-ui-test-model', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#merged-count').textContent === '11');
  await page.locator('#restore-btn').click(); await page.locator('#confirm-ok').click();
  await page.getByText('○ 尚未应用此目录', { exact: true }).waitFor();
  assert.equal(await fs.readFile(configPath, 'utf8'), original);
  await page.getByRole('button', { name: '删除 desktop-ui-test-model', exact: true }).click();
  await page.locator('#confirm-ok').click();
  await page.waitForFunction(() => document.querySelector('#custom-count').textContent === '0');
  await page.locator('#import-file').setInputFiles(path.join(temporary, 'models.custom.json'));
  await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  await page.locator('#confirm-ok').click();
  await page.waitForFunction(() => document.querySelector('#custom-count').textContent === '1');
  assert.equal(JSON.parse(await fs.readFile(path.join(userData, 'data', 'models.custom.json'), 'utf8')).models[0].slug, 'desktop-ui-test-model');
  await page.getByRole('button', { name: '删除 desktop-ui-test-model', exact: true }).click();
  await page.locator('#confirm-ok').click();
  await page.waitForFunction(() => document.querySelector('#custom-count').textContent === '0');
  await page.locator('[data-view="settings"]').click();
  assert.equal(await page.locator('#pick-cli').isVisible(), true);
  assert.equal(await page.locator('#open-data').isVisible(), true);
  await page.locator('[data-view="official"]').click();
  await page.locator('#model-search').fill(''); await page.locator('#show-hidden').uncheck();
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await page.locator('#toast').waitFor({ state: 'hidden', timeout: 12000 });
  await page.screenshot({ path: path.join(root, 'artifacts', packaged ? 'desktop-packaged.png' : 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 900, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log(`PASS: ${packaged ? 'packaged' : 'development'} desktop app; official search, template edit, JSON sync, invalid JSON, save, preview, export/import round trip, real CLI apply, disable, restore, delete, native bridge, responsive layout, no renderer errors.`);
  passed = true;
} finally {
  if (application) {
    if (!passed) await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await application.close().catch(() => {});
  }
  if (path.dirname(temporary) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('codex-model-manager-ui-')) throw new Error('Unsafe cleanup path');
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
