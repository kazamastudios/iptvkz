# Auditoria para a Google Play

Auditoria feita em 10/11/2026 na branch `play-store-release` (a partir da `main` em `d04f97d`), antes da primeira publicação na Google Play. Como publicar está em [`GOOGLE_PLAY_RELEASE.md`](GOOGLE_PLAY_RELEASE.md).

Prioridades: **P0** impede publicar ou quebra o app na Play; **P1** risco real de segurança ou de reprovação; **P2** melhoria. O que o README promete não foi tratado como testado: cada item diz como foi verificado.

## Resumo

- **Corrigidos:** 6 P0 (o #8 só para TV; o #5 com o identificador aprovado), 5 P1 e 2 P2.
- **Pendentes:** 2 P0 que dependem de dado externo (conta/política, lista de teste), 3 P1 e 4 P2 (mais 1 risco aceito e 1 fora do escopo).
- **Testes:** 16 testes automatizados novos do servidor (`npm test`), todos passando; interface conferida no navegador (modos computador e TV).
- **Builds Android (no PC, com JDK 17.0.21 e Android SDK instalados em 10/11/2026):** APK Developer e AAB da Play compilam; o AAB passou no `bundletool validate` e na conferência do manifesto. Sem as chaves de produção: APK assinado com a chave de debug (como nos PRs) e AAB sem assinatura. Falta rodar no GitHub Actions e testar na TV.

## Problemas encontrados

### P0

| # | Problema | Arquivo | Causa | Impacto | Correção | Como validar | Situação |
|---|---|---|---|---|---|---|---|
| 1 | O único APK pede `REQUEST_INSTALL_PACKAGES`, baixa o pacote `src/` do GitHub e instala APK | `AndroidManifest.xml`, `Updater.java` | Um build só, feito para distribuição fora da loja | Viola as políticas de Dynamic Code Loading e de atualização fora da Play; reprovação | Product flavors `developer` e `play`. Permissão, `FileProvider`, `update_key.xml` e o `Updater` real só em `app/src/developer/`; a Play tem um `Updater` vazio (`ENABLED = false`) | `bundletool dump manifest` no CI (script reprova se achar `REQUEST_INSTALL_PACKAGES` ou `FileProvider`); na TV, ver permissões do app | Corrigido, **falta rodar o build** |
| 2 | Sem AAB e sem assinatura de upload; o release caía na chave de debug quando faltava keystore | `app/build.gradle`, `scripts/build-android.js` | Só existia `assembleRelease` com `signingConfigs.debug` como reserva | Não dá para enviar à Play; risco de AAB com chave de debug | `bundlePlayRelease` com `signingConfigs.playUpload` (secrets `PLAY_UPLOAD_*`); sem chave sai **sem assinatura** e marcado `-UNSIGNED`; `PLAY_REQUIRE_SIGNING=1` faz o Gradle parar | Rodar *Actions → Google Play* com e sem secrets | Corrigido, **falta rodar o build** |
| 3 | Na Play, o `src/` novo não seria instalado depois de uma atualização | `Bundles.java` + `BUNDLE_VERSION` | O pacote embutido só é reinstalado quando `BUNDLE_VERSION` sobe, e fora do CI ele fica em 1 | Atualização pela Play com interface velha | Na Play, `BUNDLE_VERSION` = `versionCode` (`playVersionCode`), e o script grava o mesmo número em `version.txt` | Instalar versão N, depois N+1 pelo bundletool e ver a mudança na interface | Corrigido, **NECESSITA VALIDAÇÃO MANUAL** |
| 4 | Termos diziam que o app só se conecta às listas e aos testes de conexão | `src/web/termos.txt` | Não citavam o GitHub (atualizações do Android e da LG) nem o arquivo de lista com senha | Declaração de privacidade falsa; motivo de reprovação | Termos versão 3 (`TERMS_VERSION = 3`, pede novo aceite): lista todas as conexões, diz que a versão da Play só atualiza pela loja e que o computador não procura atualizações | Ler `termos.txt` contra `Updater.java`, `platforms/webos/service/main.js` e `network.js` | Corrigido |
| 5 | Identificador da Play | `app/build.gradle` | Com Play App Signing, a chave da Play é outra; usar `com.lucasyemz.iptvkz` impede quem tem o APK de atualizar pela Play e de ter os dois | Escolha errada é irreversível depois do primeiro envio | Developer mantém `com.lucasyemz.iptvkz`; Play com a proposta `com.kazamastudios.iptvkz` | `bundletool dump manifest` mostra o pacote | Corrigido: aprovado pelo Lucas em 10/11/2026 |
| 6 | Conta, política de privacidade publicada, dados da Kazama Studios | — | Dados legais/empresariais fora do repositório | Sem link de política e sem conta não há envio | Rascunho da política e respostas do Data Safety em `GOOGLE_PLAY_RELEASE.md` | — | **PENDENTE (dado externo)** |
| 7 | Revisores precisam de uma lista para testar | — | O app vem vazio de propósito | A revisão pode reprovar por "app não funciona" | Instruções para os revisores no guia | Lucas fornece um stream próprio ou licenciado | **PENDENTE (dado externo)** |
| 8 | `targetSdk 34` | `app/build.gradle` | Regra de 31/08/2026: API 36 para apps comuns, **34 para Android TV** | Para celular, envio recusado | Versão da Play só para TV (`leanback` `required="true"` em `app/src/play/`) | `bundletool dump manifest` (checado no script) | Corrigido para TV; celular **PENDENTE** (ver P1 #12) |

### P1

| # | Problema | Arquivo | Causa | Impacto | Correção | Como validar | Situação |
|---|---|---|---|---|---|---|---|
| 9 | Proxy respondia com `Access-Control-Allow-Origin: *` | `src/server/index.js` | Herança de quando a interface era servida de outra origem | Qualquer site aberto no navegador do computador podia ler, pelo proxy, páginas da rede de casa (roteador etc.) e da internet com o IP do usuário (SSRF legível) | Cabeçalho removido: a interface é da mesma origem | Teste "proxy: sem CORS aberto" | Corrigido |
| 10 | Sem conferência do cabeçalho `Host` | `src/server/index.js`, `network.js` | — | DNS rebinding: um site apontando o próprio domínio para 127.0.0.1 lia `/api/state` com usuário e senha das listas | Só aceita IP, `localhost`, nome sem ponto e domínios locais (`.local`, `.lan`, `.home.arpa`…); o resto recebe 403 | Teste "Host" | Corrigido |
| 11 | Sem conferência de `Origin` | `src/server/index.js`, `network.js` | — | CSRF: um site podia gravar estado (`POST /api/state/lists` com `text/plain`) | Pedido com `Origin` de outra origem (ou `null`) recebe 403 | Teste "Origin" | Corrigido |
| 12 | Outros apps do mesmo aparelho Android acessam o servidor em 127.0.0.1 | `src/server/index.js` | Loopback é tratado como "o próprio aparelho" | Um app malicioso instalado na TV pode ler as listas com senha em `/api/state` (vale também entre o Developer e o da Play) | Proposta: token aleatório por abertura, passado do Java ao Node por argumento e ao WebView por cookie; o servidor exige o cookie no Android | Precisa testar reprodução (`<video>`, hls.js, mpegts.js) na TV com o cookie | **PENDENTE** (mexe em reprodução; sem aparelho para validar agora) |
| 13 | WebView seguia qualquer navegação na tela principal | `MainActivity.java` | `shouldOverrideUrlLoading` devolvia sempre `false` | Uma página de fora (ex.: link dentro do trailer) ficaria com a ponte `IPTVKZAndroid` | Tela principal presa a `http://127.0.0.1`; quadros internos (YouTube) continuam; `setAllowFileAccess(false)` e `setAllowContentAccess(false)` | Na TV: abrir trailer e tentar sair pelo logo do YouTube | Corrigido, **NECESSITA VALIDAÇÃO MANUAL** |
| 14 | Backup automático do Android | `AndroidManifest.xml` | `allowBackup` padrão (`true`) | Listas com senha iriam para o backup na nuvem | `allowBackup="false"` e `fullBackupContent="false"` nos dois canais | `adb shell bmgr backupnow` não deve incluir o app | Corrigido |
| 15 | `libnode.so` alinhada em 4 KB | nodejs-mobile v18.20.4 | Última versão publicada (out/2024); a correção está no repositório deles, sem release | Impede `targetSdk 35+` (16 KB obrigatório para atualizações a partir de 01/02/2027) e, com isso, publicar para celular; em TVs futuras com 16 KB roda em modo de compatibilidade | `native-lib` passou a ligar com 16 KB; `libnode` e `libc++_shared` (NDK r26) dependem de atualização | Conferido com um leitor de ELF: `LOAD align 0x1000` nos dois ABIs | **PENDENTE** (depende do nodejs-mobile ou de compilar o Node) |
| 16 | Dependências do computador com vulnerabilidades | `package.json` | Electron 33, electron-builder 25, esbuild 0.24, webOS CLI | Só o app de computador e as ferramentas de build; **não vão para o Android** (o servidor não tem dependências) | Atualização de versão maior; fora do escopo da Play | `npm audit` (22 avisos, 0 em produção) | **PENDENTE** (follow-up) |

### P2

| # | Problema | Arquivo | Situação |
|---|---|---|---|
| 17 | Arquivos estáticos: prefixo sem separador (`src/web-x` passaria por `src/web`) e `%` malformado derrubava o servidor | `src/server/index.js` | Corrigido (teste "estáticos") |
| 18 | Não havia testes automatizados | — | Corrigido: `scripts/test-server.js`, `npm test`, job `test` no `build.yml` e no `play.yml` |
| 19 | Listas e guias baixados sem limite de tamanho (tudo na memória) | `src/server/util.js` | Pendente: limitar em algo como 300 MB |
| 20 | Muitas entradas iguais do mesmo episódio deixam a montagem do catálogo quadrática (20 mil cópias: mais de 1 min) | `src/server/catalog.js` (`addVersion`) | Pendente; listas normais montam rápido (60 mil entradas em ~0,25 s) |
| 21 | A ponte `IPTVKZAndroid` também aparece no quadro do YouTube (expõe o IP da rede local) | `MainActivity.java` | Pendente: trocar por `WebViewCompat.addWebMessageListener` com origem permitida |
| 22 | `MIXED_CONTENT_ALWAYS_ALLOW` sem efeito (a página é `http`) | `MainActivity.java` | Pendente: limpeza |
| 23 | Proxy segue redirecionamentos e alcança endereços da rede local | `src/server/index.js` | Aceito: listas em servidores da casa (ex.: tvheadend) precisam disso; quem chama o proxy agora é só a própria interface (#9–#11) |
| 24 | Vistos de passagem: "Todos os séries" em Séries; no modo TV, a estrela de favorito cobre a dica "informações" | `src/web` | Fora do escopo |

## Arquivos mudados

- `platforms/android/app/build.gradle`: flavors `developer`/`play`, assinaturas separadas, trava de assinatura da Play, `androidx.core` só no Developer.
- `platforms/android/app/src/main/AndroidManifest.xml`: sem permissão de instalar e sem `FileProvider`; `allowBackup="false"`.
- `platforms/android/app/src/developer/`: `AndroidManifest.xml` (permissão + `FileProvider`), `Updater.java` (movido, com `ENABLED = true`), `res/values/update_key.xml` e `res/xml/file_paths.xml` (movidos).
- `platforms/android/app/src/play/`: `AndroidManifest.xml` (só TV) e `Updater.java` vazio.
- `platforms/android/app/src/main/java/.../MainActivity.java`: abertura sem "verificando atualizações" na Play; WebView presa à origem local, sem acesso a arquivos.
- `platforms/android/app/src/main/cpp/CMakeLists.txt`: `native-lib` com alinhamento de 16 KB.
- `platforms/android/version.properties`: `playVersionCode`.
- `scripts/build-android.js`: `--play` (AAB em `dist/android/play/`, validação com bundletool); o Developer não apaga mais a pasta da Play; funciona com `gradlew.bat` no Windows.
- `scripts/test-server.js` (novo) e `package.json` (`android:play`, `test`).
- `src/server/index.js`, `src/server/network.js`: Host, Origin, CORS do proxy, arquivos estáticos.
- `src/web/termos.txt`, `src/web/js/views/terms.js`, `src/web/js/app.legacy.js` (gerado): termos versão 3.
- `.github/workflows/build.yml`: job de testes; upload do Android com nomes explícitos.
- `.github/workflows/play.yml` (novo): fluxo da Play separado.
- `README.md`, `CLAUDE.md`, `docs/GOOGLE_PLAY_RELEASE.md`, `docs/RELEASE_AUDIT.md`.

## Evidências

- `npm test`: 16/16 passando em ~1 s (Node 24 local). Cobre: Host/DNS rebinding, Origin/CSRF, caminhos estáticos, proxy sem CORS, HLS (segmentos e chave reescritos), MPEG-TS com Range, servidor fora do ar (502), 25 trocas de canal canceladas no meio, M3U por link e por arquivo, atualizar lista, Xtream (login, catálogo, série, status, senha errada sem vazar a senha), EPG `.xml.gz`, favoritos/progresso/PIN, baixar e carregar lista, pareamento (uso único) e lista de 60 mil entradas (~0,25 s). Tudo com dados fictícios gerados no próprio teste.
- Navegador (servidor local em `localhost` e `127.0.0.1`): termos v3 aparecem, aceite grava (`PUT /api/state/settings` → 200 com a checagem de Origin), tela inicial e modo TV (`?tv=1`) abrem sem erros no console.
- `libnode.so` v18.20.4: `LOAD` com alinhamento 4 KB e `GNU_RELRO` fora do limite de 16 KB nos dois ABIs (leitor de ELF próprio, arquivos baixados do release oficial do nodejs-mobile).
- YAML dos dois workflows conferido com `js-yaml`.
- `npm run android` (Developer): `BUILD SUCCESSFUL`, APK de 35 MB. `aapt2 dump badging`: pacote `com.lucasyemz.iptvkz`, versionCode 3, versionName 1.0.5, `targetSdk 34`, as mesmas permissões de antes (incluindo `REQUEST_INSTALL_PACKAGES`), `FileProvider` presente, `leanback-launchable-activity`, ABIs `arm64-v8a` e `armeabi-v7a`, `allowBackup=false`. O `bundle.zip` embutido grava caminhos com `/`.
- `npm run android:play`: `BUILD SUCCESSFUL`, AAB de 66 MB (47 MB são símbolos de depuração para a Play, que não vão para a TV). `bundletool dump manifest`: pacote `com.kazamastudios.iptvkz`, versionCode 1, `targetSdk 34`, só `INTERNET` e `ACCESS_NETWORK_STATE`, `leanback` obrigatório, sem `FileProvider`, sem `debuggable`. Nos `.dex`: nenhuma ocorrência de `FileProvider`, `package-archive`, `android-update`, `github` ou `installApk` (só o `Updater` vazio). `dump config`: `PAGE_ALIGNMENT_16K`.
- Tamanho de download estimado (`bundletool get-size total`): 17,4 MB (armeabi-v7a) e 17,9 MB (arm64-v8a). Instalado ocupa mais porque as bibliotecas são extraídas (`extractNativeLibs=true`).
- Alinhamento das bibliotecas no AAB: `libnative-lib.so` 16 KB (corrigido); `libnode.so` e `libc++_shared.so` 4 KB nos dois ABIs.
- `PLAY_REQUIRE_SIGNING=1` sem chave: `BUILD FAILED` com "PLAY_UPLOAD_KEYSTORE não definida", sem AAB. Developer depois de Play (e vice-versa) não apaga a saída do outro.
- Bug achado só ao compilar e corrigido: `signingConfig null` no flavor `play` quebrava o Gradle.
- **Não rodado:** TV real, AAB assinado com a chave de upload e GitHub Actions.

## Checklist de requisitos

| Requisito | Situação |
|---|---|
| Canal Developer intacto (mesmo ID, chave, atualização por GitHub, confirmação do APK) | CONCLUÍDO no build (mesmo pacote, versão e permissões); NECESSITA VALIDAÇÃO MANUAL (atualizar um APK 1.0.5 na Mecool com o APK assinado pela chave do projeto) |
| Variante Play sem `REQUEST_INSTALL_PACKAGES`, sem instalar APK, sem baixar código | CONCLUÍDO (conferido no manifesto e nos `.dex` do AAB) |
| Flavors sem duplicar código | CONCLUÍDO (só o `Updater` tem versão vazia na Play) |
| Identificador definitivo da Play | CONCLUÍDO (`com.kazamastudios.iptvkz`, aprovado) |
| AAB com assinatura de upload, nunca debug | CONCLUÍDO no código; PENDENTE gerar a chave e os secrets |
| AAB gerado | CONCLUÍDO sem assinatura no PC (validado); PENDENTE o assinado (chave de upload) |
| versionCode/versionName | CONCLUÍDO (`playVersionCode`, `nativeName`) |
| ABIs `armeabi-v7a` e `arm64-v8a` | CONCLUÍDO (sem mudança) |
| Tamanho do download | CONCLUÍDO: ~17,4 MB (v7a) e ~17,9 MB (arm64) |
| 16 KB | PENDENTE para `libnode`/`libc++_shared`; não exigido com `targetSdk 34` |
| Target API (TV 34+) | CONCLUÍDO para TV; celular PENDENTE (API 36 + 16 KB) |
| Teste com bundletool | CONCLUÍDO no PC (`validate`, `dump manifest`, `dump config`, `build-apks`, `get-size`); instalação na TV PENDENTE |
| TV: `LEANBACK_LAUNCHER`, banner, ícone | CONCLUÍDO no manifesto (banner 320×180 e 640×360, ícone 192×192); NECESSITA VALIDAÇÃO MANUAL |
| TV: D-pad, foco, Voltar, teclado, orientação, player, retomada | NECESSITA VALIDAÇÃO MANUAL (roteiro na seção 5 do guia) |
| Segurança do servidor (Host, Origin, CORS, caminhos, limites) | CONCLUÍDO (#9–#11, #17); PENDENTE #12 e #19 |
| Pareamento por QR Code | CONCLUÍDO (revisado: chave de 128 bits, 15 min, uso único, só redes privadas; testado) |
| WebView (navegação, arquivos, depuração) | CONCLUÍDO (#13; depuração só em build depurável, padrão do Android); PENDENTE #21 |
| Credenciais: logs e backups | CONCLUÍDO (servidor não registra URLs nem senhas; erros mostram só o host; `allowBackup` desligado) |
| Aviso ao exportar lista com senha | CONCLUÍDO (já existia no celular e na tela de QR; mantido) |
| Dependências npm/Gradle/nativas | Revisadas: servidor sem dependências; Android só `androidx.core` (Developer); PENDENTE #15 e #16 |
| Testes automatizados | CONCLUÍDO (16) |
| Termos coerentes com o código | CONCLUÍDO (versão 3) |
| Política de privacidade | PENDENTE (rascunho pronto; falta publicar com dados da Kazama Studios) |
| Data Safety | PENDENTE (respostas propostas; decisão final do Lucas) |
| Ficha da loja | PENDENTE (textos sugeridos; faltam artes de TV) |
| CI Play separado, sem upload automático | CONCLUÍDO (`play.yml`); NECESSITA VALIDAÇÃO (primeira execução) |
| CI Developer mantido | CONCLUÍDO (mesmos jobs; só ganhou `test` independente e upload com nomes explícitos) |
| Documentação | CONCLUÍDO |
| Aprovação na Play | Não garantida: depende da revisão da Google |
