<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

<a href="https://reader.yijian.app" target="_blank">
    <img width="200" src="assets/0_logo.png" alt="SimpleTextReader Logo" />
</a>

<br/>

<a href="https://opensource.org/licenses/MIT" target="_blank">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
</a>

<br/><br/>

<a href="README.md">中文</a> | <a href="README_EN.md">English</a>

</div>

SimpleTextReader is a clean, elegant TXT/EPUB reader that enhances plain text books with a refined reading experience.

This project is based on [henryxrl/SimpleTextReader](https://github.com/henryxrl/SimpleTextReader) (original) and [cataerogong/SimpleTextReader](https://github.com/cataerogong/SimpleTextReader) (enhanced fork), combining features from both and adding EPUB support.

![Main UI](assets/0_intro_en.png)

## Feature Origins

Features in this project come from three sources:

### Original Features (henryxrl)

Core features from [henryxrl/SimpleTextReader](https://github.com/henryxrl/SimpleTextReader):

1. Instant large file opening with automatic encoding detection
2. Auto detection of book title and author name (`《书名》作者：作者名.txt`, `Bookname by author.txt`, etc.)
3. Automatic chapter title detection via regex; manual marking with `[::]`
4. Auto extraction of footnotes (① to ㊿)
5. UI language auto-switches based on file content (Chinese/English)
6. Automatic ad removal from text
7. Auto-generated title page with book seal stamp
8. Reading progress saved automatically (per-line precision)
9. Bookshelf with auto-generated cover art
10. Up to 3 custom fonts (TTF/OTF)
11. Twelve web fonts (requires internet)
12. Dark mode, PWA support
13. Infinite scroll mode (scroll past top/bottom edge to turn page)
14. Settings menu (font size, line height, theme color, etc.)
15. Browser history navigation

**Browser extensions** (Chrome / Firefox / Edge) are published by henryxrl, version v1.6.9.5:

- [Chrome Extension](https://chrome.google.com/webstore/detail/%E6%98%93%E7%AC%BA/dbanahlbopbjpgdkecmclbbonhpohcaf)
- [Firefox Extension](https://addons.mozilla.org/en-US/firefox/addon/yijian/)
- [Edge Extension](https://microsoftedge.microsoft.com/addons/detail/pabihehbdhldbdliffaddllmjlknmpak)

### Enhanced Features (cataerogong)

Enhancements from [cataerogong/SimpleTextReader](https://github.com/cataerogong/SimpleTextReader):

1. **Continuous Scroll (Flow Mode)**: Sliding-window renderer that dynamically loads/unloads content as you scroll, providing seamless reading without page breaks.
2. **Full-Text Search**: Regex-enabled search dialog with forward/backward navigation and match highlighting. Shortcut: `F`.
3. **Quick Jump (Go to Line)**: Jump by line number or percentage. Shortcut: `G`.
4. **Log Mode**: Simplified rendering for `.log` files — skips title detection, text optimization, and pagination. Auto-detected or manually toggled.
5. **Progress Bar**: Vertical slider in the sidebar for quick navigation. Works in both page and flow modes.
6. **Line Number Display**: `data-line-num` attribute on all content elements, toggled via settings.
7. **Reader Mode Setting**: Auto / Book / Log modes.

### New Features in This Project

Added by this repository (shisheng):

1. **EPUB Format Support**: JSZip decompression + OPF parsing + XHTML-to-structure conversion, feeding EPUB content into the existing TXT rendering pipeline. All TXT reading features (pagination, TOC, dark mode, fonts, bookshelf, progress) work automatically for EPUB files.
2. **EPUB Chapter-Based Pagination**: Spine-based chapter-level pagination replacing single-page rendering.
3. **EPUB TOC Mapping**: NCX/TOC entries mapped to line numbers for sidebar chapter navigation.
4. **EPUB Bookshelf Persistence**: EPUB files saved to bookshelf with progress restore on reopen.
5. **EPUB Language Detection**: Automatic language detection with UI language switching.
6. **Infinite Scroll Fix**: Original `isActivelyScrolling` check required `deltaY < 20` for 3 consecutive events — impossible with normal mouse wheels. Replaced with a 300ms idle timeout: page turns automatically after the user stops scrolling.

## Usage

### Add Books

Drag and drop **TXT or EPUB files** into the interface (batch import supported), or double-click to select files manually.

### Bookshelf Management

- Click a cover to open a book
- **Alt/Option + click** to force reprocess
- Filter bar at top for filtering; supports batch or individual deletion

### Reading Features

- Left sidebar TOC for chapter navigation
- **Arrow keys** to turn pages, or enable infinite scroll / continuous scroll mode
- **Page Up / Page Down** to jump between chapters
- **F** for full-text search, **G** for quick jump
- **Esc** to return to bookshelf

### Advanced Usage (Modifying TXT Source File)

#### Manually Marking Titles

Add `[::]` at the beginning of a line to designate it as a title:

```txt
[::] I am a chapter title!
```

#### Using Footnotes

Insert ① to ㊿ to reference footnotes. Footnote lines start with the corresponding symbol:

```txt
In the Northern Ocean①, there is a fish called Kun②.
① Northern Ocean: A vast sea, named for its deep and dark waters.
② Kun (kūn): Originally meant "fish fry," here used to mean a giant fish.
```

## Docker

```bash
# Basic
docker run -d --name simpletextreader \
-p 8866:8866 \
--restart unless-stopped \
henryxrl/simpletextreader:latest

# With library directory
docker run -d --name simpletextreader \
-p 8866:8866 \
-v /path/to/your/books:/app/books \
--restart unless-stopped \
henryxrl/simpletextreader:latest
```

## URL Parameters (Debug)

Append `?param` to the URL; use `&` for multiple parameters:

| Parameter | Description |
|---|---|
| `no-bookshelf` | Disable bookshelf |
| `no-settings` | Disable settings menu |
| `no-fast-open` | Disable fast open (wait for full processing) |
| `no-pagebreak-on-title` | Page break by line count instead of chapters |
| `always-process` | Force reprocess on every open |
| `print-db` | Print database contents |
| `upgrade-db` | Manually upgrade database |

---

### This project is only for personal use and learning purposes, not for commercial use.
