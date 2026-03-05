const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nodeForge", {
  isElectron: true,
  send: (channel, payload) => ipcRenderer.send(channel, payload),
  on: (channel, handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, data) => handler(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
