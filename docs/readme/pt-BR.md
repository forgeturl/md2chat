# md2chat — Markdown pronto para conversar

[简体中文](../../README.md) · [English](en.md) · [Español](es.md) · [Português](pt-BR.md) · [日本語](ja.md) · [한국어](ko.md) · [Deutsch](de.md) · [Français](fr.md) · [हिन्दी](hi.md)

<!-- language: pt-BR; source-sha256: a4607b50438048b9ba1495a6554c9b2c6e20ab1bb623b0e0f13212abd7e63f41 -->

Transforme Markdown de ferramentas de IA ou dos seus documentos em texto e imagens para chats. O texto comum permanece editável; tabelas, código, fórmulas e diagramas Mermaid viram imagens na ordem original. Tarefas usam ✅ / ⬜. Nomes de ferramentas de IA indicam fontes possíveis, não integrações oficiais nem compatibilidade comprovada.

[Site](https://forgeturl.github.io/md2chat/pt-br/) · [Editor web](https://forgeturl.github.io/md2chat/editor.html?lang=pt-BR) · [Última versão](https://github.com/forgeturl/md2chat/releases/latest) · [Evidências de compatibilidade](../compatibility.md)

![Prévia do desktop](../desktop-preview.png)

## Download

- [DMG universal para macOS — Apple Silicon e Intel](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-mac-universal.dmg)
- [Instalador Windows x64 — Intel e AMD](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-windows-x64-setup.exe)
- [Somas SHA256](https://github.com/forgeturl/md2chat/releases/latest/download/SHA256SUMS.txt)

Os links apontam sempre para a versão mais recente. Use o DMG para instalar no Mac; `.app.tar.gz` serve às atualizações internas. Não há pacote nativo para Windows ARM. O desktop usa Tauri 2, Rust e o WebView do sistema, sem incluir Electron ou Node.js. O instalador do Windows baixa o WebView2 se necessário. Versões oficiais de Mac exigem assinatura Developer ID e notarização; Windows ainda não usa assinatura Authenticode. Instalações antigas de Electron não são migradas automaticamente.

## Como usar

Cole Markdown, texto ou imagens à esquerda, confira a prévia, escolha o destino e cole no aplicativo. Limpar inicia um documento vazio. A web desativa a cópia para DingTalk e Feishu; use o desktop nesses casos.

- **WeChat:** texto e imagens padrão; confira se todas as imagens foram mantidas.
- **DingTalk:** formato nativo no Mac; HTML e texto alternativo no Windows. Testes históricos do Mac não comprovam todos os clientes atuais; o Windows precisa de validação no cliente.
- **Feishu/Lark:** expanda o editor de texto formatado no Mac antes de colar. Texto com imagens e envio foram testados no Mac; Windows continua experimental.
- **WeCom:** no Mac, cole tudo de uma vez com texto editável. Na web e no Windows, conteúdos com imagens usam partes em sequência. O teste do Mac foi em rascunho, sem envio.
- **E-mail:** tabelas HTML editáveis; conteúdo complexo vira imagem. Experimental: confira as imagens após colar e enviar.

O desktop também converte todo o documento em um PNG branco. O texto da imagem não é editável. Conteúdos longos podem ser reduzidos ou ultrapassar os limites. Se a área de transferência mudar durante a conversão, o conteúdo novo é preservado e uma nova tentativa é solicitada. Caminhos absolutos e URLs locais `file:///` são aceitos após validação: PNG, JPEG, GIF, WebP ou BMP, até 10 MB e 20 milhões de pixels por imagem. Na web, cole a imagem diretamente. Nenhuma mensagem é enviada automaticamente.

## Bandeja e atalhos

Use a barra de menus do Mac ou a bandeja do Windows para converter a área de transferência sem mudar o editor, abrir a janela e Preferências, buscar atualizações ou sair completamente. Fechar a janela mantém o processo e o texto na memória. Preferências permite fixar e ordenar formatos, ativar a inicialização no login e configurar atalhos globais. Atalhos e inicialização exigem ativação explícita; no Mac, instale antes em Aplicativos. Bandeja e inicialização do Windows ainda precisam de testes em máquina real.

## Idiomas e atualizações

Interface, exemplos, site, README e resumos de atualização suportam nove idiomas. O menu com globo mostra os nomes nativos. Exemplos não editados acompanham o idioma; editar, colar, arrastar ou limpar preserva o conteúdo do usuário, mesmo após desfazer.

Os resumos incluem as versões publicadas entre a instalada e a desejada. As três mais recentes aparecem primeiro; as anteriores podem ser expandidas e os avisos importantes permanecem visíveis. Notas técnicas conservam o idioma original. A busca ocorre após iniciar e a cada seis horas; baixar e reiniciar dependem do usuário. Salve o texto antes de instalar. Clientes antigos recebem a interface nova após instalar uma versão que a contenha; a instalação entre versões exige testes com pacotes assinados.

## Privacidade e diagnóstico

Sem conta e sem envio do conteúdo a um serviço md2chat. A conversão é local; imagens remotas acessam seus servidores originais. O desktop pode guardar imagens localmente para permitir colagens posteriores. O texto não é salvo permanentemente: sair completamente ou recarregar o apaga.

O diagnóstico lê apenas quando solicitado. O ZIP exportado contém dados originais, texto, imagens, links e possíveis formatos privados: confira antes de compartilhar. Fechar o diagnóstico apaga a amostra. Nada é enviado automaticamente; o link de problemas abre o GitHub para anexar o ZIP manualmente. Pedidos de atualização não incluem o documento.

## Desenvolvimento

Node.js 22.12+ e Rust 1.90+. Mac exige Xcode Command Line Tools; Windows, ferramentas Visual Studio C++ e WebView2. Compile cada instalador no seu sistema. O DMG oficial também exige Python 3.10+ e dependências verificadas em `scripts/dmgbuild-requirements.txt`.

```sh
npm ci
npm run dev
npm run desktop
npm run check
npm run build
npm run desktop:test
npm run desktop:test:render
npm run desktop:test:native
npm run desktop:test:windows
npm run desktop:dist:mac
npm run desktop:dist:win
```

Testes nativos substituem temporariamente a área de transferência e a restauram; execute quando não estiver em uso. Testes web ou de formato não comprovam aceitação em clientes reais. Apenas páginas locais empacotadas podem acessar os comandos restritos do desktop; o WebView não expõe Node.js.

## Contribuição e publicação

Siga a [norma de idiomas](../localization.md), sincronizando os nove idiomas nas mudanças visíveis. Execute `npm run seo:generate` após mudar páginas ou recursos e `npm run check` antes de confirmar. Fontes de páginas traduzidas ficam em `site/locales/`, mantendo as URLs públicas existentes. Este diretório reúne oito traduções do README; a raiz está em chinês. Registros técnicos podem manter o idioma original.

Prepare notas detalhadas e resumo em nove idiomas:

```sh
npm run release:prepare -- patch --notes-file /tmp/md2chat-release-notes.md --summary-file /tmp/md2chat-update-summary.json
npm run release:verify -- --tag vX.Y.Z
```

Revise os arquivos, execute as verificações e `npm run release:verify -- --tag vX.Y.Z`. Preparar não cria commit nem publica. Só um pedido explícito de publicação autoriza criar e enviar a tag. Main e PR não publicam; o site tem fluxo independente. A publicação oficial valida pacotes e assinaturas, publica no GitHub e depois implanta o site da mesma versão. O fluxo manual do desktop gera apenas pacotes de teste, sem atualização interna ou publicação. Veja [assinatura e publicação](../auto-update.md), [resumos](../update-summaries.md), [validação Windows](../windows-clipboard-qa.md) e a [referência detalhada](../../README.md#发布).

Use exemplos fictícios. Não envie mensagens privadas, amostras do clipboard, credenciais ou capturas pessoais. [Licença MIT](../../LICENSE) · [Avisos de terceiros](../../THIRD_PARTY_NOTICES.md).
