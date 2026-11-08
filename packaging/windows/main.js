// เฮียผัด! desktop launcher: serves the built game from a local HTTP server and opens it in a window.
const { app, BrowserWindow, session } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ktx2': 'image/ktx2' };

// ---- GPU / frame pacing
// Laptops with two GPUs (Intel + NVIDIA/AMD) otherwise often run the game on the weak integrated chip.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Direct3D 11 is ANGLE's fastest, most mature Windows backend (explicit: some drivers get d3d11on12 / gl otherwise)
if (process.platform === 'win32') app.commandLine.appendSwitch('use-angle', 'd3d11');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
// a game window must never be throttled when it is partly covered or loses focus
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// A FIXED port keeps the page origin stable between launches — localStorage (settings, chosen quality, profile)
// is per origin, and a random port lost all of it every time the game started.
const PORTS = [47321, 47322, 47323, 47324, 47325, 47326, 47327, 47328, 0];

function serve(cb, i = 0) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, path.normalize(p));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.stat(f, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
      fs.createReadStream(f).pipe(res);
    });
  });
  srv.once('error', () => serve(cb, i + 1));
  srv.listen(PORTS[Math.min(i, PORTS.length - 1)], '127.0.0.1', () => cb(srv));
}

app.whenReady().then(() => {
  // which GPU did we get? (written next to the saves: %APPDATA%/Hia Phat/gpu.json — handy for "it lags" reports)
  app.getGPUInfo('basic').then((info) => {
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'gpu.json'), JSON.stringify({ gpu: info.gpuDevice, feature: app.getGPUFeatureStatus() }, null, 1)); } catch {}
  }).catch(() => {});
  serve((srv) => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
    const win = new BrowserWindow({
      width: 1600, height: 900, show: false, title: 'เฮียผัด! Hia Phat', backgroundColor: '#0b0906', autoHideMenuBar: true,
      webPreferences: { backgroundThrottling: false, spellcheck: false },
    });
    win.once('ready-to-show', () => { win.maximize(); win.show(); });
    win.loadURL(`http://127.0.0.1:${srv.address().port}/`);
    win.webContents.on('before-input-event', (_e, i) => {
      if (i.type !== 'keyDown') return;
      if (i.key === 'F11' || (i.key === 'Enter' && i.alt)) win.setFullScreen(!win.isFullScreen());
    });
  });
});
app.on('window-all-closed', () => app.quit());
