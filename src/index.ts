import path from 'path';
import { analyze } from './analysis';
import { getService } from './ts-utils';
import { runTests } from './tests';
import { StructuralSet } from './structural-set';
import { Config, ConfigSet, printConfig } from './configuration';
import { preprocess } from './preprocess';
import { getRootFolder } from './util';
import { prepareFormbricks, prepareNextCrm } from './prepareExamples';
import Immutable, { Record, Set } from 'immutable';

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
analyzeRevert()
// analyzeAbby()
// analyzeTriggerDev()
// analyzeDyrectorio()
// analyzeLinenDev()
// analyzeDub()
// analyzeUmami()
// analyzeGhostfolio()
// analyzeTypebotIo()
// analyzeRallly()
// analyzeTeable()
// analyzeCalCom()

// prepareNextCrm()
// prepareFormbricks();

// analyzePlayground()

function analyzePlayground() {
  printResults(runAnalysis('../../examples/playground', './test.ts', 7, 0, 3))
}

function analyzeInboxZero() {
  // includes a warning about gmail.users because the imprecision of the analysis means gmail may be undefined
  printResults(runAnalysis('../../examples/inbox-zero/apps/web', './app/api/user/categorize/senders/batch/handle-batch.ts', 35, 6, 5))
}
function analyzeNextCrm() {
  printResults(runAnalysis('../../examples/nextcrm-app/dist', './app/[locale]/(routes)/projects/boards/[boardId]/page.js', 16, 18, 3))
}
function analyzePapermark() {
  // includes warning about folder because of a recursive call
  printResults(runAnalysis('../../examples/papermark', './pages/api/teams/[teamId]/datarooms/[id]/generate-index.ts', 11, 21, 3))
}
function analyzeHoppscotch() {
  printResults(runAnalysis('../../examples/hoppscotch/packages/hoppscotch-backend', './src/infra-config/helper.ts', 279, 13, 3))
}
function analyzeFormbricks() {
  // 'resource' won't have a binding initially since it is a recursive parameter
  printResults(runAnalysis('../../examples/formbricks/apps/web', './modules/ee/contacts/api/v1/client/[environmentId]/identify/contacts/[userId]/lib/segments.ts', 29, 35, 3));
}
function analyzeDocumenso() {
  printResults(runAnalysis('../../examples/documenso/packages/lib', './server-only/recipient/set-document-recipients.ts', 42, 42, 3))
}
function analyzeDittofeed() {
  // there will be hundreds of messages around `value.join` are because of imprecision
  // this breakpoint condition can be used to skip them: !message.includes('Unable to get type') && !message.includes('No constructors found for property access') && !message.includes('Could not find proto') && !message.includes('Unable to get  &&property value.join') && !messazge.includes('Unable to find object property join')
  printResults(runAnalysis('../../examples/dittofeed/packages/api', './src/controllers/contentController.ts', 71, 10, 3))
}
function analyzeRevert() {
  printResults(runAnalysis('../../examples/revert/packages/backend', './services/metadata.ts', 10, 17, 3))
}
function analyzeAbby() {
  printResults(runAnalysis('../../examples/abby/apps/web', './src/server/services/ConfigService.ts', 68, 13, 3))
}
function analyzeTriggerDev() {
  // moved getSecrets and decrypt to avoid having to deal with the "this" keyword
  // also moved some other things around to avoid needing classes
  printResults(runAnalysis('../../examples/trigger.dev/apps/webapp', './app/v3/services/createBackgroundWorker.server.ts', 484, 13, 3))
}
// function analyzeScholarsome() {
//   // moved some things around to avoid having to deal with the "this" keyword
//   // doesn't actually have any CP patterns
//   printResults(runAnalysis('../../examples/scholarsome/apps/api', './src/app/sets/sets.controller.ts', 317, 17, 3))
// }
function analyzeDyrectorio() {
  printResults(runAnalysis('../../examples/dyrectorio/web/crux', './src/app/notification/notification.service.ts', 54, 26, 3))
}
function analyzeLinenDev() {
  printResults(runAnalysis('../../examples/linen.dev/apps/web', './services/slack/syncWrapper.ts', 10, 13, 3))
}
function analyzeDub() {
  printResults(runAnalysis('../../examples/dub/apps/web', './scripts/sync-link-clicks.ts', 16, 20, 3))
}
function analyzeUmami() {
  // note that this *will* have a warning for not finding a binding for acc
  printResults(runAnalysis('../../examples/umami', './src/queries/sql/sessions/saveSessionData.ts', 20, 13, 3))
}
function analyzeGhostfolio() {
  // AND is not found because mutation isn't implemented yet.
  // filters and tags are not found because they are intentionally nullable in the code
  // activitiesDto and activity are filled in later
  printResults(runAnalysis('../../examples/ghostfolio/apps/api', './src/app/import/import.service.ts', 137, 21, 3))
}
function analyzeTypebotIo() {
  // manually removed nested destructuring
  printResults(runAnalysis('../../examples/typebot.io/apps/builder', './src/features/telemetry/api/trackClientEvents.ts', 21, 18, 3))
}
function analyzeRallly() {
  printResults(runAnalysis('../../examples/rallly/apps/web', './src/trpc/routers/polls/participants.ts', 139, 20, 3))
}
function analyzeTeable() {
  printResults(runAnalysis('../../examples/teable/apps/nestjs-backend', './src/features/field/field.service.ts', 147, 30, 3))
}
function analyzeCalCom() {
  // manually replaces a usage of `this` in a static function with the Class it refered to
  printResults(runAnalysis('../../examples/cal.com/packages/trpc', './server/routers/viewer/slots/isAvailable.handler.ts', 24, 40, 3))
}
// function analyzeLetterpad() {
//   // The only CP case I could find here uses an element access on an object. Going to skip implementing that for now.
//   printResults(runAnalysis('../../examples/letterpad/apps/admin', './src/app/(protected)/api/cron/1h/mail-likes/route.ts', 12, 13, 3))
// }

// runTests();


function printResults(results: Set<{ table: string, method: string, argument: ConfigSet | undefined }>) {
  console.log('RESULTS:')
  for (const result of results) {
    console.log(
`table: ${result.table}
method: ${result.method}
arg: ${result.argument?.map(printConfig).join('\n')}
---------------------
`);
  }
}