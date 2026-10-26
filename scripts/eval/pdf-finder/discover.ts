import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchWeb, publicUrl, type WebFetch } from './fetch';
import { links, searchLinks } from './html';
import { sha256, type Candidate, type Discovery, type Download } from './types';

export function domainOf(hint: string): string {
  const url = publicUrl(hint.includes('://') ? hint : `https://${hint}`);
  if (url.pathname !== '/' || url.search) throw new Error('--domain must be a hostname, not a page URL.');
  return url.hostname.replace(/^www\./, '');
}
export const onDomain = (value: string, domain: string) => {
  const host = new URL(value).hostname;
  return host === domain || host.endsWith(`.${domain}`);
};
const nutritionLink = (value: string) => /nutri|\.pdf(?:\?|$)/i.test(value);

export function scoreCandidate(candidate: Candidate, domain: string | null, chain: string) {
  const url = new URL(candidate.url), host = url.hostname.replace(/^www\./, '');
  const words = chain.toLowerCase().replace(/['’]s\b/g, 's').split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3 && !['the', 'and', 'burger', 'grill', 'restaurant', 'restaurants', 'fish', 'taco'].includes(word));
  const initials = chain.toLowerCase().split(/[^a-z0-9]+/).filter(word => word && word !== 'the').map(word => word[0]).join('');
  const inferred = words.some(word => host.split('.')[0]!.includes(word)) || (initials.length >= 3 && host.split('.')[0] === initials);
  const officialLink = candidate.discoveredFrom.some(origin => origin.kind === 'official-link');
  candidate.official = (domain ? onDomain(candidate.url, domain) : inferred) || officialLink;
  candidate.reasons = [domain && onDomain(candidate.url, domain) ? 'Matches the supplied official domain.'
    : inferred ? 'Domain resembles the chain name/acronym; ownership still needs review.'
    : officialLink ? 'Linked directly by a chain-domain page.' : 'Third-party/unconfirmed domain; retained for audit only.'];
  candidate.score = candidate.official ? 100 : 0;
  if (nutritionLink(url.pathname + candidate.title)) { candidate.score += 20; candidate.reasons.push('Nutrition/PDF URL or anchor text.'); }
  if (/\.pdf$/i.test(url.pathname)) { candidate.score += 30; candidate.reasons.push('Direct PDF download.'); }
  if (officialLink) { candidate.score += 45; candidate.reasons.push('Current official-page link outranks search-only documents.'); }
  if (/allerg(?:y|en)/i.test(url.pathname + candidate.title) && !/nutri/i.test(url.pathname + candidate.title)) {
    candidate.score -= 60; candidate.reasons.push('Allergen-only document is unlikely to contain macros.');
  }
  return candidate;
}

export interface DiscoverySession {
  discovery: Discovery;
  cache: Map<string, Download>;
  download: (url: string) => Promise<Download>;
}

export async function discover(chain: string, domainHint: string | null, out: string,
  get: WebFetch = fetchWeb): Promise<DiscoverySession> {
  const discovery: Discovery = { chain, domainHint, searches: [], candidates: [], selected: null, selectionReason: null };
  const cache = new Map<string, Download>();
  const candidates = new Map<string, Candidate>();
  let downloadIndex = 0;
  function add(value: string, title: string, from: Candidate['discoveredFrom'][number]) {
    let url: string;
    try { url = publicUrl(value).href; } catch { return; }
    const prior = candidates.get(url);
    if (prior) {
      if (!prior.discoveredFrom.some(origin => origin.url === from.url && origin.kind === from.kind)) prior.discoveredFrom.push(from);
      return;
    }
    candidates.set(url, { url, title, discoveredFrom: [from], reasons: [], official: false, score: 0, outcome: 'Not downloaded.' });
  }
  async function download(url: string): Promise<Download> {
    if (cache.has(url)) return cache.get(url)!;
    const response = await get(url);
    const pdf = response.bytes.subarray(0, 5).toString() === '%PDF-';
    const hash = sha256(response.bytes), file = `downloads/${String(++downloadIndex).padStart(2, '0')}-${hash.slice(0, 12)}.${pdf ? 'pdf' : 'html'}`;
    await writeFile(join(out, file), response.bytes);
    const result = { requestedUrl: url, url: response.url, file, sha256: hash, bytes: response.bytes.length, contentType: response.contentType };
    cache.set(url, result);
    return result;
  }
  const query = `${chain} nutrition pdf`;
  const providers = ['https://html.duckduckgo.com/html/?q=', 'https://lite.duckduckgo.com/lite/?q=', 'https://www.bing.com/search?q='];
  for (const [index, provider] of providers.entries()) {
    const url = provider + encodeURIComponent(query);
    try {
      const response = await get(url), html = response.bytes.toString('utf8');
      const file = `search/${index + 1}.html`;
      await writeFile(join(out, file), response.bytes);
      const found = searchLinks(html, url);
      discovery.searches.push({ url, file, sha256: sha256(response.bytes), status: response.status,
        outcome: found.length ? `${found.length} candidate links.` : 'No result links (challenge, empty, or unsupported HTML); trying next provider.' });
      found.forEach(link => add(link.url, link.title, { url, kind: 'search' }));
      if ([...candidates.values()].some(candidate => scoreCandidate(candidate, domainHint, chain).official)) break;
    } catch (error) {
      discovery.searches.push({ url, outcome: error instanceof Error ? error.message : String(error) });
    }
  }
  if (domainHint) add(`https://www.${domainHint}/`, 'Domain hint homepage', { url: `https://${domainHint}/`, kind: 'domain-hint' });
  const visited = new Set<string>();
  // Follow official pages for a current PDF link; never crawl third-party search results.
  for (let budget = 0; budget < 5; budget++) {
    const next = [...candidates.values()].map(candidate => scoreCandidate(candidate, domainHint, chain))
      .filter(candidate => candidate.official && !visited.has(candidate.url) && !/\.pdf(?:\?|$)/i.test(candidate.url))
      .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))[0];
    if (!next) break;
    visited.add(next.url);
    try {
      const saved = await download(next.url);
      // Redirects cannot confer official-domain authority on an unrelated site.
      if (!onDomain(saved.url, domainHint ?? new URL(next.url).hostname.replace(/^www\./, ''))) {
        next.outcome = 'Redirect left the chain domain; not used as official-link evidence.'; continue;
      }
      const { readFile } = await import('node:fs/promises');
      const html = await readFile(join(out, saved.file), 'utf8');
      links(html, saved.url).filter(link => nutritionLink(link.url + link.title)).forEach(link => {
        add(link.url, link.title, { url: saved.url, kind: 'official-link' });
      });
      next.outcome = `Downloaded for official nutrition links: ${saved.file}`;
    } catch (error) { next.outcome = error instanceof Error ? error.message : String(error); }
  }
  discovery.candidates = [...candidates.values()].map(candidate => scoreCandidate(candidate, domainHint, chain))
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  return { discovery, cache, download };
}
