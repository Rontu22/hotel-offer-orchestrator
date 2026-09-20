import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pure static bundle: no Node server in production, so it ships to S3 and is
  // served by CloudFront. All data fetching happens in the browser.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
