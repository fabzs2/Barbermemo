// Customer recovery links must always use the public domain, including requests
// initiated from a deployment URL. Vercel deployment hosts can require Vercel SSO.
export const PASSWORD_RECOVERY_URL = 'https://www.barbermemo.com.br/redefinir-senha';

export async function requestPasswordRecovery(client, email) {
  const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: PASSWORD_RECOVERY_URL
  });
  if (error) throw error;
}
