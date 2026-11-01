// Monta dist/ com SOMENTE o que deve ser público (Fase 1, sprint 1.1).
// Tudo que não está nesta lista (docs/, migrations/, config/, CLAUDE.md,
// functions/ etc.) não é publicado. Arquivo novo que precise ir ao ar tem
// de entrar aqui de propósito.
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');

const PUBLIC_ENTRIES = [
  'index.html',
  'favicon.svg',
  'partner.png',
  'kommo-badge.png',
  'assets',
  'admin',
  'dash',
  'lp',
  'examples',
  'marketing/lp-usina-tracking',
];

for (const entry of PUBLIC_ENTRIES) {
  const src = join(ROOT, entry);
  if (!existsSync(src)) {
    console.warn(`copy-static: ${entry} não existe — pulando`);
    continue;
  }
  cpSync(src, join(DIST, entry), { recursive: true });
}

// As rotas do app React (/app/*) caem no index.html via functions/_middleware.js.

console.log('copy-static: dist/ pronto');
