import { parentPort, workerData } from 'worker_threads';
import { AnalysisResults, analyze } from './analysis';
import { getRootFolder } from './util';
import path from 'path';
import { getService } from './ts-utils';
import { ConfigSet, printConfig } from './configuration';

const { pathString, fileString, line, column, m } = workerData

const rootFolder = getRootFolder(pathString);
const file = path.resolve(rootFolder, fileString);
const service = getService(rootFolder);

const warnings = new Set();
console.warn = (message) => warnings.add(message);

function justCompute(item: string) {
  if (!item.startsWith('compute')) {
    return;
  }
  console.log(item);
}

console.info = () => undefined
// console.info = justCompute

const pre = Date.now();

const results = analyze(service, file, line, column, m);
const post = Date.now();

const time = post - pre;

parentPort!.postMessage([stringifyResults(results), warnings, time]);

function stringifyResults(results: AnalysisResults) {
  let strSet = new Set();
  for (const result of results) {
    strSet.add(
`table: ${result.table}
method: ${result.method}
arg: ${result.argument?.map(printConfig).join('\n')}
---------------------
`);
  }
  return strSet
}
