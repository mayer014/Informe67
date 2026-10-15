# Backend do Informe67

A API Fastify e o frontend estático são serviços separados. O frontend não
recebe credenciais PostgreSQL. A API não executa migrações ao iniciar nem
durante o build/deploy no EasyPanel.

## Preparar outro computador com VS Code e GitHub

1. Instale Git, VS Code, Node.js 22 ou superior e as ferramentas de cliente do
   PostgreSQL (`pg_dump`/`pg_restore`).
2. Clone o repositório pelo VS Code ou terminal e abra a pasta do projeto:

   ```powershell
   git clone URL_DO_REPOSITORIO
   Set-Location Informe67\backend
   npm.cmd ci
   Copy-Item .env.example .env
   ```

3. Edite apenas `backend\.env` para configurar host, porta e credenciais do
   banco. Esse arquivo é ignorado pelo Git; não copie credenciais para o
   frontend, arquivos versionados ou mensagens do GitHub.
4. Para desenvolver localmente contra a VPS, use o túnel SSH descrito abaixo.
   Em todos os computadores, migrações e scripts usam o mesmo repositório e o
   mesmo banco central, mas cada computador mantém seu próprio `.env`.

No PowerShell, use `npm.cmd` se a política de execução bloquear `npm.ps1`.

## PostgreSQL

O exemplo `backend/.env.example` documenta as variáveis:

- `PGHOST`: host PostgreSQL; `n8n_postgres` na rede privada do EasyPanel ou
  `127.0.0.1` pelo túnel local.
- `PGPORT`: porta; `5432` no EasyPanel ou `5433` pelo túnel local.
- `PGDATABASE`: deve ser exatamente `informe67` para os comandos Drizzle.
- `PGUSER` e `PGPASSWORD`: credenciais locais, nunca versionadas.
- `PGCONNECT_TIMEOUT_MS`: timeout de conexão da API em milissegundos.

No EasyPanel, use segredos do serviço e a rede privada. Não publique a porta
5432. Nenhum comando de migração é parte do `npm start`, do build ou do
Dockerfile.

### Inventário somente de leitura

Com o túnel SSH ativo e `backend/.env` configurado para `PGDATABASE=informe67`,
execute a partir da pasta `backend`:

```powershell
npm.cmd run db:inventory
```

O script `scripts/inventory.ts` valida primeiro que `PGDATABASE` está definido
como `informe67`, abre uma transação `READ ONLY`, confirma `current_database()`
e só então lista tabelas e schemas não sistêmicos. Ele não consulta outros
bancos, não altera objetos e não imprime credenciais. Se a confirmação do nome
do banco falhar, cancela antes da consulta ao catálogo.

### Túnel SSH local no Windows

Com uma chave SSH protegida, mantenha este comando em um PowerShell:

```powershell
ssh -o ExitOnForwardFailure=yes -N -L 127.0.0.1:5433:n8n_postgres:5432 USUARIO_SSH@HOST_PUBLICO_DA_VPS
```

O servidor SSH da VPS precisa resolver `n8n_postgres` na rede privada do
EasyPanel. Se isso não funcionar, configure o acesso interno com o administrador
da VPS; não exponha PostgreSQL publicamente. No `.env` local, use `PGHOST=127.0.0.1`
e `PGPORT=5433`. Pare o túnel com Ctrl+C ao terminar.

## Migrações versionadas

O schema Drizzle fica em `src/db/schema.ts`. A migração inicial gerada em
`drizzle/0000_*.sql` cria a estrutura do portal; foi gerada para revisão local
e **foi aplicada em 12/10/2026** no banco `informe67`, após backup SQL com
`pg_dump` 17.11. Foram confirmadas as 14 tabelas em `public` e a tabela de
controle `drizzle.__drizzle_migrations`. O banco estava sem tabelas de
aplicação antes da migração. Revise e versione juntos o SQL e
`drizzle/meta/_journal.json`. Backups com dados reais nunca devem ser
commitados; `backups/` e formatos comuns de backup estão no `.gitignore`.

### Modelo inicial

- `users`: contas administrativas com `password_hash`, sem senha em texto puro.
- `roles`, `permissions`, `user_roles`, `role_permissions`: RBAC normalizado,
  permitindo atribuir várias funções por usuário e várias permissões por
  função.
- `categories`: categorias com slug único e categoria pai opcional.
- `news`: conteúdo, slug único, autor, categoria opcional, estado editorial
  (`draft`, `scheduled`, `published`, `archived`), metadados SEO e
  `is_featured`/`featured_order`.
- `news_images`: referências/URLs de imagens, texto alternativo, legenda,
  créditos e ordenação; os binários não são armazenados no PostgreSQL.
- `tags`, `news_tags`: tags e relacionamento muitos-para-muitos com notícias.
- `banners`: posição, imagem externa, link, período, estado de exibição e
  ordenação (`sort_order`).
- `portal_settings`: configurações por chave com valor JSONB.
- `audit_logs`: ator, ação, entidade, metadados e horário para auditoria.
- `redirects`: redirecionamentos relativos ao próprio portal, com origem única
  e somente códigos HTTP 301 ou 308.

As tabelas usam UUIDs onde apropriado, chaves estrangeiras e índices para
consultas comuns. Há validação de formato de slug, datas obrigatórias para
notícias agendadas/publicadas, intervalo de exibição dos banners e no máximo
uma imagem de capa por notícia. Os redirects aceitam apenas caminhos locais
absolutos (sem host/protocolo, `//`, barras codificadas ou caracteres fora da
lista segura), e o banco bloqueia redirecionamento direto para a própria
origem. Antes de persistir um redirect, o backend deve usar
`src/redirects/validation.ts`, que segue a cadeia existente e rejeita ciclos
indiretos.

A exclusão de notícias com imagens ou tags associadas é restringida; o caminho
normal de remoção deve ser arquivar a notícia, preservando conteúdo editorial.
A exclusão de usuários com notícias de autoria ou registros de auditoria também
é restringida. Categorias podem ser removidas sem apagar notícias (a categoria
fica nula). Os registros de auditoria nunca são apagados em cascata.

`updated_at` é mantido pelo backend: os campos usam `$onUpdate(() => new Date())`
do Drizzle, que atualiza o valor nas operações de edição feitas pelo ORM. Isso
não é um trigger PostgreSQL; qualquer SQL manual ou escrita por outro cliente
deve definir `updated_at` explicitamente. As rotas/serviços de edição devem
usar Drizzle para manter esse comportamento.

Execute os comandos a partir de `backend`, com `.env` configurado:

```powershell
npm.cmd run db:generate
npm.cmd run db:check
```

- `db:generate`: gera SQL versionado a partir das diferenças do schema; não
  conecta nem altera o banco.
- `db:check`: verifica consistência/hashes do histórico de migrações; não
  aplica alterações.
- `db:migrate`: é a única rotina preparada para aplicar migrações. Ela exige
  terminal interativo e confirmação digitada do banco, host e porta, por
  exemplo `APLICAR informe67@127.0.0.1:5433`. Se a confirmação não for exata,
  ou se não houver terminal interativo, cancela antes de abrir conexão.

`db:generate` cria novas migrações quando o schema mudar. Ele gera arquivos
locais e não aplica alterações ao banco.

A configuração do Drizzle rejeita qualquer `PGDATABASE` diferente de
`informe67`. Não use `drizzle-kit push`, `drizzle-kit drop`, `db:push` nem
sincronização direta de schema; eles não fazem parte dos scripts do projeto.
Use somente migrações revisadas e versionadas. Antes de qualquer operação,
confira que host, porta e nome exibidos correspondem ao destino esperado.

Migrações destrutivas (por exemplo, `DROP`, remoção/renomeação de colunas ou
perda de dados) não devem ser aplicadas sem mostrar o SQL exato e obter
autorização específica. A confirmação padrão de `db:migrate` não substitui essa
autorização.

### Backup e restauração

Antes de uma migração estrutural, confirme que há espaço seguro para o arquivo
e que o backup foi concluído. Com o túnel ativo, no PowerShell, a partir de
`backend`:

```powershell
npm.cmd run db:preflight
```

Esse comando confirma que a conexão está exatamente no banco `informe67`, com
`informe67_user` e schema atual `public`, consulta versão, `gen_random_uuid()`,
permissões e tabelas em transação somente de leitura, e tenta criar/validar um
dump custom-format exclusivo de `informe67` em `backups/`. Ele requer
`pg_dump` e `pg_restore` instalados e disponíveis no `PATH`; não imprime a
senha nem repassa credenciais como argumentos de linha de comando. Se essas
ferramentas não estiverem disponíveis, o script informa que não fez o backup.

No Windows, uma alternativa sem instalar outro servidor é baixar o ZIP de
[binários PostgreSQL da EDB](https://www.enterprisedb.com/download-postgresql-binaries)
da mesma versão principal do servidor e extrair os clientes e suas DLLs para
`backend/backups/tools/pgsql/bin`. A partir de `backend`, adicione essa pasta
ao PATH apenas da sessão. Se `pg_restore` estiver bloqueado pela política do
Windows, use o formato SQL:

```powershell
$env:PATH = (Join-Path (Get-Location) 'backups/tools/pgsql/bin') + ';' + $env:PATH
npm.cmd run db:preflight -- --plain
```

Com `--plain`, o script exige sucesso do `pg_dump` e verifica o cabeçalho e o
marcador de conclusão no arquivo `.sql`. Essa conferência não testa uma
restauração. O SQL pode ser restaurado com `psql` em um destino de recuperação
autorizado. Os binários e backups ficam em `backups/`, fora do Git.

Procedimento manual equivalente:

```powershell
New-Item -ItemType Directory -Force backups
pg_dump --format=custom --no-owner --host=127.0.0.1 --port=5433 --username=informe67_user --dbname=informe67 --file="backups\informe67-before-migration.dump"
```

O `pg_dump` solicitará a senha se ela não estiver configurada por um mecanismo
local seguro do PostgreSQL. Não coloque a senha no comando, no histórico do
terminal nem em variável versionada. Confira o código de saída e valide o
arquivo com `pg_restore --list "backups\informe67-before-migration.dump"`.
Mantenha backups fora do GitHub, restrinja o acesso e armazene uma cópia segura
separada do computador de desenvolvimento.

Restaurar com `--clean` remove objetos existentes. O comando abaixo é somente
para recuperação aprovada, após confirmar backup e destino; **não o execute**
sem autorização específica para substituir objetos no banco central:

```powershell
pg_restore --clean --if-exists --no-owner --host=127.0.0.1 --port=5433 --username=informe67_user --dbname=informe67 "backups\informe67-before-migration.dump"
```

`pg_restore` solicitará a senha quando necessário. Para testar uma restauração,
prefira um PostgreSQL local isolado e nunca aponte o teste para a VPS.

## Desenvolvimento e verificações

### Painel administrativo — primeira etapa

O Fastify serve o painel isolado em `/admin/`, sem modificar o site público.
Execute `npm.cmd run dev` e abra `http://localhost:3000/admin/`. A origem do
navegador deve corresponder exatamente a `ADMIN_ORIGIN` (padrão local:
`http://localhost:3000`). Em produção, configure `ADMIN_ORIGIN=https://SEU_HOST`
e sirva painel e API na mesma origem, por HTTPS. O Dockerfile inclui os arquivos
de `public/admin`; nenhuma migração adicional é necessária.

Não há usuário, senha padrão ou cadastro público. Para cadastrar **o primeiro
administrador** em `informe67`, a partir de `backend`, execute no seu terminal:

```powershell
npm.cmd run admin:create
```

O comando solicita e-mail, nome e senha de pelo menos 12 caracteres com entrada
oculta e confirmação. Valida o banco, recusa cadastro se já houver usuários e
grava usuário, função, permissões e auditoria em uma única transação. Não passe
senhas pela linha de comando. O comando não é executado ao iniciar a API.

Senhas usam scrypt com salt aleatório. As sessões usam identificadores
aleatórios, cookies HttpOnly/SameSite=Strict e Secure em produção, vencem em
oito horas e são revogadas no logout. As permissões e o estado da conta são
consultados a cada requisição; desativação, remoção de `admin.access` ou troca
de senha invalidam o acesso. Login tem limite de cinco tentativas por IP a
cada 15 minutos; login exige origem exata e logout também exige token CSRF.
Não habilite `trustProxy` indiscriminadamente: sem configuração explícita, o
limite usa o IP da conexão (compartilhado se houver proxy).

Esta etapa opera com **uma instância** da API: sessões e limites de tentativas
ficam em memória e são reiniciados junto com o processo. Antes de escalar para
várias instâncias, use um armazenamento compartilhado de sessões e limites.

O acesso exige `admin.access`. Cada módulo exige sua permissão `.read`:
`news.read`, `categories.read`, `images.read`, `banners.read`, `users.read` e
`settings.read`. O dashboard apresenta somente contadores autorizados; as
listagens exibem até 50 registros e nunca retornam hashes de senha. Em
Configurações são exibidos somente chave, descrição e data, sem valores que
possam conter segredos. Login e logout alimentam `audit_logs`.

Gestão de contas, troca e recuperação de senha serão implementadas nas próximas
etapas. O módulo de Notícias está descrito abaixo.

### Banners do site

O menu **Banners** permite cadastrar e editar nome, descrição acessível, imagem,
link do anúncio, estado, prioridade e período de exibição. Use **Acima do hero**
e marque **Exibir também no meio das matérias** para reutilizar o mesmo anúncio
nos dois locais. Também é possível configurar um anúncio apenas no texto.
Somente banners ativos dentro do período aparecem; a menor prioridade numérica
vence quando há mais de um elegível. Pausados, arquivados e rascunhos ficam ocultos.

GIFs animados são decodificados e regravados preservando quadros e tempos;
também são aceitos JPEG, PNG e WebP estáticos. Limites: 5 MB, 40 megapixels e
200 quadros para GIF. Os arquivos ficam em `uploads/banners`, no mesmo volume
persistente `/app/uploads` usado pelas imagens do portal. `BANNER_UPLOAD_DIR`
pode definir outro diretório persistente. O link aceita HTTP/HTTPS ou caminho
local, e abre em nova aba com `noopener noreferrer sponsored`.

O anúncio atual foi cadastrado como **Banner principal**, ativo no hero e no
texto. Seu link inicial é `/`; configure o endereço do anunciante no painel.
Apesar do nome `banner-mensal.gif`, o arquivo original é um PNG estático;
GIFs animados enviados pelo painel preservam a animação. Os vínculos de posição
adicional usam `portal_settings`, sem criar tabelas ou migrações. A configuração
exige `banners.read` e `banners.manage`, origem exata e token CSRF. Atualize a
página pública após salvar para ver a nova configuração.

`node --import tsx scripts/banner-setup.ts` instala a permissão de gerenciamento
na função `administrator` e cadastra o anúncio inicial apenas se não houver
banners. O endpoint público `GET /api/banners` fornece os anúncios elegíveis.

No menu **Categorias**, o botão **Editar** permite alterar o nome; o slug é
gerado automaticamente no formulário e recalculado no backend, sem alterar os
vínculos das matérias. A operação exige `categories.edit` e rejeita slugs
duplicados. O administrador pode também excluir uma categoria vazia ou
escolher uma categoria ativa de destino para transferir todas as matérias antes
de excluir a origem. A operação é transacional e inclui publicadas, rascunhos,
agendadas e arquivadas, preservando conteúdo e estado editorial. Exige
`categories.delete` e, quando há matérias, `categories.transfer`, além de
`categories.read`, origem exata e token CSRF. A exclusão é registrada na
auditoria. Categorias com subcategorias devem ser reorganizadas antes da
exclusão. As permissões podem ser instaladas com
`node --import tsx scripts/category-permissions.ts` na pasta `backend`.

O menu Notícias oferece busca por título, filtro editorial, paginação e edição
com Quill servido localmente. Cada matéria tem título, slug único, resumo,
categoria, tags, campos SEO, capa e imagens com descrição, legenda e créditos.
O autor vem da sessão autenticada e não pode ser alterado pelo formulário.

Use **Salvar alterações** para manter o estado atual, **Salvar como rascunho**,
**Publicar agora**, **Agendar publicação** ou **Arquivar matéria**. Rascunhos
com título e slug válidos são salvos automaticamente a cada 45 segundos se
houver alterações; essa opção pode ser desativada. A saída do editor alerta
sobre alterações pendentes. Edições concorrentes retornam conflito, sem
sobrescrever a versão mais recente.

HTML é sanitizado no servidor, removendo scripts, eventos, iframes, estilos
arbitrários e imagens externas. As imagens devem ser enviadas pelo painel;
JPEG, PNG e WebP até 5 MB e 40 megapixels são decodificados e convertidos para
WebP com no máximo 2000 pixels por lado, sem os metadados originais. SVG e
imagens animadas são recusados. Uploads ficam em `backend/uploads/news`;
referências ficam em `news_images`. Uploads ainda não associados a uma matéria
permanecem no disco; nenhuma limpeza automática remove arquivos editoriais.

Em produção, configure um **volume persistente em `/app/uploads`** no EasyPanel
e inclua os arquivos de imagem no backup, junto com o PostgreSQL. Opcionalmente,
`NEWS_UPLOAD_DIR` define outro diretório absoluto persistente. Os arquivos de
imagem são acessíveis pela URL pública `/media/news/ARQUIVO.webp`, inclusive
antes de a matéria ser publicada; o texto do rascunho permanece privado.

Além de `news.read`, as operações exigem `news.create`, `news.edit`,
`news.publish`, `news.archive`, `news.feature` e `news.upload`. Alterar uma
matéria já publicada/agendada também exige `news.publish`. Arquivar ou
restaurar uma matéria arquivada exige `news.archive`. Todas as escritas exigem
origem exata e token CSRF; conteúdo, tags, referências de imagens e auditoria
são gravados na mesma transação. Não há exclusão definitiva de matérias.

As novas permissões da função `administrator` podem ser instaladas de forma
idempotente com `npm.cmd run news:permissions`. Elas já foram instaladas no
`informe67` deste ambiente. Recarregue o painel para atualizar os botões da
sessão. Nenhuma tabela ou migração adicional foi criada.

Ao iniciar a API, o publicador processa agendamentos vencidos e repete a cada
30 segundos. É necessário manter o backend em execução; após uma parada, as
publicações pendentes são processadas na próxima inicialização. Horários são
armazenados com fuso; o formulário usa o horário local do computador.

`GET /api/news` retorna somente matérias publicadas, com suas categorias e
capas. Use `GET /api/news?featured=true` para obter os destaques ordenados e
`GET /api/news/SLUG` para ler uma matéria pública. Rascunhos, agendadas e
arquivadas não são retornados pelo endpoint de leitura pública.

O newsgrid, o destaque e a página `noticia.html?slug=SLUG` agora consomem a API
mantendo o layout existente. Notícias demonstrativas do grid são substituídas
pelas publicadas; falhas de conexão geram uma mensagem visível. Localmente,
sirva o frontend por HTTP (por exemplo, Live Server); ele usa a API em
`http://127.0.0.1:3000`. Prévia por arquivo local também é aceita nas rotas
públicas em desenvolvimento, sem cookies. Falhas temporárias são repetidas
automaticamente até três vezes; o site oferece **Tentar novamente** e também
repete a carga ao selecionar uma categoria após erro. Erro de conexão não é
apresentado como uma lista vazia. Em produção, se os serviços tiverem origens distintas,
preencha a meta tag `informe67-api` em `index.html` e `noticia.html` com a URL
pública da API e configure `PUBLIC_SITE_ORIGIN` no backend com a origem exata
do site. Origem igual funciona com a meta tag vazia. CORS fica restrito às
rotas públicas de leitura, sem credenciais; o painel mantém a mesma origem.

As seis categorias já presentes no menu público foram cadastradas no banco:
Campo Grande, Mato Grosso do Sul, Brasil, Mundo, Esporte e Cultura. O comando
`npm.cmd run categories:seed` é idempotente e não substitui categorias
existentes. Matérias publicadas anteriormente sem categoria podem ser editadas
para escolher uma delas. Publicações mostram confirmação junto ao botão e um
aviso visível na tela, sem precisar sair do editor.

O superadministrador cadastra contas em **Usuários → Novo usuário**, escolhendo
Administrador, Editor ou Leitor e uma senha com pelo menos 12 caracteres.
O Editor cria e edita rascunhos, sem publicar; o Leitor apenas consulta o painel.
Somente o superadministrador pode cadastrar usuários. O backend valida o perfil,
protege a operação com sessão/CSRF, rejeita e-mails duplicados sem diferenciar
maiúsculas e salva apenas o hash scrypt da senha. O cadastro é auditado sem senha.

Para atribuir o perfil a uma conta existente, apenas com autorização explícita:
`npx.cmd tsx scripts/setup-superadmin.ts email-da-conta`. O script se limita ao
banco `informe67`, prepara os perfis e preserva a senha existente.

Com `RUN_DB_TESTS=1`, os testes do ciclo editorial e do cadastro de usuários usam
transações externas sempre revertidas e savepoints, sem deixar dados de teste
no banco. Testes comuns usam contas simuladas e não requerem PostgreSQL.

Os testes de autenticação usam contas simuladas, sem alterar PostgreSQL. Para
incluir as consultas ao banco e o ciclo editorial com rollback:

```powershell
$env:RUN_DB_TESTS = '1'
npm.cmd test
Remove-Item Env:RUN_DB_TESTS
```

```powershell
npm.cmd run dev
npm.cmd test
npm.cmd run build
```

`/api/health` verifica apenas a API. `/api/health/db` verifica conectividade
sem revelar detalhes do banco. Essa verificação não modifica o schema.

## Reescrita com IA

Em **Configurações**, o superadministrador escolhe Groq, Gemini ou Claude, informa o
identificador do modelo disponível na sua conta e sua chave de API. A chave é
criptografada com AES-256-GCM; a API retorna apenas `hasKey`. Orientações e tamanho
máximo da fonte (1.000–60.000 caracteres) são configuráveis. Não há limite interno
de tentativas ou de reescritas diárias. O teste de conexão chama o provedor e pode
consumir saldo. Os limites de uso do próprio provedor continuam aplicáveis.

Groq é a opção inicial para novas configurações, com o modelo sugerido
`openai/gpt-oss-120b`. Informe sua própria chave Groq no painel e salve antes
de testar. Configurações existentes de outros provedores são preservadas.
O adaptador usa JSON Object Mode, no máximo 4.096 tokens de saída e registra os
tokens de entrada e saída informados pela API. Os limites do plano gratuito
continuam sendo aplicados pela Groq: erros 429 orientam a aguardar e erros 413
orientam a reduzir a fonte. Não há repetição automática nem troca de provedor.
Modelos com identificador composto, como `familia/modelo`, são aceitos na Groq.

Em **Notícias → Reescrita com IA**, cole o link, confira o texto e a imagem
recuperados, escolha uma categoria e gere o rascunho. Uma popup acompanha a geração
e exibe a matéria reescrita, com capa, categoria, texto formatado e créditos. A
prévia usa o CSS e as fontes da página pública de matérias, em um iframe sem scripts.
Os botões **Publicar agora**, **Agendar publicação** e **Reescrever novamente**
operam sobre esse mesmo rascunho. A publicação reutiliza as validações e permissões
do módulo de Notícias. A regeneração atualiza o mesmo rascunho, conserva suas
imagens e usa a versão anterior para solicitar uma nova redação. Publicações e
agendamentos existentes não são sobrescritos pela regeneração. Caso
a extração direta seja bloqueada ou incompleta, o servidor tenta um leitor
alternativo que valida a URL da matéria antes de aceitar o conteúdo. Se as duas
tentativas falharem, use **Colar texto manualmente**. Fontes acima do limite ficam
disponíveis para edição com a contagem exata de caracteres e não chamam a IA até
serem reduzidas. Campos editoriais longos devolvidos pela IA (resumo, títulos e
descrição SEO) são reduzidos com segurança sem descartar o conteúdo principal. Imagens
JPEG, PNG e WebP de até 5 MB são baixadas, validadas e salvas no armazenamento
local; imagens ausentes não impedem o salvamento do texto. A recuperação de uma
imagem pode ser repetida sem chamar a IA novamente; capas adicionadas pelo editor
não são substituídas por essa recuperação.

O processamento continua ao sair da tela e pode ser acompanhado pelo histórico.
Os registros persistem em `portal_settings` com prefixos `rewrite.job.*`,
`rewrite.source.*` e `rewrite.news.*`, sem nova migração ou alteração do frontend
público. O worker é ativado no servidor junto ao scheduler editorial. Uma tarefa
interrompida é liberada para tentativa manual após dez minutos; não há repetição
automática de chamadas pagas. Resultados já persistidos são reutilizados ao
repetir o salvamento. URLs normalizadas e redirecionamentos ajudam a identificar
duplicações; outra matéria exige uma ação explícita. Reescritas sucessivas do
rascunho não criam notícias duplicadas. O campo legado `dailyLimit` permanece
compatível com configurações antigas, mas não restringe a geração. O backend
rejeita respostas iguais ou com alta repetição de trechos do original; em caso
de falha não substitui a reescrita pela matéria original nem publica conteúdo.

Origem, autor e data original ficam na procedência; a nova notícia recebe a data
de publicação do Informe67. Créditos com link são montados pelo backend e
restaurados em todos os salvamentos. A URL original não substitui a URL canônica
da nova publicação. O operador precisa conferir fatos e datas antes de publicar.
Créditos fotográficos encontrados são preservados; a indicação da fonte da imagem
não equivale a atribuir sua autoria nem a obter autorização de reprodução.

Na implantação, a chave local de criptografia fica em
`/app/uploads/.private/ai.key`, dentro do mesmo volume persistente das imagens.
Como alternativa, configure `AI_ENCRYPTION_KEY` como segredo de 64 caracteres
hexadecimais ou use `AI_SECRET_DIR` para outro volume privado persistente. Não
versionar `.private`, `.env` ou chaves de API. Se a chave de criptografia for
perdida, reconfigure a chave do provedor no painel.

Os adaptadores usam as APIs oficiais de
[Groq](https://console.groq.com/docs/api-reference),
[Gemini](https://ai.google.dev/api/generate-content) e
[Claude](https://platform.claude.com/docs/en/api/messages/create).
A extração usa [Mozilla Readability](https://github.com/mozilla/readability),
com scripts e carregamento de recursos desabilitados no parser. Downloads
validam DNS, fixam o endereço da conexão e verificam cada redirecionamento,
rejeitando redes internas, formatos executáveis e respostas acima dos limites.

Testes usam IA simulada, sem custo, e os testes de banco sempre fazem rollback.
Uma chamada real exige configurar a chave e o modelo pelo próprio painel.

## EasyPanel

O serviço único entrega o site público em `/`, a página `noticia.html`, os
arquivos JavaScript/CSS e `assets/`, além de `/admin/`, `/api/` e `/media/`.
Os arquivos públicos da raiz são empacotados em `backend/public/site` pelo
script `scripts/site-assets.mjs` durante `npm run build`. Esse diretório é gerado
e não deve ser versionado. O Fastify serve somente esse pacote; arquivos internos
do backend, `.env`, backups e uploads não são expostos pelo servidor estático.

No serviço existente do EasyPanel, configure:

- **Caminho de Build:** `/` (raiz do repositório), substituindo `/backend`.
- **Método:** Dockerfile; **Dockerfile:** `Dockerfile` da raiz.
- **Porta interna:** `3000`.
- **Comando de inicialização:** mantenha o padrão do Dockerfile (`npm start`).
  Se houver um comando explícito, use `npm start` ou `node dist/server.js`.
- **Build:** o Dockerfile instala e executa `npm run build` em `/build/backend`;
  não é necessário adicionar outro comando de build no EasyPanel.
- **Domínio:** aponte o domínio do portal para esse mesmo serviço/porta.

Depois de salvar o Caminho de Build, faça um novo deploy. O contexto precisa
incluir a raiz: usar `/backend` impediria o Docker de copiar `index.html`,
`noticia.html`, os scripts, `styles.css` e `assets/`. O antigo Dockerfile em
`backend` foi movido para a raiz. O runtime continua em `/app` e usa as mesmas
variáveis e caminhos de armazenamento. Mantenha o volume existente em
`/app/uploads`; o build não copia nem substitui seu conteúdo. A API do frontend
implantado usa `location.origin`, inclusive com HTTPS e domínio personalizado;
o endereço `127.0.0.1:3000` fica restrito à prévia local em arquivo/porta 5500.

Preserve as variáveis/segredos existentes. Configure o host interno
`n8n_postgres` somente se os serviços compartilharem a rede privada. Migrações
devem ser geradas, revisadas, versionadas, respaldadas e aplicadas manualmente
por uma pessoa autorizada; não as inclua no comando de inicialização ou deploy.
