import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../../apps/api/.env.local') });

async function main() {
  const url = 'https://www.ubereats.com/store/mcdonalds-los-angeles-swc-manchester-%26-airport/hK7QCe63T-KpnvPpDSbsKQ?srsltid=AfmBOootriUNpZ102gPbejxonBmWQQsjry56CygvG1MVtgGsObd57u6B';
  
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`
    },
    body: JSON.stringify({ url, formats: ['markdown'] })
  });

  const data = await res.json() as any;
  console.log('HTTP status:', res.status);
  console.log('Response keys:', Object.keys(data));
  console.log('data.success:', data.success);
  if (data.data) {
    console.log('data.data keys:', Object.keys(data.data));
    console.log('data.data.markdown length:', data.data.markdown?.length ?? 0);
    console.log('data.data.content length:', data.data.content?.length ?? 0);
  }
}

main().catch(console.error);
