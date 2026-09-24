/** @type {import('next').NextConfig} */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  distDir: '.next-monitor',
  experimental: {
    monorepo: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.unsplash.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' }
    ]
  },
  webpack: (config, { isServer, buildId, dev, nextRuntime, webpack }) => {
    // Debug page discovery: log page roots and glob results
    if (!isServer && !dev) {
      config.plugins = config.plugins || [];
      config.plugins.push({
        apply: (compiler) => {
          compiler.hooks.afterEnvironment.tap('PageDiscoveryDebug', () => {
            console.log('[PAGE_DISCOVERY] Compiler environment ready');
          });
          
          compiler.hooks.entryOption.tap('PageDiscoveryDebug', (context, entry) => {
            console.log('[PAGE_DISCOVERY] Entry option:', JSON.stringify(entry, null, 2));
          });
        }
      });
    }
    
    // Filter app-build-manifest.json to only include monitor app's actual pages
    if (!isServer) {
      config.plugins = config.plugins || [];
      config.plugins.push({
        apply: (compiler) => {
          compiler.hooks.compilation.tap('PageFilterPlugin', (compilation) => {
            compilation.hooks.processAssets.tap(
              { name: 'PageFilterPlugin', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE },
              (assets) => {
                const manifestKey = Object.keys(assets).find(key => key === 'app-build-manifest.json');
                if (manifestKey) {
                  try {
                    const manifestContent = assets[manifestKey].source();
                    const manifest = JSON.parse(manifestContent.toString());
                    
                    // Only keep pages that actually exist in this app's src/app
                    const allowedPages = new Set(['/page', '/layout', '/_not-found/page']);
                    const filteredPages = {};
                    
                    for (const [pagePath, chunks] of Object.entries(manifest.pages || {})) {
                      if (allowedPages.has(pagePath)) {
                        filteredPages[pagePath] = chunks;
                      } else {
                        console.log('[PAGE_FILTER] Removing leaked page:', pagePath);
                      }
                    }
                    
                    manifest.pages = filteredPages;
                    const newContent = JSON.stringify(manifest, null, 2);
                    
                    // Replace the asset
                    assets[manifestKey] = new webpack.sources.RawSource(newContent);
                    console.log('[PAGE_FILTER] Filtered app-build-manifest.json, kept pages:', Object.keys(filteredPages));
                  } catch (e) {
                    console.error('[PAGE_FILTER] Error filtering manifest:', e);
                  }
                }
              }
            );
          });
        }
      });
    }
    
    if (!isServer) {
      console.log('[PAGE_DISCOVERY] CWD:', process.cwd());
      console.log('[PAGE_DISCOVERY] Monitor appDir:', path.resolve(process.cwd(), 'src', 'app'));
      console.log('[PAGE_DISCOVERY] Web app appDir:', path.resolve(process.cwd(), '..', 'web', 'src', 'app'));
    }
    
    return config;
  }
};

export default nextConfig