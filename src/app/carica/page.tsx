'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client';
import { packSummary, validatePack, type Pack } from '@/lib/pack';

export default function UploadPage() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setErrors([]);
    setStatus('Controllo la cena…');
    try {
      const pack = JSON.parse(await file.text()) as Pack;
      const problems = validatePack(pack);
      if (problems.length) {
        setErrors(problems);
        setStatus('');
        return;
      }
      const { assets = {}, ...rest } = pack;
      const ids = Object.keys(assets);
      await api('/api/admin/packs', { method: 'PUT', token, body: { ...rest, assetIds: ids } });
      for (const [i, id] of ids.entries()) {
        setStatus(`Carico le immagini: ${i + 1} di ${ids.length}`);
        await api(`/api/admin/packs/${pack.id}/assets`, { token, body: { assetId: id, ...assets[id] } });
      }
      const s = packSummary(pack);
      setStatus(`Caricata «${s.title}»: ${s.characters} personaggi, ${s.envelopes} buste, ${s.documents} documenti, ${s.images} immagini.`);
    } catch (err) {
      setStatus('');
      setErrors([err instanceof SyntaxError ? 'Il file non è una cena valida.' : (err as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Link href="/">← Tutte le cene</Link>
      <h1 style={{ marginTop: 16 }}>Carica una cena</h1>
      <p className="muted">Puoi caricarla anche se poi giochi: qui vedi solo i conteggi, mai il contenuto.</p>
      <div className="card">
        <label htmlFor="token">Codice di caricamento</label>
        <input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        <label htmlFor="file">File della cena (.json)</label>
        <input
          id="file"
          type="file"
          accept=".json,application/json"
          disabled={busy || !token}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = '';
          }}
        />
        {status && <p style={{ marginTop: 12 }} role="status">{status}</p>}
        {errors.map((err) => <p className="error" key={err}>{err}</p>)}
      </div>
    </main>
  );
}
