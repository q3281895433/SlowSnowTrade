const { app, BrowserWindow, ipcMain, Menu, shell, safeStorage, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const DesktopService = require('./service.cjs');

const appId = 'com.local.papertrade';
const webRoot = path.join(__dirname, '../Web');
const indexURL = pathToFileURL(path.join(webRoot, 'index.html')).href;
let window, service, quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId(appId);
    window = new BrowserWindow({
      width: 1480, height: 900, minWidth: 980, minHeight: 650,
      title: 'SlowSnowTrade', backgroundColor: '#080b10', show: false,
      icon: path.join(webRoot, 'assets/app-icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, webSecurity: true
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== indexURL) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    service = new DesktopService({
      desktop: app.getPath('desktop'), userData: app.getPath('userData'), safeStorage, shell,
      promptPath: path.join(__dirname, '../Agent/review-system-prompt.txt'),
      emit: (type, data) => { if (window && !window.isDestroyed()) window.webContents.send('sst:event', { type, data }); }
    });
    await service.initialize();
    ipcMain.on('sst:command', (event, message) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== indexURL) return;
      service.dispatch(message);
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '小雪交易', submenu: [{ label: '打开复盘文件夹', click: () => service.openTradeLog() }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
      { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
      { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'togglefullscreen', label: '全屏' }] }
    ]));
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => { window = null; service.close(); });
    await window.loadFile(path.join(webRoot, 'index.html'));
  }).catch(error => { dialog.showErrorBox('SlowSnowTrade 无法启动', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (!service || quitting) return;
    event.preventDefault(); quitting = true;
    service.close().finally(() => app.quit());
  });
}
