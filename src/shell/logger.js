'use strict';

/**
 * 文件日志 —— 写在 ~/.toolbox/logs/main.log。
 *
 * 只做一件事：把主进程事件和渲染进程的报错落到文件，出问题时让用户能直接把日志发过来。
 * 不引第三方日志库，也**不落进数据库**（日志会写很大，塞进配置库不合适）。
 *
 * 单个文件超过 MAX_BYTES 就轮转一次：main.log -> main.log.1（只留一代，够用且简单）。
 */

const fs = require('fs');
const { LOGS_DIR, LOG_FILE } = require('./paths');

const MAX_BYTES = 2 * 1024 * 1024;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

let minLevel = LEVELS.info;
let stream = null;

function ensureDir() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function rotateIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size >= MAX_BYTES) {
      if (stream) { stream.end(); stream = null; }
      fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    }
  } catch (error) {
    /* 轮转失败不影响继续写 */
  }
}

function openStream() {
  if (stream) return stream;
  ensureDir();
  rotateIfNeeded();
  stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  stream.on('error', () => { stream = null; });
  return stream;
}

function line(level, scope, message) {
  return [
    new Date().toISOString(),
    level.toUpperCase().padEnd(5),
    '[' + scope + ']',
    message
  ].join(' ') + '\n';
}

function write(level, scope, message) {
  if (LEVELS[level] < minLevel) return;
  const text = typeof message === 'string' ? message : JSON.stringify(message);
  try {
    openStream().write(line(level, scope || 'app', text));
  } catch (error) {
    /* 日志写不进去也不能把应用带崩 */
  }
}

/**
 * 装上全局钩子：主进程未捕获异常、渲染进程的报错和 console 告警都进日志。
 * 渲染进程那一侧不区分来源 frame，所以工具 iframe 里的报错也会被记下来 —— 这正是想要的。
 */
function install(app, BrowserWindow) {
  minLevel = process.env.TOOLBOX_LOG_LEVEL
    ? (LEVELS[process.env.TOOLBOX_LOG_LEVEL] || LEVELS.info)
    : LEVELS.info;

  process.on('uncaughtException', (error) => {
    write('error', 'main', '未捕获异常：' + (error && error.stack ? error.stack : error));
  });
  process.on('unhandledRejection', (reason) => {
    write('error', 'main', '未处理的 Promise 拒绝：' + (reason && reason.stack ? reason.stack : reason));
  });

  app.on('web-contents-created', (_event, contents) => {
    /* Electron 新版给一个事件对象，老版给 (event, level, message, line, sourceId)，
       而箭头函数里没有 arguments，所以收成 rest 参数再判 */
    contents.on('console-message', (...args) => {
      const first = args[0];
      const details = first && typeof first === 'object' && 'message' in first
        ? first
        : { level: args[1], message: args[2], sourceId: args[4] };

      const levelMap = { 0: 'debug', 1: 'info', 2: 'warn', 3: 'error' };
      const level = levelMap[details.level] || details.level;
      if (level !== 'warn' && level !== 'error' && level !== 'warning') return;

      const source = details.sourceId ? '  <' + String(details.sourceId).split('/').pop() + '>' : '';
      write(level === 'error' ? 'error' : 'warn', 'renderer', String(details.message) + source);
    });
    contents.on('render-process-gone', (_e, details) => {
      write('error', 'renderer', '渲染进程退出：' + JSON.stringify(details));
    });
  });

  write('info', 'app', '日志已启动，文件：' + LOG_FILE);
}

module.exports = {
  install,
  debug: (scope, message) => write('debug', scope, message),
  info: (scope, message) => write('info', scope, message),
  warn: (scope, message) => write('warn', scope, message),
  error: (scope, message) => write('error', scope, message),
  LOG_FILE
};
