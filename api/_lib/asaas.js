export function asaasEnvironment() {
  const key=process.env.ASAAS_API_KEY || process.env.VITE_ASAAS_API_KEY;
  if(!key)return 'unconfigured';
  try {
    const host=new URL(process.env.ASAAS_API_URL || process.env.VITE_ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3').hostname;
    if(['api.asaas.com','www.asaas.com'].includes(host))return 'production';
    if(['api-sandbox.asaas.com','sandbox.asaas.com'].includes(host))return 'sandbox';
  }catch{}
  return 'unconfigured';
}

export function asaasApiUrl() {
  const url=new URL(process.env.ASAAS_API_URL || process.env.VITE_ASAAS_API_URL || 'https://api-sandbox.asaas.com/v3');
  if(url.protocol!=='https:' || !['www.asaas.com','api.asaas.com','sandbox.asaas.com','api-sandbox.asaas.com'].includes(url.hostname))throw new Error('Configure an official HTTPS Asaas API URL.');
  return ['www.asaas.com','api.asaas.com'].includes(url.hostname)?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3';
}

export async function asaasFetch(path, options = {}) {
  const apiUrl = asaasApiUrl();
  const apiKey = (process.env.ASAAS_API_KEY || process.env.VITE_ASAAS_API_KEY || '').trim();

  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      // Asaas rejects requests without a User-Agent (returns invalid_access_token
      // instead of a clearer error), and Node's fetch sends none by default.
      'User-Agent': 'Barbermemo/1.0',
      access_token: apiKey,
      ...options.headers
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data?.errors?.map((e) => e.description).join(' ') || 'Erro na comunicação com o Asaas.';
    const err = new Error(message);
    err.asaasErrors = data?.errors;
    err.status = res.status;
    throw err;
  }

  return data;
}


// Creates or updates the Asaas customer for a local `cliente` / `usuarios` row.
export async function upsertAsaasCustomer(cliente) {
  const cleanCpfCnpj = cliente.cpf_cnpj ? String(cliente.cpf_cnpj).replace(/\D/g, '') : undefined;
  const cleanPhone = cliente.telefone ? String(cliente.telefone).replace(/\D/g, '') : undefined;

  const payload = {
    name: cliente.nome,
    cpfCnpj: cleanCpfCnpj || undefined,
    email: cliente.email || undefined,
    mobilePhone: cleanPhone || undefined,
    externalReference: cliente.id
  };

  if (cliente.asaas_customer_id) {
    return asaasFetch(`/customers/${cliente.asaas_customer_id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  return asaasFetch('/customers', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// Lists subscriptions linked to an Asaas customer.
export async function getSubscriptionsByCustomer(customerId) {
  const data = await asaasFetch(`/subscriptions?customer=${encodeURIComponent(customerId)}`);
  return data?.data || [];
}

// Pushes a subscription's next charge date out, used to grant a free trial
// window on an already-created subscription (Asaas has no separate trial field).
export async function updateSubscriptionNextDueDate(subscriptionId, nextDueDate) {
  return asaasFetch(`/subscriptions/${subscriptionId}`, {
    method: 'PUT',
    body: JSON.stringify({ nextDueDate })
  });
}

