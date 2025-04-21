import path from 'path';
import { analyze } from './analysis';
import { getService } from './ts-utils';
import { runTests } from './tests';
import { StructuralSet } from './structural-set';
import { ConfigSet, printConfig } from './configuration';
import { preprocess } from './preprocess';
import { getRootFolder } from './util';
import { prepareNextCrm } from './prepareExamples';

function runAnalysis(pathString: string, fileString: string, line: number, column: number, m: number) {
  const rootFolder = getRootFolder(pathString);
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

// analyzeInboxZero()
// analyzeNextCrm()
analyzePapermark()

// prepareNextCrm()

// analyzePlayground()

function analyzePlayground() {
  console.log((runAnalysis('../../examples/playground', './test.ts', 7, 0, 3)).elements)
}

function analyzeInboxZero() {
  printResults(runAnalysis('../../examples/inbox-zero/apps/web', './app/api/user/categorize/senders/batch/handle-batch.ts', 35, 6, 5))
}

function analyzeNextCrm() {
  printResults(runAnalysis('../../examples/nextcrm-app/dist', './app/[locale]/(routes)/projects/boards/[boardId]/page.js', 16, 18, 3))
}

function analyzePapermark() {
  printResults(runAnalysis('../../examples/papermark', './pages/api/teams/[teamId]/datarooms/[id]/generate-index.ts', 11, 21, 3))
}

// runTests();


function printResults(results: StructuralSet<{ table: string, method: string, argument: ConfigSet}>) {
  for (const result of results.elements) {
    console.log(
`table: ${result.table}
method: ${result.method}
arg: ${result.argument.elements.map(printConfig).join('\n')}
---------------------
`);
  }
}