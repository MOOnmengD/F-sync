# 03 — 后端 API

所有 API 位于 `api/` 目录，部署为 Vercel Serverless Functions。

## API 一览

| 端点 | 方法 | 鉴权 | 用途 |
|------|------|------|------|
| `/api/parse-transaction` | POST | 无 | AI 解析记账文本 |
| `/api/chat-completion` | POST | 无（由 Supabase RLS 保护） | AI 对话（含 RAG） |
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
| `CAMPUS_LOCATIONS` | 校内地标坐标表（含场景描述） |
| `matchCampusLocation(lat, lng)` | 匹配最近校内地点（Haversine 距离，100m 半径） |
| `resolveChatCompletionsUrl(base)` | 补全 `/chat/completions` 后缀 |
| `resolveEmbeddingUrl(base)` | 补全 `/embeddings` 后缀 |
| `analyzeQueryIntent(query)` | 分析查询意图（时间范围/食物/心情/工作等） |
| `haversineDistance(lat1,lng1,lat2,lng2)` | 计算两点间距离（米） |

### `_context.ts`

AI 对话上下文构建模块（详见 [05-AI系统设计](./05-AI系统设计.md)），核心导出：

| 函数 | 用途 |
|------|------|
| `enrichMessages(params)` | **主入口**：构建完整的 AI 对话上下文 |
| `fetchUserProfiles(supabase, userId)` | 获取用户画像（社交关系 + 个人信息事实） |
| `fetchTopDailyEvents(supabase)` | 获取最近 3 条每日事件摘要 |
| `fetchTimingInfo(supabase)` | 获取当前计时状态 |
| `resolveLocationInfo({location, amapKey})` | 解析位置信息（校内匹配 + 高德逆地理） |
| `ragRetrieval(params)` | RAG 三策略检索（向量→全文→时间兜底） |
| `retrievalJudgeAndFetch(params)` | 检索判断 + 历史对话检索 |

### `_weather.ts`

天气服务模块，通过高德天气 API 获取实时天气，缓存到 `weather_cache` 表。

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

**错误处理**：非 JSON 响应会尝试正则提取 `{...}` 块

---

### `POST /api/chat-completion`

**用途**：AI 对话，包含完整的 RAG 检索和上下文构建。

**输入**：
```json
{
  "messages": [{ "role": "user", "content": "我今天花了多少钱" }],
  "settings": { /* AISettings */ },
  "userId": "uuid",
  "location": { "latitude": 45.77, "longitude": 126.67, "accuracy": 10, "address": "..." }
}
```

**输出**：透传 AI API 的原始响应，附加 `fullMessages`（发送给 AI 的完整消息列表）

**处理流程**：
1. 构建 API 配置（前端传来 > 环境变量 fallback）
2. 调用 `enrichMessages()` 构建上下文（含 RAG 检索、用户画像、位置、天气、事件）
3. 图片消息转为多模态格式（`image_url` + `text` parts）
4. 多组 API 轮询（失败自动切换下一组）
5. 位置信息异步写入 `user_locations` 表

**环境变量**：`CHAT_AI_*`（优先）> `AI_*`（fallback），`SUPABASE_SERVICE_ROLE_KEY`，`AMAP_API_KEY`（可选）

**特色**：
- 多 AI 配置轮询容错
- 位置信息自动旁路写入 DB
- 支持用户通过设置自定义 system prompt / user prompt / post-history prompt

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
4. 调用 MiniMax 同步 TTS API：`POST https://api.minimax.chat/v1/text_to_speech`
   - 模型：`speech-2.8-hd`
   - 音色：`Chinese (Mandarin)_Gentleman`
   - 语速：`0.83`
   - 格式：mp3 / 32000Hz / 128kbps / 双声道
5. 接收二进制音频，转为 base64 Data URL 返回

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

**输入（type: 'update_cr' — 更新持仓价值与收益率）**：
```json
{
  "type": "update_cr",
  "userId": "uuid",
  "investmentId": "uuid",
  "currentValueCents": 60000,
  "currentProfitRate": 0.15
}
```

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

## API 依赖链

```
parse-transaction ─── 独立（仅依赖 AI_API_*）

chat-completion ─── _context ─── _weather ─── 高德天气 API
                 ├── _utils
                 └── Supabase (RAG / 画像 / 位置）

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
