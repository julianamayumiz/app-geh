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

// Enhancement progressivo de tabelas: busca por texto + ordenação por coluna.
// Funciona em tabelas reativas (onSnapshot) — usa MutationObserver pra reaplicar
// sort/filtro toda vez que o tbody é repintado.
//
// Tipos detectados pra ordenação: BRL ("R$ 1.234,56"), data dd/mm/yyyy,
// hora hh:mm[:ss], número simples. Cai pra string locale-aware no resto.
//
// Colunas com <th> vazio são tratadas como ações (não viram sortable).
export function enhanceTable(wrapper, { search = true, sort = true, searchPlaceholder = 'Buscar nesta tabela…' } = {}) {
  const table = wrapper.querySelector('table');
  if (!table) return;
  const tbody = table.tBodies[0];
  if (!tbody) return;

  let sortCol = -1;
  let sortDir = 1; // 1 = ascendente, -1 = descendente
  let searchQuery = '';

  if (search) {
    const tools = document.createElement('div');
    tools.className = 'table-toolbar';
    tools.innerHTML = `
      <div class="table-search-wrap">
        <span class="table-search-icon" aria-hidden="true">⌕</span>
        <input type="search" class="table-search" placeholder="${searchPlaceholder}" aria-label="${searchPlaceholder}">
      </div>
      <span class="table-search-count" aria-live="polite"></span>
    `;
    const input = tools.querySelector('input');
    const count = tools.querySelector('.table-search-count');
    input.addEventListener('input', () => {
      searchQuery = input.value.trim().toLowerCase();
      aplicarFiltro(count);
    });
    wrapper.parentNode.insertBefore(tools, wrapper);
  }

  if (sort) {
    const ths = table.tHead?.querySelectorAll('th') || [];
    ths.forEach((th, i) => {
      if (!th.textContent.trim()) return; // colunas de ação
      th.classList.add('th-sortable');
      th.setAttribute('role', 'button');
      th.setAttribute('tabindex', '0');
      const ativar = () => {
        if (sortCol === i) sortDir = -sortDir;
        else { sortCol = i; sortDir = 1; }
        ths.forEach(t => t.removeAttribute('aria-sort'));
        th.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending');
        aplicarSort();
      };
      th.addEventListener('click', ativar);
      th.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ativar(); }
      });
    });
  }

  function valorParaSort(td) {
    if (!td) return '';
    const txt = (td.textContent || '').trim();
    const brl = txt.match(/^R\$\s*([\d.]+),(\d+)/);
    if (brl) return parseFloat(brl[1].replace(/\./g, '') + '.' + brl[2]);
    const dt = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (dt) return new Date(`${dt[3]}-${dt[2]}-${dt[1]}`).getTime();
    const tm = txt.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (tm) return parseInt(tm[1]) * 3600 + parseInt(tm[2]) * 60 + parseInt(tm[3] || 0);
    if (/^-?\d+(\.\d+)?$/.test(txt)) return parseFloat(txt);
    return txt.toLowerCase();
  }

  function aplicarSort() {
    if (sortCol < 0) return;
    const linhas = Array.from(tbody.rows);
    if (linhas.length <= 1) return;
    // Linhas de "carregando..." / empty state usam colspan e não devem ser ordenadas
    if (linhas[0].cells.length === 1 && linhas[0].cells[0].colSpan > 1) return;
    linhas.sort((a, b) => {
      const va = valorParaSort(a.cells[sortCol]);
      const vb = valorParaSort(b.cells[sortCol]);
      if (typeof va === 'string' && typeof vb === 'string') {
        return va.localeCompare(vb, 'pt-BR') * sortDir;
      }
      if (va < vb) return -sortDir;
      if (va > vb) return sortDir;
      return 0;
    });
    linhas.forEach(l => tbody.appendChild(l));
  }

  function aplicarFiltro(count) {
    let visiveis = 0, total = 0;
    Array.from(tbody.rows).forEach(tr => {
      total++;
      if (!searchQuery) { tr.style.display = ''; visiveis++; return; }
      const txt = tr.textContent.toLowerCase();
      const ok = txt.includes(searchQuery);
      tr.style.display = ok ? '' : 'none';
      if (ok) visiveis++;
    });
    if (count) count.textContent = searchQuery ? `${visiveis} de ${total}` : '';
  }

  // Reaplica quando o tbody é repintado (snapshots ao vivo)
  const obs = new MutationObserver(() => {
    aplicarSort();
    if (searchQuery) {
      const count = wrapper.parentNode.querySelector('.table-search-count');
      aplicarFiltro(count);
    }
  });
  obs.observe(tbody, { childList: true });
}

// Auto-aplica em todas as .table-wrapper da página (opt-out via data-no-enhance).
export function enhanceAllTables(root = document) {
  root.querySelectorAll('.table-wrapper:not([data-no-enhance])').forEach(w => {
    if (w.dataset.enhanced) return;
    w.dataset.enhanced = '1';
    enhanceTable(w);
  });
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
