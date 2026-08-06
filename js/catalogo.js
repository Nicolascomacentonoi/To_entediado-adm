// catalogo.js — renderiza o grid, aplica filtros/busca/ordenação e controla o modal.

let allAnimes = [];
let filteredAnimes = [];
let sortDescending = false;

// estado do filtro de gênero: 'include' | 'exclude' (ausente = neutro)
const generoFiltroState = new Map();
// dublagem, classificação e prioridade: simples conjunto de valores selecionados (OR entre eles)
const dublagemFiltroState = new Set();
const classificacaoFiltroState = new Set();
const recomendacaoFiltroState = new Set();
const ondeVerFiltroState = new Set();
const statusFiltroState = new Set();

// descrições carregadas de js/generos.json e js/recomendacoes.json (pros tooltips de hover)
let generoDescricoes = new Map();
let recomendacaoDescricoes = new Map();
let classificacaoDescricoes = new Map();

const TIER_COLORS = {
  'Máxima prioridade': '#025ff4', // azul
  'Alta prioridade': '#00ff5e',   // verde
  'Média prioridade': '#fff200',  // amarelo
  'Baixa prioridade': '#ff6a00',  // laranja
  'Não veja': '#ff0000',          // vermelho
  'Chinês': '#270101',            // vermelho escuro
  'Veja o mangá': '#9ca3af',      // cinza
  'Veja o filme': '#443199'       // roxo
};

const TIER_ORDER = [
  'Máxima prioridade', 'Alta prioridade', 'Média prioridade',
  'Baixa prioridade', 'Não veja', 'Chinês', 'Veja o mangá', 'Veja o filme'
];

function tierColor(rec) {
  return TIER_COLORS[rec] || '#6b7280';
}

// --- tooltip de descrição (aparece depois de 2s parado em cima do elemento) ---
const tooltipEl = document.createElement('div');
tooltipEl.className = 'hover-tooltip hidden';
document.body.appendChild(tooltipEl);
let tooltipTimer = null;

function attachTooltip(el, descricao) {
  // aceita tanto uma string simples (dublagem/classificação/prioridade)
  // quanto um objeto { texto, imagem } (gêneros, que agora podem ter imagem)
  const desc = typeof descricao === 'string' ? { texto: descricao } : descricao;
  if (!desc || (!desc.texto && !desc.imagem)) return; // sem descrição cadastrada ainda, não faz nada
  el.addEventListener('mouseenter', () => {
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => showTooltip(el, desc), 800);
  });
  el.addEventListener('mouseleave', () => {
    clearTimeout(tooltipTimer);
    hideTooltip();
  });
}

function showTooltip(el, desc) {
  const rect = el.getBoundingClientRect();
  let html = ''; 
  if (desc.texto) html += `<div>${desc.texto}</div>`;
  if (desc.imagem) html += `<img class="tooltip-img" src="${desc.imagem}" alt="">`;
  tooltipEl.innerHTML = html;
  tooltipEl.style.left = (rect.left + window.scrollX) + 'px';
  tooltipEl.style.top = (rect.bottom + window.scrollY + 8) + 'px';
  tooltipEl.classList.remove('hidden');
}

function hideTooltip() {
  tooltipEl.classList.add('hidden');
}

async function carregarDescricoes() {
  try {
    const [genRes, recRes, classRes] = await Promise.all([
      fetch('js/generos.json'),
      fetch('js/recomendacoes.json'),
      fetch('js/classificacoes.json')
    ]);
    const genData = await genRes.json();
    (genData.generos || []).forEach(g => {
      const texto = g['Descrição'] || '';
      const imagem = g['Imagem'] || '';
      if (texto || imagem) generoDescricoes.set(g.Nome, { texto, imagem });
    });
    const recData = await recRes.json();
    const recObj = (recData['recomendações'] || [])[0] || {};
    Object.entries(recObj).forEach(([tier, desc]) => {
      if (desc) recomendacaoDescricoes.set(tier, desc);
    });
    const classData = await classRes.json();
    (classData.classificacoes || []).forEach(c => {
      if (c['Descrição']) classificacaoDescricoes.set(c.Nome, c['Descrição']);
    });
  } catch (e) {
    console.warn('Não consegui carregar as descrições de gêneros/prioridades:', e);
  }
}

// converte "dd/mm/aaaa" pra um número comparável (aaaammdd); sem data vira 0 (fica sempre no início/fim)
function dataParaOrdenacao(dataStr) {
  if (!dataStr) return 0;
  const [dia, mes, ano] = dataStr.split('/').map(Number);
  if (!dia || !mes || !ano) return 0;
  return ano * 10000 + mes * 100 + dia;
}

async function init() {
  const loadingEl = document.getElementById('loading');
  try {
    allAnimes = await getMergedCatalog();
  } catch (e) {
    loadingEl.textContent = 'Erro ao carregar o catálogo: ' + e.message;
    return;
  }
  loadingEl.classList.add('hidden');

  await carregarDescricoes();
  populateFilterPanel();

  const params = new URLSearchParams(location.search);
  const buscaInicial = params.get('busca');
  if (buscaInicial) document.getElementById('searchInput').value = buscaInicial;

  applyFiltersAndRender();
}

function populateFilterPanel() {
  // prioridade (valores fixos do TIER_ORDER, clique simples pra incluir/remover)
  const prioridadeWrap = document.getElementById('prioridadeChips');
  TIER_ORDER.forEach(tier => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'genre-chip';
    chip.textContent = tier;
    chip.addEventListener('click', () => toggleSimpleFilter(recomendacaoFiltroState, tier, chip));
    attachTooltip(chip, recomendacaoDescricoes.get(tier));
    prioridadeWrap.appendChild(chip);
  });

  // gêneros (3 estados: neutro / incluir / excluir)
  const generosSet = new Set();
  allAnimes.forEach(a => (a.generos || []).forEach(g => generosSet.add(g)));
  const genreWrap = document.getElementById('genreChips');
  [...generosSet].sort().forEach(g => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'genre-chip';
    chip.textContent = g;
    chip.addEventListener('click', () => cycleGenreState(g, chip));
    attachTooltip(chip, generoDescricoes.get(g));
    genreWrap.appendChild(chip);
  });

  // dublagem (valores fixos, clique simples pra incluir/remover)
  const dublagemValores = ['dublado', 'dublagem incompleta', 'não dublado'];
  const dublagemWrap = document.getElementById('dublagemChips');
  dublagemValores.forEach(valor => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'genre-chip';
    chip.textContent = valor;
    chip.addEventListener('click', () => toggleSimpleFilter(dublagemFiltroState, valor, chip));
    dublagemWrap.appendChild(chip);
  });

  // status (valores dinâmicos, extraídos do campo status de cada anime)
  const statusSet = new Set();
  allAnimes.forEach(a => { if (a.status) statusSet.add(a.status); });
  const statusWrap = document.getElementById('statusChips');
  [...statusSet].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(valor => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'genre-chip';
    chip.textContent = valor;
    chip.addEventListener('click', () => toggleSimpleFilter(statusFiltroState, valor, chip));
    statusWrap.appendChild(chip);
  });

  // classificação indicativa (valores dinâmicos, ordenados com "Livre" primeiro e depois numericamente)
  const classifSet = new Set();
  allAnimes.forEach(a => { if (a.classificacao_indicativa) classifSet.add(String(a.classificacao_indicativa)); });
  const classifOrdenados = [...classifSet].sort((a, b) => {
    if (a === 'Livre') return -1;
    if (b === 'Livre') return 1;
    return Number(a) - Number(b);
  });
  const classifWrap = document.getElementById('classificacaoChips');
  classifOrdenados.forEach(valor => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'genre-chip';
    chip.textContent = valor;
    chip.addEventListener('click', () => toggleSimpleFilter(classificacaoFiltroState, valor, chip));
    attachTooltip(chip, classificacaoDescricoes.get(valor));
    classifWrap.appendChild(chip);
  });

  // onde ver (valores dinâmicos, extraídos das plataformas cadastradas em cada anime)
  const ondeVerSet = new Set();
  allAnimes.forEach(a => (a.onde_ver || []).forEach(p => ondeVerSet.add(p)));
  const ondeVerWrap = document.getElementById('ondeVerChips');
  [...ondeVerSet].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(plataforma => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'genre-chip';
    chip.textContent = plataforma;
    chip.addEventListener('click', () => toggleSimpleFilter(ondeVerFiltroState, plataforma, chip));
    ondeVerWrap.appendChild(chip);
  });
}

function updateFiltroActiveCount() {
  const total = generoFiltroState.size + dublagemFiltroState.size + classificacaoFiltroState.size + recomendacaoFiltroState.size + ondeVerFiltroState.size + statusFiltroState.size;
  document.getElementById('filtroActiveCount').textContent = total ? `(${total})` : '';
}

function toggleSimpleFilter(stateSet, valor, chipEl) {
  if (stateSet.has(valor)) {
    stateSet.delete(valor);
    delete chipEl.dataset.state;
  } else {
    stateSet.add(valor);
    chipEl.dataset.state = 'include';
  }
  updateFiltroActiveCount();
  applyFiltersAndRender();
}

function cycleGenreState(genero, chipEl) {
  const atual = generoFiltroState.get(genero);
  let proximo;
  if (!atual) proximo = 'include';
  else if (atual === 'include') proximo = 'exclude';
  else proximo = null;

  if (proximo) {
    generoFiltroState.set(genero, proximo);
    chipEl.dataset.state = proximo;
  } else {
    generoFiltroState.delete(genero);
    delete chipEl.dataset.state;
  }

  updateFiltroActiveCount();
  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  const busca = document.getElementById('searchInput').value.trim().toLowerCase();
  const ordenar = document.getElementById('sortSelect').value;

  const generosIncluir = [...generoFiltroState.entries()].filter(([, s]) => s === 'include').map(([g]) => g);
  const generosExcluir = [...generoFiltroState.entries()].filter(([, s]) => s === 'exclude').map(([g]) => g);

  filteredAnimes = allAnimes.filter(a => {
    if (busca) {
      const estudioStr = Array.isArray(a.estudio) ? a.estudio.join(' ') : (a.estudio || '');
      const alvo = `${a.titulo || ''} ${a.titulo_romaji || ''} ${a.titulo_referencia || ''} ${estudioStr}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    if (dublagemFiltroState.size > 0 && !dublagemFiltroState.has(a.dublagem)) return false;
    if (statusFiltroState.size > 0 && !statusFiltroState.has(a.status)) return false;
    if (classificacaoFiltroState.size > 0 && !classificacaoFiltroState.has(String(a.classificacao_indicativa))) return false;
    if (recomendacaoFiltroState.size > 0 && !recomendacaoFiltroState.has(a.recomendacao)) return false;
    if (ondeVerFiltroState.size > 0) {
      const plataformasAnime = a.onde_ver || [];
      if (!plataformasAnime.some(p => ondeVerFiltroState.has(p))) return false;
    }

    const generosAnime = a.generos || [];
    if (generosIncluir.length > 0 && !generosIncluir.every(g => generosAnime.includes(g))) return false;
    if (generosExcluir.length > 0 && generosExcluir.some(g => generosAnime.includes(g))) return false;

    return true;
  });

  filteredAnimes.sort((a, b) => {
    let cmp = 0;
    if (ordenar === 'alfabetica') cmp = (a.titulo || '').localeCompare(b.titulo || '', 'pt-BR');
    else if (ordenar === 'episodios') cmp = (a.episodios || 0) - (b.episodios || 0);
    else if (ordenar === 'prioridade') cmp = TIER_ORDER.indexOf(a.recomendacao) - TIER_ORDER.indexOf(b.recomendacao);
    else if (ordenar === 'lancamento') cmp = dataParaOrdenacao(a.data_lancamento) - dataParaOrdenacao(b.data_lancamento);
    return sortDescending ? -cmp : cmp;
  });

  renderGrid();
}

function renderGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  document.getElementById('resultCount').textContent = `${filteredAnimes.length} anime(s)`;

  if (filteredAnimes.length === 0) {
    grid.innerHTML = '<p class="col-span-full text-center opacity-60 py-16">Nenhum anime encontrado com esses filtros.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  filteredAnimes.forEach(a => {
    const card = document.createElement('div');
    card.className = 'cursor-pointer rounded-lg overflow-hidden border-2 hover:scale-[1.03] transition-transform';
    card.style.borderColor = tierColor(a.recomendacao);
    card.style.background = 'var(--color-surface)';

    const capaHtml = a.capa
      ? `<img src="${a.capa}" class="w-full aspect-[2/3] object-cover" loading="lazy" alt="${a.titulo || a.titulo_referencia}">`
      : `<div class="w-full aspect-[2/3] flex items-center justify-center text-[11px] opacity-70 p-2 text-center">${a.titulo_referencia}</div>`;

    card.innerHTML = `
      ${capaHtml}
      <div class="p-2">
        <p class="text-xs sm:text-sm font-semibold truncate">${a.titulo || a.titulo_referencia}</p>
      </div>`;
    card.addEventListener('click', () => openModal(a));
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

function setRow(rowId, spanId, value, formatter, useHTML) {
  const row = document.getElementById(rowId);
  const span = document.getElementById(spanId);
  const vazio = value === null || value === undefined || value === '' ||
    (Array.isArray(value) && value.length === 0) || value === 0;
  if (vazio) {
    row.classList.add('hidden');
    return;
  }
  row.classList.remove('hidden');
  const resultado = formatter ? formatter(value) : value;
  if (useHTML) span.innerHTML = resultado;
  else span.textContent = resultado;
}

function openModal(a) {
  const capaEl = document.getElementById('modalCapa');
  if (a.capa) {
    capaEl.src = a.capa;
    capaEl.classList.remove('hidden');
  } else {
    capaEl.classList.add('hidden');
  }

  document.getElementById('modalTitulo').textContent = a.titulo || a.titulo_referencia;

  const recEl = document.getElementById('modalRecomendacao');
  recEl.textContent = a.recomendacao || 'Sem avaliação definida';
  recEl.style.color = tierColor(a.recomendacao);

  const avisoManualEl = document.getElementById('modalAvisoManual');
  avisoManualEl.classList.toggle('hidden', !a.dados_manuais);

  const sinopseEl = document.getElementById('modalSinopse');
  if (a.sinopse) {
    sinopseEl.textContent = a.sinopse;
    sinopseEl.classList.remove('hidden');
  } else {
    sinopseEl.classList.add('hidden');
  }

  setRow('rowEpisodios', 'modalEpisodios', a.episodios);
  setRow('rowStatus', 'modalStatus', a.status);
  setRow('rowFilmes', 'modalFilmes', a.filmes);
  setRow('rowDublagem', 'modalDublagem', a.dublagem);
  setRow('rowLancamento', 'modalLancamento', a.data_lancamento);
  setRow('rowEstudio', 'modalEstudio', a.estudio, (v) => Array.isArray(v) ? v.join(', ') : v);
  setRow('rowClassificacao', 'modalClassificacao', a.classificacao_indicativa);
  setRow('rowGeneros', 'modalGeneros', a.generos, (v) => {
    const [principal, ...resto] = v;
    const principalHtml = `<strong style="color:#22c55e">${principal}</strong>`;
    return resto.length ? `${principalHtml}, ${resto.join(', ')}` : principalHtml;
  }, true);
  setRow('rowOndeVer', 'modalOndeVer', a.onde_ver, (v) => v.join(', '));

  const ordemBtn = document.getElementById('ordemBtn');
  const temOrdem = a.ordem && Array.isArray(a.ordem.sequencia) && a.ordem.sequencia.length > 0;
  ordemBtn.classList.toggle('hidden', !temOrdem);
  ordemBtn.onclick = () => openOrdemPanel(a);

  document.getElementById('modalOverlay').classList.remove('hidden');
}

function openOrdemPanel(a) {
  const conselhoEl = document.getElementById('ordemConselho');
  if (a.ordem.conselho) {
    conselhoEl.textContent = '💡 ' + a.ordem.conselho;
    conselhoEl.classList.remove('hidden');
  } else {
    conselhoEl.classList.add('hidden');
  }

  const temporadasPorId = new Map((a.temporadas || []).map(t => [t.id, t]));
  const listaEl = document.getElementById('ordemLista');
  listaEl.innerHTML = '';

  a.ordem.sequencia.forEach((id, index) => {
    const t = temporadasPorId.get(id);
    const item = document.createElement('div');
    item.className = 'ordem-item';
    if (t) {
      item.innerHTML = `
        <span class="ordem-numero">${index + 1}</span>
        ${t.capa ? `<img src="${t.capa}" alt="">` : ''}
        <div class="ordem-info">
          <div class="ordem-titulo">${t.titulo}</div>
          <div class="ordem-eps">${t.episodios ? t.episodios + ' episódios' : 'Nº de episódios não disponível'}</div>
        </div>`;
    } else {
      item.innerHTML = `
        <span class="ordem-numero">${index + 1}</span>
        <div class="ordem-info opacity-60">ID ${id} não encontrado entre as temporadas vinculadas</div>`;
    }
    listaEl.appendChild(item);
  });

  document.getElementById('ordemPanel').classList.add('open');
}

function closeOrdemPanel() {
  document.getElementById('ordemPanel').classList.remove('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  closeOrdemPanel();
}

document.getElementById('searchInput').addEventListener('input', applyFiltersAndRender);
document.getElementById('sortSelect').addEventListener('change', applyFiltersAndRender);
document.getElementById('invertSortBtn').addEventListener('click', () => {
  sortDescending = !sortDescending;
  document.getElementById('invertSortBtn').textContent = sortDescending ? '↑' : '↓';
  applyFiltersAndRender();
});
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});
document.getElementById('ordemPanelClose').addEventListener('click', closeOrdemPanel);

init();
