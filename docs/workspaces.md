# Administração de contas

- `/admin`: super admin. Gerencia as barbearias, plano individual ou barbearia, total de acessos, conta titular e status de acesso.
- `/barbearia`: dono. Cria barbeiros na própria barbearia, pausa/reativa membros e acompanha totais. O botão Meu atendimento abre sua agenda e seus clientes.
- `/dashboard`: profissional. Acessa seus próprios clientes, fichas, agenda e configurações.

O cadastro começa como **Piloto**, sem integrar nem cobrar pelo Asaas. Ativo e Pausado são estados de acesso ao aplicativo; não criam, cancelam nem modificam assinaturas no Asaas. Cobrança continua manual/separada. Equipe nunca é cobrada individualmente por esta API. Endpoints Asaas exigem super admin e aceitam somente o titular de uma barbearia com status Ativo.

O limite inclui o titular. Individual tem um acesso. Barbearia começa com cinco acessos, ajustáveis pelo super admin entre um e cem. Para reduzir, pause membros antes. Pausar preserva os dados e bloqueia consultas e alterações mesmo com JWT existente. Contas do titular são pausadas através do status da barbearia.

Na criação, defina uma senha de pelo menos dez caracteres e repasse as credenciais ao profissional em canal privado. A senha é tratada apenas pelo Supabase Auth, nunca armazenada no perfil. O profissional pode trocar em Configurações ou recuperar por Esqueci minha senha. Nenhum e-mail é enviado automaticamente pelo cadastro administrativo. Para e-mails de recuperação, mantenha os domínios e a URL `/redefinir-senha` autorizados no Supabase Auth.

## Implantação e verificação

`npm test` executa testes da API e a migração real sobre Postgres embarcado (PGlite), incluindo isolamento entre profissionais/barbearias, bloqueio de elevação de privilégios e escrita cruzada, lotação/reservas, agendamento público e proteção de fotos. `npm run build` testa, compila, envia source maps e só então aplica a migração no build de produção.

O build usa `POSTGRES_URL_NON_POOLING` ou `POSTGRES_URL`, com TLS e CA oficial Supabase. Migração e verificações contra o banco real rodam em uma transação com trava de migração. Fixtures usam savepoint e são desfeitas. Uma falha desfaz tudo e impede publicar. O registro em `private.schema_migrations` impede reaplicar a versão. Para validar sem persistir, defina `TENANCY_MIGRATION_DRY_RUN=1`; essa opção é somente para diagnóstico e não deve ser usada para publicar a interface nova sobre um banco antigo.

Os dois profissionais legados recebem vínculos independentes; nomes iguais nunca vinculam pessoas. Clientes, fichas, agendamentos, fotos e contas Auth são preservados. A única conta legada com role admin é convertida para super_admin; a migração aborta se houver ambiguidade. Definições anteriores de funções/políticas e roles legadas ficam em `private.schema_backups`.

A chave `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_SECRET_KEY`) é exclusivamente de servidor, nunca `VITE_*`. A API valida a sessão no Supabase Auth e busca a permissão atual no perfil. Reservas bloqueiam o registro da barbearia para impedir que convites simultâneos ultrapassem o limite. Se o provisionamento falhar, remove apenas a conta Auth recém-criada e ainda inativa; uma resposta de rede ambígua nunca apaga um perfil já ativado. Reservas restantes expiram em dez minutos. Falhas inesperadas aparecem no Sentry sem senha ou conteúdo de clientes.

A migração fecha as políticas públicas antigas. Agendamento público usa projeções RPC mínimas. Acompanhamento exige token aleatório próprio; o ID público do agendamento não concede esse acesso. Fotos ficam em bucket privado, com URLs assinadas por uma hora; URLs públicas antigas são convertidas ao carregar a ficha.

Depois que a migração for aplicada, evite rollback para versões antigas da interface: elas dependiam do modelo e das políticas anteriores. Prefira correções que mantenham o isolamento. Não reabra políticas públicas para resolver incompatibilidades.
