import ts from 'typescript'
import { Comparator, SimpleSet } from 'typescript-super-set'
import { empty, setFilter, setFlatMap, setMap, singleton, union } from './setUtil'
import { SimpleFunctionLikeDeclaration } from './ts-utils'
import { PrimopApplication } from './primops'
import { structuralComparator } from './comparators'

export type AbstractValue = {
    nodes: NodeLattice,
}

export type NodeLatticeElem = ts.Node | Top;
export type NodeLattice = SimpleSet<NodeLatticeElem>;

export type Top = { __topBrand: true }

export type ObjectRef = ts.ObjectLiteralExpression
export type AbstractObject = { [key: string]: AbstractValue }
export type ObjectStore = Map<ObjectRef, AbstractObject>

export type PromiseRef = SimpleFunctionLikeDeclaration | PrimopApplication;
export type AbstractPromise = {
    resolvesTo: AbstractValue
}
export type PromiseStore = Map<PromiseRef, AbstractPromise>

export type ArrayRef = ts.ArrayLiteralExpression | PrimopApplication;
export type AbstractArray = { element: AbstractValue }
export type ArrayStore = Map<ArrayRef, AbstractArray>

export type MapRef = ts.NewExpression;

export const top: Top = { __topBrand: true }

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

export function isTop(lattice: any): lattice is Top {
    return lattice === top;
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
