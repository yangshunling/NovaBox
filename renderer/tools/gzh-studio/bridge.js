/* ---- 外壳宿主桥（由 tools/gzh-studio/patch-tool-bridge.py 生成，别手改）----
   跑在外壳 iframe 里时，把主进程能力代理成 window.toolbox；单独用浏览器打开时不动，
   页面会退回自己的兜底实现（公共代理链、localStorage）。

   这里只做转发，不认识任何具体方法名 —— 方法名和参数原样交给外壳，
   由外壳补上「消息来自哪个工具」再转给该工具的主进程模块。

   所有方法都 resolve 成 { ok: true, result } | { ok: false, error }，不会 reject。 */
(function () {
  if (window.parent === window) return;

  var pending = {};
  var seq = 0;
  var toastHandlers = [];

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.channel !== 'host') return;

    if (data.type === 'toast') {
      for (var i = 0; i < toastHandlers.length; i++) toastHandlers[i](String(data.message || ''));
      return;
    }
    var done = pending[data.id];
    if (!done) return;
    delete pending[data.id];
    done(data.result);
  });

  function callHost(type, payload) {
    return new Promise(function (resolve) {
      var id = type + '-' + (++seq);
      pending[id] = resolve;
      var message = { channel: 'tool', type: type, id: id };
      for (var key in payload) message[key] = payload[key];
      window.parent.postMessage(message, '*');
    });
  }

  window.toolbox = {
    /* 调本工具的主进程模块：invoke('fetchArticle', { url }) */
    invoke: function (method, payload) {
      return callHost('invoke', { method: method, payload: payload });
    },

    /* 统一配置库，所有工具共用 */
    store: {
      get: function (key) { return callHost('store', { op: 'get', args: [key] }); },
      set: function (key, value) { return callHost('store', { op: 'set', args: [key, value] }); },
      remove: function (key) { return callHost('store', { op: 'remove', args: [key] }); },
      all: function () { return callHost('store', { op: 'all', args: [] }); }
    },

    onToast: function (handler) { toastHandlers.push(handler); }
  };
})();
