# Organização do projeto

Toda pasta tem uma função só. Antes de criar um arquivo ou pasta, encaixe nesta tabela. Se não couber, combine antes de inventar um lugar novo.

| Pasta | O que guarda | Vai para o Git? |
|---|---|---|
| `src/server/` | Servidor local, igual em todas as plataformas | Sim |
| `src/web/` | Interface, igual em todas as plataformas | Sim |
| `platforms/<plataforma>/` | Código e configuração exclusivos de uma plataforma (`desktop`, `webos`, `windows`, `android`) | Sim |
| `assets/brand/` | Logos e ícones originais | Sim |
| `scripts/` | Scripts de build e manutenção | Sim |
| `docs/` | Documentação | Sim |
| `public/` | Landing page publicada pelo Cloudflare Pages. Sem build, sem importar nada de `src/`, e nenhum build escreve aqui | Sim |
| `dist/<plataforma>/` | Tudo o que os builds geram | Não |
| `data/` | Listas e preferências de quem roda pelo código | Não |

## Regras

1. **Saída de build só em `dist/<plataforma>/`.** Hoje são `dist/desktop`, `dist/webos` (com `dist/webos/store` para o IPK da LG Content Store) e `dist/android`. Nunca crie pastas como `dist-tv` ou `build-x` na raiz.
2. **Cada build escreve só na própria subpasta**, sem mexer na de outra plataforma.
3. **Plataforma nova** ganha `platforms/<nome>/`, `dist/<nome>/`, `scripts/build-<nome>.js` e um comando em `package.json`.
4. **O que serve a mais de uma plataforma fica em `src/`.** Em `platforms/` entra só o que é específico daquela plataforma.
5. **Mudou um caminho de saída?** Atualize junto `package.json`, `.github/workflows/build.yml`, `README.md` e esta tabela.
6. **Chaves e senhas nunca entram no repositório.** As de assinatura do Android ficam em `~/.iptvkz-android/` e nos secrets do GitHub. O que está em `update_key.xml` é só a chave pública.

## Uma mudança, todas as plataformas

O app é de um para muitos: PC, TV LG, Android TV e celular têm a mesma experiência, com pequenas adaptações só quando necessário. Nada de versão exclusiva de uma plataforma.

1. **Mudou num lugar, muda em todos.** Ao planejar, diga como fica no PC (mouse), na TV (controle, foco, sem hover) e no celular (toque).
2. **Não funciona numa plataforma? Faça o equivalente e diga qual.** Hover no PC = foco do controle na TV = toque no celular. Ex.: o zoom da capa no hover também aparece no foco da TV.
3. **Leve em todos os aparelhos.** Animar só `transform` e `opacity`, um elemento por vez, nada animando fora da tela.

## Arquivos gerados que vão para o Git

São exceções, porque o app é servido direto de `src/web/`:

- `src/web/vendor/`: gerado por `npm run vendor`.
- `src/web/js/app.legacy.js`: gerado por `npm run build`. Rode depois de mexer em `src/web/js`.
