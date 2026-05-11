// Helpers genéricos sem dependência de DOM ou Firebase.
// Use aqui pra qualquer função de formatação/parse que mais de uma página
// precisa — evita duplicar a mesma fórmula em vários HTMLs.

// Formata número como moeda brasileira: 1234.5 → "R$ 1234,50".
// Aceita undefined/null/'' e devolve "R$ 0,00" (não retorna "R$ NaN").
export function fmtBRL(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
}

// Escapa caracteres HTML em uma string pra usar em interpolação de `innerHTML`.
// Sempre use isso quando interpolar valores vindos do Firestore (nome de
// produto/cliente/evento, motivo, etc) em template literals. Sem isso, um
// nome contendo `<img src=x onerror=...>` executaria script no browser.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
