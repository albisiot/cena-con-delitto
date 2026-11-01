export type Block =
  | { t: 'h' | 'p' | 'quote' | 'note'; text: string }
  | { t: 'list'; items: string[] }
  | { t: 'table'; rows: string[][] }
  | { t: 'img'; asset: string; alt?: string };

export type CastMember = { n: number; name: string; role: string; line: string };

export type Step = {
  id: string;
  when?: string;
  title: string;
  instructions: string;
  kind: 'info' | 'cards' | 'envelope' | 'vote' | 'finale';
  envelope?: string;
  readAloud?: Block[];
};

export type VoteField = { id: string; label: string; points: number };

export type PackPublic = {
  tagline: string;
  players: { min: number; ideal: number };
  durationMinutes: number;
  theme?: { bg?: string; fg?: string; accent?: string };
  cover?: string;
  manual: { title: string; blocks: Block[] }[];
  cast: CastMember[];
  program: Step[];
  vote: {
    accusedPoints: number;
    fields: VoteField[];
    missionPoints?: number;
    awardLabel?: string;
  };
};

export type Envelope = {
  id: string;
  title: string;
  documents: { id: string; title: string; blocks: Block[] }[];
};

export type PackSecret = {
  cards: Record<string, Block[]>;
  envelopes: Envelope[];
  finale: Block[];
  solution: { culprit: number };
};

export type Pack = {
  format: 1;
  id: string;
  title: string;
  public: PackPublic;
  secret: PackSecret;
  assets?: Record<string, { mime: string; base64: string }>;
};

const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/;

function checkBlocks(blocks: unknown, path: string, errors: string[], assets: Set<string> | null) {
  if (!Array.isArray(blocks)) {
    errors.push(`${path}: deve essere una lista di blocchi`);
    return;
  }
  blocks.forEach((b: any, i) => {
    const p = `${path}[${i}]`;
    if (['h', 'p', 'quote', 'note'].includes(b?.t)) {
      if (typeof b.text !== 'string' || !b.text) errors.push(`${p}: testo mancante`);
    } else if (b?.t === 'list') {
      if (!Array.isArray(b.items)) errors.push(`${p}: items mancante`);
    } else if (b?.t === 'table') {
      if (!Array.isArray(b.rows)) errors.push(`${p}: rows mancante`);
    } else if (b?.t === 'img') {
      if (assets && !assets.has(b.asset)) errors.push(`${p}: immagine non presente in assets`);
    } else {
      errors.push(`${p}: tipo di blocco sconosciuto`);
    }
  });
}

/** Gli errori indicano solo il percorso, mai il contenuto: si possono mostrare a chi gioca. */
export function validatePack(pack: any): string[] {
  const e: string[] = [];
  if (pack?.format !== 1) e.push('format: deve essere 1');
  if (typeof pack?.id !== 'string' || !/^[a-z0-9-]{3,60}$/.test(pack.id)) e.push('id: minuscole, numeri e trattini');
  if (typeof pack?.title !== 'string' || !pack.title) e.push('title: mancante');
  const pub = pack?.public;
  const sec = pack?.secret;
  if (!pub || !sec) return [...e, 'public e secret sono obbligatori'];

  const assets = new Set(Object.keys(pack.assets ?? {}));
  for (const [id, a] of Object.entries<any>(pack.assets ?? {})) {
    if (!IMAGE_MIME.test(a?.mime ?? '') || typeof a?.base64 !== 'string') e.push(`assets.${id}: immagine non valida`);
  }

  if (!Number.isInteger(pub.players?.min) || pub.players.min < 2) e.push('public.players.min: minimo 2');
  if (!Number.isInteger(pub.players?.ideal)) e.push('public.players.ideal: mancante');
  if (!Array.isArray(pub.manual)) e.push('public.manual: mancante');
  else pub.manual.forEach((s: any, i: number) => checkBlocks(s.blocks, `public.manual[${i}].blocks`, e, assets));
  if (pub.cover && !assets.has(pub.cover)) e.push('public.cover: immagine non presente in assets');

  const cast: any[] = Array.isArray(pub.cast) ? pub.cast : [];
  if (!cast.length) e.push('public.cast: mancante');
  const numbers = new Set(cast.map((c) => c.n));
  if (numbers.size !== cast.length) e.push('public.cast: numeri ripetuti');
  cast.forEach((c, i) => {
    if (!Number.isInteger(c.n) || !c.name || !c.role) e.push(`public.cast[${i}]: servono n, name, role`);
  });

  const cards = sec.cards ?? {};
  for (const n of numbers) if (!cards[String(n)]) e.push(`secret.cards.${n}: scheda mancante`);
  for (const key of Object.keys(cards)) {
    if (!numbers.has(Number(key))) e.push(`secret.cards.${key}: numero non presente nel cast`);
    checkBlocks(cards[key], `secret.cards.${key}`, e, assets);
  }

  const envelopes: any[] = Array.isArray(sec.envelopes) ? sec.envelopes : [];
  envelopes.forEach((env, i) => {
    if (!env.id || !env.title) e.push(`secret.envelopes[${i}]: servono id e title`);
    (env.documents ?? []).forEach((d: any, j: number) => {
      if (!d.id || !d.title) e.push(`secret.envelopes[${i}].documents[${j}]: servono id e title`);
      checkBlocks(d.blocks, `secret.envelopes[${i}].documents[${j}].blocks`, e, assets);
    });
  });
  checkBlocks(sec.finale, 'secret.finale', e, assets);
  if (!numbers.has(sec.solution?.culprit)) e.push('secret.solution.culprit: deve essere un numero del cast');

  const program: any[] = Array.isArray(pub.program) ? pub.program : [];
  const count = (kind: string) => program.filter((s) => s.kind === kind).length;
  for (const kind of ['cards', 'vote', 'finale']) {
    if (count(kind) !== 1) e.push(`public.program: serve esattamente un passo "${kind}"`);
  }
  const kinds = program.map((s) => s.kind);
  if (kinds.indexOf('vote') > kinds.indexOf('finale')) e.push('public.program: il voto viene prima del finale');
  const ids = new Set(envelopes.map((x) => x.id));
  const used = new Set<string>();
  program.forEach((s, i) => {
    if (!s.id || !s.title || !s.instructions) e.push(`public.program[${i}]: servono id, title, instructions`);
    if (!['info', 'cards', 'envelope', 'vote', 'finale'].includes(s.kind)) e.push(`public.program[${i}]: kind sconosciuto`);
    if (s.kind === 'envelope') {
      if (!ids.has(s.envelope)) e.push(`public.program[${i}]: busta inesistente`);
      used.add(s.envelope);
    }
    if (s.readAloud) checkBlocks(s.readAloud, `public.program[${i}].readAloud`, e, assets);
  });
  for (const id of ids) if (!used.has(id)) e.push(`secret.envelopes: busta ${id} mai aperta nel programma`);

  if (!Number.isInteger(pub.vote?.accusedPoints)) e.push('public.vote.accusedPoints: mancante');
  if (!Array.isArray(pub.vote?.fields)) e.push('public.vote.fields: mancante');
  return e;
}

export function collectAssets(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectAssets(v, out));
  else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.t === 'img' && typeof obj.asset === 'string') out.add(obj.asset);
    Object.values(obj).forEach((v) => collectAssets(v, out));
  }
  return out;
}

/** Riassunto mostrabile a chi carica una cena: solo conteggi, nessun testo segreto. */
export function packSummary(pack: Pack) {
  return {
    id: pack.id,
    title: pack.title,
    characters: pack.public.cast.length,
    steps: pack.public.program.length,
    envelopes: pack.secret.envelopes.length,
    documents: pack.secret.envelopes.reduce((n, env) => n + env.documents.length, 0),
    images: Object.keys(pack.assets ?? {}).length,
  };
}
