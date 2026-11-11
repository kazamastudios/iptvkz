# Auditoria do app da LG para a LG Content Store

Auditoria do IPTVKZ para publicação gratuita na LG Content Store, com a marca **Kazama Studios**. Feita em novembro de 2026.

Este documento não é uma certificação. Quem aprova é o QA da LG, depois do envio pelo Seller Lounge. Aqui ficam o que foi conferido no código, o que mudou e o que ainda precisa ser testado na TV.

**Prioridades:**

- **P0:** impede a aprovação ou quebra o app numa TV comum.
- **P1:** provável motivo de reprovação ou falha visível.
- **P2:** melhoria ou risco baixo.

**Estado:**

- **Corrigido:** mudou no código e foi testado no PC.
- **Na TV:** mudou no código, mas só dá para confirmar numa TV de verdade.
- **Aberto:** ainda precisa de decisão ou de trabalho.

## Fontes oficiais consultadas

| Assunto | Endereço |
|---|---|
| ACG (permissões das APIs Luna) | https://webostv.developer.lge.com/develop/guides/acg-guide |
| appinfo.json | https://webostv.developer.lge.com/develop/references/appinfo-json |
| Serviço JS: básico e versões do Node | https://webostv.developer.lge.com/develop/guides/js-service-basics |
| Serviço JS: uso, nomes, pasta de dados | https://webostv.developer.lge.com/develop/guides/js-service-usage |
| Serviço JS: perguntas frequentes (tempo ocioso, keepAlive) | https://webostv.developer.lge.com/develop/guides/js-service-faq |
| webos-service | https://webostv.developer.lge.com/develop/references/webos-service-reference |
| Activity Manager | https://webostv.developer.lge.com/develop/references/activity-manager |
| Tecla Voltar | https://webostv.developer.lge.com/develop/guides/back-button |
| App Self Checklist | https://webostv.developer.lge.com/distribute/app-self-checklist |
| Processo de aprovação | https://webostv.developer.lge.com/distribute/app-approval-process |
| Privacidade | https://webostv.developer.lge.com/develop/guides/privacy-guideline |
| Imagens do app | https://webostv.developer.lge.com/develop/getting-started/app-resources |
| Motor web por versão | https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine |

Pontos que a documentação pública **não** responde. Tratados como risco, sem presumir proibição nem liberação:

- **Baixar e executar código fora da loja:** não há regra explícita. A documentação diz que toda atualização passa de novo pelo QA e que o pacote é assinado e conferido na instalação.
- **Servidor HTTP aberto por um serviço JS, e app que abre `http://127.0.0.1`:** não há página oficial sobre isso. Um usuário do fórum da LG escreveu que "webOS TV cannot be used as a server" (https://forum.webostv.developer.lge.com/t/open-http-server/9585). Não confirmamos se quem escreveu é da LG.
- **Apps de IPTV que não trazem conteúdo:** as regras do Seller Lounge para esse tipo de app não são públicas.

## Como o app funciona na TV

1. A abertura (`platforms/webos/index.html`) assina `luna://<id>.service/boot`.
2. O serviço (`platforms/webos/service/main.js`, Node, `webos-service`) sobe o servidor de `src/server` na porta 8787.
3. A abertura então troca para `http://127.0.0.1:8787/?tv=1`, a mesma interface de `src/web` usada no PC e no Android.

O servidor faz o proxy dos vídeos, monta o catálogo das listas e guarda os dados.

## Problemas encontrados

### P0

| # | Problema | Estado | O que mudou |
|---|---|---|---|
| 1 | O serviço chama `activityManager.create` com `requiredACG: []`. Pelo guia de ACG, todo o `com.palm.activitymanager` exige `activity.operation`. A partir do webOS TV 26 Re:New a chamada pode ser negada, e no 27+ `requiredACG` é obrigatório: sem ele o Seller Lounge recusa o pacote. | Corrigido (Na TV: confirmar que a LG concede o grupo) | `appinfo.json` agora declara `"requiredACG": ["activity.operation"]`, nos dois canais. O build confere isso (`scripts/check-webos.js`). A chamada ficou em `try`: se for negada, o serviço continua. |
| 2 | O app baixava pacotes de código (servidor e interface) do GitHub Releases e os executava. Para um app da loja, isso pula o QA que a LG exige a cada atualização. | Corrigido | Novo canal **Store**. O atualizador saiu para `service/updater.js`, e o build da Store nem inclui esse arquivo: o esbuild descarta o `require`. A conferência do build falha se o `main.js` da Store tiver `webos-update.json`, `createVerify`, `gunzipSync`, `releases/latest` ou `/media/developer`. |
| 3 | A atividade de keep-alive nunca era concluída, então o Node ficava ligado depois de o app fechar, até a TV desligar. A LG pede que serviços não rodem por muito tempo. | Corrigido (Na TV) | O servidor aceita `idleMs`. Na TV, sem aviso da interface por 15 minutos e sem vídeo tocando, o serviço conclui a atividade e encerra. Ao abrir o app de novo, o `boot` sobe tudo outra vez. |
| 4 | A arquitetura depende de um servidor HTTP dentro da TV, e a documentação pública não fala disso. | **Aberto** (risco) | Não dá para resolver sem refazer a arquitetura. Se o QA recusar a porta aberta para a rede de casa, há um build com `WEBOS_LAN_PAIRING=0`: servidor só em 127.0.0.1, sem cadastro pelo celular. Se recusar até o servidor local, a saída é mover proxy e catálogo para métodos Luna, um trabalho grande. |
| 5 | A pasta de dados podia cair em `/media/developer/temp`, que só existe com o Modo Desenvolvedor ligado. A LG avisa que caminhos fixos em `/media/developer` falham em apps publicados. | Corrigido (Na TV: conferir qual pasta foi usada no `boot.log`) | A Store tenta, nesta ordem: `/media/internal/<id do app>` (a pasta indicada para dados de serviços), `$HOME/iptvkz` e a pasta do serviço. Por último, `/tmp`, que funciona mas perde os dados ao desligar a TV, com aviso no registro. O Developer mantém a ordem antiga, para ninguém perder listas. |
| 6 | Qualquer página aberta na TV ou no PC podia ler `/api/state`, com usuários e senhas Xtream, por DNS rebinding. Também podia gravar listas por CSRF. | Corrigido | O servidor confere `Host` (só IP, nomes locais e `localhost`) e `Origin` (só a mesma origem). Vem da branch da Google Play, com o mesmo código. |

### P1

| # | Problema | Estado | O que mudou |
|---|---|---|---|
| 7 | Na abertura, Voltar não fazia nada: com `disableBackHistoryAPI: true`, o app trata o Voltar sozinho. | Corrigido | Voltar (461) chama `webOSSystem.platformBack()`: aviso de saída no webOS 6+, tela inicial no 5. Se não houver, chama `window.close()`. |
| 8 | A abertura dizia "Verificando se há atualizações" mesmo onde não há atualização. | Corrigido | A abertura começa com "Carregando". A frase sobre atualizações só aparece no Developer, durante a conferência. |
| 9 | Com o ponteiro do Magic Remote não dava para tentar de novo depois de uma falha na abertura. | Corrigido | A mensagem de erro aceita clique e explica: "Aperte OK para tentar de novo ou Voltar para sair". |
| 10 | O proxy respondia `Access-Control-Allow-Origin: *`, então qualquer site podia usar a TV para ler endereços da rede de casa (SSRF). | Corrigido | O proxy não manda mais CORS. Só a própria interface lê o que ele traz. |
| 11 | Um endereço malformado (`/%E0%A4%A`) derrubava o servidor, e `src/web-outra` passava pela checagem de pasta. | Corrigido | `decodeURIComponent` protegido, `\0` recusado e comparação com o separador no fim da pasta. |
| 12 | A chave do QR Code de "Baixar lista no celular" entregava qualquer lista, com senha, e não só a escolhida. | Corrigido | `/api/pair/start` recebe `list`, e `/pair/<chave>/arquivo` só entrega essa. Coberto por teste. |
| 13 | Se o servidor caísse, ou se a TV o encerrasse com o app em segundo plano, a tela ficava sem resposta até a pessoa fechar o app. | Corrigido (Na TV) | Novo `src/web/js/core/lifeline.js`. Avisa o servidor a cada minuto, como antes, e na volta ao primeiro plano. Na LG, depois de duas falhas, chama o `boot` do serviço e recarrega a tela. No PC e no Android, nada muda. |
| 14 | O serviço é compilado para Node 8. O webOS TV 4.x e anteriores têm Node 0.12, onde o serviço não sobe. | **Aberto** (configuração) | No Seller Lounge, marque só **webOS TV 5.0 ou mais novo**: Node 8.12 no 5.0 e no 6.0, Node 12 no 22 e no 23, Node 16 no 24 e no 25, Node 20 no 26. A interface roda em Chromium 53 ou mais novo, então o limite é o serviço. |
| 15 | Os botões só de ícone (`.icon-btn`, 36 px × zoom de cerca de 1,35) ficam abaixo dos 75×75 px que o checklist pede para o ponteiro. | **Aberto** | Precisa de ajuste visual na TV. Não foi mudado às cegas, para não alterar o visual. Equivalentes: no PC, o hover; na TV, o foco do controle, que já é grande; no celular, a área de toque. |
| 16 | A LG pede política de privacidade dentro do app e um endereço público no cadastro. | Parcial | A política está nos Termos (seção 6), aceitos na primeira abertura, e foi revisada (versão 3, que pede novo aceite). Falta publicar uma página pública, por exemplo no GitHub Pages, e informar o endereço no Seller Lounge. |
| 17 | O id do app da Store ainda não foi decidido. | **Aberto** (decisão) | O build usa `com.kazamastudios.iptvkz`, como na proposta da Google Play, e dá para trocar com `WEBOS_STORE_ID`. Depois do primeiro envio, o id não muda mais. O Developer continua `com.lucasyemz.iptvkz`, então os dois podem ficar instalados na mesma TV. |

### P2

| # | Assunto | Situação |
|---|---|---|
| 18 | Servidor em 0.0.0.0 | Fora da própria TV, só responde a `/pair/<chave>`. A chave tem 128 bits, é de uso único e vale 15 minutos. O resto pede o "acesso pela rede", que vem desligado. Não há limite de tentativas, mas adivinhar a chave é inviável. |
| 19 | Senhas Xtream | Ficam em texto em `lists.json`, na pasta de dados do app, isolada pela TV. Não vão para registros. Mensagens de erro mostram só o servidor (`safeHost`), e há teste para isso. O arquivo de "Baixar lista" contém a senha, e a página avisa. |
| 20 | Registro (`boot.log`) | Até 32 KB. Guarda só fases, versão do Node, pasta de dados e erros. Nunca listas, usuários ou senhas. |
| 21 | Integridade das atualizações (Developer) | Manifesto assinado (RSA-SHA256), SHA-256 do pacote e versão sempre crescente. Uma versão que falha fica marcada e volta a do IPK. Caminhos são conferidos ao instalar. Agora só por HTTPS (HTTP apenas em 127.0.0.1, para testes) e com o nome do pacote validado. |
| 22 | Memória e CPU | Um processo Node durante o uso e nenhum depois de 15 minutos com o app fechado. O proxy repassa o vídeo sem guardar nada em memória. Falta medir horas de reprodução na TV (ver o roteiro). |
| 23 | Classificação etária | O app não traz conteúdo e tem controle dos pais (PIN). O conteúdo depende das listas de quem usa. Responda o questionário do Seller Lounge com isso; a recomendação está em `WEBOS_STORE_RELEASE.md`. |
| 24 | `splashBackground` | Não está definido. A tela de abertura do app (fundo vermelho escuro, não preto) aparece logo. Se o QA pedir, adicionar um PNG de 1920×1080. |

## Luna API e ACG

| Chamada | Onde | Grupo ACG | Decisão |
|---|---|---|---|
| `com.palm.activitymanager/create` (via `service.activityManager.create`) | `service/main.js` | `activity.operation` | Mantida. É o keep-alive documentado pela LG para o serviço não ser encerrado no meio do vídeo. Agora é concluída ao fechar. |
| `com.palm.activitymanager/complete` | `service/main.js` (ao encerrar) | `activity.operation` | Mesmo grupo. |
| Atividades automáticas do `webos-service` a cada pedido | biblioteca | `activity.operation` | Mesmo grupo. |
| `luna://<id>.service/boot` | `index.html`, `lifeline.js` | nenhum (serviço do próprio app) | — |
| `webOSSystem.platformBack()`, `window.close()`, `isKeyboardVisible` | interface | nenhum (API do navegador da TV) | — |

O app não chama nenhuma outra API Luna, então nenhum outro grupo foi adicionado.

Pelo guia, até o webOS TV 25 o ACG não é aplicado. No 26 Re:New, passa a ser aplicado. No 27 e mais novos, é obrigatório.

## Ciclo de vida

| Situação | Comportamento |
|---|---|
| Primeira abertura | A abertura chama `boot`, o serviço escolhe a pasta de dados e sobe o servidor. A interface pede o aceite dos Termos. |
| Sem internet | Store: sobe direto. Developer: a conferência de atualização desiste em 8 s e segue com a versão instalada. A interface mostra que está sem internet. |
| Fechar o app (Voltar → Sair, ou o botão Sair) | `window.close()`. Os avisos param, e em até 15 minutos o serviço encerra sozinho. As listas já estão gravadas no disco, com gravação atômica. |
| Segundo plano / volta | Ao voltar, a interface confere o servidor. Se ele tiver sido encerrado, religa pelo `boot` e recarrega. |
| TV desligada ou reiniciada | Nada fica rodando. Na próxima abertura, sobe do zero. Os dados ficam, a menos que a pasta seja `/tmp` (aparece no `boot.log`). |
| Servidor com falha | Erro não tratado: o serviço registra e sai. A interface percebe e religa. Developer: se a versão baixada não subir, ela é marcada e volta a do IPK. |
| Atualização com falha (Developer) | Assinatura ou SHA-256 errados, ou download interrompido: fica a versão atual. Testado no PC com uma chave de teste. |

## Testes feitos (no PC)

- `npm test`: 17 testes do servidor, com listas, guia e vídeos fictícios, todos passando. Cobrem Host/DNS rebinding, Origin/CSRF, caminhos estranhos, proxy sem CORS, HLS reescrito, Range, troca rápida de canais, M3U por link e arquivo, Xtream, EPG, favoritos, progresso, PIN, backup, pareamento e a chave presa à lista.
- `npm run ipk` (local, sem número de build): conferência ok, IPK gerado, sem atualizador no `main.js`.
- `BUNDLE_VERSION=77 npm run ipk`: conferência ok, com o atualizador.
- `npm run ipk:store`: conferência ok, `com.kazamastudios.iptvkz` 1.0.5, sem nenhum traço do atualizador, IPK em `dist/webos/store/`.
- Serviço rodando no PC com um `webos-service` falso e o shim de Node antigo forçado:
  - Store sobe, chega a `ready` e responde a `/api/ping`.
  - Developer sem internet chega a `ready`.
  - Developer com pacote assinado por uma chave de teste vai da versão 79 para a 80.
  - Manifesto adulterado: "Assinatura inválida", e a versão 79 continua.
- Não testado: nada disso rodou numa TV LG. Os builds de Android e de computador não foram compilados aqui; eles rodam no CI.
