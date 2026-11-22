import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const wwwDir = path.join(root, 'www');

console.log('Building web + Firebase bundle (vite build)...');
execSync('npm run build', {stdio: 'inherit', cwd: root});

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error(`Missing built bundle at: ${distDir}`);
  process.exit(1);
}

fs.rmSync(wwwDir, {recursive: true, force: true});
fs.cpSync(distDir, wwwDir, {recursive: true, force: true});

console.log(`Prepared Android APK bundle in ${wwwDir} from ${distDir}.`);
