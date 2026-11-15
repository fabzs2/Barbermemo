// Run with npm run monitoring:check, monitoring:test or monitoring:telegram.
const mode = process.argv[2] || 'check';
if (mode === 'telegram') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.error('Preencha TELEGRAM_BOT_TOKEN em .env.monitoring.local.'); process.exit(1); }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {signal:AbortSignal.timeout(10000)});
    const data=await response.json();
    if (!response.ok || !data.ok) throw new Error();
    const chats=[...new Set(data.result.map(x=>x.message?.chat).filter(x=>x?.type==='private').map(x=>String(x.id)))];
    console.log(chats.length ? `IDs de conversas privadas encontradas: ${chats.join(', ')}. Copie o seu para TELEGRAM_CHAT_ID.` : 'Abra uma conversa com seu bot, toque em Iniciar, envie uma mensagem e rode novamente.');
  } catch {console.error('Não foi possível consultar o bot. Confira o token e a conexão.');process.exitCode=1;}
} else if (mode === 'test') {
  if (!process.env.SENTRY_DSN) {console.error('Preencha SENTRY_DSN em .env.monitoring.local.');process.exit(1);}
  const Sentry=await import('@sentry/node');
  const {sanitizeEvent}=await import('../monitoring/privacy.js');
  Sentry.init({dsn:process.env.SENTRY_DSN,environment:'production',sendDefaultPii:false,defaultIntegrations:false,beforeSend:sanitizeEvent});
  const id=Sentry.captureException(new Error('Teste controlado do monitoramento Barbermemo'), {tags:{operation:'monitoring.test',source:'manual'}});
  const flushed=await Sentry.flush(5000);
  console.log(`Evento de teste: ${id}. Transporte finalizado: ${flushed}. Confirme a chegada no Sentry e no Telegram; esta saída sozinha não comprova entrega.`);
} else {
  const base=process.env.MONITORING_ORIGIN || 'https://www.barbermemo.com.br';
  try {
    for(const path of ['/login','/api/health']) {
      const response=await fetch(new URL(path,base), {signal:AbortSignal.timeout(10000)});
      const type=response.headers.get('content-type') || '';
      console.log(`${path}: HTTP ${response.status}`);
      if(path==='/api/health') {
        if(!type.includes('application/json')) throw new Error('A rota de saúde não retornou JSON; confira o deploy e as rotas.');
        const data=await response.json(); console.log(JSON.stringify(data));
        if(data.status!=='ok') process.exitCode=1;
      }
      if(!response.ok) process.exitCode=1;
    }
  } catch (error) {console.error(error.message);process.exitCode=1;}
}
