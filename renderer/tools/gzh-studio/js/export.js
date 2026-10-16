/* 交付：复制到公众号（富文本剪贴板）、下载 HTML、导出长图（html2canvas）。 */

window.GZH.export = (function (GZH) {
  'use strict';

  var Themes = GZH.Themes;
  var Converter = GZH.Converter;
  var editor = GZH.editor;
  var preview = GZH.preview;
  var exportImageBtn = GZH.exportImageBtn;
  var state = GZH.state;
  var toast = GZH.toast;

  function fallbackCopy() {
    var box = document.createElement('section');
    box.contentEditable = 'true';
    box.innerHTML = state.html;
    box.style.position = 'fixed';
    box.style.left = '-9999px';
    document.body.appendChild(box);
    var range = document.createRange();
    range.selectNodeContents(box);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('copy');
    selection.removeAllRanges();
    document.body.removeChild(box);
  }

  function copyToWechat() {
    state.pending.then(function () {
      if (!state.html) { toast('先粘贴一点内容再复制'); return; }
      var plain = new Blob([Converter.plainText(editor.value)], { type: 'text/plain' });
      var rich = new Blob([state.html], { type: 'text/html' });
      if (navigator.clipboard && window.ClipboardItem) {
        navigator.clipboard.write([new ClipboardItem({ 'text/html': rich, 'text/plain': plain })])
          .then(function () { toast('✓ 已复制，去公众号编辑器粘贴'); })
          .catch(function () { fallbackCopy(); toast('✓ 已复制（兼容模式）'); });
      } else { fallbackCopy(); toast('✓ 已复制（兼容模式）'); }
    }).catch(function () { toast('排版尚未完成，请稍候重试'); });
  }

  function exportName(extension) {
    var spec = Themes.getSpec(state.themeId);
    var title = (editor.value.match(/^#\s*(.+)$/m) || [])[1] || '文章';
    var name = title.trim().replace(/[\\/:*?"<>| ]/g, '_').slice(0, 30);
    return name + '_排版_' + spec.name + '(' + spec.id + ').' + extension;
  }

  function saveBlob(blob, name) {
    var anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = name;
    anchor.click();
    setTimeout(function () { URL.revokeObjectURL(anchor.href); }, 0);
  }

  function download() {
    state.pending.then(function () {
      if (!state.html) { toast('先粘贴一点内容'); return; }
      saveBlob(new Blob(['﻿' + state.html], { type: 'text/html;charset=utf-8' }), exportName('html'));
    }).catch(function () { toast('排版尚未完成，请稍候重试'); });
  }

  function waitForPreviewAssets(doc) {
    var images = Array.prototype.slice.call(doc.images || []);
    var imageTasks = images.map(function (image) {
      if (image.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 3000);
      });
    });
    var fonts = doc.fonts && doc.fonts.ready ? doc.fonts.ready.catch(function () {}) : Promise.resolve();
    return Promise.all([fonts].concat(imageTasks));
  }

  function exportLongImage() {
    state.pending.then(function () {
      if (!state.html) { toast('先粘贴一点内容再导出'); return null; }
      if (typeof window.html2canvas !== 'function') throw new Error('长图导出组件未加载');
      var doc = preview.contentDocument;
      if (!doc || !doc.body) throw new Error('预览尚未就绪');
      exportImageBtn.disabled = true;
      exportImageBtn.textContent = '正在生成…';
      return waitForPreviewAssets(doc).then(function () {
        var target = doc.body;
        var width = Math.ceil(Math.max(target.scrollWidth, doc.documentElement.scrollWidth));
        var height = Math.ceil(Math.max(target.scrollHeight, doc.documentElement.scrollHeight));
        var maxCanvasSide = 16384;
        var preferredScale = 3;
        var scale = Math.min(preferredScale, maxCanvasSide / width, maxCanvasSide / height);
        if (scale < 0.5) throw new Error('文章过长，无法生成清晰的单张长图');
        return window.html2canvas(target, {
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
          scale: scale,
          width: width,
          height: height,
          windowWidth: width,
          windowHeight: height,
          scrollX: 0,
          scrollY: 0
        });
      }).then(function (canvas) {
        return new Promise(function (resolve) {
          canvas.toBlob(resolve, 'image/png');
        });
      }).then(function (blob) {
        if (!blob) throw new Error('浏览器未能编码 PNG');
        saveBlob(blob, exportName('png'));
        toast('✓ 长图已导出 PNG');
      });
    }).catch(function (error) {
      toast(error && error.message ? error.message : '长图导出失败，请稍后重试');
    }).finally(function () {
      exportImageBtn.disabled = false;
      exportImageBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg> 导出长图';
    });
  }
  return { copyToWechat: copyToWechat, download: download, exportLongImage: exportLongImage };
})(window.GZH);
