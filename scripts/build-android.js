// Gera o app da Android TV nos dois canais.
// Uso: npm run android           canal Developer: APK + arquivos de atualização em dist/android/
//      npm run android:play      canal Google Play: AAB em dist/android/play/
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
const PLAY = process.argv.includes('--play');

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
  if (fs.existsSync(path.join(target, 'include', 'node', 'node.h'))) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'libnode-'));
  const zip = `nodejs-mobile-${NODE_VERSION}-android.zip`;
  run('gh', ['release', 'download', NODE_VERSION, '--repo', 'nodejs-mobile/nodejs-mobile', '-p', zip, '-D', tmp]);
  fs.mkdirSync(target, { recursive: true });
  run('unzip', ['-q', '-o', path.join(tmp, zip), 'bin/armeabi-v7a/*', 'bin/arm64-v8a/*', 'include/*', '-d', target]);
  fs.rmSync(tmp, { recursive: true, force: true });
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
function buildBundle(version, dir) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvkz-bundle-'));
  fs.copyFileSync(path.join(android, 'node', 'main.js'), path.join(stage, 'main.js'));
  fs.writeFileSync(path.join(stage, 'version.txt'), String(version));
  fs.cpSync(path.join(root, 'src'), path.join(stage, 'src'), {
    recursive: true,
    filter: (f) => !f.endsWith('.map'),
  });
  const zip = path.join(dir, 'IPTVKZ-android-bundle.zip');
  fs.rmSync(zip, { force: true });
  zipDir(stage, zip, ['main.js', 'version.txt', 'src']);
  fs.rmSync(stage, { recursive: true, force: true });
  const assets = path.join(android, 'app', 'src', 'main', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(zip, path.join(assets, 'bundle.zip'));
  fs.copyFileSync(path.join(root, 'src', 'web', 'img', 'logo-horizontal.webp'), path.join(assets, 'logo-horizontal.webp'));
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
  const bundleVersion = Number(process.env.BUNDLE_VERSION || v.bundleVersion);
  // Limpa só os arquivos deste canal: dist/android/play/ é do canal Play.
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) {
    if (f !== 'play') fs.rmSync(path.join(out, f), { recursive: true, force: true });
  }

  ensureLibnode();
  const bundle = buildBundle(bundleVersion, out);
  gradle('assembleDeveloperRelease', { BUNDLE_VERSION: String(bundleVersion) });
  const apk = path.join(out, 'IPTVKZ-android.apk');
  fs.copyFileSync(path.join(android, 'app', 'build', 'outputs', 'apk', 'developer', 'release', 'app-developer-release.apk'), apk);

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

// Confere o AAB com o bundletool: estrutura válida e manifesto sem nada que a Play recusaria.
function checkBundle(aab) {
  const jar = process.env.BUNDLETOOL;
  if (!jar) {
    console.log('BUNDLETOOL não definida: AAB não validado.');
    return;
  }
  run('java', ['-jar', jar, 'validate', `--bundle=${aab}`]);
  const manifest = execFileSync('java', ['-jar', jar, 'dump', 'manifest', `--bundle=${aab}`], { encoding: 'utf8' });
  const problems = [];
  if (manifest.includes('REQUEST_INSTALL_PACKAGES')) problems.push('pede REQUEST_INSTALL_PACKAGES');
  if (manifest.includes('FileProvider')) problems.push('traz o FileProvider do instalador de APK');
  if (/android:debuggable="true"/.test(manifest)) problems.push('está como debuggable');
  if (!/android\.software\.leanback"[^>]*android:required="true"|android:required="true"[^>]*android\.software\.leanback"/.test(manifest)) {
    problems.push('não exige Android TV (leanback)');
  }
  if (!manifest.includes('LEANBACK_LAUNCHER')) problems.push('não aparece no launcher da TV');
  if (problems.length) throw new Error('AAB da Play reprovado: ' + problems.join('; '));
  console.log('AAB da Play conferido: manifesto sem instalação de APK, só para TV.');
}

function play(v) {
  const versionCode = Number(process.env.PLAY_VERSION_CODE || v.playVersionCode);
  if (!(versionCode > 0)) throw new Error('playVersionCode inválido em version.properties');
  const signed = !!process.env.PLAY_UPLOAD_KEYSTORE;
  fs.rmSync(playOut, { recursive: true, force: true });
  fs.mkdirSync(playOut, { recursive: true });

  ensureLibnode();
  // O pacote embutido usa o versionCode como versão: cada envio à Play reinstala o src/ novo.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvkz-play-'));
  buildBundle(versionCode, stage);
  fs.rmSync(stage, { recursive: true, force: true });
  gradle('bundlePlayRelease', { PLAY_VERSION_CODE: String(versionCode) });

  const name = `IPTVKZ-play-${v.nativeName}-${versionCode}${signed ? '' : '-UNSIGNED'}.aab`;
  const aab = path.join(playOut, name);
  fs.copyFileSync(path.join(android, 'app', 'build', 'outputs', 'bundle', 'playRelease', 'app-play-release.aab'), aab);
  fs.writeFileSync(aab + '.sha256', `${sha256(aab)}  ${name}\n`);
  console.log(`${name}: ${(fs.statSync(aab).size / 1048576).toFixed(1)} MB${signed ? '' : ' (sem assinatura: não envie à Play)'}`);
  checkBundle(aab);
}

const v = props();
if (PLAY) play(v); else developer(v);
