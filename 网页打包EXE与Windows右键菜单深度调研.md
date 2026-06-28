---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 1b15fa6152c39e6cbe05d76c27235a71_798430c472ba11f1b2f55254006c9bbf
    ReservedCode1: 73XrNxPZ3Dvb6ztJqPZGADYpe8ilk9tn87RwwKVRK6n9c9jkyxPzLiydmvYsG32KHVzTXx4E3Te8FcCtuzhPxw0SwopTPqEbQuoDt2d6WYUxDHOkzLHO9gaAW/C46Bl4Z/9jTVezetuIvRCC9EnJtfoA4HbFQjKJ4Uo/Ar+fFRsuhfNuZwr0qvs++mY=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 1b15fa6152c39e6cbe05d76c27235a71_798430c472ba11f1b2f55254006c9bbf
    ReservedCode2: 73XrNxPZ3Dvb6ztJqPZGADYpe8ilk9tn87RwwKVRK6n9c9jkyxPzLiydmvYsG32KHVzTXx4E3Te8FcCtuzhPxw0SwopTPqEbQuoDt2d6WYUxDHOkzLHO9gaAW/C46Bl4Z/9jTVezetuIvRCC9EnJtfoA4HbFQjKJ4Uo/Ar+fFRsuhfNuZwr0qvs++mY=
---

# 网页打包 EXE 与 Windows 右键菜单深度调研

## 1. STRapp 分析

STRapp 是基于 **python-webui** 构建的通用网页 EXE 外壳，其运行机制为：启动本地 HTTP 服务器，然后打开系统浏览器加载页面。核心特征如下：

- **体积**：单 EXE 小于 10MB，不捆绑浏览器。
- **`--stre` 模式**：启用后配合 cataerogong 修改版 SimpleTextReader v1.6.0+，利用 File System Access API 直接读取本机硬盘文件，使网页应用变为真正的本地阅读器。
- **拖拽文件打开**：通过 `sys.argv` 获取拖拽文件的路径，但打开的是**系统浏览器**而非独立窗口，无法呈现"独立应用"的体验。
- **安装与集成能力**：无安装程序，不具备注册表写入能力，无法集成 Windows 右键菜单。
- **结论**：不适合作为"右键 → 打开"的目标方案，拖拽体验差，缺少独立的原生窗口外壳。

---

## 2. Windows 右键菜单机制

### 2.1 Win10 经典右键菜单

通过注册表路径 `HKEY_CLASSES_ROOT\*\shell\` 实现。原理简单：在该路径下新建子项，指定显示名称和命令行即可。所有主流框架的 **NSIS 安装包**均支持在安装脚本中写入相应注册表键值，无需额外 COM 组件。

### 2.2 Win11 新一级菜单（Modern Context Menu）

必须实现 **IExplorerCommand COM DLL**，并配合 **Sparse Package (AppxManifest.xml)** 进行注册。这与所选打包框架无关，属于 Windows Shell 扩展层面的要求，任何框架生成的 EXE 都需要额外开发此 COM 组件。

---

## 3. 六大框架对比

| 框架 | 体积 | 拖拽打开 | 右键菜单 | 独立窗口 | 综合评价 |
|------|------|---------|---------|---------|---------|
| **Tauri v2** | 2-10MB | `std::env::args()` → IPC 传前端 | NSIS Hooks 轻松写注册表 | WebView2 窗口 | **推荐**，纯前端几乎零改造 |
| **Electron** | 100MB+ | `process.argv` + `open-file` 事件 | 支持 | Chromium 窗口 | JS 全栈，生态成熟但体积大 |
| **Wails** | 轻量 | `os.Args` | 支持 | WebView2 窗口 | 备选方案 |
| **Deno Desktop 2.9** | 轻量 | `Deno.args` | 支持 | WebView/CEF 窗口 | 2026年6月发布，实验性强，Windows 安装包不成熟 |
| **Python-WebUI (STRapp)** | <10MB | `sys.argv` | 不支持 | 系统浏览器 | 无安装程序，拖拽体验差 |
| **Flutter Desktop** | 较大 | Dart 命令行参数 | shortcut_menu_extender_windows 等插件 | 自绘窗口 | 系统级右键同样走 NSIS |

---

## 4. 推荐方案与技术路线

### 4.1 首选：Tauri v2

- **体积优势**：2-10MB，远优于 Electron 的 100MB+。
- **前端兼容性**：纯前端代码几乎零改造即可迁移。
- **右键菜单**：通过 NSIS 安装脚本 Hook 轻松写入注册表，实现 Win10 经典右键菜单。
- **命令行参数统一**：拖拽打开、右键菜单"打开"、TXT 文件关联，底层均通过同一套命令行参数机制（`std::env::args()`→IPC）实现，一次开发全部覆盖。

### 4.2 备选：Electron

- JS 全栈开发，生态最为成熟，社区资源丰富。
- 缺点明显：体积 100MB+，对轻量应用不友好。

### 4.3 不推荐：STRapp 路线

- 无法实现独立窗口，始终依赖系统浏览器。
- 不支持安装程序和右键菜单集成。
- 拖拽打开体验差，不适合"右键 → 打开"的使用场景。

### 4.4 关键结论

**拖拽打开、右键菜单、文件关联本质上是同一套命令行参数机制**。无论选择哪个支持独立窗口的框架（Tauri / Electron / Wails），只需在安装时注册上下文菜单项并传递文件路径给 EXE，前端通过框架提供的 IPC/事件机制获取参数，即可同时覆盖三种交互场景。
*（内容由AI生成，仅供参考）*
