import { readFileSync } from 'node:fs';
import { packSummary, validatePack, type Pack } from '../src/lib/pack';

// Stampa solo conteggi e percorsi degli errori: l'output è sicuro anche per chi gioca.
const [command, file, baseUrl] = process.argv.slice(2);
if (!command || !file) {
  console.error('Uso: pack:check <file> | pack:upload <file> <url>');
  process.exit(1);
}

const pack = JSON.parse(readFileSync(file, 'utf8')) as Pack;
const errors = validatePack(pack);
if (errors.length) {
  console.error(`${errors.length} errori:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('Cena valida:', packSummary(pack));

if (command === 'upload') {
  const token = process.env.ADMIN_TOKEN;
  if (!baseUrl || !token) {
    console.error('Servono l\'URL e la variabile ADMIN_TOKEN.');
    process.exit(1);
  }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { assets = {}, ...rest } = pack;
  const res = await fetch(`${baseUrl}/api/admin/packs`, {
    method: 'PUT', headers, body: JSON.stringify({ ...rest, assetIds: Object.keys(assets) }),
  });
  if (!res.ok) throw new Error(`Caricamento rifiutato (${res.status})`);
  for (const [assetId, asset] of Object.entries(assets)) {
    const up = await fetch(`${baseUrl}/api/admin/packs/${pack.id}/assets`, {
      method: 'POST', headers, body: JSON.stringify({ assetId, ...asset }),
    });
    if (!up.ok) throw new Error(`Immagine rifiutata (${up.status})`);
  }
  console.log('Caricata.');
}
