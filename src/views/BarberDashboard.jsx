import React, { useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Plus, Search, CalendarDays, Users, Scissors, Copy, Check, ArrowRight } from 'lucide-react';

export default function BarberDashboard() {
  const { currentUser, clientes, proximosRetornos, stats, agendamentos, searchQuery, setSearchQuery, isDataLoading } = useOutletContext();
  const navigate = useNavigate();
  const [copyState, setCopyState] = useState('');
  const bookingUrl = `${window.location.origin}/agendar/${currentUser.id}`;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(bookingUrl); setCopyState('Link copiado'); }
    catch { setCopyState('Não foi possível copiar. Selecione o link abaixo.'); }
  };
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="workspace-home">
      <header className="workspace-heading">
        <div><p className="eyebrow">{today}</p><h1>Seu dia, em ordem.</h1><p>Olá, {currentUser.nome?.split(' ')[0]}. Vamos cuidar dos próximos cortes.</p></div>
        <button className="primary-action" onClick={() => navigate('/agendamentos/novo')}><Plus size={18} /> Agendar horário</button>
      </header>
      <div className="summary-grid" aria-busy={isDataLoading}>
        {[['Clientes na carteira', stats.totalClientes, Users], ['Cortes neste mês', stats.atendimentosMes, Scissors], ['Horários hoje', agendamentos.length, CalendarDays]].map(([label, value, Icon]) => <div className="summary-item" key={label}><div><span>{label}</span><strong>{isDataLoading ? '—' : value}</strong></div><Icon size={21} strokeWidth={1.5} /></div>)}
      </div>
      <div className="home-columns">
        <section className="workspace-panel">
          <div className="panel-heading"><div><p className="eyebrow">Agenda</p><h2>Hoje na cadeira</h2></div><button className="text-action" onClick={() => navigate('/agendamentos')}>Ver agenda <ArrowUpRight size={16} /></button></div>
          {isDataLoading ? <p className="empty-copy" role="status">Carregando seus horários…</p> : agendamentos.length ? <div className="appointment-rows">{[...agendamentos].sort((a,b) => new Date(a.dataHora)-new Date(b.dataHora)).map(ag => <button className="appointment-row" key={ag.id} onClick={() => navigate(ag.clienteId ? `/clientes/${ag.clienteId}` : '/agendamentos')}><time>{new Date(ag.dataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time><span><strong>{ag.cliente?.nome || 'Cliente'}</strong><small>{ag.servicos}</small></span><span className="status-label">{ag.status}</span></button>)}</div> : <div className="home-empty"><CalendarDays size={28} strokeWidth={1.3} /><h3>A agenda está livre por aqui.</h3><p>Marque o próximo atendimento ou compartilhe seu link com os clientes.</p><button className="text-action" onClick={() => navigate('/agendamentos/novo')}>Agendar primeiro horário <ArrowRight size={16} /></button></div>}
        </section>
        <section className="workspace-panel returns-panel"><div className="panel-heading"><div><p className="eyebrow">Relacionamento</p><h2>Hora de voltar</h2></div><span className="count-label">{proximosRetornos.length}</span></div><p className="panel-description">Clientes que estão no período de renovar o corte.</p>{isDataLoading ? <p className="empty-copy">Carregando retornos…</p> : proximosRetornos.length ? proximosRetornos.slice(0, 4).map(item => <button className="return-row" key={item.cliente.id} onClick={() => navigate(`/clientes/${item.cliente.id}`)}><span className="client-initial">{item.cliente.nome?.charAt(0)}</span><span><strong>{item.cliente.nome}</strong><small>{item.diasAtrasados > 0 ? `${item.diasAtrasados} dias após o retorno previsto` : 'Retorno previsto para hoje'}</small></span><ArrowUpRight size={16} /></button>) : <p className="empty-copy">Nenhum retorno previsto no momento. Os lembretes aparecem conforme o histórico de cada cliente.</p>}</section>
      </div>
      <section className="workspace-panel clients-panel"><div className="panel-heading"><div><p className="eyebrow">Sua carteira</p><h2>Clientes</h2></div><button className="text-action" onClick={() => navigate('/clientes/novo')}><Plus size={16} /> Novo cliente</button></div><div className="client-search"><Search size={18}/><input aria-label="Buscar clientes" placeholder="Buscar por nome ou telefone" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/></div>{isDataLoading ? <p className="empty-copy" role="status">Carregando clientes…</p> : clientes.length ? clientes.map(c => <button className="client-table-row" key={c.id} onClick={() => navigate(`/clientes/${c.id}`)}><span className="client-initial">{c.nome?.charAt(0)}</span><strong>{c.nome}</strong><span>{c.telefone || 'Sem telefone'}</span><ArrowUpRight size={17}/></button>) : <div className="empty-copy">{searchQuery ? 'Nenhum cliente encontrado. Tente outro nome ou telefone.' : 'Sua carteira começa com o primeiro cliente.'}</div>}</section>
      <section className="booking-strip"><div><h2>Sua agenda, a um link de distância.</h2><p>Compartilhe com seus clientes para receber agendamentos.</p><a href={bookingUrl} target="_blank" rel="noreferrer">{bookingUrl}</a><span role="status" className="copy-feedback">{copyState}</span></div><button className="secondary-action" onClick={copyLink}>{copyState === 'Link copiado' ? <Check size={17}/> : <Copy size={17}/>} Copiar link</button></section>
    </div>
  );
}
