'use strict';

/**
 * 下载落盘：把工具触发的 Blob 下载交系统保存对话框，而不是默默丢进下载目录。
 *
 * 与具体工具无关 —— 任何工具触发 <a download> 都走这里。
 */

const path = require('path');
const { app, dialog, session } = require('electron');

const FILTERS = {
  '.html': [{ name: 'HTML 文件', extensions: ['html'] }],
  '.png': [{ name: 'PNG 图片', extensions: ['png'] }],
  '.md': [{ name: 'Markdown', extensions: ['md'] }],
  '.txt': [{ name: '文本文件', extensions: ['txt'] }]
};

/**
 * @param {() => Electron.BrowserWindow|null} getWindow 取当前窗口（可能已经关了）
 * @param {(message: string) => void} notify 存完后的提示出口（发给外壳）
 */
function setup(getWindow, notify) {
  session.defaultSession.on('will-download', (event, item) => {
    const suggested = item.getFilename();
    const ext = path.extname(suggested).toLowerCase();
    const options = {
      title: '保存文件',
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: FILTERS[ext] || [{ name: '所有文件', extensions: ['*'] }]
    };

    /* 窗口可能已经关了（比如下载还没结束就退出），这时不能把 null 当父窗口传 */
    const parent = getWindow();
    const savePath = parent
      ? dialog.showSaveDialogSync(parent, options)
      : dialog.showSaveDialogSync(options);

    if (!savePath) {
      item.cancel();
      return;
    }

    item.setSavePath(savePath);
    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') notify('✓ 已保存到 ' + savePath);
    });
  });
}

module.exports = { setup };
