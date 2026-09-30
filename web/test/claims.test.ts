import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== "node_modules" && file !== ".next") {
        getAllFiles(fullPath, arrayOfFiles);
      }
    } else if (file.endsWith(".tsx") || file.endsWith(".ts")) {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

describe("Claims & Copy Audit Guard (L15 & Decision F1)", () => {
  const webDir = path.resolve(__dirname, "..");
  const appFiles = getAllFiles(path.join(webDir, "app"));
  const componentFiles = getAllFiles(path.join(webDir, "components"));
  const allUiFiles = [...appFiles, ...componentFiles];

  // Banned prototype company names
  const prototypeEntities = ["Studio Ana", "Northwind", "Halden", "Kestrel", "Forge"];

  // Banned deceptive marketing claims
  const deceptiveClaims = [
    /\bgasless\b/i,
    /\bguaranteed\b/i,
    /\bno gas, ever\b/i,
    /\bfraud can't happen\b/i,
    /\b100% secure\b/i,
    /\bdemo data\b/i,
    /\bmock data\b/i,
    /\bsample invoice\b/i,
  ];

  it("ensures no prototype entity names leak into UI source files", () => {
    const violations: { file: string; match: string }[] = [];

    for (const file of allUiFiles) {
      const content = fs.readFileSync(file, "utf-8");
      for (const entity of prototypeEntities) {
        if (content.includes(entity)) {
          violations.push({ file: path.relative(webDir, file), match: entity });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("ensures no deceptive or unauthorized claims appear in UI components or pages", () => {
    const violations: { file: string; match: string }[] = [];

    for (const file of allUiFiles) {
      const content = fs.readFileSync(file, "utf-8");
      for (const pattern of deceptiveClaims) {
        const match = content.match(pattern);
        if (match) {
          violations.push({ file: path.relative(webDir, file), match: match[0] });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("ensures the word 'demo' does not appear in user-facing UI markup", () => {
    const violations: { file: string; line: string }[] = [];

    for (const file of allUiFiles) {
      const lines = fs.readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, idx) => {
        // Skip comments
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;

        // Check for standalone word "demo" (avoid matching words like "demoted")
        if (/\bdemo\b/i.test(line)) {
          violations.push({ file: `${path.relative(webDir, file)}:${idx + 1}`, line: trimmed });
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
