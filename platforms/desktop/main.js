// IPTVKZ para computador (Windows, macOS, Linux): roda o mesmo servidor do IPTVKZ dentro do app
// e mostra a interface numa janela própria. Com o "acesso pela rede" ligado, fechar a janela
// deixa o app na bandeja do sistema para a TV continuar funcionando.
const path = require('path');
const { app, BrowserWindow, Menu, Tray, shell, nativeImage, dialog } = require('electron');

const BACKGROUND = process.argv.includes('--background');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Dados do usuário fora da pasta do programa (que é somente leitura depois de instalado).
  process.env.IPTVKZ_DATA = path.join(app.getPath('userData'), 'data');
  process.env.IPTVKZ_KEEPALIVE = '1';
  boot();
}

let win = null;
let tray = null;
let baseUrl = null;
let quitting = false;
let trayHintShown = false;

function iconPath(name) {
  return path.join(__dirname, '..', '..', 'assets', 'brand', name);
}

function boot() {
  const server = require('../../src/server/index.js');

  app.on('second-instance', () => showWindow());
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !server.lanEnabled()) app.quit();
  });
  app.on('activate', () => showWindow());

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') {
      app.dock.setIcon(nativeImage.createFromPath(iconPath('icon-1024.png')));
    } else {
      Menu.setApplicationMenu(null);
    }
    try {
      const { port } = await server.start({
        portFallback: true,
        keepAlive: true,
        onQuit: () => { quitting = true; app.quit(); },
        autostart: autostartAdapter(),
      });
      baseUrl = `http://127.0.0.1:${port}`;
    } catch (err) {
      dialog.showErrorBox('IPTVKZ', 'Não foi possível iniciar o servidor interno: ' + err.message);
      app.quit();
      return;
    }
    createTray(server);
    if (!BACKGROUND) showWindow();
  });
}

function showWindow() {
  if (!baseUrl) return;
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'IPTVKZ',
    backgroundColor: '#08080b',
    icon: iconPath(process.platform === 'win32' ? '../../platforms/windows/iptvkz.ico' : 'icon-1024.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.once('ready-to-show', () => win.show());
  // links externos abrem no navegador do sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(baseUrl)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.on('close', (e) => {
    const server = require('../../src/server/index.js');
    if (!quitting && server.lanEnabled() && process.platform !== 'darwin') {
      // a TV ainda pode estar usando o servidor: some para a bandeja em vez de fechar
      e.preventDefault();
      win.hide();
      if (tray && !trayHintShown && process.platform === 'win32') {
        trayHintShown = true;
        tray.displayBalloon({
          title: 'IPTVKZ continua ligado',
          content: 'O acesso pela rede está ligado, então o servidor segue rodando para a TV. Use o ícone na bandeja para abrir ou sair.',
          iconType: 'info',
        });
      }
    }
  });
  win.on('closed', () => { win = null; });
  win.loadURL(baseUrl + '/');
}

function createTray() {
  if (process.platform === 'darwin') return; // no Mac o Dock já faz esse papel
  // No Windows o .ico já traz cada tamanho desenhado para a bandeja.
  const img = process.platform === 'win32'
    ? nativeImage.createFromPath(iconPath('../../platforms/windows/iptvkz.ico'))
    : nativeImage.createFromPath(iconPath('icon-small-64.png')).resize({ width: 22, height: 22 });
  tray = new Tray(img);
  tray.setToolTip('IPTVKZ');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir IPTVKZ', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => showWindow());
}

// "Iniciar com o sistema": no Windows/macOS usa o recurso nativo; abre em segundo plano.
function autostartAdapter() {
  const supported = process.platform === 'win32' || process.platform === 'darwin';
  return {
    get: () => supported && app.getLoginItemSettings({ args: ['--background'] }).openAtLogin,
    set: async (on) => {
      if (!supported) throw new Error('Disponível só no Windows e no macOS.');
      app.setLoginItemSettings({ openAtLogin: on, openAsHidden: on, args: ['--background'] });
      return app.getLoginItemSettings({ args: ['--background'] }).openAtLogin;
    },
  };
}
