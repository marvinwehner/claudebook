import { describe, expect, it } from "vitest";

import { applyDelta } from "@/components/use-notebook-stream";
import type { UiEvent } from "@/lib/anthropic/events";

function delta(id: string, index: number, text: string): Extract<UiEvent, { kind: "delta" }> {
  return { kind: "delta", id, index, text };
}

/** What the render does with the buffer: every entry of every preview, joined. */
function rendered(previews: Map<string, string[]>): string {
  return [...previews.values()].map((parts) => parts.join("")).join("");
}

describe("applyDelta", () => {
  // The bug this exists for: `index` is the content-block index, so every
  // fragment of one text block shares it. Assigning instead of appending left
  // only the newest fragment on screen until the buffered message landed.
  it("appends fragments that share an index", () => {
    let previews = new Map<string, string[]>();
    for (const [index, text] of [
      [0, "The "],
      [0, "three "],
      [0, "themes"],
    ] as const) {
      previews = applyDelta(previews, delta("sevt_1", index, text));
    }

    expect(rendered(previews)).toBe("The three themes");
  });

  it("keeps separate content blocks in their own entries", () => {
    let previews = applyDelta(new Map(), delta("sevt_1", 0, "first"));
    previews = applyDelta(previews, delta("sevt_1", 1, "second"));
    previews = applyDelta(previews, delta("sevt_1", 0, "-more"));

    expect(previews.get("sevt_1")).toEqual(["first-more", "second"]);
  });

  it("keeps two concurrent previews apart", () => {
    let previews = applyDelta(new Map(), delta("sevt_1", 0, "a"));
    previews = applyDelta(previews, delta("sevt_2", 0, "b"));

    expect(previews.get("sevt_1")).toEqual(["a"]);
    expect(previews.get("sevt_2")).toEqual(["b"]);
  });

  // The hook holds this in useState, so a mutated map would not re-render.
  it("does not mutate the map or the array it was given", () => {
    const before = new Map([["sevt_1", ["a"]]]);
    const after = applyDelta(before, delta("sevt_1", 0, "b"));

    expect(before.get("sevt_1")).toEqual(["a"]);
    expect(after).not.toBe(before);
    expect(after.get("sevt_1")).toEqual(["ab"]);
  });
});
