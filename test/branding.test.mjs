import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const load = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const manifest = JSON.parse(await load('../package.json'))
const locales = await Promise.all(['en', 'zh'].map(async (language) => JSON.parse(await load(`../locale/${language}.json`))))
const client = await load('../client.js')

test('1.3.1 changes the display brand, not the installed package identity', () => {
  assert.equal(manifest.version, '1.3.1')
  assert.equal(manifest.name, '@alvinlui-hk/dsh-starapi')
  assert.match(manifest.description, /^3rdPartyProvider for DSH:/)
  for (const locale of locales) {
    assert.equal(locale.meta.title, '3rdPartyProvider for DSH')
    assert.match(locale.meta.description, /StarAPI Claude/)
    assert.match(locale.meta.description, /RC Codex/)
  }
})

test('the existing Host, Client, icon and locale resource paths stay exported', async () => {
  assert.equal(manifest.exports['.'], './index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./icon'], './icon.svg')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(await load('../cordis.patch.yml'), /id: starapi\s+name: '@alvinlui-hk\/dsh-starapi'/)
  assert.match(await load('../icon.svg'), /aria-label="3rdPartyProvider for DSH"/)
})

test('the Settings heading is renamed in both languages without moving Client identity or API paths', () => {
  new vm.Script(client, { filename: 'client.js' })
  assert.match(client, /zoneTitle: '第三方模型供應商'/)
  assert.match(client, /zoneTitle: 'Third-party model providers'/)
  assert.match(client, /id: '@alvinlui-hk\/dsh-starapi'/)
  assert.match(client, /const NS = 'starapi'/)
  assert.match(client, /api\/starapi\/\$\{group\}/)
  for (const id of ['claude', 'codex', 'rc-claude', 'rc-codex']) {
    assert.ok(client.includes(`{ id: '${id}', title:`), id)
  }
})

test('the upgrade documentation explains the unchanged technical identifiers', async () => {
  const readme = await load('../README.md')
  assert.match(readme, /^# 3rdPartyProvider for DSH/)
  assert.match(readme, /alvinlui-hk-dsh-starapi-1\.3\.1\.tgz/)
  assert.match(readme, /唔使移除舊插件再裝/)
  assert.match(readme, /第三方模型供應商/)
  assert.doesNotMatch(readme, /alvinlui-hk-dsh-starapi-1\.3\.0\.tgz/)
})
