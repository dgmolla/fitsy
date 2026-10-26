import { parse, type DefaultTreeAdapterMap } from 'parse5';

export type HtmlNode = DefaultTreeAdapterMap['node'];
export const children = (node: HtmlNode): HtmlNode[] => 'childNodes' in node ? node.childNodes : [];
export const tag = (node: HtmlNode) => 'tagName' in node ? node.tagName : '';
export const attribute = (node: HtmlNode, name: string) => 'attrs' in node
  ? node.attrs.find(attr => attr.name === name)?.value ?? '' : '';
export const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
export function contents(node: HtmlNode): string {
  if (['script', 'style', 'noscript'].includes(tag(node))) return '';
  return 'value' in node ? node.value : children(node).map(contents).join(' ');
}
export function descendants(node: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode[] {
  return children(node).flatMap(child => [...(predicate(child) ? [child] : []), ...descendants(child, predicate)]);
}
// Parse the non-JavaScript view so official PDF links inside <noscript> remain visible.
export const documentOf = (html: string) => parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false });

export function links(html: string, base: string) {
  return descendants(documentOf(html), node => tag(node) === 'a').flatMap(node => {
    const href = attribute(node, 'href');
    if (!href) return [];
    try { return [{ url: new URL(href, base).href, title: clean(contents(node)) }]; }
    catch { return []; }
  });
}

export function searchLinks(html: string, base: string) {
  const document = documentOf(html);
  return descendants(document, node => tag(node) === 'a').flatMap(node => {
    const classes = attribute(node, 'class').split(/\s+/);
    const parent = 'parentNode' in node ? node.parentNode : null;
    if (!classes.some(cls => ['result__a', 'result-link'].includes(cls)) && (!parent || tag(parent) !== 'h2')) return [];
    try {
      let url = new URL(attribute(node, 'href'), base);
      if (url.hostname.endsWith('duckduckgo.com') && url.searchParams.has('uddg')) {
        url = new URL(url.searchParams.get('uddg')!);
      } else if (url.hostname.endsWith('bing.com') && url.pathname === '/ck/a') {
        const encoded = url.searchParams.get('u');
        if (!encoded?.startsWith('a1')) return [];
        url = new URL(Buffer.from(encoded.slice(2), 'base64url').toString('utf8'));
      }
      if (!['http:', 'https:'].includes(url.protocol)) return [];
      url.hash = '';
      return [{ url: url.href, title: clean(contents(node)) }];
    } catch { return []; }
  });
}
