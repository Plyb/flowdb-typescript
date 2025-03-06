import ts from 'typescript';
import { AbstractResult, anyObjectResult, arrayResult, botResult, objectResult, primopResult, promiseResult, result, resultBind, resultBind2, resultFrom, setJoinMap, topResult } from './abstract-results';
import { AbstractValue, anyDateValue, booleanValue, botValue, LatticeKey, numberValue, primopValue, stringValue, top } from './abstract-values';
import { structuralComparator } from './comparators';
import { SimpleSet } from 'typescript-super-set';

export type PrimopId = keyof Primops;
type Primops = typeof primops
type Primop = (callExpression: ts.CallExpression, ...args: AbstractResult[]) => AbstractResult

const mathFloorPrimop = createUnaryPrimop('numbers', resultFrom(numberValue), Math.floor);
const stringIncludesPrimop =
    createUnaryPrimopWithThis('strings', resultFrom(booleanValue), String.prototype.includes);
const stringSubstringPrimop =
    createBinaryPrimopWithThisHetero('strings', 'numbers', resultFrom(stringValue),
        String.prototype.substring
    );
const stringSplitPrimop =
    createUnaryPrimopWithThis('strings',
        (arr, callExpression) =>
            arrayResult(
                callExpression,
                setJoinMap(new SimpleSet(structuralComparator, ...arr), resultFrom(stringValue))
            ),
        String.prototype.substring
    );
const stringTrimPrimop =
    createNullaryPrimopWithThis('strings', resultFrom(stringValue), String.prototype.trim);
const stringToLowerCasePrimop =
    createNullaryPrimopWithThis('strings', resultFrom(stringValue), String.prototype.toLowerCase);
const fetchPrimop: Primop =
    createUnaryPrimop<string, null>('strings',
        (_, callExpression) =>
            promiseResult(callExpression, anyObjectResult),
        () => null
    );
const jsonParsePrimop = createUnaryPrimop('strings', () => topResult, () => null);
const dateNowPrimop = (() => result(anyDateValue)) as Primop;
const stringMatchPrimop = createUnaryPrimopWithThisHetero('strings', 'regexps',
    (arr, callExpression) =>
        arrayResult(
            callExpression,
            setJoinMap(new SimpleSet(structuralComparator, ...arr!), resultFrom(stringValue))
        ),
    String.prototype.match
)
export const primops = {
    'Math.floor': mathFloorPrimop,
    'String#includes': stringIncludesPrimop,
    'String#substring': stringSubstringPrimop,
    'String#split': stringSplitPrimop,
    'String#trim': stringTrimPrimop,
    'String#toLowerCase': stringToLowerCasePrimop,
    'fetch': fetchPrimop,
    'JSON.parse': jsonParsePrimop,
    'Date.now': dateNowPrimop,
    'String#match': stringMatchPrimop,
}

function createNullaryPrimopWithThis<A, R>(key: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: () => R): Primop {
    return function(this: AbstractResult, callExpression) {
        return resultBind(this, key, thisItem =>
            construct(f.apply(thisItem, []), callExpression)
        );
    } 
}
function createUnaryPrimop<A, R>(key: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item: A) => R): Primop {
    return (callExpression, res) => 
        resultBind<A>(res, key, (item) => construct(f(item), callExpression));
}
function createUnaryPrimopWithThis<A, R>(key: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item: A) => R): Primop {
    return function(this: AbstractResult, callExpression, res) {
        return resultBind<A>(res, key, item => 
            resultBind(this, key, thisItem =>
                construct(f.apply(thisItem, [item]), callExpression)
            )
        );
    } 
}function createUnaryPrimopWithThisHetero<T, A, R>(thisKey: LatticeKey, argKey: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item: A) => R): Primop {
    return function(this: AbstractResult, callExpression, res) {
        return resultBind<A>(res, argKey, item => 
            resultBind<T>(this, thisKey, thisItem =>
                construct(f.apply(thisItem, [item]), callExpression)
            )
        );
    } 
}
function createBinaryPrimop<A, R>(key: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item1: A, item2: A) => R): Primop {
    return (callExpression, res1, res2) =>
        resultBind2<A>(res1, res2, key, (item1, item2) =>
            construct(f(item1, item2), callExpression));
}
function createBinaryPrimopWithThisHetero<T, A, R>(thisKey: LatticeKey, argsKey: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item1: A, item2: A) => R): Primop {
    return function(this: AbstractResult, callExpression, res1, res2) {
        return resultBind2<A>(res1, res2, argsKey, (item1, item2) => 
            resultBind<T>(this, thisKey, thisItem =>
                construct(f.apply(thisItem, [item1, item2]), callExpression)
            )
        );
    };
}

export const primopMath = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy
    {
        floor: primopValue('Math.floor'),
    }
)
export const primopFecth = primopResult('fetch');
export const primopJSON = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy
    {
        parse: primopValue('JSON.parse'),
    }
)
export const primopDate = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy
    {
        now: primopValue('Date.now')
    }
)