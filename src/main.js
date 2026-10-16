'use strict';

/**
 * 主进程入口 —— 只做「平台」的事：开窗、快捷键、装配通用能力、把各工具的主进程
 * 模块挂到通用 IPC 上。
 *
 * 这里**不应该出现任何具体工具的名字或业务逻辑**。工具自己的主进程代码放
 * src/tools/<id>/main.js，由 shell/tool-modules.js 自动发现。
 */

const { app, BrowserWindow, Menu, ipcMain, session, shell } = require('electron');
const path = require('path');

const toolModules = require('./shell/tool-modules');
const downloads = require('./shell/downloads');
const store = require('./shell/store');
const logger = require('./shell/logger');
const { DATA_DIR, LOG_FILE } = require('./shell/paths');

const APP_NAME = '匿名百宝箱';
const APP_ID = 'com.toolbox.desktop';
const ICON_PATH = path.join(__dirname, 'assets', 'icon.ico');

/* 左侧导航栏固定 214px，工具区不能比公众号排版工具的 900px 断点还窄，
   否则它的双栏会掉成上下堆叠。所以最小宽度按 214 + 966 留。 */
const RAIL_WIDTH = 214;
const MIN_TOOL_WIDTH = 966;
const MIN_WINDOW_WIDTH = RAIL_WIDTH + MIN_TOOL_WIDTH;

let mainWindow = null;

/* ---------- 窗口 ---------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: '#F4F6F8',
    icon: ICON_PATH,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  /* 外壳页面：左侧导航 + iframe 里的各个工具 */
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  bindShortcuts(mainWindow);

  /* 工具里的外链（页脚的 GitHub 等）丢给系统浏览器，别把窗口导航走 */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
}

function notifyShell(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('shell:toast', message);
  }
}

/* ---------- 快捷键（菜单栏已整体移除） ---------- */

/* 没有菜单栏了，几个还需要的操作改由键盘兜住。
   故意不接 Ctrl+R 全量重载 —— 误按会把编辑器里的文章丢掉，要重载用 Ctrl+Shift+R。 */
function zoomBy(win, delta) {
  const next = win.webContents.getZoomLevel() + delta;
  win.webContents.setZoomLevel(Math.max(-3, Math.min(3, next)));
}

function bindShortcuts(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const mod = input.control || input.meta;

    if (key === 'f12' || (mod && input.shift && key === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
      return;
    }
    if (mod && input.shift && key === 'r') {
      win.webContents.reload();
      event.preventDefault();
      return;
    }
    if (!mod) return;
    if (key === '=' || key === '+') { zoomBy(win, 0.5); event.preventDefault(); }
    else if (key === '-') { zoomBy(win, -0.5); event.preventDefault(); }
    else if (key === '0') { win.webContents.setZoomLevel(0); event.preventDefault(); }
  });
}

/* ---------- IPC：通用通道 ---------- */

function registerIpc(modules) {
  const byId = {};
  modules.forEach((mod) => { byId[mod.id] = mod; });

  /**
   * 工具调用自己主进程模块的唯一入口。
   * 外壳知道消息来自哪个工具 iframe，所以 toolId 由外壳填，工具自己不用报身份。
   */
  ipcMain.handle('tool:invoke', async (_event, toolId, method, payload) => {
    const mod = byId[toolId];
    if (!mod) return { ok: false, error: '没有名为 ' + toolId + ' 的工具主进程模块' };

    const fn = mod.methods && mod.methods[method];
    if (typeof fn !== 'function') {
      return { ok: false, error: '工具 ' + toolId + ' 没有提供 ' + method };
    }

    try {
      return { ok: true, result: await fn(payload || {}) };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : '调用失败' };
    }
  });

  /* 统一配置库：所有工具共用的键值存储（~/.toolbox/toolbox.db） */
  ipcMain.handle('store:get', (_event, key) => wrapStore(() => store.get(key)));
  ipcMain.handle('store:set', (_event, key, value) => wrapStore(() => store.set(key, value)));
  ipcMain.handle('store:remove', (_event, key) => wrapStore(() => store.remove(key)));
  ipcMain.handle('store:all', () => wrapStore(() => store.all()));

  ipcMain.handle('shell:info', () => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    dataDir: DATA_DIR,
    logFile: LOG_FILE
  }));

  /* 让用户能直接在文件管理器里打开数据目录（求助时把日志发出来） */
  ipcMain.handle('shell:openDataDir', async () => {
    const error = await shell.openPath(DATA_DIR);
    if (error) {
      logger.error('shell', '打开数据目录失败：' + error);
      return { ok: false, error: error };
    }
    return { ok: true };
  });
}

function wrapStore(run) {
  try {
    return { ok: true, result: run() };
  } catch (error) {
    logger.error('store', '配置库操作失败：' + (error && error.message ? error.message : error));
    return { ok: false, error: error && error.message ? error.message : '配置库操作失败' };
  }
}

/* ---------- 启动 ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.setAppUserModelId(APP_ID);

  app.whenReady().then(() => {
    /* 不设 null 的话 Electron 会挂上默认的 File/Edit/View 菜单 */
    Menu.setApplicationMenu(null);

    logger.install(app, BrowserWindow);
    logger.info('app', '启动 ' + APP_NAME + ' v' + app.getVersion() + '，数据目录 ' + DATA_DIR);

    try {
      store.open();
      logger.info('store', '配置库就绪：' + JSON.stringify(store.info()));
    } catch (error) {
      /* 库打不开不该拦着应用启动，但要在日志里留痕 */
      logger.error('store', '配置库打开失败：' + (error && error.message ? error.message : error));
    }

    const modules = toolModules.load();
    modules.forEach((mod) => {
      if (typeof mod.setup === 'function') mod.setup({ session, app });
    });
    logger.info('tools', '已加载工具主进程模块：' + (modules.map((m) => m.id).join(', ') || '（无）'));

    registerIpc(modules);
    downloads.setup(() => mainWindow, notifyShell);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('will-quit', () => {
    logger.info('app', '退出');
    store.close();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
