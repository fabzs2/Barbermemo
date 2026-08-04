import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../db';
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function UpdatePasswordView() {
  const navigate = useNavigate();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // The recovery link's access_token is exchanged into a session by the
    // Supabase client (detectSessionInUrl) before this effect runs.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasRecoverySession(!!session);
      setCheckingSession(false);
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (senha.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (senha !== confirmarSenha) {
      setError('As senhas não coincidem.');
      return;
    }

    setIsSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: senha });
      if (updateError) throw updateError;

      await supabase.auth.signOut();
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      console.error(err);
      setError('Não foi possível atualizar a senha. Solicite um novo link e tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-barber-dark flex items-center justify-center font-sans px-4 py-8 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[350px] h-[350px] rounded-full bg-barber-accent/10 blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[350px] h-[350px] rounded-full bg-barber-accent/5 blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-sm bg-barber-card border border-barber-border/80 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-6 fade-in z-10">
        <div className="flex flex-col items-center text-center space-y-2 select-none">
          <img src="/logo.svg" alt="BarberMemo Logo" className="w-14 h-14 object-contain rounded-xl shadow-lg" />
          <h1 className="text-xl font-bold tracking-tight text-zinc-100 font-sans">Redefinir Senha</h1>
        </div>

        {checkingSession ? (
          <div className="text-center text-xs text-zinc-500">Verificando link...</div>
        ) : !hasRecoverySession ? (
          <div className="bg-red-500/10 border border-red-500/25 p-3 rounded-lg flex items-start gap-2 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Link inválido ou expirado. Solicite um novo link de recuperação na tela de login.</span>
          </div>
        ) : success ? (
          <div className="bg-emerald-500/10 border border-emerald-500/25 p-3 rounded-lg flex items-start gap-2 text-emerald-400 text-xs">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Senha atualizada com sucesso! Redirecionando para o login...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/25 p-3 rounded-lg flex items-start gap-2 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-zinc-400 uppercase block font-sans">Nova Senha</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                <input
                  type="password"
                  required
                  placeholder="Mínimo 6 caracteres"
                  className="w-full bg-barber-dark border border-barber-border rounded-xl py-3 pl-10 pr-4 text-xs text-barber-text-primary placeholder:text-zinc-650"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
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
                  placeholder="Repita a senha"
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
              className="w-full bg-barber-accent hover:bg-barber-accent-hover text-white py-3.5 rounded-xl font-bold text-xs shadow-lg uppercase tracking-wider transition-all disabled:opacity-50 active:scale-[0.98]"
            >
              {isSaving ? 'Salvando...' : 'Salvar Nova Senha'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
