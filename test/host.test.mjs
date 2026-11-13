/**
 * Host-half tests against a local fake StarAPI (both key groups) and a stub
 * of the DSH services the plugin reads. They cover the decisions that
 * determine whether each route works: which models are kept, which thinking
 * levels each gets, the output cap and context window, and what is written
 * when the gateway is down.
 *
 * Run: node --test test/
 */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import {
  apply,
  buildClaudeEntry,
  buildCodexEntry,
  buildRcEntry,
  buildProviderProfile,
  classifyClaudeAvailability,
  classifyCodexAvailability,
  classifyRcAvailability,
  classifyEffort,
  claudeEfforts,
  claudeRepairReasons,
  codexEfforts,
  codexRepairReasons,
  rcRepairReasons,
  FAMILIES,
  normalizeBaseURL,
  normalizeKey,
  redact,
} from '../index.js'
import { CLAUDE_KEY, CODEX_KEY, RC_KEY, startFakeStarapi } from './fake-starapi.mjs'

/** The slice of a DSH Host context the plugin touches. */
function stubContext(initialProviders = {}, { storedKeys = {} } = {}) {
  const routes = new Map()
  const refs = new Map(Object.entries(storedKeys))
  const entry = { options: { id: 'llm-pi-ai', config: { providers: structuredClone(initialProviders) } } }
  const logs = []
  const ctx = {
    logger: { warn: (...args) => logs.push(args.join(' ')) },
    effect(callback) {
      callback()
    },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      },
    },
    credentials: {
      describe: async (ref) => ({ configured: refs.has(ref), writable: true }),
      resolve: async (ref) => (refs.has(ref) ? { value: refs.get(ref), source: 'file' } : undefined),
      set: async (ref, value) => void refs.set(ref, value),
      unset: async (ref) => void refs.delete(ref),
    },
    get(name) {
      if (name === 'configEditor') {
        return {
          entries: () => [entry],
          edit: async (target, change) => {
            target.options.config = change(structuredClone(target.options.config), {})
          },
        }
      }
      return undefined
    },
  }
  const call = async (group, name, method = 'GET', body) => {
    const route = routes.get(`/api/starapi/${group}/${name}`)
    assert.ok(route, `route ${group}/${name} is registered`)
    assert.ok(route.methods.includes(method))
    const response = await route.fetch(
      new Request(`http://dsh.test/api/starapi/${group}/${name}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      }),
    )
    return { status: response.status, body: await response.json() }
  }
  /** Start a connect run for one group and wait for it to settle. */
  const connect = async (group, body) => {
    const started = await call(group, 'connect', 'POST', body)
    if (started.status !== 200) return started
    for (let tries = 0; tries < 400; tries++) {
      const state = await call(group, 'state')
      if (!state.body.job.running) return state
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('connect did not settle')
  }
  const provider = (group) => entry.options.config.providers[FAMILIES[group].providerId]
  return { ctx, call, connect, refs, logs, provider, providers: () => entry.options.config.providers }
}

let fake
before(async () => {
  fake = await startFakeStarapi()
})
after(async () => {
  await fake.close()
})

test('normalizeBaseURL drops a trailing /v1 and slash, and refuses non-URLs', () => {
  assert.equal(normalizeBaseURL(undefined), 'https://www.starapi.io')
  assert.equal(normalizeBaseURL('https://www.starapi.io/v1/'), 'https://www.starapi.io')
  assert.equal(normalizeBaseURL('http://127.0.0.1:8080/proxy/v1'), 'http://127.0.0.1:8080/proxy')
  assert.throws(() => normalizeBaseURL('starapi'), /not a URL/)
  assert.throws(() => normalizeBaseURL('ftp://x.test'), /http\(s\)/)
})

test('normalizeKey accepts pasted forms and refuses malformed keys', () => {
  assert.equal(normalizeKey(`  Bearer ${CLAUDE_KEY}\n`), CLAUDE_KEY)
  assert.equal(normalizeKey(`"${CODEX_KEY}"`), CODEX_KEY)
  assert.throws(() => normalizeKey(''), { code: 'KEY_MALFORMED' })
  assert.throws(() => normalizeKey('sk-has a space-123'), { code: 'KEY_MALFORMED' })
})

test('redact removes key-shaped text', () => {
  const text = redact(new Error(`request with ${CLAUDE_KEY} and Bearer abc.def failed`))
  assert.ok(!text.includes(CLAUDE_KEY))
  assert.ok(!text.includes('abc.def'))
})

test('Claude availability reads the four measured answers; any 404 means absent', () => {
  assert.deepEqual(classifyClaudeAvailability({ status: 200, message: '' }), { state: 'ok', off: true })
  assert.deepEqual(classifyClaudeAvailability({ status: 400, message: 'claude-fable-5-2 requires adaptive thinking; omit thinking' }), { state: 'ok', off: false })
  assert.deepEqual(classifyClaudeAvailability({ status: 404, errorType: 'model_not_found', message: '' }), { state: 'missing' })
  assert.deepEqual(classifyClaudeAvailability({ status: 404, message: 'Upstream request failed' }), { state: 'missing' })
  assert.deepEqual(classifyClaudeAvailability({ status: 401, message: '' }), { state: 'auth' })
  assert.equal(classifyClaudeAvailability({ status: 503, errorType: 'gateway_failover_exhausted', message: '' }).state, 'unknown')
  // An unrelated 400 must not be read as "available, thinking cannot be disabled".
  assert.equal(classifyClaudeAvailability({ status: 400, message: 'max_tokens too small' }).state, 'unknown')
})

test('Codex availability treats a plain 404 as an outage, not absence', () => {
  assert.deepEqual(classifyCodexAvailability({ status: 200, message: '' }), { state: 'ok' })
  assert.deepEqual(classifyCodexAvailability({ status: 404, errorType: 'model_not_found', message: '' }), { state: 'missing' })
  assert.equal(classifyCodexAvailability({ status: 404, message: 'Upstream request failed' }).state, 'unknown')
  assert.equal(classifyCodexAvailability({ status: 503, message: 'Service temporarily unavailable' }).state, 'unknown')
  assert.deepEqual(classifyCodexAvailability({ status: 401, message: '' }), { state: 'auth' })
})

test('classifyEffort separates accepted, refused and unknown', () => {
  assert.equal(classifyEffort({ status: 200 }), true)
  assert.equal(classifyEffort({ status: 400 }), false)
  assert.equal(classifyEffort({ status: 503 }), undefined)
  assert.equal(classifyEffort({ status: 0 }), undefined)
})

test('Claude efforts offer off only when thinking can be disabled, xhigh only where native', () => {
  assert.deepEqual(Object.keys(claudeEfforts('claude-opus-4-8', true)), ['off', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(claudeEfforts('claude-opus-4-8', true).off, null)
  assert.deepEqual(Object.keys(claudeEfforts('claude-fable-5-2', false)), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(Object.keys(claudeEfforts('claude-sonnet-4-6', true)), ['off', 'low', 'medium', 'high', 'max'])
  // A model newer than this plugin: no xhigh, because it is not known to be native.
  assert.deepEqual(Object.keys(claudeEfforts('claude-opus-9', false)), ['low', 'medium', 'high', 'max'])
})

test('Codex efforts never offer off, and drop xhigh or max the probe refused', () => {
  assert.deepEqual(Object.keys(codexEfforts(true, true)), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(Object.keys(codexEfforts(false, false)), ['low', 'medium', 'high'])
  assert.deepEqual(Object.keys(codexEfforts(true, false)), ['low', 'medium', 'high', 'xhigh'])
  assert.ok(!('off' in codexEfforts(true, true)), 'off must never appear: StarAPI runs "none" as medium')
})

test('entry builders fall back to known values when a probe could not answer', () => {
  assert.deepEqual(buildClaudeEntry({ id: 'claude-sonnet-5-5', state: 'unknown' }), {
    id: 'claude-sonnet-5-5',
    name: 'claude-sonnet-5-5',
    input: ['text', 'image'],
    maxTokens: 64_000,
    reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  })
  const unknownClaude = buildClaudeEntry({ id: 'claude-opus-9', state: 'unknown' })
  assert.equal(unknownClaude.maxTokens, 64_000)
  assert.ok(!Object.hasOwn(unknownClaude.reasoningEfforts, 'off'), 'an unprobed unknown Claude model must not offer off')
  const codex = buildCodexEntry({ id: 'gpt-7-sol', state: 'unknown' })
  assert.equal(codex.contextWindow, 272_000)
  assert.equal(codex.maxTokens, 64_000)
  assert.deepEqual(Object.keys(codex.reasoningEfforts), ['low', 'medium', 'high'])
  const known = buildCodexEntry({ id: 'gpt-6.1-sol', state: 'unknown' })
  assert.deepEqual(Object.keys(known.reasoningEfforts), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(known.maxTokens, 128_000)
})

test('repair reasons name what is wrong with each hand-made profile', () => {
  assert.deepEqual(claudeRepairReasons({ api: 'openai-responses', compat: {} }), ['protocol'])
  assert.deepEqual(claudeRepairReasons({ api: 'anthropic-messages', compat: {} }), ['adaptive'])
  assert.deepEqual(claudeRepairReasons({ api: 'anthropic-messages', compat: { forceAdaptiveThinking: true } }), [])
  const codexBroken = {
    api: 'anthropic-messages',
    models: [
      { id: 'gpt-6.1-sol', reasoningEfforts: { off: null, low: 'low' } },
      { id: 'gpt-image-2' },
      { id: 'gpt-6-sol' },
    ],
  }
  assert.deepEqual(codexRepairReasons(codexBroken), ['protocol', 'off-ignored', 'non-chat', 'no-levels', 'context'])
  const codexFine = {
    api: 'openai-responses',
    models: [{ id: 'gpt-6.1-sol', contextWindow: 272_000, reasoningEfforts: { low: 'low', high: 'high' } }],
  }
  assert.deepEqual(codexRepairReasons(codexFine), [])
})

test('buildProviderProfile repairs a broken Claude profile and keeps unrelated fields', () => {
  const broken = {
    apiKeyEnv: 'SOMETHING_ELSE',
    api: 'openai-responses',
    baseURL: 'https://www.starapi.io',
    compat: { supportsDeveloperRole: false },
    headers: { 'x-team': 'a' },
    modelOverrides: { x: {} },
    models: [{ id: 'old' }],
  }
  const fixed = buildProviderProfile(FAMILIES.claude, broken, 'https://www.starapi.io', [{ id: 'claude-opus-5' }])
  assert.equal(fixed.api, 'anthropic-messages')
  assert.equal(fixed.apiKeyEnv, 'STARAPI_CLAUDE_API_KEY')
  assert.deepEqual(fixed.compat, { forceAdaptiveThinking: true, allowEmptySignature: true, supportsTemperature: false })
  assert.deepEqual(fixed.headers, { 'x-team': 'a' })
  assert.equal(fixed.modelOverrides, undefined)
  assert.deepEqual(fixed.models, [{ id: 'claude-opus-5' }])
  assert.equal(fixed.reasoning, 'high')
  // An existing anthropic-messages profile keeps its other compat switches and a valid default level.
  const kept = buildProviderProfile(FAMILIES.claude, { api: 'anthropic-messages', compat: { supportsStrictTools: true }, reasoning: 'max', displayName: 'Mine' }, 'https://x.test', [])
  assert.equal(kept.compat.supportsStrictTools, true)
  assert.equal(kept.reasoning, 'max')
  assert.equal(kept.displayName, 'Mine')
  // A default level some model lacks (xhigh, off) is reset.
  assert.equal(buildProviderProfile(FAMILIES.claude, { reasoning: 'xhigh' }, 'https://x.test', []).reasoning, 'high')
})

test('buildProviderProfile for Codex writes no compat and appends /v1', () => {
  const fixed = buildProviderProfile(FAMILIES.codex, { api: 'anthropic-messages', compat: { forceAdaptiveThinking: true } }, 'https://www.starapi.io', [{ id: 'gpt-6-sol' }])
  assert.equal(fixed.api, 'openai-responses')
  assert.equal(fixed.baseURL, 'https://www.starapi.io/v1')
  assert.equal(fixed.compat, undefined)
  assert.equal(fixed.apiKeyEnv, 'STARAPI_CODEX_API_KEY')
  assert.equal(buildProviderProfile(FAMILIES.claude, undefined, 'https://www.starapi.io', []).baseURL, 'https://www.starapi.io')
})

test('Claude connect: detects models, drops uncallable ones, sets levels and caps, stores the key', async () => {
  const dsh = stubContext({ other: { apiKeyEnv: 'OTHER_KEY' } })
  apply(dsh.ctx, { baseURL: fake.url })
  const before429 = fake.stats.rateLimited

  const state = await dsh.connect('claude', { key: `  ${CLAUDE_KEY} ` })
  assert.equal(state.body.job.phase, 'done', JSON.stringify(state.body.job))
  assert.equal(dsh.refs.get('STARAPI_CLAUDE_API_KEY'), CLAUDE_KEY)
  assert.deepEqual(dsh.providers().other, { apiKeyEnv: 'OTHER_KEY' }, 'other providers are untouched')

  const profile = dsh.provider('claude')
  assert.equal(profile.api, 'anthropic-messages')
  assert.equal(profile.baseURL, fake.url)
  assert.equal(profile.apiKeyEnv, 'STARAPI_CLAUDE_API_KEY')
  assert.equal(profile.compat.forceAdaptiveThinking, true)
  assert.equal(profile.compat.allowEmptySignature, true)
  assert.ok(!JSON.stringify(dsh.providers()).includes(CLAUDE_KEY), 'the key never enters the profile')

  const byId = Object.fromEntries(profile.models.map((model) => [model.id, model]))
  assert.deepEqual(Object.keys(byId), ['claude-opus-4-8', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-fable-5-2'])
  assert.ok(Object.hasOwn(byId['claude-opus-4-8'].reasoningEfforts, 'off'))
  assert.ok(!Object.hasOwn(byId['claude-fable-5-2'].reasoningEfforts, 'off'))
  assert.ok(!Object.hasOwn(byId['claude-opus-5-5'].reasoningEfforts, 'off'))
  assert.equal(byId['claude-opus-4-8'].maxTokens, 128_000)
  assert.equal(byId['claude-fable-5-1'].maxTokens, 64_000, 'a refused 128000 is lowered to the cap that works')
  assert.equal(byId['claude-fable-5-2'].maxTokens, 128_000)

  assert.deepEqual(state.body.report.dropped, ['claude-sonnet-5-5', 'claude-haiku-5-5'])
  assert.deepEqual(state.body.report.skipped, [])
  assert.ok(state.body.report.models.every((model) => model.verified))
  assert.equal(state.body.report.upstreamDown, false)
  assert.equal(fake.stats.rateLimited, before429, 'probing stays under the concurrency limit')
  assert.ok(!JSON.stringify(state.body).includes(CLAUDE_KEY), 'the key is never returned to the page')
})

test('Codex connect: keeps chat models, skips image models, marks the down one unverified', async () => {
  const dsh = stubContext()
  apply(dsh.ctx, { baseURL: fake.url })
  const state = await dsh.connect('codex', { key: CODEX_KEY })
  assert.equal(state.body.job.phase, 'done', JSON.stringify(state.body.job))
  assert.equal(dsh.refs.get('STARAPI_CODEX_API_KEY'), CODEX_KEY)

  const profile = dsh.provider('codex')
  assert.equal(profile.api, 'openai-responses')
  assert.equal(profile.baseURL, `${fake.url}/v1`)
  assert.equal(profile.compat, undefined)
  assert.equal(profile.reasoning, 'high')
  const byId = Object.fromEntries(profile.models.map((model) => [model.id, model]))
  assert.deepEqual(Object.keys(byId), ['gpt-5.6-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6.1-terra'])
  for (const id of ['gpt-5.6-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol']) {
    assert.deepEqual(Object.keys(byId[id].reasoningEfforts), ['low', 'medium', 'high', 'xhigh', 'max'], id)
    assert.equal(byId[id].contextWindow, 272_000, id)
    assert.equal(byId[id].maxTokens, 128_000, id)
  }
  assert.deepEqual(Object.keys(byId['gpt-6.1-terra'].reasoningEfforts), ['low', 'medium', 'high', 'xhigh', 'max'], 'terra uses known defaults')
  assert.equal(byId['gpt-6.1-terra'].contextWindow, 272_000)

  assert.deepEqual(state.body.report.skipped, ['gpt-image-2', 'gpt-image-2.6'])
  assert.deepEqual(state.body.report.dropped, [])
  const terra = state.body.report.models.find((model) => model.id === 'gpt-6.1-terra')
  assert.equal(terra.verified, false)
  assert.equal(terra.reason, 'HTTP 503')
  assert.ok(state.body.report.models.filter((model) => model.id !== 'gpt-6.1-terra').every((model) => model.verified))
  assert.equal(state.body.report.upstreamDown, false)
  assert.equal(state.body.needsRepair, false)
})

test('a key of the other group is refused by both families and nothing is stored', async () => {
  const dsh = stubContext()
  apply(dsh.ctx, { baseURL: fake.url })
  const codexWithClaudeKey = await dsh.connect('codex', { key: CLAUDE_KEY })
  assert.equal(codexWithClaudeKey.body.job.error, 'NO_MODELS')
  const claudeWithCodexKey = await dsh.connect('claude', { key: CODEX_KEY })
  assert.equal(claudeWithCodexKey.body.job.error, 'NO_MODELS')
  const wrong = await dsh.connect('claude', { key: 'sk-wrong-key-000000000' })
  assert.equal(wrong.body.job.error, 'KEY_INVALID')
  assert.equal(dsh.refs.size, 0)
  assert.equal(dsh.provider('claude'), undefined)
  assert.equal(dsh.provider('codex'), undefined)
})

test('an outage still adds both providers, with fallback settings marked unverified', async () => {
  const down = await startFakeStarapi({ mode: 'down' })
  try {
    const dsh = stubContext()
    apply(dsh.ctx, { baseURL: down.url })
    const claude = await dsh.connect('claude', { key: CLAUDE_KEY })
    assert.equal(claude.body.job.phase, 'done')
    assert.equal(claude.body.report.upstreamDown, true)
    assert.ok(claude.body.report.models.every((model) => !model.verified))
    const claudeById = Object.fromEntries(dsh.provider('claude').models.map((model) => [model.id, model]))
    assert.equal(Object.keys(claudeById).length, 7)
    assert.ok(Object.hasOwn(claudeById['claude-opus-4-8'].reasoningEfforts, 'off'))
    assert.ok(!Object.hasOwn(claudeById['claude-fable-5-2'].reasoningEfforts, 'off'))

    const codex = await dsh.connect('codex', { key: CODEX_KEY })
    assert.equal(codex.body.job.phase, 'done')
    assert.equal(codex.body.report.upstreamDown, true)
    const codexById = Object.fromEntries(dsh.provider('codex').models.map((model) => [model.id, model]))
    // terra is down either way; the image models are still skipped during an outage.
    assert.deepEqual(Object.keys(codexById), ['gpt-5.6-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6.1-terra'])
    assert.deepEqual(Object.keys(codexById['gpt-6.1-sol'].reasoningEfforts), ['low', 'medium', 'high', 'xhigh', 'max'])
    assert.equal(codexById['gpt-6.1-sol'].contextWindow, 272_000)
  } finally {
    await down.close()
  }
})

test('connect without a key reuses the stored one and repairs a broken profile', async () => {
  const dsh = stubContext(
    {
      'starapi-claude': { apiKeyEnv: 'STARAPI_CLAUDE_API_KEY', api: 'openai-responses', baseURL: 'https://www.starapi.io', models: [{ id: 'claude-fable-5-2' }] },
      'starapi-codex': { apiKeyEnv: 'STARAPI_CODEX_API_KEY', api: 'openai-responses', baseURL: 'https://www.starapi.io', models: [{ id: 'gpt-6.1-sol', reasoningEfforts: { off: null, low: 'low' } }, { id: 'gpt-image-2' }] },
    },
    { storedKeys: { STARAPI_CLAUDE_API_KEY: CLAUDE_KEY, STARAPI_CODEX_API_KEY: CODEX_KEY } },
  )
  apply(dsh.ctx, { baseURL: fake.url })
  const before = await dsh.call('claude', 'state')
  assert.deepEqual(before.body.repairReasons, ['protocol'])
  const beforeCodex = await dsh.call('codex', 'state')
  assert.ok(beforeCodex.body.repairReasons.includes('off-ignored'))
  assert.ok(beforeCodex.body.repairReasons.includes('non-chat'))
  assert.ok(beforeCodex.body.repairReasons.includes('context'))

  const claude = await dsh.connect('claude', {})
  assert.equal(claude.body.job.phase, 'done')
  assert.equal(claude.body.needsRepair, false)
  assert.equal(dsh.provider('claude').api, 'anthropic-messages')
  const codex = await dsh.connect('codex', {})
  assert.equal(codex.body.job.phase, 'done')
  assert.equal(codex.body.needsRepair, false)
  assert.ok(!dsh.provider('codex').models.some((model) => model.id === 'gpt-image-2'))
})

test('connect with no key anywhere fails with NO_KEY; a malformed key is a 400', async () => {
  const dsh = stubContext()
  apply(dsh.ctx, { baseURL: fake.url })
  assert.equal((await dsh.connect('claude', {})).body.job.error, 'NO_KEY')
  assert.equal((await dsh.connect('codex', {})).body.job.error, 'NO_KEY')
  const malformed = await dsh.call('codex', 'connect', 'POST', { key: 'x y' })
  assert.equal(malformed.status, 400)
  assert.equal(malformed.body.error, 'KEY_MALFORMED')
})

test('a connect in one group does not block the other group', async () => {
  const dsh = stubContext()
  apply(dsh.ctx, { baseURL: fake.url })
  const claudeStarted = await dsh.call('claude', 'connect', 'POST', { key: CLAUDE_KEY })
  assert.equal(claudeStarted.status, 200)
  const codexStarted = await dsh.call('codex', 'connect', 'POST', { key: CODEX_KEY })
  assert.equal(codexStarted.status, 200)
  const claudeBusy = await dsh.call('claude', 'connect', 'POST', {})
  assert.equal(claudeBusy.status, 409)
  for (let i = 0; i < 400; i++) {
    const [a, b] = [await dsh.call('claude', 'state'), await dsh.call('codex', 'state')]
    if (!a.body.job.running && !b.body.job.running) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal((await dsh.call('claude', 'state')).body.job.phase, 'done')
  assert.equal((await dsh.call('codex', 'state')).body.job.phase, 'done')
})

test('remove deletes only its own provider, and the key only when asked', async () => {
  const dsh = stubContext({ other: { apiKeyEnv: 'OTHER_KEY' } })
  apply(dsh.ctx, { baseURL: fake.url })
  await dsh.connect('claude', { key: CLAUDE_KEY })
  await dsh.connect('codex', { key: CODEX_KEY })
  const kept = await dsh.call('claude', 'remove', 'POST', {})
  assert.equal(kept.body.configured, false)
  assert.equal(kept.body.keySet, true)
  assert.deepEqual(Object.keys(dsh.providers()).sort(), ['other', 'starapi-codex'])
  await dsh.connect('claude', {})
  const gone = await dsh.call('claude', 'remove', 'POST', { forgetKey: true })
  assert.equal(gone.body.keySet, false)
  assert.equal(dsh.refs.has('STARAPI_CLAUDE_API_KEY'), false)
  assert.equal(dsh.refs.has('STARAPI_CODEX_API_KEY'), true, 'the other group keeps its key')
})

test('usage returns numbers only, per group', async () => {
  const dsh = stubContext({}, { storedKeys: { STARAPI_CLAUDE_API_KEY: CLAUDE_KEY, STARAPI_CODEX_API_KEY: CODEX_KEY } })
  apply(dsh.ctx, { baseURL: fake.url })
  for (const group of ['claude', 'codex']) {
    const { body } = await dsh.call(group, 'usage')
    assert.deepEqual(body.usage, { balance: 12.345, unit: 'USD', todayRequests: 7, todayTokens: 4200 })
  }
  const dsh2 = stubContext()
  apply(dsh2.ctx, { baseURL: fake.url })
  const missing = await dsh2.call('codex', 'usage')
  assert.equal(missing.status, 500)
  assert.equal(missing.body.error, 'NO_KEY')
})

// --- RC Claude (api.site) ---

test('classifyRcAvailability: 404 is absent, 503 is outage', () => {
  assert.deepEqual(classifyRcAvailability({ status: 200, message: '' }), { state: 'ok' })
  assert.deepEqual(classifyRcAvailability({ status: 401, message: '' }), { state: 'auth' })
  assert.deepEqual(classifyRcAvailability({ status: 404, message: 'model not found' }), { state: 'missing' })
  assert.equal(classifyRcAvailability({ status: 503, message: 'All available accounts exhausted' }).state, 'unknown')
})

test('buildRcEntry: context window by generation, never a fake off', () => {
  const newer = buildRcEntry({ id: 'claude-opus-5-5', state: 'ok', xhigh: true, max: true, cap: 128_000 })
  assert.equal(newer.contextWindow, 1_000_000)
  assert.equal(newer.maxTokens, 128_000)
  assert.deepEqual(Object.keys(newer.reasoningEfforts), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(buildRcEntry({ id: 'claude-opus-4-5-20251101', state: 'ok', cap: 128_000 }).contextWindow, 200_000)
  assert.equal(buildRcEntry({ id: 'claude-opus-4.5', state: 'unknown' }).contextWindow, 200_000)
  const unprobed = buildRcEntry({ id: 'claude-sonnet-5-5', state: 'unknown' })
  assert.ok(!('off' in unprobed.reasoningEfforts), 'off must never appear: api.site runs none as the default')
  assert.equal(unprobed.maxTokens, 128_000)
})

test('rcRepairReasons flags the hand-made rc-claude config', () => {
  const broken = {
    api: 'openai-responses',
    models: [
      { id: 'claude-fable-5-2', reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
      { id: 'claude-opus-5-5' },
    ],
  }
  const reasons = rcRepairReasons(broken)
  assert.ok(reasons.includes('off-ignored'))
  assert.ok(reasons.includes('no-levels'))
  assert.ok(reasons.includes('context'))
  assert.ok(!reasons.includes('protocol'))
  const fine = { api: 'openai-responses', models: [{ id: 'claude-opus-5-5', contextWindow: 1_000_000, reasoningEfforts: { low: 'low', high: 'high' } }] }
  assert.deepEqual(rcRepairReasons(fine), [])
})

test('buildProviderProfile for RC writes openai-responses, no compat, /v1', () => {
  const fixed = buildProviderProfile(FAMILIES['rc-claude'], { api: 'anthropic-messages', compat: { forceAdaptiveThinking: true } }, 'https://api.site', [{ id: 'claude-opus-5-5' }])
  assert.equal(fixed.api, 'openai-responses')
  assert.equal(fixed.baseURL, 'https://api.site/v1')
  assert.equal(fixed.compat, undefined)
  assert.equal(fixed.apiKeyEnv, 'RC_CLAUDE_API_KEY')
})

test('RC roots: default api.site/v1, StarAPI defaults, per-family override', async () => {
  const dsh = stubContext()
  apply(dsh.ctx, {})
  assert.equal((await dsh.call('rc-claude', 'state')).body.baseURL, 'https://api.site/v1')
  assert.equal((await dsh.call('claude', 'state')).body.baseURL, 'https://www.starapi.io')
  assert.equal((await dsh.call('codex', 'state')).body.baseURL, 'https://www.starapi.io/v1')
  const dsh2 = stubContext()
  apply(dsh2.ctx, { baseURL: 'https://starapi-mirror.example', roots: { 'rc-claude': 'https://rc-mirror.example/v1' } })
  assert.equal((await dsh2.call('claude', 'state')).body.baseURL, 'https://starapi-mirror.example')
  assert.equal((await dsh2.call('codex', 'state')).body.baseURL, 'https://starapi-mirror.example/v1')
  assert.equal((await dsh2.call('rc-claude', 'state')).body.baseURL, 'https://rc-mirror.example/v1')
})

test('RC connect: keeps working models, drops 404 removed, keeps 503 as unverified', async () => {
  const dsh = stubContext()
  apply(dsh.ctx, { baseURL: fake.url, roots: { 'rc-claude': fake.url } })
  const state = await dsh.connect('rc-claude', { key: RC_KEY })
  assert.equal(state.body.job.phase, 'done', JSON.stringify(state.body.job))
  assert.equal(dsh.refs.get('RC_CLAUDE_API_KEY'), RC_KEY)
  const profile = dsh.provider('rc-claude')
  assert.equal(profile.api, 'openai-responses')
  assert.equal(profile.baseURL, `${fake.url}/v1`)
  assert.equal(profile.compat, undefined)
  const byId = Object.fromEntries(profile.models.map((model) => [model.id, model]))
  assert.deepEqual(Object.keys(byId), ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-5-20251101', 'claude-fable-5-1', 'claude-fable-5'])
  assert.deepEqual(state.body.report.dropped, ['claude-fable-5-2'])
  for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-5-20251101']) {
    assert.deepEqual(Object.keys(byId[id].reasoningEfforts), ['low', 'medium', 'high', 'xhigh', 'max'], id)
    assert.ok(!('off' in byId[id].reasoningEfforts), id)
  }
  assert.equal(byId['claude-opus-5-5'].contextWindow, 1_000_000)
  assert.equal(byId['claude-opus-4-5-20251101'].contextWindow, 200_000)
  const fable1 = state.body.report.models.find((model) => model.id === 'claude-fable-5-1')
  assert.equal(fable1.verified, false)
  assert.equal(fable1.reason, 'HTTP 503')
  assert.equal(state.body.report.upstreamDown, false)
  assert.ok(!JSON.stringify(state.body).includes(RC_KEY), 'the key is never returned to the page')
})

test('RC connect with a Codex key is refused (that key lists no claude model)', async () => {
  const dsh = stubContext()
  apply(dsh.ctx, { roots: { 'rc-claude': fake.url } })
  const state = await dsh.connect('rc-claude', { key: CODEX_KEY })
  assert.equal(state.body.job.error, 'NO_MODELS')
  assert.equal(dsh.refs.size, 0)
  assert.equal(dsh.provider('rc-claude'), undefined)
})

test('RC remove leaves StarAPI providers and keys intact', async () => {
  const dsh = stubContext()
  apply(dsh.ctx, { baseURL: fake.url, roots: { 'rc-claude': fake.url } })
  await dsh.connect('claude', { key: CLAUDE_KEY })
  await dsh.connect('rc-claude', { key: RC_KEY })
  const gone = await dsh.call('rc-claude', 'remove', 'POST', { forgetKey: true })
  assert.equal(gone.body.configured, false)
  assert.equal(gone.body.keySet, false)
  assert.deepEqual(Object.keys(dsh.providers()).sort(), ['starapi-claude'])
  assert.equal(dsh.refs.has('STARAPI_CLAUDE_API_KEY'), true)
  assert.equal(dsh.refs.has('RC_CLAUDE_API_KEY'), false)
})
