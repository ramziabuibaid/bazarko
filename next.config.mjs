const nextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '8mb' } },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com'
      },
      {
        protocol: 'https',
        hostname: 'hncjwffgicesmlpuwegr.supabase.co',
        pathname: '/storage/v1/object/public/**'
      }
    ]
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_DOMAIN: process.env.NEXT_PUBLIC_DOMAIN || 'bazarko.app'
  }
};

export default nextConfig;
