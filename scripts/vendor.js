// Copia as bibliotecas do player para src/web/vendor (o app não depende de CDN).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'web', 'vendor');
fs.mkdirSync(out, { recursive: true });
for (const [from, to] of [
  ['hls.js/dist/hls.min.js', 'hls.min.js'],
  ['mpegts.js/dist/mpegts.js', 'mpegts.js'],
]) {
  fs.copyFileSync(path.join(root, 'node_modules', from), path.join(out, to));
  console.log('vendor/' + to);
}
