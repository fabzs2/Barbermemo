# Cobrança, e-mail e recuperação

O painel `/admin` mostra os estados operacionais e permite criar backup ou testar restauração. Somente super admins com sessão validada podem executar essas ações. Falhas inesperadas passam pelo monitoramento Sentry/Telegram existente.

## Asaas

Webhook: `https://www.barbermemo.com.br/api/asaas-webhook`. A autenticação exige `asaas-access-token`, validado contra `ASAAS_WEBHOOK_TOKEN`. O cadastro do webhook é feito pela ação `setup_webhook` da API de operações, que altera somente o registro com essa URL exata. Eventos repetidos são deduplicados, eventos fora de ordem consultam o recurso atual e snapshots antigos não sobrescrevem observações novas. Dados pessoais do pagador não são armazenados no histórico de eventos.

Uma ativação pode receber eventos antes de salvar o vínculo: a API retorna 503 nesse intervalo para o Asaas tentar novamente. O botão de sincronização permite recuperar o estado das cobranças. Atraso não suspende automaticamente o cliente. Pausa, cancelamento e mudança de plano têm consequências distintas explicadas no painel.

## E-mail

Supabase Auth usa Resend por SMTP: `smtp.resend.com`, porta 465, usuário `resend`, remetente `Barbermemo <acesso@barbermemo.com.br>`. A senha SMTP é a chave do Resend. O domínio está verificado no provedor. Configuração SMTP, templates e URLs de retorno são mantidos no Supabase, fora das migrações do banco. O template de recuperação precisa usar `{{ .ConfirmationURL }}`.

A prova de entrega consulta o evento `delivered` no Resend para a conta do responsável. Aceitação de uma chamada ao Auth, sozinha, não comprova entrega. O teste não troca a senha. O conteúdo padrão do e-mail de recuperação ainda depende do template configurado no Auth.

## Backups

Um Cron de produção executa diariamente às 08:00 UTC (05:00 em Santarém). Ele exige `Authorization: Bearer CRON_SECRET`. A função usa TLS validado para ler o banco em uma transação consistente. Inclui estrutura e dados das tabelas de aplicação `public`/`private`, usuários e identidades do Auth, funções, índices, constraints, gatilhos, políticas/permissões e as fotos do bucket privado `barbermemo-photos`.

Cada arquivo é comprimido e criptografado com AES-256-GCM e IV aleatório, então enviado ao Vercel Blob privado `barbermemo-private-backups`, prefixo `barbermemo-backups/v1/`. O arquivo é baixado novamente, autenticado, descriptografado e conferido antes de registrar sucesso. As 14 cópias mais recentes são mantidas; somente arquivos desse prefixo podem ser removidos. Uma trava no banco impede execuções concorrentes.

Na primeira execução, semanalmente ou ao clicar **Testar restauração isolada**, o sistema recria o banco em Postgres embarcado, compara todas as linhas por hash e testa bloqueio de leitura anônima. As fotos são copiadas para um bucket privado temporário, baixadas e conferidas por hash. O bucket temporário é removido ao terminar. Nenhum dado original é sobrescrito.

Guarde uma cópia de `BACKUP_ENCRYPTION_KEY` em um gerenciador de senhas fora da Vercel e do computador. A chave foi salva no arquivo local ignorado `.env.operations.local` e no ambiente Production da Vercel. Sem ela os arquivos não podem ser recuperados. Não envie a chave por chat nem a inclua no Git. A chave não deve ser rotacionada sem preservar a antiga para backups anteriores.

Limites atuais: 40 MiB de fotos e 64 MiB de conteúdo total antes da compactação. Uma ultrapassagem falha com alerta, preservando cópias anteriores; amplie a estratégia antes de atingir esse volume. A cópia está no mesmo fornecedor de hospedagem, em um armazenamento privado separado; uma segunda cópia externa é recomendada para independência do fornecedor.

## Em caso de recuperação

1. Preserve o arquivo `.bmbk` e a chave correspondente. Use `decryptBackup` de `api/_lib/backupCrypto.js` e `verifyDatabaseRestore` de `api/_lib/restoreCheck.js` para conferir a cópia em ambiente isolado antes de qualquer recuperação.
2. Provisione um Supabase separado, compatível com a versão de origem. Use as migrações do repositório para recriar o app; restaure usuários/identidades antes das tabelas dependentes e dados antes dos gatilhos. Os helpers `restorationSql`/`restoreRows` contêm a estrutura e a carga utilizadas no teste. Uma restauração real precisa ser executada por alguém com acesso administrativo, em banco vazio, com constraints/gatilhos e permissões cuidadosamente conferidos. Não execute esses helpers sobre produção preenchida.
3. Recrie o bucket privado e envie cada foto com seu nome original e MIME type. Compare hashes antes de trocar a conexão do aplicativo.
4. Reconfigure URLs/SMTP/templates do Auth, secrets, webhooks Asaas/Sentry, Cron, DNS e variáveis Vercel. Eles não fazem parte do banco. Sessões, logs internos, configurações da plataforma e objetos fora do bucket do app não estão incluídos. As assinaturas continuam no Asaas e seus IDs ficam preservados no backup.
5. Verifique login, recuperação, RLS entre duas barbearias, fotos, agendamento e sincronização financeira antes de apontar a aplicação ao ambiente restaurado. Usuários precisarão entrar novamente.

O teste automatizado comprova a restauração isolada do conteúdo coberto; não substitui um exercício de recuperação de toda a infraestrutura.

## Verificação em produção — 15/11/2026

Entrega de recuperação confirmada como `delivered` no Resend, remetente `acesso@barbermemo.com.br`. Webhook do Asaas cadastrado e autenticação da rota testada (401 sem token e 200 para evento irrelevante autenticado). Backup privado de 844.580 bytes autenticado e restaurado: 18 tabelas, 59 linhas e 9 fotos, todas conferidas. Buckets temporários e contas de teste removidos; nenhuma cobrança, troca ou cancelamento real foi executado nos testes financeiros. Migrações, RLS e fluxo financeiro foram verificados com banco/Auth reais e transporte Asaas simulado.
