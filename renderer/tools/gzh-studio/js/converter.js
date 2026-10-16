/* Md2GZH 转换器：Markdown → 语义 token 流（行内 HTML 保持原始形态，
 * 由 themes.js 在渲染阶段按主题重写样式，保证 token 与主题解耦）
 * 输入扩展语法：==高亮== →荧光笔；++下划线++ / <u> →主题下划线
 */
(function (global, factory) {
  var mk = null;
  if (typeof window !== 'undefined' && window.marked) mk = window.marked;
  else if (typeof require === 'function') mk = require('./vendor/marked.min.js');
  var parseFn = null;
  if (mk && typeof mk.parse === 'function') parseFn = mk.parse.bind(mk);
  else if (mk && mk.marked && typeof mk.marked.parse === 'function') parseFn = mk.marked.parse.bind(mk.marked);

  var api = factory(parseFn);
  global.Md2GZHConverter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (markedParse) {
  'use strict';
  var Themes = (typeof window !== 'undefined' && window.Md2GZHThemes)
    || (typeof require === 'function' ? require('./themes.js') : null);

  /* 按围栏代码块切分，只对非代码区做行内语法替换，避免污染代码 */
  function preprocess(md) {
    var lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    var out = [];
    var inFence = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) { out.push(line); continue; }
      out.push(line
        .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
        .replace(/\+\+([^+\n]+)\+\+/g, '<u>$1</u>'));
    }
    return out.join('\n');
  }

  function textOf(node) {
    return (node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  var SIG_PATTERNS = [
    /^我是\s*.{1,24}\s*[，,、]/,
    /(点赞|在看|关注)[^。]{0,12}(转发|在看|三连|分享)/,
    /点个\s*[「“']?\s*(在看|赞)/,
    /我们下[一]?[篇期]见/,
    /欢迎\s*(点赞|转发|在看|留言|评论)/
  ];
  function isSignature(text) {
    for (var i = 0; i < SIG_PATTERNS.length; i++) if (SIG_PATTERNS[i].test(text)) return true;
    return false;
  }
  function detectAuthor(text) {
    var m = text.match(/^我是\s*(.{1,24}?)\s*[，,、]/);
    return m ? m[1] : '';
  }
  function detectIntro(text) {
    var m = text.match(/^我是\s*.{1,24}\s*[，,、]\s*(.+)$/);
    return m ? m[1].replace(/[。.]$/, '') : '';
  }

  function splitCoverTitle(raw) {
    var segs = raw.split('/');
    var title = (segs[0] || '').trim() || '未命名文章';
    var sub = segs.length > 1 ? segs.slice(1).join('/').trim() : '';
    return { title: title, sub: sub };
  }

  function parse(md) {
    if (!markedParse) throw new Error('marked not available');
    if (!Themes) throw new Error('themes.js must load first');
    var rawHtml = markedParse(preprocess(md || ''));
    var doc = new DOMParser().parseFromString(rawHtml, 'text/html');
    var tokens = [];
    var state = { sectionN: 0, hasH1: false };

    var children = Array.prototype.slice.call(doc.body.childNodes);
    for (var i = 0; i < children.length; i++) {
      var node = children[i];
      if (node.nodeType === 3 && !node.nodeValue.trim()) continue;
      if (node.nodeType !== 1) continue;
      var tag = node.tagName;

      if (tag === 'H1') {
        state.hasH1 = true;
        var ct = splitCoverTitle(textOf(node));
        tokens.push({ type: 'cover', title: ct.title, sub: ct.sub, en: 'WECHAT · ARTICLE' });
        continue;
      }
      if (tag === 'H2') {
        state.sectionN++;
        var t2 = textOf(node);
        tokens.push({
          type: 'section', title: t2,
          num: state.sectionN < 10 ? '0' + state.sectionN : String(state.sectionN),
          en: Themes.autoEn(t2)
        });
        continue;
      }
      if (tag === 'H3' || tag === 'H4') {
        tokens.push({ type: 'subsection', text: textOf(node) });
        continue;
      }
      if (tag === 'HR') { tokens.push({ type: 'divider' }); continue; }
      if (tag === 'BLOCKQUOTE') {
        var qtext = textOf(node);
        if (!qtext) continue;
        tokens.push({ type: 'quote', text: qtext, author: '' });
        continue;
      }
      if (tag === 'PRE') {
        var codeEl = node.querySelector('code');
        var cls = codeEl ? (codeEl.className || '') : '';
        var lm = cls.match(/language-([\w+-]+)/);
        var codeText = codeEl ? codeEl.textContent : node.textContent;
        tokens.push({ type: 'code', lang: lm ? lm[1].toUpperCase() : 'CODE', lines: codeText.replace(/\n+$/, '').split('\n') });
        continue;
      }
      if (tag === 'UL' || tag === 'OL') {
        var items = [];
        var lis = node.querySelectorAll('li');
        for (var L = 0; L < lis.length; L++) items.push(lis[L].innerHTML.trim());
        tokens.push({ type: 'list', ordered: tag === 'OL', items: items });
        continue;
      }
      if (tag === 'TABLE') {
        var head = [], rows = [];
        var trs = node.querySelectorAll('tr');
        for (var R = 0; R < trs.length; R++) {
          var cells = trs[R].querySelectorAll('th,td');
          var row = [];
          for (var C = 0; C < cells.length; C++) row.push(textOf(cells[C]));
          if (trs[R].querySelector('th')) head = row; else rows.push(row);
        }
        tokens.push({ type: 'table', head: head, rows: rows });
        continue;
      }
      if (tag === 'P') {
        var imgs = node.querySelectorAll('img');
        var textAll = textOf(node);
        for (var g = 0; g < imgs.length; g++) {
          tokens.push({ type: 'image', src: imgs[g].getAttribute('src') || '', alt: (imgs[g].getAttribute('alt') || '').trim() });
        }
        if (!textAll) {
          if (!imgs.length && /<br\s*\/?\s*>/i.test(node.innerHTML)) tokens.push({ type: 'divider' });
          continue;
        }
        if (isSignature(textAll)) {
          var au = detectAuthor(textAll);
          var prev = tokens[tokens.length - 1];
          if (prev && prev.type === 'signature') {
            if (au) prev.author = au;
          } else {
            tokens.push({ type: 'signature', author: au, intro: detectIntro(textAll) });
          }
          continue;
        }
        var clone = node.cloneNode(true);
        var ci = clone.querySelectorAll('img');
        for (var d = 0; d < ci.length; d++) ci[d].parentNode.removeChild(ci[d]);
        tokens.push({ type: 'para', raw: clone.innerHTML.trim() });
        continue;
      }
      var innerText = textOf(node);
      if (innerText) tokens.push({ type: 'para', raw: innerText });
    }

    if (!state.hasH1) {
      var ft = splitCoverTitle('');
      tokens.unshift({ type: 'cover', title: ft.title, sub: '', en: 'WECHAT · ARTICLE' });
    }
    return tokens;
  }

  /* 提取纯文本（复制时的 text/plain 兜底） */
  function plainText(md) {
    return String(md || '')
      .replace(/```[\s\S]*?```/g, function (m) { return m.replace(/```\w*\n?/g, ''); })
      .replace(/^#+\s*/gm, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_>`~]/g, '');
  }

  return { parse: parse, plainText: plainText };
});
