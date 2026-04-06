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
    body: JSON.stringify({ url, formats: ['markdown'] })
  });

  const data = await res.json() as any;
  const md: string = data.data?.markdown ?? '';
  console.log('Markdown length:', md.length);
  console.log('\nFirst 5000 chars of Markdown:');
  console.log(md.substring(0, 5000));
}

main().catch(console.error);
