const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const problems = [];
for (const file of files) {
  if ((/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) ||
      /(^|\/)(data|node_modules)\//.test(file) || /\.session(?:-|$)/.test(file) || /\.(pem|key)$/.test(file)) {
    problems.push(file + ': private file must not be tracked');
    continue;
  }
  const text = fs.readFileSync(file, 'utf8');
  if (/\b\d{5,}:[A-Za-z0-9_-]{25,}\b/.test(text)) problems.push(file + ': possible bot token');
  if (/TG_API_HASH\s*=\s*[a-f0-9]{32}\b/i.test(text)) problems.push(file + ': possible API hash');
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text)) problems.push(file + ': private key');
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('Public file checks passed (' + files.length + ' files).');
