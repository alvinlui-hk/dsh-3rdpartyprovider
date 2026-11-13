/**
 * A local stand-in for StarAPI, reproducing the behaviours measured against
 * the real service on 2026-11-12, for both key groups:
 *
 * Claude group (`/v1/messages`, Anthropic):
 * - `GET /v1/models` lists models the account cannot call;
 * - such a model answers 404 `model_not_found`;
 * - newer models refuse `thinking.type` `disabled` and `enabled` with HTTP 400
 *   "requires adaptive thinking";
 * - some models refuse a large `max_tokens` with 503 `gateway_failover_exhausted`;
 * - thinking blocks are streamed without a signature.
 *
 * Codex group (`/v1/responses`, OpenAI):
 * - every chat model accepts `low`..`max` and echoes the effort back;
 *   an unknown effort string is refused with 400;
 * - `gpt-6.1-terra` answers 503 "Service temporarily unavailable";
 * - image models are listed but answer 503;
 * - streaming follows the Responses event grammar pi-ai parses, including
 *   `function_call` items for tool calls.
 *
 * Shared: a burst is answered 429 "Concurrency limit exceeded"; a key only
 * sees its own group's models, and a model of the other group is 404
 * `model_not_found`; `mode: 'down'` answers every model call with 503 while
 * the model list keeps working.
 *
 * `node test/fake-starapi.mjs [port] [mode]` runs it standalone for a manual DSH test.
 */
import { createServer } from 'node:http'

export const CLAUDE_KEY = 'sk-fake-claude-key-0123456789'
export const CODEX_KEY = 'sk-fake-codex-key-0123456789'
export const RC_KEY = 'sk-fake-rc-key-0123456789'

const CLAUDE_MODELS = {
  'claude-opus-4-8': { adaptiveOnly: false, cap: 128_000 },
  'claude-sonnet-5': { adaptiveOnly: false, cap: 128_000 },
  'claude-opus-5-5': { adaptiveOnly: true, cap: 128_000 },
  'claude-fable-5-1': { adaptiveOnly: true, cap: 64_000 },
  'claude-fable-5-2': { adaptiveOnly: true, cap: 128_000 },
  // Listed, never callable.
  'claude-sonnet-5-5': { callable: false },
  'claude-haiku-5-5': { callable: false },
}

const CODEX_MODELS = {
  'gpt-5.6-sol': { cap: 200_000 },
  'gpt-6-astra': { cap: 200_000 },
  'gpt-6-sol': { cap: 200_000 },
  'gpt-6.1-sol': { cap: 200_000 },
  // Listed, but the upstream is down for it.
  'gpt-6.1-terra': { down: true },
  // Listed, not chat models.
  'gpt-image-2': { image: true },
  'gpt-image-2.6': { image: true },
}

const CODEX_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

// RC (api.site) group: Claude models over OpenAI Responses. Mirrors the measured
// behaviour — a removed model answers 404 with a bare-string error, an exhausted
// upstream answers 503, working models accept every effort level.
const RC_MODELS = {
  'claude-opus-5-5': { cap: 128_000 },
  'claude-sonnet-5-5': { cap: 128_000 },
  'claude-opus-4-5-20251101': { cap: 128_000 },
  // Listed, but removed from the channel: 404 "model not found".
  'claude-fable-5-2': { removed: true },
  // Listed, but the upstream accounts are exhausted: 503.
  'claude-fable-5-1': { down: true },
  'claude-fable-5': { down: true },
}

const send = (res, status, body) => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

const anthropicError = (res, status, type, message) => send(res, status, { error: { message, type }, type: 'error' })
const responsesError = (res, status, type, message) => send(res, status, { error: { message, type }, type: 'error' })

const inputText = (body) => {
  const input = body?.input
  if (typeof input === 'string') return input
  if (Array.isArray(input)) {
    return input
      .flatMap((item) => (typeof item?.content === 'string' ? [{ type: 'text', text: item.content }] : item?.content ?? []))
      .filter((block) => block?.type === 'input_text' || block?.type === 'text')
      .map((block) => block.text ?? '')
      .join(' ')
  }
  return ''
}

const wantsTool = (text) => /weather|get_weather/i.test(text)

/** One Responses stream, in the event grammar pi-ai's parser consumes. */
function streamResponses(res, { model, effort, tool }) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const event = (type, extra) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`)
  const thinks = effort !== undefined
  const reasoningTokens = thinks && effort !== 'low' ? 4 : 0
  event('response.created', { response: { id: 'resp_fake', object: 'response', status: 'in_progress', output: [] } })
  let index = 0
  if (thinks) {
    event('response.output_item.added', { output_index: index, item: { type: 'reasoning', id: 'rs_fake', summary: [] } })
    event('response.reasoning_summary_text.delta', { output_index: index, item_id: 'rs_fake', delta: 'Thinking about it.\n' })
    event('response.output_item.done', {
      output_index: index,
      item: { type: 'reasoning', id: 'rs_fake', summary: [{ type: 'summary_text', text: 'Thinking about it.' }] },
    })
    index++
  }
  if (tool) {
    event('response.output_item.added', {
      output_index: index,
      item: { type: 'function_call', id: 'fc_fake', call_id: 'call_fake', name: 'get_weather', arguments: '' },
    })
    event('response.function_call_arguments.delta', { output_index: index, item_id: 'fc_fake', delta: '{"city":"' })
    event('response.function_call_arguments.delta', { output_index: index, item_id: 'fc_fake', delta: 'Tokyo"}' })
    event('response.output_item.done', {
      output_index: index,
      item: { type: 'function_call', id: 'fc_fake', call_id: 'call_fake', name: 'get_weather', arguments: '{"city":"Tokyo"}' },
    })
  } else {
    event('response.output_item.added', { output_index: index, item: { type: 'message', id: 'msg_fake', role: 'assistant', content: [] } })
    event('response.output_text.delta', { output_index: index, item_id: 'msg_fake', delta: 'pong' })
    event('response.output_item.done', {
      output_index: index,
      item: { type: 'message', id: 'msg_fake', role: 'assistant', content: [{ type: 'output_text', text: 'pong' }] },
    })
  }
  event('response.completed', {
    response: {
      id: 'resp_fake',
      object: 'response',
      status: 'completed',
      model,
      output: [],
      usage: {
        input_tokens: 12,
        output_tokens: 6 + reasoningTokens,
        total_tokens: 18 + reasoningTokens,
        output_tokens_details: { reasoning_tokens: reasoningTokens },
        input_tokens_details: { cached_tokens: 4, cache_write_tokens: 1 },
      },
    },
  })
  res.end()
}

/**
 * @param {{mode?: 'ok' | 'down', concurrency?: number, latencyMs?: number}} [options]
 * @returns {Promise<{url: string, requests: any[], stats: {rateLimited: number, peak: number}, setMode(mode: string): void, close(): Promise<void>}>}
 */
export async function startFakeStarapi(options = {}) {
  let mode = options.mode ?? 'ok'
  const concurrency = options.concurrency ?? 3
  const latencyMs = options.latencyMs ?? 15
  const requests = []
  const stats = { rateLimited: 0, peak: 0 }
  let inFlight = 0

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake')
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    const key = req.headers['x-api-key'] ?? bearer
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let body
    try {
      body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
    } catch {
      body = undefined
    }

    // Test-only: what callers actually sent, so a manual DSH run can be checked on the wire.
    if (req.method === 'GET' && url.pathname === '/__requests') {
      return send(res, 200, { requests: requests.map(({ method, path, body: sent }) => ({ method, path, body: sent })) })
    }
    // Test-only: switch between normal service and the outage without restarting.
    if (req.method === 'GET' && url.pathname === '/__mode') {
      if (url.searchParams.has('set')) mode = url.searchParams.get('set')
      return send(res, 200, { mode })
    }
    requests.push({ method: req.method, path: url.pathname, body, headers: req.headers })

    if (key !== CLAUDE_KEY && key !== CODEX_KEY && key !== RC_KEY) return send(res, 401, { code: 'INVALID_API_KEY', message: 'Invalid API key' })
    const group = key === CLAUDE_KEY ? 'claude' : key === CODEX_KEY ? 'codex' : 'rc'

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const ids = group === 'claude' ? Object.keys(CLAUDE_MODELS) : group === 'codex' ? Object.keys(CODEX_MODELS) : Object.keys(RC_MODELS)
      return send(res, 200, { data: ids.map((id) => ({ id, object: 'model', type: 'model', display_name: id, created_at: '2024-01-01T00:00:00Z' })) })
    }

    if (req.method === 'GET' && url.pathname === '/v1/usage') {
      return send(res, 200, { balance: 12.345, remaining: 12.345, unit: 'USD', usage: { today: { requests: 7, total_tokens: 4200 } } })
    }

    const modelId = body?.model
    const foreign = (group === 'claude' && !String(modelId ?? '').startsWith('claude-')) || (group === 'codex' && !/^(gpt-|o\d|codex)/i.test(String(modelId ?? ''))) || (group === 'rc' && !String(modelId ?? '').startsWith('claude-'))
    const notFound = () =>
      group === 'claude'
        ? anthropicError(res, 404, 'model_not_found', `Model "${modelId}" is not supported by any configured account in this group`)
        : group === 'rc'
          ? send(res, 404, { error: 'model not found' })
          : responsesError(res, 404, 'model_not_found', `Model "${modelId}" is not supported by any configured account in this group`)

    if (req.method === 'POST' && (url.pathname === '/v1/messages' || url.pathname === '/v1/responses')) {
      inFlight++
      stats.peak = Math.max(stats.peak, inFlight)
      try {
        if (inFlight > concurrency) {
          stats.rateLimited++
          return send(res, 429, { error: { message: 'Concurrency limit exceeded for user, please retry later', type: 'rate_limit_error' }, type: 'error' })
        }
        await new Promise((resolve) => setTimeout(resolve, latencyMs))
        if (foreign) return notFound()
        if (mode === 'down') {
          return group === 'claude'
            ? anthropicError(res, 503, 'gateway_failover_exhausted', 'All compatible upstream candidates were exhausted')
            : responsesError(res, 503, 'gateway_failover_exhausted', 'All compatible upstream candidates were exhausted')
        }

        if (group === 'claude') {
          const model = CLAUDE_MODELS[modelId]
          if (model === undefined || model.callable === false) return notFound()
          const thinking = body?.thinking?.type
          if (model.adaptiveOnly && (thinking === 'disabled' || thinking === 'enabled')) {
            return anthropicError(res, 400, 'invalid_request_error', `${modelId} requires adaptive thinking; omit thinking or use thinking.type=adaptive and output_config.effort`)
          }
          if (Number(body?.max_tokens) > model.cap) {
            return anthropicError(res, 503, 'gateway_failover_exhausted', 'All compatible upstream candidates were exhausted')
          }
          const thinks = thinking === 'adaptive' || thinking === 'enabled'
          if (body?.stream !== true) {
            return send(res, 200, {
              id: 'chatcmpl-fake',
              type: 'message',
              role: 'assistant',
              model: modelId,
              content: [{ type: 'text', text: 'pong' }, ...(thinks ? [{ type: 'thinking', thinking: 'Replying with pong.\n\n' }] : [])],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 5, cache_read_input_tokens: 10, cache_creation_input_tokens: 2 },
            })
          }
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
          const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
          event('message_start', {
            type: 'message_start',
            message: { id: 'chatcmpl-fake', type: 'message', role: 'assistant', model: modelId, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
          })
          let index = 0
          if (thinks) {
            // StarAPI's thinking block: no signature field, no signature_delta.
            event('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } })
            event('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: 'Replying with pong.\n\n' } })
            event('content_block_stop', { type: 'content_block_stop', index })
            index++
          }
          event('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
          event('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: 'pong' } })
          event('content_block_stop', { type: 'content_block_stop', index })
          event('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { input_tokens: 0, output_tokens: 5, cache_read_input_tokens: 10, cache_creation_input_tokens: 2 },
          })
          event('message_stop', { type: 'message_stop' })
          return res.end()
        }

        // RC (api.site) group: Claude over OpenAI Responses; no reasoning_tokens reported.
        if (group === 'rc') {
          const model = RC_MODELS[modelId]
          if (model === undefined || model.removed) return notFound()
          if (model.down) return responsesError(res, 503, 'server_error', 'All available accounts exhausted')
          const effort = body?.reasoning?.effort
          if (effort !== undefined && !CODEX_EFFORTS.has(effort)) return responsesError(res, 400, 'invalid_request_error', `Unsupported reasoning effort "${effort}"`)
          if (Number(body?.max_output_tokens) > model.cap) return responsesError(res, 400, 'invalid_request_error', 'max_output_tokens is too large')
          const tool = wantsTool(inputText(body))
          if (body?.stream === true) return streamResponses(res, { model: modelId, effort, tool })
          const output = tool
            ? [{ type: 'function_call', id: 'fc_fake', call_id: 'call_fake', name: 'get_weather', arguments: '{"city":"Tokyo"}' }]
            : [{ type: 'message', id: 'msg_fake', role: 'assistant', content: [{ type: 'output_text', text: 'pong' }] }]
          return send(res, 200, {
            id: 'resp_fake',
            object: 'response',
            status: 'completed',
            model: modelId,
            output,
            usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
          })
        }

        // Codex group
        const model = CODEX_MODELS[modelId]
        if (model === undefined) return notFound()
        if (model.image) return responsesError(res, 503, 'gateway_failover_exhausted', 'All compatible upstream candidates were exhausted')
        if (model.down) return responsesError(res, 503, 'api_error', 'Service temporarily unavailable')
        const effort = body?.reasoning?.effort
        if (effort !== undefined && !CODEX_EFFORTS.has(effort)) return responsesError(res, 400, 'invalid_request_error', `Unsupported reasoning effort "${effort}"`)
        if (Number(body?.max_output_tokens) > model.cap) return responsesError(res, 400, 'invalid_request_error', 'max_output_tokens is too large')
        const tool = wantsTool(inputText(body))
        if (body?.stream === true) return streamResponses(res, { model: modelId, effort, tool })
        const reasoningTokens = effort !== undefined && effort !== 'low' ? 4 : 0
        const output = tool
          ? [{ type: 'function_call', id: 'fc_fake', call_id: 'call_fake', name: 'get_weather', arguments: '{"city":"Tokyo"}' }]
          : [{ type: 'message', id: 'msg_fake', role: 'assistant', content: [{ type: 'output_text', text: 'pong' }] }]
        return send(res, 200, {
          id: 'resp_fake',
          object: 'response',
          status: 'completed',
          model: modelId,
          output,
          usage: {
            input_tokens: 12,
            output_tokens: 6 + reasoningTokens,
            total_tokens: 18 + reasoningTokens,
            output_tokens_details: { reasoning_tokens: reasoningTokens },
            input_tokens_details: { cached_tokens: 4, cache_write_tokens: 1 },
          },
        })
      } finally {
        inFlight--
      }
    }

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('404 page not found')
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    stats,
    setMode(next) {
      mode = next
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const fake = await startFakeStarapi({ port: Number(process.argv[2] ?? 0), mode: process.argv[3] ?? 'ok' })
  console.log(`fake StarAPI listening on ${fake.url}`)
}
