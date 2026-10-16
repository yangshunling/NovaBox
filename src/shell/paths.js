'use strict';

/**
 * 用户数据目录。
 *
 * 所有需要留存的东西（数据库、日志、将来的缓存）都放在用户主目录下的 `.toolbox`，
 * **不用** Electron 默认的 %APPDATA%\<productName>：
 *   - 路径好记、好备份、好手动清理
 *   - 卸载时由安装程序问一句「要不要一起删掉」（见 build/installer.nsh）
 *
 *   ~/.toolbox/
 *     toolbox.db          统一配置库（node:sqlite）
 *     logs/main.log       主进程与渲染进程的日志
 */

const os = require('os');
const path = require('path');

const DATA_DIR = path.join(os.homedir(), '.toolbox');

module.exports = {
  DATA_DIR,
  DB_FILE: path.join(DATA_DIR, 'toolbox.db'),
  LOGS_DIR: path.join(DATA_DIR, 'logs'),
  LOG_FILE: path.join(DATA_DIR, 'logs', 'main.log')
};
