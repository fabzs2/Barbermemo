import React from 'react';
export default function ErrorFallback({ eventId }) {
  return <main className="min-h-screen bg-barber-dark text-barber-text-primary flex items-center justify-center p-6"><div className="max-w-sm space-y-5"><p className="eyebrow">Barbermemo</p><h1 className="text-2xl">Não foi possível abrir esta tela.</h1><p className="text-sm text-zinc-400">Recarregue para tentar novamente. Se o problema continuar, informe o código abaixo ao suporte.</p>{eventId && <p className="text-xs break-all">Código: {eventId}</p>}<button className="primary-action" onClick={() => window.location.reload()}>Recarregar</button><a href="/dashboard" className="block text-sm underline">Voltar ao painel</a></div></main>;
}
