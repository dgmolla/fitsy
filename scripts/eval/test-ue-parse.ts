import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../../apps/api/.env.local') });

import { scrapeUberEatsMarkdown, parseUberEatsMarkdown } from '../../apps/api/services/menuSources/uberEatsSource.js';

async function main() {
  const url = 'https://www.ubereats.com/store/mcdonalds-los-angeles-swc-manchester-%26-airport/hK7QCe63T-KpnvPpDSbsKQ?srsltid=AfmBOootriUNpZ102gPbejxonBmWQQsjry56CygvG1MVtgGsObd57u6B';
  
  console.log('Scraping...');
  const markdown = await scrapeUberEatsMarkdown(url);
  console.log('Markdown length:', markdown?.length ?? 0);
  
  if (!markdown) {
    console.log('No markdown returned');
    return;
  }

  // Show the section around "Cal."
  const calIdx = markdown.indexOf('Cal.');
  if (calIdx >= 0) {
    console.log('\nContext around first "Cal." occurrence:');
    console.log(JSON.stringify(markdown.substring(calIdx - 100, calIdx + 50)));
  }

  const items = parseUberEatsMarkdown(markdown);
  console.log(`\nParsed ${items.length} items`);
  items.slice(0, 5).forEach(i => console.log(`  ${i.name} → ${i.calories} cal`));
}

main().catch(console.error);
