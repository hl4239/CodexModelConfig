import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.mjs';
import { setup, custom, applyArgs } from './helpers.mjs';

test('HTTP serves the UI, protects local APIs, and supports save/preview/apply/restore', async t => {
  const { manager } = await setup(t);
  const { server, url } = await createApp({ manager });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const page = await fetch(url);
  assert.match(await page.text(), /模型管理器/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(url + '/api/state')).status, 403);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    http.get(url + '/api/session', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
  const { token } = await (await fetch(url + '/api/session')).json();
  const headers = { 'X-App-Token': token, 'Content-Type': 'application/json' };
  const post = (route, body) => fetch(url + '/api/' + route, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await fetch(url + '/api/refresh', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url + '/api/refresh', { method: 'POST', headers: { 'X-App-Token': token, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(url + '/api/refresh', { method: 'POST', headers, body: '{bad' })).status, 400);
  assert.equal((await fetch(url + '/api/preview', { method: 'POST', headers, body: '{"__proto__":{}}' })).status, 400);
  assert.equal((await fetch(url + '/data/settings.json')).status, 404);
  let response = await post('custom', { revision: 'new', models: [custom()] });
  assert.equal(response.status, 200);
  let state = await response.json(); assert.equal(state.custom.models.length, 1);
  response = await post('preview', { models: state.custom.models });
  assert.equal((await response.json()).models.length, 3);
  state = await (await post('apply', applyArgs(state))).json();
  assert.equal(state.isApplied, true);
  state = await (await post('restore', { configFingerprint: state.config.fingerprint })).json();
  assert.equal(state.isApplied, false);
});
