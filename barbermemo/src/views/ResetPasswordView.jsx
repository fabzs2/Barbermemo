import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../db';

export default function ResetPasswordView() {
  const { currentUser, authLoading, isPasswordRecovery, setIsPasswordRecovery } = useAuth();
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const navigate = useNavigate();

  // Route protection: if not logged in (and not recovering), go to login
  useEffect(() => {
    if (!authLoading && !currentUser) {
      navigate('/login');
    }
  }, [currentUser, authLoading, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!novaSenha || !confirmarSenha) {
      setErrorMsg('Por favor, preencha todos os campos.');
      return;
    }

    if (novaSenha.length < 6) {
      setErrorMsg('A senha deve conter no mínimo 6 caracteres.');
      return;
    }

    if (novaSenha !== confirmarSenha) {
      setErrorMsg('As senhas não coincidem.');
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) throw error;

      setSuccessMsg('Senha redefinida com sucesso!');
      
      // Clear password recovery flag
      sessionStorage.removeItem('isPasswordRecovery');
      setIsPasswordRecovery(false);

      // Redirect after a brief delay so they see the success message
      setTimeout(() => {
        if (currentUser?.role === 'admin') {
          navigate('/admin');
        } else {
          navigate('/dashboard');
        }
      }, 1500);

    } catch (err) {
      console.error(err);
      setErrorMsg('Erro ao atualizar a senha: ' + (err.message || 'Erro desconhecido.'));
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-barber-dark flex flex-col items-center justify-center space-y-4 text-zinc-400 font-sans select-none">
        <div className="w-8 h-8 border-3 border-barber-accent border-t-transparent rounded-full animate-spin"></div>
        <span className="text-xs font-semibold">Carregando...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-barber-dark flex items-center justify-center font-sans px-4 py-8 relative overflow-hidden">
      
      {/* Decorative background lights */}
      <div className="absolute top-[-10%] left-[-10%] w-[350px] h-[350px] rounded-full bg-barber-accent/10 blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[350px] h-[350px] rounded-full bg-barber-accent/5 blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-sm bg-barber-card border border-barber-border/80 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-6 fade-in z-10">

        {/* Logo / Branding */}
        <div className="flex flex-col items-center text-center space-y-2 select-none">
          <img src="/logo.svg" alt="BarberMemo Logo" className="w-14 h-14 object-contain rounded-xl shadow-lg" />
          <h1 className="text-xl font-bold tracking-tight text-zinc-100 font-sans">Redefinir Senha</h1>
          <p className="text-[11px] text-zinc-400">Escolha uma nova senha forte para acessar sua conta</p>
        </div>

        {/* Errors Banner */}
        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/25 p-3 rounded-lg flex items-start gap-2 text-red-400 text-xs fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success Banner */}
        {successMsg && (
          <div className="bg-emerald-500/10 border border-emerald-500/25 p-3 rounded-lg flex items-start gap-2 text-emerald-400 text-xs fade-in">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-zinc-400 uppercase block font-sans">Nova Senha</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
              <input
                type="password"
                required
                placeholder="No mínimo 6 caracteres"
                className="w-full bg-barber-dark border border-barber-border rounded-xl py-3 pl-10 pr-4 text-xs text-barber-text-primary placeholder:text-zinc-650"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-zinc-400 uppercase block font-sans">Confirmar Nova Senha</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
              <input
                type="password"
                required
                placeholder="Repita a nova senha"
                className="w-full bg-barber-dark border border-barber-border rounded-xl py-3 pl-10 pr-4 text-xs text-barber-text-primary placeholder:text-zinc-650"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="w-full bg-barber-accent hover:bg-barber-accent-hover text-white py-3.5 rounded-xl font-bold text-xs shadow-lg uppercase tracking-wider transition-all disabled:opacity-50 active:scale-[0.98] mt-2"
          >
            {isSaving ? 'Atualizando...' : 'Salvar Nova Senha'}
          </button>
        </form>

      </div>
    </div>
  );
}
