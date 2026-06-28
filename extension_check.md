---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 1b15fa6152c39e6cbe05d76c27235a71_6c53c8b9725511f1b2f55254006c9bbf
    ReservedCode1: 2DKOXCEQ0cL/nusXB3AzAMxnOVDoEQgXlblEZBrciXvjQ1oFkEBodPX3UDr7iU2b9pArn6bVCpC9bWyG0uYL2DtBSWZGZDbehKyNbyA/RVNqtMqcHJkT26RXk4igeXpG5DLShl/u0NKmj8rEFZPAcb7mYkxGQUty7AbTAuj0QZeJ505uT7E4PP63D+E=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 1b15fa6152c39e6cbe05d76c27235a71_6c53c8b9725511f1b2f55254006c9bbf
    ReservedCode2: 2DKOXCEQ0cL/nusXB3AzAMxnOVDoEQgXlblEZBrciXvjQ1oFkEBodPX3UDr7iU2b9pArn6bVCpC9bWyG0uYL2DtBSWZGZDbehKyNbyA/RVNqtMqcHJkT26RXk4igeXpG5DLShl/u0NKmj8rEFZPAcb7mYkxGQUty7AbTAuj0QZeJ505uT7E4PP63D+E=
---

# SimpleTextReader 浏览器扩展检查报告

> 检查日期：2026-06-28
> 项目根：`D:\simplereader`
> 扩展代码目录：`client/`，Manifest 文件目录：`client/manifests/`

---

## 一、整体结构

```
client/
├── manifests/
│   ├── Chrome/manifest.json      # Chrome 扩展 (Manifest V3)
│   ├── Firefox/manifest.json     # Firefox 扩展 (Manifest V2)
│   ├── PWA/manifest.json         # PWA 清单
│   └── README.md
├── app/extension/
│   ├── activate.js               # Background Service Worker / Background Script
│   ├── contentScript.js          # Content Script（拦截 file://*.txt）
│   └── README.md
├── images/
│   ├── icon24.png                ✅ 存在
│   ├── icon64.png                ✅ 存在
│   ├── icon128.png               ✅ 存在
│   └── icon.png                  ✅ 存在
├── css/                          # 阅读器 UI 样式
├── app/modules/                  # 前端核心模块（阅读/书架/设置等）
└── index.html                    # 扩展打开后的主页面
```

---

## 二、Chrome 扩展（Manifest V3）✅ 已就绪

| 检查项 | 状态 | 说明 |
|---|---|---|
| **Manifest 版本** | **V3** (3) | 符合 Chrome 当前要求 |
| **version** | 1.6.12 | 版本号与 Firefox 一致 |
| **background** | `service_worker` + `"type": "module"` | V3 标准写法，使用 ES Module |
| **action** | `{}`（空对象） | 图标点击由 `activate.js` 中 `api.action.onClicked` 动态绑定 |
| **content_scripts** | 注入 `file://*/*.txt*` | 匹配所有本地 txt 文件，`all_frames: true`，`run_at: document_start` |
| **CSP** | `extension_pages` 对象格式 | `script-src 'self' 'wasm-unsafe-eval'`；`font-src` 含远程字体 CDN |
| **permissions** | `["storage"]` | 仅需 `storage`，最小权限原则 |
| **minimum_chrome_version** | 88 | Chrome 88 于 2021 年发布，覆盖范围足够 |
| **icons** | 24/64/128 px，路径均指向 `client/images/` | ✅ 三个文件均存在 |
| **homepage_url** | GitHub 仓库链接 | 有效 |

### Chrome 结论
可直接在 `chrome://extensions` 以"加载已解压的扩展程序"方式加载，指向 `D:\simplereader\client\manifests\Chrome`（manifest 内路径以 `client/` 为前缀，需从项目根 `D:\simplereader` 加载）。**无需任何修改即可运行。**

---

## 三、Firefox 扩展（Manifest V2）⚠️ 需迁移

| 检查项 | 状态 | 说明 |
|---|---|---|
| **Manifest 版本** | **V2** (2) | Firefox 仍支持 MV2（与 Chrome 不同，Mozilla 不强制淘汰），可继续使用 |
| **version** | 1.6.12 | 与 Chrome 一致 |
| **background** | `"scripts": [...]` + `"type": "module"` | **问题①**：`"type": "module"` 在 MV2 的 `background.scripts` 中不被 Firefox 支持，Firefox 对背景页使用 `type: module` 仅在 MV3 中有效 |
| **browser_action** | 已废弃 | **问题②**：MV3 中应改为 `action`，`browser_action` 已被 Chrome/Firefox 标记为 deprecated |
| **content_scripts** | 同 Chrome | 注入 `file://*/*.txt*`，一致 |
| **CSP** | 字符串格式 | **问题③**：MV3 要求 CSP 为对象格式（如 Chrome manifest 中的 `extension_pages`），Firefox MV3 也要求此格式 |
| **permissions** | `["storage"]` | ✅ |
| **icons** | 同 Chrome | ✅ 文件存在 |

### Firefox 迁移到 MV3 需要修改的内容

1. `manifest_version`：`2` → `3`
2. `background`：从 `{ "scripts": [...], "type": "module" }` 改为 `{ "service_worker": "client/app/extension/activate.js", "type": "module" }`——与 Chrome 一致
3. `browser_action`：改为 `action`——与 Chrome 一致
4. `content_security_policy`：从字符串改为对象格式 `{ "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; font-src 'self' https://fontsapi.zeoseven.com blob:" }`——与 Chrome 一致
5. 完成后 Chrome 和 Firefox 可共用同一份 `manifest.json`

### Firefox 当前可加载性

Firefox 仍接受 V2 扩展，但 `"type": "module"` 在 Firefox MV2 background.scripts 中会被忽略/报错。如果需要修复，最简方案是直接复用 Chrome 的 manifest.json。

---

## 四、PWA Manifest 

| 检查项 | 状态 |
|---|---|
| `name` | "易笺" |
| `display` | `standalone` |
| `start_url` | `../../../index.html`（相对路径指回项目根） |
| `icons` | 768x768 PNG |

PWA manifest 结构简洁有效，配合项目根的 `index.html` 和 Service Worker（如有注册）即可作为 PWA 运行。

---

## 五、扩展代码分析

### `activate.js`（Background）

- 同时兼容 `chrome.*` 和 `browser.*` API
- 图标点击：打开 `index.html` 作为新标签页
- 消息监听：接收 content script 发的 `replaceCurrentTab` 消息，将当前 txt 标签页替换为阅读器页面并传递文件内容
- 使用 `storage.local` 标记 `openedAsNoUI` 状态协调标签替换流程

### `contentScript.js`（Content Script）

- 仅注入 `file://*/*.txt*` 匹配的页面
- 检测 URL 是否以 `.txt` 结尾并验证 Content-Type
- 隐藏浏览器默认的 txt 渲染（pre 标签），提取文本内容
- 将内容转 Base64 后通过 `runtime.sendMessage` 发给 background
- 对 Dropbox 等下载链接的 `?dl=0` 参数做了排除处理

### API 兼容性

两个脚本都检测 `chrome` vs `browser` 命名空间，在 Firefox 中也能正常工作。无需修改。

---

## 六、总结

| 平台 | 状态 | 建议 |
|---|---|---|
| **Chrome** | ✅ 就绪 | 直接加载使用，无需任何修改 |
| **Firefox** | ⚠️ 需修复 | 当前 V2 Manifest 有 `type: module` 兼容问题，可继续用 V2 但需去掉 `type: module`；或直接复用 Chrome 的 V3 manifest |
| **PWA** | ✅ 就绪 | 基本可用，如需完整离线可在 index.html 中注册 Service Worker |

**一键修复方案**：Firefox 的 `manifests/Firefox/manifest.json` 可直接用 Chrome 的 `manifest.json` 替换（两者扩展行为完全一致），仅需注意 Firefox 对 `action` 的 API 支持始于 Firefox 109。
*（内容由AI生成，仅供参考）*
