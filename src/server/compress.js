// Resposta comprimida com gzip quando o aparelho aceita. memo guarda o resultado para não recomprimir.
const zlib = require('zlib');

function sendText(req, res, status, headers, body, memo) {
  const plain = () => {
    res.writeHead(status, { ...headers, Vary: 'Accept-Encoding' });
    res.end(body);
  };
  if (body.length < 1024 || !/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return plain();
  const send = (gz) => {
    res.writeHead(status, { ...headers, Vary: 'Accept-Encoding', 'Content-Encoding': 'gzip', 'Content-Length': gz.length });
    res.end(gz);
  };
  if (memo && memo.gz) return send(memo.gz);
  zlib.gzip(body, (err, gz) => {
    if (err) return plain();
    if (memo) memo.gz = gz;
    send(gz);
  });
}

module.exports = { sendText };
