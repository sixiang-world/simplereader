# EPUB 图片还原开发方案（任务 TODO + 实现细节）

> **文档状态**：待办（开发计划，未写入代码）
> **创建日期**：2026-09-03
> **基线**：`dev` @ `e1b79f9`（v2.2.0，与 origin/dev、cnb/dev 同步）
> **目标**：还原 EPUB 阅读体验——以**图片还原**为核心（当前最大缺口），辅以样式保真与脚注还原

---

## 一、背景与现状（代码核实结论）

### 1.1 已还原能力（v2.2.0）
标题层级、段落、列表（嵌套）、引用块、代码/预格式化、表格、行内格式（`em/strong/a/b/i/u/sub/sup/small/mark/span/br`）、元数据（书名/作者/出版社/日期/语言/封面）、目录（EPUB3 nav / EPUB2 NCX）、分页、转换进度/缓存。

### 1.2 最大缺口：图片被完全丢弃（代码实证）
`epub-converter.js` 在**两个位置**直接跳过图片：

| 位置 | 行为 |
|------|------|
| `#processSpine` block walker（约 578 行） | `if (["script","style","svg","img","figure","figcaption"].includes(tag)) continue;` |
| `#extractInlineHtml`（约 902 行） | `if (tag === "img") continue;` |

渲染层 `text-processor-dom.js` 的 `#sanitizeHtml`（228 行）`allowedTags` **不含 `img`**——即使转换器保留 `<img>`，渲染时也会被剥掉。

### 1.3 其他缺口
- **EPUB 样式**：`style` 标签丢弃；`class` 只允许 6 个白名单类（`dropCap/first/noIndent/author/end-page/synthetic-page/title`）
- **脚注**：`epub:type="footnote"`/`noteref` 未接入现有脚注机制（`FOOTNOTES` 目前为空）
- **跨章节链接跳转**：行内 `<a href>` 保留但只作为锚点，跨 spine 文件跳转未打通

### 1.4 有利条件（技术底座已具备）
- **ZIP 已解压**：`JSZip.loadAsync` 后 `zip.files` 含全部资源，图片字节可直接提取（`async("base64")` 或 `async("uint8array")`）
- **数据管道统一**：转换产物进入 `FILE_CONTENT_CHUNKS`（`htmlLines` 数组），渲染/分页/TOC/进度全部自动兼容
- **缓存有版本位**：`CONST_FILE.EPUB_CONVERTER_VERSION`（现为 `1`），输出格式变更时 bump 即可让旧缓存失效重转
- **图片渲染有安全落地**：`sanitizeHtml` 是白名单模型，只需把 `img` 加入白名单 + 校验 `src` 协议（仅允许 `data:`/`blob:`）

---

## 二、总体设计

### 2.1 核心思路：图片资源内联进 chunks

不新增独立的资源管理系统，而是把图片以 **data URL** 内联进对应行元素的 `content` HTML。这样：

```
EPUB zip → 提取图片字节(base64) → 生成 data URL → 替换 <img src> → 存进 htmlLines[].content
                                          ↓
                          FILE_CONTENT_CHUNKS（含图片）→ 分页/渲染/书架缓存全兼容
```

**优点**：零新增存储结构，书架 IndexedDB 缓存直接复用（chunks 本身就是 HTML 字符串），T2S、进度、分页全部自动工作。
**代价**：EPUB 图片总量较大时 chunks 体积膨胀（可用 blob URL 缓解，见 §5 优化）。

### 2.2 元素模型扩展

新增一种元素类型，承载独立成块的图片：

```js
// 独立图片块（figure 或独立 img）
{
    type: "image",
    tag: "figure",          // 或 "img"
    content: `<figure><img src="data:image/jpeg;base64,..." alt="..."><figcaption>...</figcaption></figure>`,
    charCount: 0,           // 图片不计字符，但分页按"等效行"处理
    lineNumber,
    elementType: "img",     // 新 elementType，分页/渲染识别
    source: "epub",
}
```

**设计决策**：
- 独立成块的 `<figure>`/`<img>` → 新的 `elementType: "img"` 块，作为一整行参与分页
- 段落**内嵌**的小图（`<p>` 里的 `<img>`）→ 保留在行内 content，但需控制尺寸（`max-width`/`height:auto`），`charCount` 按原文本计
- 封面图已有独立通道（`metadata.coverHref`），本方案不重复处理，仅保证封面在书架/扉页正常显示

### 2.3 分页策略（关键设计）

当前 `PaginationCalculator` 按 `charCount`/行数断页。图片的处理：

| 场景 | 策略 |
|------|------|
| 独立图片块（elementType="img"） | 视为 1 行（等效 `charCount` 取 `MAX_CHARS/MAX_LINES` 的约 1/6，保证图片独占可容纳空间）；断页时优先在图片**前**断，避免拦腰截断 |
| 行内小图 | 不额外占行，随段落流动 |

具体改动点见 §3.3。核心原则：**先保证"能显示不崩版"，再优化"分页精确"**。

---

## 三、任务 TODO（分阶段）

### Phase 1：图片能显示（P0，核心收益）

- [ ] **T1. 转换器提取图片资源**
  - 文件：`client/src/modules/epub/epub-converter.js`
  - 在 `#processSpine` 解析 xhtml 时，扫描 `manifest` 中 `mediaType` 以 `image/` 开头的资源
  - 对 xhtml 中的 `<img src="...">`：用 `#resolveHref` 解析为 zip 绝对路径 → `zip.file(path).async("base64")` → 生成 `data:${mime};base64,...`
  - `src` 解析失败/资源缺失 → 保留占位（空 `alt` 或移除标签），不阻断转换

- [ ] **T2. 转换器保留 img/figure 元素**
  - block walker（578 行）：把 `img`、`figure`、`figcaption` 从 skip 列表移除，改为生成 `elementType:"img"` 的独立块
  - `#extractInlineHtml`（902 行）：移除 `if (tag === "img") continue;`，改为输出带 `data:` src 的 `<img>`
  - 新增辅助方法：`#extractImageNode(node, manifest, zip)`（解析 src→data URL，取 alt/title）
  - `charCount` 处理：独立图片块记 0（或等效值，见分页）

- [ ] **T3. 渲染层允许 img**
  - 文件：`client/src/modules/text/text-processor-dom.js`
  - `#sanitizeHtml` 的 `allowedTags` 加入 `"img"`、`"figure"`、`"figcaption"`
  - `img` 的 `src` 协议白名单：仅允许 `data:` 与 `blob:`（**禁止** `http/https/javascript` 等外部 URL，防跟踪/注入）
  - 强制安全属性：`alt`、`title` 允许；`onerror` 等事件属性一律丢弃（现有逻辑默认丢弃非白名单属性，安全）
  - 行渲染（115-132 行段落分支）：对含 `<img>` 的 EPUB 内容正常 sanitize 后插入

- [ ] **T4. 分页容纳图片（先防崩版）**
  - 文件：`shared/core/text/pagination-calculator.js`
  - `#countContentLines`/`#countContentChars`（约 554/587 行）：`elementType === "img"` 的行按"1 行 / 固定等效字符"计入
  - 断页点选择：图片块前优先断页（避免图片跨页截断），详见 §3.3
  - 注意：分页计算器是 shared 纯 JS，有 `test/test-text-processor-regex.mjs` 等测试，需补充图片分页用例

- [ ] **T5. 缓存版本升级**
  - 文件：`client/src/config/constants.js`
  - `EPUB_CONVERTER_VERSION: 1 → 2`（chunks 含图片后格式变更，旧缓存必须失效重转）
  - 确认 bookshelf.js 的版本比对逻辑（604 行）已覆盖此场景

### Phase 2：分页精确 + 健壮性（P1）

- [ ] **T6. 图片分页精确化**
  - 图片块不拦腰截断：断页算法识别 elementType="img"，把断点移到图片前
  - 超大图处理：CSS 强制 `max-width:100%; height:auto`，避免溢出版心
  - 流式阅读（flow-reader）与分页模式（reader）双路径验证

- [ ] **T7. 资源缺失容错**
  - 图片字节提取失败（zip 内文件损坏/缺失）→ 降级为占位（alt 文字 + 虚线框），不报错不崩版
  - 超大图片（如 >2MB base64）→ 策略：仍内联但警告，或 Phase 3 改为 blob URL

- [ ] **T8. 测试补充**
  - `test/test-epub-converter.mjs`：新增图片提取/内联用例（含 src 解析、缺失资源、svg 兜底）
  - `test/test-epub-rendering.mjs`：sanitize 后 img 保留、外部 src 被剥
  - `test/test-text-processor-regex.mjs` 或新增分页测试：图片分页不截断

### Phase 3：样式保真 + 脚注还原（P2）

- [ ] **T9. 样式保真（有限子集）**
  - `#sanitizeHtml`：允许受控的 `style` 属性白名单（如 `text-align`、`margin`、`font-style`、`font-weight` 的值级校验）
  - 扩展 `SAFE_CLASSES`：补充 EPUB 常见排版类（如 `indent`、`center`、`caption`）——需逐类评估防 CSS 劫持
  - `style` 标签内容：评估是否解析关键规则（如字体、缩进）为内联样式（低优先级）

- [ ] **T10. 脚注还原**
  - 识别 `epub:type="footnote"`、`<aside>`、`noteref` 链接
  - 映射到现有 `FOOTNOTES`/`FOOTNOTE_PROCESSED_COUNTER` 机制（当前 EPUB 路径强制置空，见 file-handler 978 行）
  - 注文与注脚链接双向可达

- [ ] **T11. 跨章节链接跳转**
  - 行内 `<a href="chapter2.xhtml#sec1">` → 利用已有 `fragmentToLine`/`fileToLine` 映射实现跳转

### Phase 4：收尾（P3）

- [ ] **T12. SVG 与特殊格式兜底**
  - `svg` 无法内联渲染 → 提取 `<svg>` 内部 XML 为内联 SVG 或降级 alt 占位
- [ ] **T13. 文档与发布**
  - 更新 `docs/` 记录、README 特性说明
  - 中英文界面验证、性能验证（大图 EPUB）
  - 回归：`pnpm run typecheck` + `pnpm run test` 全绿

---

## 四、关键实现细节

### 4.1 图片提取流程（T1/T2 核心）

```js
// 伪代码：在 processSpine 的 xhtml 解析中
static async #resolveImageSrc(imgEl, zip, manifest, xhtmlPath) {
    const src = imgEl.getAttribute("src");
    if (!src) return null;
    if (/^(data:|blob:)/i.test(src)) return src;          // 已是内联
    if (/^(https?:|//)/i.test(src)) return null;          // 外部图，不加载（隐私/防跟踪）
    const abs = this.#resolveHref(src, xhtmlPath);        // 复用现有 href 解析
    const file = zip.file(abs);
    if (!file) return null;                               // 缺失 → 占位
    const mime = file.name.split(".").pop()?.toLowerCase() === "png" ? "image/png"
              : /* 按扩展名映射 mime */;
    const b64 = await file.async("base64");
    return `data:${mime};base64,${b64}`;
}
```

### 4.2 sanitizeHtml 的 img 白名单（T3）

```js
// allowedTags 新增：
"img", "figure", "figcaption"

// img 分支（在 cleanNode 中，tag === "img" 时）：
const src = node.getAttribute("src");
if (src && /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml);base64,/i.test(src)) {
    el.setAttribute("src", src);
}
const alt = node.getAttribute("alt");
if (alt) el.setAttribute("alt", alt);
// 其余属性一律不复制（onerror/onload/width 等均丢弃）→ 安全
// 注意：不复制 width/height/style，尺寸由 CSS 统一控制
```

> **安全要点**：只允许 `data:image/*;base64,`。禁止 `data:image/svg+xml` 含脚本（SVG 需额外净化或排除），禁止外部 URL。

### 4.3 分页处理（T4/T6）

`pagination-calculator.js` 两个计数函数需识别图片块：

```js
// #countContentLines 中
const el = this.#contentChunks[i];
if (el.elementType === "img") {
    count += 1;   // 图片占 1 行
    continue;
}
```

断页优化（T6）：在断页候选点选择时，若 `contentChunks[breakPos].elementType === "img"`，则尝试前移断点到上一非图片位置，避免图片跨页截断。

### 4.4 缓存升级（T5）

`constants.js`：
```js
EPUB_CONVERTER_VERSION: 2,   // v1 → v2：chunks 含内联图片
```

### 4.5 性能考量（大图 EPUB）

- **默认策略**：`data:` base64 内联（实现最简单、缓存零改造）
- **大图优化（Phase 2/3）**：超过阈值（如单图 >500KB）的图片改用 `URL.createObjectURL(blob)`，在 chunks 中存 `blob:` 引用 + 单独的资源数组（需处理书架缓存：blob URL 无法跨会话持久化，需在读取缓存后重新生成）

> **权衡说明**：`data:` 内联可持久化、可缓存、实现最简，但增大 chunks 体积（base64 膨胀 ~33%）；`blob:` 省内存但需改造缓存与资源重建。**建议先做 data: 内联**，验证效果后再按需优化。

---

## 五、风险与边界

| 风险 | 缓解 |
|------|------|
| 大图 EPUB 内存/体积膨胀 | data: 内联（Phase1）→ 超限转 blob（Phase 2/3） |
| SVG 携带脚本的 XSS | svg 不进 img 白名单的 data 校验；需额外净化或排除 |
| 图片跨页截断 | 分页断点优先图片前（T6） |
| 分页计算器回归 | 补测试；计算器为 shared 纯 JS，改动影响 TXT/EPUB 全链路，需全量回归 |
| 书架缓存读到旧格式 | `EPUB_CONVERTER_VERSION` bump 使旧缓存自动失效（T5） |
| 扩展环境 localStorage 限制 | 图片 data URL 存在 chunks（IndexedDB），与 localStorage 无冲突 |

---

## 六、验收清单

- [ ] 打开带插图 EPUB，图片正常显示、居中、不溢出、不跨页截断
- [ ] 图注（figcaption）显示；alt 在图片缺失时可见
- [ ] 图片 EPUB 的翻页、目录跳转、进度、书架缓存均正常
- [ ] 外部 URL 图片/恶意 SVG 不加载（安全）
- [ ] 纯文字 EPUB 与 TXT 阅读不受影响（回归）
- [ ] `pnpm run typecheck` 无错，`pnpm run test` 全绿
- [ ] 中英文界面验证
