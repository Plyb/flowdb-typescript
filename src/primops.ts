import ts from 'typescript';
import { AbstractResult, arrayResult, objectResult, resultBind, resultBind2, resultFrom, setJoinMap } from './abstract-results';
import { AbstractValue, booleanValue, LatticeKey, numberValue, primopValue, stringValue } from './abstract-values';
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
const stringTrimPrimop =
    createNullaryPrimopWithThis('strings', resultFrom(stringValue), String.prototype.trim);
const stringToLowerCasePrimop =
    createNullaryPrimopWithThis('strings', resultFrom(stringValue), String.prototype.toLowerCase);
const stringSplit =
    createUnaryPrimopWithThis('strings',
        (arr, callExpression) =>
            arrayResult(
                callExpression,
                setJoinMap(new SimpleSet(structuralComparator, ...arr), resultFrom(stringValue))
            ),
        String.prototype.substring
    );
export const primops = {
    'Math.floor': mathFloorPrimop as Primop,
    'String#includes': stringIncludesPrimop as Primop,
    'String#substring': stringSubstringPrimop as Primop,
    'String#split': stringSplit as Primop,
    'String#trim': stringTrimPrimop as Primop,
    'String#toLowerCase': stringToLowerCasePrimop as Primop,
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
}
function createBinaryPrimop<A, R>(key: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item1: A, item2: A) => R): Primop {
    return (callExpression, res1, res2) =>
        resultBind2<A>(res1, res2, key, (item1, item2) =>
            construct(f(item1, item2), callExpression));
}
function createBinaryPrimopWithThisHetero<T, A, R>(thisKey: LatticeKey, argsKey: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item1: A, item2: A) => R): Primop {
    return function(this: AbstractResult, callExpression, res1, res2) {
        return resultBind2<A>(res1, res2, argsKey, (item1, item2) => 
            resultBind(this, thisKey, thisItem =>
                construct(f.apply(thisItem, [item1, item2]), callExpression)
            )
        );
    };
}

export const primopMath = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy,
    {
        floor: primopValue('Math.floor')
    }
)