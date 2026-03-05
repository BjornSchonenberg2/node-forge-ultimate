const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const devToolsOn = process.env.NODE_FORGE_DEVTOOLS === '1';

let backendProcess;
let mainWindow;
let handWindow;
let handSettings = {
  speed: 1.6,
  smoothing: 0.22,
  keepAliveMs: 1500,
  enabled: true,
};

function startBackend() {
  if (process.env.NODE_FORGE_SKIP_BACKEND === '1') {
    return;
  }

  const backendPath = path.join(__dirname, '..', 'backend', 'src', 'index.js');
  const dataDir = path.join(app.getPath('userData'), 'data');

  backendProcess = fork(backendPath, [], {
    env: {
      ...process.env,
      NODE_FORGE_DATA_DIR: dataDir,
      NODE_FORGE_BACKEND_PORT: process.env.NODE_FORGE_BACKEND_PORT || '17811'
    },
    stdio: 'inherit'
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b0f14',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: !devToolsOn,
      allowRunningInsecureContent: devToolsOn
    }
  });

  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    mainWindow.loadURL(startUrl);
  } else {
    const buildIndex = path.join(__dirname, '..', 'build', 'index.html');
    if (fs.existsSync(buildIndex)) {
      mainWindow.loadFile(buildIndex);
    } else {
      mainWindow.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            '<!doctype html><html><body style="font-family:Segoe UI, sans-serif;padding:32px;background:#0b0f14;color:#e2e8f0;">' +
              '<h2>Build missing</h2>' +
              '<p>Run <code>npm run build</code> then restart the desktop app.</p>' +
              '</body></html>'
          )
      );
    }
  }

  if (devToolsOn) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createHandWindow() {
  if (handWindow && !handWindow.isDestroyed()) return;
  handWindow = new BrowserWindow({
    width: 340,
    height: 420,
    minWidth: 300,
    minHeight: 320,
    resizable: true,
    backgroundColor: '#0b0f14',
    alwaysOnTop: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
  });

  const handPath = path.join(__dirname, 'hand-window.html');
  handWindow.loadFile(handPath);
  handWindow.on('closed', () => {
    handWindow = null;
  });
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('file://')) {
      const isHandWindow = details.url.includes('hand-window.html');
      const csp = devToolsOn || isHandWindow
        ? [
            "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
            "img-src * data: blob:",
            "font-src * data:",
            "style-src * 'unsafe-inline'",
            "script-src * https: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
            "connect-src * data: blob: file: http: https:",
            "worker-src * blob:",
          ].join('; ')
        : [
            "default-src 'self'",
            "base-uri 'self'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
            "connect-src 'self' blob: data: file: http: https:",
            "worker-src 'self' blob:",
          ].join('; ');
      const responseHeaders = { ...(details.responseHeaders || {}) };
      responseHeaders['Content-Security-Policy'] = [csp];
      callback({ responseHeaders });
      return;
    }
    callback({ responseHeaders: details.responseHeaders });
  });

  startBackend();
  createWindow();
  createHandWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('hand-settings', (_ev, payload) => {
  if (payload && typeof payload === 'object') {
    handSettings = { ...handSettings, ...payload };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hand-settings', handSettings);
    }
  }
});

ipcMain.on('hand-ready', (ev) => {
  ev.sender.send('hand-settings', handSettings);
});

ipcMain.on('hand-pointer', (_ev, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hand-pointer', payload || {});
  }
});

ipcMain.on('hand-gesture', (_ev, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hand-gesture', payload || {});
  }
});
