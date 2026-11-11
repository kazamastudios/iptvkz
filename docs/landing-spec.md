# Spec da landing page do IPTVKZ

Status: versão 2, para aprovação. Substitui o conteúdo de `public/`, mantendo a pasta, o domínio (`iptvkz.kazamastudios.com.br`) e o deploy sem build no Cloudflare Pages.

**Referência:** a estrutura de [IPTVnator](https://4gray.github.io/iptvnator/). Seguimos a ordem das seções, a simplicidade e o download detectado. Textos, imagens, cores e código são do IPTVKZ, sem copiar nada de lá.

## 1. Objetivo

Em poucos segundos, quem chega precisa saber o que é, ver que é grátis e baixar a versão certa. A promessa: **a lista entra na TV por um QR Code, e tudo é de graça.**

## 2. Estrutura

| # | Seção | O que tem |
|---|---|---|
| 1 | Barra do topo | Logo, Recursos, Telas, Baixar, ícone do GitHub e botão "Baixar" |
| 2 | Topo | Título, texto, download recomendado e print com o botão Clássica/Streaming |
| 3 | Números | Quatro fatos em uma faixa |
| 4 | Recursos | Grade de cartões de tamanhos diferentes, com o QR Code como cartão maior |
| 5 | Onde roda | Uma linha com os seis sistemas |
| 6 | Telas | Lista de telas à esquerda, print grande à direita |
| 7 | Baixar | Recomendado em destaque, demais aparelhos recolhidos |
| 8 | Código aberto | Chamada para dar estrela no GitHub e relatar problemas |
| 9 | Dúvidas e rodapé | Até cinco perguntas, aviso legal, termos e privacidade |

Não entram agora: blog, comparativo com outros apps e doações.

### 2.1 Topo

- **Linha acima do título, em texto simples:** "Player IPTV gratuito · v1.0.5", com a versão vinda do GitHub.
- **Título:** "Sua lista na TV em um **QR Code**.", com "QR Code" em vermelho.
- **Texto:** "Listas M3U e Xtream, TV ao vivo com guia, filmes e séries na LG, no Android TV, no celular e no computador. De graça, sem mensalidade e sem anúncio."
- **Botões:** principal detectado, como "Baixar para Windows", e "Todos os aparelhos".
- **Print:** tela real ao lado do texto, com o botão de visualização funcionando de verdade. Alterna a imagem entre Clássica e Streaming, como no app.
- **Legenda do print:** "Títulos fictícios. O IPTVKZ não vem com nenhum canal ou filme."

### 2.2 Números

Hoje o repositório tem **0 estrelas e 58 downloads**. Mostrar isso, como a referência faz com 7,6 mil e 1,9 milhão, jogaria contra. A faixa começa com fatos que já são fortes:

| Número | Legenda |
|---|---|
| R$ 0 | sem mensalidade |
| 1,4 MB | na TV LG |
| 6 | sistemas |
| MIT | código aberto |

O botão "Estrela no GitHub" aparece desde o início, sem número. **A contagem entra sozinha** pela API do GitHub: estrelas a partir de 50 e downloads a partir de 1.000, substituindo as legendas menos fortes. Sem a API, a faixa continua igual.

### 2.3 Recursos

Cartões com recortes de prints reais, em tamanhos variados:

| Cartão | Tamanho | Texto central |
|---|---|---|
| QR Code | Grande | "Escaneie, preencha no celular, pronto." Um link de lista são cerca de 445 cliques no controle. O celular fala direto com a TV pela sua rede, e o código vale 15 minutos e só uma vez. |
| Clássica ou Streaming | Grande | Grade de sempre ou destaque com fileiras, com um toque ao lado da busca. |
| TV ao vivo e guia | Médio | Zapeie em tela cheia e veja o que passa agora. |
| Continuar assistindo | Médio | Volte do minuto em que parou. |
| Dublado e legendado | Pequeno | As duas versões viram um cartão só. |
| Controle dos pais | Pequeno | PIN que esconde o conteúdo adulto. |
| Backup da lista | Pequeno | Leve lista, favoritos e histórico para outro aparelho. |
| Leve até em TV antiga | Pequeno | LG com webOS 4 ou mais novo, sem computador ligado. |

Fechando a seção, uma faixa: **"Tudo isso de graça. Sem plano premium, sem anúncio, sem recurso bloqueado."** Não citamos concorrentes nem preços deles.

### 2.4 Baixar

O visitante vê um cartão principal, com a etiqueta **"Recomendado para você"**, o nome do aparelho, o arquivo, o tamanho e o botão. Abaixo, "Outros aparelhos" abre a lista completa.

| Quem visita pelo | Recomendado |
|---|---|
| Windows | Instalador (portátil na lista completa) |
| macOS | Apple Silicon e Intel, lado a lado, porque o navegador não informa com segurança |
| Linux | AppImage (.deb na lista completa) |
| Celular Android | APK |
| TV LG | Explica a instalação pelo computador |
| Android TV | APK, com o endereço curto do site para digitar no Downloader |
| iPhone ou desconhecido | Lista completa aberta |

- O download nunca começa sozinho. Links e tamanhos vêm da API de releases do GitHub, com os do HTML como reserva.
- **LG:** deixar claro que hoje exige Developer Mode, conta LG Developer e renovação da sessão, até a loja aprovar.
- **Aviso contra golpe, curto, logo abaixo:** "O IPTVKZ é grátis. Se alguém te vendeu, é golpe."

## 3. Visual

- **Fundo e cores:** variáveis de `src/web/css/app.css`. O vermelho `--accent` entra no botão principal, na palavra de destaque e no foco.
- **Fonte:** uma só, arquivo latino reduzido em `public/fonts/`. Etiquetas e números pequenos em monoespaçada do sistema.
- **Formas:** cartões chapados com borda fina, como no app. Sem brilho, partículas ou inclinação 3D.
- **Imagens:** só prints reais de `Downloads\iptvkz-prints`, convertidos para WebP. Saem `images/mockups/` e as capturas antigas com capas em degradê.

## 4. Uma página, três aparelhos

| Elemento | PC (mouse) | TV (controle) | Celular (toque) |
|---|---|---|---|
| Botões e cartões | Hover | Moldura vermelha segue as setas, OK ativa | Toque |
| Clássica/Streaming | Clique | Setas e OK | Toque |
| Telas | Passa sozinho e pausa no hover | Passa sozinho e pausa com foco | Carrossel de arrastar |
| Outros aparelhos | Clique abre | OK abre | Toque abre |

Na TV, corpo de texto de pelo menos 24 px em 1920x1080.

## 5. Limites técnicos

- Sem bibliotecas: saem Three.js, GSAP e ScrollTrigger, que somam 792 KB.
- JavaScript próprio de até 15 KB comprimido e primeira carga de até 300 KB.
- Animar só `transform` e `opacity`, um elemento por vez, nada fora da tela, e respeitar "reduzir movimento".
- Compatível com Chromium 53 (webOS 4): sem `aspect-ratio`, `gap` em flex, `:has`, `?.` ou `??`.
- Sem JavaScript, todo o conteúdo aparece e o download leva às releases.
- Sem rastreamento e sem cookies. Nada de `src/`, sem build.

## 6. Pronto quando

- [ ] O botão principal mostra o arquivo certo em Windows, macOS, Linux e Android, e nunca baixa sozinho.
- [ ] O botão Clássica/Streaming funciona com mouse, controle e toque.
- [ ] A página inteira funciona só com setas e OK.
- [ ] Nenhum 404, erro de JavaScript ou rolagem horizontal em 390, 1280 e 1920 px.
- [ ] Limites da seção 5 medidos e anotados no PR.
- [ ] Testada em uma LG ou Android TV real.
- [ ] Nada citado como disponível sem estar em uma release publicada.

## 7. Dependência

A Visualização Streaming é destaque da página, mas só existe no PR #13. A landing deve entrar no ar junto com uma versão publicada que inclua esse recurso, com o bug do celular deitado corrigido.
