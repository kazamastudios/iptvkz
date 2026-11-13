# Publicar o IPTVKZ na Google Play

Como o IPTVKZ está publicado na Google Play pela **Kazama Studios** e como fazer cada atualização.
O que foi encontrado e corrigido para chegar aqui está em [`RELEASE_AUDIT.md`](RELEASE_AUDIT.md).

> Nada aqui garante aprovação. A Play revisa cada envio; este guia só deixa o app dentro das regras que dá para conferir no código.

## Regra principal: nada vai à Play sozinho

- O AAB assinado só sai quando alguém clica em **Actions → Google Play → Run workflow**. Em pull requests o fluxo só gera um AAB **sem assinatura**, para conferir que compila.
- Nenhum fluxo envia nada à Play. O envio é sempre manual, pela Play Console, e só depois de avaliar a versão.
- Não coloque upload automático à Play em PR, push na `main` ou tag, nem para o Beta nem para a produção.

## 1. Situação atual (12/11/2026)

| | |
|---|---|
| Conta | Kazama Studios, **conta de organização** (sem a regra de 12 testadores por 14 dias das contas pessoais) |
| App | IPTVKZ, `com.kazamastudios.iptvkz`, grátis, sem anúncios |
| Aparelhos | celular, tablet e Android TV / Google TV. Android XR veio ligado e só pode ser desligado depois do primeiro lançamento |
| Países | só Brasil |
| Publicação gerenciada | **ligada**: o que a Google aprovar fica esperando alguém clicar em *Publicar* |
| Assinatura | Play App Signing; a chave de upload (Kazama Studios) foi registrada no primeiro envio |
| Último envio | 1.1.0, `versionCode` 1 |
| Próximo `versionCode` livre | **2** |

Faixas:

| Faixa | O que tem | Quem acessa |
|---|---|---|
| Teste interno | 1.1.0 (código 1), publicada em 12/11/2026 | lista de e-mails "Kazama - interno". Link: https://play.google.com/apps/internaltest/4701305858785163067 |
| Teste fechado (Alpha) | nenhuma versão ainda; vai receber o **IPTVKZ Beta** | a mesma lista; feedback em contato@kazamastudios.com.br |
| Teste aberto | não usado | |
| Produção | 1.1.0 (código 1), lançamento completo, **enviada para revisão em 12/11/2026** | Brasil |

Enquanto a primeira revisão não termina, a Play mostra o app aos testadores como `com.kazamastudios.iptvkz (unreviewed)`, com ícone genérico e "Sem classificação". Isso some com a aprovação.

Avisos da Play Console (revisão, política, rejeição) chegam no e-mail da conta dona, **kazamastudiosoficial@gmail.com**.

## 2. Os dois canais do Android

O mesmo código gera dois apps, separados por *product flavors* do Gradle (`platforms/android/app/build.gradle`):

| | **Developer** (GitHub Releases) | **Google Play** |
|---|---|---|
| Flavor | `developer` | `play` |
| Arquivo | APK (`dist/android/IPTVKZ-android.apk`) | AAB (`dist/android/play/IPTVKZ-play-<versão>-<code>.aab`) |
| Identificador | `com.lucasyemz.iptvkz` (não muda) | `com.kazamastudios.iptvkz` (fixo para sempre) |
| Assinatura | chave própria (`ANDROID_KEYSTORE`) | chave de upload; a chave final fica com a Play |
| Atualização | sozinho, pelo GitHub Releases | só pela Play |
| `REQUEST_INSTALL_PACKAGES` | sim | não |
| Baixa código de fora | sim (pacote `src/` assinado) | não |
| Aparelhos | celular, tablet e TV | celular, tablet e TV (`leanback` e toque opcionais) |
| `versionCode` | `nativeVersion` | `playVersionCode` |

Onde fica cada coisa:

- `app/src/main/`: tudo o que é comum (Activity, WebView, Node embutido, `Bundles.java`).
- `app/src/developer/`: o atualizador de verdade (`Updater.java`), a chave pública de atualização (`update_key.xml`), o `FileProvider` e a permissão de instalar pacotes.
- `app/src/play/`: um `Updater.java` vazio e um manifesto sem acréscimos.

Nada que baixa código ou instala APK está em `main/` ou `play/`, então o AAB da Play não carrega esse código.

Com identificadores diferentes, o APK Developer e a versão da Play convivem no mesmo aparelho, cada um com os próprios dados.

**Por que não usar `com.lucasyemz.iptvkz` na Play:** com Play App Signing a Play assina com uma chave dela, e quem tem o APK atual não conseguiria atualizar pela loja. Mudar o identificador do APK quebraria a atualização de quem já usa. Por isso a Play tem um identificador próprio.

## 3. Beta e versão final na Play (decidido em 12/11/2026)

- É **um app só** na Play; as faixas recebem arquivos diferentes do mesmo pacote.
- **Teste interno e teste fechado** recebem o **IPTVKZ Beta**: nome e identidade de teste, mesmo `com.kazamastudios.iptvkz`. Quem entra no teste recebe o Beta no lugar da versão vermelha; não dá para ter os dois instalados juntos.
- **Produção** recebe só o **IPTVKZ vermelho**, gerado a partir de uma tag `v*`.
- O Beta não é promovido para a produção: cada versão final é um AAB vermelho próprio.
- O `versionCode` é um só para todas as faixas e sempre cresce. Cada Beta enviado também consome um número.
- O teste aberto fica de fora por enquanto: deixaria um beta instável visível na loja.

**Pendente no código:** o flavor `play` ainda só gera a versão vermelha (`IS_BETA false`, nome "IPTVKZ"). Falta o modo Beta escolhido no próprio *Run workflow*, sempre assinado com `PLAY_UPLOAD_*` e sem envio automático.

## 4. Requisitos da Play conferidos

- **Target API:** `targetSdk 36` e `compileSdk 36` (Android 16), exigência para celular desde 31/08/2026.
- **16 KB:** as bibliotecas de 64 bits saem alinhadas em 16 KB. A `libnode.so` é compilada do código-fonte com o NDK r27c (`.github/workflows/libnode.yml`), o mesmo NDK do app (`ndkVersion '27.2.12479018'`), o que também deixa a `libc++_shared.so` em 16 KB.
- **Dynamic Code Loading:** a versão da Play não baixa código; o `src/` vem dentro do AAB.
- **Permissões:** só `INTERNET` e `ACCESS_NETWORK_STATE`.

## 5. Chave de upload

A Play guarda a chave de assinatura do app. A Kazama guarda só a **chave de upload**, que prova que o AAB veio de nós. Se ela vazar ou se perder, dá para pedir outra pelo suporte da Play.

O `.jks` fica fora do repositório (`~/.iptvkz-android/`) e nos secrets do GitHub. Nunca coloque o arquivo nem as senhas no Git.

| Secret | Conteúdo |
|---|---|
| `PLAY_UPLOAD_KEYSTORE_BASE64` | o `.jks` em base64 |
| `PLAY_UPLOAD_KEYSTORE_PASSWORD` | senha do keystore |
| `PLAY_UPLOAD_KEY_ALIAS` | alias da chave |
| `PLAY_UPLOAD_KEY_PASSWORD` | senha da chave |

Os secrets do canal Developer (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_UPDATE_KEY`) não são usados pela Play.

## 6. Gerar o AAB

### Pelo GitHub (o normal)

1. *Actions → Google Play → Run workflow*. Opcional: um `versionCode` diferente do de `version.properties`.
2. O fluxo roda os testes, compila `bundlePlayRelease`, assina com a chave de upload, valida com o `bundletool` e mostra o tamanho de download.
3. Baixe o artefato **IPTVKZ-GooglePlay** (`.aab` e `.sha256`), por exemplo com `gh run download <id> --repo kazamastudios/iptvkz -n IPTVKZ-GooglePlay`.

Sem os secrets, o fluxo para com erro em vez de usar a chave de debug. Um AAB com `-UNSIGNED` no nome não pode ir para a Play.

O fluxo não interfere no `build.yml`: se falhar, o APK Developer, os instaladores e a Release seguem normais.

### Na máquina

Precisa de JDK 17, Android SDK com a plataforma 36, NDK `27.2.12479018` e CMake `3.22.1`.

```bash
npm ci
npm run build
npm run vendor
npm run android:play
```

Para assinar, defina antes `PLAY_UPLOAD_KEYSTORE` (caminho do `.jks`), `PLAY_UPLOAD_KEYSTORE_PASSWORD`, `PLAY_UPLOAD_KEY_ALIAS` e `PLAY_UPLOAD_KEY_PASSWORD`. Com `BUNDLETOOL` apontando para o `bundletool-all.jar`, o script também valida o AAB.

## 7. Conferir o AAB antes de enviar

Com o `bundletool`:

```bash
java -jar bundletool-all.jar validate --bundle=IPTVKZ-play-1.1.0-1.aab
```

```bash
java -jar bundletool-all.jar dump manifest --bundle=IPTVKZ-play-1.1.0-1.aab
```

O manifesto precisa ter `package="com.kazamastudios.iptvkz"`, o `versionCode` novo, `targetSdkVersion` 36, só `INTERNET` e `ACCESS_NETWORK_STATE`, e `leanback` e `touchscreen` com `required="false"`. Confira também a assinatura com `jarsigner -verify`.

Roteiro de teste no celular e na TV, de preferência pelo **teste interno da Play**:

1. Abre pelo launcher (na TV, com banner) e mostra "Abrindo", nunca "Verificando se há atualizações".
2. Termos de uso aparecem e o aceite funciona (com o controle, na TV).
3. Adicionar lista: link M3U, arquivo, Xtream e pelo celular via QR Code. Use só uma lista sua, licenciada ou a de teste da Kazama.
4. Na TV, navegar só pelo controle; Voltar fecha modais, volta de tela e, na tela inicial, sai.
5. Ao vivo: troca de canais, guia, favoritos.
6. Filmes e séries: tocar, pausar, arrastar a barra de tempo, áudio e legendas, retomar de onde parou.
7. Controle parental (PIN).
8. Tirar e voltar a internet no meio de um vídeo: o app se recupera.
9. Sair com Home e voltar depois de alguns minutos: sem tela preta.
10. Em *Configurações → Apps → IPTVKZ → Permissões*, não aparece "Instalar apps desconhecidos".

## 8. Enviar uma versão

Sempre pela Play Console, à mão:

1. Aumente `playVersionCode` em `platforms/android/version.properties`, ou informe o `versionCode` ao rodar o fluxo. Ele nunca pode repetir nem diminuir.
2. Rode *Actions → Google Play* e confira o AAB (seção 7).
3. Na faixa certa, clique em *Criar nova versão* e envie o AAB. O teste interno sai na hora, sem revisão. Teste fechado, aberto e produção passam pela revisão da Google.
4. Com a publicação gerenciada ligada, o envio fica em *Visão geral da publicação*. Clique em *Enviar mudanças para revisão* e, depois da aprovação, em *Publicar*.

O AAB pode ser enviado pelo botão *Enviar* da Console. Com o navegador do Claude, o arquivo é servido por um servidor local só em `127.0.0.1` e anexado pela página; o hash SHA-256 é conferido antes.

Na Play não existe atualização de `src/` fora da loja: **qualquer mudança, até na interface, precisa de um AAB novo**.

## 9. Ficha da loja e declarações

### O que está cadastrado

- **Ficha pt-BR:** nome IPTVKZ, descrições sem nomes de canais, emissoras ou serviços de streaming. As imagens geradas com IA estão marcadas como tal.
- **Categoria:** Reproduzir e editar vídeos.
- **Contato público:** contato@kazamastudios.com.br.
- **Política de privacidade:** https://iptvkz.kazamastudios.com.br/privacidade.html.
- **Classificação (IARC):** Livre.
- **Público-alvo:** 13 a 15, 16 a 17 e 18 anos ou mais. Abaixo de 13 o Console não deixa: exigiria as regras de apps para crianças.
- **Segurança dos dados:** não coleta nem compartilha dados. As listas, o histórico e o PIN ficam no aparelho; o que sai vai para o servidor que o próprio usuário cadastrou.
- **Anúncios e ID de publicidade:** não.
- **Governo, finanças e saúde:** não.
- **Status de comerciante:** sim (empresa).
- **Acesso ao app:** instruções em inglês para os revisores, com a lista de teste aberta da Kazama (`https://iptvkz.kazamastudios.com.br/teste/lista.m3u`, com o guia em `/teste/guia.xml`).
- **Formatos:** Android TV ativado.

### Imagens

Ficam em `kazamastudios/marketing/google-play/iptvkz/`, fora deste repositório. Só conteúdo fictício ou de teste aberto; nada de logos ou capas de terceiros.

- Ícone 512×512, imagem de destaque 1024×500 e banner de TV 1280×720.
- Capturas de TV 1280×720 (`tv-01` a `tv-08`).
- Capturas de celular da 1.1.0 em `celular-1.1.0/`: 1080×1920, e o player 1920×1080. Mostram a barra de baixo com "Salvos" e o player sem Cast nem miniatura. **Ainda não enviadas**: entram depois da aprovação da primeira revisão, no lugar das antigas.

Para refazer capturas: o app roda pelo código com dados isolados (`IPTVKZ_DATA`) e uma lista Xtream falsa servida em `127.0.0.1`, com filmes, séries, canais, guia, capas e vídeo inventados. Para sair com a identidade vermelha, use um `src/web/build-info.json` com `"channel":"producao"` na cópia usada para as capturas; nunca no repositório.

## 10. Pendências

- [ ] Revisão da produção 1.1.0 (enviada em 12/11/2026). Depois da aprovação: clicar em *Publicar*.
- [ ] Depois do primeiro lançamento: desligar o Android XR em *Configurações avançadas → Formatos*.
- [ ] Trocar as capturas de celular pelas de `celular-1.1.0/`.
- [ ] Modo Beta no flavor `play` e no `play.yml` (seção 3); primeiro AAB Beta no teste fechado.
- [ ] Teste no celular e na Android TV (Mecool) pelo teste interno, com o roteiro da seção 7.
- [ ] Selo "Disponível no Google Play" na landing page depois do lançamento.
