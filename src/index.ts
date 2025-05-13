import path from 'path';
import { analyze } from './analysis';
import { getService } from './ts-utils';
import { runTests } from './tests';
import { StructuralSet } from './structural-set';
import { Config, ConfigSet, printConfig } from './configuration';
import { preprocess } from './preprocess';
import { getRootFolder } from './util';
import { prepareFormbricks, prepareNextCrm } from './prepareExamples';
import Immutable, { Record } from 'immutable';
import { Worker } from 'worker_threads';

function runAnalysis(pathString: string, fileString: string, line: number, column: number, m: number) {
  function justCompute(item: string) {
    if (!item.startsWith('compute')) {
      return;
    }
    console.log(item);
  }

  console.info = () => undefined
  // console.info = justCompute

  return Promise.race([
    new Promise<[Immutable.Set<{
          table: string;
          method: string;
          argument: ConfigSet | undefined;
        }>, Set<any>, number]>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15 * 60 * 1000)), // 15 minute timeout
    analyzeAsync(),
  ])

  async function analyzeAsync() {
    return new Promise((res: (val: [Immutable.Set<{
        table: string;
        method: string;
        argument: ConfigSet | undefined;
      }>, Set<any>, number]) => void, rej
    ) => {
      const worker = new Worker('./build/analyzeWorker.js', { workerData: {
        pathString, fileString, line, column, m
      }});

      worker.on('message', res)
      worker.on('error', rej);

      // const pre = Date.now();
    
      // try {
      //   const results = analyze(service, file, line, column, m);
      //   const post = Date.now();
      
      //   const time = post - pre;
      
      //   res([results, time] as [Immutable.Set<{
      //     table: string;
      //     method: string;
      //     argument: ConfigSet | undefined;
      //   }>, number]);
      // } catch (error) {
      //   rej(error);
      // }
    })
  }
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
  // warning about finding the llm models is because it looks first inside an object spread. It's spurious
  printResults(runAnalysis('../../examples/inbox-zero/apps/web', './app/api/user/categorize/senders/batch/handle-batch.ts', 35, 6, 0))
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
  // 'resource'/'userData' won't have a binding initially since it is a recursive parameter
  printResults(runAnalysis('../../examples/formbricks/apps/web', './modules/ee/contacts/api/v1/client/[environmentId]/identify/contacts/[userId]/lib/segments.ts', 29, 35, 3));
}
function analyzeDocumenso() {
  // warnings from render.tsx are irrelevant
  printResults(runAnalysis('../../examples/documenso/packages/lib', './server-only/recipient/set-document-recipients.ts', 42, 42, 3))
}
function analyzeDittofeed() {
  // there will be hundreds of messages around `value.join` are because of imprecision
  // this breakpoint condition can be used to skip them: !message.includes('Unable to get type') && !message.includes('No constructors found for property access') && !message.includes('Could not find proto') && !message.includes('Unable to get  &&property value.join') && !messazge.includes('Unable to find object property join')
  // unable to access element of null is due to imprecision
  // marks, content, c, attrs and variableName are all intentionally nullable
  // note about getting an element of keys is irrelevant
  printResults(runAnalysis('../../examples/dittofeed/packages/api', './src/controllers/contentController.ts', 71, 10, 3))
}
function analyzeRevert() {
  printResults(runAnalysis('../../examples/revert/packages/backend', './services/metadata.ts', 10, 17, 3))
}
function analyzeAbby() {
  printResults(runAnalysis('../../examples/abby/apps/web', './src/server/services/ConfigService.ts', 68, 13, 3))
}
// function analyzeTriggerDev() {
//   // moved getSecrets and decrypt to avoid having to deal with the "this" keyword
//   // also moved some other things around to avoid needing classes
//   printResults(runAnalysis('../../examples/trigger.dev/apps/webapp', './app/v3/services/createBackgroundWorker.server.ts', 484, 13, 3))
// }
// function analyzeScholarsome() {
//   // moved some things around to avoid having to deal with the "this" keyword
//   // doesn't actually have any CP patterns
//   printResults(runAnalysis('../../examples/scholarsome/apps/api', './src/app/sets/sets.controller.ts', 317, 17, 3))
// }
function analyzeDyrectorio() {
  printResults(runAnalysis('../../examples/dyrectorio/web/crux', './src/app/notification/notification.service.ts', 54, 26, 3))
}
function analyzeLinenDev() {
  // `members` is intentionally nullable
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
  // there are a few of things (a Jsx eval, an element access of an object, and a trace through a jsx element) that are irrelevant to the analysis
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


async function printResults(resultsPromise: Promise<[Immutable.Set<{ table: string, method: string, argument: ConfigSet | undefined }>, any, any]>) {
  const [results] = await resultsPromise;
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

type Target = {
  name: string;
  projectPath: string;
  filePath: string;
  line: number;
  col: number;
}

const targets: Target[] = [
  {
    name: 'inbox zero',
    projectPath: '../../examples/inbox-zero/apps/web',
    filePath: './app/api/user/categorize/senders/batch/handle-batch.ts',
    line: 35,
    col: 6,
  },
  {
    name: 'next crm',
    projectPath: '../../examples/nextcrm-app/dist',
    filePath: './app/[locale]/(routes)/projects/boards/[boardId]/page.js',
    line: 16,
    col: 18,
  },
  {
    name: 'papermark',
    projectPath: '../../examples/papermark',
    filePath: './pages/api/teams/[teamId]/datarooms/[id]/generate-index.ts',
    line: 11,
    col: 21,
  },
  {
    name: 'hoppscotch',
    projectPath: '../../examples/hoppscotch/packages/hoppscotch-backend',
    filePath: './src/infra-config/helper.ts',
    line: 279,
    col: 13,
  },
  {
    name: 'formbricks',
    projectPath: '../../examples/formbricks/apps/web',
    filePath: './modules/ee/contacts/api/v1/client/[environmentId]/identify/contacts/[userId]/lib/segments.ts',
    line: 29,
    col: 35,
  },
  {
    name: 'documenso',
    projectPath: '../../examples/documenso/packages/lib',
    filePath: './server-only/recipient/set-document-recipients.ts',
    line: 42,
    col: 42,
  },
  {
    name: 'dittofeed',
    projectPath: '../../examples/dittofeed/packages/api',
    filePath: './src/controllers/contentController.ts',
    line: 71,
    col: 10,
  },
  {
    name: 'revert',
    projectPath: '../../examples/revert/packages/backend',
    filePath: './services/metadata.ts',
    line: 10,
    col: 17,
  },
  {
    name: 'abby',
    projectPath: '../../examples/abby/apps/web',
    filePath: './src/server/services/ConfigService.ts',
    line: 68,
    col: 13,
  },
  {
    name: 'dyrectorio',
    projectPath: '../../examples/dyrectorio/web/crux',
    filePath: './src/app/notification/notification.service.ts',
    line: 54,
    col: 26,
  },
  {
    name: 'linen.dev',
    projectPath: '../../examples/linen.dev/apps/web',
    filePath: './services/slack/syncWrapper.ts',
    line: 10,
    col: 13,
  },
  {
    name: 'dub',
    projectPath: '../../examples/dub/apps/web',
    filePath: './scripts/sync-link-clicks.ts',
    line: 16,
    col: 20,
  },
  {
    name: 'umami',
    projectPath: '../../examples/umami',
    filePath: './src/queries/sql/sessions/saveSessionData.ts',
    line: 20,
    col: 13,
  },
  {
    name: 'ghostfolio',
    projectPath: '../../examples/ghostfolio/apps/api',
    filePath: './src/app/import/import.service.ts',
    line: 137,
    col: 21,
  },
  {
    name: 'typebot.io',
    projectPath: '../../examples/typebot.io/apps/builder',
    filePath: './src/features/telemetry/api/trackClientEvents.ts',
    line: 21,
    col: 18,
  },
  {
    name: 'rallly',
    projectPath: '../../examples/rallly/apps/web',
    filePath: './src/trpc/routers/polls/participants.ts',
    line: 139,
    col: 20,
  },
  {
    name: 'teable',
    projectPath: '../../examples/teable/apps/nestjs-backend',
    filePath: './src/features/field/field.service.ts',
    line: 147,
    col: 30,
  },
  {
    name: 'cal.com',
    projectPath: '../../examples/cal.com/packages/trpc',
    filePath: './server/routers/viewer/slots/isAvailable.handler.ts',
    line: 24,
    col: 40,
  },
]

async function summarizeTargets() {
  const originalWarn = console.warn;
  const precisions = [0, 1, 2, 3, 4, 5];
  for (const target of targets) {

    for (const m of precisions) {
      try {
        const [results, warnings, time] = await runAnalysis(target.projectPath, target.filePath, target.line, target.col, m);
        const numResults = results.size;
        console.log(`${target.name} ${m}: ${time}ms with ${numResults} results`);

        if (warnings.size) {
          originalWarn(warnings)
        }
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : '' + error

        originalWarn(`${target.name} ${m}: error ${message.substring(0, 50)}`)
      }
    }
  }
}

summarizeTargets()
