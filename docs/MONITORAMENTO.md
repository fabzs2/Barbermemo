# Monitoramento do Barbermemo

O código está preparado. Alertas só ficam ativos após cadastrar as contas, variáveis e regras abaixo e confirmar um teste de ponta a ponta.

## 1. Sentry

Crie uma conta em https://sentry.io/signup/ e um projeto React chamado `barbermemo`. Se o site oferecer um comando de instalação, não precisa executá-lo: o SDK já foi instalado. Copie o DSN do projeto para `SENTRY_DSN` no arquivo local `.env.monitoring.local`.

Anote o identificador da organização em `SENTRY_ORG` e do projeto em `SENTRY_PROJECT` (os slugs da URL). Crie um token de build do Sentry para upload de source maps e preencha `SENTRY_AUTH_TOKEN`. O token é secreto: não pode ter prefixo VITE_. O upload dos mapas permite ver o arquivo e linha originais do erro. O build usa o Sentry CLI depois que o Vite termina de gravar os arquivos; os mapas são removidos da pasta pública somente após upload bem-sucedido.

## 2. Telegram

No Telegram, abra o bot oficial @BotFather (https://t.me/BotFather), envie `/newbot` e siga a criação. Copie o token para `TELEGRAM_BOT_TOKEN` em `.env.monitoring.local`, sem enviar aqui no chat. Abra seu novo bot, toque em Iniciar e envie uma mensagem.

Na pasta do repositório, execute `npm run monitoring:telegram`. O comando mostra os IDs de conversas privadas, sem mostrar o token. Coloque o seu em `TELEGRAM_CHAT_ID`. Se houver mais de um ID, confirme qual é o seu antes de configurar o destino.

## 3. Ponte Sentry → Telegram

No Sentry, abra Settings → organização → Developer Settings / Custom Integrations → Create New Integration → Internal Integration. Use:

- Nome: Barbermemo Telegram.
- Webhook URL: `https://www.barbermemo.com.br/api/sentry-alert`.
- Ative Alert Rule Action. Não é necessário autorizar leitura de dados de clientes nem instalar integrações públicas.
- Copie o Client Secret dessa integração para `SENTRY_WEBHOOK_SECRET` em `.env.monitoring.local`.

A rota valida a assinatura HMAC do Sentry sobre o corpo original. Não use o token de build nem o DSN como Client Secret.

## 4. Variáveis na Vercel

No projeto Barbermemo → Settings → Environment Variables, configure em Production:

| Variável | Origem | Visibilidade |
| --- | --- | --- |
| VITE_SENTRY_DSN | Mesmo valor de SENTRY_DSN | Pública, enviada ao navegador |
| SENTRY_DSN | DSN do projeto | Servidor |
| SENTRY_ORG | Slug da organização | Build |
| SENTRY_PROJECT | Slug do projeto | Build |
| SENTRY_AUTH_TOKEN | Token de upload de source maps | Secreta, somente build |
| SENTRY_WEBHOOK_SECRET | Client Secret da integração interna | Secreta, servidor |
| TELEGRAM_BOT_TOKEN | Token do BotFather | Secreta, servidor |
| TELEGRAM_CHAT_ID | ID da sua conversa | Servidor |

Mantenha as variáveis existentes do Supabase e Asaas. Se usar Preview, configure DSNs separados ou regras filtradas por ambiente. O ambiente e commit são identificados automaticamente na Vercel. Faça um novo deploy após alterar variáveis.

## 5. Regras de erro no Sentry

Crie regras de Issue Alerts com filtro `environment = production` e ação Send a notification via an integration → Barbermemo Telegram:

1. Nova ocorrência de erro ou erro que reapareceu após ser resolvido: notificar.
2. Mesmo erro mais de 5 vezes em 10 minutos: notificar.
3. Intervalo de repetição: pelo menos 30 minutos por problema, para evitar enxurrada de mensagens.

Mantenha também e-mail como segunda ação: a ponte Telegram depende da própria Vercel e não consegue avisar se toda a hospedagem cair. Os nomes de menus podem variar por plano/versão do Sentry.

## 6. Site e banco fora do ar

Crie uma conta no UptimeRobot (https://uptimerobot.com/) e monitores HTTP separados:

- `https://www.barbermemo.com.br/login`: disponibilidade do site.
- `https://www.barbermemo.com.br/api/health`: Auth e consulta somente de leitura ao banco, HTTP 200 quando ambos respondem.

Se o plano permitir, monitore também a palavra `"status":"ok"` no health. Configure aviso após duas falhas consecutivas e aviso de recuperação, quando disponíveis. Ligue o contato Telegram e associe-o aos dois monitores. Telegram pode exigir plano pago: confira antes de contratar; use e-mail com push no celular enquanto decide.

O health não autentica um usuário, não grava agendamentos, não prova que RLS/permissões estão corretas e não verifica fotos nem pagamentos. Ele consulta a tabela clientes com limite zero usando a chave pública e não retorna registros.

## 7. Deploys

Ative notificações de Deployment failures nas configurações de notificações da Vercel. Configure o aplicativo de e-mail do celular para avisar. Falha de publicação não deve depender do código da versão que falhou.

## 8. Validar antes de confiar

1. `npm run test:monitoring` — testes locais sem clientes reais nem notificações externas.
2. `npm run monitoring:check` — após deploy, login deve retornar 200 e `/api/health` deve retornar JSON com `status: ok`.
3. `npm run monitoring:test` — envia um evento artificial ao Sentry usando o DSN local. Confira que o evento apareceu no painel e chegou ao Telegram com operação `monitoring.test`. Configure as regras antes de executar.
4. Confira que a versão publicada fez upload dos source maps e que um erro mostra o arquivo original.
5. Use o botão de teste do monitor externo e confirme no celular; depois confirme também aviso de recuperação.
6. Não provoque falhas reais em produção nem crie cobranças para testar.

O envio Sentry → Telegram acontece em background com duas tentativas. Se ambas falharem, os logs da Vercel registram `monitoring.telegram_delivery_failed`; não há fila persistente nem garantia de entrega. Por isso mantenha e-mail como alternativa e o monitor externo independente.

## Cobertura e privacidade

Captura falhas não tratadas do React e do JavaScript, falhas lançadas pelos métodos de `db`, respostas 5xx e falhas parciais das APIs Asaas. Erros esperados de senha incorreta não são enviados pela camada de operações. Falhas silenciosas que retornem sucesso, autenticação feita diretamente fora de db e fluxos de negócio exigem validações adicionais.

Eventos têm operação, rota sem identificadores UUID, ambiente e versão. Não habilitamos gravação de sessão, rastreamento de cliques, payloads, fotos ou dados de usuário. Dados de requisição e breadcrumbs são descartados e mensagens são sanitizadas. O Telegram recebe um resumo técnico e link do Sentry, sem mensagem bruta de erro. Revise periodicamente eventos reais para confirmar a filtragem.

Referências oficiais:
- https://docs.sentry.io/platforms/javascript/guides/react/
- https://docs.sentry.io/platforms/javascript/guides/react/sourcemaps/uploading/vite/
- https://docs.sentry.io/integrations/integration-platform/webhooks/
- https://docs.sentry.io/integrations/integration-platform/webhooks/issue-alerts/
- https://vercel.com/docs/notifications
- https://uptimerobot.com/integrations/telegram-integration/
