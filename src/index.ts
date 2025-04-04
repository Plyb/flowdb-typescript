import path from 'path';
import { analyze } from './analysis';
import { getServiceAndPrettyShow } from './ts-utils';

function runAnalysis(pathString: string, fileString: string, line: number, column: number) {
  const rootFolder = path.resolve(__dirname, pathString);
  const file = path.resolve(rootFolder, fileString);
  const { service, prettyShow } = getServiceAndPrettyShow(rootFolder);

  function justCompute(item: string) {
    if (!item.startsWith('compute')) {
      return;
    }
    console.log(item);
  }

  // console.info = () => undefined
  console.info = prettyShow
  // console.info = justCompute

  const results = analyze(service, file, line, column);
  return results;
}

analyzeInboxZero()

function analyzePlayground() {
  console.log((runAnalysis('../../examples/playground', './test.ts', 3, 6)).elements)
}

function analyzeInboxZeroClean() {
  console.log(runAnalysis('../../examples/inbox-zero-clean', './test.ts', 86010, 6).elements)
}

function analyzeInboxZero() {
  console.log(runAnalysis('../../examples/inbox-zero/apps/web', './app/api/user/categorize/senders/batch/handle-batch.ts', 35, 6).elements)
}
