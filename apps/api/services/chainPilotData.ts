// Reviewed against the exact official PDFs below. Aliases describe standard published servings.
export const chainPilot = {
  version: 1,
  reviewedBy: "Codex official-PDF audit, September 2026",
  changes: [
    {
      slug: "waba-grill", canonicalKey: "chicken-plate",
      expected: null,
      facts: {"calories": 820, "proteinG": 54, "carbsG": 110, "fatG": 15, "servingSize": "1 standard chicken plate"},
      source: {"url": "https://cp1.inkrefuge.com/admin/asset/uploads/296/on_page_element/pdf/jan2025-nutrition-chart-final.pdf", "sha256": "813243b3b287e7898340173675b94a0ece7d1116a236a78f313661fec8473e6d"},
      locator: "page 1, Plates, Chicken",
      aliases: [
        {"name": "Chicken Plate", "section": "Plates", "description": "Grilled all-natural, never frozen chicken caramelized with our signature WaBa sauce."},
        {"name": "Chicken Plate", "section": "Featured items", "description": "Grilled all-natural, never frozen chicken caramelized with our signature WaBa sauce."},
      ],
    },
    {
      slug: "waba-grill", canonicalKey: "steak-plate",
      expected: null,
      facts: {"calories": 980, "proteinG": 44, "carbsG": 130, "fatG": 27, "servingSize": "1 standard steak plate"},
      source: {"url": "https://cp1.inkrefuge.com/admin/asset/uploads/296/on_page_element/pdf/jan2025-nutrition-chart-final.pdf", "sha256": "813243b3b287e7898340173675b94a0ece7d1116a236a78f313661fec8473e6d"},
      locator: "page 1, Plates, Steak",
      aliases: [
        {"name": "Steak Plate", "section": "Beef", "description": ""},
        {"name": "Steak Plate", "section": "Plates", "description": "Juicy steak marinated in house with our WaBa marinade and grilled to perfection."},
        {"name": "Steak Plate", "section": "Featured items", "description": "Juicy steak marinated in house with our WaBa marinade and grilled to perfection."},
      ],
    },
    {
      slug: "waba-grill", canonicalKey: "chicken-veggie-bowl",
      expected: null,
      facts: {"calories": 590, "proteinG": 39, "carbsG": 90, "fatG": 11, "servingSize": "1 standard chicken rice veggie bowl"},
      source: {"url": "https://cp1.inkrefuge.com/admin/asset/uploads/296/on_page_element/pdf/jan2025-nutrition-chart-final.pdf", "sha256": "813243b3b287e7898340173675b94a0ece7d1116a236a78f313661fec8473e6d"},
      locator: "page 1, Rice Veggie Bowls, Chicken",
      aliases: [
        {"name": "Chicken Veggie Bowl", "section": "Rice Veggie Bowls", "description": "Grilled all-natural, never frozen chicken caramelized with our signature WaBa sauce."},
        {"name": "Chicken Veggie Bowl", "section": "Featured items", "description": "Grilled all-natural, never frozen chicken caramelized with our signature WaBa sauce."},
      ],
    },
    {
      slug: "waba-grill", canonicalKey: "miso-soup",
      expected: {"canonicalKey": "miso-soup", "aliases": ["miso-soup"], "calories": 30, "proteinG": 2, "carbsG": 3, "fatG": 0, "servingSize": null, "source": "official", "confidence": "HIGH", "officialUrl": "https://www.wabagrill.com/nutritional-guide"},
      facts: {"calories": 30, "proteinG": 2, "carbsG": 3, "fatG": 0, "servingSize": "1 standard soup serving"},
      source: {"url": "https://cp1.inkrefuge.com/admin/asset/uploads/296/on_page_element/pdf/jan2025-nutrition-chart-final.pdf", "sha256": "813243b3b287e7898340173675b94a0ece7d1116a236a78f313661fec8473e6d"},
      locator: "page 1, Sides, Miso Soup",
      aliases: [
        {"name": "Miso Soup", "section": "Sides", "description": ""},
      ],
    },
    {
      slug: "yoshinoya", canonicalKey: "gyudon-beef-side",
      expected: {"canonicalKey": "gyudon-beef-side", "aliases": [], "calories": 686, "proteinG": 27, "carbsG": 8, "fatG": 63, "servingSize": null, "source": "official", "confidence": "HIGH", "officialUrl": "https://www.yoshinoyaamerica.com/nutrition"},
      facts: {"calories": 310, "proteinG": 21, "carbsG": 8, "fatG": 21, "servingSize": "198 g protein side (no rice)"},
      source: {"url": "https://www.dropbox.com/scl/fi/945n2jb4x08wp7fztvn81/Nutrition-Facts-December-2025.pdf?rlkey=rgdz9iheqlhro9f81wotwrjws&dl=1", "sha256": "018024a47941502aac9fc1d7db658ae0c361b75643b30cf8de59155e55644fee"},
      locator: "page 1, Sides, Gyudon Beef, 198 g",
      aliases: [
        {"name": "Original Gyudon Beef", "section": "Ala Carte", "description": "Thin juicy ribbons of Gyudon Beef and chopped onions, slowly simmered in a sweet and savory herb miso soy broth."},
        {"name": "Original Gyudon Beef", "section": "Featured items", "description": "Thin juicy ribbons of Gyudon Beef and chopped onions, slowly simmered in a sweet and savory herb miso soy broth."},
      ],
    },
    {
      slug: "yoshinoya", canonicalKey: "habanero-chicken-side",
      expected: {"canonicalKey": "habanero-chicken-side", "aliases": [], "calories": 290, "proteinG": 28, "carbsG": 18, "fatG": 11, "servingSize": null, "source": "official", "confidence": "HIGH", "officialUrl": "https://www.yoshinoyaamerica.com/nutrition"},
      facts: {"calories": 290, "proteinG": 28, "carbsG": 18, "fatG": 11, "servingSize": "166 g protein side (no rice)"},
      source: {"url": "https://www.dropbox.com/scl/fi/945n2jb4x08wp7fztvn81/Nutrition-Facts-December-2025.pdf?rlkey=rgdz9iheqlhro9f81wotwrjws&dl=1", "sha256": "018024a47941502aac9fc1d7db658ae0c361b75643b30cf8de59155e55644fee"},
      locator: "page 1, Sides, Habanero Chicken, 166 g",
      aliases: [
        {"name": "Habanero Grilled Chicken", "section": "Ala Carte", "description": "Fresh, grilled chicken, glazed with our spicy and sweet habanero sauce and then topped with sesame seeds and green onions."},
      ],
    },
    {
      slug: "yoshinoya", canonicalKey: "blount-clam-chowder",
      expected: {"canonicalKey": "blount-clam-chowder", "aliases": [], "calories": 300, "proteinG": 9, "carbsG": 18, "fatG": 22, "servingSize": null, "source": "official", "confidence": "HIGH", "officialUrl": "https://www.yoshinoyaamerica.com/nutrition"},
      facts: {"calories": 300, "proteinG": 9, "carbsG": 18, "fatG": 22, "servingSize": "227 g soup serving"},
      source: {"url": "https://www.dropbox.com/scl/fi/945n2jb4x08wp7fztvn81/Nutrition-Facts-December-2025.pdf?rlkey=rgdz9iheqlhro9f81wotwrjws&dl=1", "sha256": "018024a47941502aac9fc1d7db658ae0c361b75643b30cf8de59155e55644fee"},
      locator: "page 1, Appetizers, Clam Chowder, 227 g",
      aliases: [
        {"name": "Clam Chowder", "section": "Featured", "description": "A creamy soup featuring clams, cooked with potatoes, celery and onion."},
        {"name": "Clam Chowder", "section": "Featured items", "description": "A creamy soup featuring clams, cooked with potatoes, celery and onion."},
      ],
    },
  ],
  quarantine: [
    {"slug": "waba-grill", "canonicalKey": "chicken", "expected": {"canonicalKey": "chicken", "aliases": ["chicken-plate"], "calories": 1050, "proteinG": 140, "carbsG": 30, "fatG": 45, "servingSize": null, "source": "official", "confidence": "HIGH", "officialUrl": "https://www.wabagrill.com/nutritional-guide"}},
    {"slug": "waba-grill", "canonicalKey": "shrimp", "expected": {"canonicalKey": "shrimp", "aliases": ["shrimp-bowl", "shrimp-veggie-bowl"], "calories": 170, "proteinG": 9, "carbsG": 20, "fatG": 8, "servingSize": null, "source": "official", "confidence": "HIGH", "officialUrl": "https://www.wabagrill.com/nutritional-guide"}},
    {"slug": "waba-grill", "canonicalKey": "sweet-spicy-chicken", "expected": {"canonicalKey": "sweet-spicy-chicken", "aliases": ["sweet-spicy-chicken-plate"], "calories": 1100, "proteinG": 140, "carbsG": 70, "fatG": 45, "servingSize": null, "source": "official", "confidence": "HIGH", "officialUrl": "https://www.wabagrill.com/nutritional-guide"}},
    {"slug": "waba-grill", "canonicalKey": "waba", "expected": {"canonicalKey": "waba", "aliases": ["chicken-steak-plate"], "calories": 1360, "proteinG": 157, "carbsG": 60, "fatG": 51, "servingSize": null, "source": "official", "confidence": "HIGH", "officialUrl": "https://www.wabagrill.com/nutritional-guide"}},
    {"slug": "waba-grill", "canonicalKey": "white-meat-chicken", "expected": {"canonicalKey": "white-meat-chicken", "aliases": ["white-meat-chicken-bowl"], "calories": 950, "proteinG": 176, "carbsG": 10, "fatG": 20, "servingSize": null, "source": "official", "confidence": "HIGH", "officialUrl": "https://www.wabagrill.com/nutritional-guide"}},
  ],
};
