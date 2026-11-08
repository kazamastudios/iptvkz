// Gera o app da LG (dist-tv/*.ipk). Uso:
//   npm run ipk                              endereço em branco na primeira abertura
//   set IPTVKZ_TV_SERVER=192.168.1.10:8787   (opcional) já vem preenchido, para testes
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'platforms', 'webos');
const work = path.join(root, 'dist-tv', 'app');
const out = path.join(root, 'dist-tv');

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(work, f));
fs.copyFileSync(path.join(root, 'src', 'web', 'img', 'logo-horizontal.webp'), path.join(work, 'logo-horizontal.webp'));

const server = process.env.IPTVKZ_TV_SERVER || '';
const index = path.join(work, 'index.html');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').split('__SERVER__').join(server));

const version = require(path.join(root, 'package.json')).version;
const info = path.join(work, 'appinfo.json');
fs.writeFileSync(info, JSON.stringify({ ...JSON.parse(fs.readFileSync(info, 'utf8')), version }, null, 2));

const cli = path.join(root, 'node_modules', '@webos-tools', 'cli', 'bin', 'ares-package.js');
execFileSync(process.execPath, [cli, work, '--outdir', out, '--no-minify'], { stdio: 'inherit' });
