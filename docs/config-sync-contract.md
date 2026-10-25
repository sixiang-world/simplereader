# 手动配置同步契约

应用不会在启动、修改设置或网络恢复时自动拉取/推送。用户在设置面板显式触发操作。

## 数据与失败语义

- 本地有效设置经过 schema 校验；URL 参数只覆盖本次运行，不自动持久化。
- 普通设置键是规范持久化来源；旧 `UILang` 只作为迁移回退，不覆盖 `ui_language`。
- 拉取只采用允许键、有效值、有限非负时间戳；派生设置在本地计算。
- 值相同也推进其时间戳；当前会话用户修改过的键保持保护。
- `pullConfigResult` 区分 `ok`、`missing`、`error`。404 表示没有远端配置；离线、非成功HTTP、非法JSON、超时都表示失败，不能显示成功。
- 旧 `pullOnBoot` 仍保留返回 data/null 的兼容接口；UI 使用有明确结果的新接口。
- 请求包含响应体读取阶段有 10 秒等待边界。失败不会自动触发后台同步。

## 推送的一致性限制

UI 使用 `pushMergedConfig`：先 GET 当前远端，将每字段较新的时间戳合入，再 POST 整份配置。读取失败时不写；读取中令牌变化时也不写。该过程可防止**顺序操作的过期设备**把另一设备已提交的较新字段覆盖。

当前 textdb 的接口是整文档 GET/POST，没有配置中的 ETag/If-Match、版本 CAS 或原子字段合并接口。因此以下并发仍然可能丢更新：A 和 B 都读取版本 V，然后各自合并并写入，最后一个写者覆盖前一个写者。单纯 GET+merge 不能消除此竞争，也不能保证设备时钟偏移下的真实时间顺序。

请按设备依次“拉取 → 修改 → 推送”。若产品需要严格多写者保证，必须先在服务端提供 CAS 冲突重试或原子字段合并，再扩展客户端协议与交错并发测试。本轮没有向生产服务写数据，也没有部署或变更后端。

低层 `pushConfig`、debounce/retry API 为兼容旧调用方保留；它们不提供读合并保证。应用的手动推送入口使用 `pushMergedConfig`，没有启用后台自动写入。

## 验证入口

- `node --test test/test-settings-state-regressions.mjs test/test-background-tasks.mjs`
- `node test/test-config-sync.mjs`
- `node test/test-url-settings.mjs`
- `node test/browser-settings-regressions.mjs`（使用测试 runner 启动的本地服务和无头 Chromium；先生成 dist）

上述并发与时钟偏差边界由 `test-config-sync.mjs` 末尾的 "protocol boundary" 测试固定复现：
交错并发的两个推送**各自报告成功**但后写者覆盖前写者字段；时钟超前的旧编辑按
时间戳声明获胜。这些测试展示现有边界，不宣称已解决。

浏览器回归将字体加载设为永久 pending，并在本地拦截同步网络请求，验证核心初始化不等待字体、URL T2S选项、同步语言刷新后保留、异常值拒绝以及离线反馈。
