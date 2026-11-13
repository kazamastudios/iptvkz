// Medições do carregamento das listas: aparecem no modo de depuração (timing do catálogo) e em /api/diag,
// para comparar aparelhos e versões. Leves: só leem relógio e memória em poucos pontos.

const last = { coldRead: null };

// Maior tempo que o servidor ficou sem responder (travado numa conta longa) enquanto a medição durava.
function loopWatch() {
  let max = 0;
  let prev = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    max = Math.max(max, now - prev - 50);
    prev = now;
  }, 50);
  return {
    stop() {
      clearInterval(timer);
      max = Math.max(max, Date.now() - prev - 50); // o trecho final, se a conta terminou travada
      return Math.max(0, Math.round(max));
    },
  };
}

// Memória do processo em MB; peak guarda a maior vista entre as chamadas.
function memPeak() {
  let peak = 0;
  const read = () => {
    const mb = Math.round(process.memoryUsage().rss / 1048576);
    if (mb > peak) peak = mb;
    return mb;
  };
  read();
  return { read, peak: () => peak };
}

module.exports = { last, loopWatch, memPeak };
