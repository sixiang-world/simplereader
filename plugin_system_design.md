---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 1b15fa6152c39e6cbe05d76c27235a71_08cfbb13725111f1986d525400d9a7a1
    ReservedCode1: U1Wxe7XaP3BPCIDmGtsewo33Qgq4ZIEsBmZZ4GDbRfAymXLF3xfBpwPqwlHwKzFOILIJGH5d+Q7FgBI/ZUPAnDA8a9ZMcJeBhCaPTPj/26Gzi1QbZHVj/96eOaROUGWkr2vZ6r/7H0zb2vybdqLdDFZ930gdfeCRrrVtMNO5YbeYUeQPQ8QXa5zGcXo=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 1b15fa6152c39e6cbe05d76c27235a71_08cfbb13725111f1986d525400d9a7a1
    ReservedCode2: U1Wxe7XaP3BPCIDmGtsewo33Qgq4ZIEsBmZZ4GDbRfAymXLF3xfBpwPqwlHwKzFOILIJGH5d+Q7FgBI/ZUPAnDA8a9ZMcJeBhCaPTPj/26Gzi1QbZHVj/96eOaROUGWkr2vZ6r/7H0zb2vybdqLdDFZ930gdfeCRrrVtMNO5YbeYUeQPQ8QXa5zGcXo=
---

# 方向九展开：插件/扩展系统深度设计方案

> 基于 SimpleTextReader v1.6.12 项目实际架构的插件系统设计。

---

## 一、为什么这个项目天然适合插件化

在展开设计之前，先盘点项目已有的、可直接充当插件基础设施的架构资产：

| 资产 | 位置 | 插件化价值 |
|---|---|---|
| **CallbackRegistry (`cbReg`)** | `shared/core/callback/callback-registry.js` | 全局事件总线，支持优先级、命名空间、异步管道、`once`、通配符触发。**可直接作为插件 Hook 系统内核，几乎零成本扩展** |
| **ES Module 无打包器架构** | `client/app/` | 天然支持动态 `import()`，插件就是一个远程 ES 模块 URL，无需构建工具链 |
| **模块化目录结构** | `modules/` 下按职责划分子目录 | 插件可精确声明"我要挂载到哪个子系统" |
| **Settings 工厂模式** | `helpers-settings.js` 的 `createRangeItem/createCheckboxItem` 等 | 插件可通过统一 API 注入设置面板 UI |
| **Web Worker 基础设施** | `file-processor-worker.js`、`db-worker.js` | 计算密集型插件可安全卸载到 Worker 线程 |
| **Express 中间件栈** | `server/app/middleware/` | 服务端插件可直接注册路由和中间件 |
| **CSS Variables 体系** | `client/css/variables.css` | 插件主题/样式可通过覆盖 CSS 变量注入，无需写选择器大战 |
| **Prisma Schema** | `server/prisma/schema.prisma` | 插件数据模型可扩展 |

**核心结论**：SimpleTextReader 已经有一半的插件基础设施。`cbReg` 这个通用的发布/订阅系统是项目的"隐形脊柱"——它支持同步/异步管道、优先级排序、命名空间隔离、通配符触发、trace 调试，这几乎就是一个插件 Hook 系统的完整内核。插件化的工作主要是"填上剩下那一半"：插件发现/加载、清单规范、沙箱隔离、UI 注入点。

---

## 二、插件架构设计思路

### 2.1 总体原则

```
"插件是一个自描述的 ES 模块，通过声明式清单注册到 cbReg 的命名空间下，
  核心系统对插件完全透明——所有通信走事件总线，所有 UI 走注入 API。"
```

不引入 iframe 沙箱（当前阶段没必要），不引入 Service Worker 代理（与现有 Worker 架构冲突），不做全量动态特性（`eval` 安全红线）。

### 2.2 架构分层

```
┌─────────────────────────────────────────────────────┐
│                    插件市场 (远期)                     │
├─────────────────────────────────────────────────────┤
│                 PluginManager (管理器)                 │
│    ┌──────────┐  ┌────────────┐  ┌───────────────┐  │
│    │ 清单解析  │  │ 生命周期调度 │  │ 依赖/冲突检测  │  │
│    └──────────┘  └────────────┘  └───────────────┘  │
├─────────────────────────────────────────────────────┤
│              PluginRegistry (注册表)                  │
│      基于 cbReg namespace="plugins/xxx"               │
├─────────────────────────────────────────────────────┤
│    Hook API (cbReg)    │    Inject API (DOM/UI)      │
├─────────────────────────────────────────────────────┤
│                    核心系统                            │
│   FileHandler │ TextProcessor │ Reader │ Bookshelf   │
│            Settings │ Server Routes │ DB             │
└─────────────────────────────────────────────────────┘
```

三层：
- **Hook API 层**：直接复用 `cbReg`，只约定 Hook 名称规范，不改造内核
- **Inject API 层**：暴露受控的 UI 注入函数（设置项注册、CSS 注入、工具栏按钮等）
- **PluginManager 层**：负责插件发现、清单校验、加载/激活/停用、依赖拓扑排序

---

## 三、插件能扩展的能力范围（具体模块分析）

基于对项目 `modules/` 的逐目录分析，以下是可被插件化的模块及其扩展点：

### 3.1 文件处理管线 — `modules/file/` + `shared/core/file/`

**现状**：`FileHandler.handleMultipleFiles()` 接收文件 → 判断 TXT/EPUB → 分发到 `FileProcessor`（TXT）或 `EpubConverter`（EPUB）→ 输出统一结构。

**插件化扩展点**：

| Hook 点 | 触发时机 | 插件能做什么 |
|---|---|---|
| `file:beforeProcess` | 文件拖入/选中后，进入处理前 | 拦截特定格式、修改文件名、注入元数据 |
| `file:formatDetect` | 编码检测后，决定走 TXT 还是 EPUB 管线前 | **新增格式支持**（如注册 MOBI/PDF 解析器） |
| `file:afterProcess` | 文件处理完成，获得 `FILE_CONTENT_CHUNKS` + `ALL_TITLES` | 对已解析内容做后处理（如敏感词过滤、简繁转换、排版优化） |
| `file:beforeSaveToBookshelf` | 书籍即将写入 IndexedDB 书架 | 注入自定义封面、补充元数据字段 |

**示例**：MOBI 格式插件只需在 `file:formatDetect` 注册高优先级回调，当检测到 `.mobi` 后缀时接管处理，返回与 EPUB 管线相同的数据结构。

### 3.2 文本处理管线 — `modules/text/` + `shared/core/text/`

**现状**：`TextProcessorCore` 提供静态方法链：编码检测 → 标题正则匹配 → 脚注提取 → 广告过滤 → 分页计算。

**插件化扩展点**：

| Hook 点 | 触发时机 | 插件能做什么 |
|---|---|---|
| `text:titleDetect` | 每行文本判断是否为标题时 | 注入自定义标题识别规则（如 Markdown `#` 语法、特定网站爬取的格式） |
| `text:footnoteDetect` | 脚注正则匹配时 | 扩展脚注格式支持（如 `[1]` 学术引用风格） |
| `text:adsFilter` | 广告规则应用前 | 注入站点专属广告过滤规则 |
| `text:afterPagination` | 分页计算完成后 | 重新编排页序、插入插件内容页（如"本章 AI 总结"） |

**关键**：`REGEX_RULES` 在 `shared/core/text/regex-rules.js` 中定义，插件通过 `text:titleDetect` 等 Hook 动态追加规则，而非修改核心文件。

### 3.3 阅读器 UI — `modules/features/reader.js`

**现状**：掌管目录生成、翻页、进度追踪、全文搜索（`search.js`）、快速跳转（`go-line.js`）、脚注浮窗。

**插件化扩展点**：

| Hook 点 | 触发时机 | 插件能做什么 |
|---|---|---|
| `reader:toolbarRender` | 阅读器工具栏渲染时 | 注入新按钮（如"AI 总结本章"、"导出为 Markdown"） |
| `reader:pageRender` | 每页内容渲染到 DOM 后 | 注入内联组件（如生词注释、人物标签） |
| `reader:searchQuery` | 全文搜索执行时 | 替代搜索引擎（如接入 Elasticsearch 级别索引） |
| `reader:progressChange` | 阅读进度更新时 | 上报阅读数据到外部服务 |
| `reader:TOCRender` | 目录侧边栏渲染时 | 扩展目录项（如添加"本章 AI 摘要"条目） |

### 3.4 设置系统 — `modules/features/settings.js`

**现状**：通过工厂函数 `createRangeItem` / `createCheckboxItem` / `createSelectorItem` 等构建设置面板 UI，数据存储在 `localStorage`，变更通过 `cbReg.go("settingsChanged", ...)` 广播。

**插件化扩展点**：

| Hook 点 | 触发时机 | 插件能做什么 |
|---|---|---|
| `settings:registerSection` | 设置面板初始化时 | 注册新的设置分区（如"AI 助手"分区） |
| `settings:registerItem` | 同分区内 | 注册新的设置项（开关、下拉、滑块、颜色选择器） |
| `settings:beforeApply` | 设置项变更、即将应用前 | 拦截/转换设置值 |
| `settings:afterApply` | 设置项变更已应用后 | 触发插件自定义逻辑 |

**关键**：设置系统已有完整的工厂模式，暴露一个 `registerSettingsSection(sectionName, items[])` 的 Inject API 即可让插件注入设置 UI，完全复用现有的 CSS 和交互逻辑。

### 3.5 书架系统 — `modules/features/bookshelf.js`

**现状**：IndexedDB 存储书籍元数据 + 封面生成 + 筛选/删除。

**插件化扩展点**：

| Hook 点 | 触发时机 | 插件能做什么 |
|---|---|---|
| `bookshelf:coverGenerate` | 封面生成时 | 接管封面生成逻辑（如用 AI 生成封面图） |
| `bookshelf:beforeDelete` | 书籍删除前 | 备份/同步删除操作 |
| `bookshelf:filterExtend` | 书架筛选栏构建时 | 新增筛选维度（如"按阅读进度"、"按标签"） |

### 3.6 服务端 — `server/app/`

**现状**：Express 路由（`api.js`、`library.js`）+ 中间件 + WebSocket + Prisma。

**插件化扩展点**：

| Hook 点 | 触发时机 | 插件能做什么 |
|---|---|---|
| `server:middleware` | Express 中间件注册阶段 | 注入认证、限流、日志中间件 |
| `server:route` | 路由注册阶段 | 新增 API 端点（如 `/api/plugins/xxx`） |
| `server:websocketMessage` | WebSocket 消息到达时 | 处理自定义消息类型 |
| `server:prismaExtend` | Prisma Client 初始化时 | 扩展数据模型 |

### 3.7 共享核心 — `shared/`

**现状**：`pagination-calculator.js`、`text-processor-core.js`、`regex-rules.js` 等跨客户端/服务端复用的纯逻辑模块。

**插件化扩展点**：

| Hook 点 | 触发时机 | 插件能做什么 |
|---|---|---|
| `core:paginationStrategy` | 分页策略选择时 | 注册新的分页算法（如按段落分页、按字数分页） |

---

## 四、插件加载/注册机制

### 4.1 插件清单规范（plugin.json / plugin-manifest）

```json
{
  "name": "simpletextreader-plugin-mobi",
  "version": "1.0.0",
  "type": "format",
  "description": "Add MOBI/AZW3 format support",
  "author": "community",
  "entry": "https://cdn.example.com/plugins/mobi-reader/v1.0.0/index.js",
  "permissions": ["file:formatDetect", "bookshelf:coverGenerate"],
  "dependencies": {
    "simpletextreader": ">=1.6.12"
  },
  "settings": [
    {
      "key": "mobi.enableImages",
      "type": "checkbox",
      "label": { "zh": "显示 MOBI 内嵌图片", "en": "Show embedded images in MOBI" },
      "default": true
    }
  ],
  "css": "https://cdn.example.com/plugins/mobi-reader/v1.0.0/style.css",
  "server": {
    "entry": "https://cdn.example.com/plugins/mobi-reader/v1.0.0/server.js",
    "routes": ["/api/plugins/mobi"]
  }
}
```

| 字段 | 说明 |
|---|---|
| `name` | 全局唯一标识，命名约定 `simpletextreader-plugin-<name>` |
| `type` | 插件类型：`format`（格式扩展）、`ui`（界面增强）、`tool`（工具）、`ai`（AI 集成）、`sync`（同步） |
| `entry` | 客户端入口 ES 模块 URL（支持相对路径和 CDN） |
| `permissions` | Hook 点白名单，未声明的 Hook 插件无法注册，控制安全边界 |
| `settings` | 声明式设置项定义，自动渲染到设置面板 |
| `css` | 插件专属样式表 |
| `server` | 服务端插件入口（可选），含路由声明 |
| `dependencies` | 语义化版本约束 |

### 4.2 PluginManager 实现要点

基于现有 `app.js` 的初始化时序，PluginManager 在 `initReader()` 和 `initSettings()` **之前**、DOM 就绪**之后**挂载：

```javascript
// PluginManager 核心伪代码（基于现有架构）
class PluginManager {
  #plugins = new Map();        // name → {manifest, module, status}
  #pendingLoads = new Map();   // 正在加载的插件

  async discover() {
    // 1. 扫描已知来源：内置插件目录、用户安装列表（localStorage）、远程注册表
    const manifests = [
      ...await this.#scanBuiltin(),
      ...await this.#scanUserInstalled(),
    ];
    return manifests;
  }

  async load(manifest) {
    // 2. 权限校验
    this.#validatePermissions(manifest);

    // 3. 动态 import() 加载 ES 模块
    const module = await import(manifest.entry);

    // 4. 调用模块的 install() 函数，传入 Hook API + Inject API
    await module.install({
      hooks: this.#createHooksProxy(manifest),  // 基于权限白名单代理 cbReg
      settings: this.#createSettingsProxy(manifest),
      css: this.#createCSSProxy(manifest),
      server: this.#createServerProxy(manifest),
    });

    // 5. 注入设置面板（如果声明了 settings）
    if (manifest.settings?.length) {
      this.#injectSettings(manifest);
    }

    // 6. 注入 CSS
    if (manifest.css) {
      this.#injectCSS(manifest);
    }

    this.#plugins.set(manifest.name, { manifest, module, status: 'active' });
    cbReg.go("plugin:activated", { name: manifest.name, version: manifest.version });
  }
}
```

### 4.3 插件生命周期

```
discover → validate → load → activate ──→ deactivate → unload
                ↓                   ↑        ↓
              reject            (runtime)  (用户手动)
```

| 阶段 | 触发 | 对应操作 |
|---|---|---|
| `discover` | PluginManager 初始化 | 扫描内置/已安装插件清单 |
| `validate` | 加载前 | 校验权限白名单、版本兼容性、依赖完整性 |
| `load` | 校验通过后 | `import()` 动态加载 ES 模块 |
| `activate` | 模块加载成功后 | 调用 `install(api)` → 注册 hooks/设置/CSS |
| `deactivate` | 用户禁用或运行中 | 调用 `uninstall()` → 注销 hooks/移除 UI → 模块引用置 null |
| `unload` | 用户卸载 | 彻底清理：移除设置项、localStorage、CSS、server routes |

---

## 五、插件与核心模块的通信方式

### 5.1 事件总线（cbReg）— 主通道

**这是整个插件通信的骨干**。cbReg 已经支持：

- **命名空间隔离**：插件注册时自动加上 `plugins/<name>/` 前缀命名空间
- **优先级**：插件可声明高优先级在核心逻辑前/后执行
- **异步管道**：支持 `chain: true`（管道模式，上一个回调的输出是下一个的输入）和 `chain: false`（并行模式）
- **错误隔离**：`stopOnError: false` + `onError` 确保单个插件崩溃不影响核心
- **一次性回调**：`once: true`，适用于"首次打开"类事件
- **通配符**：`wildcard: true`，插件可监听 `plugin:*` 获取其他插件动态

**插件如何使用 cbReg**：

```javascript
// 插件 install() 中的典型代码
export async function install({ hooks }) {
  // 注册到 file:formatDetect，优先级 50（高于默认 0）
  hooks.on("file:formatDetect", (fileInfo) => {
    if (fileInfo.name.endsWith(".mobi")) {
      return { ...fileInfo, format: "mobi", handler: "mobiReader" };
    }
    return fileInfo;  // 不关心其他格式，原样返回
  }, { priority: 50, namespace: "plugins/mobi-reader" });

  // 监听所有插件的激活事件
  hooks.on("plugin:*", (payload) => {
    console.log(`[mobi-reader] 检测到插件激活: ${payload.name}`);
  }, { wildcard: true, namespace: "plugins/mobi-reader" });
}
```

### 5.2 Inject API — 受控 UI 注入

插件不能直接操作 DOM（破坏性风险），必须通过受限的 Inject API：

```javascript
// Inject API 提供给插件的对象
const injectAPI = {
  settings: {
    // 注册设置分区 + 设置项，复用现有工厂函数
    registerSection(sectionName, items) { /* → cbReg.go("settings:registerSection") */ },
    registerItem(sectionName, item)    { /* → cbReg.go("settings:registerItem") */ },
  },
  toolbar: {
    // 在阅读器工具栏注册按钮
    registerButton({ id, icon, label, onClick, position }) { /* ... */ },
    unregisterButton(id) { /* ... */ },
  },
  reader: {
    // 在每页内容中注入内联元素
    injectInline({ selector, component, condition }) { /* ... */ },
  },
  css: {
    // 注入 CSS（自动添加 scope 防止泄漏）
    inject(cssString, scope) { /* ... */ },
  },
  storage: {
    // 插件专属 IndexedDB 命名空间（自动隔离，不可访问其他插件数据）
    get(key) { /* ... */ },
    set(key, value) { /* ... */ },
  },
};
```

### 5.3 服务端通信

服务端插件通过 Express Router 挂载：

```javascript
// 插件 server entry 示例
export function install(express, { hooks, config }) {
  const router = express.Router();
  router.get("/api/plugins/mobi/convert", async (req, res) => {
    // ...
  });
  return { router, cleanup: () => { /* 清理 */ } };
}
```

PluginManager 在服务端加载插件后，将返回的 `router` 挂载到主 Express app。

---

## 六、可参考的现有方案与设计模式

| 参考来源 | 借鉴点 | 对本项目的适用性 |
|---|---|---|
| **VS Code Extension API** | 声明式 `package.json` 清单 + `activationEvents` + `contributes` 扩展点 | 清单规范可直接模仿，`contributes` 映射到本项目的 Hook 点 |
| **WordPress Plugin API** | `add_action` / `add_filter` 的优先级 + 管道模型 | 本项目 `cbReg` 的 `priority` + `chain` 模式与此同构 |
| **Obsidian Plugin System** | ES 模块动态加载 + `onload`/`onunload` 生命周期 + 社区插件市场 | 纯前端阅读器场景与 Obsidian 高度相似：都是单页应用 + IndexedDB + 内容处理管线 |
| **Babel Plugin** | 访问者模式遍历 AST，插件声明对特定节点的处理 | 文本处理管线（逐行匹配标题/脚注/广告）天然适合访问者模式 |
| **本项目已有的 cbReg** | 全局实例、命名空间、优先级、管道、trace | **不要另起炉灶，直接基于 cbReg 构建 Hook 系统** |
| **本项目已有的 Settings 工厂** | `createCheckboxItem` 等声明式 API | 插件设置项直接复用，无需新 UI 框架 |

**最重要的参考就是 Obsidian**。Obsidian 同样是：
- 纯前端 Electron/Web 应用（本项目是浏览器 PWA）
- 插件即 ES 模块
- 通过 `registerView` / `addCommand` / `addSettingTab` 等受控 API 扩展
- 社区插件市场 + 手动安装双通道

TODO：Obsidian 有数百个成功插件案例可证明这个模式的可行性。

---

## 七、分阶段落地建议

### 阶段一：内核准备（1-2 周）

**目标**：把 cbReg 升级为正式的 Hook 系统，不改变现有代码行为。

**子任务**：
1. 梳理现有代码中所有 `cbReg.go()` 调用点，建立 **Hook 点目录文档**（约 15-20 个关键 Hook 点）
2. 为每个 Hook 点定义标准化的参数契约和返回值契约（TypeScript JSDoc 注释）
3. 在关键节点**新增缺失的 Hook 点**（如 `file:formatDetect`、`text:titleDetect` 当前不存在，需要埋点），埋入方式：在现有代码中增加一行 `cbReg.go("hookName", payload, { chain: true })`
4. 编写 `PluginManager` 最小可行实现：清单解析 + ES 模块加载 + `install()` 调用

**验收标准**：一个手动编写的 MOBI 检测插件能拦截 `file:formatDetect` 并返回 `format: "mobi"`。

### 阶段二：Inject API + 设置面板集成（2-3 周）

**目标**：插件可以拥有 UI 存在感。

**子任务**：
1. 实现 `registerSettingsSection` / `registerSettingsItem`，在 `settings.js` 的渲染阶段调用
2. 实现 `registerToolbarButton`，在 `reader.js` 的工具栏渲染阶段调用
3. 实现 CSS 注入（scoped `<style>` 标签，自动加 `[data-plugin="xxx"]` 属性选择器作用域）
4. 实现插件专属 IndexedDB Storage（基于 `db-manager.js` 的命名空间隔离）
5. 编写 2-3 个示例插件：Hello World、阅读计时器、自定义主题

**验收标准**：阅读计时器插件能在工具栏显示计时器按钮，点击弹出浮窗，数据持久化到 IndexedDB。

### 阶段三：安全 + 管理界面（2 周）

**目标**：用户可以安装/启用/禁用/卸载插件，系统有基本安全边界。

**子任务**：
1. 实现插件管理面板（独立 HTML 页或设置面板内的分区），支持：浏览已安装、启用/禁用开关、卸载按钮、从 URL 安装
2. 权限系统落地：`permissions` 白名单在 `register` 时校验，未声明 Hook 点拒绝注册
3. 错误隔离：插件 `install()` 包裹 try/catch，单个插件崩溃不阻塞后续插件加载，错误上报到 console + 管理面板
4. 版本兼容检查：`dependencies.simpletextreader` 语义化版本校验

**验收标准**：用户在管理面板中看到一个列表，每行有开关和卸载按钮，禁用插件后其设置项和按钮立即消失。

### 阶段四：服务端插件 + 社区生态（长期）

**目标**：插件可以扩展到服务端，有社区分发渠道。

**子任务**：
1. 服务端 PluginManager 实现（基于 Express Router 动态挂载）
2. 插件市场静态站点（GitHub Pages 即可）：插件清单索引 + 搜索
3. `plugins/` 目录规范 + npm 发布指南
4. 社区贡献模板仓库（`simpletextreader-plugin-template`）

---

## 八、风险与边界

| 风险 | 缓解措施 |
|---|---|
| 插件导致主线程卡顿 | 鼓励计算密集型插件使用 Web Worker（复用 `file-processor-worker.js` 模式）；PluginManager 监控 `install()` 耗时，超时告警 |
| 插件间冲突（同一 Hook 点争抢） | cbReg 的 `priority` 天然支持排序；Hook 点文档写明"互斥"标记 |
| 恶意插件窃取阅读数据 | `permissions` 白名单机制；未来可加 Content Security Policy 限制插件模块来源 |
| 插件过多导致启动变慢 | 延迟加载：非 `format` 类插件在首次需要时才 `import()`；管理面板显示启动耗时 |
| 核心 API 变更破坏插件兼容性 | Hook 点契约遵循语义化版本；`dependencies` 字段约束；deprecation 警告期不少于一个大版本 |

**明确不做的**：
- 不引入 `eval()` / `new Function()` 执行插件代码（用 `import()` 替代）
- 不给插件直接 DOM 访问权（必须走 Inject API）
- 不让插件修改核心源码文件（唯一例外是 `REGEX_RULES` 通过 Hook 动态追加）
- 第一阶段不做插件市场，手动 URL 安装即可验证架构可行性
*（内容由AI生成，仅供参考）*
