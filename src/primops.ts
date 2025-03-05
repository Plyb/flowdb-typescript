import ts from 'typescript';
import { AbstractResult, objectResult, resultBind, resultBind2 } from './abstract-results';
import { AbstractValue, booleanValue, LatticeKey, numberValue, primopValue, stringValue, valueBind } from './abstract-values';

export type PrimopId = keyof Primops;
type Primops = typeof primops
type Primop = (...args: AbstractResult[]) => AbstractResult

export const mathFloorPrimop = createUnaryPrimop('numbers', numberValue, Math.floor);
export const stringIncludesPrimop =
    createUnaryPrimopWithThis('strings', booleanValue, function (this: string, sub: string) {
        return this.includes(sub)
    });
export const primops = {
    'Math.floor': mathFloorPrimop as Primop,
    'String#includes': stringIncludesPrimop as Primop,
}

function createUnaryPrimop<A, R>(key: LatticeKey, construct: (val: R) => AbstractValue, f: (item: A) => R): Primop {
    return (res: AbstractResult) => resultBind<A>(res, key, item => construct(f(item)));
}
function createUnaryPrimopWithThis<A, R>(key: LatticeKey, construct: (val: R) => AbstractValue, f: (item: A) => R): Primop {
    return function(this: AbstractResult, res: AbstractResult) {
        return resultBind<A>(res, key, item => {
            return valueBind(this.value, key, thisItem =>
                construct(f.apply(thisItem, [item]))
            );
        });
    } 
}
function createBinaryPrimop<A, R>(key: LatticeKey, construct: (val: R) => AbstractValue, f: (item1: A, item2: A) => R): Primop {
    return (res1: AbstractResult, res2: AbstractResult) =>
        resultBind2<A>(res1, res2, key, (item1, item2) => construct(f(item1, item2)));
}

export const primopMath = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy,
    {
        floor: primopValue('Math.floor')
    }
)