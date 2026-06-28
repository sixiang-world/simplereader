---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 1b15fa6152c39e6cbe05d76c27235a71_b7e82e6672c411f1b2f55254006c9bbf
    ReservedCode1: AmpaXHsJH1Bp3iG6ESn1QFHD5JJ/PAWzUjCLcC0kNaL4ErqbgP0Nl6r0N1n9pAGOZnp2Aa/FKTdHAiRjNQ+vBkHVlb4huRj5/p3R/MsLmCQG0iEYqtF4s6U1nHpUuUHHyex4srcjocRW5q+3po6PXZTt34s79CP/RJxDhlzKiWPhzpon+W/ZA3TXSDY=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 1b15fa6152c39e6cbe05d76c27235a71_b7e82e6672c411f1b2f55254006c9bbf
    ReservedCode2: AmpaXHsJH1Bp3iG6ESn1QFHD5JJ/PAWzUjCLcC0kNaL4ErqbgP0Nl6r0N1n9pAGOZnp2Aa/FKTdHAiRjNQ+vBkHVlb4huRj5/p3R/MsLmCQG0iEYqtF4s6U1nHpUuUHHyex4srcjocRW5q+3po6PXZTt34s79CP/RJxDhlzKiWPhzpon+W/ZA3TXSDY=
---

# Tauri v2 vs Wails vs Deno Desktop vs Flutter：桌面 EXE 打包方案深度对比

> 排除 Electron（体积 100MB+），聚焦四框架在「Web TXT 阅读器 → 支持拖拽打开 + Windows 右键菜单的桌面 EXE」场景下的实现难度与差异。

---

## 一、总量对比

| 维度 | Tauri v2 | Wails v2/v3 | Deno Desktop 2.9 | Flutter Desktop |
|------|----------|------------|-------------------|-----------------|
| 后端语言 | Rust | Go | 无（纯 TS/JS） | Dart |
| 前端 | 任意 Web 框架 | 任意 Web 框架 | 任意 Web 框架 | Dart Widget（自绘） |
| EXE 体积 | 4–12 MB | 3–20 MB | 66 MB（压缩后 19 MB） | 25–60 MB |
| WebView 依赖 | 系统 WebView2 | 系统 WebView2 | WebView2 或 CEF | 无（Skia 自绘） |
| 成熟度 | 极高，v2 稳定 | 高，v2 稳定/v3 alpha | 极低，2026.6 发布 | 中，桌面端非一等公民 |

---

## 二、核心能力逐项对比

### 1. 拖拽文件打开（Drag-to-EXE）

**机制**：Windows 将拖拽文件路径作为命令行参数传给 EXE，四者都能拿到。

| 框架 | 实现方式 | 难度 |
|------|---------|------|
| Tauri | `std::env::args()` 在 `setup()` 中获取，通过 IPC 或 event 传给前端 | 低 |
| Wails | `os.Args` 在 Go 端获取，`runtime.EventsOn("file-drop")` 或直接 IPC | 低 |
| Deno Desktop | `Deno.args` 获取，理论可行但文档未覆盖此场景 | 中（需自行验证） |
| Flutter | `Platform.executableArguments` 或插件 `file_open_handler`（仅 macOS） | 中 |

### 2. 窗口内拖拽（Drag file into window）

| 框架 | 实现方式 | 难度 |
|------|---------|------|
| Tauri | WebView2 原生支持 HTML5 Drag & Drop API，前端直接处理 | 极低（前端技能即用） |
| Wails | `EnableFileDrop: true` → 监听 `wails:file-drop` 事件，返回绝对路径 | 极低 |
| Deno Desktop | CEF/WebView2 原生支持 HTML5 DnD，前端直接处理 | 极低 |
| Flutter | 需插件：`dragdropwindows`（仅 Win）、`desktop_drop`、`file_selector` | 中（插件碎片化） |

### 3. 右键菜单 / 文件关联

这是四者差距最大的维度。

| 框架 | 实现方式 | 难度 |
|------|---------|------|
| Tauri | `fileAssociations` 配置项，NSIS 自动写入注册表（`HKEY_CLASSES_ROOT\*\shell\`）。高级需求用 `"include": "custom.nsh"` 自定义 NSIS 脚本 | 极低→中（高级需求） |
| Wails | v3 有 `fileAssociations` 在 `config.yml`，NSIS 自动处理。v2 用 `-nsis` + 自定义 `project.nsi` | 低→中 |
| Deno Desktop | 无内置支持。MSI 安装器不支持自定义注册表。需额外用 NSIS/Inno Setup 打包 | 高 |
| Flutter | 无内置支持。需 `shortcut_menu_extender_windows` 插件或手动写注册表 | 高 |

### 4. 安装程序

| 框架 | 默认方案 | 自定义程度 |
|------|---------|-----------|
| Tauri | NSIS (.exe) / WiX (.msi) | 极高，`tauri.conf.json` + `.nsh` 脚本 |
| Wails | NSIS (.exe) / MSIX | 高，自定义 `project.nsi` |
| Deno Desktop | MSI（纯 Rust 生成）或裸目录 | 低，MSI 不可深度定制，需外挂第三方 |
| Flutter | 无 | 完全依赖第三方（Inno Setup / NSIS） |

---

## 三、实现难度排序（从低到高）

> 场景：现有 Web TXT 阅读器 → 支持拖拽 + 右键的桌面 EXE

### Tauri v2（难度：★☆☆）

只需三步：`tauri.conf.json` 配置 `fileAssociations` + `setup()` 中读 `args` + IPC 通知前端打开。NSIS 自动注册。社区教程完整，踩坑少。

### Wails（难度：★★☆）

Go 后端需要一定学习成本，但 Go 比 Rust 友好。拖拽和文件关联都有内置支持，NSIS 自定义程度高。v3 配置比 v2 更简洁。

### Deno Desktop（难度：★★★☆）

纯 JS/TS 是最大优势——无需学第二语言。但 `deno desktop` 刚发布（2026.6），缺少文件关联支持，安装器定制受限。功能能实现，但需要自己补很多边角。

### Flutter Desktop（难度：★★★★）

最大问题：已有 Web 代码需要推倒 UI 全用 Dart 重写。加上安装器、右键菜单全靠第三方插件拼凑，工程量大。

---

## 四、关键差异总结

1. **Tauri 的独特优势**：Rust 生态虽然入门陡，但 `tauri.conf.json` 一站式配置 installer + file association + bundle，开箱即用程度远超其他三者。`custom.nsh` 给了无限的注册表操控能力。

2. **Wails 的定位**：Go 后端 + Web 前端，本质上是 Tauri 的 Go 语言版。配置方式类似，成熟度略逊但也在快速追赶。团队有 Go 背景则毫无问题。

3. **Deno Desktop 的软肋**：JS 全栈的诱惑很大，但版本太新（2.9.0），文件关联、注册表操控、高级安装器定制这些"桌面应用刚需"尚缺。适合玩具项目，不适合需要深度系统集成的场景。

4. **Flutter 的根本问题**：自绘引擎意味着不是"给网页套壳"，而是"必须用 Dart 重写 UI"。对已有 Web 代码的场景，迁移成本不可接受。

---

## 五、结论

对「把现有 Web TXT 阅读器打包成支持拖拽 + 右键菜单的桌面 EXE」需求：

**Tauri v2 > Wails >> Deno Desktop >> Flutter**

Tauri 是首选，Wails 是强力备选。另两个在此场景下不值得投入。
*（内容由AI生成，仅供参考）*
