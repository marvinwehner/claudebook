import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/config/site";

export const alt = `${SITE_NAME} — ${SITE_DESCRIPTION}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Read from the favicon rather than repeating the geometry: it already carries
// the light-theme colours this card needs, so the two cannot drift.
const mark = `data:image/svg+xml;base64,${(
  await readFile(join(process.cwd(), "src/app/icon.svg"))
).toString("base64")}`;

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#F2EEE6",
          color: "#151B2E",
        }}
      >
        {/* next/image has no meaning inside Satori, which rasterises raw elements. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mark} width={140} height={140} alt="" />
        <div style={{ display: "flex", fontSize: 76, letterSpacing: "-0.02em", marginTop: 40 }}>
          {SITE_NAME}
        </div>
        <div style={{ display: "flex", fontSize: 32, color: "#5A6072", marginTop: 18 }}>
          {SITE_DESCRIPTION}
        </div>
      </div>
    ),
    size,
  );
}
