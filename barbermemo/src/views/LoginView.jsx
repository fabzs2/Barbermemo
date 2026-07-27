import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, AlertCircle, ArrowLeft, CheckCircle } from 'lucide-react';
import { supabase } from '../db';

export default function LoginView() {
  const { currentUser, login, authError, setAuthError } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [step, setStep] = useState('login'); // 'login' or 'forgot'
  const [successMessage, setSuccessMessage] = useState('');
  const navigate = useNavigate();

  // Clear errors and messages when mounting Login screen
  useEffect(() => {
    setAuthError('');
    setSuccessMessage('');
  }, [setAuthError]);

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
    setSuccessMessage('');
    try {
      await login(email, senha);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestReset = async (e) => {
    e.preventDefault();
    if (!email) {
      setAuthError('Por favor, digite seu e-mail.');
      return;
    }

    setIsSaving(true);
    setAuthError('');
    setSuccessMessage('');
    try {
      const redirectTo = window.location.origin + '/reset-password';
      const { error } = await supabase.auth.resetPasswordForEmail(email.toLowerCase().trim(), {
        redirectTo: redirectTo
      });
      if (error) throw error;
      setSuccessMessage('E-mail de recuperação enviado! Verifique sua caixa de entrada.');
      setStep('login');
    } catch (err) {
      console.error(err);
      setAuthError('Erro ao enviar link de recuperação: ' + (err.message || 'Erro desconhecido.'));
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
          <p className="text-[11px] text-zinc-400">
            {step === 'login' ? 'Ficha técnica e agenda individual para Barbeiros' : 'Recuperação de acesso à sua carteira'}
          </p>
        </div>

        {/* Errors Banner */}
        {authError && (
          <div className="bg-red-500/10 border border-red-500/25 p-3 rounded-lg flex items-start gap-2 text-red-400 text-xs fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{authError}</span>
          </div>
        )}

        {/* Success Banner */}
        {successMessage && (
          <div className="bg-emerald-500/10 border border-emerald-500/25 p-3 rounded-lg flex items-start gap-2 text-emerald-400 text-xs fade-in">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMessage}</span>
          </div>
        )}

        {step === 'login' ? (
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
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-bold text-zinc-400 uppercase block font-sans">Senha</label>
                <button
                  type="button"
                  onClick={() => {
                    setStep('forgot');
                    setAuthError('');
                    setSuccessMessage('');
                  }}
                  disabled={isSaving}
                  className="text-[10px] text-barber-accent hover:text-barber-accent-light transition-colors font-semibold"
                >
                  Esqueci a senha?
                </button>
              </div>
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
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-barber-accent hover:bg-barber-accent-hover text-white py-3.5 rounded-xl font-bold text-xs shadow-lg uppercase tracking-wider transition-all disabled:opacity-50 active:scale-[0.98] mt-2"
            >
              {isSaving ? 'Acessando...' : 'Acessar Minha Carteira'}
            </button>
          </form>
        ) : (
          /* VIEW: FORGOT PASSWORD FORM */
          <form onSubmit={handleRequestReset} className="space-y-4">
            <p className="text-xs text-zinc-400 text-center leading-relaxed">
              Informe seu e-mail cadastrado. Enviaremos um link seguro para você redefinir a sua senha de acesso.
            </p>

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

            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-barber-accent hover:bg-barber-accent-hover text-white py-3.5 rounded-xl font-bold text-xs shadow-lg uppercase tracking-wider transition-all disabled:opacity-50 active:scale-[0.98] mt-2"
            >
              {isSaving ? 'Enviando...' : 'Enviar Link de Recuperação'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('login');
                setAuthError('');
                setSuccessMessage('');
              }}
              disabled={isSaving}
              className="w-full text-zinc-400 hover:text-zinc-300 py-2 font-bold text-[11px] uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Voltar ao login
            </button>
          </form>
        )}

      </div>
    </div>
  );
}
