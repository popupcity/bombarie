document.addEventListener('click', (event) => {
  const chosen = (event.target as Element).closest<HTMLButtonElement>('[data-scheme-choice]');
  if (!chosen) return;
  const value = chosen.dataset.schemeChoice ?? 'auto';
  document.cookie = `${chosen.dataset.cookie}=${value}; path=/; max-age=31536000; samesite=lax`;
  if (value === 'auto') delete document.documentElement.dataset.scheme;
  else document.documentElement.dataset.scheme = value;
  for (const other of document.querySelectorAll('[data-scheme-choice]')) other.setAttribute('aria-pressed', String(other === chosen));
});
