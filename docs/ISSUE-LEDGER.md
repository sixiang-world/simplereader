# 遗留问题台账（Issue Ledger）

本文件是原始 dev 技术审查（问题编号 T00—T23）与后续维护计划的统一台账。
`docs/REFACTOR_PROGRESS.md` 记录各任务实施过程；本表记录每项的**最终去向**，
供后续开发与发布判定使用，不再依赖任何会话临时目录。

状态定义：

- **已修复**：实现已合入 dev，对应 Node/浏览器回归在本机通过并有提交快照。
- **受外部条件阻塞**：代码与协议测试完成，真实平台验收被外部条件（企业策略、
  无真实设备等）阻止，不能标记为通过。
- **明确暂缓**：有记录的、有意不做或等待前置条件的限制。
- **待验证**：实现存在但缺少计划要求的补充证据。
- **待开发**：已确认缺口，尚未实现。

历史说明：2026-10-25 fork 历史恢复后，用户提交哈希已更换（上游 118 个提交恢复
原哈希）。本表引用的是恢复后 dev 上的新哈希；旧哈希对照见仓库记忆中的
reparent-map。基线 d7d4e5d（上游原哈希）为审查起点。

## 一、原始审查 T00—T23 去向

| 编号 | 领域 | dev 提交 | 状态 | 证据与剩余边界 |
|---|---|---|---|---|
| T00 | 测试自动发现、Chromium 回归入口、启动资源检查 | 9f160b2 | 已修复 | `pnpm run test` / `validate.sh`；生产根/子路径启动检查在浏览器回归中 |
| T01 | 不可信标题/通知纯文本渲染 | 5c85110 | 已修复 | 事件属性 img 负例回归；后续书架卡片/信息菜单文件名插值补充修复见 1b1f755 |
| T02 | 语言元数据不擦缓存（存储一致性任务内） | 6a6b84f | 已修复 | 存储浏览器回归（分块/回滚/原书保护） |
| T03 | Worker 请求 ID/错误/超时/取消/销毁（文件 + DB） | 78b9f41（文件）、6a6b84f（DB） | 已修复 | Node 故障矩阵 + 真实 Worker 处理/取消回归 |
| T04 | Worker URL 保留生产子目录前缀 | 95a14f5 | 已修复 | 7 项真实解析函数检查 + 生产根/子目录往返 |
| T05 | Docker 基础构建（工具复制、Node22、Caddy 静态） | 3a20180 | 已修复 | 真实镜像构建 + Caddy 容器冒烟（docs/DOCKER_BUILD.md、test/docker-smoke.py） |
| T06 | BookData 统一装载/恢复/reset 合约 | e9b56a9 | 已修复 | converter 缓存升 4；新导入/重开/切书取消浏览器回归 |
| T07 | 字体 load 后注册/回收 URL | 6a6b84f | 已修复 | 字体浏览器回归 |
| T08 | 书架启停清理监听 | 6a6b84f | 已修复 | 存储浏览器回归 |
| T09 | 跨 store 写以事务 commit 应答 | 6a6b84f | 已修复 | 分块/故障回滚浏览器回归 |
| T10 | EPUB 资源编码 URI、脚注/链接采集 | 809fbac | 已修复 | 真实 ZIP Node 回归 + 多页预处理 |
| T11 | canonical 跨章/本章链接、脚注定位 | 8d6d559 | 已修复 | 10 项真实 UI 浏览器回归；flow 几何二分 |
| T12 | EPUB→TXT 结构转换预算与取消 | 809fbac | 已修复 | 解压流/节点/深度/行数预算；超限显式失败 |
| T13 | TOC RAF/监听器释放、导航后高亮清理 | 8d6d559 | 已修复 | 阅读器 UI 浏览器回归 |
| T14 | EPUB 日志保真、最终索引 | 809fbac | 已修复 | Node 产物回归 |
| T15 | schema 解析与纯状态过渡 | a25ecb0 | 已修复 | test-settings-state-regressions 等 |
| T16 | 同步顺序 GET 合并推送 | a25ecb0 | 已修复（有限证） | 无 CAS 后端，同时写仍可能丢更新——见 docs/config-sync-contract.md；剩余动作 → 本表 B05 |
| T17 | canonical 语言（含最早启动） | a25ecb0 | 已修复 | 刷新语言浏览器回归；首次快照发现的 UILang 遗漏已补 |
| T18 | 字体不阻塞启动/合帧通知 | a25ecb0 | 已修复 | 慢字体永久 pending 浏览器回归 |
| T19 | 性能（有依据部分） | 90e8f7b、8d6d559（flow 几何） | 已修复（部分） | 书架轻量元数据、10k 节点 ~15 次几何读取；**未做**：flow DOM 裁剪（→ C02）、TXT 流式（→ C03）——见 docs/PERFORMANCE_BASELINE.md |
| T20 | 缓存头、OpenCC 字节同步、vendor 清单、checkJs 门禁 | 0894370 | 已修复 | validate 全绿；固定 URL 重新验证、hash assets immutable |
| T21 | 锁定依赖补丁 + 供应链 | 38d2299 | 已修复 | 两套 audit 0 公告（仅包管理器依赖；手工 vendor → D04 持续） |
| T22 | 扩展 claim/ACK/恢复、双平台打包 | f3b2f26 | **受外部条件阻塞** | 代码+协议/应用端测试+打包完成；Chrome 实机被 ExtensionInstallBlocklist 企业策略阻塞，Firefox 实机未验收。`npm run test:extension` 与 docs/EXTENSION_TESTING.md 保留为后续验收，不记通过 |
| T23 | SettingsMenu/BookshelfDB 拆分、渲染器→reader 导入环解除、共享纯模块 | 19c4814 | 已修复 | 38 Node + 11 浏览器回归；facade 保留 |

“实现完成”与“真实平台验收通过”是两个独立事实：T01—T21、T23 的本机回归通过
不等于实机扩展（T22）或 EdgeOne 真实平台（→ E02/E04）验收通过。

## 二、遗留开放项（按维护计划映射）

| 计划任务 | 事项 | 状态 | 说明 |
|---|---|---|---|
| B01 | 安全边界复核（EPUB 正文/脚注/链接/SVG/资源 URL、书架元数据、构建产物） | 已修复 | 全量 sink 审计（HTML/URL/CSS/选择器/协议）完成；发现并修复 2 个真缺口：TXT 脚注弹窗 XSS（lookup 原文直进 div.html()，已转义；负例双向验证）、EPUB 图片数量无独立预算（新增 maxImages=2000，含内联 data: URL 与 SVG）。sanitizeHtml/converter 属性白名单/搜索惰性 template/重复资源去重均复核无缺口。提交 4295252 |
| B02 | 色彩选择器及设置组件生命周期（ResizeObserver/IntersectionObserver/RAF 无 destroy） | 已修复 | 包装层模块级幂等注册 + `destroy()`；上游 0.12.0 无 teardown，打最小本地补丁（docs/vendor-inventory.md 本地补丁记录）；SettingsMenu.remove() 接线销毁，show/hide 复用不销毁。验证：test/browser-color-picker-lifecycle.mjs（真实监听脱离证据 + 20 次重建/销毁回基线） |
| B03 | 跨标签页、存储故障、旧数据兼容验收 | 已修复（一项平台限制） | 单标签故障矩阵（分块/回滚/晚到 abort/versionchange 释放/旧语言迁移/converter 旧缓存）沿用既有回归；新增真实双标签测试（test/browser-storage-multitab.mjs）：同名书并发保存/删除无可见半成品且事后重试可用；**平台事实**：当前 Chromium 强制关闭滞留连接（即使注册了 versionchange handler），跨标签阻塞升级在本平台不可复现——DBManager 保留防御性 onbounded 显式错误 + 10s 超时；removeAllBooks/removeAllFonts 实测调用且各只清自己的 store。提交 8004333 |
| B04 | Web 浏览器兼容矩阵 | 部分完成 | Chromium：13 个自动回归文件（validate 门禁）。Firefox 144（playwright 真实引擎）：Web 冒烟通过——启动零 page error、真实 TXT 导入管线、TOC、渲染、搜索/设置弹窗（test/browser-firefox-smoke.mjs；无 Firefox 构建时显式打印 UNVERIFIED 并跳过，不虚称覆盖）。Safari/iOS Safari/Android Chrome：**未验收**（无真实设备，不以 WebKit 自动化或扩展最低版本替代声明）。触屏脚注关闭链接（"ontouchstart" 检测）代码已存在，触屏真机行为未实测。**附带发现（19d6172 修复）**：跨页搜索高亮回归用固定 150ms 睡眠，Windows Chrome（实测 ~230ms）稳定失败而 CI alpine Chromium 恰好通过——已在会话前基线 0c82d4f 验证同样失败（非本会话回归），改为有界轮询后 10/10 通过；教训：浏览器回归不用固定睡眠 |
| B05 | 同步限制用户可见提示（无 CAS 并发边界） | 已修复 | UI 提示上一轮已存在（”依次拉取、修改、推送”）；本轮补协议边界测试：交错并发两推送各自报成功但后写覆盖前写字段、顺序流保留双方字段、时钟超前旧编辑按 ts 获胜——固定复现边界而非宣称解决（test-config-sync.mjs protocol boundary 段）；config-sync.js 两处误导性”online 自动重试”注释已改正（无任何自动接线）。提交 48b45a6 |
| C01 | 真实使用性能基线（10k/50k 行 TXT、多形态 EPUB、500/2000 本书架） | 已修复 | test/browser-performance.mjs 扩展：确定性 TXT 生成器（章节/长行/脚注/空白）+ 三形态 EPUB fixture，Node 侧分阶段计时（浏览器侧保留 DOM/IDB 测量），迭代数可 env 覆盖，输出确定性断言+观测数字。**量化发现（C03 证据）**：50k 行 processChunkStatic 单次 ~172s（10k 为 1.4s，5×输入≈126×耗时，热=冷→算法性超线性；解码/分页 <5ms 可忽略）。EPUB：120 章 1.8s、3000 段 17ms、40 章图文 0.6s 无超线性。详见 docs/PERFORMANCE_BASELINE.md |
| C02 | flow 长会话 DOM 窗口化 | 待开发（前置已满足） | 前置 C01/B04 已完成；下一步按计划做 5 万行前进/回滚/目录跳转/搜索/字体变化会话测量，证实持续增长伴布局/内存恶化后再开发窗口化；失败保留实验模式 |
| C03 | TXT 前缀+全量重算优化 | 待开发（证据已量化） | C01 已定位：processChunkStatic 对 5× 输入耗时 ~126×（50k 行 ~172s，热=冷），解码/分页可忽略——阶段成本测量完成，可按计划进入"移除可证明重复的中间数组/投影"局部优化；流式解析仍不作默认交付 |
| C04 | 书架/EPUB/字体布局按瓶颈优化 | 明确暂缓（条件性） | 无实测收益不合入 |
| D01 | lint 383 警告分类与增量收紧 | 进行中（批次 1 完成） | 分类：193 no-undef 全为 vendor/扩展全局（已声明，未来 no-undef 即真缺陷）、92 unused-vars + 66 prefer-const（遗留风格）、其余少量。修复 4 个真实缺陷：isVariableDefined 的 `!== NaN` 恒真、schema 两处模板字面量恒真致死回退、reader.js async Promise executor 吞 rejection；全局 `position` 改局部只读绑定。警告 383→184（0 error）。提交 4f37eb0。后续批次：unused-vars/prefer-const 逐模块清理后提升规则 |
| D02 | shared→client 反向依赖解除（TextProcessorCore 导 client 配置） | 待开发 | 常量入 shared、运行时状态显式传参、客户端兼容层 |
| D03 | 编排重复与模块循环收敛 | 待开发 | 依赖 D02；按职责验收 |
| D04 | vendor 未确认版本核实（tippy、jschardet、hyperlist） | 已核实（保持未确认状态） | 全部 vendor 文件 sha256+字节数已登记（文件身份锚点）；jschardet 与 npm 全部已发布 dist（2.3.0–3.1.4）逐一比对不匹配（独立构建，最近属 3.1.x）；tippy 上游构件本网络不可达（unpkg/jsdelivr 返回错误桩，后续网络可达时重试）；hyperlist npm 无压缩构件（本地为独立 8KB 压缩版）。区分"文件身份"与"来源验证"，不虚称已验证。CI/部署镜像/CLI 版本固定见 E01。提交 49b9af4 |
| E01 | CNB 流水线加固（token 不落 URL、生产执行端校验、标签随发布、镜像固定） | 已修复 | token 经一次性内联 credential helper（git credential fill 验证过 git 会在 helper 后追加操作参数，正确习语为 `}; f`）；生产入口执行端强制 CNB_BRANCH==main（本地模拟 dev→exit 78 / main→通过）；常规同步仅当前分支、标签仅"发布同步"手动任务；部署镜像固定 v1.7.3（digest 注释）、alpine/git v2.54.0；dist/BUILD_INFO.json 记录源码 SHA/版本。三层离线校验（YAML/语义/Schema）通过；真实 dev 流水线验证：本会话全部推送的 GitHub 镜像同步成功（镜像 HEAD 与 CNB 一致）。提交 379211c |
| E02 | EdgeOne 预发真实验收 | 部分完成（受外部条件阻塞） | 前置已就绪：E01 流水线三层校验通过、dev 每次推送触发预发部署、GitHub 镜像同步全部成功。**未完成**：预发 URL 的 HTTP 实测（Worker 响应类型/缓存头/版本升级路径/安全头）需要 EdgeOne 控制台或带 API token 的 CLI，本机无 token，保留为需控制台访问的后续验收 |
| E03 | 发布候选整合 | 就绪待授权 | 前提已变化：2026-10-25 历史恢复后 main 与 dev 无分叉（main 为 dev 祖先，`main...dev`=0/0），无需合并——E03 原描述的分叉已不存在。后续发布流程（§14）：版本号三文件 + CHANGELOG 单独 commit → tag → 快进 main → 双远程推送（需用户确认）→ CNB 生产按钮（E01 已含执行端校验）。本轮全部开发提交已在 dev（49a2773→0bf6921）；其后 2.3.1（440544b）与 2.4.0（ea3e141）版本号/changelog 提交也已落在 dev，当前候选默认 2.4.0；**不越过生产授权边界自行发版** |
| E04 | 生产发布、冒烟、回滚演练 | 待开发 | 需生产授权；回滚路径先在预发演练 |
| E05 | 持续维护节奏 | 待开发 | 首次发布后生效 |

## 三、明确暂缓清单（不阻塞 Web 发布）

- Chrome/Firefox 真实扩展验收（T22）：等待允许扩展的环境。
- 严格并发配置同步：等待 CAS/原子合并后端，先以 B05 披露限制。
- 真正 TXT 流式处理、flow 稳定化：以 C01—C03 测量结论为前置。
- Docker：仅保留基础多阶段构建检查，不建设独立发布链。
- 框架迁移、分页重写、状态库替换：无充分收益证据，不安排。
