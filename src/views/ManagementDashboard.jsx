import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scissors, LogOut, Plus, Users, Store, ArrowRight, Search, X, RefreshCw, Eye, EyeOff, Settings } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../db';
import { PLAN_PRICES,formatMoney,brazilDate,validDocument } from '../domain/billing.js';
import { isSuperAdmin } from '../domain/access.js';
import './management.css';

const STATUS = { pilot: 'Piloto', active: 'Ativo', suspended: 'Pausado' };
const ROLE = { dono: 'Dono da barbearia', barbeiro: 'Barbeiro', super_admin: 'Super admin' };
const EMPTY_FORM = { nome: '', email: '', password: '', workspaceName: '', plano: 'barbearia', limiteBarbeiros: 5, cpfCnpj:'', telefone:'' };

function AccountDialog({ mode, workspace, onClose, onSave }) {
  const dialog = useRef(null);
  const [form, setForm] = useState(() => mode === 'plan' ? { ...EMPTY_FORM, workspaceName: workspace.nome, plano: workspace.plano, limiteBarbeiros: workspace.limite_barbeiros } : { ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => { dialog.current.showModal(); }, []);
  const field = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try { await onSave(form); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const title = mode === 'workspace' ? 'Novo acesso ao Barbermemo' : mode === 'plan' ? 'Plano e limites' : 'Adicionar barbeiro';
  return <dialog className="management-dialog" ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} aria-labelledby="account-title">
    <div className="management-dialog-heading"><div><p className="eyebrow">{mode === 'workspace' ? 'Sua operação' : workspace.nome}</p><h2 id="account-title">{title}</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="Fechar"><X size={20}/></button></div>
    <form onSubmit={submit} className="management-form">
      {error && <p className="management-error" role="alert">{error}</p>}
      {mode !== 'barber' && <>
        <label>Nome da barbearia ou do profissional<input required minLength={2} maxLength={120} value={form.workspaceName} onChange={e => field('workspaceName', e.target.value)} disabled={busy}/></label>
        <div className="management-form-row"><label>Plano<select value={form.plano} disabled={busy} onChange={e => setForm(previous => ({ ...previous, plano: e.target.value, limiteBarbeiros: e.target.value === 'individual' ? 1 : Math.max(5, previous.limiteBarbeiros) }))}><option value="individual">Individual · um profissional</option><option value="barbearia">Barbearia · dono e equipe</option></select></label>
          <label>Total de acessos<input type="number" required min={1} max={100} disabled={busy || form.plano === 'individual'} value={form.limiteBarbeiros} onChange={e => field('limiteBarbeiros', Number(e.target.value))}/></label></div>
        <p className="management-hint">O limite inclui o titular. O plano individual tem um acesso; no plano barbearia, o dono também pode atender clientes.</p>
      </>}
      {mode !== 'plan' && <>
        {mode === 'workspace' && <h3>Conta do titular</h3>}
        <label>Nome completo<input required minLength={2} maxLength={120} autoComplete="off" value={form.nome} onChange={e => field('nome', e.target.value)} disabled={busy}/></label>
        <label>E-mail de acesso<input type="email" required maxLength={254} autoComplete="off" value={form.email} onChange={e => field('email', e.target.value)} disabled={busy}/></label>
        <label>Senha inicial<div className="management-password"><input type={showPassword ? 'text' : 'password'} required minLength={10} maxLength={72} autoComplete="new-password" value={form.password} onChange={e => field('password', e.target.value)} disabled={busy}/><button type="button" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
        <p className="management-hint">Use pelo menos 10 caracteres. Repasse o e-mail e a senha ao profissional por um canal privado. Ele poderá trocar a senha em Configurações.</p>
        {mode === 'workspace' && <>
          <div className="management-form-row"><label>CPF/CNPJ do titular<input inputMode="numeric" maxLength={18} autoComplete="off" value={form.cpfCnpj} onChange={e=>field('cpfCnpj',e.target.value)} disabled={busy}/></label><label>Telefone com DDD<input type="tel" maxLength={16} value={form.telefone} onChange={e=>field('telefone',e.target.value)} disabled={busy}/></label></div>
          <p className="management-hint">CPF/CNPJ é opcional durante o piloto e obrigatório para ativar a assinatura paga. Não é necessário informar o documento dos membros da equipe.</p>
          <p className="management-pilot">O cadastro começa como piloto, sem cobrança. Ao ativar, você confirma a assinatura mensal por Pix: {formatMoney(PLAN_PRICES[form.plano])}.</p>
        </>}
      </>}
      <div className="management-dialog-actions"><button type="button" className="management-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="management-primary" disabled={busy}>{busy ? 'Salvando…' : mode === 'plan' ? 'Salvar alterações' : 'Criar acesso'}</button></div>
    </form>
  </dialog>;
}

function BillingDialog({workspace,billing,payer,environment,onClose,onConfirm}) {
  const dialog=useRef(null);
  const [form,setForm]=useState({cpfCnpj:payer?.cpf_cnpj||'',telefone:payer?.telefone||'',firstDueDate:billing?.first_due_date||brazilDate(),confirmed:false});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const existing=!!billing?.subscription_id;
  const reconciling=['creating','uncertain'].includes(billing?.state);
  useEffect(()=>{dialog.current.showModal();},[]);
  const field=(key,value)=>setForm(previous=>({...previous,[key]:value}));
  async function submit(event) {
    event.preventDefault();setError('');
    if(!validDocument(form.cpfCnpj)){setError('Informe um CPF ou CNPJ válido do titular.');return;}
    if(!form.confirmed)return;
    setBusy(true);
    try{await onConfirm({...form,confirmBilling:true,expectedPlan:workspace.plano,expectedAmountCents:PLAN_PRICES[workspace.plano]});onClose();}
    catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  return <dialog className="management-dialog" ref={dialog} aria-labelledby="billing-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <div className="management-dialog-heading"><div><p className="eyebrow">{workspace.nome}</p><h2 id="billing-title">{reconciling?'Conferir ativação':existing?'Reativar acesso':'Ativar assinatura'}</h2></div><button type="button" aria-label="Fechar" disabled={busy} onClick={onClose}><X size={20}/></button></div>
    <form onSubmit={submit} className="management-form">
      {error&&<p className="management-error" role="alert">{error}</p>}
      <p className="management-pilot"><strong>{formatMoney(PLAN_PRICES[workspace.plano])} por mês · Pix</strong><br/>{existing?'A assinatura vinculada será conferida antes de liberar o acesso.':'O Asaas criará a assinatura e gerará as cobranças mensais. O cliente paga cada Pix; esta opção não autoriza débito automático.'}</p>
      {environment!=='production' && <p className="management-error" role="status">{environment==='sandbox'?'Asaas em ambiente de testes. Esta assinatura não gera um Pix de produção.':'Asaas ainda não configurado para cobrança.'}</p>}
      <p className="management-hint">Titular: {payer?.nome} · {payer?.email}</p>
      <label>CPF/CNPJ do titular<input required inputMode="numeric" autoComplete="off" maxLength={18} value={form.cpfCnpj} onChange={e=>field('cpfCnpj',e.target.value)} disabled={busy}/></label>
      <label>Telefone com DDD<input type="tel" maxLength={16} value={form.telefone} onChange={e=>field('telefone',e.target.value)} disabled={busy}/></label>
      <label>Primeiro vencimento<input required type="date" min={existing||reconciling?undefined:brazilDate()} value={form.firstDueDate} readOnly={existing||reconciling} onChange={e=>field('firstDueDate',e.target.value)} disabled={busy}/></label>
      <label className="billing-confirm"><input type="checkbox" required checked={form.confirmed} onChange={e=>field('confirmed',e.target.checked)} disabled={busy}/><span>{existing?'Confirmo reativar o acesso usando a assinatura existente.':`Confirmo a assinatura mensal de ${formatMoney(PLAN_PRICES[workspace.plano])} por Pix para este titular.`}</span></label>
      <div className="management-dialog-actions"><button type="button" className="management-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="management-primary" disabled={busy||!form.confirmed||environment==='unconfigured'}>{busy?'Conferindo no Asaas…':reconciling?'Conferir ativação':existing?'Reativar acesso':'Ativar e gerar assinatura'}</button></div>
    </form>
  </dialog>;
}

export default function ManagementDashboard() {
  const { currentUser, logout } = useAuth();
  const superAdmin = isSuperAdmin(currentUser);
  const [data, setData] = useState(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState(null);
  const version = useRef(0);
  const load = useCallback(async (selectedId) => {
    const request = ++version.current;
    setLoading(true); setError('');
    try {
      const result = await db.workspaceRequest(null, { workspaceId: selectedId }, 'GET');
      if (version.current === request) setData(result);
    } catch (err) { if (version.current === request) setError(err.message); }
    finally { if (version.current === request) setLoading(false); }
  }, []);
  useEffect(() => { load(workspaceId); return () => { version.current++; }; }, [workspaceId, load]);
  const selected = data?.selected;
  const members = data?.members || [];
  const active = members.filter(member => member.ativo).length;
  const canAdd = selected?.plano === 'barbearia' && selected.status !== 'suspended' && active < selected.limite_barbeiros;
  async function save(form) {
    const action = dialog === 'workspace' ? 'create_workspace' : dialog === 'plan' ? 'update_workspace' : 'add_barber';
    const result = await db.workspaceRequest(action, { ...form, workspaceId: selected?.id });
    setNotice(dialog === 'plan' ? 'Plano atualizado.' : `Acesso criado para ${form.email}. Repasse as credenciais ao profissional.`);
    if (result.workspaceId && result.workspaceId !== workspaceId) setWorkspaceId(result.workspaceId);
    else await load(workspaceId);
  }
  async function change(action, values, message) {
    setBusy(true); setError(''); setNotice('');
    try { await db.workspaceRequest(action, { workspaceId: selected.id, ...values }); setNotice(message); await load(workspaceId); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function activate(values) {
    const result=await db.workspaceRequest('activate_billing',{workspaceId:selected.id,...values});
    setNotice(`Assinatura mensal de ${formatMoney(result.amountCents)} confirmada no Asaas. Acesso ativado.`);
    await load(workspaceId);
  }
  async function refreshInvoice() {
    setBusy(true);setError('');
    try {
      const result=await db.workspaceRequest('refresh_billing_link',{workspaceId:selected.id});
      if(!result.invoiceUrl)setNotice('Não há cobrança Pix pendente disponível no momento. Confira a assinatura no Asaas.');
      await load(workspaceId);
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <div className="management-page">
    <header className="management-header"><Link to={superAdmin ? '/admin' : '/barbearia'} className="management-brand"><Scissors size={25} strokeWidth={1.4}/><span>barbermemo<small>{superAdmin ? 'Administração' : 'Minha barbearia'}</small></span></Link><div className="management-account"><span>{currentUser.nome}</span>{!superAdmin && <Link to="/dashboard">Meu atendimento <ArrowRight size={16}/></Link>}<button type="button" aria-label="Sair" onClick={logout}><LogOut size={17}/><span>Sair</span></button></div></header>
    <main className="management-main">
      <div className="management-intro"><div><p className="eyebrow">{superAdmin ? 'Controle da operação' : 'Quem trabalha com você'}</p><h1>{superAdmin ? 'Barbearias e acessos' : 'Sua equipe, no mesmo lugar.'}</h1><p>{superAdmin ? 'Libere contas, acompanhe os planos e gerencie cada barbearia.' : 'Cadastre os profissionais e acompanhe o movimento da barbearia.'}</p></div>{superAdmin && <button type="button" className="management-primary" onClick={() => setDialog('workspace')}><Plus size={18}/> Novo acesso</button>}</div>
      {notice && <p className="management-notice" role="status">{notice}</p>}
      {error && <div className="management-error" role="alert">{error}<button type="button" onClick={() => load(workspaceId)}>Tentar novamente</button></div>}
      <div className={`management-columns ${superAdmin ? '' : 'owner'}`}>
        {superAdmin && <aside className="management-shops"><label className="management-search"><Search size={17}/><input aria-label="Buscar barbearia" placeholder="Buscar barbearia…" value={search} onChange={e => setSearch(e.target.value)}/></label><p className="management-list-label">{data?.workspaces.length || 0} cadastros</p><div className="management-shop-list">{data?.workspaces.filter(w => w.nome.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).map(w => <button key={w.id} type="button" aria-current={selected?.id === w.id ? 'true' : undefined} disabled={busy} onClick={() => { setWorkspaceId(w.id); setNotice(''); }}><Store size={19}/><span><strong>{w.nome}</strong><small>{w.plano === 'individual' ? 'Individual' : 'Barbearia'} · {STATUS[w.status]}</small></span><ArrowRight size={15}/></button>)}</div>{!loading && !data?.workspaces.length && <p className="management-empty">Crie o primeiro acesso para começar.</p>}</aside>}
        <section className="management-detail" aria-busy={loading}>
          {loading ? <div className="management-empty"><RefreshCw className="animate-spin" size={22}/><p>Carregando os acessos…</p></div> : selected ? <>
            <div className="management-detail-heading"><div><span className={`management-status ${selected.status}`}>{STATUS[selected.status]}</span><h2>{selected.nome}</h2><p>{selected.plano === 'individual' ? 'Plano individual' : 'Plano barbearia'} · {active} de {selected.limite_barbeiros} acessos em uso</p></div>{superAdmin && <button type="button" className="management-secondary" disabled={busy} onClick={() => setDialog('plan')}><Settings size={16}/> Editar plano</button>}</div>
            <div className="management-stats">{[['Clientes', data.stats.clientes], ['Atendimentos', data.stats.atendimentos], ['Agendamentos', data.stats.agendamentos]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
            {superAdmin && <div className="management-access-status"><span>Acesso à plataforma</span><select aria-label="Status da barbearia" value={selected.status} disabled={busy} onChange={e => {
              const status = e.target.value;
              if(status==='active'){setDialog('billing');return;}
              if (status === 'suspended' && !window.confirm(`Pausar o acesso de todos os profissionais de ${selected.nome}? Os dados serão preservados.`)) return;
              change('set_workspace_status', { status }, 'Status de acesso atualizado.');
            }}>{!data.billing?.subscription_id && !data.billing?.subscription_attempted && <option value="pilot">Piloto · sem cobrança</option>}<option value="active">Ativo</option><option value="suspended">Pausado</option></select><p>Ativar exige confirmar a assinatura mensal. Pausar o acesso não cancela a assinatura; gerencie o cancelamento no Asaas.</p></div>}
            {superAdmin && <div className="management-billing">
              <div><h3>Assinatura · {formatMoney(PLAN_PRICES[selected.plano])}/mês</h3><p>{data.billing?.state==='ready'?'Assinatura vinculada no Asaas · Pix mensal':data.billing?.state==='uncertain'?'Ativação pendente de conferência':data.billing?.state==='creating'?'Ativação em andamento':'Sem assinatura confirmada'}</p></div>
              {data.billing?.state!=='ready' && <button type="button" className="management-primary" disabled={busy} onClick={()=>setDialog('billing')}>{['uncertain','creating'].includes(data.billing?.state)?'Conferir ativação':'Ativar e gerar assinatura'}</button>}
              {data.billing?.subscription_id && <div className="management-billing-actions">{data.billing.invoice_url && <a className="management-secondary" href={data.billing.invoice_url} target="_blank" rel="noreferrer">Abrir cobrança Pix <ArrowRight size={15}/></a>}<button type="button" className="management-secondary" onClick={refreshInvoice} disabled={busy}>Atualizar link da cobrança</button></div>}
            </div>}
            <div className="management-team-heading"><h3><Users size={18}/> {selected.plano === 'individual' ? 'Profissional' : 'Equipe'}</h3>{selected.plano === 'barbearia' && <button type="button" className="management-primary" disabled={busy || !canAdd} onClick={() => setDialog('barber')}><Plus size={17}/> Adicionar barbeiro</button>}</div>
            {selected.plano === 'barbearia' && !canAdd && <p className="management-hint">{selected.status === 'suspended' ? 'O acesso desta barbearia está pausado.' : 'Todos os acessos do plano estão em uso. Desative um profissional ou solicite um limite maior.'}</p>}
            <div className="management-members">{members.map(member => <article key={member.id}><span className="management-avatar">{member.nome.slice(0, 1).toUpperCase()}</span><div className="management-member-info"><strong>{member.nome}</strong><span>{member.email}</span><small>{member.id === selected.owner_id ? 'Titular · ' : ''}{ROLE[member.role]}</small></div><div className="management-member-actions"><span className={member.ativo ? 'member-active' : ''}>{member.ativo ? 'Ativo' : 'Pausado'}</span>{member.role === 'barbeiro' && member.id !== selected.owner_id && <button type="button" className="management-secondary" disabled={busy || selected.status === 'suspended'} onClick={() => change('set_member_active', { memberId: member.id, ativo: !member.ativo }, 'Acesso do profissional atualizado.')}>{member.ativo ? 'Pausar' : 'Reativar'}</button>}</div></article>)}</div>
            <p className="management-privacy">Cada barbeiro acessa seus próprios clientes. O dono acompanha os totais e gerencia a equipe da sua barbearia.</p>
          </> : <div className="management-empty"><Store size={28}/><h2>Comece com um novo acesso.</h2><p>Cadastre um profissional individual ou o titular de uma barbearia.</p></div>}
        </section>
      </div>
    </main>
    {dialog==='billing' ? <BillingDialog workspace={selected} billing={data.billing} payer={data.payer} environment={data.billingEnvironment} onClose={()=>setDialog(null)} onConfirm={activate}/> : dialog && <AccountDialog mode={dialog} workspace={selected} onClose={() => setDialog(null)} onSave={save}/>}
  </div>;
}
