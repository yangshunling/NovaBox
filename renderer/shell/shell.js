'use strict';

/**
 * 外壳：左侧导航 + iframe 工具宿主 + 主进程能力代理。
 *
 * 为什么用 iframe 而不是动态 import：
 *   工具之间要真正隔离。iframe 给每个工具独立的 JS realm，A 工具的 `marked`、
 *   全局变量、CSS 不会碰到 B 工具；加工具也不用把新代码塞进同一份文档里。
 *   代价是工具拿不到 preload，所以要由外壳替它们转达主进程能力（见下面 broker）。
 *
 * 工具载体一旦创建就**不销毁**，只切换显隐 —— 排版工坊里的文章不能因为点一下别的
 * 工具就没了。
 */

(function () {
  var tools = Array.isArray(window.GZH_TOOLS) ? window.GZH_TOOLS.slice() : [];
  var railTools = document.getElementById('railTools');
  var stage = document.getElementById('stage');
  var stageEmpty = document.getElementById('stageEmpty');
  var toastEl = document.getElementById('toast');

  var frames = {};          /* id -> iframe */
  var order = [];           /* 已注册工具的 id 顺序 */
  var activeId = null;

  /* ---------- 工具提示 ---------- */

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* ---------- 导航栏 ---------- */

  function placeholderIcon(name) {
    return '<span>' + (name || '?').trim().charAt(0) + '</span>';
  }

  function renderRail() {
    railTools.innerHTML = '';
    var groups = [];
    tools.forEach(function (tool) {
      var title = tool.group || '工具';
      var bucket = groups.filter(function (g) { return g.title === title; })[0];
      if (!bucket) { bucket = { title: title, items: [] }; groups.push(bucket); }
      bucket.items.push(tool);
    });

    groups.forEach(function (group) {
      var wrap = document.createElement('div');
      wrap.className = 'rail-group';

      var head = document.createElement('div');
      head.className = 'rail-group-title';
      head.textContent = group.title;
      wrap.appendChild(head);

      group.items.forEach(function (tool) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'tool-item';
        button.setAttribute('data-tool', tool.id);
        button.title = tool.desc || tool.name;

        var icon = document.createElement('span');
        icon.className = 'tool-icon';
        icon.innerHTML = tool.icon || placeholderIcon(tool.name);

        var name = document.createElement('span');
        name.className = 'tool-name';
        name.textContent = tool.name;

        button.appendChild(icon);
        button.appendChild(name);

        if (tool.badge) {
          var badge = document.createElement('span');
          badge.className = 'tool-badge';
          badge.textContent = tool.badge;
          button.appendChild(badge);
        }

        button.addEventListener('click', function () { activate(tool.id); });
        wrap.appendChild(button);
      });

      railTools.appendChild(wrap);
    });

    document.getElementById('footTools').textContent = String(tools.length);
    stageEmpty.hidden = tools.length > 0;
  }

  function markActive(id) {
    Array.prototype.forEach.call(railTools.querySelectorAll('.tool-item'), function (button) {
      button.classList.toggle('active', button.getAttribute('data-tool') === id);
    });
  }

  /* ---------- 工具载体 ---------- */

  function ensureFrame(tool) {
    if (!frames[tool.id]) {
      var frame = document.createElement('iframe');
      frame.className = 'frame';
      frame.setAttribute('data-tool', tool.id);
      frame.setAttribute('title', tool.name);
      frame.setAttribute('allow', 'clipboard-write');
      frame.hidden = true;
      frame.src = tool.entry;          /* 相对 renderer/，文件协议下同级子目录可直接加载 */
      stage.appendChild(frame);
      frames[tool.id] = frame;
    }
    return frames[tool.id];
  }

  function activate(id, options) {
    var tool = tools.filter(function (t) { return t.id === id; })[0];
    if (!tool) return;

    Object.keys(frames).forEach(function (key) {
      frames[key].hidden = key !== id;
    });
    ensureFrame(tool);
    frames[id].hidden = false;

    activeId = id;
    markActive(id);
    if (!options || options.updateHash !== false) {
      try { history.replaceState(null, '', '#' + id); } catch (error) { /* file:// 下可能受限，忽略 */ }
    }
  }

  function restoreFromHash() {
    var wanted = (location.hash || '').replace(/^#/, '');
    if (wanted && frames[wanted] !== undefined) { activate(wanted); return; }
    if (wanted && tools.some(function (t) { return t.id === wanted; })) { activate(wanted); return; }
    if (tools.length) activate(tools[0].id);
  }

  /* ---------- 主进程能力代理 ---------- */

  /* 只有我们自己创建的工具 iframe 才受理，file:// 下 origin 是 null，比不了 origin 就比 source */
  function frameFor(source) {
    var ids = Object.keys(frames);
    for (var i = 0; i < ids.length; i++) {
      if (frames[ids[i]].contentWindow === source) return ids[i];
    }
    return null;
  }

  function reply(source, id, result) {
    source.postMessage({ channel: 'host', id: id, result: result }, '*');
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.channel !== 'tool') return;

    var toolId = frameFor(event.source);
    if (!toolId) return;

    /* 通用转发：外壳不认识任何具体方法名，method / payload 原样递给该工具的主进程模块。
       工具身份由外壳按「消息来自哪个 iframe」填，工具自己报的不算数。 */
    if (data.type === 'invoke') {
      if (!window.toolbox) {
        reply(event.source, data.id, { ok: false, error: '外壳没有主进程能力（请用桌面版启动）' });
        return;
      }
      window.toolbox.invoke(toolId, data.method, data.payload).then(
        function (result) { reply(event.source, data.id, result); },
        function (error) {
          reply(event.source, data.id, { ok: false, error: String((error && error.message) || error) });
        }
      );
      return;
    }

    /* 统一配置库：不区分工具身份，谁都能读写（和 invoke 不一样） */
    if (data.type === 'store') {
      var method = window.toolbox && window.toolbox.store ? window.toolbox.store[data.op] : null;
      if (typeof method !== 'function') {
        reply(event.source, data.id, { ok: false, error: '外壳没有配置库能力（请用桌面版启动）' });
        return;
      }
      method.apply(null, data.args || []).then(
        function (result) { reply(event.source, data.id, result); },
        function (error) {
          reply(event.source, data.id, { ok: false, error: String((error && error.message) || error) });
        }
      );
      return;
    }

    if (data.type === 'shell:toast') {
      toast(String(data.message || ''));
    }
  });

  /* 主进程保存完文件的通知：转给当前工具，让它在自己的界面上提示 */
  if (window.toolbox && window.toolbox.onToast) {
    window.toolbox.onToast(function (message) {
      var frame = activeId ? frames[activeId] : null;
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ channel: 'host', type: 'toast', message: message }, '*');
      } else {
        toast(message);
      }
    });
  }

  /* ---------- 启动 ---------- */

  renderRail();
  restoreFromHash();

  if (window.toolbox && window.toolbox.info) {
    window.toolbox.info().then(function (info) {
      document.getElementById('footElectron').textContent = info.electron;
      document.getElementById('railVersion').textContent = 'v' + info.appVersion;
    }).catch(function () { /* 独立浏览器里打开时没有这个能力，忽略 */ });
  }

  window.addEventListener('hashchange', restoreFromHash);
})();
