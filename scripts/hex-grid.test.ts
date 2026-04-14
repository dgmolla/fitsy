import { generateHexGrid, generateSingleHex } from "./hex-grid";

describe("generateHexGrid", () => {
  it("generates hex cells for LA metro at resolution 7", () => {
    const cells = generateHexGrid();
    // LA metro should produce ~80-120 hexes at res 7
    expect(cells.length).toBeGreaterThan(50);
    expect(cells.length).toBeLessThan(200);
  });

  it("returns deterministic output", () => {
    const a = generateHexGrid();
    const b = generateHexGrid();
    expect(a.map((c) => c.hexId)).toEqual(b.map((c) => c.hexId));
  });

  it("each cell has hexId, lat, lng", () => {
    const cells = generateHexGrid();
    for (const cell of cells) {
      expect(cell.hexId).toBeTruthy();
      expect(typeof cell.lat).toBe("number");
      expect(typeof cell.lng).toBe("number");
      // LA metro bounds
      expect(cell.lat).toBeGreaterThan(33.9);
      expect(cell.lat).toBeLessThan(34.2);
      expect(cell.lng).toBeGreaterThan(-118.55);
      expect(cell.lng).toBeLessThan(-118.1);
    }
  });

  it("produces no duplicate hex IDs", () => {
    const cells = generateHexGrid();
    const ids = cells.map((c) => c.hexId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("supports custom polygon and resolution", () => {
    const smallPoly: [number, number][] = [
      [34.1, -118.3],
      [34.1, -118.28],
      [34.08, -118.28],
      [34.08, -118.3],
    ];
    const cells = generateHexGrid(smallPoly, 7);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(20);
  });
});

describe("generateSingleHex", () => {
  it("returns a hex with hex_single id", () => {
    const hex = generateSingleHex(34.0928, -118.3086);
    expect(hex.hexId).toBe("hex_single");
    expect(hex.lat).toBe(34.0928);
    expect(hex.lng).toBe(-118.3086);
  });
});
