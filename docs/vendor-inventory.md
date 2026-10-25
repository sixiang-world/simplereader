# 浏览器第三方脚本清单

范围是当前 `client/lib/` 中实际随静态产物分发的脚本。版本仅在本地文件包含可识别版本头时登记；“未确认”不代表最新版或存在漏洞。下表来源为文件头和已有 `client/lib/README.md` 的项目链接，不声称已与远端发布文件逐字节核验。

| 本地路径（相对 client/lib） | 本地确认版本 | 已知来源 / 备注 |
| --- | --- | --- |
| `jquery.min.js` | 3.6.4 | 文件头；https://jquery.com/ |
| `jszip.min.js` | 3.10.1 | 文件头；https://github.com/Stuk/jszip |
| `sweetalert2.js` | 11.17.2 | 文件头；https://github.com/sweetalert2/sweetalert2 |
| `tippy/popper.min.js` | @popperjs/core 2.11.8 | 文件头；https://github.com/floating-ui/floating-ui （Popper 历史项目） |
| `tippy/tippy-bundle.umd.min.js` | 未确认 | https://github.com/atomiks/tippyjs |
| `yaireo/color-picker.js` | 0.12.0 | 文件头；https://github.com/yairEO/color-picker；**含本地补丁**（见下） |
| `yaireo/position.js` | 1.1.1 | 文件头记录 `/npm/@yaireo/position@1.1.1/dist/position.umd.js` |
| `jschardet.min.js` | 未确认 | https://github.com/aadsm/jschardet；不能用 npm 锁定版本推定该手工文件的版本 |
| `hyperlist.js` | 未确认 | https://github.com/tbranyen/hyperlist |
| `ipad-cursor.js` | 本项目改编，无可确认上游版本 | 现有 README 标注改编自 https://github.com/rikumi/imouse |
| `clamps.js` | 本项目重写，无可确认上游版本 | 现有 README 标注 https://github.com/laurenashpole/clamps |
| `css-global-variables.js` | 本项目重写，无可确认上游版本 | 文件头及 README；https://github.com/colxi/css-global-variables |
| `css-filter-gen.js` | 本项目改编，无可确认上游版本 | README 标注 https://stackoverflow.com/a/43960991/604861 和 https://gist.github.com/Prottoy2938/7ff636330f2eec9bfeee56a49d6471e4 |
| `opencc/full.js` | 由安装的锁定 `opencc-js` 版本生成 | https://github.com/nk2028/opencc-js；`build-tools/fetch-opencc-bundle.mjs` 直接从 `node_modules/opencc-js/dist/umd/full.js` 比较并复制实际字节 |

`npm audit` / `pnpm audit` 只检查锁定依赖图，不覆盖上述手工脚本。因此清理 npm 公告不能表述为已验证所有浏览器供应商代码。

## 本地文件身份摘要（2026-10-25，D04）

sha256 前 16 位（完整摘要可随时重算：`sha256sum client/lib/<path>`）。此表锚定**文件身份**，
不等于上游可信来源验证：

| 路径（相对 client/lib） | sha256（前 16 位） | 字节 |
| --- | --- | --- |
| `clamps.js` | 9a1178bcfc8810d1… | 7571 |
| `css-filter-gen.js` | 18bc812f43efdc5b… | 9165 |
| `css-global-variables.js` | 04f9c96506a1ab00… | 12791 |
| `hyperlist.js` | 779f27058b285c97… | 8168 |
| `ipad-cursor.js` | 44ba145667f200ca… | 29760 |
| `jquery.min.js` | cf5e50b1ac962ec1… | 89795 |
| `jschardet.min.js` | 458080dc0fd1d370… | 342395 |
| `jszip.min.js` | f12f367798e35ee2… | 97642 |
| `opencc/full.js` | 5c03eeb066018546… | 1182099 |
| `sweetalert2.js` | 129e3800acc411ec… | 74930 |
| `tippy/popper.min.js` | 75c98720c1e18252… | 20128 |
| `tippy/tippy-bundle.umd.min.js` | d91ae4e6ab6a94e4… | 25719 |
| `yaireo/color-picker.js` | 08223d8e20a07ab9… | 15272 |
| `yaireo/position.js` | 91af81290e4f0fee… | 5640 |

### 版本核实尝试记录（2026-10-25）

- **jschardet.min.js**：与 unpkg 上 npm dist 的 2.3.0 / 3.0.0 / 3.1.0 / 3.1.2 /
  3.1.3 / 3.1.4 逐一字节比对均不匹配（本地 342395 B，npm 3.1.4 为 341716 B）。本地
  文件不是任何已发布的 npm dist 构件，版本维持"未确认"；最近属 3.1.x 家族。
  升级路径：改为从锁定依赖 `jschardet` 的 dist 构建分发（classic script 契约不变）。
- **tippy-bundle.umd.min.js**：本网络环境下 unpkg 对 tippyjs 全部版本返回 26 字节
  错误桩、jsdelivr 返回"Failed to fetch version info"错误桩，未取得真实上游构件，
  比对未完成，版本维持"未确认"。后续在网络可达环境重试。
- **hyperlist.js**：npm 只发布未压缩构建（hyperlist@1.0.0 dist 为 17013 B），本地
  为 8168 B 的独立压缩构建，无对应 npm 构件，版本维持"未确认"，来源指向
  https://github.com/tbranyen/hyperlist 。

## 本地补丁记录

### `yaireo/color-picker.js`（0.12.0）

上游 0.12.0 的 `bindEvents` 为每个实例在 `document.body`（click）、`window`（keydown、
storage）上注册匿名 bound 监听，且不提供任何 teardown。设置菜单每次真实重建
（如 `customFontsLoaded`）都会永久泄漏一组监听与 observer。

本地最小适配补丁（2026-10-25，随 B02）：

1. `bindEvents` 把 bound 监听存到 `this._srListeners`（原注册行为不变）。
2. 新增 `destroy()`：解绑上述 document/window 监听并移除 `DOM.scope`。

上游若发布带官方 teardown 的版本，升级时应以官方实现替换本补丁。
行为验证：`test/browser-color-picker-lifecycle.mjs`（destroy 后 click/Escape 不再
触发 `onClickOutside`；补丁缺失时该测试失败）。

## 更新约定

1. 一次只更新一个供应商库；记录精确版本、许可、发布地址和本项目改编差异。
2. 来自包管理器的构件使用受锁文件 integrity 保护的安装结果；供应商手工文件应先与上游受信任发布物核验再记录摘要。
3. 本地 `sha256sum client/lib/<file>` 只能证明当前文件的身份，不能替代上游完整性验证。本清单没有编造权威摘要。
4. OpenCC 安装时若缺失锁定依赖则失败，不从未经摘要比对的 CDN 回退，不让旧副本掩盖依赖丢失。
5. 更新后运行 `sh build-tools/validate.sh`，验证开发与生产阅读、EPUB、脚注、字体和对应库功能。固定路径资源必须重新验证缓存；只有带内容 hash 的 `/assets/*` 可长期 immutable。
