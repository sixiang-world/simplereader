# Changelog

All notable changes to this project will be documented in this file.

---

## [2.3.0] — 2026-09-04

### 新增
- **EPUB 图片还原** — EPUB 内图片以 base64 data URL 内联渲染（PNG/JPEG/GIF/SVG/WebP/AVIF/BMP），支持独立图、figure+figcaption、段落内嵌图；外部图片 URL 因隐私保护不加载（`74380b8`）
- **EPUB 图片分页精确化** — 图片触发断页时断点前移到图片之前，避免图片被拦腰截断；超大图 max-height:80vh 按比例缩放（`593c8f4`）
- **EPUB 缺失图片容错** — 无法内联的图片显示虚线框占位符（含 alt 文本），不再静默丢失（`593c8f4`）
- **EPUB 样式保真** — 保留受控内联样式（text-align/text-indent/font-style/font-weight/margin），值级正则校验防 CSS 注入（`537a009`）
- **EPUB 脚注还原** — 识别 epub:type="footnote" 脚注与 noteref 引用链接，悬停显示脚注弹窗（`537a009`、`4d300b1`）
- **EPUB 跨章节链接** — 行内内部链接（#fragment / chapter.xhtml#sec）可点击跳转到对应章节位置（`4d300b1`）
- **EPUB 内联 SVG** — 内联 <svg> 序列化为沙箱 data URL 渲染（浏览器强制禁用脚本），超大 SVG 降级占位（`280dd11`）

### 修复
- 列表项 `<li>` 中图片被静默丢弃（`a6901ee`）
- 纯图片段落 `<p><img/></p>` 图片丢失（`a6901ee`）
- figure 中多个 img 只保留最后一个（`a6901ee`）
- `<picture>` 元素中图片完全丢失（`814251d`）
- manifest MIME 按 basename 匹配导致同名不同目录图片类型错误（`814251d`）
- T2S 对图片块 base64 全量转换（`814251d`）
- 搜索功能误匹配 base64 data URL 内容（`814251d`）
- 线性搜索前移断点后图片 charCount 欠计数（`d660981`）
- jump search 缺少短末页校验（`d660981`）
- CI workflow 步骤顺序错误导致 8 秒失败（`2995227`）

### 工程
- 新增 25 项 EPUB 图片单元测试（`test-epub-images.mjs`）
- EPUB_CONVERTER_VERSION 1→2→3（缓存失效）
- 多轮独立代码审查与 Bug 修复闭环

## [2.2.0] — 2026-09-02

### 新增
- **EPUB 排版保真** — 列表（项目符号 / 编号 / 嵌套）、引用块、预格式化与代码块空白、表格结构均按原书保留，不再退化为纯文本
- **EPUB 元数据提取** — 读取出版社、出版日期、语言、简介与封面（`4c870ae`）
- **EPUB 转换进度 UI** — 转换期间显示进度，大型书籍不再表现为界面无响应（`7391d50`）
- **EPUB 转换缓存** — 结果缓存，再次打开同一本书无需重新解析（`2860370`）
- **EPUB 生成封面页与结束页** — 缺失时自动生成（`f9ba927`）
- **EPUB 段落 HTML 安全渲染** — 引入 `source` 标志区分来源，EPUB 走受限 HTML 渲染、TXT 仍保持转义（`2c5ad8c`、`8f2ff47`）

### 变更
- **EPUB 分页改用 `PaginationCalculator`** — 替换原先硬编码的每页 100 行（`8631db3`）
- **EPUB 文件大小限制** — 超出限制时明确提示（`4013e41`）
- **工程工具链** — 引入 ESLint + Prettier，配置为非阻塞（`7a97c8f`）
- **CI** — 新增 EdgeOne Pages 部署工作流与 dev 分支自动同步 GitHub 镜像；重构流水线触发与权限配置；`pnpm install` 改用 corepack prepare（`359813b`、`e4773e0`、`a87edfb`、`130aa7d`、`16d8d1c`）

### 修复
- **EPUB 目录锚点** — 保留 TOC fragment 锚点，收紧 EPUB3 nav 检测（`024fa1a`）
- **EPUB 链接净化** — 净化解析后的 href，限制允许的内联属性（`5c0ce9a`）
- **EPUB 缺失文件** — 报告缺失 spine 文件并允许非 HTML fallback 项；改进缺失文件提示与标题渲染（`1d6e427`、`ac28c1f`）
- **EPUB 误识别** — 错名 `.epub` 在降级为 TXT 前先校验文本特征（`ea95976`）；超大 EPUB 的大小限制原因不再被重复通知覆盖（`31fd0fd`）；合成标题页插入后同步平移 `spineBreaks`（`642d2b8`）
- **EPUB 排版设置** — 段落间距与首行缩进对 EPUB 正文正确生效（`04da676`）
- **PWA icon 404 与 `fzskbxk` 字体加载警告**（`1089db4`）
- **安全：XSS** — 修复换行混淆 href 绕过黑名单（`3b2e627`）；中和 `TextProcessorDOM` 内容渲染中的 XSS（`00c93b1`）
- **分页崩溃** — `#handleLongChapters` 在非标题分页点崩溃（`e849e0f`）
- **`formatBytes_simple`** — 保留 `decimals` 参数并对非有限数值回退（`4e7fc1c`）

### 测试
- 新增 `test-epub-converter.mjs`（353 行）与 `test-epub-rendering.mjs`（227 行），覆盖 EPUB 转换与渲染
- `test-base-submodules.mjs` 补充 `formatBytes_simple` 导出断言

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
