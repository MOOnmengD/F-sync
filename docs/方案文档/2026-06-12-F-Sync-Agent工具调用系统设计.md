# F-Sync Agent 工具调用系统设计

> 状态：方案设计阶段，待用户确认后实施  
> 日期：2026-06-12  
> 基于：[2026-06-11-Agentic-RAG-混合检索架构方案](./2026-06-11-Agentic-RAG-混合检索架构方案.md)  
> 说明：本方案聚焦 Agent 工具调用（Function Calling）与 MCP 数据摄取，是对 Agentic RAG 方案第十二章的扩展和独立设计。检索相关的 tool-calling（search_memories / search_life_logs）已在 Agentic RAG 方案中详细定义，本文不再重复。

---

## 一、功能名称

F-Sync Agent 工具调用系统：赋予 Florian 在 F-Sync 数据空间内的读写能力，并通过 MCP 协议摄取外部数据。

---

## 二、背景与动机

### 2.1 当前状态

F-Sync 的 AI 对话目前是一个"纯聊天"系统：Florian 可以基于 RAG 检索到的上下文生成回复，但**不能主动查询数据库、不能修改数据、不能执行任何操作**。

用户提出"记账"时，实际流程是：

```
用户输入文本 → /api/parse-transaction → AI 解析 → 写入 Supabase → 返回结构化结果 → 前端展示表单 → 用户确认
```

这个流程中 AI 只做文本解析，真正的"写操作"由前端代码完成。Florian 在对话中无法直接帮用户查账、改记录、搜索历史。

### 2.2 核心洞察

用户明确 F-Sync Agent 的定位是**局部 Agent**，而非 Operit 式的全能 Agent：

> "F-Sync内部是一个独立的空间，F-Sync外部是另一个空间。F-Sync的AI只需要做好F-Sync内部的工作就可以了，是一个局部的AI Agent。"

这个定位决定了设计方向：

- ✅ Agent 的领域 = Supabase 中的所有数据表
- ✅ Agent 可以读、写、修改这些数据
- ✅ 外部数据通过 MCP **单向流入** F-Sync
- ❌ Agent 不需要操作手机、不需要查天气/快递、不需要控制外部 App

### 2.3 数据流边界

```
F-Sync 外部                          F-Sync 内部（Agent 的领地）
┌──────────────┐                    ┌─────────────────────────┐
│ 滴答清单      │──MCP (只读导入)──→  │                         │
│ 其他服务      │──MCP (只读导入)──→  │  Supabase               │
│              │                    │  ├── transactions        │
│              │                    │  ├── chat_messages       │
│              │                    │  ├── daily_logs          │
│              │                    │  ├── daily_event_items   │
│              │                    │  ├── user_profiles       │
│              │                    │  ├── social_relationships│
│              │                    │  ├── items               │
│              │                    │  └── user_settings       │
│              │                    │       ↕ 读写             │
│              │                    │  ┌─────────────────┐    │
│              │                    │  │ Florian Agent   │    │
│              │                    │  │ (Function Call) │    │
│              │                    │  └─────────────────┘    │
└──────────────┘                    └─────────────────────────┘
```

**核心原则**：MCP 是数据进入 F-Sync 的**单向管道**；进入后的数据由 Florian 自由读写。

---

## 三、设计目标

- [ ] Florian 在对话中能够查询 Supabase 中的数据（查账、查记录、查日记、查画像）
- [ ] Florian 在对话中能够创建和修改 Supabase 中的数据（记账、改记录、更新画像）
- [ ] 工具调用循环在 Vercel Serverless Function 内完成，前端无需改动
- [ ] 不支持 Function Calling 的模型自动降级为普通对话
- [ ] 工具调用失败不阻断正常回复
- [ ] MCP Client 能够连接外部 MCP Server，读取数据并写入 Supabase
- [ ] 整个 Agent 系统保持在 F-Sync 的数据边界内

---

## 四、涉及范围

| 层级 | 影响文件/模块 | 变更类型 |
|------|--------------|----------|
| API | `api/chat-completion.ts` | 修改：加入 Function Calling 循环 |
| API | `api/_tools.ts` | **新增**：工具定义与执行器 |
| API | `api/_mcp-client.ts` | **新增**：MCP Client（Phase 2） |
| 数据库 | — | 第一版无需变更；Phase 2 新增 `mcp_integrations` 表 |
| 前端页面 | — | 第一版原则上不改 |
| 状态管理 | — | 第一版不改 |
| 定时任务 | `api/proactive-ai.ts` | 后续可选：Agent 自主性 |
| 文档 | `03-后端API.md`、`05-AI系统设计.md` | 实现后同步更新 |

---

## 五、设计方案

### 5.1 Agent 工具调用循环

在 `chat-completion.ts` 中增加 Function Calling 循环，流程如下：

```text
用户消息
  │
  ▼
现有 enrichMessages()（RAG + 画像 + 上下文构建）
  │
  ▼
构造 messages + tools → 调用 AI API
  │
  ▼
AI 返回？
  │
  ├── final reply（无 tool_calls）
  │     └─→ 流式返回给前端 → 结束
  │
  └── tool_calls[]
        │
        ▼
      并行执行工具（最多 5 个独立工具同时执行）
        │
        ▼
      工具结果追加到 messages
        │
        ▼
      是否达到最大轮数（3 轮）？
        │
        ├── YES → 强制要求 AI 生成最终回复 → 结束
        │
        └── NO  → 回到「调用 AI API」
```

**关键设计决策**：

| 决策 | 选择 | 理由 |
|------|------|------|
| 循环在哪里执行？ | Vercel 后端（函数内完成） | 前端无需改动，逻辑集中 |
| 最大工具调用轮数 | 3 轮 | 避免延迟累积；大部分任务 1-2 轮即可完成 |
| 工具并行执行？ | 是（无依赖的并行） | 减少延迟 |
| 流式输出策略 | 工具调用期间不流式，最终回复流式返回 | 避免前端处理复杂状态 |

### 5.2 工具定义体系

#### 5.2.1 数据查询工具（READ）

```typescript
// 查询生活记录
const queryTransactionsTool = {
  name: "query_transactions",
  description: "查询生活记录（记账/碎碎念/计时等）。可按类型、日期范围、分类、关键词筛选。",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["记账", "whisper", "timing", "收藏"], description: "记录类型" },
      finance_category: { type: "string", enum: ["衣", "食", "住", "行", "娱乐"], description: "记账分类（仅 type=记账 时有效）" },
      date_from: { type: "string", description: "开始日期，YYYY-MM-DD" },
      date_to: { type: "string", description: "结束日期，YYYY-MM-DD" },
      keyword: { type: "string", description: "在 content 字段中搜索关键词" },
      limit: { type: "number", description: "返回条数上限，默认 10，最大 50" }
    }
  }
}

// 搜索聊天历史
const queryChatHistoryTool = {
  name: "query_chat_history",
  description: "搜索历史聊天记录。按关键词和日期范围查找。",
  parameters: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "搜索关键词" },
      date_from: { type: "string", description: "开始日期，YYYY-MM-DD" },
      date_to: { type: "string", description: "结束日期，YYYY-MM-DD" },
      limit: { type: "number", description: "返回条数上限，默认 10" }
    }
  }
}

// 读日记
const queryDailyLogsTool = {
  name: "query_daily_logs",
  description: "读取 AI 日记（daily_logs）。Florian 每天写的日记。",
  parameters: {
    type: "object",
    properties: {
      date_from: { type: "string", description: "开始日期，YYYY-MM-DD" },
      date_to: { type: "string", description: "结束日期，YYYY-MM-DD" },
      limit: { type: "number", description: "返回条数上限，默认 5" }
    }
  }
}

// 读用户画像
const queryUserProfilesTool = {
  name: "query_user_profiles",
  description: "读取用户画像和长期记忆。",
  parameters: {
    type: "object",
    properties: {
      profile_type: { type: "string", enum: ["personal_facts"], description: "画像类型" }
    }
  }
}

// 读社交关系
const querySocialRelationshipsTool = {
  name: "query_social_relationships",
  description: "读取社交关系记录。",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "按名称搜索（可选）" }
    }
  }
}

// 读物品档案
const queryItemsTool = {
  name: "query_items",
  description: "查询物品/品牌档案。",
  parameters: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "搜索物品名称或品牌关键词" },
      category: { type: "string", description: "分类过滤" },
      limit: { type: "number", description: "返回条数上限，默认 10" }
    }
  }
}
```

#### 5.2.2 数据写入工具（WRITE）

```typescript
// 创建生活记录
const createTransactionTool = {
  name: "create_transaction",
  description: "创建一条生活记录（记账/碎碎念/计时等）。用户说'帮我记一笔'时使用。",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["记账", "whisper", "timing", "收藏"], description: "记录类型" },
      content: { type: "string", description: "记录内容" },
      amount: { type: "number", description: "金额（记账专用）" },
      finance_category: { type: "string", enum: ["衣", "食", "住", "行", "娱乐"], description: "分类（记账专用）" },
      necessity: { type: "boolean", description: "是否必需（记账专用）" },
      mood: { type: "string", description: "心情 emoji（碎碎念专用）" },
      review: { type: "string", description: "点评/感受" },
      details: { type: "string", description: "客观规格信息" },
      repurchase_index: { type: "number", description: "复购指数 1-5" },
      created_at: { type: "string", description: "记录时间，YYYY-MM-DD HH:mm:ss。默认当前时间。" }
    }
  }
}

// 修改生活记录
const updateTransactionTool = {
  name: "update_transaction",
  description: "修改已有的生活记录。用户说'把那条改成...'时使用。",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "记录 ID（从 query_transactions 结果中获取）" },
      content: { type: "string", description: "新的内容" },
      amount: { type: "number", description: "新的金额" },
      finance_category: { type: "string", description: "新的分类" },
      review: { type: "string", description: "新的点评" },
      mood: { type: "string", description: "新的心情 emoji" }
    }
  }
}

// 删除生活记录
const deleteTransactionTool = {
  name: "delete_transaction",
  description: "删除一条生活记录。需要用户明确确认后才能执行。",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "记录 ID" },
      confirm: { type: "boolean", description: "必须为 true，表示用户已确认删除" }
    },
    required: ["id", "confirm"]
  }
}
```

#### 5.2.3 工具调用安全策略

| 操作类型 | 权限策略 |
|----------|----------|
| READ 类 | 无限制，正常查询（Supabase admin client，自动 RLS） |
| CREATE | 无限制，但单次调用限制 1 条（避免批量误创建） |
| UPDATE | 需要先查询到记录 ID，只能改 content/review/mood 等非关键字段 |
| DELETE | **必须用户明确确认**，且 `confirm` 参数必须为 `true` |

### 5.3 与 Agentic RAG 检索工具的关系

Agentic RAG 方案（2026-06-11）第十二章定义了两个检索工具：

| 工具 | 用途 | 在本方案中的定位 |
|------|------|-----------------|
| `search_memories` | 搜索历史记忆（事件 + 聊天原文回捞） | 归入 READ 类，实现时复用 `_retrieval.ts` |
| `search_life_logs` | 搜索生活记录（记账/碎碎念/计时） | 归入 READ 类，实现时与本方案的 `query_transactions` 合并或互斥 |

实现建议：
- 如果 Agentic RAG 方案的 Phase 3 先实现，本方案的 Supabase 工具作为其扩展
- 如果本方案先实现，则将 `search_memories` / `search_life_logs` 作为第一批工具一起上线
- **不重复定义**：本方案的 `query_transactions` 与 Agentic RAG 的 `search_life_logs` 功能重叠，选择其一实现即可（建议保留 `query_transactions`，名称更直观）

### 5.4 MCP 数据摄取（Phase 2）

MCP（Model Context Protocol）是一个基于 JSON-RPC 的标准化协议，用于 AI 模型与外部工具/数据源的交互。

#### 5.4.1 MCP Client 架构

```text
F-Sync Vercel Backend
  ┌──────────────────────────────┐
  │  api/_mcp-client.ts          │
  │                              │
  │  MCPClient 类                │
  │  ├── connect(serverUrl)      │  ← HTTP/SSE 传输
  │  ├── listTools()             │  ← 获取 MCP Server 的工具列表
  │  ├── callTool(name, args)    │  ← 调用工具
  │  └── disconnect()            │
  │         │                    │
  │         ▼                    │
  │  MCP Server (外部)           │
  │  ├── 滴答清单 MCP            │  ← 读取任务列表
  │  ├── 日历 MCP               │  ← 读取日程
  │  └── ...                     │
  └──────────────────────────────┘
```

#### 5.4.2 数据摄取流程

```
用户: "帮我同步滴答清单的任务"
  │
  ▼
Florian 判断需要调用 mcp_import 工具
  │
  ▼
Agent 调用 mcp_import(service: "ticktick")
  │
  ▼
MCP Client 连接滴答清单 MCP Server
  ├── 认证（API Key / OAuth，由用户提前在 Settings 中配置）
  ├── 调用 list_tasks 获取任务列表
  └── 返回数据
  │
  ▼
Agent 处理返回数据
  ├── 匹配已有记录（去重）
  ├── 写入 Supabase
  └── 生成回复: "已同步 12 个任务，其中 3 个今天到期"
```

#### 5.4.3 MCP 配置存储

Phase 2 需要新建 `mcp_integrations` 表：

```sql
CREATE TABLE mcp_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  service_name TEXT NOT NULL,        -- 'ticktick', 'google_calendar', ...
  server_url TEXT NOT NULL,          -- MCP Server URL
  auth_config JSONB,                 -- API Key / Token（加密存储）
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, service_name)
);
```

#### 5.4.4 导入数据存储

导入的外部数据统一存储在 Supabase 中。两种策略：

| 策略 | 方案 | 适用场景 |
|------|------|----------|
| **A. 统一导入表** | 一张 `mcp_imported_data` 表，`source` 字段区分来源 | 简单、统一查询，但结构不灵活 |
| **B. 映射到现有表** | 滴答清单任务 → `transactions`（type='todo'），日程 → `transactions`（type='schedule'） | 与现有数据融合，Agent 可统一操作 |

**建议**：Phase 2 先采用策略 B，将外部数据映射到现有 `transactions` 表（新增 `type` 枚举值 `todo`、`schedule`），并添加 `source` 字段标记来源。这样 Agent 不需要学习新表结构。

### 5.5 Agent 自主性（Phase 3，探索）

在工具调用系统成熟后，Agent 可以具备一定的自主性：

- **定时主动检查**：每天固定时间检查待办、账单，主动发起对话
- **数据异常提醒**：检测到异常消费模式时主动提示
- **与 proactive-ai 整合**：主动消息中嵌入 Agent 工具调用能力

这些属于远期探索，不作为第一版范围。

---

## 六、边缘情况与降级策略

| 情况 | 处理方式 |
|------|----------|
| AI 不支持 Function Calling | 检测 `/v1/models` 返回，不支持 tools 的模型跳过工具注入，作为普通对话处理 |
| 工具执行失败 | 返回简短错误信息给 AI（如 `"查询失败: timeout"`），让其基于现有上下文回复。不阻断对话 |
| 超过最大轮数 | 强制调用 AI（不带 tools），要求基于已有工具结果生成最终回复 |
| 工具返回数据过大 | 限制返回条数（最多 50 条），超过时截断并告知 AI |
| 用户中途取消 | 前端不处理取消；后端循环完成或超时 |
| MCP Server 连接失败 | 返回错误给 Agent，Agent 告知用户"暂时无法连接 XX 服务" |
| DELETE 工具未确认 | `confirm !== true` 时返回错误 `"需要用户确认后才能删除"` |
| DELETE 记录不存在 | 返回 `"未找到该记录"` |
| 多个 API Config 轮询 | 当前已有轮询容错，工具调用时同样适用 |

---

## 七、与现有功能的交互

| 现有功能 | 影响 |
|----------|------|
| `chat-completion.ts` | 核心改动：加入 tools 参数 + Agent 循环 |
| `enrichMessages()` | 不变：RAG + 上下文构建照常运行，在 Agent 循环之前完成 |
| `parse-transaction` | **不替代**：仍然作为记账的快速入口。Agent 的 `create_transaction` 是对话中的辅助路径 |
| `proactive-ai` | 第一版不改；Phase 3 整合 |
| `daily-summary` | 不改 |
| 前端 Chat 页 | 原则上不改；后续可增加工具调用状态展示（如"正在查询..."） |
| Settings 面板 | Phase 2 需增加 MCP 配置 UI |

---

## 八、实现步骤

### Phase 1：Agent 核心 + Supabase 数据查询（1-2 周）

1. 新建 `api/_tools.ts`：定义所有工具的 JSON Schema + 执行函数
2. 修改 `api/chat-completion.ts`：加入 Agent 循环（最多 3 轮）
3. 首批工具：`query_transactions`、`query_chat_history`、`query_daily_logs`、`query_user_profiles`
4. 不支持 Function Calling 的模型降级为普通对话
5. 测试：在 Chat 中让 Florian 查账、查日记

### Phase 2：数据写入工具（1 周）

1. 新增 `create_transaction`、`update_transaction`、`delete_transaction`
2. 写入工具的权限控制
3. 测试：在对话中让 Florian 创建/修改记录

### Phase 3：MCP 数据摄取（2-3 周）

1. 新建 `api/_mcp-client.ts`：实现 MCP Client（HTTP/SSE 传输）
2. 新建数据库迁移：`mcp_integrations` 表
3. 新增 `mcp_import` 工具
4. 滴答清单作为第一个接入的 MCP Server
5. 前端 Settings 面板增加 MCP 配置 UI

### Phase 4：优化与扩展（持续）

1. 根据实际使用调整工具定义
2. 增加更多 Supabase 表工具
3. 探索 Agent 自主性（proactive + tools）
4. 接入更多 MCP Server

---

## 九、验收标准

- [ ] Florian 在对话中能查询 transactions 表数据并正确回复
- [ ] Florian 能查询 daily_logs 和 user_profiles
- [ ] Florian 能创建/修改/删除记录（DELETE 需用户确认）
- [ ] 不支持 Function Calling 的模型自动降级，不影响正常对话
- [ ] 工具调用失败不阻断对话
- [ ] 3 轮工具调用后强制生成回复
- [ ] MCP Client 能成功连接外部 MCP Server 并获取数据
- [ ] MCP 导入的数据正确写入 Supabase
- [ ] Agent 不会查询/修改 Supabase 表之外的数据
- [ ] 实现完成后同步更新 03-后端API.md、05-AI系统设计.md

---

## 十、相关文档

- [Agentic RAG 混合检索架构方案](./2026-06-11-Agentic-RAG-混合检索架构方案.md) — 检索 tool-calling 定义
- [03-后端API](../03-后端API.md)
- [04-数据库](../04-数据库.md)
- [05-AI系统设计](../05-AI系统设计.md)
- [07-状态管理与数据流](../07-状态管理与数据流.md)

---

> 下一步：请用户审阅并明确确认本方案。按照项目文档优先流程，在获得确认前不开始编码。
