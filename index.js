/**
 * StarAPI / RC relays for DeepSeek Harness — Host half.
 *
 * Four key groups on two relays (StarAPI: Claude + Codex; RC at api.site:
 * Claude + Codex), and each needs a provider profile that a hand-made setup
 * easily gets wrong. The two StarAPI groups:
 *
 * - **Claude** (`starapi-claude`): the models only work over Anthropic
 *   Messages with adaptive thinking (`thinking.type=adaptive` +
 *   `output_config.effort`). `openai-responses`, or `anthropic-messages`
 *   without the adaptive switch, is answered with HTTP 400 as soon as a
 *   thinking level is selected.
 * - **Codex** (`starapi-codex`): the models speak OpenAI Responses, but
 *   StarAPI accepts `reasoning.effort: "none"` and runs it as `medium`, so an
 *   "off" level silently does nothing; `xhigh` and `max` work but are easy to
 *   leave out; the group lists image models that cannot chat; and a
 *   hand-declared route gets a 1,000,000-token context window it does not have.
 *
 * The RC groups speak OpenAI Responses too. api.site answers 200 to any effort
 * name and echoes the level it actually ran, so levels are judged by that echo,
 * not by the status. On RC Codex `none` is a real off for some models and runs
 * as `low` on others, so off is offered per model, only where the echo proves it.
 *
 * For each group this half turns "paste a key" into a correct `llm-pi-ai`
 * provider profile: validate the key against `GET /v1/models`, ask each listed
 * chat model what this account can actually do, store the key in the DSH
 * credential store, and write the profile through `configEditor`, so the
 * profile's own `cordis.patch.yml` carries it and no key enters that file.
 *
 * The profiles cannot ship as a static bundle patch: an id-targeted patch
 * replaces the whole `llm-pi-ai` config, so the profile layer would discard it
 * on any machine that already has other providers.
 *
 * Routes live under `/api/starapi/<group>/`, the authenticated Fetch registry
 * of `ctx.connection`: the Host/Origin fence and the owner cookie apply before
 * a handler runs. Keys are never returned to the page or written to a log.
 */

const PI_AI_ENTRY_ID = 'llm-pi-ai'
const DEFAULT_ROOT = 'https://www.starapi.io'
const ROUTE = '/api/starapi'

const LIST_TIMEOUT_MS = 30_000
const PROBE_TIMEOUT_MS = 25_000
/** Whole-run budget for model probes; models not reached keep their fallback settings. */
const PROBE_BUDGET_MS = 150_000
/** StarAPI answers 429 "Concurrency limit exceeded" to a burst, so probes stay nearly serial. */
const PROBE_CONCURRENCY = 2
const RETRY_DELAY_MS = 1_500
const TEST_TIMEOUT_MS = 120_000
/** Output caps tried from the DSH default downwards. */
const OUTPUT_CAPS = [128_000, 64_000, 32_000]
const FALLBACK_OUTPUT_CAP = 64_000
const PING_TEXT = 'Reply with the single word: ok'

/**
 * Claude models as measured on StarAPI, used only when a probe cannot answer
 * (the gateway is down or the probe budget ran out).
 * - `off`: the model accepts `thinking.type=disabled`.
 * - `xhigh`: the model has a native `xhigh` effort (pi-ai's Anthropic catalog).
 * - `maxTokens`: the largest `max_tokens` seen accepted. The two 64000 entries
 *   are models the test account could not call, so nothing was measured.
 */
export const KNOWN_CLAUDE = {
  'claude-opus-4-6': { off: true, xhigh: false, maxTokens: 128_000 },
  'claude-sonnet-4-6': { off: true, xhigh: false, maxTokens: 128_000 },
  'claude-opus-4-7': { off: true, xhigh: true, maxTokens: 128_000 },
  'claude-opus-4-8': { off: true, xhigh: true, maxTokens: 128_000 },
  'claude-opus-5': { off: true, xhigh: true, maxTokens: 128_000 },
  'claude-sonnet-5': { off: true, xhigh: true, maxTokens: 128_000 },
  'claude-opus-5-5': { off: false, xhigh: true, maxTokens: 128_000 },
  'claude-sonnet-5-5': { off: false, xhigh: true, maxTokens: FALLBACK_OUTPUT_CAP },
  'claude-haiku-5-5': { off: false, xhigh: true, maxTokens: FALLBACK_OUTPUT_CAP },
  'claude-fable-5': { off: false, xhigh: true, maxTokens: 128_000 },
  'claude-fable-5-1': { off: false, xhigh: true, maxTokens: 128_000 },
  'claude-fable-5-2': { off: false, xhigh: true, maxTokens: 128_000 },
}

/**
 * Codex models as measured on StarAPI (2026-11-12): every chat model accepted
 * `xhigh` and `max` and echoed them back, and accepted `max_output_tokens`
 * 128000. `contextWindow` is not measurable without sending a context-sized
 * request; it is pi-ai's own OpenAI catalog value for the same ids, so DSH
 * compacts before the model refuses. `gpt-6.1-terra` answered 503 throughout,
 * so its entry is a guess modelled on its siblings.
 */
export const KNOWN_CODEX = {
  'gpt-5.6-sol': { xhigh: true, max: true, maxTokens: 128_000, contextWindow: 272_000 },
  'gpt-6-astra': { xhigh: true, max: true, maxTokens: 128_000, contextWindow: 272_000 },
  'gpt-6-sol': { xhigh: true, max: true, maxTokens: 128_000, contextWindow: 272_000 },
  'gpt-6.1-sol': { xhigh: true, max: true, maxTokens: 128_000, contextWindow: 272_000 },
  'gpt-6.1-terra': { xhigh: true, max: true, maxTokens: 128_000, contextWindow: 272_000 },
}
const CODEX_FALLBACK_CONTEXT = 272_000

/** Listed by the Codex group but not chat models: they cannot answer a conversation. */
export const NON_CHAT_MODEL = /image|dall-e|tts|whisper|transcri|embedding|moderation|realtime|audio|sora/i

/** RC Codex lists Codex's own review helper beside the chat models; it is a tool model, not a chat route. */
export const RC_CODEX_TOOL_MODEL = /^codex-auto-review/i

export const inject = ['connection', 'credentials']

class StarapiError extends Error {
  constructor(code, message) {
    super(message ?? code)
    this.name = 'StarapiError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

/** Remove anything key-shaped from text that may reach the page or a log. */
export function redact(value) {
  return String(value instanceof Error ? value.message : (value ?? ''))
    .replace(/sk-[A-Za-z0-9._-]{6,}/g, 'sk-REDACTED')
    .replace(/(Bearer\s+)\S+/gi, '$1REDACTED')
    .slice(0, 300)
}

/**
 * The StarAPI root both groups build on. A trailing `/v1` is dropped: the
 * Anthropic SDK adds its own, and the Codex route adds it back explicitly.
 */
export function normalizeBaseURL(value) {
  const raw = typeof value === 'string' && value.trim().length > 0 ? value.trim() : DEFAULT_ROOT
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new StarapiError('BAD_BASE_URL', `baseURL "${raw}" is not a URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new StarapiError('BAD_BASE_URL', 'baseURL must be http(s)')
  const path = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')
  return `${url.origin}${path}`
}

/** Accept a pasted key, with or without a `Bearer ` prefix or surrounding quotes. */
export function normalizeKey(value) {
  const key = String(value ?? '').trim().replace(/^Bearer\s+/i, '').replace(/^['"]|['"]$/g, '').trim()
  if (key.length < 8 || key.length > 512 || /\s/.test(key)) throw new StarapiError('KEY_MALFORMED', 'the key is empty or malformed')
  return key
}

/** The state every availability probe ends in: callable, refused key, not callable, or unknown. */
function baseAvailability(result) {
  if (result.status === 200) return { state: 'ok' }
  if (result.status === 401) return { state: 'auth' }
  if (result.status === 404 && result.errorType === 'model_not_found') return { state: 'missing' }
  return { state: 'unknown', reason: result.status === 0 ? result.errorType : `HTTP ${result.status}` }
}

/**
 * Read one Claude availability probe (`thinking.type=disabled`, tiny output).
 * `off` records whether thinking can be switched off.
 */
export function classifyClaudeAvailability(result) {
  if (result.status === 200) return { state: 'ok', off: true }
  if (result.status === 400 && /adaptive thinking/i.test(result.message)) return { state: 'ok', off: false }
  // StarAPI's Claude group answers an uncallable model with 404 model_not_found only.
  if (result.status === 404 || result.errorType === 'model_not_found') return { state: 'missing' }
  return baseAvailability(result)
}

/** Read one Codex availability probe. A plain 404 ("Upstream request failed") is an outage, not absence. */
export function classifyCodexAvailability(result) {
  return baseAvailability(result)
}

/**
 * Read one RC Claude (api.site) availability probe. api.site answers a removed
 * model with 404 "model not found" and a temporarily exhausted upstream with
 * 503 "All available accounts exhausted", so 404 means absent, 503 means outage.
 */
export function classifyRcAvailability(result) {
  if (result.status === 200) return { state: 'ok' }
  if (result.status === 401) return { state: 'auth' }
  if (result.status === 404) return { state: 'missing' }
  return { state: 'unknown', reason: result.status === 0 ? result.errorType : `HTTP ${result.status}` }
}

/**
 * Whether a Responses probe of one effort proves support, refusal, or nothing.
 * api.site answers 200 to any level name, running an unknown one as `high` and
 * a capped one as the cap (`max` → `xhigh`), so when the gateway echoes the
 * effort it ran, a different echo is a refusal. Without an echo, 200 is support.
 */
export function classifyEffort(result, requested) {
  if (result.status === 200) {
    const echoed = result.json?.reasoning?.effort
    if (requested !== undefined && typeof echoed === 'string' && echoed !== requested) return false
    return true
  }
  if (result.status === 400) return false
  return undefined
}

/**
 * Whether `effort: "none"` really switches thinking off. Only an echoed `none`
 * proves it: some models take `none` and run `low`, which is a fake off.
 */
export function classifyOff(result) {
  if (result.status === 200) return result.json?.reasoning?.effort === 'none'
  if (result.status === 400) return false
  return undefined
}

/** The Claude `reasoningEfforts` dict: level name → wire value. */
export function claudeEfforts(id, off) {
  const known = KNOWN_CLAUDE[id]
  return {
    // A valueless `off` tells pi-ai the level exists and is sent as thinking.type=disabled.
    ...(off ? { off: null } : {}),
    low: 'low',
    medium: 'medium',
    high: 'high',
    ...(known?.xhigh ? { xhigh: 'xhigh' } : {}),
    max: 'max',
  }
}

/**
 * The Codex `reasoningEfforts` dict. There is no `off`: pi-ai sends it as
 * `effort: "none"`, which StarAPI runs as `medium`. `minimal` is left out for
 * the same reason a catalog OpenAI route leaves it out — it is not a level
 * these models document. Without `off`, a request with no level selected
 * omits `reasoning` and the model uses its own default (`medium`).
 */
export function codexEfforts(xhigh, max, off = false) {
  return {
    // Only where a probe proved `none` switches thinking off; pi-ai then sends the stated wire value.
    ...(off ? { off: 'none' } : {}),
    low: 'low',
    medium: 'medium',
    high: 'high',
    ...(xhigh ? { xhigh: 'xhigh' } : {}),
    ...(max ? { max: 'max' } : {}),
  }
}

/** One Claude `models` entry from a probe result. */
export function buildClaudeEntry(probe) {
  const known = KNOWN_CLAUDE[probe.id]
  return {
    id: probe.id,
    name: probe.id,
    input: ['text', 'image'],
    maxTokens: probe.cap ?? known?.maxTokens ?? FALLBACK_OUTPUT_CAP,
    reasoningEfforts: claudeEfforts(probe.id, probe.off ?? known?.off ?? false),
  }
}

/** One Codex `models` entry from a probe result. */
export function buildCodexEntry(probe) {
  const known = KNOWN_CODEX[probe.id]
  return {
    id: probe.id,
    name: probe.id,
    input: ['text', 'image'],
    contextWindow: known?.contextWindow ?? CODEX_FALLBACK_CONTEXT,
    maxTokens: probe.cap ?? known?.maxTokens ?? FALLBACK_OUTPUT_CAP,
    reasoningEfforts: codexEfforts(probe.xhigh ?? known?.xhigh ?? false, probe.max ?? known?.max ?? false),
  }
}

/**
 * RC Codex models as measured on api.site (2026-11-17): `none` is a real off
 * on gpt-6-sol and gpt-5.6-sol (echoed `none`, 0 reasoning tokens) and a fake
 * one on gpt-6.1-sol and gpt-6-astra (echoed `low`); every chat model accepted
 * `xhigh`, `max` and a 128000 output cap. Used only when a probe cannot answer.
 */
export const KNOWN_RC_CODEX = {
  'gpt-5.6-sol': { off: true, xhigh: true, max: true, maxTokens: 128_000, contextWindow: 272_000 },
  'gpt-6-sol': { off: true, xhigh: true, max: true, maxTokens: 128_000, contextWindow: 272_000 },
  'gpt-6.1-terra': { off: true, xhigh: true, max: true, maxTokens: 128_000, contextWindow: 272_000 },
  'gpt-6.1-sol': { off: false, xhigh: true, max: true, maxTokens: 128_000, contextWindow: 272_000 },
  'gpt-6-astra': { off: false, xhigh: true, max: true, maxTokens: 128_000, contextWindow: 272_000 },
}

/** One RC Codex `models` entry from a probe result. An unprobed unknown model gets no `off`. */
export function buildRcCodexEntry(probe) {
  const known = KNOWN_RC_CODEX[probe.id] ?? KNOWN_CODEX[probe.id]
  return {
    id: probe.id,
    name: probe.id,
    input: ['text', 'image'],
    contextWindow: known?.contextWindow ?? CODEX_FALLBACK_CONTEXT,
    maxTokens: probe.cap ?? known?.maxTokens ?? FALLBACK_OUTPUT_CAP,
    reasoningEfforts: codexEfforts(probe.xhigh ?? known?.xhigh ?? false, probe.max ?? known?.max ?? false, probe.off ?? KNOWN_RC_CODEX[probe.id]?.off ?? false),
  }
}

/** What is wrong with an existing Claude profile, as stable codes the page words. */
export function claudeRepairReasons(profile) {
  const reasons = []
  if (profile.api !== 'anthropic-messages') reasons.push('protocol')
  else if (profile.compat?.forceAdaptiveThinking !== true) reasons.push('adaptive')
  return reasons
}

/** What is wrong with an existing Codex profile, as stable codes the page words. */
export function codexRepairReasons(profile) {
  const reasons = []
  const models = Array.isArray(profile.models) ? profile.models : []
  const efforts = (model) => (model?.reasoningEfforts !== null && typeof model?.reasoningEfforts === 'object' ? model.reasoningEfforts : undefined)
  if (profile.api !== 'openai-responses') reasons.push('protocol')
  if (models.some((model) => efforts(model) !== undefined && (Object.hasOwn(efforts(model), 'off') || Object.hasOwn(efforts(model), 'minimal')))) {
    reasons.push('off-ignored')
  }
  if (models.some((model) => NON_CHAT_MODEL.test(String(model?.id ?? '')))) reasons.push('non-chat')
  if (models.some((model) => !NON_CHAT_MODEL.test(String(model?.id ?? '')) && efforts(model) === undefined)) reasons.push('no-levels')
  if (models.some((model) => !NON_CHAT_MODEL.test(String(model?.id ?? '')) && typeof model?.contextWindow !== 'number')) reasons.push('context')
  return reasons
}

/**
 * What is wrong with an existing RC Codex profile. Unlike StarAPI, `off` is
 * real on some of these models, so it is a fault only on a model known to run
 * `none` as `low`, or when it is not sent as `none`. `minimal` is always a
 * fault: several of these models answer it with 400.
 */
export function rcCodexRepairReasons(profile) {
  const reasons = []
  const models = Array.isArray(profile.models) ? profile.models : []
  const efforts = (model) => (model?.reasoningEfforts !== null && typeof model?.reasoningEfforts === 'object' ? model.reasoningEfforts : undefined)
  const chat = models.filter((model) => !NON_CHAT_MODEL.test(String(model?.id ?? '')))
  if (profile.api !== 'openai-responses') reasons.push('protocol')
  const badOff = (model) => {
    const levels = efforts(model)
    if (levels === undefined) return false
    if (Object.hasOwn(levels, 'minimal')) return true
    if (!Object.hasOwn(levels, 'off')) return false
    return levels.off !== 'none' || KNOWN_RC_CODEX[model.id]?.off === false
  }
  if (models.some(badOff)) reasons.push('off-fake')
  if (models.some((model) => NON_CHAT_MODEL.test(String(model?.id ?? '')))) reasons.push('non-chat')
  if (chat.some((model) => efforts(model) === undefined)) reasons.push('no-levels')
  if (chat.some((model) => typeof model?.contextWindow !== 'number')) reasons.push('context')
  return reasons
}

/** RC Claude context window: pi-ai's Anthropic catalog gives the 4-5 generation 200K, newer models 1M. */
function rcContextWindow(id) {
  return /(?:opus|sonnet|haiku)-4[.-]5/.test(id) ? 200_000 : 1_000_000
}

/** One RC Claude `models` entry from a probe result. */
export function buildRcEntry(probe) {
  return {
    id: probe.id,
    name: probe.id,
    input: ['text', 'image'],
    contextWindow: rcContextWindow(probe.id),
    maxTokens: probe.cap ?? 128_000,
    // api.site accepts every effort level; "off"/none is fake (runs as the default), so it is never offered.
    reasoningEfforts: codexEfforts(probe.xhigh ?? true, probe.max ?? true),
  }
}

/** What is wrong with an existing RC Claude profile, as stable codes the page words. */
export function rcRepairReasons(profile) {
  const reasons = []
  const models = Array.isArray(profile.models) ? profile.models : []
  const efforts = (model) => (model?.reasoningEfforts !== null && typeof model?.reasoningEfforts === 'object' ? model.reasoningEfforts : undefined)
  if (profile.api !== 'openai-responses') reasons.push('protocol')
  if (models.some((model) => efforts(model) !== undefined && (Object.hasOwn(efforts(model), 'off') || Object.hasOwn(efforts(model), 'minimal')))) reasons.push('off-ignored')
  if (models.some((model) => efforts(model) === undefined)) reasons.push('no-levels')
  if (models.some((model) => typeof model?.contextWindow !== 'number')) reasons.push('context')
  return reasons
}

/**
 * The provider profile, keeping fields set by hand on an existing one
 * (`headers`, `retryPolicy`, a custom `displayName`, …) and replacing the ones
 * that decide whether the route works.
 */
export function buildProviderProfile(family, existing, root, models) {
  const kept = existing !== null && typeof existing === 'object' ? { ...existing } : {}
  // `modelOverrides` is refused beside `models`; compat from another protocol is refused on this one.
  delete kept.modelOverrides
  const keptCompat = kept.api === family.api && kept.compat !== null && typeof kept.compat === 'object' ? kept.compat : {}
  delete kept.compat
  const compat = { ...keptCompat, ...(family.compat ?? {}) }
  return {
    ...kept,
    displayName: typeof kept.displayName === 'string' && kept.displayName.length > 0 ? kept.displayName : family.displayName,
    apiKeyEnv: family.keyRef,
    api: family.api,
    baseURL: family.baseFor(root),
    // Only levels every model of the group offers are valid route defaults.
    reasoning: family.defaultLevels.includes(kept.reasoning) ? kept.reasoning : 'high',
    ...(Object.keys(compat).length > 0 ? { compat } : {}),
    models,
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Run `task` over `items` with at most `limit` in flight, keeping input order. */
async function mapLimit(items, limit, task) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// ---------------------------------------------------------------------------
// StarAPI calls
// ---------------------------------------------------------------------------

/**
 * One StarAPI request. Never throws: a transport failure is `status: 0`.
 * `style` selects the auth headers: Anthropic's `x-api-key`, or a bearer token.
 */
async function starapi(root, path, { key, body, timeoutMs, style = 'bearer' }) {
  let response
  try {
    response = await fetch(`${root}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
      headers:
        style === 'anthropic'
   ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', accept: 'application/json' }
   : { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    return { status: 0, errorType: error?.name === 'TimeoutError' ? 'timeout' : 'network', message: redact(error), json: undefined }
  }
  let text = ''
  try {
    text = await response.text()
  } catch {
    /* a body that cannot be read is treated as empty */
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  const error = json?.error
  const nested = error !== null && typeof error === 'object'
  // Some gateways (api.site) return the error as a bare string: {"error":"model not found"}.
  const errorMessage = nested ? error.message : typeof error === 'string' ? error : (json?.message ?? '')
  return {
    status: response.status,
    json,
    errorType: nested ? (error.type ?? error.code) : (json?.code ?? json?.type),
    message: redact(errorMessage),
  }
}

/** The chat models the key's account lists for one group; refuses a bad key or a key of the other group. */
async function listModels(family, root, key) {
  const result = await starapi(root, '/v1/models', { key, timeoutMs: LIST_TIMEOUT_MS })
  if (result.status === 401 || result.errorType === 'INVALID_API_KEY') throw new StarapiError('KEY_INVALID', 'StarAPI refused the key')
  if (result.status === 0) throw new StarapiError('NETWORK', result.message)
  if (result.status !== 200) throw new StarapiError('UPSTREAM', `model list HTTP ${result.status} ${result.message}`)
  const data = Array.isArray(result.json?.data) ? result.json.data : []
  const ids = [...new Set(data.map((row) => row?.id).filter((id) => typeof id === 'string'))]
  const chat = ids.filter(family.isModel)
  if (chat.length === 0) throw new StarapiError('NO_MODELS', `the key lists no ${family.id} chat model`)
  return { ids: chat, skipped: ids.filter((id) => family.isListedNonChat(id)) }
}

/**
 * A probe request with one retry, inside the run's time budget.
 * 429 is a concurrency limit; a bare 5xx or a dropped connection is the same
 * kind of blip — one of them must not mark a working model unverified.
 */
function asker(root, key, path, style, deadline) {
  const transient = (result) => result.status === 429 || result.status === 0 || result.status >= 500
  return async (body) => {
    const left = deadline - Date.now()
    if (left < 2_000) return { status: 0, errorType: 'budget', message: 'probe budget exhausted' }
    let result = await starapi(root, path, { key, body, style, timeoutMs: Math.min(PROBE_TIMEOUT_MS, left) })
    if (transient(result) && deadline - Date.now() > RETRY_DELAY_MS + 2_000) {
      await sleep(RETRY_DELAY_MS)
      result = await starapi(root, path, { key, body, style, timeoutMs: Math.min(PROBE_TIMEOUT_MS, deadline - Date.now()) })
    }
    return result
  }
}

/**
 * The largest output cap `accepts` takes. A cap is lowered only when it fails,
 * a lower one succeeds, and it fails again — so a passing rate limit or outage
 * is not mistaken for a limit. `undefined` when none could be confirmed.
 */
async function largestCap(accepts) {
  for (let index = 0; index < OUTPUT_CAPS.length; index++) {
    if (!(await accepts(OUTPUT_CAPS[index]))) continue
    return index > 0 && (await accepts(OUTPUT_CAPS[index - 1])) ? OUTPUT_CAPS[index - 1] : OUTPUT_CAPS[index]
  }
  return undefined
}

/** Claude: availability with thinking disabled, then the output cap. */
async function probeClaude(root, key, id, deadline) {
  const ask = asker(root, key, '/v1/messages', 'anthropic', deadline)
  const ping = [{ role: 'user', content: PING_TEXT }]
  const availability = classifyClaudeAvailability(await ask({ model: id, max_tokens: 16, thinking: { type: 'disabled' }, messages: ping }))
  if (availability.state !== 'ok') return { id, ...availability, verified: false }
  const cap = await largestCap(async (value) => (await ask({ model: id, max_tokens: value, messages: ping })).status === 200)
  // Reachable but the cap probes never settled: keep the fallback, and say why it is unverified.
  return { id, state: 'ok', off: availability.off, cap, verified: cap !== undefined, ...(cap === undefined ? { reason: 'output cap unconfirmed' } : {}) }
}

/**
 * OpenAI Responses probe (StarAPI Codex, RC Claude, RC Codex): availability at
 * `low`, whether `xhigh`/`max` are accepted, then the output cap.
 * With `probeOff`, also whether `none` is a real off (RC Codex only: StarAPI
 * and RC Claude run `none` as a default level, so their off is never offered).
 */
async function probeResponses(root, key, id, deadline, classify, { probeOff = false } = {}) {
  const ask = asker(root, key, '/v1/responses', 'bearer', deadline)
  const body = (effort, cap = 16) => ({ model: id, input: PING_TEXT, max_output_tokens: cap, store: false, reasoning: { effort } })
  const availability = classify(await ask(body('low')))
  if (availability.state !== 'ok') return { id, ...availability, verified: false }
  const xhigh = classifyEffort(await ask(body('xhigh')), 'xhigh')
  const max = classifyEffort(await ask(body('max')), 'max')
  const off = probeOff ? classifyOff(await ask(body('none'))) : undefined
  const cap = await largestCap(async (value) => (await ask(body('low', value))).status === 200)
  const verified = cap !== undefined && xhigh !== undefined && max !== undefined && (!probeOff || off !== undefined)
  // The model answers, but a later probe did not: name which one, so the card never prints a blank reason.
  const reason = !verified
    ? xhigh === undefined
      ? 'xhigh unconfirmed'
      : max === undefined
        ? 'max unconfirmed'
        : probeOff && off === undefined
          ? 'off unconfirmed'
          : 'output cap unconfirmed'
    : undefined
  return { id, state: 'ok', xhigh, max, ...(probeOff ? { off } : {}), cap, verified, ...(reason === undefined ? {} : { reason }) }
}

// ---------------------------------------------------------------------------
// the key groups
// ---------------------------------------------------------------------------

export const FAMILIES = {
  claude: {
    id: 'claude',
    providerId: 'starapi-claude',
    keyRef: 'STARAPI_CLAUDE_API_KEY',
    displayName: 'StarAPI Claude',
    api: 'anthropic-messages',
    gateway: 'starapi',
    defaultRoot: 'https://www.starapi.io',
    baseFor: (root) => root,
    compat: {
      // StarAPI refuses budget-based thinking: "requires adaptive thinking".
      forceAdaptiveThinking: true,
      // Its thinking blocks carry no signature; without this they are replayed as plain text.
      allowEmptySignature: true,
      // Several of these models reject `temperature` (pi-ai's catalog marks the Opus 4.7+ line), and
      // omitting it is accepted by all of them, so it is never sent.
      supportsTemperature: false,
    },
    // Every Claude model offers these four, so any of them is a valid route default.
    defaultLevels: ['low', 'medium', 'high', 'max'],
    isModel: (id) => id.startsWith('claude-'),
    isListedNonChat: () => false,
    probe: probeClaude,
    entry: buildClaudeEntry,
    repairReasons: claudeRepairReasons,
  },
  codex: {
    id: 'codex',
    providerId: 'starapi-codex',
    keyRef: 'STARAPI_CODEX_API_KEY',
    displayName: 'StarAPI Codex',
    api: 'openai-responses',
    gateway: 'starapi',
    defaultRoot: 'https://www.starapi.io',
    baseFor: (root) => `${root}/v1`,
    compat: undefined,
    defaultLevels: ['low', 'medium', 'high'],
    isModel: (id) => /^(gpt-|o\d|codex)/i.test(id) && !NON_CHAT_MODEL.test(id),
    isListedNonChat: (id) => /^(gpt-|o\d|codex|dall-e|sora)/i.test(id) && NON_CHAT_MODEL.test(id),
    probe: (root, key, id, deadline) => probeResponses(root, key, id, deadline, classifyCodexAvailability),
    entry: buildCodexEntry,
    repairReasons: codexRepairReasons,
  },
  'rc-claude': {
    id: 'rc-claude',
    providerId: 'rc-claude',
    keyRef: 'RC_CLAUDE_API_KEY',
    displayName: 'RC Claude',
    api: 'openai-responses',
    gateway: 'rc',
    defaultRoot: 'https://api.site',
    baseFor: (root) => `${root}/v1`,
    compat: undefined,
    defaultLevels: ['low', 'medium', 'high'],
    isModel: (id) => id.startsWith('claude-'),
    isListedNonChat: () => false,
    probe: (root, key, id, deadline) => probeResponses(root, key, id, deadline, classifyRcAvailability),
    entry: buildRcEntry,
    repairReasons: rcRepairReasons,
  },
  'rc-codex': {
    id: 'rc-codex',
    providerId: 'rc-codex',
    keyRef: 'RC_CODEX_API_KEY',
    displayName: 'RC Codex',
    api: 'openai-responses',
    gateway: 'rc',
    defaultRoot: 'https://api.site',
    baseFor: (root) => `${root}/v1`,
    compat: undefined,
    // Every chat model offers these, so any of them is a valid route default; off is per model.
    defaultLevels: ['low', 'medium', 'high'],
    isModel: (id) => /^(gpt-|o\d|codex)/i.test(id) && !NON_CHAT_MODEL.test(id) && !RC_CODEX_TOOL_MODEL.test(id),
    isListedNonChat: (id) => /^(gpt-|o\d|codex|dall-e|sora)/i.test(id) && (NON_CHAT_MODEL.test(id) || RC_CODEX_TOOL_MODEL.test(id)),
    probe: (root, key, id, deadline) => probeResponses(root, key, id, deadline, classifyRcAvailability, { probeOff: true }),
    entry: buildRcCodexEntry,
    repairReasons: rcCodexRepairReasons,
  },
}

/**
 * The gateway root for one family. `config.roots[family.id]` overrides any
 * family; the legacy `config.baseURL` overrides the StarAPI gateway (claude +
 * codex) for backward compatibility. Otherwise the family's own default root.
 */
function rootFor(family, config) {
  const override = config?.roots?.[family.id]
  if (typeof override === 'string' && override.trim().length > 0) return normalizeBaseURL(override)
  if (family.gateway === 'starapi' && typeof config?.baseURL === 'string' && config.baseURL.trim().length > 0) return normalizeBaseURL(config.baseURL)
  return normalizeBaseURL(family.defaultRoot)
}

// ---------------------------------------------------------------------------
// plugin
// ---------------------------------------------------------------------------

const idleJob = () => ({ running: false, phase: 'idle', done: 0, total: 0, error: null, detail: null, finishedAt: null })

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * @param {any} ctx
 * @param {{baseURL?: string, roots?: Record<string, string>} | undefined} config -
 *   `baseURL` overrides the StarAPI root (claude + codex); `roots[familyId]`
 *   overrides any one family's root (e.g. `roots['rc-claude']`). A mirror domain
 *   or a test server.
 */
export function apply(ctx, config) {
  const roots = Object.fromEntries(Object.values(FAMILIES).map((family) => [family.id, rootFor(family, config)]))
  /** @type {Record<string, ReturnType<typeof idleJob>>} */
  const jobs = Object.fromEntries(Object.keys(FAMILIES).map((name) => [name, idleJob()]))
  /** @type {Record<string, null | {models: any[], dropped: string[], skipped: string[], upstreamDown: boolean, at: number}>} */
  const reports = Object.fromEntries(Object.keys(FAMILIES).map((name) => [name, null]))

  const piAi = () => {
    const editor = ctx.get('configEditor')
    if (editor === undefined) throw new StarapiError('CONFIG_EDITOR_UNAVAILABLE', 'this profile has no config editor')
    const entry = editor.entries().find((candidate) => candidate.options.id === PI_AI_ENTRY_ID)
    if (entry === undefined) throw new StarapiError('PI_AI_UNAVAILABLE', 'the llm-pi-ai plugin is not enabled in this profile')
    return { editor, entry }
  }

  const currentProfile = (family) => {
    try {
      const profile = piAi().entry.options?.config?.providers?.[family.providerId]
      return profile !== null && typeof profile === 'object' ? profile : undefined
    } catch {
      return undefined
    }
  }

  const keyConfigured = async (family) => {
    try {
      return (await ctx.credentials.describe(family.keyRef))?.configured === true
    } catch {
      return false
    }
  }

  const storedKey = async (family) => {
    const hit = await ctx.credentials.resolve(family.keyRef)
    return typeof hit?.value === 'string' && hit.value.length > 0 ? hit.value : undefined
  }

  /**
   * One profile edit, re-reading the entry each try.
   * configEditor.edit reloads the profile and then refuses the entry object it
   * was handed, so a write that overlaps another group's write has to start again.
   */
  const editProviders = async (change) => {
    let last
    for (let attempt = 0; attempt < 4; attempt++) {
      const { editor, entry } = piAi()
      try {
        await editor.edit(entry, change)
        return
      } catch (error) {
        last = error
        if (!/no longer available|changed during reload/i.test(String(error?.message ?? error))) throw error
        await sleep(150 * (attempt + 1))
      }
    }
    throw last
  }

  const writeProvider = async (family, models) => {
    await editProviders((current) => {
      const providers = { ...(current.providers ?? {}) }
      providers[family.providerId] = buildProviderProfile(family, providers[family.providerId], roots[family.id], models)
      return { ...current, providers }
    })
  }

  const removeProvider = async (family) => {
    if (currentProfile(family) === undefined) return false
    await editProviders((current) => {
      const providers = { ...(current.providers ?? {}) }
      delete providers[family.providerId]
      return { ...current, providers }
    })
    return true
  }

  /** Whether DSH itself resolves a model on the route, i.e. the profile took effect. */
  const routeReady = async (family, profile) => {
    const llm = ctx.get('llm')
    const first = profile?.models?.[0]?.id
    if (llm === undefined || typeof first !== 'string') return false
    try {
      await llm.resolveModelInfo(family.providerId, first)
      return true
    } catch {
      return false
    }
  }

  const snapshot = async (family) => {
    const profile = currentProfile(family)
    const models = Array.isArray(profile?.models) ? profile.models : []
    const repairReasons = profile === undefined ? [] : family.repairReasons(profile)
    return {
      group: family.id,
      providerId: family.providerId,
      baseURL: family.baseFor(roots[family.id]),
      keySet: await keyConfigured(family),
      configured: profile !== undefined,
      // A profile left by a hand-made setup is the broken case this plugin repairs.
      needsRepair: repairReasons.length > 0,
      repairReasons,
      routeReady: await routeReady(family, profile),
      canEdit: ctx.get('configEditor') !== undefined,
      models: models.map((model) => ({
 id: model.id,
        efforts: model.reasoningEfforts !== null && typeof model.reasoningEfforts === 'object' ? Object.keys(model.reasoningEfforts) : [],
        maxTokens: typeof model.maxTokens === 'number' ? model.maxTokens : null,
 contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : null,
      })),
      job: jobs[family.id],
      report: reports[family.id],
    }
  }

  const connect = async (family, typedKey) => {
    const update = (patch) => {
      jobs[family.id] = { ...jobs[family.id], ...patch }
    }
    try {
      piAi() // fail before any network call when the profile cannot be written
      const key = typedKey ?? (await storedKey(family))
      if (key === undefined) throw new StarapiError('NO_KEY', 'no key was given and none is stored')
      update({ phase: 'key' })
      const listed = await listModels(family, roots[family.id], key)
      // Stored once StarAPI accepted it, so a later failure does not ask for the key again.
      if (typedKey !== undefined) await ctx.credentials.set(family.keyRef, typedKey)

      update({ phase: 'models', total: listed.ids.length, done: 0 })
      const deadline = Date.now() + PROBE_BUDGET_MS
      const probes = await mapLimit(listed.ids, PROBE_CONCURRENCY, async (id) => {
        const probe = await family.probe(roots[family.id], key, id, deadline)
 update({ done: jobs[family.id].done + 1 })
        return probe
      })
      if (probes.some((probe) => probe.state === 'auth')) throw new StarapiError('KEY_INVALID', 'StarAPI refused the key on a model call')
      const kept = probes.filter((probe) => probe.state !== 'missing')
      if (kept.length === 0) throw new StarapiError('NO_USABLE_MODELS', 'the account cannot call any listed model')

      update({ phase: 'saving' })
      const entries = kept.map(family.entry)
      await writeProvider(family, entries)
      reports[family.id] = {
        at: Date.now(),
 models: kept.map((probe, index) => ({
   id: probe.id,
          verified: probe.verified === true,
   maxTokens: entries[index].maxTokens,
   ...(probe.reason === undefined ? {} : { reason: probe.reason }),
        })),
        dropped: probes.filter((probe) => probe.state === 'missing').map((probe) => probe.id),
        skipped: listed.skipped,
        // Every probe failing the same way means the gateway, not the models, is the problem.
 upstreamDown: kept.every((probe) => probe.state === 'unknown'),
      }
      update({ running: false, phase: 'done', error: null, detail: null, finishedAt: Date.now() })
    } catch (error) {
      ctx.logger.warn('starapi: %s connect failed: %s', family.id, redact(error))
      update({
        running: false,
 phase: 'failed',
        error: error instanceof StarapiError ? error.code : 'FAILED',
        detail: redact(error),
        finishedAt: Date.now(),
      })
    }
  }

  /** One real model call through DSH's own LLM service — the path a session uses. */
  const testModel = async (family, model, effort) => {
    const llm = ctx.get('llm')
    if (llm === undefined) throw new StarapiError('LLM_UNAVAILABLE', 'the llm service is not mounted')
    const profile = currentProfile(family)
    const entry = profile?.models?.find((candidate) => candidate.id === model)
    if (entry === undefined) throw new StarapiError('UNKNOWN_MODEL', `that model is not on the ${family.providerId} route`)
    if (effort !== undefined && !Object.hasOwn(entry.reasoningEfforts ?? {}, effort)) {
      throw new StarapiError('UNKNOWN_EFFORT', 'that model does not offer this thinking level')
    }
    const started = Date.now()
    let text = ''
    let thought = false
    let finish
    for await (const chunk of llm.stream({
      provider: family.providerId,
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with the single word: pong' }] }],
      maxTokens: 2_048,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'reasoning-delta') thought = true
      else if (chunk.type === 'finish') finish = chunk.reason
    }
    const failed = finish === undefined || finish.kind === 'error' || finish.kind === 'aborted'
    return {
      passed: !failed,
      model,
      effort: effort ?? profile.reasoning ?? null,
      text: text.trim().slice(0, 200),
      thought,
      ms: Date.now() - started,
      failure: failed ? { code: finish?.failure?.code ?? 'NO_FINISH', message: redact(finish?.failure?.message ?? 'the stream ended without a finish chunk') } : null,
    }
  }

  const usage = async (family) => {
    const key = await storedKey(family)
    if (key === undefined) throw new StarapiError('NO_KEY', 'no key is stored')
    const result = await starapi(roots[family.id], '/v1/usage', { key, timeoutMs: LIST_TIMEOUT_MS })
    if (result.status === 401) throw new StarapiError('KEY_INVALID', 'StarAPI refused the key')
    if (result.status !== 200 || result.json === undefined) throw new StarapiError('UPSTREAM', `usage HTTP ${result.status}`)
    const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null)
    const today = result.json.usage?.today
    return {
      balance: number(result.json.balance ?? result.json.remaining),
      unit: typeof result.json.unit === 'string' ? result.json.unit : null,
      todayRequests: number(today?.requests),
      todayTokens: number(today?.total_tokens),
    }
  }

  const readBody = async (request) => {
    try {
      const body = await request.json()
      return body !== null && typeof body === 'object' ? body : {}
    } catch {
      throw new StarapiError('BAD_REQUEST', 'the body is not JSON')
    }
  }

  const route = (family, name, method, run) =>
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${ROUTE}/${family.id}/${name}`,
          methods: [method],
   requestBody: 'buffered',
   fetch: async (request) => {
     try {
return json(200, { ok: true, ...(await run(request)) })
            } catch (error) {
       const code = error instanceof StarapiError ? error.code : 'FAILED'
       if (!(error instanceof StarapiError)) ctx.logger.warn('starapi: %s/%s failed: %s', family.id, name, redact(error))
       const status = ['BAD_REQUEST', 'KEY_MALFORMED', 'UNKNOWN_MODEL', 'UNKNOWN_EFFORT'].includes(code) ? 400 : code === 'BUSY' ? 409 : 500
       return json(status, { ok: false, error: code, detail: redact(error) })
     }
   },
        }),
      `starapi: ${ROUTE}/${family.id}/${name}`,
    )

  for (const family of Object.values(FAMILIES)) {
    route(family, 'state', 'GET', () => snapshot(family))

    route(family, 'connect', 'POST', async (request) => {
      const body = await readBody(request)
      if (jobs[family.id].running) throw new StarapiError('BUSY', 'a connect run is already in progress')
      const typedKey = body.key === undefined || body.key === null || body.key === '' ? undefined : normalizeKey(body.key)
      jobs[family.id] = { ...idleJob(), running: true, phase: 'starting' }
      // A failed re-detect must not leave the previous run's notes beside the error.
      reports[family.id] = null
      void connect(family, typedKey)
      return snapshot(family)
    })

    route(family, 'test', 'POST', async (request) => {
      const body = await readBody(request)
      if (typeof body.model !== 'string' || body.model.length === 0) throw new StarapiError('BAD_REQUEST', 'model is required')
      const effort = typeof body.effort === 'string' && body.effort.length > 0 ? body.effort : undefined
      return { test: await testModel(family, body.model, effort) }
    })

    route(family, 'usage', 'GET', async () => ({ usage: await usage(family) }))

    route(family, 'remove', 'POST', async (request) => {
      const body = await readBody(request)
      if (jobs[family.id].running) throw new StarapiError('BUSY', 'a connect run is in progress')
      await removeProvider(family)
      if (body.forgetKey === true) await ctx.credentials.unset(family.keyRef)
      reports[family.id] = null
      jobs[family.id] = idleJob()
      return snapshot(family)
    })
  }
}
