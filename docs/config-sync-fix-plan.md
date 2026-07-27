# 配置同步架构修复计划

> **文档状态**：执行中
> **创建日期**：2026-07-27
> **最后更新**：2026-07-27（架构变更为手动同步模式）
> **基线代码**：`client/src/core/config-sync.js`（v2 字段级 LWW 实现）
> **目标**：依次修复配置同步功能在正确性、容错、可观测性、用户体验上的全部已识别缺陷

---

## 零、架构变更：自动同步 → 手动按需同步

### 变更决策

在制定修复计划后，经评估决定**先行重构同步触发模型**：将拉取/推送从"自动后台同步"改为"独立请求动作"模式。这一变更直接绕过或缓解了原计划中多项由自动同步引发的复杂状态冲突，使后续修复项大幅简化。

### 已完成改造（manual 重构）

| 改动点 | 文件 | 内容 |
|--------|------|------|
| 移除 boot 自动 pull | `client/src/app.js` | 删除启动时 `pullOnBoot()` + `handleSyncPull` 自动调用 |
| 移除周期轮询 | `client/src/core/config-sync.js` | 删除 `startPeriodicPull`/`stopPeriodicPull`/`_doPeriodicPull`/`_onVisibilityChange` 及 `_pullIntervalId`/`_pullCallback` |
| 移除 online 自动补推 | `client/src/core/config-sync.js` | 删除 `_initOnlineRetry()` 自动 wire；`flushPendingPush` 保留供手动重试 |
| 移除 saveSettings 自动 push | `client/src/modules/settings/settings.js` | 删除 `pushOnSettingsChange` 自动调用（保留 `recordChangedKeys` 时间戳记录） |
| 新增手动动作入口 | `client/src/modules/settings/settings.js` | 新增 `applySyncPull`/`syncPull`/`syncPush` 方法 + token 区"拉取"/"推送"按钮 |
| 更新架构契约测试 | `test/test-settings-export.mjs` | merge 逻辑内聚到 settings.js，push 改手动触发 |

### 新同步模型

```
用户操作                独立请求动作              返回变更状态            局部更新+渲染
─────────              ──────────────           ────────────          ──────────────
点"拉取"按钮  ──→  pullOnBoot()          ──→  syncData / null   ──→  applySyncPull(syncData)
                                                                   → mergeSyncedConfig → changedKeys
                                                                   → persistSyncedKeys + applySettings
点"推送"按钮  ──→  buildPushPayload +    ──→  true / false      ──→  UI 反馈（成功/失败）
                    pushConfig()
```

核心：**只处理单次动作完成后的数据变更状态**（`changedKeys` / 成功失败），不做自动状态流转、不处理自动同步带来的并发冲突。

### 对原修复项的影响

| 原编号 | 原问题 | 手动模式下的影响 |
|--------|--------|-----------------|
| S1 | 绑定 token 后自动 push 覆盖远端（read-before-write） | ✅ **基本绕过**：push 不再自动触发。降级为"推送动作前提示先拉取"的轻量校验 |
| S2 | 保护集 × 自动 push 夹带旧值污染远端 | ✅ **基本绕过**：不再有 saveSettings 自动 push。保护集仅用于手动 pull 的 merge，TTL 优先级降低 |
| 原 D2 回环写风暴 | pull-merge-pushBack 自动回环 | ✅ **已消除**：不再自动 pushBack |
| S4 | 状态机 + UI 徽标 | ⚠️ **仍需做但简化**：手动动作更需要即时反馈，但无需 dirty/offline 等自动状态 |
| S3/S5/R4/R5/S7/S6/R6/M1 | — | ✅ **仍适用**：这些针对 pull/push 动作本身的可靠性/安全性，与触发方式无关 |

---

## 一、背景与问题全景

配置同步功能基于 textdb（`https://textdb.hunluan.space`）极简 KV 存储实现：单键全量 POST 覆盖、GET 拉取、字段级时间戳 LWW 合并、3 次指数退避重试。**自手动模式重构后**，不再有 2s 防抖自动推送、60s 轮询拉取、online 自动补推；pull/push 改为用户通过设置面板按钮显式触发的独立动作。

经两轮架构审查（含元审查修正），共识别 **11 个缺陷**，按性质分为：

- **正确性缺陷**（会导致用户数据丢失/污染）：2 个
- **容错缺陷**（异常路径不可靠）：3 个
- **可观测性缺陷**（用户/开发者不可见）：3 个
- **体验/扩展缺陷**：3 个

### 优先级总表

| 优先级 | 编号 | 标题 | 性质 | 状态 | 预估工作量 |
|--------|------|------|------|------|-----------|
| — | M0 | 手动同步模式重构（已完成） | 架构 | ✅ 已完成 | 中 |
| P0 | S1 | 推送动作前拉取校验（原 pull-before-push） | 正确性 | 🔄 方案调整 | 小 |
| P0 | S2 | 保护集 TTL（手动 pull 仍用） | 正确性 | 🔄 降级 | 小 |
| P0 | S4 | 同步状态反馈 + UI 徽标 | 可观测性 | 🔄 简化 | 中 |
| P1 | S5 | rev 写前感知（降低丢失窗口） | 一致性 | 待执行 | 中 |
| P1 | S3 | Outbox 持久化队列 | 容错 | 待执行 | 中 |
| P1 | R4 | 错误分类体系 + 远端值校验 | 容错 | 待执行 | 中 |
| P2 | R5 | 本地环形快照 + 回滚 | 体验 | 待执行 | 大 |
| P2 | S7 | 客户端加密 payload | 安全 | 待执行 | 中 |
| P3 | S6 | payload 分键（大体量数据隔离） | 扩展 | 待执行 | 中 |
| P3 | R6 | 结构化日志 + 导出 | 可观测性 | 待执行 | 小 |
| P3 | M1 | 多标签页选主协调 | 一致性 | 待执行 | 大 |

### 执行原则

1. **从正确性到体验**：先堵数据丢失漏洞，再补可见性，最后做增强。
2. **小步前进，每步可独立验证**：每个修复项独立 commit，附测试。
3. **保持 API 向后兼容**：`config-sync.js` 的现有导出函数签名不破坏性变更，新增能力以可选参数或新导出形式提供。
4. **遵循项目编码标准**：配置驱动、Schema-UI 分离、CSS 变量 i18n 四段式（见 AGENTS.md §2）。

---

## 二、P0 修复项（正确性 + 核心可见性）

### S1. 推送动作前的拉取校验（原"绑定 token 时 pull-before-push"）

**变更说明**：手动模式重构后，`saveSettings` 不再自动 push，原"绑定 token 后自动 push 覆盖远端"的 read-before-write 风险**已基本消除**。但仍存在残余风险：用户绑定 token 后直接点"推送"按钮（未先"拉取"），会用从未 merge 过远端的本地全量配置覆盖远端。

**残余问题**：`syncPush()` 在未执行过 `syncPull()` 的情况下直接 POST 全量本地配置，覆盖远端。

**修复方案**：
1. `settings.js` 新增 `_hasPulledSinceBind` 标志，绑定 token（`validateAndSave`）时重置为 false，`syncPull()` 成功后置 true。
2. `syncPush()` 检查 `_hasPulledSinceBind`：为 false 时提示用户"建议先拉取远端配置，避免覆盖"，提供"继续推送"/"先拉取"选项。
3. 可选：`syncPush()` 内部自动先 pull-merge 再 push（合并为一次"同步"动作），从根本上消除风险。

**涉及文件**：
- `client/src/modules/settings/settings.js` — `syncPush` 加校验、`_hasPulledSinceBind` 标志

**验收标准**：
- [ ] 绑定 token 后首次点"推送"，若未拉取过则提示
- [ ] 拉取后点"推送"不再提示
- [ ] 测试：`test/test-sync-push-guard.mjs`

**风险**：提示可能打断用户流程；可提供"不再提醒"选项。

---

### S2. 保护集 TTL（手动 pull 仍用，优先级降级）

**变更说明**：手动模式重构后，不再有 `saveSettings` 自动 push 和 pull-merge-pushBack 自动回环，原"保护集 × 自动 push 夹带旧值污染远端"的问题**已消除**。`_userInteractedKeys` 现仅用于手动 `syncPull()` 的 `mergeSyncedConfig` 作为 protectedKeys，防止拉取覆盖用户刚改的设置。

**残余问题**：保护集仍会话级不过期。手动模式下 pull 频率低，影响减小，但长期开着的会话中，用户改过的键会永久拒绝远端更新，造成静默发散。

**修复方案**（降级为可选优化）：
1. `_userInteractedKeys` 改为 `Map<key, expiresAt>`，TTL 建议 60s（手动模式下无防抖/轮询压力，可放宽）。
2. `applySyncPull` 读取保护集前清理过期项。

**涉及文件**：
- `client/src/modules/settings/settings.js` — `_userInteractedKeys` 结构改造
- `client/src/core/config-sync.js` — `mergeSyncedConfig` 无需改（保护集由调用方传入，过期清理在 settings 侧）

**验收标准**：
- [ ] 保护键 TTL 过期后可被手动 pull 覆盖
- [ ] 测试：`test/test-sync-protect-ttl.mjs`

**风险**：低。手动模式下 TTL 可设较长，误覆盖风险小。

---

### S4. 同步状态反馈 + UI 徽标（简化版）

**变更说明**：手动模式下无需完整的自动状态机（无 dirty/offline 自动流转）。核心需求缩减为：**手动 pull/push 动作的即时反馈**（进行中/成功/失败）+ 上次同步时间显示。

**问题**：`getLastPushedAt/getLastPulledAt` 已定义但无 UI 消费；手动动作（`syncPull`/`syncPush`）执行中无反馈，用户不知是否在请求、是否成功。

**修复方案**：
1. **轻量状态**（非完整状态机）：在 `settings.js` 维护 `_syncActionState`（`idle`/`pulling`/`pushing`/`success`/`error`），仅由 `syncPull`/`syncPush` 显式设置。
2. **UI 反馈**：token 区"拉取"/"推送"按钮旁显示状态文本（进行中…/✓ 成功 hh:mm/✗ 失败）。
3. 通过 `cbReg.go("sync:actionFeedback", { state, detail })` 发布，便于其他模块订阅。
4. 文案走 CSS 变量 i18n 四段式。

**状态枚举**（精简）：
```
idle     — 空闲
pulling  — 拉取中
pushing  — 推送中
success  — 上次动作成功（显示时间）
error    — 上次动作失败（可重试）
```

**涉及文件**：
- `client/src/modules/settings/settings.js` — `_syncActionState`、按钮反馈渲染
- `client/src/styles/variables.css` — `--ui_sync_*` i18n 变量（四段式）
- `client/src/styles/settings.css` — 反馈文本样式

**i18n 变量**（四段式）：
```
--ui_sync_pulling    拉取中… / Pulling…
--ui_sync_pushing    推送中… / Pushing…
--ui_sync_success    已同步 / Synced
--ui_sync_error      失败，点击重试 / Failed, tap to retry
--ui_sync_last_at    上次同步 / Last sync
```

**验收标准**：
- [ ] 点"拉取"显示"拉取中…"→ 成功显示"已同步 hh:mm" / 失败显示"失败"
- [ ] 点"推送"显示"推送中…"→ 成功/失败反馈
- [ ] 中英文切换文案正确
- [ ] 测试：`test/test-sync-feedback.mjs`

**风险**：低。无自动状态流转，不会与现有逻辑冲突。

---

## 三、P1 修复项（一致性加固 + 容错）

### S5. rev 写前感知

**问题**：GET→merge→POST 非原子，两设备并发 POST 时后写者全量覆盖前者的 blob，字段级 ts 只能在败者下次 pull 时补救，存在丢失窗口。

**修复方案**：
1. `_meta` 新增 `rev` 字段（单调自增整数），每次 push `rev = lastSeenRemoteRev + 1`。
2. push 前先 GET 比对远端 `rev`：
   - 远端 `rev` == 本地 `lastSeenRemoteRev` → 无人写过，直接 POST。
   - 远端 `rev` > 本地 `lastSeenRemoteRev` → 被别设备写过 → 重新 merge 远端数据 → 更新 `lastSeenRemoteRev` → 再 POST（一次重试）。
3. 拉取时记录 `lastSeenRemoteRev`。

**涉及文件**：
- `client/src/core/config-sync.js` — `pushConfig` 加 read-before-write、`_meta.rev`、`lastSeenRemoteRev` 持久化

**验收标准**：
- [ ] 并发 push 场景下，后写者检测到 rev 不匹配会重新 merge
- [ ] 无并发时不多增加 GET 往返（可选：仅在距上次 pull 超过阈值时才 read-before-write）
- [ ] 测试：`test/test-sync-rev.mjs` 模拟并发

**风险**：每次 push 多一次 GET 往返；可加策略"距上次 pull < 5s 则跳过 read"。

---

### S3. Outbox 持久化队列

**问题**：`_pendingPushPayload`（`config-sync.js:92`）是内存变量，页面刷新/关闭即丢失。push 三次重试全败后用户若不再改设置就关页面，那次改动不会补推。虽然数据本身在 `values`/`fieldTs` 持久化（修正后认知），但推送调度不可靠。

**修复方案**：
1. 新增 localStorage 键 `config_sync_outbox`，存储待推送 payload 队列（含 `seq` 单调序号 + payload hash）。
2. push 失败时写入 outbox 而非内存变量。
3. 启动时检查 outbox，若有待推送项则补推。
4. 推送前比对 hash：与上次成功推送一致则跳过（消除空写）。
5. 用 `seq` 保证 flush 与新 push 的先后序，杜绝旧 payload 覆盖新的。

**涉及文件**：
- `client/src/core/config-sync.js` — outbox 读写、`flushPendingPush` 改造、启动补推

**验收标准**：
- [ ] push 失败后刷新页面，启动时自动补推
- [ ] 相同 hash 的 payload 不重复推送
- [ ] flush 与新 push 并发时，seq 保证后写为新
- [ ] 测试：`test/test-sync-outbox.mjs`

**风险**：outbox 可能积压过期数据；设上限（如最多 5 条，超出丢弃最旧并告警）。

---

### R4. 错误分类体系 + 远端值校验

**问题**：
1. `pullOnBoot` 对"无数据(404)/网络断/5xx/数据损坏"一律返回 `null`（`config-sync.js:352-368`），调用方无法区分。
2. `mergeSyncedConfig` 只校验 `{v, ts}` 外壳，`entry.v` 无类型/范围校验（`config-sync.js:543-549`），恶意或损坏值会被直接写入 `settings.values`。
3. 远端数据损坏时无隔离，后续 push 会静默覆盖。

**修复方案**：

**1. 错误分类**
```js
class SyncError extends Error {
  constructor(kind, message, { retryable, status } = {}) {
    super(message);
    this.kind = kind; // 'network' | 'server' | 'auth' | 'corrupt' | 'quota' | 'notfound'
    this.retryable = retryable;
    this.status = status;
  }
}
```
- `pullOnBoot`/`pushConfig` 失败时抛 `SyncError` 或返回 `{ ok, error }` 结构，替代 null/false。
- 4xx 中 400/401 → `auth`（不可重试，需用户介入）；404 → `notfound`（正常，非错误）；5xx → `server`（可重试）。

**2. 远端值校验**
- `mergeSyncedConfig` 接受 `schemaValidators`（从 `SETTINGS_SCHEMA` 派生：type/min/max/options 白名单）。
- 对每个远端 `entry.v` 校验：类型不符/range 越界/select 非法选项 → 拒收该键，记入 `rejectedKeys`，发布 `sync:invalidValue` 事件。
- 远端整体解析失败（`_parseSyncData` 返回 null）→ 隔离备份到 `config_sync_quarantine`，发布 `sync:corrupt` 事件，不触发覆盖。

**涉及文件**：
- `client/src/core/config-sync.js` — `SyncError`、错误分类、校验逻辑
- `client/src/config/schema/settings-schema.js` — 导出可派生 validator 的 schema 元信息（如已含 type/min/max/options）
- `client/src/app.js` — `handleSyncPull` 处理 `{ ok, error }` 返回

**验收标准**：
- [ ] 404 不再被当作错误
- [ ] 400/401 触发 `needs_attention` 状态（配合 S4）
- [ ] 远端损坏值被拒收并记录，不写入 settings.values
- [ ] 远端整体损坏被隔离，不触发覆盖 push
- [ ] 测试：`test/test-sync-error-class.mjs`、`test/test-sync-value-validation.mjs`

**风险**：返回值结构变更（null/false → {ok,error}）需同步更新所有调用方；保持旧 API 可用或一次性迁移。

---

## 四、P2 修复项（体验增强 + 安全）

### R5. 本地环形快照 + 回滚

**问题**：textdb 单键覆盖无历史；pull-merge 前不备份本地 `values`，应用后无法撤销。

**修复方案**：
1. 新增 localStorage 键 `config_sync_history`，环形数组（最多 10 份）。
2. 每次成功 pull-merge 前，将当前 `{ values, fieldTs, timestamp, source: 'pre-pull' }` 存入环形缓冲。
3. 设置面板新增"同步历史"入口：展示每次快照时间 + `changedKeys` diff。
4. 回滚操作 = 恢复快照 values → `recordLocalChange` 全部键 → push。

**涉及文件**：
- `client/src/core/config-sync.js` — 快照读写
- `client/src/modules/settings/settings.js` — 历史面板 UI、回滚逻辑
- `client/src/styles/variables.css` — i18n 文本（四段式）
- `client/src/styles/settings.css` — 历史面板样式
- `client/src/config/schema/settings-schema.js` — MENU_SCHEMA 添加虚拟项 `__sync_history`

**验收标准**：
- [ ] pull-merge 前自动快照
- [ ] 历史面板展示最近 10 次快照
- [ ] 回滚后本地恢复 + 推送到远端
- [ ] 测试：`test/test-sync-history.mjs`

---

### S7. 客户端加密 payload

**问题**：token 即存储键即身份，无鉴权，明文存储。知道 token 者可读写全部配置。

**修复方案**：
1. push 前用 token 派生密钥：`crypto.subtle.deriveKey(PBKDF2, token, AES-GCM, ...)`。
2. payload 加密后 POST 密文（base64），`_meta` 标记 `enc: "aes-gcm"` + iv。
3. pull 后检测 `enc` 标记，解密后再 merge。
4. 旧明文数据兼容：无 `enc` 标记则按明文处理（渐进迁移）。

**涉及文件**：
- `client/src/core/config-sync.js` — 加解密逻辑、`_meta.enc`
- 注意：扩展环境需确认 `crypto.subtle` 可用

**验收标准**：
- [ ] 新推送数据为密文
- [ ] 旧明文数据可正常拉取（兼容）
- [ ] 错误 token 无法解密（返回损坏处理，配合 R4）
- [ ] 测试：`test/test-sync-encryption.mjs`

**风险**：PBKDF2 迭代次数影响性能；token 变更后旧密文不可解密（需提示用户）。

---

## 五、P3 修复项（扩展性 + 排障 + 多标签协调）

### S6. payload 分键（大体量数据隔离）

**问题**：当前全量配置单键存储，若未来同步字体池/书架元数据，payload 膨胀可能触及 textdb body 上限。

**修复方案**：
1. 设定 payload 软上限（64KB），超限告警。
2. 大体量数据走独立同步键：`{token}_fonts`、`{token}_shelf`，与设置键 `{token}` 分离。
3. 各键独立 rev、独立 merge。

**涉及文件**：
- `client/src/core/config-sync.js` — 多键路由
- 字体池/书架模块 — 按需接入

**验收标准**：
- [ ] 设置数据与大体量数据独立同步
- [ ] 单键超限告警
- [ ] 测试：`test/test-sync-sharding.mjs`

---

### R6. 结构化日志 + 导出

**问题**：仅 `console.warn`，无结构化日志，排障困难。

**修复方案**：
1. 新增 `syncLog(level, event, data)`，写入内存环形缓冲（200 条）。
2. 关键事件：pushOk/pushFail/pullOk/mergeConflicts/invalidValue/corrupt/retry。
3. 内置计数器：成功率、重试次数、冲突次数、字节数。
4. 设置面板"关于"区新增"导出同步日志"按钮，输出 JSON。

**涉及文件**：
- `client/src/core/config-sync.js` — `syncLog`、环形缓冲、计数器
- `client/src/modules/settings/settings.js` — 导出按钮
- `client/src/styles/variables.css` — i18n（四段式）

**验收标准**：
- [ ] 关键事件均记录
- [ ] 日志可导出为 JSON 文件
- [ ] 测试：`test/test-sync-log.mjs`

---

### M1. 多标签页选主协调

**问题**：同设备多标签页各自维护防抖计时器与内存 pending，`fieldTs` 的 localStorage 读改写无锁，无 BroadcastChannel/leader election 协调。

**修复方案**：
1. 使用 Web Locks API 选主：仅 leader tab 执行 push/pull。
2. `fieldTs` 变更经 BroadcastChannel 广播，非 leader tab 监听更新内存缓存。
3. leader tab 关闭时自动转移。

**涉及文件**：
- `client/src/core/config-sync.js` — 选主逻辑、BroadcastChannel
- 注意：扩展环境 Web Locks 兼容性需验证

**验收标准**：
- [ ] 仅 leader tab 执行网络操作
- [ ] leader 关闭后自动转移
- [ ] 测试：`test/test-sync-leader.mjs`（需模拟多标签）

**风险**：Web Locks 在部分浏览器扩展环境不可用，需降级为 BroadcastChannel + 时间戳选举。

---

## 六、执行顺序与里程碑

```
里程碑 M0：手动同步模式重构 ✅ 已完成
  ├─ config-sync.js 移除自动机制（periodic pull / online retry / 自动 wire）
  ├─ app.js 移除 boot 自动 pull + 周期 pull
  ├─ settings.js 移除 saveSettings 自动 push，新增 syncPull/syncPush 手动动作
  └─ 测试契约更新（merge 内聚到 settings.js）
  交付标准：pull/push 为独立请求动作，无自动后台同步流程

里程碑 M1：正确性收尾 + 可见性（P0）
  ├─ S1  推送动作前拉取校验
  ├─ S2  保护集 TTL（可选优化）
  └─ S4  手动动作状态反馈 + UI 徽标
  交付标准：残余覆盖风险防范，同步动作状态用户可见

里程碑 M2：一致性 + 容错（P1）
  ├─ S5  rev 写前感知
  ├─ S3  Outbox 持久化
  └─ R4  错误分类 + 值校验
  交付标准：并发丢失窗口缩至毫秒级，异常可分类可恢复

里程碑 M3：体验 + 安全（P2）
  ├─ R5  本地快照回滚
  └─ S7  客户端加密
  交付标准：误操作可回滚，数据传输加密

里程碑 M4：扩展 + 排障（P3）
  ├─ S6  payload 分键
  ├─ R6  结构化日志
  └─ M1  多标签选主
  交付标准：可扩展大体量同步，可排障，多标签无冲突
```

### 单项修复执行流程（每项遵循）

1. **读代码**：复核涉及文件的当前实现，确认行号未漂移。
2. **写测试先行**：在 `test/` 下新建 `test-sync-*.mjs`，覆盖修复场景（红）。
3. **改实现**：按方案修改，保持 API 兼容。
4. **跑测试**：`pnpm run test`，确认新测试通过（绿）+ 旧测试不退化。
5. **typecheck**：`pnpm run typecheck`。
6. **手动验证**：浏览器中加载 TXT/EPUB，验证同步行为。
7. **commit**：Conventional Commits 格式，如 `fix(sync): pull-before-push on token bind`。

---

## 七、风险控制

- **每项修复独立 commit**，便于回滚。
- **敏感操作前备份**：修改 `config-sync.js` 前做 MD5 归档备份（项目约定）。
- **不破坏现有 API**：新增能力用可选参数或新导出，旧导出保持可用直到迁移完成。
- **渐进迁移**：加密（S7）、rev（S5）等涉及数据格式变更的，保留旧格式兼容路径。
- **i18n 四段式**：所有新增用户可见文本严格按 AGENTS.md §2 步骤 4 执行，遗漏任何一段对应语言显示空白。

---

## 八、验收总清单

修复全部完成后，逐项确认：

- [x] M0：pull/push 为独立请求动作，无 boot 自动 pull / 周期 pull / saveSettings 自动 push / online 自动补推
- [ ] S1：绑定 token 后首次点"推送"未拉取过则提示
- [ ] S2：保护集 TTL 过期后可被手动 pull 覆盖
- [ ] S4：手动动作状态反馈（拉取中/推送中/成功/失败）；中英文文案正确
- [ ] S5：并发 push 检测 rev 不匹配并重新 merge
- [ ] S3：push 失败后刷新页面自动补推；hash 去重生效
- [ ] R4：404 非错误；400/401 触发 needs_attention；损坏值拒收；整体损坏隔离
- [ ] R5：pull-merge 前自动快照；历史面板可回滚
- [ ] S7：新数据密文存储；旧明文兼容；错误 token 不可解密
- [ ] S6：大体量数据独立同步键；超限告警
- [ ] R6：关键事件记录；日志可导出
- [ ] M1：仅 leader tab 执行网络操作；leader 转移正常
- [ ] 全部新增 i18n 变量四段式完整
- [ ] `pnpm run test` 全绿
- [ ] `pnpm run typecheck` 无错
- [ ] 浏览器手动验证：多设备同步、断网重连、冲突回滚
