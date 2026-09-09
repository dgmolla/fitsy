// Captured April DB identities and live UE getStoreV1 excerpts, September 2026.
// PDF facts: WaBa Jan 2025 plate; Yoshinoya Dec 2025 Side Gyudon 198 g.
export const capturedChainPilot = [
  {
    "slug": "waba-grill",
    "name": "WaBa Grill - Van Nuys (Sepulveda)",
    "april": {
      "name": "Chicken Plate",
      "section": "Plates",
      "description": "Grilled all-natural, never frozen chicken caramelized with our signature WaBa sauce.",
      "calories": 672,
      "proteinG": 42,
      "carbsG": 73,
      "fatG": 23
    },
    "ue": {
      "status": "success",
      "data": {
        "title": "WaBa Grill - Van Nuys (Sepulveda)",
        "catalogSectionsMap": {
          "captured": [
            {
              "payload": {
                "standardItemsPayload": {
                  "title": {
                    "text": "Plates"
                  },
                  "catalogItems": [
                    {
                      "uuid": "e787ad1a-86b2-52f1-b801-b5231306c304",
                      "title": "Chicken Plate",
                      "itemDescription": "Grilled all-natural, never frozen chicken caramelized with our signature WaBa sauce.",
                      "price": 1619,
                      "priceTagline": {
                        "text": "$16.19 \u2022 820 Cal.",
                        "textFormat": "<span>$16.19<span style=\"color:#757575\"> \u2022 820 Cal.</span></span>",
                        "accessibilityText": "$16.19, 820 Cal."
                      },
                      "hasCustomizations": true
                    }
                  ]
                }
              }
            }
          ]
        }
      }
    },
    "official": {
      "calories": 820,
      "proteinG": 54,
      "carbsG": 110,
      "fatG": 15,
      "servingSize": "1 standard chicken plate"
    },
    "source": {
      "url": "https://cp1.inkrefuge.com/admin/asset/uploads/296/on_page_element/pdf/jan2025-nutrition-chart-final.pdf",
      "sha256": "813243b3b287e7898340173675b94a0ece7d1116a236a78f313661fec8473e6d",
      "locator": "page 1, Plates, Chicken"
    }
  },
  {
    "slug": "yoshinoya",
    "name": "Yoshinoya (3081 N. San Fernando Road)",
    "april": {
      "name": "Original Gyudon Beef",
      "section": "Ala Carte",
      "description": "Thin juicy ribbons of Gyudon Beef and chopped onions, slowly simmered in a sweet and savory herb miso soy broth.",
      "calories": 443,
      "proteinG": 32,
      "carbsG": 38,
      "fatG": 18
    },
    "ue": {
      "status": "success",
      "data": {
        "title": "Yoshinoya (3081 N. San Fernando Road)",
        "catalogSectionsMap": {
          "captured": [
            {
              "payload": {
                "standardItemsPayload": {
                  "title": {
                    "text": "Featured items"
                  },
                  "catalogItems": [
                    {
                      "uuid": "25cfccae-5f2c-5836-a1d6-bd65a42db000",
                      "title": "Original Gyudon Beef",
                      "itemDescription": "Thin juicy ribbons of Gyudon Beef and chopped onions, slowly simmered in a sweet and savory herb miso soy broth.",
                      "price": 859,
                      "priceTagline": {
                        "text": "$8.59 \u2022 310 Cal.",
                        "textFormat": "<span>$8.59<span style=\"color:#757575\"> \u2022 310 Cal.</span></span>",
                        "accessibilityText": "$8.59, 310 Cal."
                      },
                      "hasCustomizations": false
                    }
                  ]
                }
              }
            }
          ]
        }
      }
    },
    "official": {
      "calories": 310,
      "proteinG": 21,
      "carbsG": 8,
      "fatG": 21,
      "servingSize": "198 g protein side"
    },
    "source": {
      "url": "https://www.dropbox.com/scl/fi/945n2jb4x08wp7fztvn81/Nutrition-Facts-December-2025.pdf?rlkey=rgdz9iheqlhro9f81wotwrjws&dl=1",
      "sha256": "018024a47941502aac9fc1d7db658ae0c361b75643b30cf8de59155e55644fee",
      "locator": "page 1, Sides, Gyudon Beef, 198 g"
    }
  }
];
