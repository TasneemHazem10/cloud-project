const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const targets = [
  {
    dir: path.join(root, 'backend'),
    required: ['server.js', 'app.js', 'config.js', 'db/schema.sql', '.env.example', 'package.json']
  },
  {
    dir: path.join(root, 'frontend'),
    required: ['index.html', 'js/app.js', 'js/config.js', 'css/styles.css', 'vercel.json', 'package.json']
  }
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        return [];
      }
      return walk(full);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}

for (const target of targets) {
  for (const file of target.required) {
    const full = path.join(target.dir, file);
    if (!fs.existsSync(full)) {
      throw new Error(`Missing required file: ${path.relative(root, full)}`);
    }
  }
  for (const file of walk(target.dir)) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'ignore' });
  }
  JSON.parse(fs.readFileSync(path.join(target.dir, 'package.json'), 'utf8'));
}

for (const file of ['neon.ts', 'README.md', 'package.json']) {
  if (!fs.existsSync(path.join(root, file))) {
    throw new Error(`Missing required file: ${file}`);
  }
}
JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

console.log('Build validation passed: backend JS, frontend JS, JSON, Neon config and required files.');
