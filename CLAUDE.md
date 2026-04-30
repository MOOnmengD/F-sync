# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目背景

F-Sync 是一个个人生活记录 + AI 生活助手 Web 应用，部署在 https://www.fsync.top。个人开发、个人使用（单一用户，无其他用户）。通过 HarmonyOS WebAbility 封装为移动端应用（类 PWA）。

**开发者背景**：工科生，软件开发新手，用词可能不够专业，先确认需求再编程，开发过程中务必避免幻觉。

**两个代码仓库**：
- Web 端：`D:/F-Sync/`（本仓库）
- HarmonyOS 端：`C:/Users/User/DevEcoStudioProjects/FSync/`

---

## Web 端（D:/F-Sync/）

### 开发命令

```bash
# 本地开发（局域网可访问，固定端口 5173）
npm run dev

# 构建生产版本（TypeScript 报错会阻断构建）
npm run build

# 预览构建产物
npm run preview
```

> 无测试框架，无 lint 脚本。构建 = `tsc && vite build`。

### 技术栈

- **前端**：React 19 + TypeScript + Vite 8
- **样式**：TailwindCSS v4（配置在 `tailwind.config.ts`，CSS 入口 `src/styles.css`）
- **路由**：React Router DOM v7
- **状态管理**：Zustand（stores 在 `src/store/`）
- **后端服务**：Supabase（认证 + 数据库 + Realtime）
- **部署**：Vercel（`api/` 目录下的文件自动成为 Serverless Functions）
- **AI**：OpenAI 兼容接口（支持 DeepSeek 等），通过环境变量配置

### 架构概览

**数据流**：
```
=== 记账/记录流程 ===
用户输入（Home.tsx）
  → 前端预处理（extractDate / extractAmount）
  → 离线草稿箱（localStorage fsync_outkey，失败时暂存）
  → POST /api/parse-transaction（AI 解析）
  → 写入 Supabase transactions 表
  → 异步触发 POST /api/vectorize（生成 embedding）
  → Supabase Realtime 推送 → Finance/Whisper 等页面实时更新

=== AI 对话流程 ===
用户发消息（Chat.tsx）
  → 本地状态更新（Zustand persist）
  → POST /api/chat-completion（RAG 检索 + AI 回复）
  → 同步到 Supabase chat_messages（含 client_id 防重）
  → 页面卸载/隐藏时自动同步未发送消息

=== 主动消息 + 推送流程 ===
GitHub Actions 定时触发（每 15 分钟）
  → POST /api/proactive-ai（CRON_SECRET 鉴权）
  → AI 决策是否发消息
  → 写入 chat_messages（client_id = proactive-{timestamp}）
  → 调用华为 Push Kit v3 API 推送通知
  → 设备收到通知（横幅 + 振动）

=== 每日日记 + 画像更新 ===
GitHub Actions 定时触发（每天 UTC 17:00）
  → POST /api/daily-summary（CRON_SECRET 鉴权）
  → 收集过去 24h 记录 + 对话
  → AI 生成日记（Florian 第一人称）
  → 写入 daily_logs
  → 判断是否需要更新画像，如有必要则更新 user_profiles

=== 设置云端同步 ===
Chat 页挂载 → loadFromCloud()
  → 从 Supabase user_settings 拉取
  → 云端优先合并到本地 Zustand
保存设置 → saveToCloud()
  → upsert 到 user_settings
```

**数据库表结构**（详见 `supabase.schema.json` 和 `migrations/` 目录）：

**核心表**（supabase.schema.json 中有记录）：

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `transactions` | 所有生活记录（记账/碎碎念/计时/点评等） | `type`, `content`, `amount`, `embedding`(pgvector), `search_vector`(tsvector), `ai_metadata`(JSONB), `mood`, `finance_category`, `start_time/end_time/duration`(计时) |
| `items` | 物品/品牌档案（去重） | `item_name`(UNIQUE), `brand`, `category`, `last_review`, `embedding` |
| `chat_messages` | AI 对话历史 | `role`, `content`, `client_id`(UNIQUE 幂等), `user_id` |

**迁移添加的表**（`migrations/` 目录）：

| 表名 | 用途 | 关键字段 | 迁移文件 |
|------|------|----------|----------|
| `user_profiles` | AI 生成的用户画像（长期记忆） | `user_id`, `profile_type`(diet_preferences/person_mentions/recent_moods/spending_patterns), `content`(JSONB) | 002 |
| `user_settings` | 云端 AI 设置存储 | `user_id`(UNIQUE), `settings`(JSONB) | 003 |
| `push_tokens` | 华为推送设备 Token | `user_id`, `token`, `platform`(harmony), UNIQUE(user_id, platform) | 004 |
| `daily_logs` | AI 每日日记 | `user_id`, `date`(YYYY-MM-DD), `content` | 005 |

**数据库函数**：
- `match_life_logs(query_embedding, match_threshold, match_count)` — pgvector 余弦相似度搜索，用于 RAG 向量检索策略（迁移 006）
- `transactions_search_vector_update()` — 触发器函数，自动更新 tsvector 全文搜索列（迁移 001）

**RLS 策略**：transactions 和 items 表通过硬编码 UUID（`17bc4400-b67a-45b0-9366-0e689eedfa09`）限制为单一用户；chat_messages、user_profiles、user_settings、push_tokens、daily_logs 通过 `auth.uid()` 限制。

**Serverless API**（`api/` 目录）：

| 文件 | 功能 | 触达方式 |
|------|------|----------|
| `parse-transaction.ts` | AI 解析记账文本 → 结构化 JSON | 前端 Home 页输入 |
| `vectorize.ts` | 生成 embedding；支持单条（`transaction_id`）和全量（`mode:'all'`）模式 | 前端调用 + 异步触发 |
| `chat-completion.ts` | AI 对话，含 RAG（向量检索 + 全文检索 + 时间兜底三策略），读取 user_profiles 表作为长期记忆 | 前端 Chat 页 |
| `proactive-ai.ts` | 定时主动发消息（GitHub Actions 触发），调用 AI 决策是否发送，写入 chat_messages，通过华为 Push Kit 推送通知，更新 user_profiles | GitHub Actions 每 15 分钟 |
| `save-push-token.ts` | 保存 HarmonyOS Push Token 到 push_tokens 表（upsert by user_id+platform） | 前端 WebView 桥接调用 |
| `daily-summary.ts` | 每日 AI 日记生成 + 用户画像更新（cron 触发），写入 daily_logs 和 user_profiles | GitHub Actions 每天 UTC 17:00 |

**API 依赖的 npm 包**：仅 `@supabase/supabase-js`（数据读写）和 `jsonwebtoken`（proactive-ai 中生成华为推送 JWT）。

**环境变量**（Vercel + GitHub Secrets）：

| 变量 | 用途 | 使用位置 |
|------|------|----------|
| `VITE_SUPABASE_URL` | Supabase 项目 URL | 前端 + API |
| `VITE_SUPABASE_ANON_KEY` | Supabase 匿名密钥 | 前端 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 管理员密钥（绕过 RLS） | 所有 API 端 |
| `AI_API_URL` / `AI_API_KEY` / `AI_MODEL` | 记账解析 AI（OpenAI 兼容） | parse-transaction，其他 API 的 fallback |
| `CHAT_AI_API_URL` / `CHAT_AI_API_KEY` / `CHAT_AI_MODEL` | 对话 AI（优先使用） | chat-completion, proactive-ai, daily-summary |
| `EMBEDDING_API_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` | 向量化（text-embedding-3-small） | vectorize, chat-completion |
| `CRON_SECRET` | cron 接口鉴权（Bearer Token） | proactive-ai, daily-summary, GitHub Actions |
| `PROACTIVE_USER_ID` | 主动消息目标用户 UUID | proactive-ai, daily-summary, save-push-token |
| `HUAWEI_KEY_ID` / `HUAWEI_SUB_ACCOUNT` | 华为 AGC 服务账号 | proactive-ai |
| `HUAWEI_PRIVATE_KEY` | 华为 Push Kit JWT 私钥（PS256） | proactive-ai |
| `HUAWEI_PROJECT_ID` | 华为 AGC 项目 ID | proactive-ai |
| `VERCEL_DOMAIN` | 部署域名 | GitHub Actions（cron curl 目标） |

> 注意：API 代码中多处使用 fallback 链（如 `EMBEDDING_API_KEY \|\| CHAT_AI_API_KEY \|\| AI_API_KEY`），确保同类型 AI 服务至少配置一组。

**前端页面结构**：
- `/`（Home）：主输入界面，顶部 mode 切换（记账/点评/碎碎念/工作/收藏/时间轴），底部固定输入框。含离线草稿箱（localStorage 暂存发送失败的记录）。时间轴 mode 含计时功能（useTimeline hook，localStorage 持久化进行中的计时）
- `/finance`（Finance）：记账月度报表，按天分组，支持月份选择
- `/whisper`（Whisper）：碎碎念月度回显，支持展开/折叠，按心情筛选
- `/chat`（Chat）：AI 对话界面，含设置面板（API 配置、Prompt 设定、向量同步）、AI 日记+用户画像查看（ProfileDiaryModal）。消息支持删除（含二次确认）。支持设置云端存储/加载
- `/timeline`：占位页面（时间轴功能已内嵌在 Home 页的时间轴 mode 中）
- `/work`、`/vault`：占位页面（待开发）
- `/login`（Login）：GitHub OAuth 登录

侧边栏（DrawerNav）：全局导航，点击左上角 Menu 图标触发。

**状态管理**（`src/store/`）：
- `ui.ts`：UI 状态（抽屉开关、当前 mode、记账分类/必要性、心情），无持久化
- `chat.ts`：聊天消息（Zustand persist → localStorage `f-sync-chat-v2`），含 `upsertMessage` 防重（by client_id）、`deleteMessage`（本地 + Supabase 级联删除）、`syncMessages`（批量同步未同步消息到 Supabase）。页面卸载/隐藏时自动触发同步
- `settings.ts`：AI 设置（system prompt、user prompt、proactive prompt、apiConfigs），持久化到 localStorage `f-sync-settings`。支持 `loadFromCloud()` / `saveToCloud()` — 从 Supabase `user_settings` 表拉取/推送，云端优先合并

### GitHub Actions 定时任务

`.github/workflows/` 目录下有两个定时工作流，通过 `curl` 调用 Vercel 上的 API 端点：

| 工作流文件 | 调度频率 | 调用端点 | 功能 |
|-----------|---------|----------|------|
| `proactive-ai-pulse.yml` | 每 15 分钟 | `POST /api/proactive-ai` | AI 决策是否发送主动消息 + 推送通知 |
| `daily-summary.yml` | 每天 UTC 17:00（CST 次日 01:00） | `POST /api/daily-summary` | 生成 AI 日记 + 更新用户画像 |

两个工作流均使用 GitHub Secrets：`VERCEL_DOMAIN`（目标 URL）、`CRON_SECRET`（Bearer Token 鉴权），也支持 `workflow_dispatch` 手动触发。

### 设计规范

- **配色**：马卡龙配色（peach/mint/baby/butter/lavender），定义在 `tailwind.config.ts`
- **风格**：极简、无阴影（全局 `box-shadow: none !important`）
- **圆角**：统一使用 `rounded-2xl`
- **背景色**：`#FDFCFB`（base-bg）/ `#F7F5F2`（base-surface）
- **文字色**：`#4B5563`（base-text）/ `#6B7280`（base-muted）
- **边框色**：`#E7E5E4`（base-line）
- 新 UI 组件复用 `src/shared/ui/`（IconButton、PillButton、SegmentToggle、RepurchaseIndexPill、MonthPicker）

### 修改 Supabase 的流程

涉及表结构变更时：
1. 在 `migrations/` 目录创建 SQL 迁移文件（按序号命名，如 `007_xxx.sql`）
2. 提供 SQL 代码给用户在 Supabase Dashboard 执行
3. 用户执行后可更新 `supabase.schema.json`（通过 Supabase Dashboard 导出）
4. 读取最新的 `supabase.schema.json` 了解当前部分表结构；迁移中的表参见 `migrations/` 目录

---

## HarmonyOS 端（C:/Users/User/DevEcoStudioProjects/FSync/）

### 开发工具

使用 **DevEco Studio** 开发，不在命令行构建。构建/运行/调试均在 DevEco Studio IDE 内完成。由于HarmonyOS开发的特殊性，在调用系统权限/api时主动向开发者要求获取官方说明文档/示例代码，获取足够信息后再开始编程。

### 获取华为官方开发文档

**重要**：华为开发者文档 (`developer.huawei.com`) 是 JavaScript SPA 动态渲染，WebFetch 无法获取实际内容（只能拿到"文档中心"骨架 HTML）。**禁止直接 WebFetch 华为开发者文档 URL。**

华为 HarmonyOS 文档源自 OpenHarmony 开源项目，文档源文件以 Markdown 形式托管在 Gitee。获取官方文档内容的正确流程：

1. 用户给出 `developer.huawei.com` URL 时，先用 **WebSearch** `site:developer.huawei.com <关键词>` 确认页面存在及版本
2. 映射到对应的 OpenHarmony Gitee 仓库路径，用 **WebFetch** 直接拉取 raw Markdown 源文件（静态文件，无 JS 渲染问题）

**URL 映射规则**：

| 华为开发者 URL 模式 | Gitee OpenHarmony Raw 路径 |
|---|---|
| `developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-xxx` | `gitee.com/openharmony/docs/raw/HEAD/zh-cn/application-dev/reference/apis/js-apis-xxx.md` |
| `developer.huawei.com/consumer/en/doc/harmonyos-references-V*/js-apis-xxx` | `gitee.com/openharmony/docs/raw/HEAD/en/application-dev/reference/apis/js-apis-xxx.md` |
| `developer.huawei.com/consumer/cn/doc/harmonyos-guides-V*/xxx` | `gitee.com/openharmony/docs/raw/HEAD/zh-cn/application-dev/xxx.md` |

**注意事项**：
- Gitee raw 文件会 302 重定向到 `raw.giteeusercontent.com`，WebFetch 跟随重定向后即可获取内容
- 文件名大小写敏感，注意 `workScheduler` vs `workscheduler` 等驼峰差异
- 较新的 API（API 10+ / Kit 化后）文件可能在 `apis-backgroundtasks-kit/` 等 Kit 子目录下，需结合 WebSearch 结果确认精确路径
- 部分旧版 API 可能仅存在于特定版本分支（非 HEAD），此时需将路径中的 `HEAD` 替换为对应分支名（如 `OpenHarmony-4.1-Release`）

### 架构

HarmonyOS 端本质上是一个 **WebView 壳**，核心功能仍由 Web 端实现。ArkTS（`.ets` 文件）负责：
1. 加载 `https://www.fsync.top`（`WebAbilityPage.ets`）
2. 向 WebView 注入 JavaScript 桥接代码（`WebViewBridge.ets`）
3. 提供原生通知和振动能力（`NotificationService.ets`）

**关键文件**：
```
entry/src/main/ets/
  entryability/EntryAbility.ets   # 应用入口，初始化通知服务、请求权限
  pages/WebAbilityPage.ets        # 主页面，加载 WebView，注入脚本
  bridge/WebViewBridge.ets        # JS ↔ 原生通信桥接
  bridge/types.ets                # 消息接口类型定义
  services/NotificationService.ets # 原生通知 + 振动服务（单例）
```

### Web ↔ 原生通信机制

**Web → 原生**：Web 页面调用 `window.harmonyBridge.showNotification(title, content)`，内部通过 `window.postMessage` 发送 JSON 消息，原生端通过注入的 `harmonyMessageHandler` 拦截并处理。

**原生 → Web**：调用 `controller.runJavaScript(script)` 执行脚本，触发 `window.harmonyBridge.onNativeMessage(data)`。

**主动消息通知流程**：
```
GitHub Actions 定时触发
  → POST /api/proactive-ai（Vercel）
  → 写入 chat_messages（client_id 以 proactive- 开头）
  → Supabase Realtime 推送到 WebView 内的订阅
  → WebView 内 JS 检测到 proactive- 消息
  → 调用 window.harmonyBridge.showNotification()
  → 原生端弹出系统通知 + 振动
```

### 已申请权限（module.json5）

- `ohos.permission.INTERNET`：网络访问
- `ohos.permission.GET_NETWORK_INFO` / `GET_WIFI_INFO`：网络状态
- `ohos.permission.VIBRATE`：振动

### 已知问题 / 待完善

- 消息从 Web 到原生的桥接链路已通过 Push Kit v3 实现（华为推送），不依赖 WebView postMessage 桥接
- 主动消息通知通过华为 Push Kit 推送，即使应用在后台也能收到横幅通知（IM 自分类权益已申请）
- Push Token 保存链路：WebView 内 JS → `POST /api/save-push-token` → Supabase push_tokens 表
- `WebAbilityPage.ets` 中 `onPageBegin`/`onPageEnd` 各注册了两次（重复注册，待清理）

---

## AI 角色设定

AI 助手名为 **Florian**（昵称弗弗），用户昵称 moon/宝贝，定位为用户的 AI 恋人。这是应用的核心设计，修改 AI 相关功能时需保持这一人设。
