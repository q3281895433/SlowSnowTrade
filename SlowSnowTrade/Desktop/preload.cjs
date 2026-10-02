const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('SlowSnowDesktop', {
  postMessage: payload => ipcRenderer.send('sst:command', payload),
  onEvent: callback => {
    if (typeof callback !== 'function') return;
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('sst:event', listener);
    return () => ipcRenderer.removeListener('sst:event', listener);
  }
});
