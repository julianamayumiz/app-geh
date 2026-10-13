// ============================================================
// View "inicio" do PDV — menu do operador/caixa dentro da mesma pagina
// ============================================================
// Substitui a ida pra operador/index.html e caixa/index.html: nada recarrega,
// entao a camera (pausada nas outras telas) e a permissao continuam valendo.
// ctx.cfgInicio: { titulo, subtitulo, acoes: [{ href, icone, titulo, sub, estilo }] }
// href que comeca com '#' navega dentro do PDV; qualquer outro vira link normal.
// ============================================================

import { auth, signOut } from '../firebase-config.js';
import { icon, renderIcons } from '../icons.js';
import { esc } from '../helpers.js';

export async function montar(container, ctx) {
  const cfg = ctx.cfgInicio || { titulo: '', subtitulo: '', acoes: [] };
  ctx.setTitulo(cfg.titulo || 'Início');

  const acoesHtml = (cfg.acoes || []).map((a, i) => `
    <a href="${esc(a.href)}" class="btn ${esc(a.estilo || 'btn-secondary')} btn-lg" data-i="${i}">
      <span class="icon-wrap">${icon(a.icone, { size: 22 })}</span>
      <span class="label-wrap">
        <span class="label-principal">${esc(a.titulo)}</span>
        <span class="label-sec">${esc(a.sub || '')}</span>
      </span>
      <span class="seta">${icon('arrow-right', { size: 18 })}</span>
    </a>`).join('');

  container.innerHTML = `
    <div class="evento-hero" id="evento-box">
      <span class="tag" id="evento-tag"><span class="dot"></span> Verificando evento…</span>
      <div class="evento-nome" id="evento-nome"></div>
      <div class="evento-sub" id="evento-sub"></div>
    </div>
    <div class="grid-acoes">${acoesHtml}</div>
    <div class="mt-2">
      <button type="button" class="btn btn-secondary" id="btn-sair">
        ${icon('power', { size: 18 })} Sair
      </button>
    </div>`;
  renderIcons(container);

  const $ = (id) => container.querySelector(`#${id}`);
  let ativo = true;

  container.querySelectorAll('a[data-i]').forEach(a => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) { e.preventDefault(); ctx.ir(href); }
    });
  });

  $('btn-sair').onclick = async () => {
    try { await signOut(auth); } catch (e) { console.warn('[inicio] signOut:', e); }
    window.location.href = '../admin/login.html';
  };

  // Evento ativo (1 leitura; o resto da tela ja esta pronta)
  ctx.getEvento().then(ev => {
    if (!ativo) return;
    const box = $('evento-box');
    const tag = $('evento-tag');
    if (ev && ev.id) {
      tag.innerHTML = '<span class="dot"></span> Evento ativo';
      $('evento-nome').textContent = ev.nome || '';
      $('evento-sub').textContent = cfg.subtitulo || '';
    } else {
      box.classList.add('sem-evento');
      tag.className = 'tag danger';
      tag.innerHTML = '<span class="dot"></span> Sem evento ativo';
      $('evento-nome').textContent = 'Nenhum evento rodando agora';
      $('evento-sub').textContent = 'Avise a diretoria para ativar um evento.';
    }
  });

  return { desmontar() { ativo = false; } };
}
