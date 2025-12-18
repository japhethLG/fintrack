import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";

// Route segment config
export const dynamic = "force-static";

// Image metadata
export const size = {
  width: 32,
  height: 32,
};
export const contentType = "image/png";

// Image generation - use the logo.png
export default async function Icon() {
  // Read the logo as base64
  const logoPath = join(process.cwd(), "public", "logo.png");
  const logoBuffer = readFileSync(logoPath);
  const logoBase64 = `data:image/png;base64,${logoBuffer.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "6px",
          overflow: "hidden",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoBase64}
          alt="FinTrack"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </div>
    ),
    {
      ...size,
    }
  );
}
