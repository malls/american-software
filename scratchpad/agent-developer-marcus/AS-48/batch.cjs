// Run several recipes concurrently: node batch.cjs "<name> <mutator> [args]" ...
const { spawn } = require('child_process');
const fs = require('fs');
const HERE = __dirname;
const jobs = process.argv.slice(2).map((spec) => spec.split(' '));
let pending = jobs.length;
for (const args of jobs) {
  const outFile = `${HERE}/out-${args[0]}.txt`;
  const out = fs.openSync(outFile, 'w');
  const p = spawn('node', [`${HERE}/recipe.cjs`, ...args], { stdio: ['ignore', out, out] });
  p.on('exit', (code) => {
    fs.closeSync(out);
    console.log(`=== ${args[0]} exit ${code}\n${fs.readFileSync(outFile, 'utf8')}`);
    if (--pending === 0) console.log('BATCH DONE');
  });
}
