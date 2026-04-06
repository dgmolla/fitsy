import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../../apps/api/.env.local') });

async function main() {
  const url = 'https://www.ubereats.com/store/mcdonalds-los-angeles-swc-manchester-%26-airport/hK7QCe63T-KpnvPpDSbsKQ';

  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`
    },
    body: JSON.stringify({ url, formats: ['html'] })
  });

  const data = await res.json() as any;
  const html: string = data.data?.html ?? '';
  console.log('HTTP status:', res.status);
  console.log('HTML length:', html.length);

  const matches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>/gi) ?? [];
  console.log('ld+json script tags found:', matches.length);

  const menuMatches = html.match(/hasMenu|hasMenuItem|MenuItem/gi) ?? [];
  console.log('Menu-related strings found:', menuMatches.length);

  // Print all ld+json blocks
  const blockPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let blockIdx = 0;
  while ((match = blockPattern.exec(html)) !== null) {
    console.log(`\n--- ld+json block ${++blockIdx} ---`);
    console.log(match[1]?.substring(0, 500));
  }

  if (blockIdx === 0) {
    console.log('\nNo ld+json found. First 2000 chars of HTML:');
    console.log(html.substring(0, 2000));
  }
}

main().catch(console.error);
