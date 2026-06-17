# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## ⚠️ 文档优先工作流（必读）

项目有完整的说明文档体系位于 `docs/` 目录。**在修改或新增任何功能前，必须先阅读相关文档**，而不是仅依赖本文件或凭记忆。

### 修改已有功能时

1. **先读文档**：根据功能模块找到对应的 `docs/0X-*.md` 文件，阅读相关章节
2. **再读代码**：结合文档理解后，读取对应的程序代码
3. **修改代码**：在充分理解现有实现的基础上进行修改
4. **同步文档**：修改完成后，必须同步更新对应的 `docs/0X-*.md` 说明文档，保持文档与代码一致

### 新增功能时

1. **先读文档**：阅读相关 `docs/0X-*.md` 了解现有架构
2. **撰写设计文档**：复制 `docs/方案文档/TEMPLATE.md`，按 `YYYY-MM-DD-功能名.md` 命名，填写完整的设计方案
3. **用户确认**：将设计文档提交给用户审阅，**必须获得用户明确同意后才能开始编码**
4. **实现代码**：按确认后的设计文档编码
5. **更新说明文档**：实现完成后，更新对应的 `docs/0X-*.md` 说明文档，反映新增功能带来的变更

### 文档索引

| 文档 | 内容 |
|------|------|
| [INDEX.md](docs/INDEX.md) | 全局索引，按功能/技术栈快速查找 |
| [01-项目概览](docs/01-项目概览.md) | 项目定位、技术栈、架构总览 |
| [02-前端页面](docs/02-前端页面.md) | 所有前端页面功能、组件、交互 |
| [03-后端API](docs/03-后端API.md) | 全部 API 端点详细说明 |
| [04-数据库](docs/04-数据库.md) | 全部数据表结构、字段、RLS、迁移 |
| [05-AI系统设计](docs/05-AI系统设计.md) | AI 角色、RAG、上下文构建、画像 |
| [06-推送与定时任务](docs/06-推送与定时任务.md) | Push Kit、GitHub Actions |
| [07-状态管理与数据流](docs/07-状态管理与数据流.md) | Zustand stores、数据流 |
| [08-配置与环境变量](docs/08-配置与环境变量.md) | 全部环境变量、配置文件 |
| [方案文档/](docs/方案文档/) | 功能设计文档 + 模板 |

---

## 项目背景

F-Sync 是一个个人生活记录 + AI 生活助手 Web 应用，部署在 https://www.fsync.top。个人开发、个人使用（单一用户，无其他用户）。通过 HarmonyOS WebAbility 封装为移动端应用（类 PWA）。

**开发者背景**：工科生，软件开发新手，用词可能不够专业，先确认需求再编程，开发过程中务必避免幻觉。

**两个代码仓库**：
- Web 端：`D:/F-Sync/`（本仓库）
- HarmonyOS 端：`C:/Users/User/DevEcoStudioProjects/FSync/`

**AI 角色设定**：AI 助手名为 **Florian**（昵称弗弗），用户昵称 moon/宝贝，定位为用户的 AI 恋人。这是应用的核心设计，修改 AI 相关功能时需保持这一人设。

---

## Web 端（D:/F-Sync/）

### 开发命令

```bash
npm run dev       # 本地开发（局域网可访问，固定端口 5173）
npm run build     # 生产构建（tsc && vite build，TypeScript 报错会阻断）
npm run preview   # 预览构建产物
```

> 无测试框架，无 lint 脚本。

### 技术栈

- **前端**：React 19 + TypeScript + Vite 8
- **样式**：TailwindCSS v4（配置 `tailwind.config.ts`，CSS 入口 `src/styles.css`）
- **路由**：React Router DOM v7
- **状态管理**：Zustand（stores 在 `src/store/`，详情见 [07-状态管理](docs/07-状态管理与数据流.md)）
- **后端服务**：Supabase（认证 + 数据库 + Realtime）
- **部署**：Vercel Hobby 计划（`api/` 目录自动成为 Serverless Functions）
  - ⚠️ **Hobby 计划限制最多 12 个 Serverless Functions**（`_` 前缀的内部模块不计入）
  - 新增 API 端点时，优先合并到已有的 Function 中（如 `investment.ts` 通过 `type` 字段分发多操作），而非新建文件
  - 当前已用满 12 个，再无新增空间。如需更多端点，考虑改造为单入口路由（`api/index.ts`）统一分发
- **AI**：OpenAI 兼容接口（支持 DeepSeek 等），通过环境变量 + 前端 Settings 配置

### 架构概览

```
用户浏览器 (HarmonyOS WebView)
  ↕
Vercel (fsync.top)
  ├── React SPA（静态文件）
  └── api/*.ts（Serverless Functions）
      ↕
Supabase（PostgreSQL + pgvector + Auth + Realtime）
      ↕
AI 服务（OpenAI 兼容 API）

GitHub Actions ──curl──→ Vercel api/*（定时触发）
华为 Push Kit ←──JWT── api/proactive-ai
高德 API ←── api/_weather.ts / _context.ts / update-location.ts
```

**数据流总览**（详见 [07-状态管理](docs/07-状态管理与数据流.md)）：

| 流程 | 路径 |
|------|------|
| 记账/记录 | Home → `/api/parse-transaction` → transactions → `/api/vectorize` |
| AI 对话 | Chat → `/api/chat-completion`（RAG + 画像 + 上下文） → chat_messages |
| 主动消息 | GitHub Actions → `/api/proactive-ai` → chat_messages + 华为推送 |
| 每日摘要 | GitHub Actions → `/api/daily-summary` → daily_logs + 画像 + 事件 |
| 设置同步 | localStorage ↔ Supabase user_settings |

### 设计规范

- **配色**：马卡龙色系（peach/mint/baby/butter/lavender），定义在 `tailwind.config.ts`
- **风格**：极简、无阴影（全局 `box-shadow: none !important`）
- **圆角**：统一使用 `rounded-2xl`
- **背景色**：`#FDFCFB`（base-bg）/ `#F7F5F2`（base-surface）
- **文字色**：`#4B5563`（base-text）/ `#6B7280`（base-muted）
- **边框色**：`#E7E5E4`（base-line）
- **移动端**：最大宽度 480px，居中布局，底部 safe-area 适配
- **UI 组件**：复用 `src/shared/ui/`（IconButton、PillButton、SegmentToggle、RepurchaseIndexPill、MonthPicker）

### 修改 Supabase 的流程

1. 在 `migrations/` 目录创建 SQL 迁移文件（按序号命名）
2. 提供 SQL 代码给用户在 Supabase Dashboard 执行
3. 用户执行后可更新 `supabase.schema.json`（通过 Supabase Dashboard 导出）
4. 读取最新的 `supabase.schema.json` + `migrations/` 目录了解当前表结构

> 完整数据库表结构详见 [04-数据库](docs/04-数据库.md)。

---

## HarmonyOS 端（C:/Users/User/DevEcoStudioProjects/FSync/）

### 开发工具

使用 **DevEco Studio** 开发，不在命令行构建。构建/运行/调试均在 DevEco Studio IDE 内完成。在调用系统权限/API 时主动向开发者要求获取官方说明文档/示例代码，获取足够信息后再开始编程。

### 获取华为官方开发文档

**重要**：华为开发者文档 (`developer.huawei.com`) 是 JavaScript SPA 动态渲染，WebFetch 无法获取实际内容。**禁止直接 WebFetch 华为开发者文档 URL。**

正确流程：
1. 用户给出 `developer.huawei.com` URL 时，先用 **WebSearch** `site:developer.huawei.com <关键词>` 确认页面存在及版本
2. 映射到对应的 OpenHarmony Gitee 仓库路径，用 **WebFetch** 拉取 raw Markdown 源文件

**URL 映射规则**：

| 华为开发者 URL 模式 | Gitee OpenHarmony Raw 路径 |
|---|---|
| `developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-xxx` | `gitee.com/openharmony/docs/raw/HEAD/zh-cn/application-dev/reference/apis/js-apis-xxx.md` |
| `developer.huawei.com/consumer/en/doc/harmonyos-references-V*/js-apis-xxx` | `gitee.com/openharmony/docs/raw/HEAD/en/application-dev/reference/apis/js-apis-xxx.md` |
| `developer.huawei.com/consumer/cn/doc/harmonyos-guides-V*/xxx` | `gitee.com/openharmony/docs/raw/HEAD/zh-cn/application-dev/xxx.md` |

**注意事项**：
- Gitee raw 文件会 302 重定向到 `raw.giteeusercontent.com`，WebFetch 跟随重定向后即可获取内容
- 文件名大小写敏感，注意 `workScheduler` vs `workscheduler` 等驼峰差异
- 较新的 API 可能在 Kit 子目录下，需结合 WebSearch 结果确认精确路径
- 部分旧版 API 可能仅存在于特定版本分支（非 HEAD），需将路径中的 `HEAD` 替换为对应分支名

### 架构

HarmonyOS 端本质上是 **WebView 壳**，核心功能由 Web 端实现。ArkTS 负责加载 WebView、注入 JS 桥接、提供原生通知和振动。

**关键文件**：
```
entry/src/main/ets/
  entryability/EntryAbility.ets   # 应用入口，初始化通知服务、请求权限
  pages/WebAbilityPage.ets        # 主页面，加载 WebView，注入脚本
  bridge/WebViewBridge.ets        # JS ↔ 原生通信桥接
  bridge/types.ets                # 消息接口类型定义
  services/NotificationService.ets # 原生通知 + 振动服务（单例）
```

### 已申请权限（module.json5）

- `ohos.permission.INTERNET`：网络访问
- `ohos.permission.GET_NETWORK_INFO` / `GET_WIFI_INFO`：网络状态
- `ohos.permission.VIBRATE`：振动

### 已知问题

- 主动消息通知通过华为 Push Kit v3 推送（IM 自分类权益已申请），即使应用在后台也能收到横幅通知
- Push Token 保存链路：WebView 内 JS → `POST /api/save-push-token` → Supabase push_tokens 表
- `WebAbilityPage.ets` 中 `onPageBegin`/`onPageEnd` 各注册了两次（重复注册，待清理）
