# EPUB 图片还原开发方案（任务 TODO + 实现细节）

> **文档状态**：Phase 1+2 已完成并合入 dev；Phase 3/4 待启动
> **创建日期**：2026-09-03
> **最后更新**：2026-09-04（Phase 1 完成，含两轮独立测试与代码审查）
> **基线**：`dev` @ `e1b79f9`（v2.2.0）
> **Phase 1 提交**：`74380b8`（功能）→ `a6901ee`（第一轮 Bug 修复）→ `814251d`（第二轮审查修复）→ `2995227`（CI 修复）
> **目标**：还原 EPUB 阅读体验——以**图片还原**为核心（当前最大缺口），辅以样式保真与脚注还原

---

## 一、背景与现状（代码核实结论）

### 1.1 已还原能力（v2.2.0）
标题层级、段落、列表（嵌套）、引用块、代码/预格式化、表格、行内格式（`em/strong/a/b/i/u/sub/sup/small/mark/span/br`）、元数据（书名/作者/出版社/日期/语言/封面）、目录（EPUB3 nav / EPUB2 NCX）、分页、转换进度/缓存。

### 1.2 最大缺口：图片被完全丢弃（代码实证，已修复）
`epub-converter.js` 在**两个位置**直接跳过图片（Phase 1 已修复）：

| 位置 | 原行为 | 修复后 |
|------|--------|--------|
| `#processSpine` block walker | skip 列表含 `img/figure/figcaption` | 移除，img/figure 生成独立图片块 |
| `#extractInlineHtml` | `if (tag === "img") continue;` | 改为内联 data URL 渲染 |

渲染层 `text-processor-dom.js` 的 `#sanitizeHtml` `allowedTags` 原不含 `img`（Phase 1 已加入 img/figure/figcaption + data URL 白名单）。

### 1.3 其他缺口（未启动）
- **EPUB 样式**：`style` 标签丢弃；`class` 只允许 6 个白名单类
- **脚注**：`epub:type="footnote"`/`noteref` 未接入现有脚注机制
- **跨章节链接跳转**：行内 `<a href>` 保留但跨 spine 跳转未打通

### 1.4 有利条件（技术底座已具备）
- **ZIP 已解压**：`JSZip.loadAsync` 后图片字节可直接提取
- **数据管道统一**：转换产物进入 `htmlLines`，渲染/分页/TOC/进度全部自动兼容
- **缓存有版本位**：`EPUB_CONVERTER_VERSION` 已 bump 1→2，旧缓存自动失效重转
- **图片渲染有安全落地**：`sanitizeHtml` 白名单模型，img 仅放行 `data:image/*;base64`

---

## 二、总体设计

### 2.1 核心思路：图片资源内联进 chunks

不新增独立的资源管理系统，把图片以 **data URL** 内联进对应行元素的 `content` HTML：

```
EPUB zip → 预构建 imageRegistry (src→dataURL) → 同步 walker 内联 → htmlLines[].content
                                          ↓
                          FILE_CONTENT_CHUNKS（含图片）→ 分页/渲染/书架缓存全兼容
```

**优点**：零新增存储结构，书架 IndexedDB 缓存直接复用，T2S、进度、分页全部自动工作。
**代价**：EPUB 图片总量较大时 chunks 体积膨胀（base64 +33%）。跨章节重复引用已通过 globalImageCache 去重。

### 2.2 元素模型（已实现）

```js
// 独立图片块（figure 或独立 img）
{
    type: "image",
    tag: "figure",          // 或 "img"
    content: `<figure><img src="data:image/jpeg;base64,..." alt="..."><figcaption>...</figcaption></figure>`,
    charCount: 25,          // 等效行权重 = MAX_CHARS/MAX_LINES (2500/100)
    lineNumber,
    elementType: "img",
    source: "epub",
}
```

**设计决策（已落地）**：
- 独立成块的 `<figure>`/`<img>` → `type:"image", elementType:"img"` 块
- 段落**内嵌**的小图 → 保留在行内 content，charCount 追加等效行权重
- 外部图片 URL（http/https///）一律不加载（隐私/防跟踪）
- `data:` URL 仅放行 `data:image/*;base64`，非图片 data URL 在 converter 层和 sanitize 层双重拦截

### 2.3 分页策略（已实现）

| 场景 | 策略 |
|------|------|
| 独立图片块 | charCount=25（等效一行），行计数模式 `charCount>0` 自然计 1 行 |
| 行内小图 | 段落 charCount 追加 `imgCount × 25` |
| 断页 | ✅ 图片触发断页时断点前移到图片前（T6，Phase 2 已实现） |

---

## 三、任务 TODO（分阶段）

### Phase 1：图片能显示（P0，核心收益）✅ 已完成

- [x] **T1. 转换器提取图片资源**
  - 实现方式：在 `#processSpine` 中预构建 per-spine-file 的 `imageRegistry`（src→dataURL map），再传入同步 walker（因 `#processXhtml` 是同步函数，无法在内部异步读 zip）
  - 新增 `#buildImageRegistry(zip, manifest, opfPath, filePath, xhtml, globalCache)`：扫描 img，跳过 data:/blob:/外部 http，用 `#resolveHref` 解析后从 zip 提取 base64
  - 跨章节重复引用通过 `globalImageCache` 去重（`#processSpine` 局部变量，无跨书籍污染）
  - MIME 优先用 OPF manifest 声明的 media-type（全路径匹配，非 basename），扩展名推断作 fallback

- [x] **T2. 转换器保留 img/figure 元素**
  - block walker：img/figure/figcaption 从 skip 列表移除；`picture` 加入递归容器列表
  - `#extractInlineHtml`：img 分支调用 `#renderInlineImage` 输出安全 img；开头加 img 根元素守卫（修复列表项/表格 cell 中 img 被误传导致丢失）
  - 新增 `#extractImageBlock`：处理独立 img/figure，figure 用 `querySelectorAll("img")` 提取所有层级 img（含嵌套 figure），保留 figcaption
  - 新增 `#renderInlineImage`：输出只含 src/alt/title 的安全 img，data URL 仅放行 `data:image/` 前缀
  - 新增 `#guessImageMime`：png/jpg/gif/webp/avif/bmp/svg
  - 空元素守卫放行含 img 的容器（修复 `<p><img/></p>` 丢失）

- [x] **T3. 渲染层允许 img**
  - `#sanitizeHtml` allowedTags 加入 img/figure/figcaption
  - img src 白名单正则：`/^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg+xml);base64,[a-z0-9+/=]+$/i`
  - 外部 http / javascript: / 非 base64 data / data:text/html 全部剥离
  - `createDOM` 新增 `case "image"`：渲染 `<div class="epub-image-block" data-source="epub">`
  - `reader.css` 新增 `.epub-image-block` 样式（max-width:100%, height:auto, figcaption 居中）

- [x] **T4. 分页容纳图片**
  - 独立图片块 charCount=25（等效行权重），行模式自然计 1 行，字符模式直接消费 25 字符
  - 行内图片段落 charCount 追加 `imgCount × 25`
  - 移除了 pagination-calculator 中 `elementType==="img"` 的特殊分支（数据模型已自洽，无需额外处理）

- [x] **T5. 缓存版本升级**
  - `EPUB_CONVERTER_VERSION: 1 → 2`
  - bookshelf.js 版本比对逻辑已验证，旧缓存自动触发重转

### Phase 2：分页精确 + 健壮性（P1）✅ 已完成（commit 593c8f4）

- [x] **T6. 图片分页精确化**
  - ✅ 图片块不拦腰截断：线性搜索 + jump 搜索两分支均在图片触发断页时将断点前移到图片之前（pagination-calculator.js）
  - ✅ 超大图处理：CSS 增加 max-height:80vh + object-fit:contain + width:auto
  - ✅ 单元测试验证断点精确落在图片索引处

- [x] **T7. 资源缺失容错**
  - ✅ 缺失图片降级为 `<span class="epub-image-missing">[图片缺失：alt]</span>` 虚线框占位（epub-converter.js #renderInlineImage）
  - ✅ 覆盖独立图、段落内嵌图、figure 图三种场景
  - ✅ sanitize 白名单增加 epub-image-missing class
  - ⏳ 超大图片（>2MB base64）blob URL 方案：后续迭代评估（当前 globalCache 去重已缓解体积膨胀）

- [x] **T8. 测试补充**
  - ✅ `test/test-epub-images.mjs`：25 个用例（Phase1 19 + Phase2 6）
  - ✅ 分页图片不截断用例（断点精确 = 图片索引）
  - ✅ 缺失图片占位 3 场景 + sanitize class + 正常图无回归
  - ✅ 真实浏览器端到端验证（缺失占位虚线框渲染、控制台 0 错误）

### Phase 3：样式保真 + 脚注还原（P2）⏳ 待启动

- [ ] **T9. 样式保真（有限子集）**
  - `#sanitizeHtml`：允许受控的 `style` 属性白名单（text-align/margin/font-style/font-weight 值级校验）
  - 扩展 `SAFE_CLASSES`：补充 EPUB 常见排版类（indent/center/caption）
  - `style` 标签内容：评估是否解析关键规则为内联样式

- [ ] **T10. 脚注还原**
  - 识别 `epub:type="footnote"`、`<aside>`、noteref 链接
  - 映射到现有 `FOOTNOTES`/`FOOTNOTE_PROCESSED_COUNTER` 机制
  - 注文与注脚链接双向可达

- [ ] **T11. 跨章节链接跳转**
  - 行内 `<a href="chapter2.xhtml#sec1">` → 利用 `fragmentToLine`/`fileToLine` 映射实现跳转

### Phase 4：收尾（P3）⏳ 待启动

- [ ] **T12. SVG 与特殊格式兜底**
  - 内联 `<svg>` 元素当前在 skip 列表中（仅支持 `<img src="foo.svg">` 文件引用）
  - 评估提取 SVG 内部 XML 为内联 SVG（需脚本净化）或降级 alt 占位

- [ ] **T13. 文档与发布**
  - 更新 README 特性说明
  - 中英文界面验证、性能验证（大图 EPUB）
  - 回归：`pnpm run typecheck` + `pnpm run test` 全绿

---

## 四、关键实现细节（已落地）

### 4.1 图片提取流程（T1/T2）

由于 `#processXhtml` 是同步函数而图片提取需异步读 zip，采用**预构建 registry 传参**设计：

```js
// #processSpine 中（异步上下文）
const globalImageCache = {};  // 跨章节去重
for (const item of spine) {
    const imageRegistry = await this.#buildImageRegistry(
        zip, manifest, opfPath, effectivePath, xhtml, globalImageCache
    );
    const result = this.#processXhtml(xhtml, lineNumber, effectivePath, fragmentToLine, imageRegistry);
    // ...
}

// #buildImageRegistry 内
for (const img of doc.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (/^(data:|blob:|https?:|\/\/)/i.test(src)) continue;  // 跳过内联/外部
    const abs = this.#resolveHref(src, filePath);
    if (globalCache[abs]) { registry[src] = globalCache[abs]; continue; }
    const file = zip.file(abs);
    const mime = this.#lookupManifestMediaType(manifest, opfPath, abs) || this.#guessImageMime(abs);
    const b64 = await file.async("base64");
    registry[src] = `data:${mime};base64,${b64}`;
    globalCache[abs] = registry[src];
}
```

### 4.2 sanitizeHtml 的 img 白名单（T3）

```js
// allowedTags 新增："img", "figure", "figcaption"

// img 分支：仅放行严格的 data:image/*;base64
if (tag === "img") {
    const src = node.getAttribute("src");
    if (src && /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(src)) {
        el.setAttribute("src", src);
    }
    // alt/title 保留；其余属性（onerror/onload/style/width）一律丢弃
}
```

> SVG data URL 通过 `<img src>` 加载，浏览器强制沙箱（脚本不执行），安全。

### 4.3 分页处理（T4）

图片块 charCount 统一为 `Math.max(1, Math.round(MAX_CHARS / MAX_LINES))` = 25：
- 行计数模式：`charCount > 0` 计 1 行
- 字符计数模式：直接消费 25 字符预算
- 行内图片段落：`charCount += imgCount × 25`（在 `#processXhtml` return 前统一处理，正则 `/<img\s[^>]*>/g` 计数，文本已 HTML 转义故无误匹配）

### 4.4 安全纵深防御

| 层级 | 防护 |
|------|------|
| Converter `#buildImageRegistry` | 跳过 http/https/blob/data: src，仅提取 zip 内图片 |
| Converter `#renderInlineImage` | 仅放行 `data:image/` 前缀，非图片 data URL 丢弃 |
| Converter `#escapeHtml` | src/alt/title 全量 HTML 转义 |
| Renderer `#sanitizeHtml` | img src 严格正则校验，仅 data:image/*;base64；事件属性/style 全部剥离 |
| T2S | 跳过 `type:"image"` 块，避免对 base64 做不必要处理 |
| Search | 跳过 `type:"image"` 块，避免 base64 误报匹配 |

---

## 五、已知限制与功能取舍

| 限制 | 说明 | 优先级 |
|------|------|--------|
| 嵌套 figure 内层 figcaption 丢失 | figure 用 querySelectorAll 提取所有 img，但 figcaption 仅从直接子节点提取 | 低（罕见结构） |
| T2S 不转换 figcaption/alt 繁体字 | image 块被整体跳过，避免 base64 处理浪费；繁体字保留 | 低（可后续仅提取文本转换） |
| 搜索不匹配 alt/figcaption 文本 | image 块被整体跳过，避免 base64 误报 | 低（可后续建非 base64 文本索引） |
| 图片前不断页优化 | 图片可能跨页截断 | P1（T6） |
| 缺失图片无占位 | 虚线框 + alt 占位（T7） | ✅ 已实现 |
| 内联 SVG 元素不支持 | 仅支持 `<img src="*.svg">` 文件引用 | P3（T12） |
| CSS background-image 不支持 | 仅 `<img>` 标签图片 | 低（设计范围外） |

---

## 六、风险与边界

| 风险 | 缓解 | 状态 |
|------|------|------|
| 大图 EPUB 内存/体积膨胀 | data: 内联（Phase1）→ 超限转 blob（Phase 2/3） | 已缓解（globalCache 去重） |
| SVG 携带脚本的 XSS | `<img>` 中 SVG 浏览器强制沙箱；sanitize 正则严格 | 已解决 |
| 图片跨页截断 | 分页断点优先图片前（T6） | ✅ 已实现 |
| 分页计算器回归 | 补测试；全量 25 测试文件通过 | 已验证 |
| 书架缓存读到旧格式 | EPUB_CONVERTER_VERSION bump 自动失效 | 已解决 |
| 扩展环境 localStorage 限制 | 图片 data URL 存在 chunks（IndexedDB），无冲突 | 已验证 |

---

## 七、验收清单

- [x] 打开带插图 EPUB，图片正常显示、居中、不溢出
- [x] 图注（figcaption）显示；alt 属性保留
- [x] 图片 EPUB 的翻页、目录跳转、进度、书架缓存均正常
- [x] 外部 URL 图片/恶意 SVG/非图片 data URL 不加载（安全）
- [x] 纯文字 EPUB 与 TXT 阅读不受影响（回归）
- [x] `pnpm run typecheck` 无错，`pnpm run test` 全绿（25 文件）
- [x] 列表项/段落/figure/嵌套 figure/picture 中图片均不丢失
- [x] T2S 不破坏图片块 base64
- [x] 搜索不误命中 base64
- [x] 图片不跨页截断（T6，已实现）
- [x] 缺失图片有占位提示（T7，已实现）
- [ ] 中英文界面验证
- [ ] 真实浏览器端到端验证（大图内存、IndexedDB 上限）
