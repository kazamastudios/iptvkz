// Ponto de entrada do pacote atualizável: compatibilidade primeiro, servidor depois.
require('./shim.js');
module.exports = require('../../../src/server/index.js');
