# 浏览器第三方脚本清单

范围是当前 `client/lib/` 中实际随静态产物分发的脚本。版本仅在本地文件包含可识别版本头时登记；“未确认”不代表最新版或存在漏洞。下表来源为文件头和已有 `client/lib/README.md` 的项目链接，不声称已与远端发布文件逐字节核验。

| 本地路径（相对 client/lib） | 本地确认版本 | 已知来源 / 备注 |
| --- | --- | --- |
| `jquery.min.js` | 3.6.4 | 文件头；https://jquery.com/ |
| `jszip.min.js` | 3.10.1 | 文件头；https://github.com/Stuk/jszip |
| `sweetalert2.js` | 11.17.2 | 文件头；https://github.com/sweetalert2/sweetalert2 |
| `tippy/popper.min.js` | @popperjs/core 2.11.8 | 文件头；https://github.com/floating-ui/floating-ui （Popper 历史项目） |
| `tippy/tippy-bundle.umd.min.js` | 未确认 | https://github.com/atomiks/tippyjs |
| `yaireo/color-picker.js` | 0.12.0 | 文件头；https://github.com/yairEO/color-picker |
| `yaireo/position.js` | 1.1.1 | 文件头记录 `/npm/@yaireo/position@1.1.1/dist/position.umd.js` |
| `jschardet.min.js` | 未确认 | https://github.com/aadsm/jschardet；不能用 npm 锁定版本推定该手工文件的版本 |
| `hyperlist.js` | 未确认 | https://github.com/tbranyen/hyperlist |
| `ipad-cursor.js` | 本项目改编，无可确认上游版本 | 现有 README 标注改编自 https://github.com/rikumi/imouse |
| `clamps.js` | 本项目重写，无可确认上游版本 | 现有 README 标注 https://github.com/laurenashpole/clamps |
| `css-global-variables.js` | 本项目重写，无可确认上游版本 | 文件头及 README；https://github.com/colxi/css-global-variables |
| `css-filter-gen.js` | 本项目改编，无可确认上游版本 | README 标注 https://stackoverflow.com/a/43960991/604861 和 https://gist.github.com/Prottoy2938/7ff636330f2eec9bfeee56a49d6471e4 |
| `opencc/full.js` | 由安装的锁定 `opencc-js` 版本生成 | https://github.com/nk2028/opencc-js；`build-tools/fetch-opencc-bundle.mjs` 直接从 `node_modules/opencc-js/dist/umd/full.js` 比较并复制实际字节 |

`npm audit` / `pnpm audit` 只检查锁定依赖图，不覆盖上述手工脚本。因此清理 npm 公告不能表述为已验证所有浏览器供应商代码。

## 更新约定

1. 一次只更新一个供应商库；记录精确版本、许可、发布地址和本项目改编差异。
2. 来自包管理器的构件使用受锁文件 integrity 保护的安装结果；供应商手工文件应先与上游受信任发布物核验再记录摘要。
3. 本地 `sha256sum client/lib/<file>` 只能证明当前文件的身份，不能替代上游完整性验证。本清单没有编造权威摘要。
4. OpenCC 安装时若缺失锁定依赖则失败，不从未经摘要比对的 CDN 回退，不让旧副本掩盖依赖丢失。
5. 更新后运行 `sh build-tools/validate.sh`，验证开发与生产阅读、EPUB、脚注、字体和对应库功能。固定路径资源必须重新验证缓存；只有带内容 hash 的 `/assets/*` 可长期 immutable。
