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
export function enhanceTable(wrapper, { search = true, sort = true, csv = true, searchPlaceholder = 'Buscar nesta tabela…', csvNome } = {}) {
  const table = wrapper.querySelector('table');
  if (!table) return;
  const tbody = table.tBodies[0];
  if (!tbody) return;

  let sortCol = -1;
  let sortDir = 1; // 1 = ascendente, -1 = descendente
  let searchQuery = '';

  if (search || csv) {
    const tools = document.createElement('div');
    tools.className = 'table-toolbar';
    tools.innerHTML = `
      ${search ? `
      <div class="table-search-wrap">
        <span class="table-search-icon" aria-hidden="true">⌕</span>
        <input type="search" class="table-search" placeholder="${searchPlaceholder}" aria-label="${searchPlaceholder}">
      </div>
      <span class="table-search-count" aria-live="polite"></span>` : ''}
      ${csv ? `<button type="button" class="btn-csv" data-csv title="Exportar CSV (visível)">⇩ CSV</button>` : ''}
    `;
    if (search) {
      const input = tools.querySelector('input');
      const count = tools.querySelector('.table-search-count');
      input.addEventListener('input', () => {
        searchQuery = input.value.trim().toLowerCase();
        aplicarFiltro(count);
      });
    }
    if (csv) {
      const btn = tools.querySelector('[data-csv]');
      btn.addEventListener('click', () => {
        const nome = csvNome || (document.title.split('—')[0].trim() || 'tabela')
          .toLowerCase().replace(/\s+/g, '-')
          + '-' + new Date().toISOString().slice(0,10) + '.csv';
        exportarTabelaCSV(table, nome);
      });
    }
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

  // Skeletoniza placeholder inicial, se houver
  aplicarSkeletonNoPlaceholder(tbody);

  // Reaplica quando o tbody é repintado (snapshots ao vivo)
  const obs = new MutationObserver(() => {
    // Se a página voltar a inserir um "Carregando..." (ex: troca de filtro),
    // re-skeletoniza. Caso contrário, aplica sort/filtro normalmente.
    if (aplicarSkeletonNoPlaceholder(tbody)) return;
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

// Substitui linhas "Carregando..." (td colspan ocupando a tabela inteira)
// por linhas-skeleton com base no número de <th>. Reaplica enquanto o
// placeholder estiver presente (até a primeira renderização real).
//
// Marca o tbody com data-skel-armed pra um MutationObserver re-skeletizar
// se a página voltar a colocar um placeholder de carregamento depois.
function aplicarSkeletonNoPlaceholder(tbody) {
  const linhas = Array.from(tbody.rows);
  if (linhas.length !== 1) return false;
  const td = linhas[0].cells[0];
  if (!td || td.colSpan < 2) return false;
  const txt = (td.textContent || '').trim().toLowerCase();
  if (!txt.startsWith('carregando')) return false;

  const cols = td.colSpan;
  const linhasFake = 5;
  const html = Array.from({ length: linhasFake }).map(() => {
    const tds = Array.from({ length: cols }).map((_, i) => {
      // Última coluna geralmente é "ação/valor" → skeleton menor
      const cls = i === cols - 1 ? 'skel skel-pill' : 'skel skel-text';
      return `<td><span class="${cls}" style="width:${50 + Math.random() * 40}%">—</span></td>`;
    }).join('');
    return `<tr class="skel-row">${tds}</tr>`;
  }).join('');
  tbody.innerHTML = html;
  return true;
}

export function skeletonRows(tbody, cols, qtd = 5) {
  if (!tbody) return;
  const html = Array.from({ length: qtd }).map(() => {
    const tds = Array.from({ length: cols }).map((_, i) => {
      const cls = i === cols - 1 ? 'skel skel-pill' : 'skel skel-text';
      return `<td><span class="${cls}" style="width:${50 + Math.random() * 40}%">—</span></td>`;
    }).join('');
    return `<tr class="skel-row">${tds}</tr>`;
  }).join('');
  tbody.innerHTML = html;
}

// Auto-skeletoniza placeholders de "Carregando..." em todas as tabelas.
// Chamado pelo _nav.js após enhanceAllTables.
export function autoSkeleton(root = document) {
  root.querySelectorAll('table tbody').forEach(tbody => {
    aplicarSkeletonNoPlaceholder(tbody);
  });
}

// Exporta o conteúdo visível (filtrado) de uma tabela como CSV.
// Lida com BOM pra Excel abrir UTF-8 corretamente.
export function exportarTabelaCSV(table, nomeArquivo = 'tabela.csv') {
  const cabecalhos = Array.from(table.tHead?.querySelectorAll('th') || [])
    .map(th => th.textContent.trim());
  const linhas = Array.from(table.tBodies[0]?.rows || [])
    .filter(tr => tr.style.display !== 'none' && !tr.classList.contains('skel-row'))
    .map(tr => Array.from(tr.cells).map(td => td.textContent.trim().replace(/\s+/g, ' ')));
  const csv = [cabecalhos, ...linhas]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

// Modal de detalhes genérico — recebe HTML pronto (título + corpo).
// Fecha em backdrop, Esc, ou botão "Fechar". Foco no botão de fechar.
export function abrirDetalhe({ titulo = 'Detalhes', corpo = '' } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop';
  backdrop.innerHTML = `
    <div class="detalhes-modal" role="dialog" aria-modal="true" aria-labelledby="det-titulo">
      <h3 id="det-titulo">${titulo}</h3>
      <div class="det-corpo">${corpo}</div>
      <div class="confirm-acoes" style="margin-top:1.25rem;">
        <button type="button" class="btn btn-primary" data-fechar>Fechar</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const btn = backdrop.querySelector('[data-fechar]');
  btn.focus();
  const fechar = () => { document.removeEventListener('keydown', onKey); backdrop.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-fechar]')) fechar();
  });
  return { fechar, root: backdrop };
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
