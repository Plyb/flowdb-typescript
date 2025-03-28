import ts from 'typescript'
import { Comparator, SimpleSet } from 'typescript-super-set'
import { empty, setFilter, setFlatMap, setMap, singleton, union } from './setUtil'
import { structuralComparator } from './comparators'

export type AbstractValue = NodeLattice;

export type NodeLatticeElem = ts.Node | Top;
export type NodeLattice = SimpleSet<NodeLatticeElem>;

export type Top = { __topBrand: true }

export const top: Top = { __topBrand: true }

export const botValue: AbstractValue = empty();
export const topValue: AbstractValue = singleton<NodeLatticeElem>(top);

export function nodeValue(node: ts.Node): AbstractValue {
    return singleton<NodeLatticeElem>(node);
}

export function joinValue(a: AbstractValue, b: AbstractValue): AbstractValue {
    return union(a, b);
}
export function joinAllValues(...values: AbstractValue[]): AbstractValue {
    return values.reduce(joinValue, botValue);
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
