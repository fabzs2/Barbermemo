import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../db';
import { Mail, Lock, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function LoginView() {
  const { currentUser, login, authError, setAuthError } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const navigate = useNavigate();

  const [mode, setMode] = useState('login'); // 'login' | 'forgot'
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  // Clear auth error when mounting Login screen
  useEffect(() => {
    setAuthError('');
  }, [setAuthError]);

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setForgotSending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${window.location.origin}/redefinir-senha`
      });
      if (error) throw error;
      setForgotSent(true);
    } catch (err) {
      console.error(err);
      setAuthError('Não foi possível enviar o link de recuperação. Tente novamente.');
    } finally {
      setForgotSending(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      if (currentUser.role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/dashboard');
      }
    }
  }, [currentUser, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !senha) {
      setAuthError('Por favor, preencha todos os campos.');
      return;
    }

    setIsSaving(true);
    try {
      await login(email, senha);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-barber-dark flex items-center justify-center font-sans px-4 py-8 relative overflow-hidden">
      
      {/* Decorative background lights */}
      <div className="absolute top-[-10%] left-[-10%] w-[350px] h-[350px] rounded-full bg-barber-accent/10 blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[350px] h-[350px] rounded-full bg-barber-accent/5 blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-sm bg-barber-card border border-barber-border/80 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-6 fade-in z-10">

        {/* Logo / Branding */}
        <div className="flex flex-col items-center text-center space-y-2 select-none">
          <img src="/logo.svg" alt="BarberMemo Logo" className="w-14 h-14 object-contain rounded-xl shadow-lg" />
          <h1 className="text-xl font-bold tracking-tight text-zinc-100 font-sans">BarberMemo</h1>
          <p className="text-[11px] text-zinc-400">Ficha técnica e agenda individual para Barbeiros</p>
        </div>

        {/* Errors Banner */}
        {authError && (
          <div className="bg-red-500/10 border border-red-500/25 p-3 rounded-lg flex items-start gap-2 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{authError}</span>
          </div>
        )}

        {mode === 'login' ? (
          /* VIEW: LOGIN FORM */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-zinc-400 uppercase block font-sans">E-mail</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                <input
                  type="email"
                  required
                  placeholder="Ex: nome@gmail.com"
                  className="w-full bg-barber-dark border border-barber-border rounded-xl py-3 pl-10 pr-4 text-xs text-barber-text-primary placeholder:text-zinc-650"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSaving}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-zinc-400 uppercase block font-sans">Senha</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                <input
                  type="password"
                  required
                  placeholder="Sua senha"
                  className="w-full bg-barber-dark border border-barber-border rounded-xl py-3 pl-10 pr-4 text-xs text-barber-text-primary placeholder:text-zinc-650"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  disabled={isSaving}
                />
              </div>
              <button
                type="button"
                onClick={() => { setAuthError(''); setForgotSent(false); setForgotEmail(email); setMode('forgot'); }}
                className="text-[11px] text-zinc-500 hover:text-barber-accent-light transition-colors cursor-pointer"
              >
                Esqueci minha senha
              </button>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-barber-accent hover:bg-barber-accent-hover text-white py-3.5 rounded-xl font-bold text-xs shadow-lg uppercase tracking-wider transition-all disabled:opacity-50 active:scale-[0.98]"
            >
              {isSaving ? 'Acessando...' : 'Acessar Minha Carteira'}
            </button>
          </form>
        ) : (
          /* VIEW: FORGOT PASSWORD FORM */
          <div className="space-y-4">
            {forgotSent ? (
              <div className="bg-emerald-500/10 border border-emerald-500/25 p-3 rounded-lg flex items-start gap-2 text-emerald-400 text-xs">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Se esse e-mail estiver cadastrado, enviamos um link para redefinir a senha.</span>
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-4">
                <p className="text-[11px] text-zinc-500">Informe seu e-mail de acesso para receber um link de redefinição de senha.</p>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-zinc-400 uppercase block font-sans">E-mail</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                    <input
                      type="email"
                      required
                      placeholder="Ex: nome@gmail.com"
                      className="w-full bg-barber-dark border border-barber-border rounded-xl py-3 pl-10 pr-4 text-xs text-barber-text-primary placeholder:text-zinc-650"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      disabled={forgotSending}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={forgotSending}
                  className="w-full bg-barber-accent hover:bg-barber-accent-hover text-white py-3.5 rounded-xl font-bold text-xs shadow-lg uppercase tracking-wider transition-all disabled:opacity-50 active:scale-[0.98]"
                >
                  {forgotSending ? 'Enviando...' : 'Enviar Link de Recuperação'}
                </button>
              </form>
            )}
            <button
              type="button"
              onClick={() => { setAuthError(''); setMode('login'); }}
              className="w-full text-center text-[11px] text-zinc-500 hover:text-barber-accent-light transition-colors cursor-pointer"
            >
              Voltar para o login
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
