---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 1b15fa6152c39e6cbe05d76c27235a71_b7e0e10972ca11f1b2f55254006c9bbf
    ReservedCode1: LQvhhHVfuYL07V/JoIzF/H7NTSyc+xt0A7Rr49BHV31EkS4q/RaYSRMaWwPc9K0SD1j1qaBt2GfGF8Ydi0lCUKsIioK9hj8tkmH2Pvbmgl3+ftLkQzwDKIoseuc0eW+FEwFTxa+7sSm3wDHwFTPQJmjmWmK1TK8v6AtmdOm+s7HId/CNyFb07a0SmbQ=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 1b15fa6152c39e6cbe05d76c27235a71_b7e0e10972ca11f1b2f55254006c9bbf
    ReservedCode2: LQvhhHVfuYL07V/JoIzF/H7NTSyc+xt0A7Rr49BHV31EkS4q/RaYSRMaWwPc9K0SD1j1qaBt2GfGF8Ydi0lCUKsIioK9hj8tkmH2Pvbmgl3+ftLkQzwDKIoseuc0eW+FEwFTxa+7sSm3wDHwFTPQJmjmWmK1TK8v6AtmdOm+s7HId/CNyFb07a0SmbQ=
---

# Tauri v2 vs Wails：终极二选一

## 一句话定位

Wails 就是 Tauri 的 Go 语言版——架构理念几乎一致（系统 WebView 套壳 + 原生后端），在「桌面 EXE 打包」场景下两者都能完美胜任。差异不在能力，在生态和品味。

## 核心对比

| 维度 | Tauri v2 | Wails v2/v3 |
|------|----------|------------|
| 后端 | Rust | Go |
| 入门曲线 | 陡（所有权、生命周期） | 缓（Go 语法极简） |
| 生态成熟度 | 极高（100k+ Star） | 高（社区活跃但规模小） |
| 配置体验 | `tauri.conf.json` 一站式 | `config.yml` + 少量代码 |
| 文件关联 | 内置 `fileAssociations` | v3 内置 `fileAssociations` |
| NSIS 自定义 | `custom.nsh` 扩展 | `project.nsi` 扩展 |
| 热重载 | tauri dev 双进程 HMR | wails dev 前端 HMR + air |
| EXE 体积 | 4–12 MB | 3–10 MB（HTMX 可到 3MB） |
| 跨平台行为一致性 | 极高（三层抽象收敛差异） | 中（轻量桥接，Linux 有额外适配） |
| IPC 性能 | 极快（Rust 零成本抽象） | 快（Go 编译型，足够用） |

## 拖拽与右键能力对比

| 能力 | Tauri v2 | Wails |
|------|----------|-------|
| 拖拽文件到 EXE | `std::env::args()` + IPC | `os.Args` + IPC |
| 窗口内拖拽 | HTML5 DnD（WebView2 原生） | `EnableFileDrop: true` + `wails:file-drop` 事件 |
| 右键打开方式 | `fileAssociations` 自动注册 | `fileAssociations` 自动注册 |
| 高级注册表自定义 | `custom.nsh` 脚本 | `project.nsi` 脚本 |

## 决策矩阵

- 有 Rust 经验 → Tauri，毫无争议
- 有 Go 经验 → Wails，毫无争议
- 两者都不会 → Wails（Go 一周上手，Rust 一月起步）
- 追求极致生态/社区 → Tauri
- 追求最小体积 → Wails + HTMX（可压到 3MB）

## Web TXT 阅读器打包场景

两者都能做到，步骤几乎一样：

- **Tauri**：`tauri.conf.json` 配 `fileAssociations: [{ext: "txt"}]` → `setup()` 读 `args` → 前端处理
- **Wails**：`config.yml` 配 `fileAssociations` → `ApplicationOpenedWithFile` 事件 → 前端处理

## 结论

选你更舒服的语言。功能上不分胜负。
*（内容由AI生成，仅供参考）*
