import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const assetsDir = path.join(__dirname, '../assets');
const standaloneHtmlPath = path.join(__dirname, '../standalone_viz.html');

try {
  const files = fs.readdirSync(assetsDir);
  const jsFile = files.find(f => f.startsWith('index-') && f.endsWith('.js') && !f.endsWith('.map'));
  const cssFile = files.find(f => f.startsWith('index-') && f.endsWith('.css') && !f.endsWith('.map'));

  if (!jsFile || !cssFile) {
    console.error('❌ Could not find built assets in assets directory.');
    process.exit(1);
  }

  let html = fs.readFileSync(standaloneHtmlPath, 'utf8');

  // Regex matches src="./assets/index-XXXXXX.js" and href="./assets/index-YYYYYY.css"
  const jsRegex = /src="\.\/assets\/index-[a-zA-Z0-9_-]+\.js"/g;
  const cssRegex = /href="\.\/assets\/index-[a-zA-Z0-9_-]+\.css"/g;

  html = html.replace(jsRegex, `src="./assets/${jsFile}"`);
  html = html.replace(cssRegex, `href="./assets/${cssFile}"`);

  fs.writeFileSync(standaloneHtmlPath, html);
  console.log(`✅ Updated standalone_viz.html with assets: JS=${jsFile}, CSS=${cssFile}`);
} catch (error) {
  console.error('❌ Failed to update standalone_viz.html:', error);
  process.exit(1);
}
