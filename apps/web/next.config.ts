import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output so the production Docker image ships a minimal server.
  output: "standalone",

  webpack(config) {
    // The codebase uses the NodeNext ".js"-suffix import style
    // (import "./x.js" for "./x.ts"), which TypeScript resolves but webpack
    // does not by default. Map .js back to the TypeScript sources.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ...config.resolve.extensionAlias,
    };
    return config;
  },
};

export default nextConfig;
