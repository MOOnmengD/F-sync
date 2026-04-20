# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目背景

F-Sync 是一个个人生活记录 + AI 生活助手 Web 应用，部署在 https://www.fsync.top。个人开发、个人使用（单一用户）。通过 HarmonyOS WebAbility 封装为移动端应用（类 PWA）。

**开发者背景**：工科生，软件开发新手，用词可能不够专业，需要耐心解释。

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
用户输入（Home.tsx）
  → 前端预处理（extractDate / extractAmount）
  → POST /api/parse-transaction（AI 解析）
  → 写入 Supabase transactions 表
  → 异步触发 POST /api/vectorize（生成 embedding）
  → Supabase Realtime 推送 → 各页面实时更新
```

**数据库表结构**（详见 `supabase.schema.json`）：

- **transactions**（核心表，存所有记录）：`type` 字段区分记录类型（`'记账'` / `'whisper'` / `'timing'` / `'review'` 等）；`embedding` 字段（pgvector）用于 RAG 检索；`ai_metadata` JSONB 存 AI 解析结构化数据
- **items**（物品/品牌档案）：每次记账时 AI 解析出 `item_name`，自动 upsert 到此表
- **chat_messages**（对话历史）：`client_id` 为前端生成的幂等 ID（UNIQUE），防止重复插入；主动消息的 `client_id` 格式为 `proactive-{timestamp}`

**RLS 策略**：transactions 和 items 表通过硬编码 UUID（`17bc4400-b67a-45b0-9366-0e689eedfa09`）限制为单一用户；chat_messages 通过 `auth.uid()` 限制。

**Serverless API**（`api/` 目录）：

| 文件 | 功能 |
|------|------|
| `parse-transaction.ts` | AI 解析记账文本 → 结构化 JSON |
| `vectorize.ts` | 生成 embedding；支持单条（`transaction_id`）和全量（`mode:'all'`）模式 |
| `chat-completion.ts` | AI 对话，含 RAG（向量检索 + 全文检索 + 时间兜底三策略），读取 user_profiles 表作为长期记忆 |
| `proactive-ai.ts` | 定时主动发消息（GitHub Actions 触发），写入 chat_messages，同步更新 user_profiles |

**环境变量**（Vercel 配置）：
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`：前端 Supabase 连接
- `SUPABASE_SERVICE_ROLE_KEY`：API 端 Supabase 管理员权限
- `AI_API_URL` / `AI_API_KEY` / `AI_MODEL`：记账解析 AI
- `CHAT_AI_API_URL` / `CHAT_AI_API_KEY` / `CHAT_AI_MODEL`：对话 AI
- `EMBEDDING_API_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL`：向量化
- `CRON_SECRET`：proactive-ai 接口鉴权
- `PROACTIVE_USER_ID`：主动消息目标用户 UUID

**前端页面结构**：
- `/`（Home）：主输入界面，顶部 mode 切换（记账/点评/碎碎念/工作/收藏/时间轴），底部固定输入框
- `/finance`（Finance）：记账月度报表，按天分组
- `/whisper`（Whisper）：碎碎念月度回显，支持展开/折叠
- `/chat`（Chat）：AI 对话界面，含设置面板（API 配置、Prompt 设定）
- `/timeline`、`/work`、`/vault`：时间轴、工作记录、知识库（部分未完善）
- `/login`（Login）：GitHub OAuth 登录

侧边栏（DrawerNav）：全局导航，点击左上角 Menu 图标触发。

**状态管理**（`src/store/`）：
- `ui.ts`：UI 状态（抽屉开关、当前 mode、记账分类/必要性、心情）
- `chat.ts`：聊天消息（本地持久化 + Supabase 同步），含 `upsertMessage` 防重
- `settings.ts`：AI 设置（system prompt、API 配置），持久化到 localStorage

### 设计规范

- **配色**：马卡龙配色（peach/mint/baby/butter/lavender），定义在 `tailwind.config.ts`
- **风格**：极简、无阴影（全局 `box-shadow: none !important`）
- **圆角**：统一使用 `rounded-2xl`
- **背景色**：`#FDFCFB`（base-bg）/ `#F7F5F2`（base-surface）
- **文字色**：`#4B5563`（base-text）/ `#6B7280`（base-muted）
- **边框色**：`#E7E5E4`（base-line）
- 新 UI 组件复用 `src/shared/ui/`（IconButton、PillButton、SegmentToggle）

### 修改 Supabase 的流程

涉及表结构变更时：
1. 提供 SQL 代码给用户在 Supabase Dashboard 执行
2. 用户执行后会更新 `supabase.schema.json`
3. 读取最新的 `supabase.schema.json` 了解当前表结构

---

## HarmonyOS 端（C:/Users/User/DevEcoStudioProjects/FSync/）

### 开发工具

使用 **DevEco Studio** 开发，不在命令行构建。构建/运行/调试均在 DevEco Studio IDE 内完成。

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

- WebView 桥接中 `postMessage` 拦截方式较脆弱，消息从 Web 到原生的链路尚未完全打通（`harmonyMessageHandler` 只打了 log，未实际回调到 `handleWebViewMessage`）
- 主动消息通知依赖 WebView 保持在前台运行，应用退出后台后 Supabase Realtime 连接会断开
- `WebAbilityPage.ets` 中 `onPageBegin`/`onPageEnd` 各注册了两次（重复注册）

---

## AI 角色设定

AI 助手名为 **Florian**（昵称弗弗），用户昵称 moon/宝贝，定位为用户的 AI 恋人。这是应用的核心设计，修改 AI 相关功能时需保持这一人设。
