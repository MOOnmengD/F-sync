# 03 — 后端 API

所有 API 位于 `api/` 目录，部署为 Vercel Serverless Functions。

## API 一览

| 端点 | 方法 | 鉴权 | 用途 |
|------|------|------|------|
| `/api/parse-transaction` | POST | 无 | AI 解析记账文本 |
| `/api/parse-media` | POST | 无 | AI 解析书影文本（标题+评价） |
| `/api/chat-completion` | POST | 无（工具读取要求 `userId` + service role） | AI 对话（含 RAG + 只读 Agent） |
| `/api/vectorize` | POST | 无 | 生成 embedding |
| `/api/proactive-ai` | POST | `CRON_SECRET` | 主动消息 + 推送 |
| `/api/daily-summary` | POST | `CRON_SECRET` | 每日日记 + 画像更新 |
| `/api/save-push-token` | POST | 无 | 保存华为推送 Token |
| `/api/update-location` | POST | 无 | 更新用户位置 |
| `/api/debug-search` | GET/POST | 无 | 调试用全文搜索 |
| `/api/backfill-events` | POST | 无 | 事件回填工具 |
| `/api/text-to-speech` | POST | 无 | AI 消息语音合成（TTS） |
| `/api/investment` | POST | 无 | 投资管理（操作/更新CR/CRUD） |

---

## 共享模块

### `_utils.ts`

| 导出函数 | 用途 |
|----------|------|
| `PRIVATE_LOCATIONS` | 从环境变量读取的私有地点配置（含场景描述） |
| `matchCampusLocation(lat, lng)` | 匹配最近校内地点（Haversine 距离，100m 半径） |
| `resolveChatCompletionsUrl(base)` | 补全 `/chat/completions` 后缀 |
| `resolveEmbeddingUrl(base)` | 补全 `/embeddings` 后缀 |
| `analyzeQueryIntent(query)` | 分析查询意图（时间范围/食物/心情/工作等） |
| `haversineDistance(lat1,lng1,lat2,lng2)` | 计算两点间距离（米） |

> Vercel 以 Node ESM 运行 `api/` 产物；API 文件导入内部共享模块时，TypeScript 源码中也必须写 `.js` 后缀（例如 `./_utils.js`、`./_prompt-defaults.js`），否则部署后会出现 `ERR_MODULE_NOT_FOUND`。

### `_prompt-defaults.ts`

解析与 OCR 的默认提示词模块，不作为公开 Serverless Function。`parse-transaction`、`parse-media`、`investment(type=ocr)`、聊天识图会从这里读取默认 Prompt。

### `_context.ts`

AI 对话上下文构建模块（详见 [05-AI系统设计](./05-AI系统设计.md)），核心导出：

| 函数 | 用途 |
|------|------|
| `enrichMessages(params)` | **主入口**：构建完整的 AI 对话上下文 |
| `fetchUserProfiles(supabase, userId)` | 获取用户画像（社交关系 + 个人信息事实；Chat 主流程不再每轮固定注入） |
| `fetchTopDailyEvents(supabase)` | 获取最近 3 条每日事件摘要（仅作内部索引，不注入上下文） |
| `fetchTimingInfo(supabase)` | 获取当前计时状态 |
| `resolveLocationInfo({location, amapKey})` | 解析位置信息（校内匹配 + 高德逆地理） |
| `ragRetrieval(params)` | RAG 三策略检索（向量→全文→时间兜底），按需调用 |
| `retrievalJudgeAndFetch(params)` | 检索判断（记忆 + 生活记录）+ 历史对话检索 |
| `AgentContextItem` | Agent 工具结果的最终上下文条目；有时间戳则进入统一时间线，无时间戳则进入本轮工具摘要 |

### `_tools.ts`

只读 Agent 工具模块，作为 `chat-completion` 的内部依赖，不新增公开 Vercel Function。

| 导出 | 用途 |
|------|------|
| `getFsyncToolDefinitions()` | 返回 OpenAI-compatible tools schema |
| `getAgentSystemInstruction()` | 给支持工具调用的模型追加只读工具说明 |
| `executeFsyncTool(toolCall, context)` | 执行工具调用，返回 protocol tool message 内容、`AgentContextItem[]` 和简要 trace |

第一版开放工具：

| 工具 | 用途 |
|------|------|
| `list_fsync_domains` | 列出可读取业务数据域 |
| `describe_fsync_domain` | 描述某个数据域的字段、过滤项、排序和注意事项 |
| `query_fsync_records` | 按白名单 domain/字段查询记录，不接受 SQL 或裸表名 |
| `search_memories` | 语义搜索历史共同记忆，内部使用事件索引回捞聊天原文 |
| `search_life_logs` | 语义搜索生活记录，失败时回退关键词查询 |

开放读取的数据域包括：`life_logs`、`chat_history`、`media_library`（书影当前状态/最近点评）、`media_history`（书影多条点评/状态事件）、`items`、`social_relationships`、`user_profile_facts`、`investment_portfolio`、`investment_suggestions`、`investment_actions`。

不开放直接读取：`user_settings`、`push_tokens`、`daily_logs`、`weather_cache`、`user_locations`、`daily_event_items`、embedding/search_vector 等技术字段。

### `_weather.ts`

天气服务模块，通过高德天气 API 获取实时天气，缓存到 `weather_cache` 表。

### `_vision.ts`

聊天图片理解内部模块，不作为公开 Serverless Function。用于 `chat-completion` 的 `vision_summary` 模式。

| 导出 | 用途 |
|------|------|
| `prepareChatVisionMessages()` | 识别需要转文字的图片消息，调用视觉模型生成摘要，或复用本地传入的 `imageSummary` |

配置优先级：`settings.chatVisionConfig` → `CHAT_VISION_AI_*` → 当前第一组启用的对话 API URL/Key。视觉模型名不 fallback 到文本聊天模型，缺失时返回明确错误。

---

## 各端点详细说明

### `POST /api/parse-transaction`

**用途**：AI 解析用户自由文本记账输入，提取结构化字段。

**输入**：
```json
{ "text": "14.8 合意蛋包饭 黑胡椒蛋包炸鸡饭 好吃" }
```

**输出**：
```json
{
  "amount": 14.8,
  "item_name": "黑胡椒蛋包炸鸡饭",
  "brand": "合意蛋包饭",
  "details": null,
  "review": "好吃"
}
```

**环境变量**：`AI_API_URL`, `AI_API_KEY`, `AI_MODEL`（默认 `deepseek-chat`）

**AI Prompt 要点**：
- 严格 JSON 输出，禁止改写/拆分用户原文
- 空格作为字段分隔边界
- 5 个输出字段：`amount`(数字), `item_name`, `brand`, `details`(客观规格), `review`(主观感受)
- 温度 0.1（低随机性，确保解析一致性）

**错误处理**：非 JSON 响应会尝试正则提取 `{...}` 块；上游 AI 返回非 2xx 时，API 返回 `upstreamStatus/detail`，并在 Vercel 日志记录状态码、模型、endpoint 和截断后的上游响应（不记录 Key）

---

### `POST /api/parse-media`

**用途**：AI 解析用户自由文本书影输入，分离标题和评价。

**输入**：
```json
{ "text": "三体 震撼的硬科幻，读完久久不能平静" }
```

**输出**：
```json
{
  "title": "三体",
  "review": "震撼的硬科幻，读完久久不能平静"
}
```

**环境变量**：`AI_API_URL`, `AI_API_KEY`, `AI_MODEL`（默认 `deepseek-chat`）

**AI Prompt 要点**：
- 严格 JSON 输出，禁止改写/拆分用户原文
- 空格作为字段分隔边界
- 2 个输出字段：`title`（书名/影名）, `review`（用户评价，完全保留原文）
- 温度 0.1（低随机性，确保解析一致性）

**错误处理**：非 JSON 响应会尝试正则提取 `{...}` 块；与 `parse-transaction` 共享 AI 基础设施。上游 AI 返回非 2xx 时，API 返回 `upstreamStatus/detail`，并在 Vercel 日志记录状态码、模型、endpoint 和截断后的上游响应（不记录 Key）

---

### `POST /api/chat-completion`

**用途**：AI 对话，包含 RAG 检索、上下文构建和只读 Agent 工具调用。

**输入**：
```json
{
  "messages": [{ "role": "user", "content": "我今天花了多少钱" }],
  "settings": { /* AISettings */ },
  "userId": "uuid",
  "location": { "latitude": 45.77, "longitude": 126.67, "accuracy": 10, "address": "..." },
  "enableAgent": true,
  "debugAgent": false,
  "agentLab": false
}
```

**输出**：透传 AI API 的原始响应，附加 `fullMessages`（最终发送给 AI 的完整消息列表）。`debugAgent/agentLab` 为 true 时额外附加简要 `agentTrace`；聊天识图生成新摘要时附加 `imageUnderstanding`。

**处理流程**：
1. 构建 API 配置（前端传来 > 环境变量 fallback）
2. 若 `chatVisionConfig.mode='vision_summary'`，先调用 `_vision.ts` 将未缓存的图片转为文字摘要；已有 `imageSummary` 的消息直接复用摘要，不重复识图
3. 调用 `enrichMessages()` 构建基础上下文（含按需记忆检索、按需生活记录检索、位置、天气、计时状态）
4. `direct` 图片模式下，图片消息转为多模态格式（`image_url` + `text` parts）；`vision_summary` 模式下，主聊天模型只接收纯文本图片摘要
5. 若存在 `userId` 且配置了 `SUPABASE_SERVICE_ROLE_KEY`，先发起最多 2 轮只读 tool-calling
6. 后端执行 `_tools.ts` 白名单工具，生成内部 tool protocol 消息和 `AgentContextItem[]`
7. 一旦有工具结果，重新调用 `enrichMessages(agentContextItems)` 构建最终上下文：有时间戳的工具结果进入时间线，无时间戳的工具结果进入「本轮工具查询摘要」，均位于真实世界信息和当前用户消息之前
8. 最终模型调用不再携带 raw tool messages，避免工具结果占据倒数第一/第二条消息
9. 不支持 tools 或工具模式失败时，自动降级为普通对话
10. 位置信息异步写入 `user_locations` 表

**环境变量**：`CHAT_AI_*`（优先）> `AI_*`（fallback），`SUPABASE_SERVICE_ROLE_KEY`，`AMAP_API_KEY`（可选）

**聊天识图环境变量**：`CHAT_VISION_AI_API_URL`、`CHAT_VISION_AI_API_KEY`、`CHAT_VISION_AI_MODEL`（仅 `vision_summary` 模式需要；URL/Key 可 fallback 到当前对话配置，模型名必须显式配置）。

**`imageUnderstanding` 示例**：
```json
[
  {
    "messageId": "客户端消息ID",
    "messageCreatedAt": 1783420000000,
    "model": "glm-4.6v",
    "summary": "图片1：..."
  }
]
```
前端收到后写回本地用户消息的 `imageSummary`，用于后续对话复用。

**特色**：
- 多 AI 配置轮询容错
- 位置信息自动旁路写入 DB
- 支持用户通过设置自定义 system prompt / user prompt / post-history prompt
- 只读 Agent 不提供写入、修改、删除工具

---

### `POST /api/vectorize`

**用途**：为交易记录或每日事件生成 embedding 向量。

**输入（单条）**：
```json
{ "transaction_id": "uuid" }
```

**输入（事件）**：
```json
{ "event_id": "uuid" }
```

**输入（批量）**：
```json
{ "mode": "all", "table": "daily_event_items" }
```

**处理流程**：
1. 根据 `table` 参数选择目标表（`transactions` 或 `daily_event_items`）
2. `mode: 'all'`：查找 `embedding IS NULL` 的记录（transactions 限 5 条/批，events 限 10 条/批）
3. 格式化文本（transactions 按 `formatTransactionToText` 转语义字符串）
4. 调用 embedding API → 写入对应记录的 `embedding` 列

**环境变量**：`EMBEDDING_API_URL/KEY/MODEL` > `CHAT_AI_*` > `AI_*`

**懒处理策略**：单条在写入 transactions 后异步触发，批量通过前端手动触发。

---

### `POST /api/proactive-ai`

**用途**：定时触发 AI 决策是否主动发送消息，含华为推送。

**鉴权**：`Authorization: Bearer <CRON_SECRET>`

**触发方式**：GitHub Actions 每 15 分钟 `curl` 调用

**处理流程**：
1. 验证 CRON_SECRET
2. 读取用户最近位置（`user_locations` 表）
3. 读取最近对话（判断是否需要发送：1 小时内有对话则 skip）
4. 读取近期生活记录
5. 调用 `enrichMessages()` 构建上下文
6. 发送 proactive prompt（AI 决定内容或 SKIP）
7. AI 决定发送 → 写入 `chat_messages`（`client_id = proactive-{timestamp}`）→ 华为推送
8. **异步**：更新社交关系画像（`updateUserProfileSummary`）

**环境变量**：`CRON_SECRET`, `PROACTIVE_USER_ID`, `HUAWEI_*`（推送配置）

**静默时段**：GitHub Actions 层面 CST 01:00-10:00 静默（不触发 workflow）；API 层面无静默逻辑

---

### `POST /api/daily-summary`

**用途**：每日一次生成 AI 日记 + 更新用户画像 + 提取每日事件。

**鉴权**：`Authorization: Bearer <CRON_SECRET>`

**触发方式**：GitHub Actions 每天 UTC 17:00（CST 次日 01:00）

**处理流程（四步流水线）**：

1. **生成日记**
   - 收集过去 24h 的 `transactions` + `chat_messages`
   - AI 以 Florian 第一人称写日记（100-150 字）
   - 写入 `daily_logs` 表（upsert by `user_id, date`）
   - 日记日期为 CST 昨天

2. **社交关系增量更新**
   - AI 从当日数据中提取新人物/宠物或已有关系的新信息
   - `action: "insert"` → upsert 新记录
   - `action: "update"` → 追加入 `history` JSONB 数组

3. **每日事件提取**
   - AI 从对话记录中提取客观事件摘要
   - 写入 `daily_event_items` 表（先删旧数据再插，按日期分区）
   - 为每条事件生成 embedding

4. **个人信息提取**
   - AI 提取持久性个人信息（生日、偏好、职业等）
   - 写入 `user_profiles` 表（`profile_type = 'personal_facts'`，合并去重）

**环境变量**：`CRON_SECRET`, `PROACTIVE_USER_ID`, `CHAT_AI_*`, `AMAP_API_KEY`, `EMBEDDING_*`

---

### `POST /api/save-push-token`

**用途**：保存 HarmonyOS 设备的华为推送 Token。

**输入**：
```json
{ "token": "huawei_push_token_string" }
```

**处理**：upsert 到 `push_tokens` 表（by `user_id, platform`），platform 固定 `harmony`。

---

### `POST /api/update-location`

**用途**：更新用户位置（由 HarmonyOS workScheduler 或 Chat 页调用）。

**输入**：
```json
{
  "userId": "uuid",
  "latitude": 45.77,
  "longitude": 126.67,
  "accuracy": 10,
  "address": "哈尔滨市南岗区...",
  "source": "background"
}
```

**处理流程**：
1. 坐标范围校验（±90, ±180）
2. 高德逆地理编码 → 获取地址 + adcode
3. 地址优先级：高德 > 传入的 address
4. upsert 到 `user_locations` 表（by `user_id`）

**环境变量**：`AMAP_API_KEY`

---

### `POST /api/debug-search`

调试用端点，直接查询 Supabase。

### `POST /api/backfill-events`

事件回填工具，用于历史数据迁移。

---

### `POST /api/text-to-speech`

**用途**：将 AI 回复文本转换为语音，供前端播放。后端负责 Markdown 清理后调用 MiniMax 同步 TTS API。

**输入**：
```json
{ "text": "AI 回复的原始内容（含 Markdown 语法）" }
```

**输出（成功）**：
```json
{ "audioDataUrl": "data:audio/mp3;base64,..." }
```

**输出（失败）**：
```json
{ "error": "错误描述" }
```

**处理流程**：
1. 校验 `text` 非空
2. 清理 Markdown 语法（去除粗体/斜体/链接/代码块/标题/引用/列表等标记）
3. 截断到 10000 字符（安全边界）
4. 调用 MiniMax 同步 TTS API：`POST https://api.minimax.chat/v1/t2a_v2`
   - 模型：`speech-2.8-hd`
   - 音色：`Chinese (Mandarin)_Gentleman`
   - 语速：`0.83`
   - 输出格式：`hex`（MiniMax 返回 `data.audio` 字段为 hex 编码音频）
   - 音频参数：mp3 / 32000Hz / 128kbps / 双声道
5. 接收 JSON 响应，将 hex 音频转为 base64 Data URL 返回

**环境变量**：`MINIMAX_API_KEY`

**前端调用**：Chat 页面中 AI 消息气泡的朗读按钮，以及自动朗读开关。

---

### `POST /api/investment`

**用途**：统一的投资管理端点（合并了原有的 investment-action / investment-update-cr / investment-manage）。通过 `type` 字段区分操作。

**输入（type: 'action' — 执行投资操作）**：
```json
{
  "type": "action",
  "userId": "uuid",
  "investmentId": "uuid",
  "suggestionId": "uuid|null",
  "actualAmountCents": 10000,
  "actionType": "confirm_suggestion|override_suggestion|manual_adjust",
  "cBeforeCents": 50000,
  "cAfterCents": 60000
}
```

**输入（type: 'update_cr' — 更新持仓价值/收益率/参数）**：
```json
{
  "type": "update_cr",
  "userId": "uuid",
  "investmentId": "uuid",
  "currentValueCents": 60000,
  "currentProfitRate": 0.15,
  "targetAmountCents": 120000,
  "stopProfitLine": 0.15
}
```
> `currentValueCents`、`currentProfitRate`、`targetAmountCents`、`stopProfitLine` 均为可选，只更新提供的字段。`stopProfitLine` 传 `null` 表示清除止盈线。

**输入（type: 'batch_update' — 批量更新现有基金并创建截图新增基金）**：
```json
{
  "type": "batch_update",
  "userId": "uuid",
  "updates": [
    {
      "investmentId": "uuid",
      "currentValueCents": 60000,
      "currentProfitRate": 0.15,
      "targetAmountCents": 120000,
      "stopProfitLine": 0.15
    }
  ],
  "creates": [
    {
      "clientId": "ocr:temporary-id",
      "fundName": "某某增强债券",
      "currentValueCents": 200000,
      "currentProfitRate": 0,
      "targetAmountCents": 200000,
      "stopProfitLine": null,
      "tradingCycle": "none",
      "strategyTag": "待配置",
      "notes": "由截图识别新增；已合并份额：某某增强债券A、某某增强债券C"
    }
  ]
}
```
> `updates`、`creates` 至少一个为非空数组。每个 `updates[]` 项中除 `investmentId` 外字段均可选；服务端逐只校验归属并写入 `investment_actions` 操作流水。`creates[]` 用于截图识别产生的本地新增草稿，服务端校验名称、数值、周期及同用户名称冲突后批量写入 `investments`，并在响应的 `createdInvestments` 中返回 `clientId` 与正式数据库记录。前端保存成功后重新读取持仓，以正式 UUID 替换临时 ID。

**输入（type: 'manage' — 创建/更新/停用投资）**：
```json
{
  "type": "manage",
  "userId": "uuid",
  "action": "create|update|deactivate",
  "...": "各 action 对应不同字段"
}
```

---

### `POST /api/investment`（type=ocr）

> 已合并至 `/api/investment`，使用 `type: "ocr"` 调用。

**用途**：接受支付宝基金持仓截图（base64），调用 Doubao 视觉模型识别基金数据。

**输入**：
```json
{
  "type": "ocr",
  "imageDataUrl": "data:image/webp;base64,...",
  "url": "https://example.com/v1",
  "key": "sk-...",
  "model": "doubao-vision-pro-32k",
  "prompt": "自定义截图解析提示词"
}
```
> `url` / `key` / `model` / `prompt` 均可选。前端 Settings 的「理财截图解析」卡片会透传这些字段；留空时使用服务端默认配置。

**输出**：
```json
{
  "funds": [
    {
      "fund_name": "景顺长城宁景混合A",
      "holding_cents": 932500,
      "holding_profit_rate": 0.0075,
      "related_sector_rate": 0.0277,
      "profit_rate": 0.0352
    }
  ]
}
```

> `holding_profit_rate` 是截图第三列「持有收益率」，`related_sector_rate` 是第四列「关联板块」涨跌幅。`profit_rate` 为服务端清洗后的最终更新值：第三列 + 第四列；如果第四列缺失、为空或看不清，则等于第三列。

**配置优先级**：请求体字段 → `OCR_AI_*` 环境变量 → `CHAT_AI_*` → `AI_*`。模型默认 `doubao-vision-pro-32k`。Prompt 留空时使用 `DEFAULT_INVESTMENT_OCR_PROMPT`，默认按养基宝截图的「持有金额」列提取当前持仓、按「持有收益率」列和「关联板块」列提取收益率组成。即使前端传入自定义 Prompt，服务端也会附加收益率口径强制规则，避免继续忽略第四列。

---

## API 依赖链

```
parse-transaction ─── 独立（仅依赖 AI_API_*）

chat-completion ─── _context ─── _weather ─── 高德天气 API
                 ├── _tools ─── Supabase（只读业务域查询）
                 ├── _vision ─── 独立视觉模型（可选）
                 ├── _utils
                 └── Supabase (RAG / 位置 / Agent 查询）

proactive-ai ─── _context（与 chat-completion 共享管线）
             ├── 华为 Push Kit
             └── social_relationships 写入

daily-summary ─── _weather
              ├── daily_logs 写入
              ├── daily_event_items 写入 + embedding
              ├── user_profiles 写入
              └── social_relationships 写入

vectorize ─── 独立（仅依赖 EMBEDDING_*）

save-push-token ─── push_tokens 写入

update-location ─── user_locations 写入
                └── 高德逆地理编码

text-to-speech ─── 独立（仅依赖 MINIMAX_API_KEY）
```

---

## 相关文档

- AI 上下文构建 → [05-AI系统设计](./05-AI系统设计.md)
- 定时任务 → [06-推送与定时任务](./06-推送与定时任务.md)
- 数据库 → [04-数据库](./04-数据库.md)
- 环境变量 → [08-配置与环境变量](./08-配置与环境变量.md)
