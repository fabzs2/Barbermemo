import React, {createContext,useContext,useEffect,useState} from 'react';
import {db,supabase} from '../db';
const AuthContext=createContext(null);
export function AuthProvider({children}) {
  const [currentUser,setCurrentUser]=useState(null);
  const [authLoading,setAuthLoading]=useState(true);
  const [authError,setAuthError]=useState('');
  useEffect(()=>{
    let mounted=true,version=0;
    async function hydrate(session) {
      const request=++version;
      try {
        const profile=session?await db.getProfile(session.user.id):null;
        if(!mounted||request!==version)return;
        if(profile?.ativo && profile.workspaceStatus!=='suspended')setCurrentUser(profile);
        else {setCurrentUser(null);if(session)setAuthError('Seu acesso está pausado ou ainda não foi liberado. Fale com o responsável.');}
      } catch {if(mounted&&request===version){setCurrentUser(null);setAuthError('Não foi possível carregar seu acesso. Tente novamente.');}}
      finally {if(mounted&&request===version)setAuthLoading(false);}
    }
    supabase.auth.getSession().then(({data:{session}})=>hydrate(session)).catch(()=>{if(mounted){setAuthLoading(false);setAuthError('Não foi possível recuperar sua sessão.');}});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
      // Do not await Supabase calls inside its auth lock.
      setTimeout(()=>{if(mounted)hydrate(session);},0);
    });
    return ()=>{mounted=false;version++;subscription.unsubscribe();};
  },[]);
  const login=async(email,password)=>{
    setAuthError('');
    try {const user=await db.login(email,password);setCurrentUser(user);return user;}
    catch(error){setAuthError(error.message?.includes('Invalid login credentials')?'E-mail ou senha incorretos.':error.message||'Não foi possível entrar.');throw error;}
  };
  const logout=async()=>{await supabase.auth.signOut();setCurrentUser(null);};
  return <AuthContext.Provider value={{currentUser,setCurrentUser,authLoading,authError,setAuthError,login,logout}}>{children}</AuthContext.Provider>;
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error('AuthProvider ausente.');return value;}
