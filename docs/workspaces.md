# Administração de contas

- `/admin`: super admin. Gerencia as barbearias, plano individual ou barbearia, total de acessos, conta titular e status de acesso.
- `/barbearia`: dono. Cria barbeiros na própria barbearia, pausa/reativa membros e acompanha totais. O botão Meu atendimento abre sua agenda e seus clientes.
- `/dashboard`: profissional. Acessa seus próprios clientes, fichas, agenda e configurações.

O cadastro começa como **Piloto**, sem criar cliente nem assinatura no Asaas. O formulário do titular oferece CPF/CNPJ e telefone; o documento é opcional no piloto e obrigatório para a ativação paga. Membros da equipe não informam documento de cobrança e não têm assinatura própria.

**Ativar e gerar assinatura** exige confirmação do super admin e primeiro vencimento. Os preços aprovados são R$ 59,90/mês no Individual e R$ 189,99/mês no Barbearia. O servidor fixa esses valores; o navegador não pode alterá-los. A assinatura usa `PIX` com ciclo `MONTHLY`: o Asaas gera as cobranças e o cliente paga cada Pix. Não se trata de autorização de débito por Pix Automático.

O acesso só muda para **Ativo** depois que a assinatura é confirmada no Asaas e seu vínculo é salvo no banco. Ativo não significa pagamento recebido. O painel apresenta cobranças, vencimentos, pagamentos recebidos e atrasos, atualizados por webhook autenticado. **Sincronizar cobranças** consulta o estado atual no Asaas. O sistema não suspende automaticamente por atraso: uma política de carência deve ser definida antes de automatizar esse bloqueio.

**Pausar** bloqueia o acesso ao aplicativo e preserva os dados, mas mantém a cobrança. **Cancelar assinatura**, exclusivo do super admin e confirmado digitando CANCELAR, exclui a recorrência no Asaas e suas cobranças pendentes/vencidas, depois pausa o acesso. Pagamentos recebidos permanecem no histórico e não são estornados. Para voltar após cancelamento, confirme explicitamente uma nova assinatura e seu vencimento; o histórico anterior é preservado. Uma assinatura existente não pode voltar a Piloto pelo seletor.

**Editar plano** altera a assinatura existente, com confirmação do preço mensal. O novo preço vale apenas para cobranças geradas depois da mudança (`updatePendingPayments:false`); Pix já emitidos mantêm seu valor. Reduza os acessos ativos antes de diminuir o limite. Operações financeiras usam reservas exclusivas; em resposta incerta, **Conferir alteração** consulta o Asaas antes de repetir. Não crie outra assinatura para resolver uma resposta incerta.

O registro `barbearia_cobrancas` é protegido por RLS e escrito apenas pelo servidor. A API retorna os dados do titular apenas ao super admin. Uma reserva por barbearia impede ativações concorrentes. As tentativas e os IDs do Asaas são persistidos antes e após cada POST. Uma resposta incerta não é tratada como ausência de cobrança: Conferir ativação busca o recurso pela referência estável e só o reutiliza. Se o Asaas ainda não o mostrar, uma nova criação permanece bloqueada para evitar duplicidade. Uma rejeição de validação confirmada permite corrigir os dados e tentar de novo.

O limite inclui o titular. Individual tem um acesso. Barbearia começa com cinco acessos, ajustáveis pelo super admin entre um e cem. Para reduzir, pause membros antes. Pausar preserva os dados e bloqueia consultas e alterações mesmo com JWT existente. Contas do titular são pausadas através do status da barbearia.

Na criação, defina uma senha de pelo menos dez caracteres e repasse as credenciais ao profissional em canal privado. A senha é tratada apenas pelo Supabase Auth, nunca armazenada no perfil. O profissional pode trocar em Configurações ou recuperar por Esqueci minha senha. Nenhum e-mail é enviado automaticamente pelo cadastro administrativo. Para e-mails de recuperação, mantenha os domínios e a URL `/redefinir-senha` autorizados no Supabase Auth.

## Implantação e verificação

`npm test` executa testes da API e a migração real sobre Postgres embarcado (PGlite), incluindo isolamento entre profissionais/barbearias, bloqueio de elevação de privilégios e escrita cruzada, lotação/reservas, agendamento público e proteção de fotos. `npm run build` testa, compila, envia source maps e só então aplica a migração no build de produção.

O teste `verify-billing-flow.mjs` exercita cadastro, ativação, eventos repetidos de pagamento, mudança de plano e cancelamento, incluindo respostas perdidas e reconciliação, com Auth/PostgREST/banco reais e contas temporárias. O transporte para o Asaas é simulado em memória, evitando cobranças ou cancelamentos reais. A migração também verifica isolamento financeiro, ordenação de eventos e travas em uma transação revertida.

O build consulta o Asaas para validar a credencial e informar se é produção ou sandbox; não emite cobranças. Em sandbox, o painel avisa que a assinatura é de teste.

O build usa `POSTGRES_URL_NON_POOLING` ou `POSTGRES_URL`, com TLS e CA oficial Supabase. Migração e verificações contra o banco real rodam em uma transação com trava de migração. Fixtures usam savepoint e são desfeitas. Uma falha desfaz tudo e impede publicar. O registro em `private.schema_migrations` impede reaplicar a versão. Para validar sem persistir, defina `TENANCY_MIGRATION_DRY_RUN=1`; essa opção é somente para diagnóstico e não deve ser usada para publicar a interface nova sobre um banco antigo.

Na primeira implantação após a migração, `verify-provisioning.mjs` faz um smoke test da API publicada, Supabase Auth e PostgREST com contas temporárias de domínio inválido e senha aleatória. Testa titular individual, dono, membro, limite, isolamento e suspensão com JWT existente. As contas e os registros são removidos ao terminar; não altera credenciais de contas reais. A verificação é registrada para não repetir em builds normais.

Os dois profissionais legados recebem vínculos independentes; nomes iguais nunca vinculam pessoas. Clientes, fichas, agendamentos, fotos e contas Auth são preservados. A única conta legada com role admin é convertida para super_admin; a migração aborta se houver ambiguidade. Definições anteriores de funções/políticas e roles legadas ficam em `private.schema_backups`.

A chave `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_SECRET_KEY`) é exclusivamente de servidor, nunca `VITE_*`. A API valida a sessão no Supabase Auth e busca a permissão atual no perfil. Reservas bloqueiam o registro da barbearia para impedir que convites simultâneos ultrapassem o limite. Se o provisionamento falhar, remove apenas a conta Auth recém-criada e ainda inativa; uma resposta de rede ambígua nunca apaga um perfil já ativado. Reservas restantes expiram em dez minutos. Falhas inesperadas aparecem no Sentry sem senha ou conteúdo de clientes.

A migração fecha as políticas públicas antigas. Agendamento público usa projeções RPC mínimas. Acompanhamento exige token aleatório próprio; o ID público do agendamento não concede esse acesso. Fotos ficam em bucket privado, com URLs assinadas por uma hora; URLs públicas antigas são convertidas ao carregar a ficha.

Depois que a migração for aplicada, evite rollback para versões antigas da interface: elas dependiam do modelo e das políticas anteriores. Prefira correções que mantenham o isolamento. Não reabra políticas públicas para resolver incompatibilidades.

## Recuperação de senha no domínio público

O cliente usa `https://www.barbermemo.com.br/redefinir-senha` para todos os pedidos, inclusive quando o login é aberto em um endereço de deployment. O Supabase precisa permitir esse endereço em **Authentication → URL Configuration → Redirect URLs**. Configure também **Site URL** como `https://www.barbermemo.com.br`. No template **Reset password**, o link deve usar `{{ .ConfirmationURL }}`, sem URL fixa de deployment. Esses valores são configurações do serviço Auth, não do banco PostgreSQL.

O build de produção verifica a URL de retorno efetiva do GoTrue e o uso de um token de recuperação com uma conta descartável; não envia e-mails e remove a conta ao terminar. E-mails anteriores podem conter a URL antiga: após corrigir as configurações, solicite um novo link pelo domínio público.
