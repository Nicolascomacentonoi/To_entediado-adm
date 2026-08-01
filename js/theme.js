// theme.js — alterna entre tema claro e escuro, salvando a escolha,
// e cuida da transição suave de opacidade entre páginas.

function toggleTheme() {
  document.documentElement.classList.toggle('light');
  const modo = document.documentElement.classList.contains('light') ? 'light' : 'dark';
  localStorage.setItem('to_entediado_theme', modo);
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const isLight = document.documentElement.classList.contains('light');
  btn.textContent = isLight ? '🌙' : '☀️';
  btn.setAttribute('aria-label', isLight ? 'Mudar para modo escuro' : 'Mudar para modo claro');
}

// navega pra outra página com uma pequena transição de fade
function navigateWithFade(url) {
  document.body.classList.add('fading-out');
  setTimeout(() => { window.location.href = url; }, 280);
}

document.addEventListener('DOMContentLoaded', () => {
  updateThemeIcon();
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  const infoBtn = document.getElementById('infoToggle');
  const infoOverlay = document.getElementById('infoOverlay');
  if (infoBtn && infoOverlay) {
    infoBtn.addEventListener('click', () => {
      document.getElementById('infoText').textContent = (typeof INFO_TEXT !== 'undefined' && INFO_TEXT) ? INFO_TEXT : 'Ainda sem descrição pra essa página.';
      infoOverlay.classList.remove('hidden');
    });
    document.getElementById('infoClose').addEventListener('click', () => infoOverlay.classList.add('hidden'));
    infoOverlay.addEventListener('click', (e) => {
      if (e.target.id === 'infoOverlay') infoOverlay.classList.add('hidden');
    });
  }

  // fade-in ao carregar
  requestAnimationFrame(() => {
    document.body.classList.add('loaded');
  });

  // intercepta links internos marcados com data-fade-link pra aplicar a transição
  document.querySelectorAll('[data-fade-link]').forEach(el => {
    el.addEventListener('click', (e) => {
      const href = el.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      e.preventDefault();
      navigateWithFade(href);
    });
  });
});
