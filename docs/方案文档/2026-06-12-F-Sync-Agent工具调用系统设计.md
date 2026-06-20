# F-Sync Agent 工具调用系统设计

> 状态：Phase 1 已实现（只读 Agent + Agent Lab），等待真实数据测试与后续优化  
> 初稿日期：2026-06-12  
> 修订日期：2026-06-20  
> 基于：[2026-06-11-Agentic-RAG-混合检索架构方案](./2026-06-11-Agentic-RAG-混合检索架构方案.md)  
> 说明：本修订稿覆盖初稿中关于写入工具、主动消息、固定工具枚举和 daily_logs 读取的设计。第一版只实现只读 Agent 能力与 Agent Lab 测试入口，不实现写入、修改、删除、MCP 摄取和 proactive-ai 整合。

---

## 一、功能名称

F-Sync Agent 只读工具调用系统：赋予 Florian 在 F-Sync 数据空间内按需发现数据域、查询数据、整合上下文的能力。

---

## 二、已确认决策

1. 第一版只做读能力；写入、修改、删除以后单独设计并确认。
2. 允许读取理财数据，但禁止读取 API Key、Push Token、Settings 等敏感配置。
3. 主动消息功能已关闭，第一版不接入 `proactive-ai`。
4. 不再为每个功能硬编码一组固定工具，改为“能力目录 + 通用只读查询工具”。
5. 前端增加一个小型 Agent Lab，用于测试工具调用效果与显示简要 tool trace。
6. 工具结果不直接作为最终模型调用的最后几条消息，而是在最终回复前重新整合进上下文，尽量按真实时间线排列。
7. 用户画像和社交关系不再每轮固定注入，改为 Florian 认为需要时按需查询。

---

## 三、背景与动机

当前 F-Sync 的 AI 对话主要依赖程序化上下文构建：`enrichMessages()` 根据当前对话、RAG 检索、真实世界信息组织上下文，Florian 本身不能主动查询 Supabase。

用户希望 Florian 具备局部 Agent 能力：

- 只在 F-Sync 内部数据空间活动；
- 能像 PC 端 Agent 浏览文件夹一样，先了解有哪些数据域，再决定查什么；
- 不需要编程、写文档、操作手机或控制外部 App；
- 暂不开放写入、修改、删除能力。

因此，第一版 Agent 的目标不是“全能自动化”，而是“安全、灵活、可观察的数据读取能力”。

---

## 四、设计目标

- [x] Florian 可以按需查询 F-Sync 中的生活记录、历史聊天、书影、物品、社交关系、用户画像、理财数据。
- [x] 查询能力不依赖写死分类枚举；新增数据域后通过能力目录扩展。
- [x] 工具结果在最终回复前重新排入上下文，不占据倒数第一/第二条消息位置。
- [x] 用户画像和社交关系改为按需查询，不每轮固定注入。
- [x] `user_settings`、`push_tokens`、API Key、Push Token 等敏感数据不开放给 Agent。
- [x] 增加 Agent Lab 测试入口，显示简要工具调用过程和最终回复。
- [x] 不支持 tool calling 的模型自动降级为普通对话。

---

## 五、涉及范围

| 层级 | 影响文件/模块 | 变更类型 |
|------|--------------|----------|
| API | `api/chat-completion.ts` | 修改：加入只读 Agent 循环与最终上下文重排 |
| API | `api/_tools.ts` | 新增：能力目录、工具 schema、只读执行器 |
| API | `api/_context.ts` | 修改：支持按需画像/社交关系，不固定注入；接收 Agent 查询结果 |
| 前端页面 | `src/pages/Debug.tsx` | 修改：增加 Agent Lab 测试面板 |
| 数据库 | — | 第一版不新增表；可后续按检索性能补索引 |
| 文档 | `02-前端页面.md`、`03-后端API.md`、`05-AI系统设计.md`、`07-状态管理与数据流.md` | 实现后同步更新 |
| 定时任务 | `api/proactive-ai.ts` | 不修改 |

> Vercel Hobby 当前 Function 名额已满，第一版不新增公开 API 文件；`_tools.ts` 为内部模块，不计入 Serverless Function 数量。

---

## 六、总体架构

### 6.1 Agent 调用流程

```text
用户消息
  |
  v
enrichMessages() 构建基础上下文
  |
  v
第一次模型调用：messages + tools
  |
  +-- 无 tool_calls
  |     -> 直接生成回复
  |
  +-- 有 tool_calls
        |
        v
      后端执行只读工具
        |
        v
      内部工具协议消息用于继续循环
        |
        v
      将工具结果转换为 AgentContextItem
        |
        v
      重新构建最终上下文（按时间线/摘要位置插入）
        |
        v
      最终模型调用生成回复
```

标准 tool calling 协议通常要求 `tool` 消息跟在 `assistant.tool_calls` 之后。为避免最终模型过度关注最后几条 tool result，F-Sync 采用两层表示：

1. **内部协议层**：遵守 tool calling 消息顺序，用于让模型完成工具调用循环。
2. **最终上下文层**：工具调用完成后，将工具结果转换为上下文条目，重新排入最终 `messages`，再生成面向用户的回复。

### 6.2 工具结果在上下文中的位置

工具结果统一转换为：

```typescript
interface AgentContextItem {
  domain: string
  sourceTool: string
  timestamp?: string
  title?: string
  content: string
  metadata?: Record<string, unknown>
}
```

最终上下文顺序：

```text
1. system prompt
2. 历史聊天原文 / 程序 RAG 记录 / 有时间戳的工具结果 / 当前会话历史
3. 无明确时间戳的工具查询摘要
4. postHistoryPrompt（如有）
5. 真实世界信息
6. 当前用户消息
```

约束：

- 有 `created_at`、`date`、`start_time` 的工具结果按真实时间进入统一时间线。
- 没有明确时间戳的聚合结果放在 `## 本轮工具查询摘要`，位置在真实世界信息之前。
- 工具结果不得成为最终模型调用的倒数第一条或倒数第二条消息。
- 工具结果默认不写入 `chat_messages`；下一轮需要时由 Florian 重新查询。

---

## 七、RAG 与 Agent 的关系

Agent 能力上线后，RAG 仍然保留，但定位调整为：

| 能力 | 作用 |
|------|------|
| 程序化 RAG / 检索预处理 | 对明确“还记得吗”“我上周花了多少”等场景做稳定召回 |
| Agent 工具调用 | 允许 Florian 主动发现数据域、换关键词、跨表补查 |

原则：

- RAG 不再每轮固定注入大量生活记录；
- 明确回忆或生活数据查询仍可由程序层先做兜底检索；
- 工具调用结果和 RAG 结果进入同一个最终上下文组织流程；
- 不支持 tools 的模型仍使用程序化 RAG 生成普通回复。

---

## 八、工具设计

### 8.1 能力目录工具

#### `list_fsync_domains`

用途：列出 Florian 可以读取的数据域。返回的是业务语义域，不直接暴露任意表名。

示例返回：

```json
[
  {
    "domain": "life_logs",
    "label": "生活记录",
    "description": "记账、碎碎念、时间轴、工作、收藏等记录"
  },
  {
    "domain": "media_library",
    "label": "书影清单",
    "description": "书籍和影片的想看、正在看、看过状态与评价"
  }
]
```

#### `describe_fsync_domain`

用途：说明某个数据域可查询的字段、过滤项、排序方式和注意事项。

输入：

```json
{
  "domain": "media_library"
}
```

### 8.2 通用查询工具

#### `query_fsync_records`

用途：在指定数据域中查询记录。后端只接受能力目录白名单内的 domain 和字段。

输入：

```typescript
interface QueryFsyncRecordsArgs {
  domain: string
  keyword?: string
  date_from?: string
  date_to?: string
  filters?: Record<string, string | number | boolean | string[]>
  sort?: 'created_at_desc' | 'created_at_asc' | 'updated_at_desc'
  limit?: number
}
```

限制：

- `limit` 默认 10，最大 50。
- 所有查询必须绑定当前 `userId`。
- 不允许模型传 SQL。
- 不允许模型传任意表名或任意字段。
- 返回字段按 domain 白名单脱敏。

### 8.3 专用检索工具

#### `search_memories`

用途：搜索历史共同记忆。内部复用 Agentic RAG 方案中的“事件索引 -> 回捞聊天原文 -> 聊天关键词回退”链路。

#### `search_life_logs`

用途：语义搜索生活记录。可作为 `query_fsync_records(domain='life_logs')` 的语义检索补充。

---

## 九、第一版数据域目录

Agent 面向模型暴露的是业务数据域，不是裸表。下面是第一版目录。

### 9.1 开放读取

| domain | 数据来源 | 说明 | 主要可读字段 |
|--------|----------|------|--------------|
| `life_logs` | `transactions` | 记账、碎碎念、时间轴、工作、收藏等生活记录 | `id`, `created_at`, `type`, `content`, `amount`, `finance_category`, `necessity`, `mood`, `review`, `details`, `repurchase_index`, `timing_type`, `start_time`, `end_time`, `duration`, `item_name_snapshot`, `brand_snapshot` |
| `chat_history` | `chat_messages` | 历史聊天原文，仅 `user` / `assistant` | `id`, `role`, `content`, `created_at` |
| `media_library` | `media_items` | 书影清单 | `id`, `title`, `media_type`, `status`, `review`, `created_at`, `updated_at` |
| `items` | `items` | 物品/品牌档案 | `id`, `item_name`, `brand`, `category`, `last_review` |
| `social_relationships` | `social_relationships` | 社交关系和印象，按需读取 | `id`, `name`, `relation`, `impression`, `history`, `updated_at` |
| `user_profile_facts` | `user_profiles` | 用户长期事实，当前结构较粗，按需读取 | `id`, `profile_type`, `content`, `updated_at` |
| `investment_portfolio` | `investments` | 当前持仓快照和策略参数 | `id`, `fund_code`, `fund_name`, `current_value_cents`, `current_profit_rate`, `target_amount_cents`, `stop_profit_line`, `trading_cycle`, `strategy_tag`, `is_active`, `notes`, `updated_at` |
| `investment_suggestions` | `investment_suggestions` | 历史调仓建议 | `id`, `investment_id`, `suggestion_type`, `suggestion_amount_cents`, `suggestion_reason`, `triggered_rules`, `action_status`, `actual_amount_cents`, `action_time`, `created_at` |
| `investment_actions` | `investment_actions` | 投资操作流水 | `id`, `investment_id`, `suggestion_id`, `action_type`, `amount_cents`, `c_before_cents`, `c_after_cents`, `notes`, `created_at` |

### 9.2 不开放直接读取

| 数据来源 | 原因 |
|----------|------|
| `user_settings` | 可能包含 API Key、模型配置、Prompt 等敏感信息 |
| `push_tokens` | 推送 Token 敏感 |
| `daily_logs` | AI 写给用户的日记，不作为 Florian 自查资料；如未来用户明确要求“回看日记”，再单独设计 |
| `weather_cache` | 天气已通过真实世界信息注入，不需要 Agent 直接查缓存 |
| `user_locations` | 位置已通过真实世界信息注入，不需要 Agent 直接查位置表 |
| `daily_event_items` | 作为记忆检索内部索引，不直接暴露给模型 |
| `embedding` / `search_vector` / 内部向量字段 | 技术字段，不对模型展示 |

### 9.3 关于数据域说明

每个 domain 必须给模型提供业务说明，避免表名误导。例如：

- `transactions` 不叫“交易表”，而叫 `life_logs`，因为它包含记账、碎碎念、时间轴、工作、收藏等。
- `daily_event_items` 不叫“每日事件资料库”，而作为 `search_memories` 内部索引，不直接查询。
- `user_profiles.content` 当前是 JSONB 聚合事实，精确度有限；工具说明必须提示“这是 AI 历史提取的长期事实，可能需要结合原始聊天或生活记录确认”。

---

## 十、用户画像与社交关系

Agent 上线后，用户画像和社交关系不再每轮固定注入上下文，改为按需查询。

理由：

- 固定注入会增加上下文噪音；
- 画像可能有过时或错误信息；
- 社交关系只有在用户提到具体人、关系、过去互动时才有必要读取；
- Florian 可以先通过 `list_fsync_domains` / `describe_fsync_domain` 知道有这类资料，再决定是否查。

实现要求：

- `user_profile_facts` 和 `social_relationships` 默认不进入每轮上下文。
- 当模型查询这两个 domain 时，结果必须标明“AI 提取资料，可能不完整或过时”。
- 建议在实现前由用户手动粗查一遍，删除明显错误或过时内容；不要求一次性修到完美。

---

## 十一、安全策略

| 风险 | 策略 |
|------|------|
| service role 绕过 RLS | 工具执行器必须强制使用当前 `userId` 过滤 |
| 模型查询任意表 | 只接受 domain 白名单，不接受裸表名 |
| 模型查询敏感字段 | 每个 domain 固定返回字段白名单 |
| 结果过大 | 默认 10 条，最大 50 条，字段摘要化 |
| 理财数据敏感 | 允许读，但只读持仓、建议、流水等业务字段，不读配置密钥 |
| 用户画像错误 | 标注来源和不确定性，支持后续人工修正 |
| 删除/修改风险 | 第一版完全不提供写工具 |

---

## 十二、Agent Lab 测试入口

### 12.1 目的

在正式接入日常 Chat 体验前，先通过一个小型测试页面观察：

- 模型是否能正确选择工具；
- 能否根据能力目录找到正确数据域；
- 工具结果是否按预期进入最终上下文；
- 最终回复是否自然、不过度依赖最后一次工具结果。

### 12.2 前端设计

在 `src/pages/Debug.tsx` 增加 Agent Lab 面板，不新增公开 API 端点。

显示内容：

- 输入框：测试用户问题；
- 运行按钮；
- 简要工具调用列表，例如 `list_fsync_domains -> query_fsync_records(media_library, 5条)`；
- 最终回复；
- 可选折叠区：后端返回的 `agentTrace` 简要 JSON。

不显示：

- API Key；
- Push Token；
- 完整 Supabase 原始响应；
- 过长隐私数据。

### 12.3 API 返回调试信息

`/api/chat-completion` 在 Agent Lab 模式下可额外返回：

```typescript
interface AgentTraceItem {
  tool: string
  domain?: string
  status: 'ok' | 'error' | 'skipped'
  count?: number
  message?: string
}
```

普通 Chat 模式可以不展示 trace；后续可考虑只显示“正在查询生活记录”等轻提示。

---

## 十三、与现有功能的交互

| 现有功能 | 影响 |
|----------|------|
| `chat-completion.ts` | 加入只读 tools、Agent 循环、最终上下文重排 |
| `enrichMessages()` | 保留基础上下文构建；增加 Agent 结果插入点 |
| `retrievalJudgeAndFetch()` | 继续作为程序化 RAG 兜底；后续可与 `search_memories` 复用 |
| `parse-transaction` | 不替代，仍作为主页记账快速解析入口 |
| `parse-media` | 不替代，仍作为主页书影快速解析入口 |
| `proactive-ai` | 不修改 |
| `daily-summary` | 不修改 |
| Chat 页 | 第一版可不改；日常 Chat 是否显示 tool trace 后续再定 |
| Debug 页 | 新增 Agent Lab 面板 |

---

## 十四、边缘情况与降级策略

| 情况 | 处理方式 |
|------|----------|
| 模型不支持 tools | 不注入 tools，走普通对话 + 程序化 RAG |
| 工具执行失败 | 返回简短错误给模型，并在 trace 中记录 |
| 超过最大工具轮数 | 停止工具调用，基于已有结果生成最终回复 |
| 工具结果无时间戳 | 放入“本轮工具查询摘要”，位于真实世界信息之前 |
| 工具结果过多 | 截断并说明“仅展示前 N 条” |
| 模型请求不开放 domain | 返回 domain 不可用，并提示可用 domain |
| 缺少 `userId` | 禁用 Agent 工具 |
| 缺少 service role | 禁用 Agent 工具，不使用 anon key 兜底读取 |

---

## 十五、实现步骤

### Phase 1：只读 Agent + Agent Lab

1. [x] 新建 `api/_tools.ts`：实现 domain catalog、工具 schema、只读查询执行器。
2. [x] 修改 `api/chat-completion.ts`：加入最多 2 轮的只读 Agent 循环。
3. [x] 修改 `api/_context.ts`：支持接收 `AgentContextItem[]` 并按时间线/摘要位置插入最终上下文。
4. [x] 移除或避免每轮固定注入用户画像与社交关系。
5. [x] 修改 `src/pages/Debug.tsx`：新增 Agent Lab 测试面板，显示简要 trace。
6. [x] 执行 `npm run build` 验证。
7. [x] 更新 `02-前端页面.md`、`03-后端API.md`、`05-AI系统设计.md`、`07-状态管理与数据流.md`。

### Phase 2：根据测试结果优化

1. 调整 domain 描述和字段白名单。
2. 优化工具结果摘要格式。
3. 判断是否需要为聊天/书影/理财增加索引。
4. 决定是否在正式 Chat 页显示轻量工具调用状态。

### 暂不实施

- 写入、修改、删除工具；
- MCP 数据摄取；
- 主动消息 Agent 化；
- 读取 `daily_logs`；
- 读取 `user_settings`、`push_tokens` 等敏感表。

---

## 十六、验收标准

- [x] Agent Lab 中，Florian 可以列出可用数据域并选择合适 domain 查询。
- [ ] 查询书影、生活记录、历史聊天、理财数据时能得到正确结果。（需在 `/debug` 使用真实登录态逐项测试）
- [x] 工具结果不会出现在最终模型调用的倒数第一或倒数第二条消息。
- [x] 用户画像和社交关系不再每轮固定注入，只在工具调用时读取。
- [x] `user_settings`、`push_tokens`、`daily_logs` 不会被工具读取。
- [x] 缺少 `userId` 或 service role 时，Agent 工具安全降级。
- [x] 不支持 tools 的模型仍能普通对话。
- [x] `npm run build` 通过。
- [x] 实现完成后同步更新相关说明文档。

---

## 十七、相关文档

- [Agentic RAG 混合检索架构方案](./2026-06-11-Agentic-RAG-混合检索架构方案.md)
- [03-后端API](../03-后端API.md)
- [04-数据库](../04-数据库.md)
- [05-AI系统设计](../05-AI系统设计.md)
- [07-状态管理与数据流](../07-状态管理与数据流.md)

---

> 下一步：在 `/debug` 的 Agent Lab 使用真实登录态和真实数据测试书影、生活记录、历史聊天和理财查询，根据 trace 调整 domain 描述与字段摘要格式。
