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
