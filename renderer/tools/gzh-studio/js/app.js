/* 入口：只做事件绑定与启动。所有功能都在 core / picker / export / ai / article 里。

   加载顺序（见 index.html）：core → prompts → picker → export → ai → article → 本文件。
 */

(function () {
  'use strict';

  var GZH = window.GZH;

  var editor = GZH.editor;
  var preview = GZH.preview;
  var previewWrap = GZH.previewWrap;
  var validBadge = GZH.validBadge;
  var validPanel = GZH.validPanel;
  var exportImageBtn = GZH.exportImageBtn;
  var previewWidth = GZH.previewWidth;
  var SAMPLE_MD = GZH.SAMPLE_MD;
  var convert = GZH.convert;
  var scheduleConvert = GZH.scheduleConvert;
  var toast = GZH.toast;
  var setPreviewWidth = GZH.setPreviewWidth;
  var applyPreviewLayout = GZH.applyPreviewLayout;
  var copyToWechat = GZH.export.copyToWechat;
  var download = GZH.export.download;
  var exportLongImage = GZH.export.exportLongImage;
  var closePicker = GZH.picker.close;
  var buildPicker = GZH.picker.build;
  var buildAi = GZH.ai.build;
  var buildUrlGrabber = GZH.article.build;
  var buildAuthor = GZH.author.build;

  editor.addEventListener('input', scheduleConvert);
  document.getElementById('btnCopy').addEventListener('click', copyToWechat);
  document.getElementById('btnDownload').addEventListener('click', download);
  exportImageBtn.addEventListener('click', exportLongImage);
  document.getElementById('btnSample').addEventListener('click', function () { editor.value = SAMPLE_MD; convert().catch(function () {}); });
  document.getElementById('btnClear').addEventListener('click', function () { editor.value = ''; convert().catch(function () {}); editor.focus(); });
  document.querySelectorAll('[data-preview-width]').forEach(function (button) {
    button.addEventListener('click', function () {
      setPreviewWidth(this.getAttribute('data-preview-width'));
    });
  });
  preview.addEventListener('load', applyPreviewLayout);
  if (window.ResizeObserver) new ResizeObserver(applyPreviewLayout).observe(previewWrap);
  else window.addEventListener('resize', applyPreviewLayout);
  validBadge.addEventListener('click', function () { validPanel.hidden = !validPanel.hidden; });
  document.addEventListener('click', function () { closePicker(); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closePicker(); });

  buildPicker();
  buildAi();
  buildUrlGrabber();
  buildAuthor();
  setPreviewWidth(previewWidth);
  editor.value = SAMPLE_MD;
  try {
    var handoffMd = localStorage.getItem('yth.create.handoff') || '';
    if (handoffMd.trim()) {
      localStorage.removeItem('yth.create.handoff');
      editor.value = handoffMd;
      toast('已载入 AI 创作的文章，选一套主题即可复制');
    }
  } catch (error) { /* 隐私模式等场景回落到示例文章 */ }
  convert().catch(function () {});
})();
