import path from 'path';
import { getNodeAtPosition, getService, printNodeAndPos } from './ts-utils';
import { analyze } from './analysis';
import ts from 'typescript';
import { setFlatMap, setMinus } from './setUtil';
import { SimpleSet } from 'typescript-super-set';
import { NodeLatticeElem, top } from './abstract-values';
import { structuralComparator } from './comparators';

export function runTests() {
    const pathString = '../../examples/unit-tests'
    const fileString = './test.ts'
    const rootFolder = path.resolve(__dirname, pathString);
    const file = path.resolve(rootFolder, fileString);
    const service = getService(rootFolder);

    const oldConsoleInfo = console.info;
    console.info = () => undefined;

    const results = setFlatMap(analyze(service, file, 8, 6), res => res.argument);

    const testFile = service.getProgram()!.getSourceFile(file)!;
    const librFile = service.getProgram()!.getSourceFile(path.resolve(rootFolder, './lib.ts'))!;
    function testRes(line: number, char: number) {
        return getNodeAtPosition(testFile, ts.getPositionOfLineAndCharacter(testFile, line, char))!
    }
    function librRes(line: number, char: number) {
        return getNodeAtPosition(librFile, ts.getPositionOfLineAndCharacter(librFile, line, char))!
    }

    const expectedResults = new SimpleSet<NodeLatticeElem>(structuralComparator,
        // abstractEval tests
        testRes(14, 26), // num
        testRes(15, 26), // arrow func
        testRes(16, 26), // function expr
        testRes(17, 26), // function decl
        librRes( 5, 11), // call syntactic func
        testRes(19, 26), // call built in func
        testRes( 9, 38), // bound identifier
        testRes(21, 26), // built in identifier
        testRes( 9, 42), // shadowed identifier
        testRes(23, 27), // parenthesized expr
        testRes(24, 26), // true
        testRes(25, 26), // false
        testRes(26, 26), // string
        testRes(27, 26), // regex
        testRes(28, 26), // no sub template
        testRes(29, 26), // big int
        testRes(30, 26), // object
        testRes(31, 34), // basic property access
        testRes(32, 26), // built in property access
        testRes(33, 26), // proto property access
        librRes( 5, 11), // await non-async call
        librRes( 9, 11), // await async call
        testRes(36, 26), // array literal
        top            , // import from library
        testRes(38, 28), // element access basic
        testRes(39, 41), // element access built in constructor
        testRes(40, 26), // new expression
        testRes(41, 26), // null
        testRes(42, 27), // binary expression lhs
        testRes(42, 34), // binary expression rhs
        testRes(43, 26), // template expression
        testRes(44, 33), // conditional expr then branch
        testRes(44, 40), // conditional expr else branch
        testRes(53, 27), // as expression
        // getWhereValueReturned tests
        testRes(45, 35), // call expression
        testRes(46, 52), // body of function
        testRes(47, 37), // parenthesized expression
        librRes(16, 14), // variable declaration
        testRes(49, 29), // function declaration
                         // for of (test shouldn't come up with anything)
        testRes(51, 48), // property access
        testRes(52, 60), // shorthand property assignment (for calls)
        // getBoundExprs tests
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