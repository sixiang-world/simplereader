// EPUB ZIP creation utilities (injected into browser context)
async function createEpubBuffer(opts) {
    var title = opts.title, author = opts.author, chapters = opts.chapters;
    var files = {};
    files["mimetype"] = "application/epub+zip";
    files["META-INF/container.xml"] = '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

    var manifestItems = [], spineItems = [], navItems = [], ncxItems = [];
    chapters.forEach(function(ch, i) {
        var id = "ch" + (i + 1), href = "ch" + (i + 1) + ".xhtml";
        manifestItems.push('<item id="' + id + '" href="' + href + '" media-type="application/xhtml+xml"/>');
        spineItems.push('<itemref idref="' + id + '"/>');
        navItems.push('<li><a href="' + href + '">' + ch.title + '</a></li>');
        ncxItems.push('<navPoint id="' + id + '" playOrder="' + (i+1) + '"><navLabel><text>' + ch.title + '</text></navLabel><content src="' + href + '"/></navPoint>');
        var paras = ch.content.map(function(p) { return '<p>' + p + '</p>'; }).join("\n");
        files["OEBPS/" + href] = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + ch.title + '</title></head><body><h1>' + ch.title + '</h1>' + paras + '</body></html>';
    });
    manifestItems.push('<item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
    manifestItems.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');

    files["OEBPS/content.opf"] = '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">test-epub-gen</dc:identifier><dc:title>' + title + '</dc:title><dc:creator>' + author + '</dc:creator><dc:language>zh</dc:language><meta property="dcterms:modified">2024-01-01T00:00:00Z</meta></metadata><manifest>' + manifestItems.join("\n") + '</manifest><spine toc="ncx">' + spineItems.join("\n") + '</spine></package>';
    files["OEBPS/toc.xhtml"] = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>' + navItems.join("\n") + '</ol></nav></body></html>';
    files["OEBPS/toc.ncx"] = '<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="test-epub-gen"/></head><docTitle><text>' + title + '</text></docTitle><navMap>' + ncxItems.join("\n") + '</navMap></ncx>';

    return createZipBuffer(files);
}

function createZipBuffer(files) {
    var enc = new TextEncoder();
    var entries = [];
    var offset = 0;
    var mimeData = enc.encode(files["mimetype"]);
    var me = mkEntry("mimetype", mimeData, offset);
    entries.push(me);
    offset += me.lh.length + mimeData.length;
    var keys = Object.keys(files).filter(function(k) { return k !== "mimetype"; });
    for (var ki = 0; ki < keys.length; ki++) {
        var key = keys[ki];
        var data = enc.encode(files[key]);
        var e = mkEntry(key, data, offset);
        entries.push(e);
        offset += e.lh.length + data.length;
    }
    var cd = new Uint8Array(0);
    for (var i = 0; i < entries.length; i++) cd = cat(cd, entries[i].ch);
    var eocd = new ArrayBuffer(22);
    var v = new DataView(eocd);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, entries.length, true);
    v.setUint16(10, entries.length, true);
    v.setUint32(12, cd.length, true);
    v.setUint32(16, offset, true);
    var result = new Uint8Array(0);
    for (var i = 0; i < entries.length; i++) {
        result = cat(result, entries[i].lh);
        result = cat(result, enc.encode(files[entries[i].name]));
    }
    result = cat(result, cd);
    result = cat(result, new Uint8Array(eocd));
    return result;
}

function mkEntry(name, data, off) {
    var enc = new TextEncoder();
    var nb = enc.encode(name);
    var crc = crc32(data);
    var lh = new ArrayBuffer(30 + nb.length);
    var lv = new DataView(lh);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nb.length, true);
    new Uint8Array(lh, 30).set(nb);
    var ch = new ArrayBuffer(46 + nb.length);
    var cv = new DataView(ch);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nb.length, true);
    cv.setUint32(42, off, true);
    new Uint8Array(ch, 46).set(nb);
    return { name: name, lh: new Uint8Array(lh), ch: new Uint8Array(ch) };
}

function crc32(data) {
    var c = 0xFFFFFFFF;
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
        var x = i;
        for (var j = 0; j < 8; j++) x = (x & 1) ? (0xEDB88320 ^ (x >>> 1)) : (x >>> 1);
        t[i] = x;
    }
    for (var i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function cat(a, b) {
    var r = new Uint8Array(a.length + b.length);
    r.set(a);
    r.set(b, a.length);
    return r;
}
