import ts from 'typescript';
import { AbstractResult, objectResult, resultBind } from './abstract-results';
import { AbstractValue, LatticeKey, numberValue, primopValue } from './abstract-values';

export type PrimopId = keyof Primops;
type Primops = typeof primops
type Primop = (...args: AbstractResult[]) => AbstractResult

export const mathFloorPrimop = createUnaryPrimop('numbers', numberValue, Math.floor);
export const primops = {
    'Math.floor': mathFloorPrimop as Primop
}

function createUnaryPrimop<A, R>(key: LatticeKey, construct: (val: R) => AbstractValue, f: (item: A) => R): Primop {
    return (res: AbstractResult) => resultBind<A>(res, key, item => construct(f(item)));
}


export const primopMath = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy,
    {
        floor: primopValue('Math.floor')
    }
)