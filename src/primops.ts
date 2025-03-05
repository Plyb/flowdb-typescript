import ts from 'typescript';
import { AbstractResult, objectResult, resultBind } from './abstract-results';
import { numberValue, primopValue } from './abstract-values';

export type PrimopId = keyof Primops;
type Primops = typeof primops
type Primop = (...args: AbstractResult[]) => AbstractResult

export const primops = {
    'Math.floor': mathFloorPrimop as Primop
}

export function mathFloorPrimop(n: AbstractResult) {
    return resultBind<number>(n, 'numbers', n => numberValue(Math.floor(n)));
}

export const primopMath = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy,
    {
        floor: primopValue('Math.floor')
    }
)