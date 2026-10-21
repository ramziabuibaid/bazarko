const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
let supabaseHost = 'hncjwffgicesmlpuwegr.supabase.co';
let supabasePort = '';
let supabaseProtocol = 'https';
try {
  if (supabaseUrl) {
    const u = new URL(supabaseUrl);
    supabaseHost = u.hostname;
    supabasePort = u.port || '';
    supabaseProtocol = u.protocol.replace(':', '') || 'http';
  }
} catch (e) {}

const remotePatterns = [
  {
    protocol: 'https',
    hostname: 'images.unsplash.com'
  },
  {
    protocol: 'https',
    hostname: 'hncjwffgicesmlpuwegr.supabase.co',
    pathname: '/storage/v1/object/public/**'
  }
];

if (supabaseHost && supabaseHost !== 'hncjwffgicesmlpuwegr.supabase.co') {
  remotePatterns.push({
    protocol: supabaseProtocol,
    hostname: supabaseHost,
    port: supabasePort || undefined,
    pathname: '/storage/v1/object/public/**'
  });
}

const nextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '8mb' } },
  images: {
    remotePatterns
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_DOMAIN: process.env.NEXT_PUBLIC_DOMAIN || 'bazarko.app'
  }
};

export default nextConfig;
