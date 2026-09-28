import { app, BrowserWindow, dialog, shell, Menu, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ModelManager, atomicWrite } from '../lib/manager.mjs';
import { createApp } from '../server.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
// Dedicated paths let development and integration tests use isolated profiles.
const profilePath = process.env.MODEL_MANAGER_USER_DATA ? path.resolve(process.env.MODEL_MANAGER_USER_DATA) : path.join(app.getPath('appData'), 'Codex Model Manager');
mkdirSync(profilePath, { recursive: true });
app.setPath('userData', profilePath);
app.setName('Codex Model Manager');
app.setAppUserModelId('local.codex.modelmanager');
let window, server, manager, appUrl, quitting = false;
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('模型管理器启动失败', error.message); app.quit(); });
}

function trusted(event) { return event.sender === window?.webContents && event.senderFrame?.url === appUrl + '/'; }

async function start() {
  Menu.setApplicationMenu(null);
  const dataDir = path.join(app.getPath('userData'), 'data');
  manager = new ModelManager({ dataDir });
  await manager.initialize();
  const local = await createApp({ manager }); server = local.server; appUrl = local.url;
  ipcMain.handle('desktop:pick-cli', async event => {
    if (!trusted(event)) throw new Error('Untrusted window');
    const result = await dialog.showOpenDialog(window, { title: '选择 Codex CLI', properties: ['openFile'], filters: [{ name: 'Codex executable', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('desktop:open-data', async event => {
    if (!trusted(event)) throw new Error('Untrusted window');
    await fs.mkdir(dataDir, { recursive: true });
    const error = await shell.openPath(dataDir); if (error) throw new Error(error);
  });
  ipcMain.handle('desktop:export', async (event, kind) => {
    if (!trusted(event) || !['custom', 'merged'].includes(kind)) throw new Error('Invalid export request');
    const state = await manager.getState();
    if (kind === 'merged' && !state.preview?.canApply) throw new Error('请先修正合并目录中的错误。');
    if (state.custom.revision === 'invalid') throw new Error('请先修正自定义配置。');
    const filename = kind === 'custom' ? 'models.custom.json' : 'models.merged.json';
    const document = kind === 'custom' ? { version: 1, models: state.custom.models } : { models: state.preview.models };
    const selected = await dialog.showSaveDialog(window, { title: '导出模型配置', defaultPath: path.join(app.getPath('downloads'), filename), filters: [{ name: 'JSON 配置', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePath) return null;
    await atomicWrite(selected.filePath, Buffer.from(JSON.stringify(document, null, 2) + '\n'));
    return selected.filePath;
  });
  window = new BrowserWindow({
    width: 1420, height: 940, minWidth: 850, minHeight: 650,
    title: 'Codex · 模型管理器', backgroundColor: '#f5f6f3', show: false,
    icon: path.join(directory, 'assets', 'icon.png'), autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(directory, 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, spellcheck: false
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // The only external navigation in the app is the official reference link.
    if (url === 'https://developers.openai.com/codex/config-reference/') shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (url !== appUrl + '/') event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['继续编辑', '放弃并关闭'], defaultId: 0, cancelId: 0, title: '尚有未保存的修改', message: '关闭应用将放弃尚未保存的编辑。' });
    if (choice === 1) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.on('will-download', (_event, item) => {
    const name = item.getFilename();
    if (!['models.custom.json', 'models.merged.json'].includes(name)) { item.cancel(); return; }
    item.setSaveDialogOptions({ title: '导出模型配置', defaultPath: path.join(app.getPath('downloads'), name), filters: [{ name: 'JSON', extensions: ['json'] }] });
  });
  window.once('ready-to-show', () => { window.show(); window.focus(); });
  window.on('close', event => {
    if (manager.busy && !quitting) {
      event.preventDefault();
      dialog.showMessageBox(window, { type: 'info', title: '操作正在进行', message: '请等待当前读取或配置写入完成后关闭应用。' });
    }
  });
  window.on('closed', () => { window = null; });
  await window.loadURL(appUrl);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting || !server) return;
  event.preventDefault();
  if (manager?.busy) return;
  quitting = true;
  server.close(() => app.quit());
  server.closeIdleConnections();
});
