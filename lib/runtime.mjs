import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from './catalog.mjs';

const exec = promisify(execFile);
export const defaultCodexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

function cleanError(text) {
  return String(text ?? '').replace(/\x1b\[[0-9;]*m/gu, '').replace(/Bearer\s+[^\s"']+/giu, 'Bearer [redacted]').replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/gu, '[redacted]').trim().slice(0, 3500);
}

export async function runCli(executable, args, options = {}) {
  try {
    const { stdout } = await exec(executable, args, {
      encoding: 'utf8', windowsHide: true, timeout: options.timeout ?? 25000,
      maxBuffer: 32 * 1024 * 1024,
      env: options.codexHome ? { ...process.env, CODEX_HOME: options.codexHome } : process.env
    });
    return stdout;
  } catch (error) {
    const reason = error.killed ? '执行超时' : error.code === 'ENOENT' ? '找不到可执行文件' : '执行失败';
    throw new AppError('Codex 命令' + reason + '。', 400, cleanError(error.stderr || error.message));
  }
}

export async function detectCli(override = '') {
  if (override) {
    const executable = path.resolve(override.trim().replace(/^"|"$/gu, ''));
    const version = (await runCli(executable, ['--version'], { timeout: 10000 })).trim();
    if (!/^codex(?:-cli)?\s+/u.test(version)) throw new AppError('所选程序不是 Codex CLI。');
    return { path: executable, version };
  }
  const candidates = [];
  if (process.platform === 'win32') {
    const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const discovered = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
        const executable = path.join(root, entry.name, 'codex.exe');
        try { const stat = await fs.stat(executable); return stat.isFile() ? { executable, modified: stat.mtimeMs } : null; }
        catch { return null; }
      }));
      candidates.push(...discovered.filter(Boolean).sort((a, b) => b.modified - a.modified).map(item => item.executable));
    } catch {}
    try {
      const { stdout } = await exec('where.exe', ['codex.exe'], { windowsHide: true, timeout: 5000 });
      candidates.push(...stdout.split(/\r?\n/u).map(value => value.trim()).filter(Boolean));
    } catch {}
  } else candidates.push('codex');
  for (const executable of [...new Set(candidates)]) {
    try {
      const version = (await runCli(executable, ['--version'], { timeout: 8000 })).trim();
      if (/^codex(?:-cli)?\s+/u.test(version)) return { path: executable, version };
    } catch {}
  }
  throw new AppError('未找到可用的 Codex CLI。请在设置中指定 codex.exe 的路径。');
}

export const samePath = (a, b) => {
  if (!a || !b) return false;
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(a) === normalize(b);
};

