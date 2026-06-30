# Changelog

All notable changes to this project will be documented in this file.

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
