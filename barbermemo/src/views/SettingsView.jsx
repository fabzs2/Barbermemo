import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { db, supabase } from '../db';
import {
  Settings, Clock, Scissors, Plus, Trash2, Edit2, Check, X,
  Save, ArrowLeft, Info, Lock, Eye, EyeOff, Palette, MessageSquare, CreditCard, Loader2
} from 'lucide-react';

const HOURS_RANGE = Array.from({ length: 19 }, (_, i) => {
  const h = 5 + i;
  return `${String(h).padStart(2, '0')}:00`;
});

export default function SettingsView() {
  const { currentUser, setCurrentUser } = useAuth();
  const navigate = useNavigate();

  // Phone formatting helper
  const formatPhone = (val) => {
    let value = (val || '').replace(/\D/g, '');
    if (value.length > 11) value = value.slice(0, 11);
    if (value.length > 6) {
      return `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7)}`;
    } else if (value.length > 2) {
      return `(${value.slice(0, 2)}) ${value.slice(2)}`;
    } else if (value.length > 0) {
      return `(${value}`;
    }
    return value;
  };

  const [telefone, setTelefone] = useState(() => formatPhone(currentUser?.telefone || ''));
  const [modeloAtendimento, setModeloAtendimento] = useState(currentUser?.modeloAtendimento || 'agenda');
  const [statusFila, setStatusFila] = useState(currentUser?.statusFila || 'disponivel');
  const [horaInicio, setHoraInicio] = useState(currentUser?.horaInicio || '08:00');
  const [horaFim, setHoraFim] = useState(currentUser?.horaFim || '20:00');
  const [servicos, setServicos] = useState(() => currentUser?.servicosConfig || []);

  const [themeColor, setThemeColor] = useState(currentUser?.themeColor || 'amber');
  const [templateReminder, setTemplateReminder] = useState(currentUser?.templateReminder || '');
  const [templateBooking, setTemplateBooking] = useState(currentUser?.templateBooking || '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Alterar Senha states
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarNovaSenha, setConfirmarNovaSenha] = useState('');
  const [showSenhaAtual, setShowSenhaAtual] = useState(false);
  const [showNovaSenha, setShowNovaSenha] = useState(false);
  const [showConfirmarNovaSenha, setShowConfirmarNovaSenha] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Asaas Billing states
  const [billingInfo, setBillingInfo] = useState(null);
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [billingError, setBillingError] = useState('');

  // Load billing data on mount
  useEffect(() => {
    async function loadBilling() {
      if (!currentUser?.subscriptionId) return;
      setLoadingBilling(true);
      setBillingError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/asaas/verify-subscription?subscriptionId=${currentUser.subscriptionId}`);
        const data = await res.json();
        
        if (res.ok) {
          // Now fetch active payments to get latest invoices
          const payRes = await fetch(`/api/asaas/verify-subscription?subscriptionId=${currentUser.subscriptionId}`); // Reusing endpoint payload or local mock if sandbox
          // Query our custom billing-info API
          const billingRes = await fetch('/api/asaas/billing-info', {
            headers: {
              Authorization: `Bearer ${session?.access_token}`
            }
          });
          const billingData = await billingRes.json();
          if (billingRes.ok) {
            setBillingInfo(billingData);
          } else {
            setBillingError(billingData.error || 'Erro ao carregar faturamento.');
          }
        }
      } catch (e) {
        console.error(e);
        setBillingError('Erro ao carregar dados de faturamento.');
      } finally {
        setLoadingBilling(false);
      }
    }
    loadBilling();
  }, [currentUser]);

  const handlePhoneChange = (e) => {
    setTelefone(formatPhone(e.target.value));
  };

  // Inline service editor states
  const [editingIdx, setEditingIdx] = useState(null); // index or 'new'
  const [editorForm, setEditorForm] = useState({ name: '', duration: 30, price: '' });

  const handleStartEditing = (idx, service) => {
    setEditingIdx(idx);
    setEditorForm({
      name: service.name,
      duration: service.duration,
      price: service.price
    });
  };

  const handleStartAdding = () => {
    setEditingIdx('new');
    setEditorForm({ name: '', duration: 30, price: 'R$ ' });
  };

  const handleSaveService = () => {
    if (!editorForm.name.trim()) {
      alert('Nome do serviço é obrigatório.');
      return;
    }

    const durationVal = parseInt(editorForm.duration, 10);
    if (isNaN(durationVal) || durationVal <= 0) {
      alert('Duração inválida.');
      return;
    }

    let priceVal = editorForm.price.trim();
    if (!priceVal.startsWith('R$')) {
      priceVal = `R$ ${priceVal}`;
    }

    const newService = {
      name: editorForm.name.trim(),
      duration: durationVal,
      price: priceVal
    };

    if (editingIdx === 'new') {
      setServicos(prev => [...prev, newService]);
    } else {
      setServicos(prev => prev.map((s, i) => i === editingIdx ? newService : s));
    }

    setEditingIdx(null);
  };

  const handleRemoveService = (idx) => {
    if (confirm('Deseja excluir este serviço?')) {
      setServicos(prev => prev.filter((_, i) => i !== idx));
      if (editingIdx === idx) setEditingIdx(null);
    }
  };

  const handleSaveAllConfig = async (e) => {
    e.preventDefault();
    if (servicos.length === 0) {
      setError('Adicione pelo menos um serviço antes de salvar.');
      return;
    }

    const cleanPhone = telefone.replace(/\D/g, '');
    if (cleanPhone && cleanPhone.length < 10) {
      setError('Por favor, insira um número de WhatsApp válido.');
      return;
    }

    const startH = parseInt(horaInicio.split(':')[0], 10);
    const endH = parseInt(horaFim.split(':')[0], 10);

    if (startH >= endH) {
      setError('A hora de início deve ser menor que a hora de término.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess(false);

    try {
      const updatedUser = await db.updateBarberConfig(currentUser.id, {
        telefone: cleanPhone,
        horaInicio,
        horaFim,
        modeloAtendimento,
        statusFila,
        servicosConfig: servicos,
        themeColor,
        templateReminder,
        templateBooking
      });

      setCurrentUser(updatedUser);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        navigate('/dashboard');
      }, 1500);
    } catch (err) {
      console.error(err);
      setError('Erro ao salvar configurações no banco de dados.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);

    if (novaSenha.length < 6) {
      setPasswordError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (novaSenha !== confirmarNovaSenha) {
      setPasswordError('As senhas digitadas não coincidem.');
      return;
    }

    setChangingPassword(true);

    try {
      await db.changePassword(senhaAtual, novaSenha);
      setPasswordSuccess(true);
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmarNovaSenha('');
    } catch (err) {
      console.error(err);
      setPasswordError(err.message || 'Erro ao redefinir a senha de acesso.');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="p-4 md:p-6 h-full flex flex-col font-sans fade-in max-w-2xl mx-auto">
      
      {/* Header control */}
      <div className="flex justify-between items-center border-b border-barber-border/50 pb-4 mb-5 shrink-0 select-none">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Settings className="w-5 h-5 text-barber-accent" />
            Configurações do Perfil
          </h2>
          <p className="text-xs text-zinc-550 mt-0.5">Customize sua agenda e serviços do link público</p>
        </div>
        <button
          onClick={() => navigate('/dashboard')}
          className="text-zinc-550 hover:text-zinc-350 text-xs flex items-center gap-1 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar space-y-6 pb-8">
        
        {/* Form panel */}
        <form onSubmit={handleSaveAllConfig} className="space-y-6">

          {/* WhatsApp Contact Config */}
          <div className="bg-barber-card border border-barber-border rounded-xl p-5 space-y-4 shadow-md">
            <div className="flex items-center gap-2 text-barber-accent-light select-none">
              <Settings className="w-4 h-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">WhatsApp para Contato</h3>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed select-none">
              Insira seu número de WhatsApp. O cliente será redirecionado para este número ao clicar em "Enviar Aviso por WhatsApp" no fim do agendamento público.
            </p>

            <div className="space-y-1.5">
              <label className="text-[10.5px] font-semibold text-zinc-400 font-sans block">Seu WhatsApp</label>
              <input
                type="text"
                placeholder="Ex: (93) 99199-0984"
                value={telefone}
                onChange={handlePhoneChange}
                className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 px-3 text-xs text-zinc-200 placeholder:text-zinc-700"
              />
            </div>
          </div>

          {/* Service Model Config */}
          <div className="bg-barber-card border border-barber-border rounded-xl p-5 space-y-4 shadow-md">
            <div className="flex items-center gap-2 text-barber-accent-light select-none">
              <Settings className="w-4 h-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Modelo de Atendimento</h3>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed select-none">
              Escolha se prefere trabalhar por hora marcada (Agenda) ou por ordem de chegada virtual (Fila de Espera em Tempo Real).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10.5px] font-semibold text-zinc-400 font-sans block">Modelo</label>
                <select
                  value={modeloAtendimento}
                  onChange={(e) => setModeloAtendimento(e.target.value)}
                  className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 px-3 text-xs text-zinc-200"
                >
                  <option value="agenda">Agendamento por Horário (Agenda)</option>
                  <option value="fila">Fila de Espera (Ordem de Chegada)</option>
                </select>
              </div>

              {modeloAtendimento === 'fila' && (
                <div className="space-y-1.5">
                  <label className="text-[10.5px] font-semibold text-zinc-400 font-sans block">Status da Fila</label>
                  <select
                    value={statusFila}
                    onChange={(e) => setStatusFila(e.target.value)}
                    className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 px-3 text-xs text-zinc-200"
                  >
                    <option value="disponivel">🟢 Disponível</option>
                    <option value="almoco">🟡 Em Horário de Almoço</option>
                    <option value="pausa">🟠 Em Pausa / Café</option>
                    <option value="ausente">🔴 Ausente / Indisponível</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* 1. Working Hours Config */}
          <div className="bg-barber-card border border-barber-border rounded-xl p-5 space-y-4 shadow-md">
            <div className="flex items-center gap-2 text-barber-accent-light select-none">
              <Clock className="w-4 h-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Horário de Agendamento</h3>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed select-none">
              Defina o período de atendimento diário. Os slots do formulário público de agendamento serão gerados dentro desse intervalo.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10.5px] font-semibold text-zinc-400 font-sans block">Início da Agenda</label>
                <select
                  value={horaInicio}
                  onChange={(e) => setHoraInicio(e.target.value)}
                  className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 px-3 text-xs text-zinc-200"
                >
                  {HOURS_RANGE.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10.5px] font-semibold text-zinc-400 font-sans block">Término da Agenda</label>
                <select
                  value={horaFim}
                  onChange={(e) => setHoraFim(e.target.value)}
                  className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 px-3 text-xs text-zinc-200"
                >
                  {HOURS_RANGE.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 2. Services Management Config */}
          <div className="bg-barber-card border border-barber-border rounded-xl p-5 space-y-4 shadow-md">
            <div className="flex justify-between items-center select-none">
              <div className="flex items-center gap-2 text-barber-accent-light">
                <Scissors className="w-4 h-4" />
                <h3 className="text-xs font-bold uppercase tracking-wider">Serviços Oferecidos</h3>
              </div>
              
              {editingIdx === null && (
                <button
                  type="button"
                  onClick={handleStartAdding}
                  className="bg-zinc-800 hover:bg-zinc-750 text-barber-accent-light border border-zinc-700/80 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Novo Serviço
                </button>
              )}
            </div>
            
            <p className="text-[11px] text-zinc-500 leading-relaxed select-none">
              Crie os tipos de cortes e serviços que você faz, definindo o tempo estimado e o valor cobrado.
            </p>

            {/* Inline Editor Form */}
            {editingIdx !== null && (
              <div className="bg-zinc-950/40 border border-barber-accent/30 rounded-xl p-4 space-y-4 fade-in">
                <h4 className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest block">
                  {editingIdx === 'new' ? 'Adicionar Novo Serviço' : 'Editar Serviço'}
                </h4>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-zinc-500 font-semibold font-sans block">Nome do Serviço</label>
                    <input
                      type="text"
                      placeholder="Ex: Corte Degradê"
                      value={editorForm.name}
                      onChange={(e) => setEditorForm({ ...editorForm, name: e.target.value })}
                      className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 px-3 text-xs text-zinc-200 placeholder:text-zinc-700"
                    />
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-[10px] text-zinc-500 font-semibold font-sans block">Duração (minutos)</label>
                    <input
                      type="number"
                      placeholder="Ex: 40"
                      value={editorForm.duration}
                      onChange={(e) => setEditorForm({ ...editorForm, duration: e.target.value })}
                      className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 px-3 text-xs text-zinc-200"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-zinc-500 font-semibold font-sans block">Preço (R$)</label>
                    <input
                      type="text"
                      placeholder="Ex: R$ 40,00"
                      value={editorForm.price}
                      onChange={(e) => setEditorForm({ ...editorForm, price: e.target.value })}
                      className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 px-3 text-xs text-zinc-200 placeholder:text-zinc-700"
                    />
                  </div>
                </div>

                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setEditingIdx(null)}
                    className="bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveService}
                    className="bg-barber-accent hover:bg-barber-accent-hover text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Salvar Serviço
                  </button>
                </div>
              </div>
            )}

            {/* Services List Table */}
            <div className="border border-barber-border rounded-xl overflow-hidden divide-y divide-barber-border">
              {servicos.map((s, idx) => (
                <div key={idx} className="p-3.5 flex justify-between items-center hover:bg-zinc-900/10 transition-colors">
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-xs block text-zinc-200 truncate">{s.name}</span>
                    <span className="text-[10px] text-zinc-500 block mt-0.5 font-sans">
                      Duração: <strong className="text-zinc-400 font-medium">{s.duration} min</strong>
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-bold text-barber-accent-light">{s.price}</span>
                    
                    {editingIdx === null && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleStartEditing(idx, s)}
                          className="p-1.5 bg-zinc-900/60 hover:bg-zinc-800 border border-barber-border hover:border-zinc-700 text-zinc-400 hover:text-white rounded transition-colors cursor-pointer"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveService(idx)}
                          className="p-1.5 bg-red-950/15 hover:bg-red-950/30 border border-red-900/20 hover:border-red-900/40 text-red-400 rounded transition-colors cursor-pointer"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {servicos.length === 0 && (
                <div className="p-6 text-center text-zinc-550 select-none text-xs">
                  Nenhum serviço configurado. Clique em "Novo Serviço" para começar.
                </div>
              )}
            </div>
          </div>

          {/* Theme Customization Config */}
          <div className="bg-barber-card border border-barber-border rounded-xl p-5 space-y-4 shadow-md">
            <div className="flex items-center gap-2 text-barber-accent-light select-none">
              <Palette className="w-4 h-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Cor de Destaque da Página Pública</h3>
            </div>
            <p className="text-[11px] text-zinc-550 leading-relaxed select-none">
              Escolha a cor de destaque para a sua página pública de agendamento. Seus clientes verão esta cor ao agendar.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-sans">
              {[
                { id: 'amber', name: 'Ouro (Padrão)', bg: 'bg-amber-600' },
                { id: 'emerald', name: 'Esmeralda', bg: 'bg-emerald-600' },
                { id: 'crimson', name: 'Carmim / Rosa', bg: 'bg-rose-600' },
                { id: 'blue', name: 'Azul Naval', bg: 'bg-blue-600' }
              ].map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => setThemeColor(theme.id)}
                  className={`flex items-center justify-between p-3 rounded-xl border text-[11px] font-bold cursor-pointer transition-all ${
                    themeColor === theme.id
                      ? 'border-barber-accent bg-barber-accent/5 text-zinc-100'
                      : 'border-barber-border bg-zinc-950/20 text-zinc-400 hover:border-zinc-800'
                  }`}
                >
                  <span>{theme.name}</span>
                  <span className={`w-3 h-3 rounded-full ${theme.bg} border border-white/10 shrink-0 ml-2`}></span>
                </button>
              ))}
            </div>
          </div>

          {/* WhatsApp Templates Config */}
          <div className="bg-barber-card border border-barber-border rounded-xl p-5 space-y-4 shadow-md">
            <div className="flex items-center gap-2 text-barber-accent-light select-none">
              <MessageSquare className="w-4 h-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">Modelos de Mensagem do WhatsApp</h3>
            </div>
            <p className="text-[11px] text-zinc-555 leading-relaxed select-none">
              Personalize as mensagens automáticas geradas pelo sistema. Deixe em branco para usar o padrão de fábrica.
            </p>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10.5px] font-semibold text-zinc-400 font-sans block">
                  Lembrete de Retorno (Clientes Sumidos)
                </label>
                <textarea
                  rows={3}
                  value={templateReminder}
                  onChange={(e) => setTemplateReminder(e.target.value)}
                  placeholder={`Ex: Olá, {nome_cliente}! Faz {dias_passados} dias desde o seu último corte. Que tal agendar um novo horário com {nome_barbeiro}?`}
                  className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 px-3 text-xs text-zinc-200 placeholder:text-zinc-700 font-sans resize-none"
                />
                <span className="text-[9px] text-zinc-550 block select-none">
                  Tags dinâmicas: <code className="text-barber-accent-light font-mono">{`{nome_cliente}`}</code>, <code className="text-barber-accent-light font-mono">{`{dias_passados}`}</code>, <code className="text-barber-accent-light font-mono">{`{nome_barbeiro}`}</code>
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10.5px] font-semibold text-zinc-400 font-sans block">
                  Aviso de Agendamento pelo Cliente (Página Pública)
                </label>
                <textarea
                  rows={3}
                  value={templateBooking}
                  onChange={(e) => setTemplateBooking(e.target.value)}
                  placeholder={`Ex: Olá, {nome_barbeiro}! Acabei de solicitar o agendamento de {nome_servico} no dia {data_hora}.`}
                  className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 px-3 text-xs text-zinc-200 placeholder:text-zinc-700 font-sans resize-none"
                />
                <span className="text-[9px] text-zinc-550 block select-none">
                  Tags dinâmicas: <code className="text-barber-accent-light font-mono">{`{nome_barbeiro}`}</code>, <code className="text-barber-accent-light font-mono">{`{nome_cliente}`}</code>, <code className="text-barber-accent-light font-mono">{`{nome_servico}`}</code>, <code className="text-barber-accent-light font-mono">{`{data_hora}`}</code>
                </span>
              </div>
            </div>
          </div>

          {/* Feedback Messages */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/25 text-red-500 text-[10px] rounded-lg font-semibold flex items-center gap-1.5 select-none font-sans">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] rounded-lg font-semibold flex items-center gap-1.5 select-none font-sans">
              <Check className="w-3.5 h-3.5 shrink-0" />
              <span>Configurações salvas e perfil atualizado com sucesso! Redirecionando...</span>
            </div>
          )}

          {/* Submit Actions */}
          <div className="flex gap-4 select-none pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => navigate('/dashboard')}
              className="flex-1 bg-zinc-900 hover:bg-zinc-850 text-zinc-400 border border-zinc-800 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
            >
              Cancelar
            </button>
            
            <button
              type="submit"
              disabled={saving || editingIdx !== null}
              className="flex-1 bg-barber-accent hover:bg-barber-accent-hover text-white py-3 rounded-xl text-xs font-bold disabled:bg-zinc-800 disabled:text-zinc-555 transition-all flex items-center justify-center gap-2 cursor-pointer font-sans shadow-md shadow-barber-accent/15"
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Salvar Configurações
                </>
              )}
            </button>
          </div>

        </form>

        {/* Change Password Panel */}
        <div className="bg-barber-card border border-barber-border rounded-xl p-5 space-y-4 shadow-md font-sans">
          <div className="flex items-center gap-2 text-barber-accent-light select-none">
            <Lock className="w-4 h-4" />
            <h3 className="text-xs font-bold uppercase tracking-wider">Alterar Senha de Acesso</h3>
          </div>
          <p className="text-[11px] text-zinc-550 leading-relaxed select-none">
            Para trocar a sua senha atual de acesso ao sistema, preencha as informações abaixo.
          </p>

          <form onSubmit={handleUpdatePassword} className="space-y-4 pt-1">
            {passwordError && (
              <div className="p-3 bg-red-500/10 border border-red-500/25 text-red-400 text-[10px] rounded-lg font-semibold flex items-center gap-1.5 font-sans">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}

            {passwordSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] rounded-lg font-semibold flex items-center gap-1.5 font-sans">
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span>Sua senha foi redefinida com sucesso!</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-400 font-semibold font-sans block">Senha Atual</label>
                <div className="relative">
                  <input
                    type={showSenhaAtual ? 'text' : 'password'}
                    placeholder="Sua senha atual"
                    value={senhaAtual}
                    onChange={(e) => setSenhaAtual(e.target.value)}
                    className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 pl-3 pr-8 text-xs text-zinc-200"
                    required
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSenhaAtual(!showSenhaAtual)}
                    className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    {showSenhaAtual ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-zinc-400 font-semibold font-sans block">Nova Senha</label>
                <div className="relative">
                  <input
                    type={showNovaSenha ? 'text' : 'password'}
                    placeholder="Mínimo 6 caracteres"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                    className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 pl-3 pr-8 text-xs text-zinc-200"
                    required
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNovaSenha(!showNovaSenha)}
                    className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    {showNovaSenha ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-zinc-400 font-semibold font-sans block">Confirmar Nova Senha</label>
                <div className="relative">
                  <input
                    type={showConfirmarNovaSenha ? 'text' : 'password'}
                    placeholder="Repita a nova senha"
                    value={confirmarNovaSenha}
                    onChange={(e) => setConfirmarNovaSenha(e.target.value)}
                    className="w-full bg-barber-dark border border-barber-border rounded-lg py-2 pl-3 pr-8 text-xs text-zinc-200"
                    required
                    disabled={changingPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmarNovaSenha(!showConfirmarNovaSenha)}
                    className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    {showConfirmarNovaSenha ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={changingPassword || !senhaAtual || !novaSenha || !confirmarNovaSenha}
                className="bg-zinc-800 hover:bg-zinc-750 text-barber-accent-light border border-zinc-700/80 px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {changingPassword ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Atualizando...</span>
                  </>
                ) : (
                  <span>Atualizar Minha Senha</span>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Asaas Billing Section */}
        <div className="bg-barber-card border border-barber-border rounded-xl p-5 space-y-4 shadow-md font-sans">
          <div className="flex items-center gap-2 text-barber-accent-light select-none">
            <CreditCard className="w-4 h-4" />
            <h3 className="text-xs font-bold uppercase tracking-wider">Minha Assinatura & Faturamento</h3>
          </div>
          <p className="text-[11px] text-zinc-550 leading-relaxed select-none">
            Gerencie seu plano mensal do BarberMemo integrado com o Asaas.
          </p>

          {loadingBilling ? (
            <div className="flex items-center justify-center py-6 gap-2 text-xs text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin text-barber-accent" />
              <span>Carregando informações financeiras do Asaas...</span>
            </div>
          ) : billingError ? (
            <div className="p-3 bg-red-500/10 border border-red-500/25 text-red-400 text-[10px] rounded-lg font-semibold flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              <span>{billingError}</span>
            </div>
          ) : billingInfo ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="bg-zinc-950/20 border border-barber-border rounded-xl p-4 text-xs space-y-3">
                <div className="flex justify-between border-b border-barber-border/30 pb-2">
                  <span className="text-zinc-550">Plano Atual</span>
                  <span className="font-bold text-zinc-200 uppercase">{billingInfo.plano === 'barbearia' ? 'Plano Barbearia' : 'Plano Autônomo'}</span>
                </div>
                <div className="flex justify-between border-b border-barber-border/30 pb-2">
                  <span className="text-zinc-555">Valor Mensal</span>
                  <span className="font-bold text-barber-accent-light">R$ {parseFloat(billingInfo.value).toFixed(2).replace('.', ',')}</span>
                </div>
                <div className="flex justify-between border-b border-barber-border/30 pb-2">
                  <span className="text-zinc-555">Próximo Vencimento</span>
                  <span className="font-bold text-zinc-200">
                    {billingInfo.nextDueDate 
                      ? new Date(billingInfo.nextDueDate + 'T00:00:00').toLocaleDateString('pt-BR') 
                      : 'Não informado'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-555">Status no Asaas</span>
                  <span className={`font-bold capitalize ${
                    ['ACTIVE', 'CONFIRMED', 'RECEIVED'].includes(billingInfo.status) ? 'text-emerald-400' : 'text-amber-500'
                  }`}>
                    {['ACTIVE', 'CONFIRMED', 'RECEIVED'].includes(billingInfo.status) ? 'Ativo / Pago' : 'Aguardando Pagamento'}
                  </span>
                </div>
              </div>

              <div className="flex flex-col justify-center space-y-3">
                <p className="text-[10px] text-zinc-400 leading-normal">
                  Sua mensalidade é gerenciada de forma segura e automatizada. Você pode efetuar pagamentos, gerar boletos, copiar código PIX ou pagar com cartão clicando no botão abaixo.
                </p>

                {billingInfo.invoiceUrl ? (
                  <a
                    href={billingInfo.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all text-center shadow-lg shadow-emerald-950/20"
                  >
                    <CreditCard className="w-4 h-4" />
                    Acessar Fatura / Pagar Mensalidade
                  </a>
                ) : (
                  <div className="text-[10.5px] text-zinc-500 italic text-center py-2 border border-dashed border-barber-border rounded-xl">
                    Nenhuma fatura pendente encontrada.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 text-center border border-dashed border-barber-border rounded-xl text-zinc-550 text-xs">
              Nenhuma assinatura ativa encontrada para este perfil.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
