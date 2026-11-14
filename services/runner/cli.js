import {writeFileSync} from 'node:fs';
import {runBatch,pairedJobs} from './index.js';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--pairs','--workers','--out','--metrics'].includes(args[i])||!args[i+1])throw Error('Usage: node services/runner/cli.js [--pairs N] [--workers N] [--out PATH] [--metrics PATH]');options[args[i]]=args[i+1];}
const pairs=Number(options['--pairs']??100),workers=Number(options['--workers']??2);
if(!Number.isInteger(pairs)||pairs<1||pairs>10000)throw Error('INVALID_SCHEMA');
const {results,metrics}=await runBatch(pairedJobs({seeds:Array.from({length:pairs},(_,i)=>i+1)}),{workers});
const json=JSON.stringify(results,null,2)+'\n';
if(options['--out'])writeFileSync(options['--out'],json);else process.stdout.write(json);
if(options['--metrics'])writeFileSync(options['--metrics'],JSON.stringify(metrics,null,2)+'\n');
process.stderr.write(JSON.stringify(metrics)+'\n');
if(metrics.invalidMatches)process.exitCode=1;
