export const ROLES = Object.freeze({ SUPER_ADMIN:'super_admin', OWNER:'dono', BARBER:'barbeiro' });
export function normalizeRole(role) { return role === 'admin' ? ROLES.SUPER_ADMIN : role; }
export function homeFor(role) {
  const normalized=normalizeRole(role);
  return normalized===ROLES.SUPER_ADMIN ? '/admin' : normalized===ROLES.OWNER ? '/barbearia' : normalized===ROLES.BARBER ? '/dashboard' : '/login';
}
export function isSuperAdmin(user) { return normalizeRole(user?.role)===ROLES.SUPER_ADMIN; }
export function canManageWorkspace(user) { return isSuperAdmin(user)||user?.role===ROLES.OWNER; }
export function parseServices(value, fallback=[]) {
  if(Array.isArray(value)) return value;
  try {const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:fallback;} catch{return fallback;}
}
export const DEFAULT_SERVICES=[{name:'Corte',duration:40,price:'R$ 40,00'},{name:'Barba',duration:30,price:'R$ 30,00'},{name:'Corte + Barba',duration:60,price:'R$ 60,00'},{name:'Sobrancelha',duration:20,price:'R$ 15,00'}];
export function mapUser(user) {
  if(!user)return null;
  const workspace=user.barbearias;
  return {id:user.id,nome:user.nome,email:user.email,role:normalizeRole(user.role),
    barbeariaId:user.barbearia_id,barbeariaName:workspace?.nome||user.barbearia_name,
    workspaceStatus:workspace?.status,plano:workspace?.plano,ativo:user.ativo!==false,
    limiteBarbeiros:workspace?.limite_barbeiros,cpfCnpj:user.cpf_cnpj||'',asaasCustomerId:user.asaas_customer_id||null,
    telefone:user.telefone||'',horaInicio:user.hora_inicio||'08:00',horaFim:user.hora_fim||'20:00',
    modeloAtendimento:user.modelo_atendimento||'agenda',statusFila:user.status_fila||'disponivel',
    servicosConfig:parseServices(user.servicos_config,DEFAULT_SERVICES)};
}
