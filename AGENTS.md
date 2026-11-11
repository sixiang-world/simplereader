# Repository Guidelines

SimpleTextReader（易笺）是用 Vite 和原生 ES modules 构建的 Web TXT/EPUB 阅读器。当前版本以 `version.json` 为准。查阅 [技术审查](docs/DEV-TECHNICAL-AUDIT-2026-11-11.md) 和 [实施记录](docs/DEV-REFACTOR-PLAN-2026-11-11.md) 了解重构依据与开放问题。

## 开发与验证

- Node 22+、pnpm 9.12.0、Python 3。`pnpm run validate` 执行 lint、基础和增量 checkJs、build、Node、真实浏览器、Python 回归。Windows 需要 Git 的 sh 在 PATH；`CHROMIUM_EXECUTABLE_PATH` 可指定 Chrome。
- 测试文件自动发现；不要维护过时的固定文件数量。Firefox 缺失时明确 UNVERIFIED。扩展、Docker 实际构建、EdgeOne 和移动端测试不能由 Web 回归代替。
- 迁移、缓存及异步切书改动用真实浏览器验证。浏览器回归使用隔离资料。
- 保留用户已有的工作树和暂存区改动。

## 当前功能与边界

- Web 是主线发布目标。旧扩展打包和 test:extension 保留供兼容排查，不作为当前发行承诺。
- TXT 一次 Worker 完整解析后挂载；不恢复先解析 1 MiB、再全量解析的快开路径。
- 统一分页渲染；滚轮翻页仍可用，实验性自动拼接已移除。日志保持物理行、空白和缩进，每页最多 500 行，不进行繁简转换。
- 配置通过本地 JSON 导入导出，校验 schema、格式及文件大小；textdb 同步已退役，旧 token 和远端数据不主动删除。排版预设和分享 URL 保留。
- 繁简只用离线 OpenCC（本地 UMD 懒加载）；唯一偏好 `t2s_enabled`。旧 lite/pro 存储和 URL 入口兼容迁移；失败显示原文。开关变更后重开书籍生效。
- 封面使用真实图片或 DOM 回退；Canvas 双渲染、封面动画、自定义光标已移除。
- Vite 默认构建不扫描或打包 books/。preprocess-books 是显式离线兼容工具，不是部署生命周期。

## 数据与生命周期约定

- `modules/file/book-identity.js` 为新 File 分配独立随机 book ID。IndexedDB 仍用历史 `name` keyPath，但新记录该字段存 ID，`displayName` 存文件名。相同文件再次导入会新增副本，不隐式去重或覆盖。
- 旧记录保留原键和原 File；旧派生缓存按 BOOK_CACHE_VERSION 校验，首次打开重建。不批量删库、不以解析失败删除原书。
- `core/book-progress.js` 隔离进度命名空间。旧文件名进度只用于对应旧书；清除写入标记，禁止从遗留键再次恢复。设置和字体不属于书籍清除范围。
- `modules/file/book-data.js` 定义原文快照与恢复字段，繁简仅转换副本；保存成功以数据库事务 commit 为准。
- FileHandler.beginLoad 在入口分配 AbortSignal；每个异步交接检查归属。取消不得回退重解析、删除原件或把旧状态提交到新书。
- Worker RPC 保留 ID、超时、取消和明确 dispose；图片对象 URL 按会话复用并在 reset 释放。

## 模块地图

- `client/src/app.js`：初始化；`config/`：默认值、运行时变量、DOM 和设置 schema。
- `modules/settings/settings.js`：公开状态 facade；`settings-menu.js`：菜单 DOM；`core/setting-values.js`：纯值校验；`core/settings-file.js`：配置文件契约。
- `modules/bookshelf/bookshelf.js`：UI facade；`bookshelf-db.js`：数据存取及轻量元数据。render 不读取整书做迁移。
- `modules/file/`：打开会话、TXT Worker、BookData、身份；`modules/epub/epub-converter.js`：EPUB 结构转换。
- `modules/reader/`：分页、搜索、跳转、脚注；renderer 通过 reader-title-navigation 事件导航，不反向 import reader。
- `shared/core/file/epub-*.js`：路径、DOM、解压预算、分页；`shared/core/text/`：文本规则和分页累计索引。
- `shared` 尚未完全纯化：TextProcessorCore 仍反向依赖 client 配置。不要声称依赖图已完成收敛。
- cbReg 现实现可串联返回值并传播错误，不只是通知。hooks 仍用于显示转换；后续可进一步收敛关键保存路径。

## UI、构建与安全

- 中英文文案集中在 `client/src/styles/variables.css`。修改标签时同步更新两种语言及 `[data-lang]` 映射。操作按钮需有可访问名称，并在语言切换后更新。
- 第三方 classic scripts 仍保留，Worker 动态依赖通过 Vite postbuild 拷贝；后续依赖图收敛尚未完成。
- 保留 EPUB ZIP 预算、资源路径规范化、渲染白名单和可终止的搜索 regex Worker。
- 不引入无必要框架，不一次重写分页算法。章节识别全对全、完整资源 ID 模型、EPUB 主线程解析与统一 XML 预算仍是开放项。

## 版本与发布

- 同步 `version.json`、`package.json`、`package-lock.json` 根版本和 Chrome / Firefox manifest。为新版添加中英文更新记录与 `CHANGELOG.md` 条目。
- 发布前运行 `pnpm run validate`，确保生成的 `dist/version.json` 与源码一致。扩展脚本中的 `--version` 仅影响生成产物。
- 依据 `git remote -v` 和远端实际引用确认目标。CNB 的 `dev` 推送触发预发，`main` 推送触发生产部署。Git 标签、GitHub Release 和站点部署分别核验。
