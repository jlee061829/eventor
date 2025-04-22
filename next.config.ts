import type { NextConfig } from "next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Warning: This allows you to deploy with ESLint errors
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;

export default nextConfig;
