// Captured April identities and UE responses, September 2026. PDF facts are explicitly reviewable here.
import ue from "./__snapshots__/chain-pilot-responses.json";
// Independent transcription of the PDF table; never derive these expectations from chainPilotData.
export const chainPilotTruth = {
  "chicken-plate": { calories: 820, proteinG: 54, carbsG: 110, fatG: 15, servingSize: "1 standard chicken plate" },
  "steak-plate": { calories: 980, proteinG: 44, carbsG: 130, fatG: 27, servingSize: "1 standard steak plate" },
  "chicken-veggie-bowl": { calories: 590, proteinG: 39, carbsG: 90, fatG: 11, servingSize: "1 standard chicken rice veggie bowl" },
  "miso-soup": { calories: 30, proteinG: 2, carbsG: 3, fatG: 0, servingSize: "1 standard soup serving" },
  "gyudon-beef-side": { calories: 310, proteinG: 21, carbsG: 8, fatG: 21, servingSize: "198 g protein side (no rice)" },
  "habanero-chicken-side": { calories: 290, proteinG: 28, carbsG: 18, fatG: 11, servingSize: "166 g protein side (no rice)" },
  "blount-clam-chowder": { calories: 300, proteinG: 9, carbsG: 18, fatG: 22, servingSize: "227 g soup serving" },
};
export const capturedChainPilot = [
  {
    slug: "waba-grill", name: "WaBa Grill - Van Nuys (Sepulveda)",
    april: {"name": "Chicken Plate", "section": "Plates", "description": "Grilled all-natural, never frozen chicken caramelized with our signature WaBa sauce.", "calories": 672, "proteinG": 42, "carbsG": 73, "fatG": 23},
    ue: ue[0]!,
    official: chainPilotTruth["chicken-plate"],
    source: {
      url: "https://cp1.inkrefuge.com/admin/asset/uploads/296/on_page_element/pdf/jan2025-nutrition-chart-final.pdf",
      sha256: "813243b3b287e7898340173675b94a0ece7d1116a236a78f313661fec8473e6d",
      locator: "page 1, Plates, Chicken",
    },
  },
  {
    slug: "yoshinoya", name: "Yoshinoya (3081 N. San Fernando Road)",
    april: {"name": "Original Gyudon Beef", "section": "Ala Carte", "description": "Thin juicy ribbons of Gyudon Beef and chopped onions, slowly simmered in a sweet and savory herb miso soy broth.", "calories": 443, "proteinG": 32, "carbsG": 38, "fatG": 18},
    ue: ue[1]!,
    official: chainPilotTruth["gyudon-beef-side"],
    source: {
      url: "https://www.dropbox.com/scl/fi/945n2jb4x08wp7fztvn81/Nutrition-Facts-December-2025.pdf?rlkey=rgdz9iheqlhro9f81wotwrjws&dl=1",
      sha256: "018024a47941502aac9fc1d7db658ae0c361b75643b30cf8de59155e55644fee",
      locator: "page 1, Sides, Gyudon Beef, 198 g",
    },
  },
];
