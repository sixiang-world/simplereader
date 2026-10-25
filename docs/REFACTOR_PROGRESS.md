# dev 审查修复实施记录

基线 d7d4e5d。按用户要求，每个可独立验证的任务完成后提交并推送 origin/dev。任务之间存在共享文件时，以可验证的最小依赖闭包为提交单位；没有完成的验收不标完成。没有自动部署或合并main。

- T00：Node测试自动发现、Chromium回归入口、生产根/子路径启动与资源检查；更新受影响的Vite/XML解析构建依赖并同步双锁文件。
- 待集成：安全/UI、Worker/存储、BookData/EPUB、设置/启动、构建/发布和门禁。实施过程以各任务提交、对应回归和本文件后续记录为准。
- T01 已完成：目录/通知纯文本渲染与继承CSS属性防护；提交快照完整Node测试及真实Chromium安全回归通过。
- T04 已完成：Worker URL保留生产子目录前缀，7项真实解析函数行为检查通过；后续存储集成另有生产根/子目录往返验证。
- T03 文件Worker请求部分已完成：请求ID分发、错误/克隆失败/超时/取消清理、destroy终止；Node故障矩阵与真实Worker处理/取消回归通过。FileHandler所有权接入随BookData装载任务提交，DB部分随事务任务提交。
- EPUB转换任务（T10/T11解析部分/T12/T14及T19限额）：统一编码URI、最终索引与脚注采集，Node SVG和实际多页预处理，日志保真；限制解压流/节点/深度/行数并支持取消。独立提交快照构建与28个Node测试文件通过，包含真实ZIP和Node产物回归。读者导航/缓存接入在后续任务验证。
- T06 装载合约已完成：统一BookData快照/恢复/reset，持久化脚注与章节索引，converter缓存升4；统一mount，转换先于分页/保存/首次渲染，保存等待完成，TXT finally销毁Worker，取消旧load不污染新书。独立快照构建、29个Node文件与真实Chromium新导入/重开/切书取消回归通过。隐藏TOC等待有界，不再永久挂起。
- 存储一致性任务（T02/T03 DB/T07/T08/T09）已完成：语言元数据不擦缓存；读取快照/写入/删除跨store原子且以commit应答；6块以上事务修复与旧块清理；错误/timeout/dispose收敛、versionchange释放；转换失败保留原始File。字体等待load再注册/回收URL，书架启停清理监听。独立快照构建、Node suite与真实Chromium分块/故障回滚/原书保护/字体/根与子目录Worker往返通过。
- 阅读器任务（T11定位/T13及T19部分）已完成：canonical跨章/本章链接、纯文字脚注定位，TOC旧RAF与通知listener释放，flow文档身份与几何二分，await导航后文本节点高亮/完整清理，regex在可终止Worker中运行。独立快照构建/30个Node文件/10项真实UI浏览器回归/BookData装载回归通过；生产子路径搜索Worker验证通过。flow仍为累积DOM，未未经基准引入裁剪。
- 设置/启动任务（T15/T16/T17/T18）已完成：统一schema解析与纯状态过渡、同值timestamp推进、拉取错误判别、顺序推送GET合并、canonical语言（含最早启动阶段）、运行时T2S、once及preset边界；字体不阻塞核心启动/合帧通知/加载中选择器降级。独立快照32个Node文件及真实Chromium设置、慢字体、刷新语言、生产根/子路径启动通过。首次快照发现启动仍读UILang的遗漏，已补回归并修复后复验。无CAS的并发同步仍有明确限制（docs/config-sync-contract.md），不宣称无损。
- T22实现已完成：Python构建无隐式部署/源版本修改、扩展输出隔离；durable claim/ACK/恢复、真实无sender.tab的reader页核验、模块就绪后处理、空文件和失败重试。独立快照构建/34个Node文件/6个Python回归/浏览器真实TXT处理(API传输stub)/Chrome与Firefox打包通过。真实扩展引擎验收受本机ExtensionInstallBlocklist企业策略阻塞，Playwright浏览器下载亦被网络域策略拒绝；未绕过策略。npm run test:extension与docs/EXTENSION_TESTING.md保留明确后续验收，不记为已通过。
- T05已完成：安装前复制postinstall/构建工具、Node22、静态运行镜像禁目录浏览；独立提交快照真实Docker构建成功，并启动Caddy容器验证页面/version/OpenCC/Worker HTTP。当前代理需BuildKit仅安装阶段挂可信CA+支持的proxy路由；TLS/签名校验始终启用。命令见docs/DOCKER_BUILD.md；test/docker-smoke.py可重复运行（DOCKER_IMAGE指定已构建镜像）。
