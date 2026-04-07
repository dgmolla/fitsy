/**
 * WebScraper interface — abstracts web scraping providers (Jina, Firecrawl, etc.).
 *
 * Each implementation converts URLs or search queries into clean markdown text
 * suitable for LLM extraction. The scraper layer is separate from the MenuSource
 * layer: scrapers produce markdown, MenuSources produce structured menu items.
 */

export interface WebScraper {
  id: string;
  /** Convert a URL to clean markdown */
  scrape(url: string): Promise<string | null>;
  /** Search the web and return markdown from best result */
  search(query: string, limit?: number): Promise<string | null>;
}
