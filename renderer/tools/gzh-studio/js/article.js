/* 文章链接抓取：URL 弹框、抓取通道回落、网页 HTML → Markdown。

   外壳里走主进程（window.toolbox.invoke('fetchArticle')，没有 CORS）；
   单独用浏览器打开时退回公共 CORS 代理链。
 */

window.GZH.article = (function (GZH) {
  'use strict';

  var editor = GZH.editor;
  var SAMPLE_MD = GZH.SAMPLE_MD;
  var convert = GZH.convert;
  var toast = GZH.toast;
  var bodyLength = GZH.bodyLength;
  var closeAiPop = GZH.ai.closePop;

  var urlGrab = {
    mask: document.getElementById('urlModalMask'),
    input: document.getElementById('urlInput'),
    status: document.getElementById('urlModalStatus'),
    go: document.getElementById('urlFetchBtn'),
    cancel: document.getElementById('urlCancelBtn'),
    trigger: document.getElementById('btnArticleUrl')
  };

  var FETCH_TIMEOUT_MS = 20000;
  var MIN_ARTICLE_CHARS = 60;
  var BR = '\u0000';                       /* <br> 占位符，收尾时再还原成换行 */

  var SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|IFRAME|SVG|CANVAS|BUTTON|INPUT|SELECT|TEXTAREA|VIDEO|AUDIO|OBJECT|EMBED|MAP|TEMPLATE|LINK|META|BASE|TITLE|HEAD|HEADER|FOOTER|NAV|FORM|DIALOG)$/;
  var INLINE_TAGS = /^(A|SPAN|STRONG|B|EM|I|U|MARK|CODE|SMALL|SUB|SUP|FONT|LABEL|ABBR|CITE|Q|TIME|DEL|S|INS|SAMP|KBD|VAR|TT|BIG|BDI|BDO|RUBY|RB|RT|RP|WBR|NOBR|IMG|BR)$/;

  function normalizeUrl(raw) {
    var text = String(raw || '').replace(/[\u200b\ufeff]/g, '').trim();
    if (!text) return '';
    var found = text.match(/https?:\/\/[^\s"'<>()（）【】「」，。；、]+/i);
    text = found ? found[0] : text.replace(/\s+/g, '');

    /* 从聊天记录、正文里连字带链接一起复制过来时，尾巴上常粘着东西：
         https://…/s/abc。   https://…/s/abc,   https://…/s/abc里
       多这一个字符微信就会判「参数错误」，所以先把尾巴清干净再校验。 */
    text = text.replace(/[\s，。、；：！？…）】」”’]+$/, '');
    text = text.replace(/[.,;:!?'")\]}]+$/, '');
    var cjk = text.search(/[　-〿一-鿿＀-￯]/);
    if (cjk > 0) text = text.slice(0, cjk);

    if (!/^https?:\/\//i.test(text)) {
      if (!/^[\w-]+(\.[\w-]+)+/.test(text)) return '';
      text = 'https://' + text;
    }
    try {
      var parsed = new URL(text);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : '';
    } catch (error) {
      return '';
    }
  }

  function setUrlStatus(kind, message) {
    if (!urlGrab.status) return;
    urlGrab.status.className = 'modal-status' + (kind ? ' ' + kind : '');
    urlGrab.status.textContent = message || '';
    urlGrab.status.hidden = !message;
  }

  function shortError(error) {
    if (!error) return '请求失败';
    if (error.name === 'AbortError') return '超时';
    var message = String(error.message || error);
    return message.length > 40 ? message.slice(0, 40) + '…' : message;
  }

  function fetchText(target, timeout) {
    if (window.toolbox) {
      return window.toolbox.invoke('fetchArticle', { url: target }).then(function (response) {
        if (!response || response.ok !== true) throw new Error((response && response.error) || '抓取失败');
        return response.result.body;
      });
    }
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, timeout);
    var options = { redirect: 'follow' };
    if (controller) options.signal = controller.signal;
    return fetch(target, options).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.text();
    }).finally(function () { clearTimeout(timer); });
  }

  /* 代理候选：浏览器拿不到 mp.weixin.qq.com 的响应头，只能借公共 CORS 代理转发 */
  function proxyChain(target) {
    /* Electron 外壳：主进程直连，不经任何第三方代理 */
    if (window.toolbox) return [{ name: '本机直连', url: target, kind: 'bridge' }];
    var encoded = encodeURIComponent(target);
    return [
      { name: '直连', url: target, kind: 'auto' },
      { name: 'r.jina.ai', url: 'https://r.jina.ai/' + target, kind: 'markdown' },
      { name: 'allorigins', url: 'https://api.allorigins.win/raw?url=' + encoded, kind: 'html' },
      { name: 'corsproxy.io', url: 'https://corsproxy.io/?url=' + encoded, kind: 'html' },
      { name: 'codetabs', url: 'https://api.codetabs.com/v1/proxy?quest=' + encoded, kind: 'html' }
    ];
  }

  function looksLikeHtml(text) {
    return /<[a-zA-Z!/]/.test(String(text).slice(0, 600));
  }

  function stripJinaHeader(text) {
    var match = String(text).match(/(?:^|\n)\s*Markdown Content:\s*\n/);
    return match ? text.slice(match.index + match[0].length) : text;
  }

  /* 依次尝试每个代理，任何一个拿到有效正文就返回 */
  function grabArticle(target) {
    var chain = proxyChain(target);
    var failures = [];
    var index = 0;

    function attempt() {
      if (index >= chain.length) {
        var detail = failures.length ? '（' + failures.join('；') + '）' : '';
        return Promise.reject(new Error('所有通道都没抓到正文' + detail));
      }
      var item = chain[index++];
      setUrlStatus('pending', '正在尝试「' + item.name + '」…');
      return fetchText(item.url, FETCH_TIMEOUT_MS).then(function (raw) {
        var text = item.kind === 'markdown' ? stripJinaHeader(raw) : raw;
        var md = looksLikeHtml(text) ? htmlToMarkdown(text) : text;
        md = tidyArticle(md);
        if (bodyLength(md) < MIN_ARTICLE_CHARS) {
          /* 别再猜「反爬」了 —— 说清楚拿到多少，主进程那边的校验已经会给出具体原因 */
          throw new Error('页面里没能解析出正文，只得到 ' + bodyLength(md) + ' 字');
        }
        return { md: md, via: item.name };
      }).catch(function (error) {
        failures.push(item.name + '：' + shortError(error));
        return attempt();
      });
    }

    return attempt();
  }

  /* ---------- 网页 HTML → Markdown ---------- */

  function escapeMd(text) {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/</g, '\\<')
      .replace(/([*_`\[\]])/g, '\\$1');
  }

  function isInlineTag(tag) {
    return INLINE_TAGS.test(tag) || tag.indexOf('-') !== -1;
  }

  function isHidden(el) {
    if (el.getAttribute('aria-hidden') === 'true') return true;
    var style = el.getAttribute('style') || '';
    return /display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style);
  }

  /* 块内行内内容：压缩空白 + 把 <br> 变成 Markdown 硬换行（两个空格 + 换行） */
  function tidyInline(raw) {
    var text = String(raw).split(BR).join('\n');
    text = text.replace(/[^\S\n]+/g, ' ');
    text = text.replace(/ *\n */g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
    return text ? text.replace(/\n/g, '  \n') : '';
  }

  function flatInline(el) {
    return tidyInline(mdInline(el)).replace(/\s+/g, ' ');
  }

  function mdImage(el) {
    var src = (el.getAttribute('data-src') || el.getAttribute('src') || '').trim();
    if (!src || /^data:/i.test(src)) return '';
    var alt = (el.getAttribute('alt') || '').replace(/[[\]]/g, '').trim();
    return '![' + escapeMd(alt) + '](' + src.replace(/[()\s]/g, function (c) { return encodeURIComponent(c); }) + ')';
  }

  function inlineChildren(parent) {
    var out = '';
    var nodes = parent.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType === 3) {
        out += escapeMd(node.nodeValue.replace(/\s+/g, ' '));
        continue;
      }
      if (node.nodeType !== 1) continue;
      var tag = node.tagName;
      if (SKIP_TAGS.test(tag) || /^MP-/.test(tag) || isHidden(node)) continue;
      if (isInlineTag(tag)) { out += mdInline(node); continue; }
      var nested = mdBlocks(node);                       /* 行内位置混进了块级元素 */
      if (nested) out += BR + nested + BR;
    }
    return out;
  }

  function mdInline(el) {
    var tag = el.tagName;
    if (tag === 'BR') return BR;
    if (tag === 'IMG') return mdImage(el);
    if (tag === 'CODE') {
      /* 代码里的反斜杠/下划线是字面量，不能被 Markdown 转义 */
      var code = el.textContent.replace(/\s+/g, ' ').trim();
      return code ? '`' + code.replace(/([`\\])/g, '\\$1') + '`' : '';
    }
    var inner = inlineChildren(el);
    var has = inner.replace(/\s/g, '').length > 0;
    switch (tag) {
      case 'STRONG': case 'B': return has ? '**' + inner + '**' : inner;
      case 'EM': case 'I': return has ? '*' + inner + '*' : inner;
      case 'U': case 'INS': return has ? '++' + inner + '++' : inner;     /* 本工具的「下划线」语法 */
      case 'MARK': return has ? '==' + inner + '==' : inner;              /* 本工具的「高亮」语法 */
      case 'DEL': case 'S': return has ? '~~' + inner + '~~' : inner;
      case 'A': {
        var href = (el.getAttribute('href') || '').trim();
        if (!has || !href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return inner;
        return '[' + inner.trim() + '](' + href.replace(/[()\s]/g, function (c) { return encodeURIComponent(c); }) + ')';
      }
      default: return inner;
    }
  }

  function mdCodeBlock(el) {
    var codeEl = el.querySelector('code') || el;
    var clone = codeEl.cloneNode(true);
    /* 公众号代码块把每行放在独立 span 里，textContent 会丢掉换行 */
    var lines = clone.querySelectorAll('.code-snippet__line');
    for (var i = 0; i < lines.length; i++) {
      lines[i].appendChild(clone.ownerDocument.createTextNode('\n'));
    }
    var text = clone.textContent.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
    if (!text.trim()) return '';
    var match = (codeEl.getAttribute('class') || '').match(/language-([\w+#.-]+)/);
    var fence = text.indexOf('```') === -1 ? '```' : '````';
    return fence + (match ? match[1] : '') + '\n' + text + '\n' + fence;
  }

  function mdList(el) {
    var ordered = el.tagName === 'OL';
    var start = Number(el.getAttribute('start')) || 1;
    var out = [];
    var seen = 0;
    Array.prototype.forEach.call(el.children, function (li) {
      if (li.tagName !== 'LI' || isHidden(li)) return;
      var marker = ordered ? (start + seen++) + '. ' : '- ';
      /* 子列表要贴着父项，空行会让 Markdown 把列表判成 loose */
      var body = mdBlocks(li).replace(/\n\n(?=[-*+] |\d+\. )/g, '\n');
      if (!body) return;
      var parts = body.split('\n');
      var tail = parts.slice(1).map(function (line) { return line.trim() ? '  ' + line : line; });
      out.push([marker + parts[0]].concat(tail).join('\n'));
    });
    return out.join('\n');
  }

  function mdTable(el) {
    var grid = [];
    Array.prototype.forEach.call(el.querySelectorAll('tr'), function (tr) {
      var cells = [];
      Array.prototype.forEach.call(tr.children, function (cell) {
        if (cell.tagName !== 'TD' && cell.tagName !== 'TH') return;
        cells.push(flatInline(cell).replace(/\|/g, '\\|'));
      });
      if (cells.length) grid.push(cells);
    });
    if (!grid.length) return '';
    var width = 0;
    grid.forEach(function (row) { width = Math.max(width, row.length); });
    if (width < 2) return grid.map(function (row) { return row.join(' '); }).join('\n');
    function row(cells) {
      var out = [];
      for (var i = 0; i < width; i++) out.push(cells[i] || '');
      return '| ' + out.join(' | ') + ' |';
    }
    var divider = [];
    for (var i = 0; i < width; i++) divider.push('---');
    var lines = [row(grid.shift()), row(divider)];
    grid.forEach(function (cells) { lines.push(row(cells)); });
    return lines.join('\n');
  }

  function mdBlock(el) {
    var tag = el.tagName;
    if (tag === 'HR') return '---';
    if (tag === 'PRE') return mdCodeBlock(el);
    if (tag === 'UL' || tag === 'OL') return mdList(el);
    if (tag === 'TABLE') return mdTable(el);
    if (tag === 'BLOCKQUOTE') {
      return mdBlocks(el).split('\n').map(function (line) { return line ? '> ' + line : '>'; }).join('\n');
    }
    var heading = tag.match(/^H([1-6])$/);
    if (heading) {
      var line = tidyInline(mdInline(el));
      if (!line) return '';
      /* 文章标题已占用 #，正文标题统一从 ## 起，避免多出封面 */
      var level = Math.min(6, Math.max(2, Number(heading[1])));
      return new Array(level + 1).join('#') + ' ' + line;
    }
    return mdBlocks(el);
  }

  function mdBlocks(parent) {
    var parts = [];
    var buffer = '';
    function flush() {
      var text = tidyInline(buffer);
      if (text) parts.push(text);
      buffer = '';
    }
    var nodes = parent.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType === 3) { buffer += escapeMd(node.nodeValue.replace(/\s+/g, ' ')); continue; }
      if (node.nodeType !== 1) continue;
      var tag = node.tagName;
      if (SKIP_TAGS.test(tag) || /^MP-/.test(tag) || isHidden(node)) continue;
      if (isInlineTag(tag)) { buffer += mdInline(node); continue; }
      flush();
      var block = mdBlock(node);
      if (block) parts.push(block);
    }
    flush();
    return parts.map(function (part) { return part.replace(/ +$/, ''); }).join('\n\n');
  }

  function articleRoot(doc) {
    var selectors = [
      '#js_content', '.rich_media_content', '#js_article', 'article', '[role="main"]',
      'main', '.post-content', '.entry-content', '.article-content', '.markdown-body', '#content', '.content'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var found = doc.querySelector(selectors[i]);
      if (found && bodyLength(found.textContent) >= 80) return found;
    }
    return doc.body;
  }

  function articleTitle(doc) {
    var node = doc.querySelector('#activity-name')
      || doc.querySelector('meta[property="og:title"]')
      || doc.querySelector('h1')
      || doc.querySelector('title');
    if (!node) return '';
    var raw = node.tagName === 'META' ? node.getAttribute('content') : node.textContent;
    return String(raw || '').replace(/\s+/g, ' ').trim();
  }

  function tidyArticle(md) {
    return String(md)
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b\ufeff]/g, '')
      .replace(/\n{4,}/g, '\n\n\n')
      .replace(/^\s+|\s+$/g, '');
  }

  function htmlToMarkdown(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var root = articleRoot(doc);
    if (!root) return '';
    var body = mdBlocks(root);
    var title = articleTitle(doc).replace(/\s+/g, ' ');
    if (!title || body.indexOf(title) === 0) return tidyArticle(body);
    return tidyArticle('# ' + title + '\n\n' + body);
  }

  function applyArticle(md, via) {
    var current = editor.value.trim();
    if (current && current !== SAMPLE_MD.trim()
      && !window.confirm('编辑器里已有内容，确定用抓取到的文章覆盖吗？')) return false;
    editor.value = md;
    editor.scrollTop = 0;
    convert().catch(function () {});
    toast('✓ 已从「' + via + '」抓取 ' + bodyLength(md) + ' 字，可在编辑器里继续调整');
    return true;
  }

  function startGrab() {
    var target = normalizeUrl(urlGrab.input.value);
    if (!target) { setUrlStatus('bad', '✗ 请输入合法的 http/https 链接'); return; }
    if (!window.toolbox && (typeof fetch !== 'function' || typeof AbortController !== 'function')) {
      setUrlStatus('bad', '✗ 当前浏览器不支持 fetch，请换 Chrome / Edge 打开');
      return;
    }
    urlGrab.input.value = target;
    urlGrab.go.disabled = true;
    setUrlStatus('pending', '抓取中…');
    grabArticle(target).then(function (result) {
      if (applyArticle(result.md, result.via)) urlGrab.mask.hidden = true;
      else setUrlStatus(null, '');
    }).catch(function (error) {
      setUrlStatus('bad', '✗ ' + (error && error.message ? error.message : '抓取失败'));
    }).finally(function () {
      urlGrab.go.disabled = false;
    });
  }

  function buildUrlGrabber() {
    if (!urlGrab.mask) return;

    var hint = document.getElementById('urlHint');
    if (hint && window.toolbox) {
      hint.textContent = '粘贴公众号文章链接，正文由本机主进程直接抓取，不经任何第三方服务器，'
        + '抓到的正文会自动转成 Markdown 填进下方编辑器。';
    }
    urlGrab.trigger.addEventListener('click', function (event) {
      event.stopPropagation();
      closeAiPop();
      setUrlStatus(null, '');
      urlGrab.mask.hidden = false;
      urlGrab.input.focus();
      urlGrab.input.select();
    });
    urlGrab.cancel.addEventListener('click', function () { urlGrab.mask.hidden = true; });
    urlGrab.mask.addEventListener('click', function (event) {
      if (event.target === urlGrab.mask) urlGrab.mask.hidden = true;
    });
    urlGrab.go.addEventListener('click', startGrab);
    urlGrab.input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      startGrab();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') urlGrab.mask.hidden = true;
    });

    /* Electron 外壳：主进程存完文件后由外壳转发过来的提示 */
    if (window.toolbox && window.toolbox.onToast) {
      window.toolbox.onToast(function (message) { toast(message); });
    }
  }
  return { build: buildUrlGrabber };
})(window.GZH);
