import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  logging: {
    // The dev server otherwise prints every Server Action call with its
    // arguments and return value, which can include users' emails.
    serverFunctions: false,
  },
};

export default nextConfig;
