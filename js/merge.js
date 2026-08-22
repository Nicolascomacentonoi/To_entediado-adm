// merge.js — combina o banco de dados pessoal (js/database.json) com dados
// "objetivos" buscados ao vivo na API da AniList, usando cache de 24h no
// localStorage pra não estourar o limite de requisições.

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const CACHE_PREFIX = 'anilist_cache_v1_';

function getCached(id) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + id);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function setCached(id, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({ data, ts: Date.now() }));
  } catch (e) {
    // localStorage cheio ou indisponível — segue sem cache, sem quebrar o site
  }
}

async function fetchAniListByIds(ids) {
  const query = `query ($ids: [Int]) {
    Page(perPage: 50) {
      media(id_in: $ids, type: ANIME) {
        id
        title { romaji english native }
        coverImage { large }
        episodes
        seasonYear
      }
    }
  }`;
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables: { ids } })
  });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '30', 10);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return fetchAniListByIds(ids);
  }
  if (!res.ok) throw new Error('Erro ao consultar a AniList: HTTP ' + res.status);
  const json = await res.json();
  return json?.data?.Page?.media || [];
}

async function getAniListDataForIds(allIds) {
  const result = new Map();
  const missing = [];

  for (const id of allIds) {
    const cached = getCached(id);
    if (cached) result.set(id, cached);
    else missing.push(id);
  }

  const CHUNK = 50; // limite seguro por requisição
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const media = await fetchAniListByIds(chunk);
    for (const m of media) {
      result.set(m.id, m);
      setCached(m.id, m);
    }
  }
  return result;
}

// combina várias entradas da AniList (várias temporadas) num único resumo
function combineAniListEntries(entries) {
  if (entries.length === 0) return null;
  const first = entries[0]; // sempre o primeiro ID da lista id_anilist, na ordem que você escreveu
  const totalEpisodes = entries.reduce((sum, e) => sum + (e.episodes || 0), 0);

  return {
    titulo: first.title?.english || first.title?.romaji || first.title?.native,
    titulo_romaji: first.title?.romaji,
    capa: first.coverImage?.large || null,
    episodios: totalEpisodes || null,
    ano: first.seasonYear || null
  };
}

// função principal: carrega o banco local + AniList e devolve a lista mesclada
async function getMergedCatalog() {
  const res = await fetch('js/database.json');
  if (!res.ok) throw new Error('Não consegui carregar js/database.json');
  const db = await res.json();

  const allIds = [];
  for (const a of db.animes) {
    for (const id of (a.id_anilist || [])) allIds.push(id);
  }
  const uniqueIds = [...new Set(allIds)];
  const aniListMap = await getAniListDataForIds(uniqueIds);

  return db.animes.map(a => {
    const entries = (a.id_anilist || []).map(id => aniListMap.get(id)).filter(Boolean);
    const combined = combineAniListEntries(entries);
    const temporadas = entries.map(e => ({
      id: e.id,
      titulo: e.title?.english || e.title?.romaji || e.title?.native,
      capa: e.coverImage?.large || null,
      episodios: e.episodes ?? null
    }));

    const temEpisodiosForcado = a.manual_episodios !== null && a.manual_episodios !== undefined;
    const temAlgumForcado = !!(a.manual_titulo || a.manual_capa || temEpisodiosForcado || a.manual_ano || a.manual_status);

    return {
      ...a,
      titulo: a.manual_titulo || combined?.titulo || a.titulo_referencia,
      titulo_romaji: a.manual_titulo || combined?.titulo_romaji || a.titulo_referencia,
      capa: a.manual_capa || combined?.capa || null,
      episodios: temEpisodiosForcado ? a.manual_episodios : (combined?.episodios ?? null),
      status: a.manual_status || null,
      ano: a.manual_ano || combined?.ano || null,
      temporadas,
      dados_incompletos: !combined && !temAlgumForcado,
      dados_manuais: temAlgumForcado
    };
  });
}
