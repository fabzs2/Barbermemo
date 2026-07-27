import React, { createContext, useContext, useState, useEffect } from 'react';
import { db, supabase } from '../db';

const parseServicosConfig = (config) => {
  const defaultServices = [
    { name: 'Corte', duration: 40, price: 'R$ 40,00' },
    { name: 'Barba', duration: 30, price: 'R$ 30,00' },
    { name: 'Corte + Barba', duration: 60, price: 'R$ 60,00' },
    { name: 'Sobrancelha', duration: 20, price: 'R$ 15,00' },
    { name: 'Platinado / Luzes', duration: 90, price: 'R$ 120,00' },
    { name: 'Selagem / Progressiva', duration: 120, price: 'R$ 150,00' }
  ];
  if (!config) return defaultServices;
  if (Array.isArray(config)) return config;
  return config.services || defaultServices;
};

const mapUserFromDb = (data) => {
  if (!data) return null;
  const hasConfigObject = data.servicos_config && !Array.isArray(data.servicos_config);
  return {
    id: data.id,
    nome: data.nome,
    email: data.email,
    barbeariaName: data.barbearia_name,
    role: data.role,
    plano: data.plano || (data.role === 'admin' ? 'barbearia' : 'autonomo'),
    statusAssinatura: data.status_assinatura || 'active',
    subscriptionId: data.subscription_id || null,
    cpfCnpj: data.cpf_cnpj || '',
    asaasCustomerId: data.asaas_customer_id || null,
    telefone: data.telefone || '',
    horaInicio: data.hora_inicio || '08:00',
    horaFim: data.hora_fim || '20:00',
    modeloAtendimento: data.modelo_atendimento || 'agenda',
    statusFila: data.status_fila || 'disponivel',
    servicosConfig: parseServicosConfig(data.servicos_config),
    themeColor: (hasConfigObject && data.servicos_config.themeColor) || 'amber',
    templateReminder: (hasConfigObject && data.servicos_config.templateReminder) || '',
    templateBooking: (hasConfigObject && data.servicos_config.templateBooking) || ''
  };
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(
    () => sessionStorage.getItem('isPasswordRecovery') === 'true'
  );

  useEffect(() => {
    // Get active session on startup
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && session.user) {
        supabase
          .from('usuarios')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(({ data, error }) => {
            if (data && !error) {
              setCurrentUser(mapUserFromDb(data));
            }
            setAuthLoading(false);
          });
      } else {
        setAuthLoading(false);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem('isPasswordRecovery', 'true');
        setIsPasswordRecovery(true);
      }

      if (session && session.user) {
        const { data, error } = await supabase
          .from('usuarios')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();
        
        if (data && !error) {
          setCurrentUser(mapUserFromDb(data));
        }
      } else {
        setCurrentUser(null);
      }
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email, senha) => {
    setAuthError('');
    try {
      const session = await db.login(email, senha);
      if (session) {
        setCurrentUser(session);
        return session;
      } else {
        setAuthError('E-mail ou senha incorretos.');
        return null;
      }
    } catch (err) {
      console.error(err);
      if (err.message && err.message.includes('Invalid login credentials')) {
        setAuthError('E-mail ou senha incorretos.');
      } else {
        setAuthError('Erro ao fazer login: ' + (err.message || 'Erro desconhecido.'));
      }
      throw err;
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
      setCurrentUser(null);
      sessionStorage.removeItem('isPasswordRecovery');
      setIsPasswordRecovery(false);
    } catch (err) {
      console.error("Erro ao fazer logout:", err);
    }
  };

  return (
    <AuthContext.Provider value={{ currentUser, setCurrentUser, authLoading, authError, setAuthError, login, logout, isPasswordRecovery, setIsPasswordRecovery }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
}
