import { createClient } from '@supabase/supabase-js';
import { getAuthedContext } from './supabaseServer.js';

export class AccessError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function requireSuperAdmin(actor) {
  if (!actor?.ativo || actor.role !== 'super_admin') throw new AccessError('Acesso exclusivo do super admin.', 403);
}
export function authorizeWorkspace(actor, workspace) {
  if (!workspace) throw new AccessError('Barbearia não encontrada.', 404);
  if (actor.role === 'super_admin' && actor.ativo) return;
  if (!actor.ativo || actor.role !== 'dono' || actor.barbearia_id !== workspace.id || workspace.owner_id !== actor.id || workspace.plano !== 'barbearia' || workspace.status === 'suspended') {
    throw new AccessError('Você não tem permissão para gerenciar esta barbearia.', 403);
  }
}
export function accountInput(body) {
  const nome = String(body.nome || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (nome.length < 2 || nome.length > 120) throw new AccessError('Informe um nome entre 2 e 120 caracteres.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AccessError('Informe um e-mail válido.');
  if (password.length < 10 || password.length > 72) throw new AccessError('Use uma senha de 10 a 72 caracteres.');
  return { nome, email, password };
}
export function workspaceInput(body) {
  const nome = String(body.workspaceName || '').trim();
  const plano = body.plano;
  const limite = Number(body.limiteBarbeiros);
  if (nome.length < 2 || nome.length > 120) throw new AccessError('Informe o nome da barbearia.');
  if (!['individual', 'barbearia'].includes(plano)) throw new AccessError('Plano inválido.');
  if (!Number.isInteger(limite) || limite < 1 || limite > 100 || (plano === 'individual' && limite !== 1)) throw new AccessError('Confira o limite de acessos do plano.');
  return { nome, plano, limite_barbeiros: limite };
}
export function unwrap(result) {
  if (result.error) {
    const { code, message = '' } = result.error;
    if (code === '42501') throw new AccessError('Acesso não autorizado.', 403);
    if (code === '23514') throw new AccessError(message.includes('Limite') || message.includes('limite') ? 'Limite de acessos atingido. Desative um acesso ou ajuste o plano.' : 'Desative acessos antes de reduzir o plano.', 409);
    if (code === '23505') throw new AccessError('Este cadastro já existe.', 409);
    throw result.error;
  }
  return result.data;
}
export async function getManagementContext(req) {
  const ctx = await getAuthedContext(req);
  if (ctx.error) throw new AccessError(ctx.error, 401);
  const actor = unwrap(await ctx.supabase.from('usuarios').select('id,role,ativo,barbearia_id').eq('id', ctx.user.id).maybeSingle());
  if (!actor?.ativo || !['super_admin', 'dono'].includes(actor.role)) throw new AccessError('Acesso restrito à administração.', 403);
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('Administração não configurada.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return { actor, admin };
}
export async function getBillingContext(req) {
  const ctx = await getManagementContext(req);
  requireSuperAdmin(ctx.actor);
  return { ...ctx, supabase: ctx.admin };
}
export async function provisionAccount(admin, actor, workspace, input, role) {
  authorizeWorkspace(actor, workspace);
  // The requested role is derived by the server, never by account metadata.
  if (actor.role !== 'super_admin' && role !== 'barbeiro') throw new AccessError('Perfil não autorizado.', 403);
  const reservation = unwrap(await admin.rpc('reserve_workspace_account', { p_actor: actor.id, p_workspace: workspace.id, p_role: role }));
  let userId;
  let finished = false;
  try {
    const { data, error } = await admin.auth.admin.createUser({ email: input.email, password: input.password, email_confirm: true, user_metadata: { nome: input.nome } });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) throw new AccessError('Este e-mail já possui uma conta. Use outro e-mail ou recupere o acesso existente.', 409);
      if (error.status >= 400 && error.status < 500) throw new AccessError('Não foi possível criar a conta. Confira o e-mail e use uma senha mais forte.', 422);
      throw error;
    }
    userId = data.user.id;
    unwrap(await admin.rpc('finish_workspace_account', { p_actor: actor.id, p_reservation: reservation, p_user: userId, p_name: input.nome, p_email: input.email }));
    finished = true;
    return { id: userId, nome: input.nome, email: input.email, role };
  } catch (error) {
    // Never delete an account that has already been activated, including an ambiguous network response.
    if (userId && !finished) {
      const profile = await admin.from('usuarios').select('ativo,barbearia_id').eq('id', userId).maybeSingle();
      if (!profile.error && profile.data && !profile.data.ativo && !profile.data.barbearia_id) {
        const cleanup = await admin.auth.admin.deleteUser(userId);
        if (cleanup.error) throw new Error('Falha ao desfazer provisionamento. Requer revisão administrativa.');
      }
    }
    throw error;
  } finally {
    const cleanup = await admin.rpc('cancel_workspace_reservation', { p_actor: actor.id, p_reservation: reservation });
    if (cleanup.error) console.error('workspace.reservation_cleanup_failed');
  }
}
