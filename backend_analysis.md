---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 1b15fa6152c39e6cbe05d76c27235a71_6da76a00725511f1b2f55254006c9bbf
    ReservedCode1: dMLfdq8rcElL7uHUpwQKeM6wkoR1D7reOLdOcdpJM6+//9OX9KMn2f0qYcBYLTaUmO43gUaYznRO87bjDonekr3dYfiwCx3tYEuJ7U1fxqS6qhNItEY5224y84MlDOH3AaVLm+It7Z7QqpgJp2HCPvyzBOiBeB85LWrypLR9fYLxDGO2PtR2hRGgCGw=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 1b15fa6152c39e6cbe05d76c27235a71_6da76a00725511f1b2f55254006c9bbf
    ReservedCode2: dMLfdq8rcElL7uHUpwQKeM6wkoR1D7reOLdOcdpJM6+//9OX9KMn2f0qYcBYLTaUmO43gUaYznRO87bjDonekr3dYfiwCx3tYEuJ7U1fxqS6qhNItEY5224y84MlDOH3AaVLm+It7Z7QqpgJp2HCPvyzBOiBeB85LWrypLR9fYLxDGO2PtR2hRGgCGw=
---

# SimpleTextReader 后端分析报告

> 分析日期：2026-06-28
> 代码目录：`D:\simplereader\server`
> 运行端口：**8866**

---

## 一、整体定位

SimpleTextReader 后端是一个**轻量级本地 Web 服务器**，核心职责是：

1. **静态文件托管**：将整个项目根目录作为静态资源提供服务，前端 SPA 直接从本地服务器加载
2. **TXT 小说云书库**：管理服务器上的 TXT 书籍文件，提供书籍列表、内容流式传输
3. **书籍预处理**：对 TXT 小说做章节识别、分页、脚注提取等预处理，结果缓存到磁盘和数据库
4. **运行时配置同步**：前端可向服务端推送/拉取阅读器配置（分页参数、样式等）

它**不是**一个传统的多用户 Web 应用后端，而是一个**本地单实例辅助服务**，目标用户是同一台机器上的浏览器扩展或 PWA。

---

## 二、技术栈

| 层级 | 技术选型 | 说明 |
|---|---|---|
| **运行时** | Node.js (ES Module) | `package.json` 声明 `"type": "module"` |
| **HTTP 框架** | Express 4.21 | 路由、中间件、静态文件服务 |
| **数据库 ORM** | Prisma 5.10 | 连接 PostgreSQL，管理 Book/Font/ProcessedBook 模型 |
| **数据库** | PostgreSQL | 生产级关系型数据库 |
| **WebSocket** | ws 8.18 | 实时推送书籍处理状态 |
| **Session** | express-session 1.18 | 基于 cookie 的会话管理 |
| **编码检测** | jschardet 3.1 | 检测 TXT 文件的字符编码 |
| **字符集处理** | TextEncoder/TextDecoder | 通过 shared 层的适配器 |
| **流式传输** | Node.js Stream (pipeline) | 大文件以流方式发送，避免内存溢出 |
| **压缩** | Node.js zlib (gzip) | 预处理结果压缩存储 |
| **环境变量** | dotenv | 从 `.env` 文件加载配置 |
| **开发工具** | nodemon, Prisma CLI | 热重载、数据库迁移 |

---

## 三、目录结构

```
server/
├── app/
│   ├── app.js                      # Express 入口，挂载中间件/路由/WebSocket
│   ├── config/
│   │   ├── config.js               # 服务器全局配置（端口、路径、安全策略）
│   │   └── runtime-config.js       # 运行时配置管理（前端推送的阅读参数）
│   ├── database/
│   │   └── db-manager.js           # Prisma 数据库操作基类（CRUD）
│   ├── features/
│   │   ├── bookshelf.js            # 书架模块：书籍入库→预处理→存储→查询 全流程
│   │   └── fontpool.js             # 字体池模块
│   ├── file/
│   │   └── file-processor.js       # 文件处理器（调用 shared 层核心逻辑）
│   ├── middleware/
│   │   ├── auth.js                 # 会话验证中间件
│   │   ├── error.js                # 错误处理（APIError / DatabaseError 类 + 全局兜底）
│   │   └── security.js             # 安全中间件（路径消毒、HTTPS 强制、安全头）
│   ├── routes/
│   │   ├── api.js                  # /api 路由（健康检查、配置读写）
│   │   └── library.js              # /library 路由（书籍列表、Token 鉴权获取内容）
│   ├── services/
│   │   ├── library-service.js      # 云书库目录扫描服务
│   │   └── token-service.js        # 一次性访问令牌管理（防重放）
│   └── websocket/
│       └── websocket-server.js     # WebSocket 广播服务（推送书籍处理进度）
├── prisma/
│   └── schema.prisma               # 数据模型：Book, ProcessedBook, Font
├── dev/                            # 开发工具脚本
├── .env.example                    # 环境变量模板
└── package.json
```

---

## 四、框架与中间件栈

### 4.1 Express 应用初始化 (`app.js`)

```
security 中间件（HTTPS 强制 + 安全头）
    ↓
JSON / URL-Encoded 解析
    ↓
Session 中间件（express-session）
    ↓
自动认证（开发环境全放行 / 生产环境仅 localhost）
    ↓
静态文件服务（项目根目录 express.static）
    ↓
API 路由挂载（/api, /library）
    ↓
SPA fallback：所有未匹配路由 → index.html
    ↓
全局错误处理
```

### 4.2 安全机制

| 机制 | 实现 |
|---|---|
| **路径消毒** | `sanitizeFilePath()` 防目录遍历——拒绝 `../`、危险字符、超长文件名、非白名单扩展名 |
| **CSP** | 严格的 Content-Security-Policy（script-src 白名单，禁止 object-src） |
| **HSTS** | 生产环境强制启用，max-age=1年，含 subDomains + preload |
| **安全头** | X-Frame-Options: DENY, X-XSS-Protection, X-Content-Type-Options: nosniff, Referrer-Policy |
| **HTTPS 强制** | 生产环境自动 301 重定向到 HTTPS |
| **Token 机制** | 一次性访问令牌 + 5分钟过期 + 定时清理 + session 绑定 |

---

## 五、API 路由一览

### 5.1 `/api`（基础 API）

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api` | 无 | 健康检查：返回书库状态、书籍数量、session ID |
| GET | `/api/details` | Session | 详细信息：服务器 uptime/内存/Node版本、书库路径、书籍列表 |
| GET | `/api/config` | Session | 获取当前运行时配置 |
| POST | `/api/config/update` | Session | 前端推送运行配置更新 |

### 5.2 `/api/library`（书库 API）

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/library` | Session | 获取书籍文件名列表（过滤不安全文件、超大文件），返回后异步触发书籍预处理 |
| POST | `/api/library/request-book` | Session | 请求书籍访问令牌（一次性，5分钟有效） |
| POST | `/api/library/fetch-book` | Session + Token | 凭令牌获取书籍内容：已处理→返回 JSON（章节/分页/脚注），未处理→流式传输原始文件 |

**Token 流程**：前端先调 `request-book` 获取一次性的加密 token → 再调 `fetch-book` 凭 token 获取内容 → token 用后即焚。

---

## 六、数据库设计

使用 **PostgreSQL** + **Prisma ORM**，三个数据模型：

### Book（书籍基本信息）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | Int (PK) | 自增主键 |
| name | String (unique) | 文件名 |
| data | String | 书籍文件在磁盘上的完整路径 |
| isFromLocal | Boolean | 是否来自本地上传 |
| isOnServer | Boolean | 是否存在于服务器 |
| processed | Boolean | 是否已完成预处理 |
| pageBreakOnTitle | Boolean | 是否在标题处分页 |
| isEastern | Boolean | 是否为东方语言（中日韩） |
| encoding | String | 字符编码 |
| size | Int | 文件大小（字节） |
| createdAt | DateTime | 入库时间 |

### ProcessedBook（预处理结果，1:1 关联 Book）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | Int (PK) | 自增主键 |
| bookId | Int (unique FK) | 关联 Book |
| name | String | 书名 |
| is_eastern_lan | Boolean | 东方语言标记 |
| bookAndAuthor | Json | 提取的书名/作者元数据 |
| title_page_line_number_offset | Int | 标题页行号偏移 |
| seal_rotate_en | String | 印章旋转参数 |
| seal_left | Float | 印章左边距 |
| footnote_processed_counter | Int | 脚注处理计数 |
| total_pages | Int | 总页数 |
| content_path | String | 预处理内容压缩文件路径 |
| processedAt | DateTime | 处理时间 |

### Font（字体信息）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | Int (PK) | 自增主键 |
| name | String (unique) | 字体名称 |
| data | String | 字体数据路径 |
| label_zh / label_en | String | 中英文标签 |
| en / zh | String | 中英文描述 |

**预处理内容存储**：预处理后生成 JSON（包含分页后的 HTML 行数组、章节目录、脚注、分页点），gzip 压缩后存入 `processed_books/{bookId}/content.json.gz`，数据库中仅存储元数据和文件路径。

---

## 七、WebSocket

使用 `ws` 库，与 HTTP 服务共用同一端口（8866）。

**当前用途**：在 `bookshelf.processLibrary()` 异步批量处理书籍时，通过 WebSocket 向前端实时推送每本书的处理状态：

```json
{ "type": "bookProcessingStatus", "name": "小说.txt", "status": "processing|processed|already_processed|error", "processed": true, "bookId": 1 }
```

前端 `client/app/modules/api/websocket-client.js` 负责接收并更新 UI。

---

## 八、与前端的关系

```
┌─────────────────────────────────────────────────────┐
│  浏览器（Chrome/Firefox 扩展 或 PWA）                 │
│  ┌──────────────────────────────────────────────┐   │
│  │  index.html (SPA)                             │   │
│  │  ├── reader.js       阅读器引擎               │   │
│  │  ├── bookshelf.js    本地书架（IndexedDB）     │   │
│  │  ├── server-connector.js   HTTP API 调用      │   │
│  │  └── websocket-client.js   WS 连接            │   │
│  └──────────────────────────────────────────────┘   │
│         │  HTTP :8866         │  WS :8866           │
└─────────┼─────────────────────┼─────────────────────┘
          │                     │
┌─────────▼─────────────────────▼─────────────────────┐
│  Express Server (server/app/app.js)                  │
│  ├── 静态文件服务 (项目根)                            │
│  ├── /api/* (健康检查 + 配置)                        │
│  ├── /api/library/* (书库存取)                       │
│  └── WebSocket (进度推送)                            │
│         │                                            │
│  ┌──────▼──────┐    ┌──────────────┐                │
│  │  PostgreSQL  │    │  文件系统     │                │
│  │  (Prisma)   │    │  books_one/  │                │
│  │  Book       │    │  uploads/    │                │
│  │  Processed- │    │  processed_  │                │
│  │  Book       │    │  books/      │                │
│  └─────────────┘    └──────────────┘                │
└─────────────────────────────────────────────────────┘
```

**关键设计点**：

1. **本地优先**：扩展直接读取 `file://` 协议的本地 TXT 文件，不经过服务器
2. **服务端书库补充**：服务器上的 `books_one/` 目录作为"云书库"，前端可通过 API 获取列表并下载阅读
3. **预处理卸载**：书籍章节识别、分页计算等 CPU 密集任务在服务端完成并缓存，前端直接使用结果
4. **前后端共享代码**：`shared/` 目录下的 `text-processor-core.js`、`pagination-calculator.js` 等核心算法被前后端同时引用

---

## 九、架构总结

| 维度 | 评估 |
|---|---|
| **定位** | 本地单实例 Web 服务，为浏览器扩展/PWA 提供书库管理和书籍预处理能力 |
| **框架** | Express.js + Prisma + PostgreSQL + WebSocket |
| **API 设计** | RESTful 风格，Token 防重放，Session 认证 |
| **安全** | 路径消毒、CSP、HSTS、一次性 Token、Session 绑定 |
| **数据处理** | 流式传输大文件、gzip 压缩预处理结果、并发控制（CPU 核数 - 1） |
| **前后端耦合** | 通过 `shared/` 共享核心算法，防止逻辑分裂 |
| **运行要求** | Node.js + PostgreSQL（需先迁移 Prisma schema）+ `books_one/` 目录放 TXT 文件 |

> **一句话**：SimpleTextReader 后端是一个 Express + Prisma + WebSocket 的本地书库服务，负责托管前端静态文件、管理 TXT 书库、预处理书籍内容、实时推送处理进度，并通过 shared 层与前端共享核心文本处理逻辑。
*（内容由AI生成，仅供参考）*
