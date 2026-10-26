import { createHash } from 'node:crypto';

export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const slugify = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unnamed';

export interface ParsedItem {
  name: string;
  section: string;
  servingSize: string | null;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  page: number | null;
  lineStart: number;
  lineEnd: number;
  rawText: string;
  notes: string[];
}

export interface Diagnostic {
  page: number | null;
  line: number;
  rawText: string;
  reason: string;
}

export interface Extraction {
  method: string;
  text: string;
  items: ParsedItem[];
  diagnostics: Diagnostic[];
}

export interface Candidate {
  url: string;
  title: string;
  discoveredFrom: { url: string; kind: 'search' | 'official-link' | 'domain-hint' }[];
  reasons: string[];
  official: boolean;
  score: number;
  outcome: string;
}

export interface Download {
  requestedUrl: string;
  url: string;
  file: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export interface Discovery {
  chain: string;
  domainHint: string | null;
  searches: { url: string; file?: string; sha256?: string; status?: number; outcome: string }[];
  candidates: Candidate[];
  selected: Download | null;
  selectionReason: string | null;
}

/** Deliberately lacks reviewer, approval digest, and menu bindings. */
export function buildReview(chain: string, source: Download, extraction: Extraction) {
  const slug = slugify(chain);
  const keys = new Set<string>();
  return {
    version: 1 as const,
    status: 'unverified' as const,
    chain,
    reviewedBy: null,
    changes: extraction.items.map(item => {
      const base = `${slugify(item.section || 'menu')}/${slugify(item.name)}`;
      let canonicalKey = base;
      if (keys.has(canonicalKey)) canonicalKey = `${base}/page-${item.page ?? 'html'}-line-${item.lineStart}`;
      if (keys.has(canonicalKey)) throw new Error(`Duplicate source locator: ${canonicalKey}`);
      keys.add(canonicalKey);
      const locator = `${item.page === null ? 'HTML table/card' : `page ${item.page}`}, source.txt lines ${item.lineStart}-${item.lineEnd}, ${item.section}, ${item.name}`;
      return {
        slug, canonicalKey, expected: null, status: 'unverified' as const,
        facts: { calories: item.calories, proteinG: item.proteinG, carbsG: item.carbsG, fatG: item.fatG,
          servingSize: item.servingSize },
        source: { url: source.url, sha256: source.sha256 },
        locator, aliases: [],
        provenance: { name: item.name, section: item.section, page: item.page,
          lineStart: item.lineStart, lineEnd: item.lineEnd, textFile: 'source.txt',
          rawText: item.rawText, notes: item.notes },
      };
    }),
    quarantine: [],
    diagnostics: extraction.diagnostics,
  };
}

export type Review = ReturnType<typeof buildReview>;
