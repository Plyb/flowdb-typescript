import path from 'path';
import { analyze } from './analysis';
import { getService } from './ts-utils';
import { runTests } from './tests';

function runAnalysis(pathString: string, fileString: string, line: number, column: number, m: number) {
  const rootFolder = path.resolve(__dirname, pathString);
  const file = path.resolve(rootFolder, fileString);
  const service = getService(rootFolder);

  function justCompute(item: string) {
    if (!item.startsWith('compute')) {
      return;
    }
    console.log(item);
  }

  console.info = () => undefined
  // console.info = justCompute

  const results = analyze(service, file, line, column, m);
  return results;
}

analyzeInboxZero()
// analyzePlayground()

function analyzePlayground() {
  console.log((runAnalysis('../../examples/playground', './test.ts', 7, 0, 3)).elements)
}

function analyzeInboxZeroClean() {
  console.log(runAnalysis('../../examples/inbox-zero-clean', './test.ts', 86010, 6, 0).elements)
}

function analyzeInboxZero() {
  console.log(runAnalysis('../../examples/inbox-zero/apps/web', './app/api/user/categorize/senders/batch/handle-batch.ts', 35, 6, 4).elements)
}

// runTests();
