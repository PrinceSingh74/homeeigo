import { describe, test, expect } from "bun:test";
import { copyToClipboard } from "../clipboard";

describe("copyToClipboard", () => {
  test("does not throw when navigator.clipboard is missing", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });

    try {
      await expect(copyToClipboard("https://example.test/invite")).resolves.toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  test("uses clipboard.writeText when available", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const writeText = async (value: string) => {
      expect(value).toBe("copied-link");
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText } },
    });

    try {
      await expect(copyToClipboard("copied-link")).resolves.toBe(true);
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });
});
