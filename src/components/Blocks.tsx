'use client';

import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/client';
import type { Block } from '@/lib/pack';

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

function SecureImage({ src, token, alt }: { src: string; token?: string; alt?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;
    fetch(API_BASE + src, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob && !cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, token]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={alt ?? ''} /> : <p className="muted">Carico l&apos;immagine…</p>;
}

export function Blocks({ blocks, assetBase, token }: { blocks: Block[]; assetBase: string; token?: string }) {
  return (
    <div className="blocks">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h': return <h4 key={i}><Inline text={b.text} /></h4>;
          case 'p': return <p key={i}><Inline text={b.text} /></p>;
          case 'quote': return <blockquote key={i}><Inline text={b.text} /></blockquote>;
          case 'note': return <div className="note" key={i}><Inline text={b.text} /></div>;
          case 'list': return <ul key={i}>{b.items.map((item, j) => <li key={j}><Inline text={item} /></li>)}</ul>;
          case 'table':
            return (
              <div className="table-wrap" key={i}>
                <table><tbody>
                  {b.rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k}><Inline text={cell} /></td>)}</tr>)}
                </tbody></table>
              </div>
            );
          case 'img': return <SecureImage key={i} src={`${assetBase}/${b.asset}`} token={token} alt={b.alt} />;
        }
      })}
    </div>
  );
}
