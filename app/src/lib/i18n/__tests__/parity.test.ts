import { describe, it, expect } from "vitest";
import { en } from "@/lib/i18n/translations/en";
import { ar } from "@/lib/i18n/translations/ar";
import { es } from "@/lib/i18n/translations/es";
import { fr } from "@/lib/i18n/translations/fr";

type AnyRecord = Record<string, unknown>;

/** Collect every leaf key path (dot-notation) from a nested translation object. */
function collectKeys(obj: AnyRecord, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...collectKeys(value as AnyRecord, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

/** Look up a dot-path leaf value in a nested object. */
function getValue(obj: AnyRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") return (acc as AnyRecord)[part];
    return undefined;
  }, obj);
}

/** Extract placeholder tokens like {0}, {1} from a string, sorted. */
function placeholders(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
}

const locales: Array<[string, AnyRecord]> = [
  ["ar", ar],
  ["es", es],
  ["fr", fr],
];

describe("i18n translation parity", () => {
  const enKeys = collectKeys(en as AnyRecord).sort();

  for (const [name, locale] of locales) {
    describe(name, () => {
      const localeKeys = collectKeys(locale).sort();

      it("has no missing keys vs en", () => {
        const missing = enKeys.filter((k) => !localeKeys.includes(k));
        expect(missing, `${name} is missing keys: ${missing.join(", ")}`).toEqual([]);
      });

      it("has no extra keys vs en", () => {
        const extra = localeKeys.filter((k) => !enKeys.includes(k));
        expect(extra, `${name} has extra keys: ${extra.join(", ")}`).toEqual([]);
      });

      it("has matching placeholders for every key", () => {
        const mismatches: string[] = [];
        for (const key of enKeys) {
          const enP = placeholders(getValue(en as AnyRecord, key));
          const locP = placeholders(getValue(locale, key));
          if (enP.join(",") !== locP.join(",")) {
            mismatches.push(`${key} (en: ${enP.join(",")} | ${name}: ${locP.join(",")})`);
          }
        }
        expect(mismatches, `placeholder mismatches: ${mismatches.join("; ")}`).toEqual([]);
      });
    });
  }
});
