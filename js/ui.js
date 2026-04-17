// Toast efêmero — feedback rápido pra ações em ambiente de evento (barulho, mão única).
// Uso: toast('Venda concluída', { tipo: 'sucesso', vibrar: [40,60,40] });
//      toast('Erro de rede', { tipo: 'erro' });
// Tipos: 'sucesso' | 'erro' | 'info' (default).
const VIBRACOES_PADRAO = {
  sucesso: [40, 60, 40, 60, 80],
  erro:    [100, 50, 100],
  info:    15,
};
export function toast(mensagem, { tipo = 'info', duracao = 3000, vibrar } = {}) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  el.setAttribute('aria-live', tipo === 'erro' ? 'assertive' : 'polite');
  el.textContent = mensagem;
  host.appendChild(el);

  // Vibração háptica — explícita, ou padrão do tipo, ou nada se for false
  const padrao = vibrar === false ? null : (vibrar ?? VIBRACOES_PADRAO[tipo]);
  if (padrao) { try { navigator.vibrate?.(padrao); } catch (_) {} }

  // Permite clicar pra dispensar
  el.addEventListener('click', () => fechar());
  const t = setTimeout(fechar, duracao);
  function fechar() {
    clearTimeout(t);
    el.classList.add('saindo');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }
}

// Modal de confirmação acessível — substitui window.confirm().
// Uso: const ok = await confirmarAsync('Excluir?', { destrutivo: true });
export function confirmarAsync(mensagem, { destrutivo = false, textoOk = 'Confirmar', textoCancelar = 'Cancelar' } = {}) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-msg">
        <p id="confirm-msg" class="confirm-msg"></p>
        <div class="confirm-acoes">
          <button type="button" class="btn btn-secondary" data-acao="cancelar">${textoCancelar}</button>
          <button type="button" class="btn ${destrutivo ? 'btn-danger' : 'btn-primary'}" data-acao="ok">${textoOk}</button>
        </div>
      </div>
    `;
    backdrop.querySelector('#confirm-msg').textContent = mensagem;
    document.body.appendChild(backdrop);

    const btnOk = backdrop.querySelector('[data-acao="ok"]');
    btnOk.focus();

    const fechar = (valor) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(valor);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') fechar(false);
      if (e.key === 'Enter') fechar(true);
    };
    document.addEventListener('keydown', onKey);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) fechar(false);
      const acao = e.target.closest('[data-acao]')?.dataset.acao;
      if (acao === 'ok') fechar(true);
      if (acao === 'cancelar') fechar(false);
    });
  });
}
