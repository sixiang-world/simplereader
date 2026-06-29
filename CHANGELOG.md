# Changelog

All notable changes to this project will be documented in this file.

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
