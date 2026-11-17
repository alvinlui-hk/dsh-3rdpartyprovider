window.__ModuleLoader__.load({
  id: '@alvinlui-hk/dsh-starapi',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'starapi'
    const EFFORT_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

    const zh = {
      zoneTitle: '中轉模型供應商（StarAPI / RC）',
      titleClaude: 'StarAPI Claude',
      titleCodex: 'StarAPI Codex',
      titleRc: 'RC Claude',
      titleRcCodex: 'RC Codex',
      checking: '檢查緊…',
      badgeReady: '已連接',
      badgeIdle: '未連接',
      badgeRepair: '需要修復',
      badgeWorking: '設定緊',
      badgeNotLoaded: '已儲存，未生效',
      introClaude: '貼上 StarAPI Claude 分組嘅 API Key，插件會自動偵測你個帳號用得嘅 Claude 模型，並按 StarAPI 嘅 adaptive thinking 要求設定好協議同思考級別。Key 只會存入本機憑證庫。',
      introCodex: '貼上 StarAPI Codex 分組嘅 API Key，插件會自動偵測你個帳號用得嘅 GPT 模型同佢哋真正接受嘅思考級別（StarAPI 會照收 "none" 但當 medium 跑，所以呢度唔提供「關」）。Key 只會存入本機憑證庫。',
      introRc: '貼上 RC（api.site）嘅 API Key，插件會自動偵測你個帳號用得嘅 Claude 模型同思考級別。RC 行 OpenAI Responses，「off/none」係假關（照樣思考），所以呢度唔提供「關」。Key 只會存入本機憑證庫。',
      introRcCodex: '貼上 RC（api.site）Codex 分組嘅 API Key，插件會自動偵測你個帳號用得嘅 GPT 模型同佢哋真正接受嘅思考級別。api.site 收到任何級別名都會回 200，所以插件會核對回傳嘅級別；「關」只會喺 none 真係關得到思考嘅模型先提供。Key 只會存入本機憑證庫。',
      introStoredKey: '憑證庫已經有呢個分組嘅 Key，可以直接連接，唔使再貼。',
      repairIntro: '現有設定有問題：',
      reason_protocol: '用咗呢組模型唔接受嘅協議',
      reason_adaptive: '冇開 adaptive thinking，一揀思考級別就會 400',
      reason_off_ignored: '聲明咗「關思考」，但 StarAPI 會照思考（"none" 當 medium 跑）',
      reason_off_fake: '有模型聲明咗「關思考」或 minimal，但呢個模型其實照樣思考（none 當 low 跑），或者會回 400',
      reason_non_chat: '包含咗唔識對話嘅模型（例如圖像模型）',
      reason_no_levels: '有模型冇聲明思考級別',
      reason_context: '冇寫上下文上限，DSH 會當 1,000,000 token，遲早撞牆',
      repairSuffix: '。㩒「修復」會重新偵測並改正。',
      notLoaded: '設定已寫入，但 DSH 未載入呢個供應商。請重啟 DeepSeek Harness。',
      keyLabel: 'API Key',
      keyPlaceholder: 'sk-…',
      connect: '連接',
      connectStored: '用已儲存嘅 Key 連接',
      repairAction: '修復',
      redetect: '重新偵測模型',
      changeKey: '更換 Key',
      cancel: '取消',
      remove: '移除供應商',
      removeConfirm: '確定移除？再㩒一次',
      forgetKey: '同時刪除已儲存嘅 Key',
      phaseStarting: '開始緊…',
      phaseKey: '驗證緊 Key…',
      phaseModels: '測試緊模型 {done} / {total}…',
      phaseSaving: '寫入緊設定…',
      colModel: '模型',
      colEfforts: '思考級別',
      colContext: '上下文',
      colMax: '最大輸出',
      unverified: '未驗證',
      noteDropped: '以下模型喺列表入面，但你個帳號實際調用唔到，已經略過：{models}',
      noteSkipped: '以下模型喺列表入面，但唔係對話模型（例如圖像模型或者工具模型），已經略過：{models}',
      noteUnverified: '有 {count} 個模型未能實測（{reason}），暫時用咗預設設定。中轉服務回復正常之後㩒「重新偵測模型」。',
      noteUpstreamDown: '中轉服務而家呢組模型全部調用唔到（{reason}），所以全部用咗預設設定。供應商已經加好，等服務回復之後㩒「重新偵測模型」。',
      testTitle: '測試調用',
      testRun: '測試',
      testRunning: '測試緊…',
      testDefault: '預設級別',
      testPassed: '成功：{model}（{effort}）用咗 {seconds} 秒回覆「{text}」',
      testThought: '，有思考內容',
      testNoThought: '，今次冇輸出思考內容',
      testFailed: '失敗：{message}',
      balance: '餘額 {balance} {unit}',
      today: '今日 {requests} 次請求',
      sharedWallet: '（{relay} 嘅 Claude 同 Codex 兩條 Key 共用同一個錢包）',
      errKeyInvalid: '{relay} 唔接受呢條 Key。請檢查有冇抄錯，或者係咪抄咗另一個分組嘅 Key。',
      errKeyMalformed: '呢條 Key 嘅格式唔啱。',
      errNoKey: '未有 Key，請貼上。',
      errNoModels: '呢條 Key 嘅帳號冇任何可用嘅對話模型。可能係抄錯咗分組嘅 Key。',
      errNoUsable: '列表入面嘅模型，你個帳號全部都調用唔到。',
      errNetwork: '連唔到 {relay}：{detail}',
      errUpstream: '{relay} 回應異常：{detail}',
      errEditor: '呢個 profile 冇設定編輯器，寫唔到設定。',
      errPiAi: '呢個 profile 未啟用 llm-pi-ai 插件。',
      errBusy: '上一次設定仲未完成。',
      errHost: '連唔到插件後台，請重新整理頁面。',
      errOther: '出錯：{detail}',
    }

    const en = {
      zoneTitle: 'Relay model providers (StarAPI / RC)',
      titleClaude: 'StarAPI Claude',
      titleCodex: 'StarAPI Codex',
      titleRc: 'RC Claude',
      titleRcCodex: 'RC Codex',
      checking: 'Checking…',
      badgeReady: 'Connected',
      badgeIdle: 'Not connected',
      badgeRepair: 'Needs repair',
      badgeWorking: 'Setting up',
      badgeNotLoaded: 'Saved, not loaded',
      introClaude: "Paste the API key of StarAPI's Claude group. The plugin finds the Claude models your account can call and sets the protocol and thinking levels StarAPI requires. The key is stored only in the local credential store.",
      introCodex: 'Paste the API key of StarAPI\'s Codex group. The plugin finds the GPT models your account can call and the thinking levels they really accept (StarAPI accepts "none" but runs it as medium, so no "off" is offered here). The key is stored only in the local credential store.',
      introRc: 'Paste the RC (api.site) API key. The plugin finds the Claude models your account can call and their thinking levels. RC uses OpenAI Responses; "off/none" is fake (it still thinks), so no "off" is offered here. The key is stored only in the local credential store.',
      introRcCodex: 'Paste the API key of the RC (api.site) Codex group. The plugin finds the GPT models your account can call and the thinking levels they really accept. api.site answers 200 to any level name, so the plugin checks the level it reports back; "off" is offered only on models where "none" really stops the thinking. The key is stored only in the local credential store.',
      introStoredKey: 'A key for this group is already stored, so you can connect without pasting it again.',
      repairIntro: 'The existing setup has problems: ',
      reason_protocol: 'it uses a protocol this group does not accept',
      reason_adaptive: 'adaptive thinking is off, so any thinking level fails with HTTP 400',
      reason_off_ignored: 'it declares "off", but StarAPI thinks anyway ("none" runs as medium)',
      reason_off_fake: 'a model declares "off" or "minimal", but it thinks anyway ("none" runs as low) or answers HTTP 400',
      reason_non_chat: 'it lists models that cannot chat (image models, for example)',
      reason_no_levels: 'a model declares no thinking levels',
      reason_context: 'no context window is declared, so DSH assumes 1,000,000 tokens and will hit the real limit',
      repairSuffix: '. Repair re-detects the models and corrects it.',
      notLoaded: 'The setup was saved, but DSH has not loaded this provider. Restart DeepSeek Harness.',
      keyLabel: 'API key',
      keyPlaceholder: 'sk-…',
      connect: 'Connect',
      connectStored: 'Connect with the stored key',
      repairAction: 'Repair',
      redetect: 'Re-detect models',
      changeKey: 'Change key',
      cancel: 'Cancel',
      remove: 'Remove provider',
      removeConfirm: 'Click again to remove',
      forgetKey: 'Also delete the stored key',
      phaseStarting: 'Starting…',
      phaseKey: 'Checking the key…',
      phaseModels: 'Testing models {done} / {total}…',
      phaseSaving: 'Saving the setup…',
      colModel: 'Model',
      colEfforts: 'Thinking levels',
      colContext: 'Context',
      colMax: 'Max output',
      unverified: 'not verified',
      noteDropped: 'Listed by the relay but not callable by your account, so left out: {models}',
      noteSkipped: 'Listed by the relay but not chat models (image models or tool models, for example), so left out: {models}',
      noteUnverified: '{count} model(s) could not be tested ({reason}) and use default settings. Re-detect once the relay is back to normal.',
      noteUpstreamDown: 'The relay cannot call any model of this group right now ({reason}), so every model uses default settings. The provider is added; re-detect once the relay recovers.',
      testTitle: 'Test call',
      testRun: 'Test',
      testRunning: 'Testing…',
      testDefault: 'default level',
      testPassed: 'Passed: {model} ({effort}) answered "{text}" in {seconds}s',
      testThought: ', with thinking',
      testNoThought: ', no thinking output this time',
      testFailed: 'Failed: {message}',
      balance: 'Balance {balance} {unit}',
      today: '{requests} requests today',
      sharedWallet: ' (the {relay} Claude and Codex keys share one wallet)',
      errKeyInvalid: '{relay} refused this key. Check it was copied correctly, and that it is the key of this group.',
      errKeyMalformed: 'That does not look like a key.',
      errNoKey: 'No key yet. Paste one.',
      errNoModels: "This key's account lists no usable chat model. It may be a key of the other group.",
      errNoUsable: 'Your account cannot call any of the listed models.',
      errNetwork: '{relay} is unreachable: {detail}',
      errUpstream: '{relay} answered unexpectedly: {detail}',
      errEditor: 'This profile has no config editor, so the setup cannot be written.',
      errPiAi: 'The llm-pi-ai plugin is not enabled in this profile.',
      errBusy: 'The previous setup run has not finished.',
      errHost: 'The plugin host is unreachable. Reload the page.',
      errOther: 'Error: {detail}',
    }

    const GROUPS = [
      // Each relay's two keys share one wallet: StarAPI's Claude + Codex, and RC's Claude + Codex.
      { id: 'claude', title: 'titleClaude', intro: 'introClaude', showContext: false, icon: '★', relay: 'StarAPI' },
      { id: 'codex', title: 'titleCodex', intro: 'introCodex', showContext: true, icon: '⌘', relay: 'StarAPI' },
      { id: 'rc-claude', title: 'titleRc', intro: 'introRc', showContext: true, icon: 'R', relay: 'RC' },
      { id: 'rc-codex', title: 'titleRcCodex', intro: 'introRcCodex', showContext: true, icon: 'R', relay: 'RC' },
    ]

    const fill = (text, values) =>
      Object.entries(values ?? {}).reduce((result, [key, value]) => result.split('{' + key + '}').join(String(value)), text)

    /** Host routes live under the application base, which a reverse proxy may mount below `/`. */
    const api = async (group, name, options) => {
      let response
      try {
        response = await fetch(new URL(`api/starapi/${group}/${name}`, document.baseURI).href, {
          method: options?.method ?? 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: options?.body === undefined ? undefined : { 'content-type': 'application/json' },
          body: options?.body === undefined ? undefined : JSON.stringify(options.body),
        })
      } catch {
        throw Object.assign(new Error('HOST'), { code: 'HOST' })
      }
      let body
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      if (body === undefined) throw Object.assign(new Error('HOST'), { code: 'HOST', detail: 'HTTP ' + response.status })
      if (!response.ok || body.ok === false) {
        throw Object.assign(new Error(body.error ?? 'FAILED'), { code: body.error ?? 'FAILED', detail: body.detail })
      }
      return body
    }

    const errorText = (t, code, detail, relay) => {
      const map = {
        KEY_INVALID: 'errKeyInvalid',
        KEY_MALFORMED: 'errKeyMalformed',
        NO_KEY: 'errNoKey',
        NO_MODELS: 'errNoModels',
        NO_USABLE_MODELS: 'errNoUsable',
        NETWORK: 'errNetwork',
        UPSTREAM: 'errUpstream',
        CONFIG_EDITOR_UNAVAILABLE: 'errEditor',
        PI_AI_UNAVAILABLE: 'errPiAi',
        BUSY: 'errBusy',
        HOST: 'errHost',
      }
      return fill(t(map[code] ?? 'errOther'), { detail: detail ?? code ?? '', relay: relay ?? '' })
    }

    const formatTokens = (value) => {
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || numeric <= 0) return '—'
      return numeric >= 1000 ? Math.round(numeric / 1000) + 'K' : String(numeric)
    }

    function Card(props) {
      const t = props.t
      const group = props.group
      const [state, setState] = React.useState(null)
      const [key, setKey] = React.useState('')
      const [editingKey, setEditingKey] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [usage, setUsage] = React.useState(null)
      const [testModelId, setTestModelId] = React.useState('')
      const [testEffort, setTestEffort] = React.useState('')
      const [testing, setTesting] = React.useState(false)
      const [testResult, setTestResult] = React.useState(null)
      const [confirmRemove, setConfirmRemove] = React.useState(false)
      const [forgetKey, setForgetKey] = React.useState(false)
      const mounted = React.useRef(true)

      const load = React.useCallback(async () => {
        try {
          const next = await api(group.id, 'state')
          if (!mounted.current) return
          setState(next)
          // A read that works again withdraws an earlier "host unreachable"; other errors stay until the next action.
          setError((current) => (current?.code === 'HOST' ? null : current))
        } catch (failure) {
          if (mounted.current) setError({ code: failure.code, detail: failure.detail })
        }
      }, [group.id])

      React.useEffect(() => {
        mounted.current = true
        load()
        return () => {
          mounted.current = false
        }
      }, [load])

      const running = state?.job?.running === true
      React.useEffect(() => {
        if (!running) return undefined
        const timer = setInterval(load, 1000)
        return () => clearInterval(timer)
      }, [running, load])

      const configured = state?.configured === true
      const keySet = state?.keySet === true
      React.useEffect(() => {
        if (!configured || !keySet || running) return undefined
        let cancelled = false
        api(group.id, 'usage')
          .then((body) => {
            if (!cancelled && mounted.current) setUsage(body.usage)
          })
          .catch(() => {
            if (!cancelled && mounted.current) setUsage(null)
          })
        return () => {
          cancelled = true
        }
      }, [group.id, configured, keySet, running])

      const models = state?.models ?? []
      React.useEffect(() => {
        if (models.length === 0) return
        if (!models.some((model) => model.id === testModelId)) setTestModelId(models[0].id)
      }, [models.map((model) => model.id).join('|')])
      const selected = models.find((model) => model.id === testModelId)
      React.useEffect(() => {
        if (testEffort !== '' && !(selected?.efforts ?? []).includes(testEffort)) setTestEffort('')
      }, [testModelId])

      const connect = async (withKey) => {
        if (busy || running) return
        setBusy(true)
        setError(null)
        setTestResult(null)
        try {
          const next = await api(group.id, 'connect', { method: 'POST', body: withKey ? { key } : {} })
          if (!mounted.current) return
          setState(next)
          setKey('')
          setEditingKey(false)
        } catch (failure) {
          if (mounted.current) setError({ code: failure.code, detail: failure.detail })
        } finally {
          if (mounted.current) setBusy(false)
        }
      }

      const remove = async () => {
        if (!confirmRemove) {
          setConfirmRemove(true)
          return
        }
        setBusy(true)
        setError(null)
        try {
          const next = await api(group.id, 'remove', { method: 'POST', body: { forgetKey } })
          if (!mounted.current) return
          setState(next)
          setUsage(null)
          setTestResult(null)
        } catch (failure) {
          if (mounted.current) setError({ code: failure.code, detail: failure.detail })
        } finally {
          if (mounted.current) {
            setBusy(false)
            setConfirmRemove(false)
            setForgetKey(false)
          }
        }
      }

      const runTest = async () => {
        if (testing || testModelId === '') return
        setTesting(true)
        setTestResult(null)
        try {
          const body = await api(group.id, 'test', { method: 'POST', body: { model: testModelId, effort: testEffort } })
          if (mounted.current) setTestResult(body.test)
        } catch (failure) {
          if (mounted.current) setTestResult({ passed: false, failure: { message: errorText(t, failure.code, failure.detail, group.relay) } })
        } finally {
          if (mounted.current) setTesting(false)
        }
      }

      const job = state?.job
      const report = state?.report
      const needsRepair = state?.needsRepair === true
      const notLoaded = configured && !needsRepair && !running && state?.routeReady === false
      const badge =
        state === null
          ? t('checking')
          : running
            ? t('badgeWorking')
            : needsRepair
              ? t('badgeRepair')
              : notLoaded
                ? t('badgeNotLoaded')
                : configured
                  ? t('badgeReady')
                  : t('badgeIdle')
      const tone = running || needsRepair || notLoaded ? 'warn' : configured ? 'ok' : 'idle'
      const phaseText = !running
        ? null
        : job.phase === 'key'
          ? t('phaseKey')
          : job.phase === 'models'
            ? fill(t('phaseModels'), { done: job.done, total: job.total })
            : job.phase === 'saving'
              ? t('phaseSaving')
              : t('phaseStarting')
      const jobError = !running && job?.phase === 'failed' ? { code: job.error, detail: job.detail } : null
      const shown = error ?? jobError
      const unverified = (report?.models ?? []).filter((model) => !model.verified)
      const unverifiedIds = new Set(unverified.map((model) => model.id))
      const reason = unverified.find((model) => model.reason)?.reason ?? '—'
      // The key field shows whenever a key is needed: none is stored yet, or the user asked to change it.
      const showKeyForm = !running && (!keySet || editingKey)
      const repairText = needsRepair
        ? t('repairIntro') + (state.repairReasons ?? []).map((code) => t('reason_' + code.replace(/-/g, '_'))).join('；') + t('repairSuffix')
        : null

      const keyForm = h(
        React.Fragment,
        null,
        h('label', { className: 'sac_label', htmlFor: 'sac-key-' + group.id }, t('keyLabel')),
        h('input', {
          id: 'sac-key-' + group.id,
          className: 'sac_input',
          type: 'password',
          value: key,
          placeholder: t('keyPlaceholder'),
          autoComplete: 'new-password',
          spellCheck: false,
          onChange: (event) => setKey(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && key.trim().length > 0) connect(true)
          },
        }),
      )

      const showContext = group.showContext || models.some((model) => model.contextWindow !== null)
      const table =
        models.length === 0
          ? null
          : h(
              'table',
              { className: 'sac_table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, t('colModel')),
                  h('th', null, t('colEfforts')),
                  showContext ? h('th', null, t('colContext')) : null,
                  h('th', null, t('colMax')),
                ),
              ),
              h(
                'tbody',
                null,
                models.map((model) =>
                  h(
                    'tr',
                    { key: model.id },
                    h(
                      'td',
                      { className: 'sac_mono' },
                      model.id,
                      unverifiedIds.has(model.id) ? h('span', { className: 'sac_tag' }, t('unverified')) : null,
                    ),
                    h('td', null, EFFORT_ORDER.filter((level) => model.efforts.includes(level)).join(' · ')),
                    showContext ? h('td', null, formatTokens(model.contextWindow)) : null,
                    h('td', null, formatTokens(model.maxTokens)),
                  ),
                ),
              ),
            )

      const notes = [
        report?.upstreamDown ? fill(t('noteUpstreamDown'), { reason }) : null,
        !report?.upstreamDown && unverified.length > 0 ? fill(t('noteUnverified'), { count: unverified.length, reason }) : null,
        (report?.dropped ?? []).length > 0 ? fill(t('noteDropped'), { models: report.dropped.join(', ') }) : null,
        (report?.skipped ?? []).length > 0 ? fill(t('noteSkipped'), { models: report.skipped.join(', ') }) : null,
      ].filter(Boolean)

      const testLine =
        testResult === null
          ? null
          : testResult.passed
            ? fill(t('testPassed'), {
                model: testResult.model,
                effort: testResult.effort ?? t('testDefault'),
                seconds: (testResult.ms / 1000).toFixed(1),
                text: testResult.text,
              }) + (testResult.thought ? t('testThought') : t('testNoThought'))
            : fill(t('testFailed'), { message: testResult.failure?.message ?? '' })

      const usageLine =
        usage === null || usage.balance === null
          ? null
          : [
              fill(t('balance'), { balance: usage.balance.toFixed(2), unit: usage.unit ?? '' }) + fill(t('sharedWallet'), { relay: group.relay }),
              usage.todayRequests === null ? null : fill(t('today'), { requests: usage.todayRequests }),
            ]
              .filter(Boolean)
              .join(' · ')

      return h(
        'section',
        { className: 'sac_card', 'data-plugin': 'starapi:' + group.id },
        h(
          'div',
          { className: 'sac_header' },
          h('span', { className: 'sac_icon sac_icon_' + group.id, 'aria-hidden': true }, group.icon),
          h(
            'div',
            { className: 'sac_heading' },
            h(
              'div',
              { className: 'sac_titleRow' },
              h('h3', { className: 'sac_title' }, t(group.title)),
              h('span', { className: 'sac_badge sac_badge_' + tone }, badge),
            ),
            usageLine ? h('p', { className: 'sac_meta' }, usageLine) : null,
          ),
        ),
        !configured && !running ? h('p', { className: 'sac_text' }, keySet && !editingKey ? t('introStoredKey') : t(group.intro)) : null,
        repairText && !running ? h('p', { className: 'sac_warn' }, repairText) : null,
        notLoaded ? h('p', { className: 'sac_warn' }, t('notLoaded')) : null,
        phaseText ? h('p', { className: 'sac_text', role: 'status' }, phaseText) : null,
        configured && !needsRepair && !running ? table : null,
        configured && !running ? notes.map((note, index) => h('p', { key: index, className: 'sac_warn' }, note)) : null,
        showKeyForm ? keyForm : null,
        shown ? h('p', { className: 'sac_error', role: 'alert' }, errorText(t, shown.code, shown.detail, group.relay)) : null,
        configured && !needsRepair && !running && models.length > 0
          ? h(
              'div',
              { className: 'sac_test' },
              h('span', { className: 'sac_label' }, t('testTitle')),
              h(
                'select',
                { className: 'sac_select', value: testModelId, onChange: (event) => setTestModelId(event.target.value), 'aria-label': t('colModel') },
                models.map((model) => h('option', { key: model.id, value: model.id }, model.id)),
              ),
              h(
                'select',
                { className: 'sac_select', value: testEffort, onChange: (event) => setTestEffort(event.target.value), 'aria-label': t('colEfforts') },
                h('option', { value: '' }, t('testDefault')),
                EFFORT_ORDER.filter((level) => (selected?.efforts ?? []).includes(level)).map((level) =>
                  h('option', { key: level, value: level }, level),
                ),
              ),
              h(
                'button',
                { type: 'button', className: 'sac_button sac_secondary', disabled: testing, onClick: runTest },
                testing ? t('testRunning') : t('testRun'),
              ),
            )
          : null,
        testLine ? h('p', { className: testResult.passed ? 'sac_ok' : 'sac_error' }, testLine) : null,
        running
          ? null
          : h(
              'div',
              { className: 'sac_actions' },
              // Exactly one main action: with the key field open it submits that key, otherwise it reuses the stored one.
              showKeyForm
                ? h('button', { type: 'button', className: 'sac_button sac_primary', disabled: busy || key.trim().length === 0, onClick: () => connect(true) }, t('connect'))
                : !configured
                  ? h('button', { type: 'button', className: 'sac_button sac_primary', disabled: busy, onClick: () => connect(false) }, t('connectStored'))
                  : needsRepair
                    ? h('button', { type: 'button', className: 'sac_button sac_primary', disabled: busy, onClick: () => connect(false) }, t('repairAction'))
                    : h('button', { type: 'button', className: 'sac_button sac_secondary', disabled: busy, onClick: () => connect(false) }, t('redetect')),
              keySet && !editingKey
                ? h('button', { type: 'button', className: 'sac_button sac_secondary', disabled: busy, onClick: () => setEditingKey(true) }, t('changeKey'))
                : null,
              editingKey
                ? h('button', { type: 'button', className: 'sac_button sac_secondary', disabled: busy, onClick: () => { setEditingKey(false); setKey('') } }, t('cancel'))
                : null,
              configured && !editingKey
                ? h('button', { type: 'button', className: 'sac_button sac_secondary' + (confirmRemove ? ' sac_danger' : ''), disabled: busy, onClick: remove }, confirmRemove ? t('removeConfirm') : t('remove'))
                : null,
              confirmRemove
                ? h(
                    'label',
                    { className: 'sac_check' },
                    h('input', { type: 'checkbox', checked: forgetKey, onChange: (event) => setForgetKey(event.target.checked) }),
                    t('forgetKey'),
                  )
                : null,
              confirmRemove
                ? h('button', { type: 'button', className: 'sac_button sac_secondary', onClick: () => { setConfirmRemove(false); setForgetKey(false) } }, t('cancel'))
                : null,
            ),
      )
    }

    const css = `
      .sac_zone{display:flex;flex-direction:column;gap:12px;margin-top:16px}
      .sac_zoneTitle{margin:0;font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-secondary,#666);text-transform:uppercase;letter-spacing:.04em}
      .sac_card{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l1,#e3e3e8);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#18181b);font-size:13px;line-height:20px}
      .sac_header{display:flex;align-items:flex-start;gap:12px}
      .sac_icon{display:flex;flex:none;width:32px;height:32px;border-radius:9px;background:#b4532a;color:#fff;align-items:center;justify-content:center;font-size:16px}
      .sac_icon_codex{background:#1f6f5c}
      .sac_icon_rc-claude{background:#4b2e83}
      .sac_icon_rc-codex{background:#2e4b83}
      .sac_heading{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
      .sac_titleRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .sac_title{margin:0;font-size:14px;line-height:20px;font-weight:600}
      .sac_badge{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,#e3e3e8);color:var(--dsw-alias-label-secondary,#666)}
      .sac_badge_ok{color:var(--dsw-alias-state-success-primary,#2e7d32);border-color:currentColor}
      .sac_badge_warn{color:var(--dsw-alias-state-warn-primary,#9a6700);border-color:currentColor}
      .sac_text{margin:0}
      .sac_meta{margin:0;color:var(--dsw-alias-label-secondary,#666);font-size:12px;line-height:18px}
      .sac_warn{margin:0;color:var(--dsw-alias-state-warn-primary,#9a6700);font-size:12px;line-height:18px;overflow-wrap:anywhere}
      .sac_error{margin:0;color:var(--dsw-alias-state-error-primary,#c62828);font-size:12px;line-height:18px;overflow-wrap:anywhere}
      .sac_ok{margin:0;color:var(--dsw-alias-state-success-primary,#2e7d32);font-size:12px;line-height:18px;overflow-wrap:anywhere}
      .sac_label{font-size:12px;font-weight:600}
      .sac_input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#cfcfd6);border-radius:8px;padding:8px;font:inherit;font-size:12px;background:var(--dsw-alias-bg-base,#fff);color:inherit}
      .sac_table{width:100%;border-collapse:collapse;font-size:12px;line-height:18px}
      .sac_table th{text-align:left;font-weight:600;color:var(--dsw-alias-label-secondary,#666);padding:4px 8px 4px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#e3e3e8)}
      .sac_table td{padding:4px 8px 4px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#e3e3e8);vertical-align:top}
      .sac_mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Consolas,monospace)}
      .sac_tag{margin-left:6px;font-size:10px;padding:0 6px;border-radius:999px;border:1px solid currentColor;color:var(--dsw-alias-state-warn-primary,#9a6700);font-family:inherit}
      .sac_test{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .sac_select{border:1px solid var(--dsw-alias-border-l2,#cfcfd6);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px;background:var(--dsw-alias-bg-base,#fff);color:inherit;max-width:100%}
      .sac_actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .sac_button{appearance:none;border:1px solid transparent;border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;line-height:18px;cursor:pointer}
      .sac_button:disabled{opacity:.55;cursor:default}
      .sac_primary{background:#b4532a;color:#fff}
      .sac_secondary{border-color:var(--dsw-alias-border-l2,#cfcfd6);background:transparent;color:inherit}
      .sac_danger{border-color:var(--dsw-alias-state-error-primary,#c62828);color:var(--dsw-alias-state-error-primary,#c62828)}
      .sac_check{display:flex;align-items:center;gap:6px;font-size:12px}
    `

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'starapi: dictionaries')
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.dataset.plugin = 'starapi'
          tag.textContent = css
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'starapi: styles')
        ctx.slots.inject('settings.models.footer', () =>
          ctx.slots.register(
            { name: 'settings.models.footer', id: 'starapi', order: 23, locale: NS },
            (props) =>
              h(
                'div',
                { className: 'sac_zone' },
                h('h2', { className: 'sac_zoneTitle' }, props.t('zoneTitle')),
                GROUPS.map((group) => h(Card, { key: group.id, t: props.t, group })),
              ),
          ),
        )
      },
    }
  },
})
