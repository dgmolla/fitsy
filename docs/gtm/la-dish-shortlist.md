# LA dish shortlist for faceless Reels

**TL;DR:** Twenty-two menu-confirmed dishes include twelve DEV Fitsy estimates and ten explicit data gaps.

> **Status:** research shortlist · **Last verified:** 2026-11-03 · **Owner:** Fitsy Marketing
> Public menus were retrieved on 2026-11-03 (America/Los_Angeles).
> This is a candidate list, not a claim that a dish or restaurant is healthy and not permission to publish.

## Evidence and limits

The Fitsy columns are a read-only snapshot of the DEV menu and `MacroEstimate` tables, not production app or serving verification.
The checked DEV Preview project had the known DEV Supabase identity; the query transaction was explicitly read-only with a ten-second statement timeout and bounded results.
Fitsy estimates below come from the `haiku` source on 2026-04-19 or 2026-04-20, with the confidence tier stored in DEV.
A HIGH tier describes Fitsy's model confidence, not independently verified nutrition accuracy.
`Missing in DEV` means the named restaurant had no match in the bounded DEV restaurant-name search, so item estimates and confidence could not be read; it does not prove absence from production.
For several dishes, menu name differences or unknown portion choices still need an exact in-app identity check before copy is written.
`No item facts on menu` means the linked official menu did not show calories or protein on the retrieval date; it makes no claim about every page a restaurant may publish.
Official menu links establish the dish identity and location, not Fitsy's numbers, and menus, portions, sauces and sides can change.

| # | Restaurant | Neighborhood | Exact official dish or options | Fitsy estimated calories | Fitsy estimated protein | Fitsy confidence or data flag | Official nutrition facts and source | Screening note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | BBQ+RICE | Silver Lake | Bulgogi Salad | fitsy estimates ~447 kcal | fitsy estimates ~28g | MEDIUM | No item facts on [official menu](https://www.bbqrice.com/menu) | Yuzu soy vinaigrette serving needs checking. |
| 2 | BBQ+RICE | Silver Lake | Black Pepper Chicken | fitsy estimates ~511 kcal | fitsy estimates ~30g | MEDIUM | No item facts on [official menu](https://www.bbqrice.com/menu) | Rice and marinade are part of the bowl. |
| 3 | BBQ+RICE | Silver Lake | Spicy Chicken | fitsy estimates ~519 kcal | fitsy estimates ~32g | MEDIUM | No item facts on [official menu](https://www.bbqrice.com/menu) | Rice and gochujang marinade need serving checks. |
| 4 | BBQ+RICE | Silver Lake | Bulgogi (Beef) | fitsy estimates ~554 kcal | fitsy estimates ~35g | MEDIUM | No item facts on [official menu](https://www.bbqrice.com/menu) | Rice and beef marinade need serving checks. |
| 5 | Pine & Crane | Silver Lake | Three Cup Chicken (Fitsy row: Three Cup Jidori Chicken) | fitsy estimates ~527 kcal | fitsy estimates ~38g | HIGH | No item facts on [official location page](https://www.pineandcrane.com/silverlake) | Confirm that the menu and Fitsy names represent the same serving. |
| 6 | Pine & Crane | Silver Lake | Beef Noodle Soup | fitsy estimates ~563 kcal | fitsy estimates ~32g | HIGH | No item facts on [official location page](https://www.pineandcrane.com/silverlake) | Noodle, broth and meat portions are unknown. |
| 7 | Playita Mariscos | Silver Lake | Campechana: Mixto, 16 oz cup | fitsy estimates ~260 kcal | fitsy estimates ~28g | MEDIUM | No item facts on [official menu](https://www.playitamariscos.com/menu) | Confirm Fitsy includes avocado and crackers. |
| 8 | Playita Mariscos | Silver Lake | Ceviche: Mixto | fitsy estimates ~246 kcal | fitsy estimates ~26g | MEDIUM | No item facts on [official menu](https://www.playitamariscos.com/menu) | Hold copy until Fitsy's row is tied to one tostada or the 16 oz cup with four tostadas. |
| 9 | Forage | Silver Lake | Salmon & Two Sides: Broccoli + Moroccan Beet Salad | Unverified | Unverified | Missing in DEV | No item facts on [official menu](https://foragela.com/) | Defined protein and sides; garnish and dressings need checks. |
| 10 | Forage | Silver Lake | Quarter Chicken White & Two Sides: Broccoli + Moroccan Beet Salad | Unverified | Unverified | Missing in DEV | No item facts on [official menu](https://foragela.com/) | Defined roast chicken and sides; portion needs checking. |
| 11 | Sqirl | Virgil Village | The Biggie (Fitsy row: Biggie Sorrel Pesto Bowl) | fitsy estimates ~551 kcal | fitsy estimates ~42g | HIGH | No item facts on [official menu](https://sqirlla.com/blogs/breakfast) | Confirm name match, chicken, rice, pesto and avocado serving. |
| 12 | Sqirl | Virgil Village | Salmon Sorrel Pesto Rice (Fitsy row: Salmon Sorrel Rice) | fitsy estimates ~570 kcal | fitsy estimates ~38g | HIGH | No item facts on [official menu](https://sqirlla.com/blogs/breakfast) | Confirm name match and salmon, rice and sauce serving. |
| 13 | Woon | Historic Filipinotown | Beef Noodles (Fitsy row: Beef Noodles (Lunch)) | fitsy estimates ~519 kcal | fitsy estimates ~32g | MEDIUM | No item facts on [official menu](https://www.woonkitchen.com/menu) | Confirm the lunch row matches the current noodle portion. |
| 14 | Silverlake Ramen | Silver Lake | Spicy Tuna Bowl | fitsy estimates ~419 kcal | fitsy estimates ~28g | MEDIUM | Yes: [official nutrition](https://www.silverlakeramen.com/nutrition.php); [menu](https://www.silverlakeramen.com/menu3.php) | Hold: official regular and large servings differ, and Fitsy's serving is unspecified. |
| 15 | Kismet Rotisserie | East Hollywood | Quarter Chicken, a la carte | Unverified | Unverified | Missing in DEV | No item facts on [official menu](https://www.kismetrotisserie.com/menu) | Check meat choice, sauce inclusion and portion. |
| 16 | Kismet Rotisserie | East Hollywood | Chicken + Rice Bowl | Unverified | Unverified | Missing in DEV | No item facts on [official menu](https://www.kismetrotisserie.com/menu) | Rice and yogurt sauce need serving checks. |
| 17 | RoRo's Chicken | Hollywood | Chicken Breast Plate | Unverified | Unverified | Missing in DEV | No item facts on [official menu](https://www.roroschicken.com/) | Grilled breasts are specified; verify sides and garlic sauce. |
| 18 | RoRo's Chicken | Hollywood | Chicken Kabab Plate | Unverified | Unverified | Missing in DEV | No item facts on [official menu](https://www.roroschicken.com/) | Two dark-meat skewers are specified; verify sides and sauce. |
| 19 | Birds Hollywood | Hollywood | 1/4 white rotisserie chicken with sautéed mixed vegetables as the included side | Unverified | Unverified | Missing in DEV | No item facts on [official menu](https://birdshollywood.com/main-menu/) | Lavash and dipping sauce are included; count them. |
| 20 | Birds Hollywood | Hollywood | Ahi tuna steak with sautéed mixed vegetables + black beans | Unverified | Unverified | Missing in DEV | No item facts on [official menu](https://birdshollywood.com/main-menu/) | Caper tartar sauce needs a portion check. |
| 21 | Carousel Restaurant | Hollywood | Chicken Breast Kebab (Shish Tawook) Plate | Unverified | Unverified | Missing in DEV | No item facts on [official Hollywood menu](https://carouselrestaurant.com/order/los-angeles) | Grilled protein candidate; plate sides need confirmation. |
| 22 | Carousel Restaurant | Hollywood | Filet Shish Kebab (Lahem Meshwey) Plate | Unverified | Unverified | Missing in DEV | No item facts on [official Hollywood menu](https://carouselrestaurant.com/order/los-angeles) | Grilled protein candidate; plate sides need confirmation. |

[BBQ+RICE's Silver Lake page](https://www.bbqrice.com/silver-lake), [Playita's menu](https://www.playitamariscos.com/menu), [Sqirl's menu](https://sqirlla.com/blogs/breakfast), [Woon's menu](https://www.woonkitchen.com/menu) and [Kismet's location page](https://www.kismetrotisserie.com/visit) establish the locations not stated in their row links.

## Selection and publication gate

Start with the menu-confirmed DEV rows whose serving can be defined, such as BBQ+RICE's bowls, then compare the exact app row with the current restaurant menu.
Treat the model numbers as hypotheses until the whole serving, sides and sauce are checked.
The Playita ceviche and Silverlake Ramen bowl need serving resolution, and the latter needs reconciliation with published official facts before any number is used.
For DEV-missing venues, first verify production app coverage through the normal approved product audit; retain `Unverified` until a source-bound Fitsy row exists.
Require a defensible full-serving estimate and visible uncertainty before a nutrition-led Reel.
Use copy such as "fitsy estimates ~32g protein" only for the matching checked dish, and do not call a restaurant healthy.
