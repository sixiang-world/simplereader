<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

<a href="https://reader.yijian.app" target="_blank">
    <img height="150" src="assets/0_logo.png" alt="易笺 Logo" />
</a>

<br>

<a href="https://opensource.org/licenses/MIT" target="_blank">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
</a>

<br/><br/>

<a href="README.md">中文</a> | <a href="README_EN.md">English</a>

</div>

易笺是一款简单纯粹的 TXT/EPUB 阅读器，让朴素的纯文本书籍拥有精致优雅的阅读体验。

本项目基于 [henryxrl/SimpleTextReader](https://github.com/henryxrl/SimpleTextReader)（原版）和 [cataerogong/SimpleTextReader](https://github.com/cataerogong/SimpleTextReader)（增强版）开发，整合了两者的功能并新增了 EPUB 支持等特性。

![主界面](assets/0_intro_zh.png)

## 功能来源说明

本项目的功能来自三个部分，下面逐一标注来源：

### 原版功能（henryxrl）

原版 [henryxrl/SimpleTextReader](https://github.com/henryxrl/SimpleTextReader) 提供的核心功能：

1. 百兆文件秒开，支持自动识别文件编码
2. 中英文小说名、作者名自动识别（`《书名》作者：作者名.txt`、`书名.[作者].txt`、`Bookname by author.txt`）
3. 中英文标题正则自动识别，支持 `[::]` 手动标记标题行
4. 自动抓取脚注（① 到 ㊿）
5. 界面语言随文件自动切换（中/英）
6. 自动去除文字广告
7. 自动制作扉页与藏书章
8. 自动储存阅读进度（精确到行）
9. 书架功能，自动生成书籍封面
10. 最多 3 种自定义字体（TTF/OTF）
11. 十二款网络字体（需联网）
12. 暗黑模式、PWA 支持
13. 无限滚动模式（滚到底/顶后继续滚动翻页）
14. 设置菜单（字体大小、行高、主题颜色等）
15. 浏览器历史导航

**浏览器插件**（Chrome / Firefox / Edge）为 henryxrl 原版发布，版本号 v1.6.9.5：

- [Chrome 插件](https://chrome.google.com/webstore/detail/%E6%98%93%E7%AC%BA/dbanahlbopbjpgdkecmclbbonhpohcaf)
- [Firefox 插件](https://addons.mozilla.org/zh-CN/firefox/addon/yijian/)
- [Edge 插件](https://microsoftedge.microsoft.com/addons/detail/pabihehbdhldbdliffaddllmjlknmpak)

### 增强版功能（cataerogong）

来自 [cataerogong/SimpleTextReader](https://github.com/cataerogong/SimpleTextReader) 的增强特性：

1. **自动拼接模式（Auto-Join Mode）**：滑动窗口渲染器，滚动时动态加载/卸载页面内容，实现无缝连续阅读
2. **全文搜索**：支持正则表达式，向前/向后导航，匹配高亮。快捷键 `F`
3. **快速跳转**：按行号或百分比跳转。快捷键 `G`
4. **日志模式（Log Mode）**：为 `.log` 文件提供简化渲染——跳过标题检测、文本优化和分页，自动识别或手动切换
5. **进度条**：侧边栏垂直滑块，支持快速导航，兼容分页和自动拼接模式
6. **行号显示**：所有内容元素带 `data-line-num` 属性，通过设置开关切换
7. **阅读器模式设置**：自动/书本/日志三种模式可选

### 本项目新增功能

### 本项目新增功能

本仓库（shisheng）在上述基础上新增：

1. **EPUB 格式支持**：通过 JSZip 解压 + OPF 解析 + XHTML 结构转换，将 EPUB 内容接入现有 TXT 渲染管线。所有 TXT 阅读功能（分页、目录、暗黑模式、字体、书架、进度）对 EPUB 自动生效
2. **EPUB 章节分页**：基于 spine 的章节级分页，替代单页渲染
3. **EPUB 目录映射**：NCX/TOC 条目映射到行号，侧边栏可点击跳转
4. **EPUB 书架持久化**：EPUB 文件可保存到书架，支持重新打开时恢复进度
5. **EPUB 语言检测**：自动识别 EPUB 语言并切换界面
6. **无限滚动修复**：原版 `isActivelyScrolling` 判断条件过严（deltaY < 20），实际鼠标滚轮无法触发翻页。改为超时机制——阈值达到后 300ms 无新滚动事件即自动翻页

### 界面优化

- 移除设置面板中「阅读模式」「自动拼接」「显示行号」三项的冗长描述文字，界面更简洁
- 「连续滚动」更名为「自动拼接」

## 使用

### 添加书籍

将 **TXT 或 EPUB 文件**拖入界面（支持批量导入），或双击界面手动选择文件。

### 书架管理

- 点击封面打开书籍
- **Alt/Option + 点击** 强制重新处理
- 顶部筛选栏过滤书籍，支持批量或单本删除

### 阅读功能

- 左侧目录跳转章节
- **← → 方向键** 翻页，或开启无限滚动/自动拼接模式
- **Page Up / Page Down** 跳转上/下一章
- **F 键** 全文搜索，**G 键** 快速跳转
- **Esc** 返回书架

### 进阶使用（修改 TXT 源文件）

#### 手动标记标题

在任意行首添加 `[]` 标记，指定为标题行：

```txt
[::] 写在故事的最后
```

#### 使用脚注

插入 ① 到 ㊿ 引用脚注，脚注行以对应数字符号开头：

```txt
北冥①有鱼，其名为鲲②。
①北冥：北海，因海水深黑而得名。
②鲲（kūn）：本义鱼子，小鱼。
```

## Docker 部署

```bash
# 基础运行
docker run -d --name simpletextreader \
-p 8866:8866 \
--restart unless-stopped \
henryxrl/simpletextreader:latest

# 挂载图书库目录
docker run -d --name simpletextreader \
-p 8866:8866 \
-v /path/to/your/books:/app/books \
--restart unless-stopped \
henryxrl/simpletextreader:latest
```

## URL 参数（调试用）

在 URL 末尾添加 `?param`，多个参数用 `&` 连接：

| 参数 | 说明 |
|---|---|
| `no-bookshelf` | 禁用书架 |
| `no-settings` | 禁用设置菜单 |
| `no-fast-open` | 禁用快速打开（等处理完再显示） |
| `no-pagebreak-on-title` | 按行数分页而非按章节 |
| `always-process` | 强制每次打开都重新处理 |
| `print-db` | 打印数据库内容 |
| `upgrade-db` | 手动升级数据库 |

---

### 本项目仅用于学习交流使用，请勿用于商业用途
