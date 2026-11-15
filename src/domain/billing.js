export const PLAN_PRICES = Object.freeze({ individual: 5990, barbearia: 18999 });
export const formatMoney = cents => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(cents / 100);
export function brazilDate(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p => [p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function cleanDocument(value) { return String(value || '').replace(/\D/g, ''); }
export function validDocument(value) {
  const text = cleanDocument(value);
  if (!/^(\d{11}|\d{14})$/.test(text) || /^(\d)\1+$/.test(text)) return false;
  const digits = [...text].map(Number);
  if (text.length === 11) {
    for (let length=9;length<=10;length++) {
      const sum=digits.slice(0,length).reduce((total,digit,index)=>total+digit*(length+1-index),0);
      if (((sum*10)%11)%10 !== digits[length]) return false;
    }
  } else {
    for (let length=12;length<=13;length++) {
      const sum=digits.slice(0,length).reduce((total,digit,index)=>total+digit*((length-1-index)%8+2),0);
      const remainder=sum%11;
      if ((remainder<2?0:11-remainder)!==digits[length]) return false;
    }
  }
  return true;
}
