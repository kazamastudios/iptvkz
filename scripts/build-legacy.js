// Gera src/web/js/app.legacy.js: o app inteiro num arquivo só, com sintaxe que navegadores
// antigos entendem. Piso: Chromium 51 (WebView do Android 7.0, TV box) e webOS 4 (Chromium 53). Rode depois de mexer em src/web/js:
//   npm run build
// scripts/test-old-browser.js confere o resultado num navegador sem o que o Chromium 51 não tem.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const js = path.join(root, 'src', 'web', 'js');
const TARGET = 'chrome51';

// Os substitutos (polyfills) vão no topo do arquivo, antes de tudo: o esbuild guarda Object.getOwnPropertyDescriptors
// e outros numa variável logo na primeira linha do pacote. Importados como módulo, eles rodavam depois disso e, no
// Chromium 51 a 53, o primeiro { ...a, b } quebrava o app na abertura.
const polyfills = esbuild.transformSync(fs.readFileSync(path.join(js, 'core', 'polyfills.js'), 'utf8'), {
  target: TARGET,
  minify: true,
  legalComments: 'none',
}).code;

esbuild
  .build({
    entryPoints: [path.join(js, 'app.js')],
    banner: { js: polyfills },
    bundle: true,
    format: 'iife',
    target: [TARGET],
    minify: true,
    legalComments: 'none',
    outfile: path.join(js, 'app.legacy.js'),
    logLevel: 'info',
  })
  .catch(() => process.exit(1));
