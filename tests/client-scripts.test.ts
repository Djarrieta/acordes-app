import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const SCRIPTS = ["youtube.js", "audio.js", "editor.js"] as const;

function createBrowserContext() {
  const noop = () => {};
  const documentStub = {
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ append() {}, addEventListener: noop }),
    body: { addEventListener: noop, classList: { add: noop, remove: noop } },
  };
  const context: Record<string, unknown> = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Map,
    Set,
    Promise,
    document: documentStub,
    HTMLElement: class {},
    Element: class {},
    AudioContext: class {},
    AudioWorkletNode: class {},
  };
  context.window = context;
  vm.createContext(context);
  return context;
}

describe("client scripts", () => {
  test("load together in the same global scope without redeclaration errors", async () => {
    const context = createBrowserContext();
    for (const name of SCRIPTS) {
      const code = await readFile(join(PUBLIC_DIR, name), "utf8");
      const script = new vm.Script(code, { filename: name });
      expect(() => script.runInContext(context)).not.toThrow();
    }
    const audio = (context as { AcordesAudio?: { debug?: unknown } }).AcordesAudio;
    expect(audio).toBeDefined();
    expect(typeof audio?.debug).toBe("function");
  });
});
