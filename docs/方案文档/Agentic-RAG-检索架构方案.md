# Agentic RAG 检索架构方案

> 状态：方案设计阶段 | 日期：2026-06-11

---

## 一、背景与问题分析

### 1.1 触发场景

用户在 5 月底观察到一只鸟，聊天记录存储在 `chat_messages` 表中（内容如「在回宿舍路上观察到一只神秘小鸟」）。`daily_event_items` 中也可能存有该事件的摘要。

6 月中旬，用户说「半个月前那只鸟是极北柳莺」，期望 AI 能回忆起 5 月底关于那只鸟的对话。

### 1.2 当前系统为什么检索不到

```
┌─────────────────────────────────────────────────────┐
│  retrievalJudgeAndFetch（历史对话检索）              │
│                                                     │
│  用户消息 ──→ AI判断needs_retrieval?                │
│                 │                                   │
│                 ├─ true → 生成keywords → embedding  │
│                 │            ↓                      │
│                 │   pgvector匹配daily_event_items   │
│                 │            ↓                      │
│                 │   ❌ "极北柳莺"与"神秘小鸟"       │
│                 │      语义距离 > 0.3，匹配失败     │
│                 │                                   │
│                 └─ false → 直接返回 []              │
│                                                     │
│  ragRetrieval（生活记录检索）                        │
│    搜索 transactions 表 → ❌ 鸟的对话不在这个表里    │
│                                                     │
│  直接搜索 chat_messages？                            │
│    ❌ 系统没有这个能力                                │
└─────────────────────────────────────────────────────┘
```

**根因总结**：

| 问题 | 详情 |
|------|------|
| **间接检索链** | 要经过 daily_event_items 中转才能触达 chat_messages，一级断裂全链断裂 |
| **纯向量检索的盲区** | 「极北柳莺」和「神秘小鸟」语义距离远，向量匹配天然困难 |
| **无关键词搜索能力** | chat_messages 表没有 ILIKE / FTS 搜索入口 |
| **无日期范围查询** | 无法按「5 月 25-30 日」直接拉取聊天记录 |
| **AI 无权决定检索策略** | 固定流水线，AI 只能被动接收上下文，不能主动选择检索方式 |

### 1.3 更根本的问题：被动上下文 vs 主动检索

```
当前架构（被动上下文注入）：
  user msg → [固定流水线: 判断 → embedding → 匹配 → 合并] → 注入prompt → AI回复
                ↑
           AI只能接收结果，不能干预过程

Agent架构（主动工具调用）：
  user msg → AI思考 → 调用 tool_A("鸟") → 结果不够？
                    → 调用 tool_B("5月25-30日", "鸟") → 找到了
                    → 整合信息 → 回复
                ↑
          AI决定检索策略和迭代次数
```

这不是模型能力的差异——DeepSeek 同样支持 function calling。这是**架构范式的差异**。

---

## 二、设计目标

1. **让 AI 能直接搜索 chat_messages 原文**（关键词 + 日期范围）
2. **保持高信噪比**——不能因为搜索范围的扩大而引入噪音
3. **保留现有检索的优势**——daily_event_items 的结构化摘要仍然是高质量信号
4. **不增加 AI 的认知负担**——工具设计应引导正确的检索策略
5. **渐进式改造**——可以逐步迁移，不必一次性重写

---

## 三、架构设计

### 3.1 整体架构：Tool-calling 循环替代固定流水线

```
                          ┌─────────────────────────┐
                          │     Agentic RAG Loop     │
                          │                         │
  user msg ──→ enrichMessages() ──→ AI.chat()       │
                          │           │              │
                          │           ├─ finish? ──→ 返回响应
                          │           │              │
                          │           └─ tool_call?  │
                          │                │         │
                          │    ┌───────────┘         │
                          │    ▼                     │
                          │  executeTool()           │
                          │    │                     │
                          │    └─→ 追加到messages ──→ AI.chat()  ──→ ...
                          └─────────────────────────┘
```

核心改动：`enrichMessages` 不再预取全部上下文，而是将检索能力暴露为 tools，让 AI 在对话循环中按需调用。

### 3.2 保持不变的部分

以下现有能力**完全保留**，不纳入 tool-calling 循环（始终注入，避免 AI 额外调用）：

| 保留项 | 理由 |
|--------|------|
| `fetchTopDailyEvents`（最近 3 条事件摘要） | 轻量索引，帮助 AI 了解"最近发生了什么" |
| 用户画像（social_relationships + personal_facts） | 固定上下文，不需要检索 |
| 真实世界信息（时间、天气、位置） | 每次对话都需要 |
| System prompt + userPrompt | 角色定义 |

### 3.3 Tool 定义

#### Tool A：`search_memories`（记忆搜索——双层检索）

这是本次设计的**核心工具**，直接解决了噪音顾虑。

```
Tool: search_memories
描述：搜索用户的过往记忆。适用于用户提到过去发生的事情、
      或说"之前跟你说过""还记得吗""上次那个"等场景。

参数：
  - keywords: string（必填）— 搜索关键词，如"鸟"、"极北柳莺"、"火锅"
  - time_hint: string（可选）— 时间提示，如"半个月前"、"上周末"、"5月底"
  - max_results: number（可选，默认10）— 返回的最大条目数

内部执行逻辑（双层设计）：
  ┌──────────────────────────────────────────┐
  │ Layer 1: 匹配 daily_event_items          │
  │   ├─ 向量匹配（keywords embedding）       │
  │   ├─ 关键词匹配（ILIKE '%keywords%'）     │
  │   ├─ 日期过滤（解析 time_hint）           │
  │   └─ 返回 top-5，标记 confidence: high   │
  │                                          │
  │ 结果充分？(count >= 3 或 max_similarity > 0.5) │
  │   │                                      │
  │   ├─ YES → 直接返回 Layer 1 结果          │
  │   │                                      │
  │   └─ NO  → Layer 2: 搜索 chat_messages   │
  │         ├─ ILIKE '%keywords%'            │
  │         ├─ 日期过滤（解析 time_hint）     │
  │         ├─ 返回 top-10                   │
  │         └─ 标记 confidence: medium       │
  └──────────────────────────────────────────┘

返回格式：
  [
    {
      "source": "daily_event" | "chat_message",
      "date": "2026-05-28",
      "time": "18:30",
      "content": "在回宿舍路上观察到一只神秘小鸟",
      "confidence": "high" | "medium",
      "context": "前后2条消息的对话片段"  // 仅 chat_message 源
    }
  ]
```

**为什么是双层而不是直接搜 chat_messages？**

| Layer | 信噪比 | 覆盖范围 | 失效场景 |
|-------|:---:|:---:|------|
| daily_event_items | 🔥 高（AI 提炼过的摘要） | 窄（只覆盖被总结的事件） | 细节未被提炼；摘要用词与查询差异大 |
| chat_messages | ⚠️ 中（原始对话，可能有噪音） | 广（覆盖所有对话） | 关键词太泛导致结果过多 |

双层设计在**大多数场景**下走 Layer 1 就命中（快速、高质量），仅在 Layer 1 失效时才触发 Layer 2（确保不遗漏）。这兼顾了**精度**和**召回**。

**如果用户没有提供具体时间提示**（`time_hint` 为空或模糊），通过以下方式推断：
- "这两天" → 48h
- "前几天" / "最近" → 7d
- "半个月前" → 15d ± 3d
- "上个月" → 30d ± 7d
- "前段时间" / 无时间提示 → 30d 内优先，超出则全表

#### Tool B：`search_life_logs`（生活记录检索）

保留并增强现有的 RAG 能力。

```
Tool: search_life_logs
描述：搜索用户的生活记录数据（记账、心情、工作计时、收藏等）。
      适用于用户询问"我花了多少钱""最近吃了什么""今天工作了多久"等。

参数：
  - query: string（必填）— 搜索内容
  - log_type: string（可选）— 过滤类型：记账 | whisper | timing | 收藏
  - time_range: string（可选）— 时间范围：today | week | month | 自定义日期范围

内部逻辑（保留现有的三策略 + 增强）：
  1. 向量检索 match_life_logs()
  2. 全文检索 ILIKE
  3. 日期范围过滤（新增，利用 analyzeQueryIntent 的结果 + time_range 参数）
  4. 合并去重，返回 top-10
```

#### Tool C：`get_conversation_context`（对话上下文获取——可选，后续迭代）

```
Tool: get_conversation_context
描述：获取指定记忆条目前后的一段对话上下文。
      当 search_memories 返回一条 chat_message 结果，
      但 AI 觉得需要更多上下文才能理解时使用。

参数：
  - message_id: string（必填）— 消息的 client_id
  - context_lines: number（可选，默认4）— 前后各取几条

返回：该消息前后各 N 条对话的完整内容
```

> 此工具为可选增强，初期可以不实现。如果 AI 仅凭搜索结果就能做出合理回应，则不需要此工具。

### 3.4 检索流程示例：极北柳莺场景

```
User：「半个月前看到的那只鸟，原来是极北柳莺」

AI 思考：用户提到了"半个月前"和"鸟"，我需要查一下记忆。
  ↓
AI 调用 search_memories({ keywords: "鸟", time_hint: "半个月前" })
  ↓
search_memories 内部执行：
  Layer 1: embedding("鸟") → daily_event_items 向量匹配
    → 命中: "在回宿舍路上观察到一只神秘小鸟" (similarity: 0.42, date: 2026-05-28)
    → count=1, max_similarity=0.42 → 不满足充分条件 (count<3 且 similarity<0.5)
    → 触发 Layer 2
  Layer 2: ILIKE '%鸟%' on chat_messages, date range: 2026-05-18 ~ 2026-06-04
    → 命中: user "我在回宿舍路上看到一只鸟诶，小小的，不知道是什么品种" (2026-05-28 18:23)
    → 命中: assistant "哇，什么样的鸟？..." (2026-05-28 18:24)
    → 返回 2 条，confidence: medium
  ↓
返回结果给 AI：
  [
    { source: "daily_event", content: "在回宿舍路上观察到一只神秘小鸟", date: "2026-05-28" },
    { source: "chat_message", content: "用户: 我在回宿舍路上看到一只鸟诶...", date: "2026-05-28 18:23" },
    { source: "chat_message", content: "AI: 哇，什么样的鸟？...", date: "2026-05-28 18:24" }
  ]
  ↓
AI：找到了！5月28日用户说看到一只鸟。现在他说是极北柳莺。
  → 回复：「原来是极北柳莺！5月底你在回宿舍路上看到的那只小鸟，我记得你说它小小的...」
```

---

## 四、数据库变更

### 4.1 chat_messages 表索引（必须）

```sql
-- 全文搜索索引（中文分词需要 zhparser 扩展；如不安装则退化为 pg_trgm）
-- 方案 A（推荐，无需额外扩展）：
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_chat_messages_content_trgm 
  ON chat_messages USING gin (content gin_trgm_ops);

-- 方案 B（需要 zhparser，中文分词效果更好）：
-- CREATE INDEX idx_chat_messages_content_fts 
--   ON chat_messages USING gin (to_tsvector('zhparser', content));

-- 复合索引：加速按用户 + 日期范围的查询
CREATE INDEX idx_chat_messages_user_date 
  ON chat_messages (user_id, created_at DESC);

-- ILIKE 加速（pg_trgm 已覆盖）
```

**关于 pg_trgm vs zhparser 的说明**：
- `pg_trgm`：三元组模糊匹配，支持 ILIKE 加速和相似度搜索。安装简单（PostgreSQL 自带），中文关键词检索效果可接受。**推荐初期使用**。
- `zhparser`：中文分词，需要额外编译安装。分词更准确但部署成本高。可在后续迭代中升级。

### 4.2 daily_event_items 表增强（建议）

```sql
-- 为 daily_event_items.content 也加 pg_trgm 索引，支持 Layer 1 的关键词匹配
CREATE INDEX idx_daily_event_items_content_trgm 
  ON daily_event_items USING gin (content gin_trgm_ops);
```

---

## 五、API 层改动

### 5.1 `api/_context.ts` 改动概要

```
enrichMessages() 改造：

Before（当前）：
  1. 固定取 daily_event_items top-3
  2. 固定执行 retrievalJudgeAndFetch
  3. 固定执行 ragRetrieval
  4. 全部注入 prompt
  5. 发送给 AI（不带 tools）

After（改造后）：
  1. 固定取 daily_event_items top-3（保留，作为背景）
  2. 固定取用户画像、真实世界信息（保留）
  3. 构建 messages
  4. 发送给 AI（带 tools: [search_memories, search_life_logs]）
  5. AI 可能调用 tool → 执行 → 追加 tool result 到 messages → 再次发送
  6. AI 回复 → 返回
```

### 5.2 新增文件 `api/_tools.ts`

```typescript
// 工具定义和执行逻辑

// ---- Tool 定义（OpenAI function calling 格式） ----

export const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_memories',
      description: `搜索用户的过往记忆和对话历史。当用户提到过去发生的事情、说"之前跟你说过""还记得吗""上次那个""XX天前"等涉及历史的情境时，应主动调用此工具。
      
使用建议：
- keywords 尽量使用用户原文中的关键词，不要过度泛化
- 如果用户提到了具体时间（如"半个月前""上周""5月底"），务必传入 time_hint
- 如果第一次搜索返回结果不足，可以换关键词再试一次`,
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'string',
            description: '搜索关键词，使用用户原文中的词语，如"鸟"、"极北柳莺"、"火锅"、"张三"。多个关键词用空格分隔。',
          },
          time_hint: {
            type: 'string',
            description: '用户提到的时间提示，原样传入，如"半个月前"、"上周末"、"5月底"、"前几天"。如果用户没有提到时间则留空。',
          },
        },
        required: ['keywords'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_life_logs',
      description: `搜索用户的生活记录数据，包括：记账（餐饮/购物/交通等消费记录）、心情（碎碎念/情绪记录）、工作计时、收藏等。
当用户询问"我花了多少钱""最近吃了什么""今天工作了多久""记一下我的心情"等涉及生活数据的问题时使用。

注意：此工具搜索的是生活记录，不是聊天对话。如果用户是在回忆过去聊过的话题，请使用 search_memories。`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索内容描述，如"最近吃了什么"、"上周花了多少钱"',
          },
          log_type: {
            type: 'string',
            enum: ['记账', 'whisper', 'timing', '收藏'],
            description: '按类型过滤。如果不确定则留空。',
          },
          time_range: {
            type: 'string',
            description: '时间范围，如 today、week、month、2026-05-25..2026-05-31',
          },
        },
        required: ['query'],
      },
    },
  },
]

// ---- 时间提示解析 ----

export function parseTimeHint(timeHint?: string): { start: Date; end: Date } | null {
  if (!timeHint) return null
  const now = new Date()
  
  // 规则匹配（按优先级）
  const patterns: Array<{ regex: RegExp; daysBack: number; tolerance: number }> = [
    { regex: /(\d+)天前/,           daysBack: 0, tolerance: 0 }, // 动态计算
    { regex: /(\d+)周前/,           daysBack: 0, tolerance: 0 },
    { regex: /半个月前/,             daysBack: 15, tolerance: 3 },
    { regex: /上(?:个)?周末/,        daysBack: 0, tolerance: 0 }, // 动态计算最近周末
    { regex: /上(?:个)?周/,          daysBack: 7,  tolerance: 3 },
    { regex: /前几天/,               daysBack: 5,  tolerance: 3 },
    { regex: /最近/,                 daysBack: 7,  tolerance: 0 },
    { regex: /上(?:个)?月/,          daysBack: 30, tolerance: 7 },
    { regex: /(\d+)月(?:底|末|初)/,  daysBack: 0, tolerance: 0 }, // 动态计算
    { regex: /(\d+)月(\d+)日?/,      daysBack: 0, tolerance: 0 }, // 精确日期
  ]
  
  // 实现细节略，返回 { start, end } 或 null
  return null
}

// ---- search_memories 双层检索实现 ----

export async function searchMemories(params: {
  supabase: any
  userId: string
  apiConfigs: Array<{ url: string; key: string; model: string }>
  keywords: string
  timeHint?: string
}): Promise<MemoryResult[]> {
  const { supabase, userId, apiConfigs, keywords, timeHint } = params
  const dateRange = parseTimeHint(timeHint)
  const results: MemoryResult[] = []
  
  // ===== Layer 1: daily_event_items 检索 =====
  
  // 1a. 关键词匹配
  const { data: keywordEvents } = await supabase
    .from('daily_event_items')
    .select('*')
    .ilike('content', `%${keywords}%`)
    .order('date', { ascending: false })
    .limit(5)
  
  // 1b. 向量匹配
  const embedding = await generateEmbedding(keywords, apiConfigs)
  const { data: vectorEvents } = embedding 
    ? await supabase.rpc('match_daily_event_items', {
        query_embedding: embedding,
        match_threshold: 0.3,
        match_count: 5,
      })
    : { data: [] }
  
  // 1c. 合并去重 + 日期过滤
  const layer1Results = mergeAndFilter([...(keywordEvents || []), ...(vectorEvents || [])], dateRange)
  
  results.push(...layer1Results.slice(0, 5).map(e => ({
    source: 'daily_event' as const,
    date: e.date,
    time: e.chat_time_start || '',
    content: e.content,
    confidence: 'high' as const,
  })))
  
  // ===== Layer 2 触发条件 =====
  const layer1Sufficient = 
    layer1Results.length >= 3 || 
    (vectorEvents?.length > 0 && vectorEvents[0].similarity > 0.5)
  
  if (!layer1Sufficient) {
    // Layer 2: 直接搜索 chat_messages
    let query = supabase
      .from('chat_messages')
      .select('id, client_id, role, content, created_at')
      .eq('user_id', userId)
      .neq('role', 'system')
      .ilike('content', `%${keywords}%`)
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (dateRange) {
      query = query
        .gte('created_at', dateRange.start.toISOString())
        .lte('created_at', dateRange.end.toISOString())
    }
    
    const { data: chatResults } = await query
    
    if (chatResults) {
      for (const msg of chatResults) {
        results.push({
          source: 'chat_message',
          date: new Date(msg.created_at).toISOString().slice(0, 10),
          time: new Date(msg.created_at).toISOString().slice(11, 16),
          content: `[${msg.role === 'user' ? '用户' : 'AI'}] ${msg.content}`,
          confidence: 'medium',
          context: null, // 可选：延迟加载上下文
          messageId: msg.client_id || msg.id,
        })
      }
    }
  }
  
  return results.slice(0, 10)
}
```

### 5.3 Agent 循环伪代码（`api/chat-completion.ts` 改造）

```typescript
async function agenticChat(params: {
  supabase: any
  userId: string
  apiConfigs: Array<{ url: string; key: string; model: string }>
  conversationMessages: Message[]
  settings: any
}) {
  // Step 1: 构建初始 messages（保留固定上下文）
  const baseMessages = await buildBaseMessages(params) // system prompt, 用户画像, 最近事件, 真实世界信息, 当前对话
  
  // Step 2: Agent 循环（最多 3 轮 tool-calling）
  const messages = [...baseMessages]
  let finalResponse = ''
  
  for (let turn = 0; turn < 3; turn++) {
    const response = await fetch(resolveChatCompletionsUrl(apiConfigs[0].url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiConfigs[0].key}`,
      },
      body: JSON.stringify({
        model: apiConfigs[0].model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: settings?.temperature ?? 0.7,
      }),
    })
    
    const data = await response.json()
    const choice = data.choices?.[0]
    
    if (choice.finish_reason === 'stop') {
      finalResponse = choice.message.content
      break
    }
    
    if (choice.finish_reason === 'tool_calls') {
      // 追加 assistant 消息（含 tool_calls）
      messages.push(choice.message)
      
      // 执行每个 tool call
      for (const toolCall of choice.message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments)
        let result: any
        
        if (toolCall.function.name === 'search_memories') {
          result = await searchMemories({
            supabase, userId, apiConfigs,
            keywords: args.keywords,
            timeHint: args.time_hint,
          })
        } else if (toolCall.function.name === 'search_life_logs') {
          result = await ragRetrieval({
            supabase, apiConfigs,
            searchQuery: args.query,
          })
        }
        
        // 追加 tool result 消息
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        })
      }
      // 继续循环，AI 会看到 tool 结果并决定下一步
      continue
    }
    
    // 其他情况（length / content_filter）→ 使用当前 content
    finalResponse = choice.message?.content || ''
    break
  }
  
  return finalResponse
}
```

---

## 六、实现路径

### Phase 1：最小可行增强（1-2 天）

**目标**：让「极北柳莺」能被检索到，不改动现有架构。

- [ ] 在 `chat_messages` 表上创建 `pg_trgm` GIN 索引
- [ ] 在 `daily_event_items` 表上创建 `pg_trgm` GIN 索引
- [ ] 在 `_context.ts` 的 `retrievalJudgeAndFetch` 中，当 Layer 1（daily_event_items 向量匹配）结果不足时，增加 Layer 2 的 ILIKE 关键词回退
- [ ] 增强 `analyzeQueryIntent` 的时间解析，支持「半个月前」「上个月」等表达映射为具体日期范围

**此阶段不改动 API 接口，不引入 tool-calling。** 风险最低，可以快速上线验证效果。

### Phase 2：引入 Tool-calling（3-5 天）

**目标**：让 AI 拥有主动检索能力。

- [ ] 新建 `api/_tools.ts`，实现 `TOOLS` 定义、`searchMemories`、`searchLifeLogs`
- [ ] 改造 `api/chat-completion.ts`，实现 agentic chat 循环（最多 3 轮 tool-calling）
- [ ] 改造 `api/_context.ts` 的 `enrichMessages`，分离固定上下文和可检索上下文
- [ ] 保留旧有逻辑作为 fallback（通过环境变量切换）

### Phase 3：优化与扩展（持续）

- [ ] 根据日志分析最常用的检索模式，优化 tool 描述和内部策略
- [ ] 引入 `get_conversation_context` tool（如需要）
- [ ] 考虑中文分词（zhparser）升级
- [ ] 考虑混合搜索（向量 + 关键词融合排序）
- [ ] 监控 tool-calling 的成功率和延迟

---

## 七、与现有系统的对比

| 维度 | 当前系统 | Phase 1（最小增强） | Phase 2（Agent RAG） |
|------|:---:|:---:|:---:|
| **极北柳莺场景** | ❌ | ✅ | ✅ |
| **AI 决定检索策略** | ❌（固定流水线） | ❌（仍是固定流水线） | ✅（AI 自主选择） |
| **多种检索方式** | 向量为主 | 向量 + 关键词 | 向量 + 关键词 + 日期 + 多种组合 |
| **迭代检索能力** | ❌ | ❌ | ✅（最多 3 轮） |
| **代码改动量** | — | 小（< 100 行） | 中（~500 行新增 + 重构） |
| **延迟影响** | — | 极小 | 可感知（多一次 API 调用） |
| **Token 消耗** | — | 不变 | 略增（tool definitions ~500 tokens + tool results） |
| **回退风险** | — | 极低 | 低（可环境变量切换） |

---

## 八、关于噪音问题的补充分析

### 8.1 为什么 chat_messages 直接搜索不会产生严重噪音

1. **关键词过滤已经是一个强信号**。ILIKE `%鸟%` 在正常聊天中命中率很低，不会返回几十条无关结果。
2. **日期范围大幅缩小搜索空间**。结合 `time_hint` 解析后，搜索范围从全表缩小到几天内。
3. **双层设计中的触发条件**。Layer 2 仅在 Layer 1 不足时触发，大多数日常查询根本不会走到 Layer 2。
4. **返回数量限制**。最多返回 10 条，AI 不会被淹没。

### 8.2 什么场景下可能出现噪音

| 场景 | 噪音风险 | 应对 |
|------|:---:|------|
| 用户搜索「吃」这种高频词 | ⚠️ 高 | 结合日期范围限制；或 AI 换更具体的关键词（如「火锅」） |
| 用户没有提供时间提示 | ⚠️ 中 | Layer 1 先行；返回结果按时间倒序，最近的最相关 |
| 聊天记录非常多（数万条） | ⚠️ 中 | pg_trgm GIN 索引确保查询性能；LIMIT 10 限制返回 |

### 8.3 未来的优化方向

如果噪音确实成为问题（需要在实际上线后观察），可以引入：
- **结果排序优化**：将 ILIKE 结果与向量相似度结合，进行融合排序
- **上下文扩展**：search_memories 返回结果时，自动附带前后各 1 条对话，帮助 AI 判断相关性
- **用户反馈信号**：如果 AI 检索后回复「我不太确定你指的是哪次...」，则说明检索结果噪音大，可以作为优化信号

---

## 九、附录：关键代码片段参考

### 9.1 pg_trgm 索引的 ILIKE 加速原理

```sql
-- 没有索引时：全表扫描
SELECT * FROM chat_messages WHERE content ILIKE '%鸟%';
-- 执行时间：数秒 ~ 数十秒（取决于表大小）

-- 有 pg_trgm GIN 索引时：索引扫描
-- 执行时间：毫秒级

-- pg_trgm 对中文的支持：
-- 将文本拆分为三元组（按字符），例如"神秘小鸟"
-- → "神秘"、"秘小"、"小鸟" → 存入 GIN 索引
-- ILIKE '%鸟%' → 匹配包含"鸟"的三元组 → 索引命中
```

### 9.2 时间提示解析规则参考

```typescript
// 映射表（可按需扩展）
const TIME_PATTERNS = [
  { hint: '今天',        daysBack: 0,  window: 1 },
  { hint: '昨天',        daysBack: 1,  window: 1 },
  { hint: '前天',        daysBack: 2,  window: 1 },
  { hint: '这几天',      daysBack: 0,  window: 3 },  // 近3天
  { hint: '最近',        daysBack: 0,  window: 7 },  // 近7天
  { hint: '上周',        daysBack: 7,  window: 7 },
  { hint: '半个月前',    daysBack: 15, window: 7 },  // ±3.5天
  { hint: '几周前',      daysBack: 14, window: 14 },
  { hint: '上个月',      daysBack: 30, window: 15 }, // ±7.5天
  { hint: '前阵子',      daysBack: 21, window: 21 },
]
```

---

> **下一步**：请审阅此方案，确认后从 Phase 1 开始逐步实施。如有任何设计上的顾虑或需要调整的方向，我们可以继续讨论。
