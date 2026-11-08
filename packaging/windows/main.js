// เฮียผัด! desktop launcher: serves the built game from a local HTTP server and opens it in a window.
const { app, BrowserWindow, session } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(() => {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, path.normalize(p));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  }).listen(0, '127.0.0.1', () => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
    const win = new BrowserWindow({ width: 1600, height: 900, title: 'เฮียผัด! Hia Phat', backgroundColor: '#000000', autoHideMenuBar: true, webPreferences: { backgroundThrottling: false } });
    win.maximize();
    win.loadURL(`http://127.0.0.1:${srv.address().port}/`);
    win.webContents.on('before-input-event', (_e, i) => { if (i.type === 'keyDown' && i.key === 'F11') win.setFullScreen(!win.isFullScreen()); });
  });
});
app.on('window-all-closed', () => app.quit());
