/* AI 排版优化：模型配置（增删改查 + 连接检测）、模型下拉、结果预览与套用。

   提示词在 prompts.js；模型配置目前存 localStorage，以后迁到统一配置库里。
 */

window.GZH.ai = (function (GZH) {
  'use strict';

  var Themes = GZH.Themes;
  var editor = GZH.editor;
  var SAMPLE_MD = GZH.SAMPLE_MD;
  var convert = GZH.convert;
  var toast = GZH.toast;
  var cleanMarkdown = GZH.cleanMarkdown;
  var bodyLength = GZH.bodyLength;
  var PING_MESSAGE = GZH.prompts.PING_MESSAGE;
  var optimizePrompt = GZH.prompts.optimizePrompt;

  /* 模型配置存进统一配置库（~/.toolbox/toolbox.db）。键名不带工具前缀 ——
     这类配置以后别的工具也能直接用。老版本塞在 localStorage 里，留一次迁移。 */
  var MODELS_KEY = 'ai.models';
  var LEGACY_LOCAL_KEY = 'gzh.studio.models.v1';
  var aiSlot = document.getElementById('aiSlot');
  var optimizeBtn = document.getElementById('btnOptimize');
  var aiPop = null;
  var aiModels = loadModels();
  var aiState = { open: false, runningId: null, checkingId: null, editingId: null, tested: '' };

  var aiModal = {
    mask: document.getElementById('aiModalMask'),
    title: document.getElementById('aiModalTitle'),
    name: document.getElementById('aiName'),
    base: document.getElementById('aiBase'),
    key: document.getElementById('aiKey'),
    model: document.getElementById('aiModel'),
    status: document.getElementById('aiModalStatus'),
    test: document.getElementById('aiTestBtn'),
    save: document.getElementById('aiSaveBtn'),
    cancel: document.getElementById('aiCancelBtn')
  };

  var aiResult = {
    mask: document.getElementById('aiResultMask'),
    title: document.getElementById('aiResultTitle'),
    note: document.getElementById('aiResultNote'),
    text: document.getElementById('aiResultText'),
    apply: document.getElementById('aiApplyBtn'),
    cancel: document.getElementById('aiResultCancelBtn')
  };

  function uid() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function loadModels() {
    try {
      var raw = localStorage.getItem(MODELS_KEY) || localStorage.getItem(LEGACY_LOCAL_KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.filter(function (item) {
        return item && item.baseUrl && item.model;
      }).map(function (item) {
        return {
          id: item.id || uid(),
          name: item.name || item.model,
          baseUrl: String(item.baseUrl).trim(),
          key: String(item.key || ''),
          model: String(item.model).trim(),
          status: item.status === 'ok' || item.status === 'bad' ? item.status : 'unknown',
          checkedAt: typeof item.checkedAt === 'number' ? item.checkedAt : null,
          checkedMsg: typeof item.checkedMsg === 'string' ? item.checkedMsg : ''
        };
      });
    } catch (error) { return []; }
  }

  function persistModels() {
    try {
      localStorage.setItem(MODELS_KEY, JSON.stringify(aiModels));
    } catch (error) {
      /* 隐私模式等场景写不了本地，不影响写库 */
    }
    /* 配置库是权威存储；写失败不打断交互，但要记一笔 */
    GZH.store.set(MODELS_KEY, aiModels).then(function (response) {
      if (response && response.ok === false) toast('模型配置写入配置库失败：' + response.error);
    }).catch(function () { /* 独立打开时走的是 localStorage 实现，不会 reject */ });
    return true;
  }

  /* 启动时把配置库里的读回来覆盖首屏那份；库里还没有就把本地这份搬过去。
     配置库是权威的，本地那份只是给「独立打开调试」和首屏用的缓存。 */
  function syncModelsFromStore() {
    return GZH.store.get(MODELS_KEY).then(function (response) {
      var saved = response && response.ok ? response.result : null;
      if (Array.isArray(saved)) {
        aiModels = saved;
      } else if (aiModels.length) {
        GZH.store.set(MODELS_KEY, aiModels);
      }
      try { localStorage.setItem(MODELS_KEY, JSON.stringify(aiModels)); } catch (error) { /* 忽略 */ }
      renderAiList();
    }).catch(function () { /* 配置库不可用：继续用本地那份 */ });
  }

  function findModel(id) {
    for (var i = 0; i < aiModels.length; i++) {
      if (aiModels[i].id === id) return aiModels[i];
    }
    return null;
  }

  /* 模型连通状态：unknown 未验证（灰）/ ok 上次调用成功（绿）/ bad 上次调用失败（红） */

  function modelSignature(model) {
    return [model.baseUrl, model.key, model.model].join('|');
  }

  function statusText(model) {
    if (model.status === 'ok') return '上次调用成功' + (model.checkedAt ? '（' + timeLabel(model.checkedAt) + '）' : '');
    if (model.status === 'bad') return '上次调用失败' + (model.checkedMsg ? '：' + model.checkedMsg : '');
    return '尚未验证，点右侧 ↻ 检测连接';
  }

  function timeLabel(timestamp) {
    var date = new Date(timestamp);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return (date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function markStatus(model, status, message) {
    if (!model) return;
    model.status = status;
    model.checkedAt = Date.now();
    model.checkedMsg = message || '';
    persistModels();
    renderAiList();
  }

  /* 最小开销的连通探测：同时用于「测试连接」和列表里的 ↻ 检测 */
  function pingModel(model) {
    return requestChat(model, [{ role: 'user', content: PING_MESSAGE }],
      { maxTokens: 512, temperature: 0, timeout: 60000, allowReasoning: true });
  }

  /* 把用户填的 Base URL 归一化为 chat/completions 地址 */
  function chatEndpoint(baseUrl) {
    var url = String(baseUrl || '').trim().replace(/\s+/g, '');
    if (!url) return '';
    url = url.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(url)) return url;
    return url + '/chat/completions';
  }

  /* 从各家 OpenAI 兼容返回里取出正文；推理型模型（deepseek-reasoner / Qwen 思考版等）
     可能只给 reasoning_content，这里一并识别，交给调用方决定是否接受 */
  function extractCompletion(data) {
    var choice = (data && data.choices && data.choices[0]) || null;
    var message = choice ? (choice.message || choice.delta) : null;
    var content = message ? message.content : (choice ? choice.text : null);
    if (Array.isArray(content)) {
      content = content.map(function (part) {
        if (typeof part === 'string') return part;
        return part && typeof part.text === 'string' ? part.text : '';
      }).join('');
    }
    var reasoning = message ? (message.reasoning_content || message.reasoning) : '';
    var notes = [];
    if (!data || !data.choices || !data.choices.length) notes.push('choices 为空');
    if (choice && choice.finish_reason) notes.push('finish_reason=' + choice.finish_reason);
    if (choice && choice.finish_reason === 'length') notes.push('输出被 max_tokens 截断');
    if (typeof reasoning === 'string' && reasoning.trim()) notes.push('只返回了思考内容（reasoning_content）');
    if (data) notes.push('响应字段：' + Object.keys(data).join(' / '));
    return {
      text: typeof content === 'string' ? content : '',
      reasoning: typeof reasoning === 'string' ? reasoning : '',
      notes: notes
    };
  }

  function requestChat(model, messages, options) {
    var opts = options || {};
    var endpoint = chatEndpoint(model.baseUrl);
    if (!endpoint) return Promise.reject(new Error('Base URL 不能为空'));
    var payload = {
      model: model.model,
      messages: messages,
      temperature: opts.temperature == null ? 0.3 : opts.temperature,
      stream: false
    };
    if (opts.maxTokens) payload.max_tokens = opts.maxTokens;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, opts.timeout || 120000);
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (model.key || '')
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    }).then(function (response) {
      return response.text().then(function (body) {
        var data = null;
        try { data = JSON.parse(body); } catch (error) { /* 下面统一报错 */ }
        if (!response.ok) {
          var detail = data && data.error && (data.error.message || data.error.type);
          throw new Error(String(detail || ('HTTP ' + response.status + ' ' + response.statusText)).slice(0, 200));
        }
        if (!data || typeof data !== 'object') throw new Error('返回内容不是 JSON，请确认该地址是 OpenAI 兼容接口');
        /* 有些网关即使出错也返回 200，错误藏在 body 里 */
        if (!data.choices) {
          var failure = data.error ? (data.error.message || data.error.type) : (data.msg || data.message);
          if (failure) throw new Error(String(failure).slice(0, 200));
        }
        var picked = extractCompletion(data);
        if (!picked.text.trim()) {
          if (picked.reasoning.trim() && opts.allowReasoning) {
            return { text: picked.reasoning, reasoningOnly: true };
          }
          throw new Error('模型没有返回正文内容（' + picked.notes.join('；') + '）');
        }
        return { text: picked.text, reasoningOnly: false };
      });
    }).catch(function (error) {
      if (error && error.name === 'AbortError') throw new Error('请求超时，请检查网络或 Base URL');
      if (error instanceof TypeError) throw new Error('网络请求失败：Base URL 有误，或该服务未开放浏览器跨域（CORS）访问');
      throw error;
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  function setOptimizeBusy(busy, model) {
    optimizeBtn.disabled = busy;
    optimizeBtn.textContent = busy ? '优化中…' : 'AI优化';
    if (busy && model) optimizeBtn.setAttribute('title', '正在使用 ' + (model.name || model.model) + ' 优化…');
    else optimizeBtn.removeAttribute('title');
  }

  /* ---------- 模型下拉 ---------- */

  function closeAiPop() {
    if (!aiState.open) return;
    aiState.open = false;
    if (aiPop) aiPop.hidden = true;
    optimizeBtn.setAttribute('aria-expanded', 'false');
  }

  function renderAiList() {
    if (!aiPop) return;
    var html = '<div class="pop-head"><span class="pop-title">AI优化</span>'
      + '<span class="pop-note">' + aiModels.length + ' MODELS</span></div>';
    if (aiModels.length) {
      html += '<div class="ai-list">';
      aiModels.forEach(function (model) {
        var running = aiState.runningId === model.id;
        var checking = aiState.checkingId === model.id;
        var note = running ? ' · 优化中…' : (checking ? ' · 检测中…' : '');
        html += '<div class="ai-item' + (running ? ' running' : '') + '" data-id="' + model.id + '" role="button" tabindex="0" title="点击用该模型优化当前文章">'
          + '<span class="ai-dot ' + (model.status || 'unknown') + (running || checking ? ' pulsing' : '') + '" title="' + Themes.esc(statusText(model)) + '"></span>'
          + '<span class="ai-item-text">'
          + '<span class="ai-name">' + Themes.esc(model.name) + '</span>'
          + '<span class="ai-model">' + Themes.esc(model.model) + note + '</span>'
          + '</span>'
          + '<button class="ai-icon-btn" type="button" data-check="' + model.id + '" title="检测连接">↻</button>'
          + '<button class="ai-icon-btn" type="button" data-edit="' + model.id + '" title="编辑">✎</button>'
          + '<button class="ai-icon-btn" type="button" data-del="' + model.id + '" title="删除">✕</button>'
          + '</div>';
      });
      html += '</div>';
    } else {
      html += '<p class="ai-empty">还没有配置模型。<br>点击下方「配置模型」接入一个 OpenAI 兼容接口（DeepSeek / 通义 / Kimi / 智谱 / 本地 Ollama 等），连接测试通过后即可一键优化排版。</p>';
    }
    html += '<div class="ai-foot"><button class="ai-config" id="aiConfigBtn" type="button">＋ 配置模型</button></div>';
    aiPop.innerHTML = html;
    bindAiPop();
  }

  function bindAiPop() {
    aiPop.querySelectorAll('.ai-item').forEach(function (item) {
      item.addEventListener('click', function (event) {
        if (event.target.closest('.ai-icon-btn')) return;
        runOptimize(item.getAttribute('data-id'));
      });
      item.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          runOptimize(item.getAttribute('data-id'));
        }
      });
    });
    aiPop.querySelectorAll('[data-del]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        removeModel(button.getAttribute('data-del'));
      });
    });
    aiPop.querySelectorAll('[data-edit]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        openModelModal(findModel(button.getAttribute('data-edit')));
      });
    });
    aiPop.querySelectorAll('[data-check]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        checkModel(button.getAttribute('data-check'));
      });
    });
    var config = aiPop.querySelector('#aiConfigBtn');
    if (config) config.addEventListener('click', function () { openModelModal(null); });
  }

  /* 列表里 ↻ 检测连接：不打开配置弹框，直接探测并刷新圆点颜色 */
  function checkModel(id) {
    var model = findModel(id);
    if (!model) return;
    if (aiState.checkingId || aiState.runningId) { toast('已有任务在进行中，请稍候'); return; }
    aiState.checkingId = id;
    renderAiList();
    return pingModel(model)
      .then(function (result) {
        markStatus(model, 'ok', result.reasoningOnly ? '推理型模型，仅返回思考内容' : '');
        toast('✓ ' + (model.name || model.model) + ' 连接正常');
      })
      .catch(function (error) {
        var message = error && error.message ? error.message : '调用失败';
        markStatus(model, 'bad', message.slice(0, 60));
        toast('✗ ' + (model.name || model.model) + '：' + message);
      })
      .finally(function () {
        aiState.checkingId = null;
        renderAiList();
      });
  }

  function removeModel(id) {
    var model = findModel(id);
    if (!model) return;
    if (!window.confirm('删除模型「' + (model.name || model.model) + '」？')) return;
    aiModels = aiModels.filter(function (item) { return item.id !== id; });
    persistModels();
    renderAiList();
    toast('已删除：' + (model.name || model.model));
  }

  /* ---------- 选模型 → 优化 ---------- */

  function runOptimize(id) {
    var model = findModel(id);
    if (!model) return;
    if (aiState.runningId) { toast('已有模型正在优化，请稍候'); return; }
    var source = editor.value.trim();
    if (!source) { toast('先把文章粘进左侧编辑器'); return; }
    if (source.length > 30000) { toast('文章约 ' + source.length + ' 字，过长，建议分段优化'); return; }
    closeAiPop();
    aiState.runningId = id;
    setOptimizeBusy(true, model);
    renderAiList();
    return requestChat(model, [{ role: 'user', content: optimizePrompt(source) }], { temperature: 0.3, timeout: 180000 })
      .then(function (result) {
        if (result.reasoningOnly) toast('注意：该模型只返回了思考内容，请在结果框里核对排版');
        markStatus(model, 'ok', result.reasoningOnly ? '仅返回思考内容' : '');
        openResultModal(cleanMarkdown(result.text), model, source);
      })
      .catch(function (error) {
        var message = error && error.message ? error.message : '模型调用失败';
        markStatus(model, 'bad', message.slice(0, 60));
        toast('✗ ' + message);
      })
      .finally(function () {
        aiState.runningId = null;
        setOptimizeBusy(false);
        renderAiList();
      });
  }

  function openResultModal(text, model, source) {
    if (!text) { toast('模型返回内容为空，请换个模型或重试'); return; }
    aiResult.title.textContent = 'AI 优化结果 · ' + (model.name || model.model);
    aiResult.note.textContent = '已按「载入示例」的结构重排，并尽量少改原文：'
      + bodyLength(source) + ' 字 → ' + bodyLength(text) + ' 字。可直接在框内微调，确认后点「应用到编辑器」，'
      + '左侧原文会被替换（取消则不改动）。';
    aiResult.text.value = text;
    aiResult.mask.hidden = false;
    setTimeout(function () { aiResult.text.focus(); }, 30);
  }

  function applyResult() {
    var text = aiResult.text.value;
    if (!text || !text.trim()) { toast('结果为空，无法应用'); return; }
    editor.value = text;
    aiResult.mask.hidden = true;
    convert().catch(function () {});
    toast('✓ 已应用 AI 排版，可继续手动微调');
  }

  /* ---------- 配置模型弹框 ---------- */

  function setModalStatus(kind, message) {
    aiModal.status.className = 'modal-status' + (kind ? ' ' + kind : '');
    aiModal.status.textContent = message || '';
    aiModal.status.hidden = !message;
  }

  function readForm() {
    return {
      id: aiState.editingId || '',
      name: aiModal.name.value.trim() || aiModal.model.value.trim(),
      baseUrl: aiModal.base.value.trim(),
      key: aiModal.key.value.trim(),
      model: aiModal.model.value.trim()
    };
  }

  function validateForm(draft) {
    if (!draft.baseUrl) return '请填写 Base URL';
    if (!/^https?:\/\//i.test(draft.baseUrl)) return 'Base URL 需要以 http:// 或 https:// 开头';
    if (!draft.model) return '请填写模型名';
    return '';
  }

  function openModelModal(model) {
    closeAiPop();
    aiState.editingId = model ? model.id : null;
    aiState.tested = '';
    aiModal.title.textContent = model ? '编辑模型' : '配置模型';
    aiModal.name.value = model ? (model.name || '') : '';
    aiModal.base.value = model ? model.baseUrl : '';
    aiModal.key.value = model ? (model.key || '') : '';
    aiModal.model.value = model ? model.model : '';
    setModalStatus('', '');
    aiModal.mask.hidden = false;
    setTimeout(function () { aiModal.name.focus(); }, 30);
  }

  function testModel(draft) {
    setModalStatus('pending', '正在测试连接…');
    aiModal.test.disabled = true;
    var started = Date.now();
    /* pingModel 的 token 预算给足：推理型模型会先用掉一批思考 token，预算太小会被截断成空正文 */
    return pingModel(draft)
      .then(function (result) {
        var seconds = Math.round((Date.now() - started) / 100) / 10;
        var head = result.text.replace(/\s+/g, ' ').slice(0, 40);
        setModalStatus('ok', '✓ 连接成功（' + seconds + 's）：' + head
          + (result.reasoningOnly ? '（推理型模型，此处只回思考内容，不影响正式使用）' : ''));
        aiState.tested = modelSignature(draft);
        return true;
      })
      .catch(function (error) {
        setModalStatus('bad', '✗ ' + (error && error.message ? error.message : '测试失败'));
        aiState.tested = '';
        return false;
      })
      .finally(function () { aiModal.test.disabled = false; });
  }

  function saveModel(draft) {
    var index = -1;
    for (var i = 0; i < aiModels.length; i++) {
      if (aiModels[i].id === draft.id) index = i;
    }
    var previous = index >= 0 ? aiModels[index] : null;
    var record = {
      id: draft.id || uid(),
      name: draft.name || draft.model,
      baseUrl: draft.baseUrl,
      key: draft.key,
      model: draft.model,
      /* 能走到保存说明刚测通过：同端点且此前已验证过就沿用原时间，否则按刚验证记录 */
      status: 'ok',
      checkedAt: Date.now(),
      checkedMsg: ''
    };
    if (previous && previous.status === 'ok' && previous.checkedAt
      && modelSignature(previous) === modelSignature(record)) {
      record.checkedAt = previous.checkedAt;
    }
    if (index >= 0) aiModels[index] = record;
    else aiModels.push(record);
    if (!persistModels()) return;
    aiState.editingId = null;
    aiState.tested = '';
    aiModal.mask.hidden = true;
    renderAiList();
    toast('✓ 已保存模型：' + record.name);
  }

  function buildAi() {
    aiPop = document.createElement('div');
    aiPop.className = 'ai-pop';
    aiPop.id = 'aiPop';
    aiPop.hidden = true;
    aiPop.addEventListener('click', function (event) { event.stopPropagation(); });
    aiSlot.appendChild(aiPop);

    optimizeBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      aiState.open = !aiState.open;
      aiPop.hidden = !aiState.open;
      optimizeBtn.setAttribute('aria-expanded', String(aiState.open));
      if (aiState.open) renderAiList();
    });

    aiModal.cancel.addEventListener('click', function () { aiModal.mask.hidden = true; });
    aiModal.mask.addEventListener('click', function (event) {
      if (event.target === aiModal.mask) aiModal.mask.hidden = true;
    });
    aiModal.test.addEventListener('click', function () {
      var draft = readForm();
      var invalid = validateForm(draft);
      if (invalid) { setModalStatus('bad', '✗ ' + invalid); return; }
      testModel(draft);
    });
    aiModal.save.addEventListener('click', function () {
      var draft = readForm();
      var invalid = validateForm(draft);
      if (invalid) { setModalStatus('bad', '✗ ' + invalid); return; }
      if (modelSignature(draft) === aiState.tested) { saveModel(draft); return; }
      aiModal.save.disabled = true;
      testModel(draft).then(function (ok) {
        if (ok) saveModel(draft);
        else toast('连接测试未通过，配置未保存');
      }).finally(function () { aiModal.save.disabled = false; });
    });

    aiResult.apply.addEventListener('click', applyResult);
    aiResult.cancel.addEventListener('click', function () { aiResult.mask.hidden = true; });
    aiResult.mask.addEventListener('click', function (event) {
      if (event.target === aiResult.mask) aiResult.mask.hidden = true;
    });

    document.addEventListener('click', function () { closeAiPop(); });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      closeAiPop();
      aiModal.mask.hidden = true;
      aiResult.mask.hidden = true;
    });

    renderAiList();
    /* 库里的配置稍后到达，到了再刷一次列表 */
    syncModelsFromStore();
  }
  return { build: buildAi, closePop: closeAiPop };
})(window.GZH);
