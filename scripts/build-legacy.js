// Gera public/js/app.legacy.js: o app inteiro num arquivo só, com sintaxe que navegadores
// de TV antigos entendem (webOS 4+ / Chromium 53+). Rode depois de mexer em public/js:
//   npm run build
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

esbuild
  .build({
    stdin: {
      contents: "import './polyfills.js';\nimport './app.js';\n",
      resolveDir: path.join(root, 'public', 'js'),
      sourcefile: 'legacy-entry.js',
    },
    bundle: true,
    format: 'iife',
    target: ['chrome53'],
    minify: true,
    legalComments: 'none',
    outfile: path.join(root, 'public', 'js', 'app.legacy.js'),
    logLevel: 'info',
  })
  .catch(() => process.exit(1));
