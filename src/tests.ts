/**
 * Things to do:
 * - Eval for every supported node type
 *  - all function types
 *  - call for both functions and primops
 *  - ids - bound, built in, and shadowed
 *  - object properties - basic, built in, and proto
 * - Trace for every supported node type
 *  - call with standard param and destructured param
 * - Prisma queries
 */

import path from 'path';
import { getNodeAtPosition, getService, printNodeAndPos } from './ts-utils';
import { analyze } from './analysis';
import ts from 'typescript';
import { setFlatMap, setMinus } from './setUtil';
import { SimpleSet } from 'typescript-super-set';
import { NodeLatticeElem } from './abstract-values';
import { structuralComparator } from './comparators';

export function runTests() {
    const pathString = '../../examples/unit-tests'
    const fileString = './test.ts'
    const rootFolder = path.resolve(__dirname, pathString);
    const file = path.resolve(rootFolder, fileString);
    const service = getService(rootFolder);

    const oldConsoleInfo = console.info;
    console.info = () => undefined;

    const results = setFlatMap(analyze(service, file, 8, 0), res => res.argument);

    const testFile = service.getProgram()!.getSourceFile(file)!;
    const expectedResults = new SimpleSet<NodeLatticeElem>(structuralComparator,
        getNodeAtPosition(testFile, ts.getPositionOfLineAndCharacter(testFile, 14, 15))!, // 42
    );

    const missingResults = setMinus(expectedResults, results);
    const extraResults = setMinus(results, expectedResults);

    for (const res of missingResults) {
        console.warn(`Missing ${printNodeAndPos(res)}`)
    }
    for (const res of extraResults) {
        console.warn(`Got extra result ${printNodeAndPos(res)}`)
    }
    console.log('finished')

    console.info = oldConsoleInfo;
}