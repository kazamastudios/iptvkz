// Gera o app de computador em dist/desktop/. Uso: node scripts/build-desktop.js --win|--mac|--linux [--publish ...]
// Só a versão publicada (tag v* no CI) se chama IPTVKZ. Qualquer outro build (no PC ou de um PR) é o app de
// testes "IPTVKZ Beta": outro id e outro nome, instalado ao lado do oficial e com os próprios dados.
//
// FFmpeg junto do app (áudio AC3/DTS, MKV, ver src/server/ffmpeg.js): vai em resources/ffmpeg/. De onde vem:
// 1. FFMPEG_BIN=caminho do executável (para a plataforma deste build);
// 2. dist/desktop/componentes/iptvkz-ffmpeg-*-<os>-<arch>.zip, o FFmpeg reduzido do CI (o da versão publicada);
// 3. só no Beta: o ffmpeg instalado neste computador (PATH), para testar sem esperar o CI.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeBuildInfo, buildInfo } = require('./build-info');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'desktop');
writeBuildInfo(path.join(root, 'src', 'web'));
const beta = buildInfo().channel !== 'producao';
const args = process.argv.slice(2);

const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build;
if (beta) {
  Object.assign(config, {
    productName: 'IPTVKZ Beta',
    appId: 'com.lucasyemz.iptvkz.beta',
    artifactName: 'IPTVKZ-Beta-${version}-${os}-${arch}.${ext}',
  });
  // ícones âmbar com a faixa BETA (scripts/make-beta-icons.py)
  Object.assign(config.win, { icon: 'platforms/windows/iptvkz-beta.ico' });
  Object.assign(config.mac, { icon: 'assets/brand/icon-mac-beta-1024.png' });
  Object.assign(config.linux, { icon: 'assets/brand/icon-beta-1024.png' });
  Object.assign(config.nsis, { shortcutName: 'IPTVKZ Beta', artifactName: 'IPTVKZ-Beta-${version}-windows-setup.${ext}' });
  Object.assign(config.portable, { artifactName: 'IPTVKZ-Beta-${version}-windows-portable.${ext}' });
}

// ---------- FFmpeg ----------
const OS = { win32: 'win', darwin: 'mac', linux: 'linux' };
const exeName = (o) => (o === 'win' ? 'ffmpeg.exe' : 'ffmpeg');
const stage = path.join(out, 'ffmpeg-bin');
fs.rmSync(stage, { recursive: true, force: true });

function put(target, file) {
  const dir = path.join(stage, target);
  const dst = path.join(dir, exeName(target.split('-')[0]));
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, dst);
  fs.chmodSync(dst, 0o755);
  console.log(`FFmpeg ${target}: ${file}`);
}

const host = `${OS[process.platform]}-${process.arch}`;
if (process.env.FFMPEG_BIN) put(host, process.env.FFMPEG_BIN);
const zips = path.join(out, 'componentes');
for (const z of fs.existsSync(zips) ? fs.readdirSync(zips) : []) {
  const m = /^iptvkz-ffmpeg-[\d.]+-(win|mac|linux)-(x64|arm64)\.zip$/.exec(z);
  if (!m || fs.existsSync(path.join(stage, `${m[1]}-${m[2]}`))) continue;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-'));
  if (process.platform === 'win32') {
    execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', path.join(zips, z), '-C', tmp]);
  } else {
    execFileSync('unzip', ['-q', '-o', path.join(zips, z), '-d', tmp]);
  }
  put(`${m[1]}-${m[2]}`, path.join(tmp, exeName(m[1])));
}
if (beta && !fs.existsSync(path.join(stage, host))) {
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg']).toString().split(/\r?\n/)[0].trim();
    if (found) put(host, fs.realpathSync(found));
  } catch {}
}
if (fs.existsSync(stage)) {
  // ${os}-${arch}: cada instalador leva o FFmpeg do próprio sistema (o Mac gera um para Intel e outro para M1+)
  config.extraResources = [...(config.extraResources || []), { from: 'dist/desktop/ffmpeg-bin/${os}-${arch}', to: 'ffmpeg' }];
} else {
  console.log('FFmpeg: nenhum encontrado; o app usa o componente baixado sob demanda.');
}

fs.mkdirSync(out, { recursive: true });
const cfgFile = path.join(out, 'builder-config.json');
fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2));
// pelo Node, sem shell: no Windows o .cmd quebraria nomes com espaço em dois argumentos
const cli = require.resolve('electron-builder/cli.js', { paths: [root] });
execFileSync(process.execPath, [cli, '--config', cfgFile, ...args], { stdio: 'inherit', cwd: root });
