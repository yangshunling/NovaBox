'use strict';

/**
 * 外壳页面与主进程之间唯一的通道。
 *
 * 只注入到**外壳**（主 frame），工具页跑在 iframe 里拿不到这里的任何东西 ——
 * 工具要主进程能力得让外壳替它转发（renderer/shell/shell.js 的 broker）。
 * 这样工具页里的第三方内容碰不到 Node/IPC。
 *
 * 注意这里**不认识任何具体工具**：工具调用自己主进程模块用的都是同一条 `tool:invoke`，
 * toolId 由外壳按「消息来自哪个 iframe」填上，工具自己无法冒充别的工具。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toolbox', {
  /* 调某个工具自己的主进程模块：invoke(toolId, method, payload) */
  invoke: (toolId, method, payload) => ipcRenderer.invoke('tool:invoke', toolId, method, payload),

  /* 统一配置库（~/.toolbox/toolbox.db）—— 所有工具共用，不区分工具身份 */
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    remove: (key) => ipcRenderer.invoke('store:remove', key),
    all: () => ipcRenderer.invoke('store:all')
  },

  /* 主进程存完文件后的提示 */
  onToast: (handler) => {
    ipcRenderer.on('shell:toast', (_event, message) => handler(message));
  },

  info: () => ipcRenderer.invoke('shell:info'),
  openDataDir: () => ipcRenderer.invoke('shell:openDataDir')
});
