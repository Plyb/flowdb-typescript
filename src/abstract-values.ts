import ts from 'typescript'
import { SimpleSet } from 'typescript-super-set'
import { empty, singleton, union } from './setUtil'
import { isEqual } from 'lodash'
import { AtomicLiteral, isFalseLiteral, isFunctionLikeDeclaration, isTrueLiteral, SimpleFunctionLikeDeclaration } from './ts-utils'
import { PrimopId } from './primops'

export type AbstractValue = {
    nodes: SimpleSet<ts.Node>,
    strings: StringLattice,
    numbers: NumberLattice,
    booleans: BooleanLattice,
    objects: ObjectLattice,
    promises: PromiseLattice,
    arrays: ArrayLattice,
    primops: SimpleSet<PrimopId>
}

export type LatticeKey =
    'strings'
    | 'numbers'
    | 'booleans'
    | 'objects'
    | 'promises'
    | 'arrays';

export type FlatLattice<T> = 
| Bottom
| Single<T>
| Top

type Bottom = { __bottomBrand: true }
type Single<T> = { item: T, __singleBrand: true }
type Top = { __topBrand: true }

type StringLattice = FlatLattice<string>
type NumberLattice = FlatLattice<number>
type BooleanLattice = FlatLattice<boolean>

type ObjectRef = ts.ObjectLiteralExpression
export type AbstractObject = { [key: string]: AbstractValue }
export type ObjectLattice = FlatLattice<ObjectRef>
export type ObjectStore = Map<ObjectRef, AbstractObject>

type PrimopPromiseRef = ts.CallExpression;
export type PromiseRef = SimpleFunctionLikeDeclaration | PrimopPromiseRef;
export type AbstractPromise = {
    resolvesTo: AbstractValue
}
export type PromiseLattice = FlatLattice<PromiseRef>
export type PromiseStore = Map<PromiseRef, AbstractPromise>

type PrimopArrayRef = ts.CallExpression;
export type ArrayRef = ts.ArrayLiteralExpression | PrimopArrayRef;
export type AbstractArray = { item: AbstractValue }
export type ArrayLattice = FlatLattice<ArrayRef>
export type ArrayStore = Map<ArrayRef, AbstractArray>

export const bot: Bottom = { __bottomBrand: true }
export const top: Top = { __topBrand: true }
function single<T>(item: T): Single<T> {
    return {
        item,
        __singleBrand: true
    };
}

export const botValue: AbstractValue = {
    nodes: empty(),
    strings: bot,
    numbers: bot,
    booleans: bot,
    objects: bot,
    promises: bot,
    arrays: bot,
    primops: empty(),
}
export const topValue: AbstractValue = {
    nodes: empty(),
    strings: top,
    numbers: top,
    booleans: top,
    objects: top,
    promises: top,
    arrays: top,
    primops: empty()
}

export function nodeValue(node: ts.Node): AbstractValue {
    return {
        ...botValue,
        nodes: singleton<ts.Node>(node),
    }
}
export function nodesValue(nodes: SimpleSet<ts.Node>): AbstractValue {
    return {
        ...botValue,
        nodes,
    }
}
export function stringValue(str: string): AbstractValue {
    return {
        ...botValue,
        strings: single(str),
    }
}
export function numberValue(num: number): AbstractValue {
    return {
        ...botValue,
        numbers: single(num),
    }
}
export function booleanValue(b: boolean): AbstractValue {
    return {
        ...botValue,
        booleans: single(b),
    }
}
export function literalValue(node: AtomicLiteral): AbstractValue {
    if (ts.isStringLiteral(node)) {
        return stringValue(node.text)
    } else if (ts.isNumericLiteral(node)) {
        return numberValue(parseFloat(node.text));
    } else if (isTrueLiteral(node)) {
        return booleanValue(true)
    } else if (isFalseLiteral(node)) {
        return booleanValue(false)
    }
    throw new Error(`unsupported literal type: ${ts.SyntaxKind[node.kind]}`)
}
export function objectValue(ref: ObjectRef): AbstractValue {
    return {
        ...botValue,
        objects: single(ref),
    }
}
export function promiseValue(ref: PromiseRef): AbstractValue {
    return {
        ...botValue,
        promises: single(ref)
    }
}
export function arrayValue(ref: ArrayRef): AbstractValue {
    return {
        ...botValue,
        arrays: single(ref)
    }
}
export function primopValue(primopId: PrimopId): AbstractValue {
    return {
        ...botValue,
        primops: singleton(primopId),
    }
}

export const anyStringValue: AbstractValue = {
    ...botValue,
    strings: top,
};

export function resolvePromiseValue(promiseValue: AbstractValue, promiseStore: PromiseStore): AbstractValue {
    const promiseLattice = promiseValue.promises;
    let resolvedPromise: AbstractValue;
    if (isTop(promiseLattice)) {
        resolvedPromise = topValue;
    } else if (isBottom(promiseLattice)) {
        resolvedPromise = botValue;
    } else {
        const maybeResolvedPromise = promiseStore.get(promiseLattice.item);
        if (maybeResolvedPromise === undefined) {
            throw new Error('expected promise to be in store');
        }

        resolvedPromise = maybeResolvedPromise.resolvesTo;
    }

    const withoutPromises: AbstractValue = {
        ...promiseValue,
        promises: bot,
    }
    return joinValue(withoutPromises, resolvedPromise);
}

function joinFlatLattice<T>(a: FlatLattice<T>, b: FlatLattice<T>): FlatLattice<T> {
    if (a === top || b === top) {
        return top;
    } if (a === bot) {
        return b;
    } else if (b === bot) {
        return a;
    } else if (isEqual(a, b)) {
        return a;
    } else {
        return top;
    }
}

export function joinValue(a: AbstractValue, b: AbstractValue): AbstractValue {
    return {
        nodes: union(a.nodes, b.nodes),
        strings: joinFlatLattice(a.strings, b.strings),
        numbers: joinFlatLattice(a.numbers, b.numbers),
        booleans: joinFlatLattice(a.booleans, b.booleans),
        objects: joinFlatLattice(a.objects, b.objects),
        promises: joinFlatLattice(a.promises, b.promises),
        arrays: joinFlatLattice(a.arrays, b.arrays),
        primops: union(a.primops, b.primops),
    };
}

export function isBottom<T>(lattice: FlatLattice<T>): lattice is Bottom {
    return lattice === bot;
}
export function isTop<T>(lattice: FlatLattice<T>): lattice is Top {
    return lattice === top;
}

export function prettyFlatLattice<T>(lattice: FlatLattice<T>, label: string): any[] {
    if (isTop(lattice)) {
        return [`ANY ${label}`];
    } else if (isBottom(lattice)) {
        return [];
    } else if (ts.isObjectLiteralExpression(lattice.item as any as ts.Node)) {
        return [`obj: ${(lattice.item as any as ObjectRef).pos}`]
    } else if (isFunctionLikeDeclaration(lattice.item as any as ts.Node)) {
        return [`promise: ${(lattice.item as any as PromiseRef).pos}`]
    } else if (ts.isArrayLiteralExpression(lattice.item as any as ts.Node)) {
        return [`arr: ${(lattice.item as any as ArrayRef).pos}`]
    } else {
        return [lattice.item];
    }
}
