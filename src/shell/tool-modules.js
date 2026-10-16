'use strict';

/**
 * 发现并加载各工具的**主进程侧**模块。
 *
 * 每个工具可以在 src/tools/<id>/main.js 放自己在主进程这边要做的事，导出：
 *   { id: string, setup?(ctx), methods?: { [name]: (payload) => Promise<any> } }
 *
 * src/main.js 只把它们挂到通用 IPC `tool:invoke` 上，自己不认识任何具体工具 ——
 * 加一个工具不需要动主进程的代码。
 */

const fs = require('fs');
const path = require('path');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');

function load() {
  if (!fs.existsSync(TOOLS_DIR)) return [];

  return fs
    .readdirSync(TOOLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(TOOLS_DIR, entry.name, 'main.js'))
    .filter((file) => fs.existsSync(file))
    .map((file) => {
      const mod = require(file);
      if (!mod || typeof mod.id !== 'string' || !mod.id) {
        throw new Error('工具主进程模块缺少 id：' + file);
      }
      return mod;
    });
}

module.exports = { load };
