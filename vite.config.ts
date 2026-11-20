import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
          // Strip the unbuilt GitHub Pages redirect from the compiled dist/index.html
          const distIndex = path.join(distDir, 'index.html');
          if (fs.existsSync(distIndex)) {
            const html = fs
              .readFileSync(distIndex, 'utf8')
              .replace(/<script data-gh-pages-redirect>[\s\S]*?<\/script>\s*/g, '');
            fs.writeFileSync(distIndex, html, 'utf8');
          }
          // Mirror the compiled bundle into docs/ and inline CSS/JS into docs/index.html
          // so it works BOTH on GitHub Pages AND when double-clicked locally via file:// (zero CORS issues)
          if (fs.existsSync(distDir)) {
            const docsDir = path.resolve(import.meta.dirname, 'docs');
            fs.rmSync(docsDir, {recursive: true, force: true});
            fs.cpSync(distDir, docsDir, {recursive: true, force: true});
            fs.writeFileSync(path.join(docsDir, '.nojekyll'), '', 'utf8');

            const docsIndex = path.join(docsDir, 'index.html');
            if (fs.existsSync(docsIndex)) {
              let docsHtml = fs.readFileSync(docsIndex, 'utf8');
              const inlinedFiles: string[] = [];

              // Inline stylesheets
              docsHtml = docsHtml.replace(
                /<link\b[^>]*rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+\.css)"[^>]*>/g,
                (match, relPath: string) => {
                  const cssPath = path.join(docsDir, relPath.replace(/^\.\//, ''));
                  if (!fs.existsSync(cssPath)) return match;
                  inlinedFiles.push(cssPath);
                  const css = fs.readFileSync(cssPath, 'utf8').replace(/<\/style/gi, '<\\/style');
                  return `<style>${css}</style>`;
                }
              );

              // Extract and inline module scripts at the end of <body>
              const inlineScripts: string[] = [];
              docsHtml = docsHtml.replace(
                /<script\b[^>]*type="module"[^>]*src="(\.\/assets\/[^"]+\.js)"[^>]*><\/script>\s*/g,
                (match, relPath: string) => {
                  const jsPath = path.join(docsDir, relPath.replace(/^\.\//, ''));
                  if (!fs.existsSync(jsPath)) return match;
                  inlinedFiles.push(jsPath);
                  const js = fs.readFileSync(jsPath, 'utf8').replace(/<\/script/gi, '<\\/script');
                  inlineScripts.push(`<script type="module">${js}</script>`);
                  return '';
                }
              );

              if (inlineScripts.length > 0) {
                const scriptBlock = `${inlineScripts.join('\n')}\n  </body>`;
                docsHtml = docsHtml.replace('</body>', () => scriptBlock);
              }

              fs.writeFileSync(docsIndex, docsHtml, 'utf8');
              for (const f of inlinedFiles) {
                fs.rmSync(f, {force: true});
              }
            }
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
