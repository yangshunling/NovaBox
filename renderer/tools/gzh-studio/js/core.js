/* 核心：元素引用、共享状态、示例文章、预览布局、Markdown → 预览管线、toast。

   这里定义 window.GZH —— 其它模块的共享上下文都挂在它上面。
   拆出来的模块用 `var 同名 = GZH.同名` 接住自己需要的东西，函数体保持原样。
   加载顺序：core 必须最先。
 */

window.GZH = (function () {
  'use strict';

  var Themes = window.Md2GZHThemes;
  var Converter = window.Md2GZHConverter;
  var Validator = window.Md2GZHValidator;

  var editor = document.getElementById('editor');
  var preview = document.getElementById('preview');
  var previewWrap = document.getElementById('previewWrap');
  var validBadge = document.getElementById('validBadge');
  var validPanel = document.getElementById('validPanel');
  var exportImageBtn = document.getElementById('btnExportImage');
  var toastEl = document.getElementById('toast');
  var pickerSlot = document.getElementById('themePickerSlot');
  var previewWidth = 'fit';

  var state = {
    /* 署名：由 author.js 的「署名配置」弹框写入，从配置库恢复 */
    author: '',
    themeId: Themes.SPECS[0].id,
    library: 'base',
    group: 'all',
    html: '',
    timer: null,
    renderId: 0,
    pending: Promise.resolve(),
    pickerOpen: false
  };

  var SAMPLE_MD = [
    '# 一条信息如何变成行动 / 402 标准屏长文压力测试',
    '',
    '> 信息真正产生价值，不是在它被看到的时候，而是在它被理解、被选择、被执行的时候。',
    '',
    '一篇长文真正开始之前，作者面对的通常不是一个完整答案，而是一批来源不同、重要程度也不同的材料。它们可能来自采访记录、公开资料、数据表格，也可能只是一次讨论里留下的零散判断。',
    '',
    '稳定的版式首先要容纳这种不整齐。段落有长有短，句子有快有慢，但阅读宽度、行距和段间距必须保持一致，读者才不会因为内容变长而失去方向。',
    '',
    '## 看见信号',
    '',
    '当材料被整理成问题，文章才会出现一条可阅读的路径。每个章节只承担一个推进动作：提出问题、补充证据、解释变化，最后回到读者真正需要的结论。',
    '',
    '移动端最容易出现的错误，是为了塞入更多信息而不断缩小文字。这样虽然一屏能看到更多内容，却会让读者在真实手机上频繁放大或跳读。',
    '',
    '因此这里让正文保持可辨识的字号，同时限制文字栏宽度。较长句子自然换成两到三行，短句则保留停顿，不用人为把所有段落拉成同样的高度。',
    '',
    '![横图测试：图像进入正文节奏，但不挤压相邻段落](placeholder://16-9)',
    '',
    '### 三级标题与行内效果',
    '',
    '同一段内集中检查 **关键词强调**、*斜体补充*、~~删除内容~~、==荧光高亮==、`行内代码`，以及 [链接文字](https://example.com)。',
    '',
    '- 无序列表支持关键词强调与自然换行',
    '- 行内代码不会抬高整行，也不会突破正文宽度',
    '- 较长列表项换行后仍与正文起点保持对齐',
    '',
    '1. 先整理材料与章节关系',
    '2. 再验证图片、引用和数据组件',
    '3. 最后检查公众号复制后的可编辑性',
    '',
    '---',
    '',
    '## 形成路径',
    '',
    '图片不应该只是插在段落之间。它需要明确的上下间隔、稳定的圆角和图注位置，才能成为论证的一部分，而不是突然打断阅读的广告位。',
    '',
    '正文模板的目标不是让每一页都一样，而是让不同长度的内容都遵守同一套阅读节奏。连续滚动几屏之后，字号、行距和左右边界不能发生变化。',
    '',
    '![第二张图片：连续多图与长图注测试](placeholder://4-5)',
    '',
    '> 装饰应该退到正确的位置：读者先看见标题，再进入正文，需要证据时遇到图片，需要停顿时遇到引用。',
    '',
    '## 验证过程',
    '',
    '版式是否可靠，不能只看一篇短样张。需要把多段文字、连续图片、引用和列表同时放进来，观察它们在真实宽度下是否发生重叠、截断或不合理的大空洞。',
    '',
    '这次压力测试保留原画廊的视觉骨架，只把文字独立为阅读层。左右装饰仍然存在，但它们不再占用正文的有效宽度，也不会抢走章节标题的视觉中心。',
    '',
    '![第三张图片：超宽信息图位置测试](placeholder://2.35-1)',
    '',
    '```javascript',
    'function layout(article) {',
    '  return article.sections.map(renderSection);',
    '}',
    '```',
    '',
    '| 项目 | 基础排版 | 高级排版 |',
    '|------|---------|---------|',
    '| 正文 | 稳定段落 | 完整对齐 |',
    '| 图片 | 图注与边界 | 完整对齐 |',
    '| 代码 | 行内与块级 | 完整对齐 |',
    '| 表格 | 多列数据 | 完整对齐 |',
    '',
    '## 回到结果',
    '',
    '稳定的长文版式最终会让视觉系统负责引导，而不是要求内容迁就装饰。如果一段话特别长，它仍然应该保持舒适的行长。',
    '',
    '如果一段话很短，也不需要额外填充。统一的段落节奏会自然留下空白，让短句成为强调，而不是看起来像遗漏了内容。',
    '',
    '最后回到文章的核心结论：版式要能够承受内容变化。只有通过长文和多图压力测试，才能确认它不是一张好看的样片，而是一套真正可用的公众号模板。',
    '',
    '我是 蓝梦，持续整理公众号视觉与长文排版。'
  ].join('\n');

  function syncPreviewHeight() {
    if (!preview.contentDocument || !preview.contentDocument.body) return;
    var doc = preview.contentDocument;
    var minimumHeight = Math.max(1, previewWrap.clientHeight);
    preview.style.height = minimumHeight + 'px';
    var contentHeight = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
    preview.style.height = Math.max(minimumHeight, Math.ceil(contentHeight)) + 'px';
  }

  function queuePreviewHeight() {
    requestAnimationFrame(function () {
      syncPreviewHeight();
      requestAnimationFrame(syncPreviewHeight);
    });
  }

  function applyPreviewLayout() {
    if (!preview.contentDocument || !preview.contentDocument.body) return;
    var body = preview.contentDocument.body;
    var fixed = previewWidth !== 'fit';
    previewWrap.classList.toggle('device', fixed);
    previewWrap.classList.toggle('readable', !fixed);
    if (fixed) previewWrap.style.setProperty('--preview-width', previewWidth + 'px');
    else previewWrap.style.removeProperty('--preview-width');
    queuePreviewHeight();
  }

  function previewShell(html) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<style>html,body{overflow:hidden;scrollbar-width:none;}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none;}'
      + 'body{margin:0;min-width:0;padding:18px 16px;background:#fff;'
      + 'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}'
      + 'img,svg{max-width:100%;}</style></head><body>' + html + '</body></html>';
  }

  function setPreviewWidth(value) {
    previewWidth = value;

    document.querySelectorAll('[data-preview-width]').forEach(function (button) {
      var active = button.getAttribute('data-preview-width') === value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    applyPreviewLayout();
  }

  function commitHtml(html) {
    state.html = html;
    preview.srcdoc = previewShell(html);
    var result = Validator.validate(html);
    validBadge.className = 'badge ' + (result.ok ? (result.warnings.length ? 'warn' : 'ok') : 'bad');
    validBadge.textContent = result.ok
      ? (result.warnings.length ? '⚠ ' + result.warnings.length + ' 条建议' : '✓ 平台合规')
      : '✗ ' + result.errors.length + ' 个错误';
    var panelHtml = '';
    result.errors.forEach(function (message) { panelHtml += '<div class="err">✗ ' + message + '</div>'; });
    result.warnings.forEach(function (message) { panelHtml += '<div class="warn">⚠ ' + message + '</div>'; });
    validPanel.innerHTML = panelHtml;
    validPanel.hidden = result.ok && !result.warnings.length;
  }

  function renderFailure(error) {
    state.html = '';
    var message = error && error.message ? error.message : String(error);
    validBadge.className = 'badge bad';
    validBadge.textContent = '✗ 渲染失败';
    validPanel.innerHTML = '<div class="err">✗ ' + Themes.esc(message) + '</div>';
    validPanel.hidden = false;
    preview.srcdoc = previewShell('<section style="padding:28px;color:#8A382F;font-size:14px;line-height:1.8;">排版渲染失败，请检查 Markdown 内容后重试。</section>');
  }

  function convert() {
    var renderId = ++state.renderId;
    var spec = Themes.getSpec(state.themeId);
    var author = state.author;
    var markdown = editor.value;

    state.pending = Promise.resolve().then(function () {
      return Themes.render(Converter.parse(markdown), spec, { author: author });
    }).then(function (html) {
      if (renderId === state.renderId) commitHtml(html);
      return html;
    }).catch(function (error) {
      if (renderId === state.renderId) renderFailure(error);
      throw error;
    });
    return state.pending;
  }

  function scheduleConvert() {
    clearTimeout(state.timer);
    state.timer = setTimeout(function () { convert().catch(function () {}); }, 350);
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { toastEl.hidden = true; }, 2400);
  }

  /* 通用小工具：清理模型输出、按非空白字符数算正文长度 */
  function cleanMarkdown(text) {
    var out = String(text || '').trim();
    var fenced = out.match(/^```[a-zA-Z]*\s*\r?\n([\s\S]*?)\r?\n```$/);
    if (fenced) out = fenced[1].trim();
    return out;
  }

  function bodyLength(text) {
    return String(text || '').replace(/\s/g, '').length;
  }
  /* 统一配置库：外壳里走主进程的 SQLite（~/.toolbox/toolbox.db），所有工具共用；
     单独用浏览器打开时退回 localStorage，保证工具仍能独立调试。
     两种情况都返回 Promise<{ ok, result } | { ok: false, error }>，不会 reject。 */
  var store = (window.toolbox && window.toolbox.store) ? window.toolbox.store : (function () {
    var PREFIX = 'toolbox:';
    function read(key) {
      try { return JSON.parse(localStorage.getItem(PREFIX + key)); } catch (error) { return null; }
    }
    return {
      get: function (key) { return Promise.resolve({ ok: true, result: read(key) }); },
      set: function (key, value) {
        try {
          localStorage.setItem(PREFIX + key, JSON.stringify(value));
          return Promise.resolve({ ok: true, result: true });
        } catch (error) { return Promise.resolve({ ok: false, error: String(error && error.message) }); }
      },
      remove: function (key) {
        try {
          localStorage.removeItem(PREFIX + key);
          return Promise.resolve({ ok: true, result: true });
        } catch (error) { return Promise.resolve({ ok: false, error: String(error && error.message) }); }
      },
      all: function () {
        var out = {};
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(PREFIX) === 0) out[k.slice(PREFIX.length)] = read(k.slice(PREFIX.length));
          }
        } catch (error) { /* 隐私模式等 */ }
        return Promise.resolve({ ok: true, result: out });
      }
    };
  })();

  return {
    Themes: Themes, Converter: Converter, Validator: Validator, store: store,
    editor: editor, preview: preview, previewWrap: previewWrap,
    validBadge: validBadge, validPanel: validPanel,
    exportImageBtn: exportImageBtn, toastEl: toastEl, pickerSlot: pickerSlot,
    previewWidth: previewWidth, state: state, SAMPLE_MD: SAMPLE_MD,
    syncPreviewHeight: syncPreviewHeight, queuePreviewHeight: queuePreviewHeight,
    applyPreviewLayout: applyPreviewLayout, previewShell: previewShell,
    setPreviewWidth: setPreviewWidth, commitHtml: commitHtml,
    renderFailure: renderFailure, convert: convert, scheduleConvert: scheduleConvert,
    toast: toast, cleanMarkdown: cleanMarkdown, bodyLength: bodyLength,
    /* 各模块加载时把自己挂到这里 */
    prompts: {}, picker: {}, export: {}, ai: {}, article: {}
  };
})();
