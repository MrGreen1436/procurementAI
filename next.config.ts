import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: "http://127.0.0.1:8000/:path*",
      },
      {
        source: "/backend-voice/:path*",
        destination: "http://127.0.0.1:3001/:path*",
      },
    ];
  },
};

export default nextConfig;
