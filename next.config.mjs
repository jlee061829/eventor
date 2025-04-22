/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Warning: This allows you to deploy with ESLint errors
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
