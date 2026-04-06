import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../../apps/api/.env.local') });

async function main() {
  // Try the search endpoint to check remaining credits
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`
    },
    body: JSON.stringify({ url: 'https://www.ubereats.com/store/mcdonalds-los-angeles-swc-manchester-%26-airport/hK7QCe63T-KpnvPpDSbsKQ', formats: ['markdown'] })
  });
  const data = await res.json() as any;
  console.log('Status:', res.status);
  console.log('Error:', data.error);
}

main().catch(console.error);
