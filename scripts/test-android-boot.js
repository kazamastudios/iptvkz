// Abre o APK num emulador Android já ligado e confere que o app inicia: o Node sobe, a página carrega e a interface
// sai da abertura (mostra os termos na primeira vez). Uma rodada por ABI; armeabi-v7a é o Node de 32 bits das
// TV box antigas, que só existe em aparelho de verdade e não aparece nos testes do PC.
//   node scripts/test-android-boot.js dist/android/IPTVKZ-android.apk armeabi-v7a [arm64-v8a ...]
// Precisa do adb no PATH (ou ANDROID_HOME). Lê a tela pelo uiautomator (serve para o app oficial e para o Beta).
// No CI roda num emulador Android 11 x86, que traduz apps ARM de 32 bits.
const { execFileSync } = require('child_process');
const path = require('path');

const [apk, ...abis] = process.argv.slice(2);
if (!apk || !abis.length) {
  console.error('uso: node scripts/test-android-boot.js <apk> <abi> [abi...]');
  process.exit(2);
}
const ADB = process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb';
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const installed = () => new Set(adb('shell', 'pm', 'list', 'packages', 'iptvkz').split(/\s+/).filter(Boolean).map((l) => l.replace('package:', '')));

// Textos que a tela mostra quando o app abriu, e quando não conseguiu (abertura da interface ou nativa)
const OK = /Li e aceito|Bem-vindo ao IPTVKZ|Adicionar minha lista/;
const BAD = /Não foi possível abrir|Não foi possível iniciar|Ainda abrindo/;

function screenText() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/iptvkz-ui.xml');
  const xml = adb('shell', 'cat', '/sdcard/iptvkz-ui.xml');
  return [...xml.matchAll(/(?:text|content-desc)="([^"]+)"/g)].map((m) => m[1]).join(' | ');
}

async function boot(abi) {
  const supported = adb('shell', 'getprop', 'ro.product.cpu.abilist').split(',');
  if (!supported.includes(abi)) throw new Error(`o emulador não roda ${abi} (tem ${supported.join(', ')})`);
  for (const p of installed()) adb('uninstall', p);
  adb('install', '--abi', abi, apk);
  const [pkg] = installed();
  if (!pkg) throw new Error('o APK não aparece instalado');
  const cpu = (adb('shell', 'dumpsys', 'package', pkg).match(/primaryCpuAbi=(\S+)/) || [])[1];
  if (cpu !== abi) throw new Error(`${pkg} instalou como ${cpu}, não ${abi}`);
  adb('logcat', '-c');
  adb('shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1');

  const end = Date.now() + 150000;
  let text = '';
  while (Date.now() < end) {
    await sleep(4000);
    const crash = adb('logcat', '-d', '-s', 'AndroidRuntime:E', 'IPTVKZ:E');
    if (/FATAL EXCEPTION|Falha ao iniciar|Node encerrou/.test(crash)) throw new Error('o app caiu:\n' + crash.slice(-1500));
    try { text = screenText(); } catch { continue; }
    if (OK.test(text)) {
      console.log(`ok   ${abi}: ${pkg} abriu (${text.match(OK)[0]})`);
      return;
    }
    // "Ainda abrindo" só conta como falha no fim do prazo; os erros, na hora
    if (BAD.test(text) && !/Ainda abrindo/.test(text)) break;
  }
  throw new Error(`não saiu da abertura: ${text.slice(0, 400) || '(tela vazia)'}`);
}

(async () => {
  let failed = 0;
  for (const abi of abis) {
    try {
      await boot(abi);
    } catch (e) {
      failed++;
      console.log(`FALHOU ${abi}: ${e.message}`);
    }
  }
  try { for (const p of installed()) adb('uninstall', p); } catch {}
  process.exit(failed ? 1 : 0);
})();
