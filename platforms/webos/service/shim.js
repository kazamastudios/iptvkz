// O Node da LG é antigo (8 a 16, conforme o webOS). Aqui entra só o que o servidor usa e ele não tem.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const stream = require('stream');
const nodeUrl = require('url');
const util = require('util');
const zlib = require('zlib');

const g = global;
const force = process.env.IPTVKZ_FORCE_SHIM === '1'; // só para testes em Node novo

if (!g.URL) { g.URL = nodeUrl.URL; g.URLSearchParams = nodeUrl.URLSearchParams; }
if (!g.TextDecoder) g.TextDecoder = util.TextDecoder;

if (!Object.fromEntries) Object.fromEntries = (it) => { const o = {}; for (const [k, v] of it) o[k] = v; return o; };
if (!Array.prototype.flatMap) {
  Object.defineProperty(Array.prototype, 'flatMap', { value(fn, t) { return [].concat(...this.map(fn, t)); }, writable: true, configurable: true });
  Object.defineProperty(Array.prototype, 'flat', { value() { return [].concat(...this); }, writable: true, configurable: true });
}
if (!String.prototype.trimStart) {
  String.prototype.trimStart = function () { return this.replace(/^\s+/, ''); };
  String.prototype.trimEnd = function () { return this.replace(/\s+$/, ''); };
}
if (!Promise.prototype.finally) {
  Promise.prototype.finally = function (fn) {
    return this.then((v) => Promise.resolve(fn()).then(() => v), (e) => Promise.resolve(fn()).then(() => { throw e; }));
  };
}

// mkdirSync recursivo só existe a partir do Node 10.12.
if (process.versions.node.split('.')[0] < 11) {
  const mkdir = fs.mkdirSync;
  fs.mkdirSync = function (dir, opts) {
    if (!opts || !opts.recursive) return mkdir.call(fs, dir, opts);
    if (fs.existsSync(dir)) return undefined;
    fs.mkdirSync(path.dirname(dir), opts);
    return mkdir.call(fs, dir);
  };
}

if (!g.AbortController || force) {
  class Signal {
    constructor() { this.aborted = false; this.fns = []; }
    addEventListener(_, fn) { this.fns.push(fn); }
    removeEventListener(_, fn) { this.fns = this.fns.filter((f) => f !== fn); }
  }
  class Controller {
    constructor() { this.signal = new Signal(); }
    abort() {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      this.signal.fns.slice().forEach((fn) => fn());
    }
  }
  Signal.timeout = (ms) => { const c = new Controller(); setTimeout(() => c.abort(), ms); return c.signal; };
  g.AbortController = Controller;
  g.AbortSignal = Signal;
}

// Leitura sob demanda de um stream do Node, usada por getReader() e por "for await".
function readerOf(node, wrap) {
  const queue = [];
  let done = false;
  let failure = null;
  let waiting = null;
  const flush = () => {
    if (!waiting) return;
    const w = waiting;
    if (queue.length) { waiting = null; w.resolve({ done: false, value: wrap(queue.shift()) }); }
    else if (failure) { waiting = null; w.reject(failure); }
    else if (done) { waiting = null; w.resolve({ done: true, value: undefined }); }
  };
  node.on('data', (d) => { queue.push(d); node.pause(); flush(); });
  node.on('end', () => { done = true; flush(); });
  node.on('error', (e) => { failure = e; flush(); });
  node.pause();
  return () => new Promise((resolve, reject) => { waiting = { resolve, reject }; node.resume(); flush(); });
}

// Node 8 não tem "for await" em streams.
if (!Symbol.asyncIterator) {
  Object.defineProperty(Symbol, 'asyncIterator', { value: Symbol('Symbol.asyncIterator') });
  stream.Readable.prototype[Symbol.asyncIterator] = function () {
    const next = readerOf(this, (d) => d);
    return { next, [Symbol.asyncIterator]() { return this; } };
  };
}

class Headers {
  constructor(raw) { this.raw = raw; }
  get(name) {
    const v = this.raw[String(name).toLowerCase()];
    return v == null ? null : Array.isArray(v) ? v.join(', ') : v;
  }
}

class Response {
  constructor(res, url, signal) {
    const enc = res.headers['content-encoding'];
    const node = enc === 'gzip' || enc === 'deflate' ? res.pipe(enc === 'gzip' ? zlib.createGunzip() : zlib.createInflate()) : res;
    this.status = res.statusCode;
    this.ok = res.statusCode >= 200 && res.statusCode < 300;
    this.url = url;
    this.headers = new Headers(res.headers);
    this.signal = signal;
    this.source = res;
    this.body = {
      node,
      cancel() { res.destroy(); return Promise.resolve(); },
      getReader() {
        return { read: readerOf(node, (d) => new Uint8Array(d)), cancel() { res.destroy(); return Promise.resolve(); }, releaseLock() {} };
      },
    };
  }

  text() {
    return new Promise((resolve, reject) => {
      const parts = [];
      this.body.node.on('data', (d) => parts.push(d));
      this.body.node.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
      this.body.node.on('error', reject);
      this.source.on('aborted', () => reject(new Error('aborted')));
    });
  }

  json() { return this.text().then(JSON.parse); }
}

function request(url, opts, hops) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const signal = opts.signal;
    if (signal && signal.aborted) return reject(new Error('aborted'));
    const req = (target.protocol === 'https:' ? https : http).request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: target.pathname + target.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc && opts.redirect !== 'manual') {
        res.resume();
        if (hops >= 10) return reject(new Error('Redirecionamentos demais'));
        return resolve(request(new URL(loc, target).href, opts, hops + 1));
      }
      resolve(new Response(res, url, signal));
    });
    if (signal) signal.addEventListener('abort', () => { req.abort(); reject(new Error('aborted')); });
    req.on('error', reject);
    req.end(opts.body);
  });
}

if (!g.fetch || force) {
  g.fetch = (url, opts) => request(String(url), opts || {}, 0);
  // A resposta já é um stream do Node: nada para converter.
  stream.Readable.fromWeb = (body) => body.node;
}
