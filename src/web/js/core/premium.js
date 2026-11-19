// IPTVKZ+: um lugar só decide o que a compra libera. Temas e os próximos recursos pagos perguntam aqui.
// Fase 1 (temas): ainda não há pagamento. O Beta libera tudo para teste, com "Simular sem IPTVKZ+" em
// Configurações → Depuração; a versão publicada mostra os itens pagos com cadeado ("em breve").
// Fase 2: a compra pela Google Play (ponte do canal play) entra aqui, sem guardar nada do nosso lado.
import { isBeta } from './debug.js';

const SIMULATE = 'iptvkz.plusOff';

export function simulatingNoPlus() {
  try { return isBeta() && localStorage.getItem(SIMULATE) === '1'; } catch { return false; }
}

export function setSimulateNoPlus(on) {
  try { on ? localStorage.setItem(SIMULATE, '1') : localStorage.removeItem(SIMULATE); } catch {}
  window.dispatchEvent(new Event('iptvkz:plus'));
}

export function hasPlus() {
  if (simulatingNoPlus()) return false;
  return isBeta();
}
