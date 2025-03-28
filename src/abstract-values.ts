import ts from 'typescript'
import { Comparator, SimpleSet } from 'typescript-super-set'
import { empty, setFilter, setFlatMap, setMap, singleton, union } from './setUtil'
import { isEqual } from 'lodash'
import { AtomicLiteral, isFalseLiteral, isFunctionLikeDeclaration, isTrueLiteral, SimpleFunctionLikeDeclaration } from './ts-utils'
import { PrimopApplication } from './primops'
import { structuralComparator } from './comparators'

export type AbstractValue = {
    nodes: NodeLattice,
}

export type FlatLatticeKey =
    'strings'
    | 'numbers'
    | 'booleans'
    | 'dates'
    | 'regexps'
    | 'objects'
    | 'promises'
    | 'arrays'
    | 'maps';

export type NodeLatticeElem = ts.Node | Top;
export type NodeLattice = SimpleSet<NodeLatticeElem>;

export type FlatLattice<T> = 
| Bottom
| Single<T>
| Top

type Bottom = { __bottomBrand: true }
type Single<T> = { item: T, __singleBrand: true }
export type Top = { __topBrand: true }

export type ObjectRef = ts.ObjectLiteralExpression
export type AbstractObject = { [key: string]: AbstractValue }
export type ObjectLattice = FlatLattice<ObjectRef>
export type ObjectStore = Map<ObjectRef, AbstractObject>

export type PromiseRef = SimpleFunctionLikeDeclaration | PrimopApplication;
export type AbstractPromise = {
    resolvesTo: AbstractValue
}
export type PromiseLattice = FlatLattice<PromiseRef>
export type PromiseStore = Map<PromiseRef, AbstractPromise>

export type ArrayRef = ts.ArrayLiteralExpression | PrimopApplication;
export type AbstractArray = { element: AbstractValue }
export type ArrayLattice = FlatLattice<ArrayRef>
export type ArrayStore = Map<ArrayRef, AbstractArray>

export type MapRef = ts.NewExpression;
type MapLattice = FlatLattice<MapRef>

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
}
export const topValue: AbstractValue = {
    nodes: singleton<NodeLatticeElem>(top),
}

export function nodeValue(node: ts.Node): AbstractValue {
    return {
        ...botValue,
        nodes: singleton<NodeLatticeElem>(node),
    }
}
export function nodesValue(nodes: NodeLattice): AbstractValue {
    return {
        ...botValue,
        nodes,
    }
}

export function joinValue(a: AbstractValue, b: AbstractValue): AbstractValue {
    return {
        nodes: union(a.nodes, b.nodes),
    };
}
export function joinAllValues(...values: AbstractValue[]): AbstractValue {
    return values.reduce(joinValue, botValue);
}

export function subsumes(a: AbstractValue, b: AbstractValue) {
    return a.nodes.hasAll(...b.nodes)
}

export function isBottom<T>(lattice: FlatLattice<T>): lattice is Bottom {
    return lattice === bot;
}
export function isTop(lattice: any): lattice is Top {
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

export function nodeLatticeFilter(nodeLattice: NodeLattice, predicate: (node: ts.Node) => boolean): NodeLattice {
    return setFilter(nodeLattice, elem => isTop(elem) || predicate(elem));
}
export function nodeLatticeMap<R>(nodeLattice: NodeLattice, convert: (node: ts.Node) => R): SimpleSet<R | Top> {
    return setMap(nodeLattice, elem => isTop(elem) ? elem : convert(elem));
}
export function nodeLatticeFlatMap<R>(nodeLattice: NodeLattice, convert: (node: ts.Node) => SimpleSet<R | Top>, rComparator: Comparator<R | Top> = structuralComparator): SimpleSet<R | Top> {
    return setFlatMap(nodeLattice, elem => isTop(elem) ? new SimpleSet<R | Top>(rComparator, elem) : convert(elem));
}
