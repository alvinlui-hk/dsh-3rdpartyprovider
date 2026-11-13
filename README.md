# StarAPI for DeepSeek Harness

喺 DeepSeek Harness（DSH）加入 StarAPI 嘅兩組模型：**Claude** 同 **Codex（GPT）**。裝好之後喺 **設定 → 模型** 每個分組貼一次 API Key，插件會自動偵測你個帳號用得嘅模型，並寫好可以正常使用（包括思考模式）嘅供應商 `starapi-claude` 同 `starapi-codex`。

非官方插件，同 StarAPI、OpenAI、Anthropic、DeepSeek 冇關係。

## 點解需要呢個插件

StarAPI 兩組模型各有陷阱，手動加供應商好容易中伏：

**Claude 組**：模型列表睇落係 OpenAI 格式，但只接受 **Anthropic Messages + adaptive thinking**。揀 OpenAI Responses，或者揀 Anthropic Messages 但冇開 adaptive 開關，結果都係：攞到模型列表，但一揀思考級別就 HTTP 400：

```
claude-fable-5-2 requires adaptive thinking; omit thinking or use thinking.type=adaptive and output_config.effort
```

**Codex 組**：用 OpenAI Responses，但有四個伏位：

- `reasoning.effort: "none"` StarAPI 照收，但當 `medium` 跑 —— 即係「關思考」係假嘅；
- `xhigh` 同 `max` 其實用得，但手動設定好容易漏；
- 列表入面嘅 `gpt-image-*` 係圖像模型，唔識對話，加落去只會喺選用嗰陣先失敗；
- 手動聲明嘅 route 冇寫 `contextWindow`，DSH 會當 1,000,000 token，但實際上限細得多，長對話會撞牆。

插件會逐個模型實測之後先寫設定：

| 設定 | Claude 組 | Codex 組 | 原因 |
|---|---|---|---|
| `api` | `anthropic-messages` | `openai-responses` | 各組唯一啱協議 |
| `baseURL` | 根位址 | 根位址 + `/v1` | Anthropic SDK 自己加 `/v1`；OpenAI SDK 唔加 |
| `compat.forceAdaptiveThinking` | `true` | — | 冇佢就會送舊式 `budget_tokens`，StarAPI 回 400 |
| `compat.allowEmptySignature` | `true` | — | StarAPI 回嘅 thinking 冇 signature |
| 思考級別 | 實測（新模型冇 `off`） | 實測（冇 `off`、冇 `minimal`） | 見上 |
| 最大輸出 | 實測（128K 向下試） | 128K（實測接受） | |
| 上下文 | 用 DSH 預設 1M | 272K（pi-ai 目錄值） | Codex 冇寫會當 1M |
| 模型清單 | 略過調用唔到嘅 | 略過調用唔到嘅 + 圖像模型 | |

## 安裝

需要 DeepSeek Harness `0.2.2-rc.1` 或以上，同有 Web 介面嘅 profile（Desktop 或 `dsh web`）。將 `alvinlui-hk-dsh-starapi-1.1.0.tgz` 抄去嗰部電腦，然後揀一個方法。

### 方法一：喺 DSH 介面安裝（唔使開 terminal）

1. 開 DSH，去左邊 **插件** 頁面，㩒右上角 **添加插件**。
2. 喺「包名或地址」貼入 `.tgz` 嘅**絕對路徑**，例如 `C:\Users\you\Downloads\alvinlui-hk-dsh-starapi-1.1.0.tgz`。
3. 㩒 **安装**，再㩒 **立即启用**。

裝完唔好移動或者刪除個 `.tgz`：profile 記住嘅係呢個路徑，之後重裝依賴會再讀佢。

### 方法二：叫 DSH 入面嘅 Agent 安裝

```text
將 C:\Users\you\Downloads\alvinlui-hk-dsh-starapi-1.1.0.tgz 作為 bundle 安裝到當前 profile 並啟用。
```

### 方法三：命令行

Desktop 版要先完全退出 DSH：

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "C:\Users\you\Downloads\alvinlui-hk-dsh-starapi-1.1.0.tgz"
```

`dsh web` 用 `--profile web`。

## 使用

1. 去 **設定 → 模型**，拉到最底搵 **StarAPI** 區塊，有兩張卡：Claude 同 Codex。
2. 每張卡貼對應分組嘅 API Key，㩒 **連接**。插件會驗證 Key、逐個測試模型（大約半分鐘至一分鐘一組），然後寫入設定。
3. 卡片變成「已連接」之後，可以用 **測試** 掣揀一個模型同思考級別實際調用一次。
4. 喺對話輸入框嘅模型選單揀 **StarAPI Claude** 或 **StarAPI Codex** 下面嘅模型，再揀「推理等級」。

如果嗰部機已經有手動加、用唔到嘅 `starapi-claude` 或 `starapi-codex`，對應卡片會顯示「需要修復」同具體原因，㩒 **修復** 就會改正；你自己加嘅 `headers` 之類嘅欄位會保留，其他供應商唔會郁。

卡片上其他掣：

- **重新偵測模型**：StarAPI 加咗新模型、或者之前偵測嗰陣 StarAPI 壞咗，呢個再測一次。
- **更換 Key**：換另一條 Key。
- **移除供應商**：刪除該組設定；可以揀埋刪除已儲存嘅 Key。兩組互不影響。

## 要知道嘅限制

- **偵測會用少量額度。** Claude 每個模型大約 2 至 4 個極短請求；Codex 每個大約 4 至 6 個。
- **兩條 Key 共用一個錢包。** 卡片顯示嘅餘額係整個 StarAPI 帳戶嘅，兩張卡數字一樣。
- **StarAPI 壞咗嘅時候都加得到，但未經實測。** 如果偵測嗰陣某組模型全部回 503，插件會用內置嘅已知設定照加，並喺卡片標明「未驗證」；等 StarAPI 回復之後㩒「重新偵測模型」。「未驗證」標記同「已略過」清單只記喺記憶體，重啟 DSH 之後唔再顯示（設定本身唔受影響）。
- **StarAPI 本身嘅故障插件解決唔到。** `503 All compatible upstream candidates were exhausted` 係 StarAPI 上游冇可用帳號，同設定無關；卡片嘅「測試」掣會原文顯示呢類錯誤。
- **Codex 組冇「關思考」。** StarAPI 會照收 `none` 但當 `medium` 跑，所以插件唔提供呢個級別；唔揀級別就係模型自己嘅預設（`medium`）。
- **Codex 嘅 `gpt-6.1-terra` 同圖像模型**：terra 喺測試時上游壞咗，會用預設設定加入並標明「未驗證」；圖像模型一律略過。
- **Key 要對應分組。** 用 Claude 組嘅 Key 連接 Codex 卡（或者相反）會被拒絕，因為對方列表冇呢組嘅模型。

## 私隱

- Key 存入 DSH 本機憑證庫（`$DSH_HOME/.credentials.yaml`）嘅 `STARAPI_CLAUDE_API_KEY` / `STARAPI_CODEX_API_KEY`，唔會寫入 `cordis.patch.yml`，唔會回傳俾頁面，唔會寫入 log。
- 插件只會向你設定嘅 StarAPI 位址發請求：`/v1/models`、`/v1/messages`、`/v1/responses`、`/v1/usage`。
- 插件嘅後台路徑喺 `/api/starapi/<組>/` 下面，受 DSH 嘅登入 cookie 同 Host/Origin 檢查保護；未登入回 401，跨站請求回 403。

## 進階：改 StarAPI 位址

如果你用鏡像網域，喺 profile 嘅 `cordis.patch.yml` 加：

```yaml
- id: starapi
  config:
    baseURL: https://your-mirror.example
```

## 開發

```powershell
node --test test/          # Host 半邊嘅單元測試，用本機假 StarAPI（兩組）
node test/fake-starapi.mjs 47811   # 單獨開假 StarAPI，配合上面嘅 baseURL 設定做手動測試
npm pack                   # 打包
```

冇 build 步驟，冇第三方依賴：`index.js` 係 Host 半邊，`client.js` 係瀏覽器半邊。

## License

[MIT](LICENSE)
