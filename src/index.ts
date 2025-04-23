import path from 'path';
import { analyze } from './analysis';
import { getService } from './ts-utils';
import { runTests } from './tests';
import { StructuralSet } from './structural-set';
import { Config, ConfigSet, printConfig } from './configuration';
import { preprocess } from './preprocess';
import { getRootFolder } from './util';
import { prepareFormbricks, prepareNextCrm } from './prepareExamples';

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
// analyzePapermark()
// analyzeHoppscotch()
// analyzeFormbricks()
// analyzeDocumenso()
// analyzeDittofeed()
// analyzeRevert()
// analyzeAbby()
// analyzeTriggerDev()
// analyzeScholarsome()
// analyzeDyrectorio()
analyzeLinenDev()

// prepareNextCrm()
// prepareFormbricks();

// analyzePlayground()

function analyzePlayground() {
  printResults(runAnalysis('../../examples/playground', './test.ts', 7, 0, 3))
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
function analyzeHoppscotch() {
  printResults(runAnalysis('../../examples/hoppscotch/packages/hoppscotch-backend', './src/infra-config/helper.ts', 279, 13, 3))
}
function analyzeFormbricks() {
  printResults(runAnalysis('../../examples/formbricks/apps/web', './modules/ee/contacts/api/v1/client/[environmentId]/identify/contacts/[userId]/lib/segments.ts', 29, 35, 3));
}
function analyzeDocumenso() {
  printResults(runAnalysis('../../examples/documenso/packages/lib', './server-only/recipient/set-document-recipients.ts', 42, 42, 3))
}
function analyzeDittofeed() {
  printResults(runAnalysis('../../examples/dittofeed/packages/api', './src/controllers/contentController.ts', 71, 10, 3))
}
function analyzeRevert() {
  printResults(runAnalysis('../../examples/revert/packages/backend', './routes/v1/fieldMapping.ts', 79, 32, 3))
}
function analyzeAbby() {
  printResults(runAnalysis('../../examples/abby/apps/web', './src/server/services/ConfigService.ts', 68, 13, 3))
}
function analyzeTriggerDev() {
  printResults(runAnalysis('../../examples/trigger.dev/apps/webapp', './app/presenters/v3/EnvironmentVariablesPresenter.server.ts', 17, 19, 3))
}
function analyzeScholarsome() {
  printResults(runAnalysis('../../examples/scholarsome/apps/api', './src/app/sets/sets.controller.ts', 317, 17, 3))
}
function analyzeDyrectorio() {
  printResults(runAnalysis('../../examples/dyrectorio/web/crux', './src/app/notification/notification.service.ts', 54, 26, 3))
}
function analyzeLinenDev() {
  printResults(runAnalysis('../../examples/linen.dev/packages/typesense', './src/setup.ts', 16, 13, 3))
}
function analyzeDub() {
  printResults(runAnalysis('../../examples/dub/apps/web', './scripts/sync-link-clicks.ts', 16, 20, 3))
}

// runTests();


function printResults(results: StructuralSet<{ table: string, method: string, argument: ConfigSet | undefined }>) {
  console.log('RESULTS:')
  for (const result of results.elements) {
    console.log(
`table: ${result.table}
method: ${result.method}
arg: ${result.argument?.elements.map(printConfig).join('\n')}
---------------------
`);
  }
}