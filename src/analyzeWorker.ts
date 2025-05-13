import { parentPort, workerData } from 'worker_threads';
import { analyze } from './analysis';
import { getRootFolder } from './util';
import path from 'path';
import { getService } from './ts-utils';

const { pathString, fileString, line, column, m } = workerData

const rootFolder = getRootFolder(pathString);
const file = path.resolve(rootFolder, fileString);
const service = getService(rootFolder);

const warnings = new Set();
console.warn = (message) => warnings.add(message);

const pre = Date.now();

const results = analyze(service, file, line, column, m);
const post = Date.now();

const time = post - pre;

parentPort!.postMessage([results, warnings, time]);