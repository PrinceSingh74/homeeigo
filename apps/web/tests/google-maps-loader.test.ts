/**
 * The Google Maps loader, as a state machine over one `<script>` tag.
 *
 * Run from `apps/web`:
 *
 *     bun test tests
 *
 * There is no DOM library in this app either (the same test lives in `apps/partner-web`), so the page is a hand-built fake: a `document` that
 * records what was appended and removed, and a script element the test drives by firing its
 * `onload` / `onerror` and by deciding when — or whether — `google.maps.importLibrary` appears.
 * That is all the loader ever touches, and it keeps each scenario a statement about ORDER.
 *
 * The order in `healthy()` is not invented. Measured in Chromium against the real API
 * (2026-09-27): `onload` at 3127 ms with `google.maps` present and `importLibrary` still
 * `undefined`; the callback at 3329 ms with `importLibrary` a function. The bootstrap only fetches
 * `main.js`; the API arrives afterwards. A loader that treats `onload` as "ready or dead" therefore
 * fails every healthy load — scenario 1 exists to make that mistake impossible to ship.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __mapsLoaderTestHooks as loader } from "@/hooks/use-google-maps-loader";

type FakeScript = {
  id: string;
  src: string;
  async: boolean;
  defer: boolean;
  onload: null | (() => void);
  onerror: null | (() => void);
  attrs: Map<string, string>;
  removed: boolean;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  remove(): void;
};

let appended: FakeScript[] = [];
const g = globalThis as unknown as Record<string, unknown>;

/** The page's `window`, as its own object, so the page's globals stay off the test runner's. */
let win: Record<string, unknown> = {};

function installFakePage(): void {
  appended = [];
  const live = () => appended.filter((s) => !s.removed);
  win = {
    setTimeout: setTimeout.bind(globalThis),
    clearTimeout: clearTimeout.bind(globalThis),
    setInterval: setInterval.bind(globalThis),
    clearInterval: clearInterval.bind(globalThis),
  };
  g.window = win;
  g.document = {
    head: {
      appendChild(el: FakeScript) {
        appended.push(el);
        return el;
      },
    },
    getElementById(id: string) {
      return live().find((s) => s.id === id) ?? null;
    },
    createElement(): FakeScript {
      const el: FakeScript = {
        id: "",
        src: "",
        async: false,
        defer: false,
        onload: null,
        onerror: null,
        attrs: new Map(),
        removed: false,
        setAttribute(name, value) {
          el.attrs.set(name, value);
        },
        getAttribute(name) {
          return el.attrs.get(name) ?? null;
        },
        remove() {
          el.removed = true;
        },
      };
      return el;
    },
  };
}

/** The API arriving: what `main.js` does once it has run. */
function apiArrives(): void {
  win.google = {
    maps: {
      importLibrary: async () => {
        (win.google as { maps: Record<string, unknown> }).maps.Map = function Map() {};
        return {};
      },
    },
  };
  (win.__homigoMapsReady as undefined | (() => void))?.();
}

/** The bootstrap having run: `google.maps` exists, the API does not. */
function bootstrapRan(script: FakeScript): void {
  win.google = { maps: {} };
  script.onload?.();
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * How a load ended: "resolved", or the error code it rejected with.
 *
 * Every scenario observes the loader through this and a plain `await`. Do not replace it with
 * `await expect(promise).resolves` / `.rejects`: on a promise that is still PENDING and needs a
 * timer to settle, bun 1.3.14 spins at 100% CPU with every timer dead — including its own
 * per-test timeout — so the run never ends and never reports. Measured here: the four scenarios
 * written that way hung the file in roughly half of all runs, and never when run alone.
 */
const outcomeOf = (load: Promise<void>): Promise<string> =>
  load.then(
    () => "resolved",
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );

async function nextTag(index: number, withinMs = 1_000): Promise<FakeScript> {
  const start = Date.now();
  while (appended.length <= index) {
    if (Date.now() - start > withinMs) throw new Error(`script tag #${index + 1} was never appended`);
    await tick(5);
  }
  return appended[index];
}

// The loader reads `window` and `document` only inside its functions, never at import time, so a
// static import above is safe and the fake page can be installed per test.

const REAL_TIMING = { ...loader.timing };

beforeEach(() => {
  installFakePage();
  loader.reset();
  Object.assign(loader.timing, { scriptMs: 250, libraryMs: 250, retryDelayMs: 10 });
});

afterEach(() => {
  Object.assign(loader.timing, REAL_TIMING);
});

describe("google maps loader", () => {
  test("1. a healthy load resolves — onload BEFORE importLibrary is the normal order, not a failure", async () => {
    const outcome = outcomeOf(loader.load("test-key"));
    const tag = await nextTag(0);

    bootstrapRan(tag); // onload fires; importLibrary is still undefined here, exactly as measured
    await tick(40);
    apiArrives();

    expect(await outcome).toBe("resolved");
    expect(appended.length).toBe(1);
    expect(tag.src).toContain("callback=__homigoMapsReady");
  });

  test("2. bootstrap ran but the API never initialised → maps_init_failed, after ONE retry on a FRESH tag", async () => {
    const outcome = outcomeOf(loader.load("test-key"));

    bootstrapRan(await nextTag(0));
    const second = await nextTag(1, 2_000); // before the fix this never appears: the retry re-waited on tag #1
    bootstrapRan(second);

    // Not `maps_timeout`: the script arrived and ran. Blaming the network sends the operator to
    // check an ad blocker when the cause is the key's quota, rate limit (HTTP 429) or billing.
    expect(await outcome).toBe("maps_init_failed");
    expect(appended.length).toBe(2);
    expect(appended[0].removed).toBe(true);
  });

  test("3. the script never arrives → maps_timeout, and the retry still gets its own fresh tag", async () => {
    const outcome = outcomeOf(loader.load("test-key"));

    await nextTag(0);
    await nextTag(1, 2_000);

    expect(await outcome).toBe("maps_timeout");
    expect(appended[0].removed).toBe(true);
  });

  test("4. a retry that succeeds recovers the page", async () => {
    const outcome = outcomeOf(loader.load("test-key"));

    await nextTag(0); // first attempt: nothing ever happens
    const second = await nextTag(1, 2_000);
    bootstrapRan(second);
    await tick(20);
    apiArrives();

    expect(await outcome).toBe("resolved");
  });

  test("5. a script that fails to download → maps_load_failed, with no retry", async () => {
    const outcome = outcomeOf(loader.load("test-key"));

    (await nextTag(0)).onerror?.();

    expect(await outcome).toBe("maps_load_failed");
    await tick(60);
    expect(appended.length).toBe(1);
  });

  test("6. a dead tag left by an earlier attempt is replaced at once, not waited on", async () => {
    // What a hot reload leaves behind: module state is gone, the tag is still in the document,
    // and it finished long ago without ever producing an API.
    const corpse = (g.document as { createElement(): FakeScript }).createElement();
    corpse.id = "gmaps-js";
    corpse.src = "https://maps.googleapis.com/maps/api/js?key=old&callback=__homigoMapsReady";
    corpse.setAttribute("data-homigo-settled-at", String(Date.now() - 60_000));
    appended.push(corpse);

    const outcome = outcomeOf(loader.load("test-key"));
    const fresh = await nextTag(1);
    bootstrapRan(fresh);
    await tick(20);
    apiArrives();

    expect(await outcome).toBe("resolved");
    expect(corpse.removed).toBe(true);
  });

  test("7. a tag that is still loading is left alone", async () => {
    // The other half of scenario 6. A hot reload can also land while the script is mid-flight;
    // replacing THAT tag would load the API twice.
    const inFlight = (g.document as { createElement(): FakeScript }).createElement();
    inFlight.id = "gmaps-js";
    inFlight.src = "https://maps.googleapis.com/maps/api/js?key=k&callback=__homigoMapsReady";
    appended.push(inFlight);

    const outcome = outcomeOf(loader.load("test-key"));
    await tick(40);
    expect(appended.length).toBe(1);

    win.__homigoMapsReady = () => inFlight.setAttribute("data-homigo-loaded", "true");
    bootstrapRan(inFlight);
    apiArrives();

    expect(await outcome).toBe("resolved");
    expect(inFlight.removed).toBe(false);
  });
});
