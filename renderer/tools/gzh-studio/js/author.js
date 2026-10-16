/* 署名配置：工具栏上的按钮 + 弹框，值存进统一配置库。

   署名是「我是谁」，不是公众号排版的专属设置，所以用**通用键** `author.name` ——
   以后别的工具（写文档、生成封面…）想用同一个署名，直接读这个键即可。

   外壳里存进 ~/.toolbox/toolbox.db；单独用浏览器打开时 GZH.store 自动降级到
   localStorage，照样能用。 */

window.GZH.author = (function (GZH) {
  'use strict';

  var state = GZH.state;
  var store = GZH.store;
  var toast = GZH.toast;
  var scheduleConvert = GZH.scheduleConvert;

  var STORE_KEY = 'author.name';
  var MAX_LEN = 24;

  var mask = document.getElementById('authorModalMask');
  var input = document.getElementById('authorInput');
  var saveBtn = document.getElementById('authorSaveBtn');
  var cancelBtn = document.getElementById('authorCancelBtn');
  var trigger = document.getElementById('btnAuthorConfig');

  function open() {
    if (!mask) return;
    input.value = state.author || '';
    mask.hidden = false;
    input.focus();
    input.select();
  }

  function close() {
    if (mask) mask.hidden = true;
  }

  /* 按钮文案始终是「署名配置」（按需求），当前生效的署名放在 title 提示里 */
  function reflect() {
    if (!trigger) return;
    trigger.title = state.author ? '当前署名：' + state.author : '还没设置署名，点这里填写';
    trigger.classList.toggle('has-author', !!state.author);
  }

  /**
   * @param {string} name
   * @param {{persist?: boolean}} [options] persist 为 false 时只应用不落库（用于启动恢复）
   */
  function apply(name, options) {
    state.author = String(name || '').trim().slice(0, MAX_LEN);
    reflect();
    scheduleConvert();
    if (options && options.persist === false) return;

    store.set(STORE_KEY, state.author).then(function (response) {
      if (response && response.ok === false) toast('署名保存失败：' + response.error);
    }).catch(function () { /* 降级实现不会 reject */ });
  }

  /* 启动时把上次的署名读回来；库里还没有就把当前值当作初始值落库 */
  function restore() {
    return store.get(STORE_KEY).then(function (response) {
      var saved = response && response.ok ? response.result : null;
      if (typeof saved === 'string' && saved) apply(saved, { persist: false });
      else if (state.author) apply(state.author);
    }).catch(function () { /* 配置库不可用：留空 */ });
  }

  function build() {
    if (!mask || !trigger) return;

    trigger.addEventListener('click', function (event) {
      event.stopPropagation();
      open();
    });
    cancelBtn.addEventListener('click', close);
    mask.addEventListener('click', function (event) {
      if (event.target === mask) close();
    });
    saveBtn.addEventListener('click', function () {
      apply(input.value);
      close();
      toast(state.author ? '✓ 署名已保存：' + state.author : '已清空署名');
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); saveBtn.click(); }
      else if (event.key === 'Escape') { event.preventDefault(); close(); }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !mask.hidden) close();
    });

    reflect();
    restore();
  }

  return {
    build: build,
    open: open,
    close: close,
    get: function () { return state.author; }
  };
})(window.GZH);
