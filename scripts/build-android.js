// Gera o app Android (celular e TV) nos dois canais.
// Uso: npm run android           canal Developer: APK + arquivos de atualização em dist/android/
//      npm run android:play      canal Google Play: AAB em dist/android/play/
//                                PLAY_BETA=1: "IPTVKZ Beta" (teste interno/fechado); sem ele: "IPTVKZ" (produção),
//                                que só sai assinado a partir de uma tag v<versão do app>.
// Chaves do Developer: ANDROID_KEYSTORE, ANDROID_KEYSTORE_PASSWORD e ANDROID_UPDATE_KEY (arquivo PEM).
// Chaves da Play: PLAY_UPLOAD_KEYSTORE, PLAY_UPLOAD_KEYSTORE_PASSWORD, PLAY_UPLOAD_KEY_ALIAS e
// PLAY_UPLOAD_KEY_PASSWORD. Sem elas, o AAB sai sem assinatura e com "UNSIGNED" no nome (só para conferir).
// BUNDLETOOL (caminho do bundletool.jar), se definido, valida o AAB depois do build.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const android = path.join(root, 'platforms', 'android');
const out = path.join(root, 'dist', 'android');
const playOut = path.join(out, 'play');
const NODE_VERSION = 'v18.20.4';
// Node do app compilado com páginas de 16 KB (exigência da Google Play): release deste repositório, gerada pelo
// .github/workflows/libnode.yml a partir do nodejs-mobile (a versão pronta dele vem em 4 KB).
const LIBNODE_TAG = 'libnode-v18.20.4-16k';
const LIBNODE_REPO = process.env.LIBNODE_REPO || 'kazamastudios/iptvkz';
const NDK_VERSION = '27.2.12479018';
const PLAY = process.argv.includes('--play');
const WIN = process.platform === 'win32';
const TAR = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe'); // o do Windows, não o do Git

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function props() {
  const text = fs.readFileSync(path.join(android, 'version.properties'), 'utf8');
  return Object.fromEntries(text.split('\n').filter((l) => /^\w+=/.test(l)).map((l) => l.trim().split('=')));
}

// Node para Android: versão fixa, baixada uma vez para app/libnode.
function ensureLibnode() {
  const target = path.join(android, 'app', 'libnode');
  const mark = path.join(target, '16k.txt'); // a libnode antiga (4 KB) não tem este arquivo: é trocada
  if (fs.existsSync(path.join(target, 'include', 'node', 'node.h')) && fs.existsSync(mark)) return;
  fs.rmSync(target, { recursive: true, force: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'libnode-'));
  const zip = `nodejs-mobile-${NODE_VERSION}-android-16k.zip`;
  run('gh', ['release', 'download', LIBNODE_TAG, '--repo', LIBNODE_REPO, '-p', zip, '-D', tmp]);
  fs.mkdirSync(target, { recursive: true });
  if (WIN) run(TAR, ['-xf', path.join(tmp, zip), '-C', target, 'bin/armeabi-v7a', 'bin/arm64-v8a', 'include']);
  else run('unzip', ['-q', '-o', path.join(tmp, zip), 'bin/armeabi-v7a/*', 'bin/arm64-v8a/*', 'include/*', '-d', target]);
  fs.writeFileSync(mark, `${LIBNODE_TAG}\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// Google Play: toda biblioteca nativa de 64 bits alinhada em 16 KB. Confere dentro do APK ou do AAB pronto.
function check16k(pkg, prefix) {
  const ndk = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '', 'ndk', NDK_VERSION);
  const host = WIN ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
  const readelf = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', host, 'bin', WIN ? 'llvm-readelf.exe' : 'llvm-readelf');
  if (!fs.existsSync(readelf)) { console.log('llvm-readelf não encontrado: alinhamento de 16 KB não conferido.'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvkz-16k-'));
  if (WIN) run(TAR, ['-xf', pkg, '-C', tmp, `${prefix}lib/arm64-v8a`]);
  else run('unzip', ['-q', '-o', pkg, `${prefix}lib/arm64-v8a/*`, '-d', tmp]);
  const dir = path.join(tmp, prefix, 'lib', 'arm64-v8a');
  const bad = [];
  for (const so of fs.readdirSync(dir)) {
    const out = execFileSync(readelf, ['-lW', path.join(dir, so)], { encoding: 'utf8' });
    const aligns = out.split('\n').filter((l) => /^\s*LOAD\b/.test(l)).map((l) => parseInt(l.trim().split(/\s+/).pop(), 16));
    if (aligns.some((a) => a < 0x4000)) bad.push(so);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad.length) throw new Error('Bibliotecas fora dos 16 KB (a Google Play recusa): ' + bad.join(', '));
  console.log('Bibliotecas de 64 bits em 16 KB: ok.');
}

// No Linux/macOS usa o zip; no Windows, o tar do sistema (bsdtar), que grava caminhos com "/" como o Android espera.
function zipDir(dir, zip, entries) {
  if (process.platform === 'win32') {
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    run(tar, ['-a', '-c', '-f', zip, ...entries], { cwd: dir });
  } else {
    run('zip', ['-q', '-r', zip, ...entries], { cwd: dir });
  }
}

// O pacote é um zip igual ao de atualização: main.js, version.txt e src/.
// Vai dentro do APK/AAB (assets/bundle.zip); no Developer também é publicado para atualizar sem trocar o APK.
// beta: o app de teste (canal Developer fora de uma tag v*): logo âmbar na abertura e a página no modo Beta.
// O canal Play é sempre produção.
function buildBundle(version, dir, beta) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvkz-bundle-'));
  fs.copyFileSync(path.join(android, 'node', 'main.js'), path.join(stage, 'main.js'));
  fs.writeFileSync(path.join(stage, 'version.txt'), String(version));
  fs.cpSync(path.join(root, 'src'), path.join(stage, 'src'), {
    recursive: true,
    filter: (f) => !f.endsWith('.map'),
  });
  require('./build-info').writeBuildInfo(path.join(stage, 'src', 'web'), { build: version, channel: beta ? 'desenvolvimento' : 'producao' });
  const zip = path.join(dir, 'IPTVKZ-android-bundle.zip');
  fs.rmSync(zip, { force: true });
  zipDir(stage, zip, ['main.js', 'version.txt', 'src']);
  fs.rmSync(stage, { recursive: true, force: true });
  const assets = path.join(android, 'app', 'src', 'main', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(zip, path.join(assets, 'bundle.zip'));
  fs.copyFileSync(path.join(root, 'src', 'web', 'img', beta ? 'logo-horizontal-beta.webp' : 'logo-horizontal.webp'), path.join(assets, 'logo-horizontal.webp'));
  return zip;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function gradle(task, env) {
  const opts = { cwd: android, env: { ...process.env, ...env } };
  // No Windows o .bat precisa do cmd; sem shell: true, que junta os argumentos sem escapar.
  if (process.platform === 'win32') run('cmd.exe', ['/d', '/c', path.join(android, 'gradlew.bat'), '--no-daemon', task], opts);
  else run('./gradlew', ['--no-daemon', task], opts);
}

function developer(v) {
  // Sem a chave oficial (build no PC), sai o app "IPTVKZ Beta", ao lado do oficial. A versão do pacote fica acima
  // de 1 bilhão, para ele não trocar o código local pelo da versão publicada, e cresce a cada build (minutos desde
  // 2026): com o mesmo número, o app reinstalado manteria o código da instalação anterior.
  const local = !process.env.ANDROID_KEYSTORE;
  const localVersion = 1000000000 + Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60000);
  const bundleVersion = Number(process.env.BUNDLE_VERSION || (local ? localVersion : v.bundleVersion));
  const beta = local || !(process.env.GITHUB_REF || '').startsWith('refs/tags/v');
  // Limpa só os arquivos deste canal: dist/android/play/ é do canal Play.
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) {
    if (f !== 'play') fs.rmSync(path.join(out, f), { recursive: true, force: true });
  }

  ensureLibnode();
  const bundle = buildBundle(bundleVersion, out, beta);
  gradle('assembleDeveloperRelease', { BUNDLE_VERSION: String(bundleVersion) });
  const apk = path.join(out, 'IPTVKZ-android.apk');
  fs.copyFileSync(path.join(android, 'app', 'build', 'outputs', 'apk', 'developer', 'release', 'app-developer-release.apk'), apk);
  check16k(apk, '');

  const keyFile = process.env.ANDROID_UPDATE_KEY;
  if (!keyFile) {
    console.log('ANDROID_UPDATE_KEY não definida: manifesto de atualização não gerado.');
    return;
  }
  const manifest = Buffer.from(JSON.stringify({
    nativeVersion: Number(v.nativeVersion),
    nativeName: v.nativeName,
    bundleVersion,
    apk: path.basename(apk),
    apkSha256: sha256(apk),
    bundle: path.basename(bundle),
    bundleSha256: sha256(bundle),
  }));
  const signature = crypto.sign('sha256', manifest, fs.readFileSync(keyFile));
  fs.writeFileSync(path.join(out, 'android-update.json'), manifest);
  fs.writeFileSync(path.join(out, 'android-update.json.sig'), signature.toString('base64'));
}

// Confere o AAB com o bundletool: estrutura válida, manifesto sem nada que a Play recusaria e canal certo
// (Beta com nome e versão de Beta; produção sem nenhum sinal de Beta).
function checkBundle(aab, beta) {
  const jar = process.env.BUNDLETOOL;
  if (!jar) {
    if (process.env.CI) throw new Error('BUNDLETOOL não definida: o CI sempre confere o AAB.');
    console.log('BUNDLETOOL não definida: AAB não validado.');
    return;
  }
  run('java', ['-jar', jar, 'validate', `--bundle=${aab}`]);
  const manifest = execFileSync('java', ['-jar', jar, 'dump', 'manifest', `--bundle=${aab}`], { encoding: 'utf8' });
  const problems = [];
  if (manifest.includes('REQUEST_INSTALL_PACKAGES')) problems.push('pede REQUEST_INSTALL_PACKAGES');
  if (manifest.includes('FileProvider')) problems.push('traz o FileProvider do instalador de APK');
  if (/android:debuggable="true"/.test(manifest)) problems.push('está como debuggable');
  // celular e TV: aparece nos dois launchers
  if (!manifest.includes('LEANBACK_LAUNCHER')) problems.push('não aparece no launcher da TV');
  if (!manifest.includes('android.intent.category.LAUNCHER')) problems.push('não aparece no launcher do celular');
  const versionName = (/android:versionName="([^"]*)"/.exec(manifest) || [])[1] || '';
  const label = (/<application[^>]*android:label="([^"]*)"/.exec(manifest) || [])[1] || '';
  if (beta && !/-beta\.\d+$/.test(versionName)) problems.push(`Beta sem "-beta" na versão (${versionName})`);
  if (beta && label !== 'IPTVKZ Beta') problems.push(`Beta com o nome "${label}"`);
  if (!beta && /beta/i.test(versionName)) problems.push(`produção com versão de Beta (${versionName})`);
  if (!beta && label !== 'IPTVKZ') problems.push(`produção com o nome "${label}"`);
  if (problems.length) throw new Error('AAB da Play reprovado: ' + problems.join('; '));
  console.log(`AAB da Play conferido: ${label} ${versionName}, sem instalação de APK, para celular e TV.`);
}

// Produção assinada só a partir da tag da versão (ex.: v1.2.0 com nativeName=1.2.0). Beta sai de qualquer lugar.
function checkProductionRef(v, signed) {
  if (!signed) return;
  const ref = process.env.GITHUB_REF || '';
  if (ref !== `refs/tags/v${v.nativeName}`) {
    throw new Error(`AAB de produção assinado só a partir da tag v${v.nativeName} (agora: ${ref || 'sem tag'}). ` +
      'Para testar, gere o Beta (PLAY_BETA=1).');
  }
}

function play(v) {
  const versionCode = Number(process.env.PLAY_VERSION_CODE || v.playVersionCode);
  if (!(versionCode > 0)) throw new Error('playVersionCode inválido em version.properties');
  const signed = !!process.env.PLAY_UPLOAD_KEYSTORE;
  const beta = process.env.PLAY_BETA === '1';
  if (!beta) checkProductionRef(v, signed);
  fs.rmSync(playOut, { recursive: true, force: true });
  fs.mkdirSync(playOut, { recursive: true });

  ensureLibnode();
  // O pacote embutido usa o versionCode como versão: cada envio à Play reinstala o src/ novo.
  // No Beta, a página abre no modo Beta (tema âmbar), igual ao Beta das outras plataformas.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvkz-play-'));
  buildBundle(versionCode, stage, beta);
  fs.rmSync(stage, { recursive: true, force: true });
  gradle('bundlePlayRelease', { PLAY_VERSION_CODE: String(versionCode), PLAY_BETA: beta ? '1' : '' });

  const name = `IPTVKZ-play-${beta ? 'beta-' : ''}${v.nativeName}-${versionCode}${signed ? '' : '-UNSIGNED'}.aab`;
  const aab = path.join(playOut, name);
  fs.copyFileSync(path.join(android, 'app', 'build', 'outputs', 'bundle', 'playRelease', 'app-play-release.aab'), aab);
  check16k(aab, 'base/');
  fs.writeFileSync(aab + '.sha256', `${sha256(aab)}  ${name}\n`);
  console.log(`${name}: ${(fs.statSync(aab).size / 1048576).toFixed(1)} MB${signed ? '' : ' (sem assinatura: não envie à Play)'}`);
  checkBundle(aab, beta);
}

const v = props();
if (PLAY) play(v); else developer(v);
