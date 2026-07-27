# Changelog

All notable changes to this project will be documented in this file.

---

## [2.1.0] — 2026-07-27

### 新增
- **配置同步手动按需模式** — 设置面板新增「拉取 / 推送」按钮，显式触发同步；移除启动自动拉取、周期轮询与保存时自动推送
- **同步令牌 UI** — 令牌格式校验（字母 / 数字 / 下划线，4–64 位）+ 拉取 / 推送状态反馈

### 变更
- **自动拼接重写** — 重构为仅累积的连续滚动（accumulate-only continuous scroll）
- **构建与部署加固** — Vite 产物文件名加入内容哈希；依赖统一使用 pnpm（移除 `package-lock.json`）；Docker 改用 Caddy 静态服务并移除失效的 `:8866` 端口
- **OpenCC 本地化** — `client/lib/opencc/full.js` 改为安装时由 `opencc-js` 依赖生成本地副本（不再提交二进制；零运行时网络依赖）

### 修复
- **正则越界** — 广告过滤规则中对书名 / 作者中的正则元字符进行转义

### ⚠️ 升级注意
- **同步数据格式为 v2（字段级时间戳），与 1.x 客户端不兼容** — 多设备请统一升级到 ≥2.0.0，旧客户端读取 v2 数据会失败
- **v1 → v2 破坏性变更** — 服务端已归档（`archive/server/`），镜像从 Node+Express+Prisma 后端变为 Caddy 静态前端；旧版书架数据与登录体系不再可用。详见 README「v1 → v2 迁移说明」

---

## [2.0.1] — 2026-07-01

### 修复
- **T2S Pro 模式设置互斥竞态条件** — `SETTINGS_SCHEMA` 中 `t2s_lite` 排在 `t2s_pro` 之前，导致 `saveSettings()` 遍历时 `t2s_lite` 的 `onApply` 在 `t2s_pro` 持久化之前将其覆盖。新增 `mutualExclusiveWith` 声明式互斥机制 + 预处理阶段自动同步 DOM 状态
- **OpenCC CDN 被浏览器跟踪防护拦截** — Edge/Chromium 的 Tracking Prevention 阻止 jsDelivr CDN 请求。下载 `opencc-js@1.3.2` UMD bundle（~1.15MB）至 `client/lib/opencc/full.js`，切换为本地静态加载，完全消除第三方网络依赖
- **T2S 渲染时序：转换在内容显示之后才执行** — 三个文件打开路径均存在 `showContent()`/`reader.showCurrentPageContent()` 在 T2S Hook 之前调用的问题，用户首次打开书籍看到的是未转换的繁体文本，需要刷新才能看到简体。修复后 Hook 在四个关键点均先于渲染执行（初始块、剩余内容合并、书架重开、EPUB 打开）
- **T2S 剩余内容工作线程覆盖已转换数据** — 大文件处理时，剩余内容工作线程返回后 `CONFIG.VARS.FILE_CONTENT_CHUNKS` 被原始数据覆盖，触发 UI 重渲染显示繁体

### 变更
- **OpenCC 从 CDN 迁移至本地** — `t2s-opencc.js` 移除动态 `import()` 路径和 CDN URL，简化为纯 `<script>` 标签注入本地文件，消除 CDN 可用性、CSP、Tracking Prevention 等外部依赖风险

### 测试
- `test-opencc-cdn.mjs` 从 CDN URL 验证重写为本地文件完整性验证（文件存在、大小 ≥500KB、包含 OpenCC 全局赋值）
- `test-t2s.mjs` 核心 19 个繁简转换测试持续通过

---

## [2.0.0] — 2026-06-30

### 新增
- **繁简转换 (T2S)** — 内置 OpenCC 繁简映射表 2928 对，支持轻型模式（本地映射表，零网络）和重型模式（OpenCC JS 完整版 CDN，覆盖全部异体字）
- **排版预设系统** — 6 种内置预设（默认/阅读/简洁/护眼/杂志/代码），支持 URL 参数 `?scheme=0/1/Name` 切换，先预设后 URL 参数叠加
- **构建预分页** — 构建时自动对 `books/` 目录下的 EPUB/TXT 执行预分页，输出结构化 JSON，浏览器端零开销加载
- **配置同步** — 跨设备配置同步引擎：`pullOnBoot` 非阻塞加载、`mergeSyncedConfig` 自动过滤未知键、`_userInteracted` 防护防止覆盖用户本地修改
- **生产构建优化** — Vite 构建自动将 Worker 依赖复制到 `dist/`，修复 CSS 路径回退和 Worker URL 解析

### 修复
- OpenCC CDN URL 指向 `opencc-js@1.1.7`（HTTP 200 验证通过）
- 锬 等占位映射仅保留 1 个（錟→锬），其余 2927 对均为有效映射
- Auto-detect 模式下正确处理 `processedLines` 对象行的采样和转换
- EPUB 预分页兼容 Node.js（添加 `linkedom` DOMParser polyfill）
- settings 对象从 `settings.js` 模块正确导出
- 配置同步引擎消除未知键反馈回路
- 多轮/重型 T2S 模式下 `getSheet("t2s")` 返回 null 的生产构建回退
- 排版预设键名匹配 schema（`infinite_scroll_mode` 等）

### 测试
- 新增 T2S 转换单元测试 39 个用例，覆盖常见繁体字和边界场景
- 新增排版预设单元测试 36 个用例，覆盖预设工厂、URL 参数覆盖
- 新增预分页单元测试 9 个用例，覆盖 EPUB/TXT 产出格式
- 新增配置同步单元测试 38 个用例
- 新增 Worker 构建解析测试 9 个用例
- 全量测试 285 个断言，11 个测试文件，100% 通过

---

## [1.7.0] — 2026-06-29

### 新增
- **URL 设置覆盖** — 通过 URL query 参数（如 `?light_mainColor_active=%23314874&show_helper_btn=0`）临时覆盖任意设置，不写入 localStorage。支持所有设置类型：checkbox、range、color、select
- **分享配置 URL** — 设置菜单「常规」标签页新增「分享配置」区块，一键复制当前配置的 URL 链接，支持分享给他人或给自己换设备使用
- **CI 自动测试** — 新增 GitHub Actions workflow，push/PR 自动运行单元测试

### 修复
- checkbox URL 参数解析：`0`/`no`/`off` 正确解析为 `false`（此前为 truthy 字符串）
- `ui_language=auto` 语义在 URL 覆盖后保留，分享链路上不丢失
- URL 覆盖后隐藏设置（如 `light_mainColor_inactive`）重新计算派生值
- 颜色/范围/下拉选择 URL 参数经过 schema 校验，拒绝非法值
- 分享 URL 复制按钮在设置菜单内切换语言时实时刷新标签
- 复制按钮快速连点不再卡在「✓ 已复制」状态
- 分享 URL 保留原始 URL 中的 hash 和非设置参数（如 `?book=xxx`）
- 生成 URL 跳过隐藏设置、优化 O(n²) 查找为 O(n)
- 设置菜单关闭时不再刷新分享 URL

### 测试
- 新增 `parseURLSettings` 单元测试 39 个用例，覆盖所有类型分支（checkbox/range/color/select/hidden/边界）
- 新增 `refreshShareButtonLabels` 单元测试 6 个用例
- 测试代码从生产模块直接导入，非 copy-paste

---

## [1.6.12] — 2026-06-29

### 新增
- 匿名模式标识、警告文案优化
