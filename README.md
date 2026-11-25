# 3rdPartyProvider for DSH

喺 DeepSeek Harness（DSH）一次過設定四個中轉（relay）供應商：**StarAPI Claude**、**StarAPI Codex（GPT）**、**RC Claude**、**RC Codex（GPT）**（RC 即係 api.site）。裝好之後喺 **設定 → 模型** 每個分組貼一次 API Key，插件會自動偵測你個帳號用得嘅模型，並寫好可以正常使用（包括思考模式）嘅供應商 `starapi-claude`、`starapi-codex`、`rc-claude`、`rc-codex`。

非官方插件，同 StarAPI、api.site、OpenAI、Anthropic、DeepSeek 冇關係。

> 由 1.3.1 起，插件顯示名改為 **3rdPartyProvider for DSH**（原名 StarAPI / RC providers）。今次只改品牌，唔改供應商功能；目前支援上面四個分組，唔係通用嘅任意供應商設定器。
>
> 為咗直接升級，package 名 `@alvinlui-hk/dsh-starapi`、插件 ID `starapi`、`/api/starapi/` 後台路徑、四個供應商 ID 同憑證 Key 名全部保留。現有設定同已儲存嘅 Key 唔使搬，亦唔使移除舊插件再裝。GitHub repo 已更名為 [`alvinlui-hk/dsh-3rdpartyprovider`](https://github.com/alvinlui-hk/dsh-3rdpartyprovider)；舊網址由 GitHub 轉址，建議新安裝改用新網址。已發布嘅 v1.3.1 tag 保持不變，當中提及 repo 暫時保留原名嘅文字係更名前嘅歷史說明。

## 點解需要呢個插件

四個分組各有陷阱，手動加供應商好容易中伏：

**StarAPI Claude 組**：模型列表睇落係 OpenAI 格式，但只接受 **Anthropic Messages + adaptive thinking**。揀 OpenAI Responses，或者揀 Anthropic Messages 但冇開 adaptive 開關，結果都係：攞到模型列表，但一揀思考級別就 HTTP 400：

```
claude-fable-5-2 requires adaptive thinking; omit thinking or use thinking.type=adaptive and output_config.effort
```

**StarAPI Codex 組**：用 OpenAI Responses，但有四個伏位：

- `reasoning.effort: "none"` StarAPI 照收，但當 `medium` 跑 —— 即係「關思考」係假嘅；
- `xhigh` 同 `max` 其實用得，但手動設定好容易漏；
- 列表入面嘅 `gpt-image-*` 係圖像模型，唔識對話，加落去只會喺選用嗰陣先失敗；
- 手動聲明嘅 route 冇寫 `contextWindow`，DSH 會當 1,000,000 token，但實際上限細得多，長對話會撞牆。

**RC Claude 組（api.site）**：用 OpenAI Responses，實測發現：

- `off`/`none` 係**假關**——送 `none` 照樣思考（streaming 實測：`none` 同唔送 reasoning 嘅思考量一樣），所以插件唔提供「關」；
- `low`/`medium`/`high`/`xhigh`/`max` 全部接受，`max` 真係思考多啲；
- RC Claude 組**唔回報 `reasoning_tokens`、唔 echo effort**，所以插件用 HTTP 狀態（200/400）嚟判斷級別支援；
- 渠道更新後 `claude-fable-5-2` 可能已經冇咗（404 model not found），`fable-5`/`fable-5-1` 可能暫時 503（上游帳號耗盡）——插件會將 404 嘅略過、503 嘅保留但標「未驗證」；
- 手動設定嘅 `opus-5-5`/`opus-5`/`sonnet-5-5` 冇寫 `reasoningEfforts`，會被當成非思考模型，但佢哋實際係會思考嘅。

**RC Codex 組（api.site）**：用 OpenAI Responses，同 RC Claude 共用一個錢包，實測發現：

- **任何級別名都回 200**：連唔存在嘅級別都照收，然後當 `high` 跑；`codex-auto-review` 收到 `max` 會降做 `xhigh`。所以唔可以靠 HTTP 狀態判斷，插件會核對回傳嘅 `reasoning.effort` 係咪等於請求嗰個；
- **`none` 有真有假**：`gpt-6-sol`、`gpt-5.6-sol` 送 `none` 會回 `none`、思考 0 token，係真關；`gpt-6.1-sol`、`gpt-6-astra` 送 `none` 會回 `low`，照樣思考，係假關。插件只會喺真關嘅模型提供「關」，並送 `none`；
- `minimal` 喺幾個模型會回 400 `Upstream request failed`，所以唔提供；
- `codex-auto-review` 係 Codex 嘅審查工具模型，唔係對話模型，插件會略過；
- 手動加嘅 `rc-codex` 冇寫 `reasoningEfforts`，DSH 會當佢係非思考模型，冇推理等級揀，亦唔會送 `reasoning`。

插件會逐個模型實測之後先寫設定：

| 設定 | StarAPI Claude | StarAPI Codex | RC Claude | RC Codex |
|---|---|---|---|---|
| Gateway | starapi.io | starapi.io | api.site | api.site |
| `api` | `anthropic-messages` | `openai-responses` | `openai-responses` | `openai-responses` |
| `baseURL` | 根位址 | 根位址 + `/v1` | 根位址 + `/v1` | 根位址 + `/v1` |
| `compat.forceAdaptiveThinking` | `true` | — | — | — |
| `compat.allowEmptySignature` | `true` | — | — | — |
| 思考級別 | 實測（新模型冇 `off`） | 實測（冇 `off`/`minimal`） | 實測（冇 `off`，`none` 係假關） | 實測回傳級別（`off` 只喺真關嘅模型，送 `none`） |
| 最大輸出 | 實測（128K 向下試） | 128K | 實測（128K 向下試） | 實測（128K 向下試） |
| 上下文 | DSH 預設 1M | 272K | 4-5 代 200K，其餘 1M | 272K |
| 模型清單 | 略過調用唔到嘅 | 略過調用唔到嘅 + 圖像模型 | 略過 404 嘅 | 略過 404 嘅 + 工具模型 |

## 安裝

需要 DeepSeek Harness `0.2.2-rc.1` 或以上，同有 Web 介面嘅 profile（Desktop 或 `dsh web`）。插件係 DSH bundle，請用 DSH 插件管理器安裝；單獨執行一般 `npm install` 唔會將插件加入 DSH profile。

### 方法一：喺 DSH 介面安裝（macOS／Windows／Linux）

1. 開 DSH，去 **插件** 頁面，㩒 **添加插件**。
2. 喺「包名或地址」貼入 v1.3.1 tag archive：
   `https://github.com/alvinlui-hk/dsh-3rdpartyprovider/archive/refs/tags/v1.3.1.tar.gz`
3. 安裝並啟用 `@alvinlui-hk/dsh-starapi`。確認版本係 `1.3.1`，而且只有一個 `include:starapi` entry。

如果插件已裝舊版，請用 DSH 插件頁原地更新，唔好移除後另裝一份；package 名、插件 ID、供應商 ID 同已存 Key 都刻意保持不變。

### 方法二：用 DSH 入面嘅 Agent

要求 Agent 將以上 GitHub tag archive URL 安裝到**目前 profile**並啟用。確認安裝結果係 1.3.1、`application: applied`（或者依介面提示正常重啟），唔好將 URL 貼去一般對話當成安裝完成。

### 方法三：npm registry（待 npm 發佈後）

DSH 插件管理器支援從 npm registry 安裝 bundle。發佈後可喺 **插件 → 添加插件** 輸入：

```text
@alvinlui-hk/dsh-starapi@1.3.1
```

亦可以要求 DSH Agent 安裝同一個 package spec。呢個係透過 DSH 插件管理器安裝到 profile，唔係喺任意目錄執行 `npm install`。截至 2026-11-25，npm registry 尚未有呢個 package；喺 npm 發佈完成前，請用上面嘅 GitHub tag archive 安裝。請勿用 `@latest` 代替指定版本，除非你確認咗最新 release。

## macOS 驗證紀錄

2026-11-25 已喺一部 Apple Silicon Mac 完成 v1.3.1 驗證：DSH `0.2.2-rc.5`，由指定 GitHub tag 首次安裝，插件管理器回報 `application: applied`、`warnings: []`，安裝 package 同 tag 原始碼核對一致。用戶實際確認插件名稱、圖示及設定頁四張供應商卡正常；四組連接／模型偵測完成，預設模型及其他原有供應商設定保留。Node `v26.12.1` 執行指定自動測試，47 通過、0 失敗、0 跳過。

限制：該次測試冇按四張卡嘅獨立「測試」掣，因此卡片最終冒煙調用未驗證；context window 等部分值係程式設定或 fallback，唔應視為長上下文實測。完整逐機報告由使用者保留；此處只摘要驗證結果。

## 使用

1. 去 **設定 → 模型**，拉到最底搵 **第三方模型供應商** 區塊，有四張卡：StarAPI Claude、StarAPI Codex、RC Claude、RC Codex。
2. 每張卡貼對應分組嘅 API Key，㩒 **連接**。插件會驗證 Key、逐個測試模型（大約半分鐘至一分鐘一組），然後寫入設定。
3. 卡片變成「已連接」之後，可以用 **測試** 掣揀一個模型同思考級別實際調用一次。
4. 喺對話輸入框嘅模型選單揀對應供應商下面嘅模型，再揀「推理等級」。

如果嗰部機已經有手動加、用唔到嘅 `starapi-claude` / `starapi-codex` / `rc-claude` / `rc-codex`，對應卡片會顯示「需要修復」同具體原因，㩒 **修復** 就會改正；你自己加嘅 `displayName`、`headers` 之類嘅欄位會保留，其他供應商唔會郁。

卡片上其他掣：

- **重新偵測模型**：中轉服務加咗新模型、或者之前偵測嗰陣佢壞咗，呢個再測一次。
- **更換 Key**：換另一條 Key。
- **移除供應商**：刪除該組設定；可以揀埋刪除已儲存嘅 Key。四組互不影響。

## 要知道嘅限制

- **偵測會用少量額度。** 每個模型大約 2 至 6 個極短請求。
- **每個中轉服務嘅兩條 Key 共用一個錢包**：兩張 StarAPI 卡餘額一樣，兩張 RC 卡餘額又一樣；StarAPI 同 RC 嘅錢包係分開嘅。
- **中轉服務壞咗嘅時候都加得到，但未經實測。** 如果偵測嗰陣某組模型全部回 503，插件會用內置嘅已知設定照加，並喺卡片標明「未驗證」同原因；等服務回復之後㩒「重新偵測模型」。單一次 5xx 或者斷線會重試一次，唔會因為一次抖動就標「未驗證」。「未驗證」標記同「已略過」清單只記喺記憶體，重啟 DSH 之後唔再顯示（設定本身唔受影響）。
- **中轉服務本身嘅故障插件解決唔到。** `503 All compatible upstream candidates were exhausted` / `All available accounts exhausted` 係上游冇可用帳號，同設定無關；卡片嘅「測試」掣會原文顯示呢類錯誤。
- **「關思考」只喺真係關到嘅模型先有。** StarAPI Codex 同 RC Claude 會照收 `none` 但照樣思考，所以冇「關」；RC Codex 就逐個模型實測，只喺 `none` 真係停得到思考嘅模型提供。唔揀級別就係模型自己嘅預設（通常係 `medium`）。
- **RC 嘅 `claude-fable-5-2`**：渠道更新後可能已經冇咗（404），插件會略過佢。如果你嘅 `agent-default-model` 預設係佢，要另外轉去一個用到嘅模型——插件唔會自動改你嘅預設模型設定。
- **Key 要對應分組。** 用錯分組嘅 Key 會被拒絕，因為對方列表冇呢組嘅模型。

## 私隱

- Key 存入 DSH 本機憑證庫（`$DSH_HOME/.credentials.yaml`）嘅 `STARAPI_CLAUDE_API_KEY` / `STARAPI_CODEX_API_KEY` / `RC_CLAUDE_API_KEY` / `RC_CODEX_API_KEY`，唔會寫入 `cordis.patch.yml`，唔會回傳俾頁面，唔會寫入 log。
- 插件只會向你設定嘅中轉位址發請求：`/v1/models`、`/v1/messages`、`/v1/responses`、`/v1/usage`。StarAPI 用 `https://www.starapi.io`，RC 用 `https://api.site`。
- 插件嘅後台路徑喺 `/api/starapi/<組>/` 下面，受 DSH 嘅登入 cookie 同 Host/Origin 檢查保護；未登入回 401，跨站請求回 403。

## 進階：改中轉位址

如果你用鏡像網域，喺 profile 嘅 `cordis.patch.yml` 加：

```yaml
- id: starapi
  config:
    baseURL: https://your-starapi-mirror.example   # 覆寫 StarAPI（claude + codex）
    roots:
      rc-claude: https://your-rc-mirror.example    # 覆寫 RC Claude
      rc-codex: https://your-rc-mirror.example     # 覆寫 RC Codex
```

`roots` 可以用任何 family id（`claude` / `codex` / `rc-claude` / `rc-codex`）做 key，逐組覆寫。

## 開發

```powershell
node --test test/*.test.mjs  # Host 同品牌相容性測試，用本機假中轉伺服器（四組）
node test/fake-starapi.mjs 47811   # 單獨開假伺服器，配合上面嘅位址設定做手動測試
npm pack                   # 打包
```

冇 build 步驟，冇第三方依賴：`index.js` 係 Host 半邊，`client.js` 係瀏覽器半邊。

## License

[MIT](LICENSE)
