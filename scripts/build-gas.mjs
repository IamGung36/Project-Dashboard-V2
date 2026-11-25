import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const GAS_DIR = path.join(ROOT_DIR, 'gas_deploy');

console.log('Building Google Apps Script deployment files...');

// Ensure gas_deploy exists
if (!fs.existsSync(GAS_DIR)) {
  fs.mkdirSync(GAS_DIR, { recursive: true });
}

// 1. Copy gas/Code.gs and gas/appsscript.json
fs.copyFileSync(
  path.join(ROOT_DIR, 'gas', 'Code.gs'),
  path.join(GAS_DIR, 'Code.gs')
);
fs.copyFileSync(
  path.join(ROOT_DIR, 'gas', 'appsscript.json'),
  path.join(GAS_DIR, 'appsscript.json')
);

// 2. Wrap css/style.css into gas_deploy/style.html
const cssContent = fs.readFileSync(path.join(ROOT_DIR, 'css', 'style.css'), 'utf-8');
fs.writeFileSync(path.join(GAS_DIR, 'style.html'), `<style>\n${cssContent}\n</style>\n`);

// 3. Wrap js/*.js into gas_deploy/*_js.html
const jsFiles = [
  { src: 'db.js', dest: 'db_js.html' },
  { src: 'app.js', dest: 'app_js.html' },
  { src: 'calendar.js', dest: 'calendar_js.html' },
  { src: 'kanban.js', dest: 'kanban_js.html' },
  { src: 'manhours.js', dest: 'manhours_js.html' }
];

for (const f of jsFiles) {
  const content = fs.readFileSync(path.join(ROOT_DIR, 'js', f.src), 'utf-8');
  fs.writeFileSync(path.join(GAS_DIR, f.dest), `<script>\n${content}\n</script>\n`);
}

// 4. Generate gas_deploy/index.html from index.html
let html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf-8');

// Replace CSS link with <?!= include("style"); ?>
html = html.replace(
  /<link\s+rel="stylesheet"\s+href="css\/style\.css"[^>]*>/i,
  '<?!= include("style"); ?>'
);

// Inline logo.png as base64 data URL if available
const logoPath = path.join(ROOT_DIR, 'logo.png');
if (fs.existsSync(logoPath)) {
  const logoBase64 = fs.readFileSync(logoPath).toString('base64');
  const logoDataUri = `data:image/png;base64,${logoBase64}`;
  html = html.replace(/src="logo\.png"/g, `src="${logoDataUri}"`);
}

// Inject pre-injected database script tag in <head>
const gasDbInject = `
  <script id="gas-db-json" type="application/json">
    <?!= getDatabaseJson(); ?>
  </script>
`;
if (!html.includes('id="gas-db-json"')) {
  html = html.replace('</head>', `${gasDbInject}</head>`);
}

// Replace script tags with <?!= include("..."); ?>
const scriptReplacements = `
  <?!= include("db_js"); ?>
  <?!= include("kanban_js"); ?>
  <?!= include("calendar_js"); ?>
  <?!= include("manhours_js"); ?>
  <?!= include("app_js"); ?>
`;

// Replace the block of 5 script tags
html = html.replace(
  /<script\s+src="js\/db\.js"><\/script>\s*<script\s+src="js\/kanban\.js"><\/script>\s*<script\s+src="js\/calendar\.js"><\/script>\s*<script\s+src="js\/manhours\.js"><\/script>\s*<script\s+src="js\/app\.js"><\/script>/,
  scriptReplacements.trim()
);

fs.writeFileSync(path.join(GAS_DIR, 'index.html'), html);

console.log('Build complete! Files generated in gas_deploy/:');
fs.readdirSync(GAS_DIR).forEach(file => {
  const stat = fs.statSync(path.join(GAS_DIR, file));
  console.log(`  - ${file} (${stat.size.toLocaleString()} bytes)`);
});
