import ts from 'typescript'
import { Comparator, SimpleSet } from 'typescript-super-set'
import { empty, setFilter, setFlatMap, setMap, setSome, singleton, union } from './setUtil'
import { structuralComparator } from './comparators'
import { unimplemented } from './util';
import { StructuralSet } from './structural-set';

export type AbstractValue = NodeLattice;

export type NodeLatticeElem = ts.Node | Top;
export type NodeLattice = StructuralSet<NodeLatticeElem>;

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

export function setJoinMap<T>(set: SimpleSet<T>, f: (item: T) => AbstractValue) {
    return set.elements.map(f).reduce(joinValue, botValue);
}

export function nodeLatticeFilter<R extends ts.Node>(nodeLattice: NodeLattice, predicate: (node: ts.Node) => node is R): StructuralSet<R | Top>
export function nodeLatticeFilter(nodeLattice: NodeLattice, predicate: (node: ts.Node) => boolean): NodeLattice
export function nodeLatticeFilter(nodeLattice: NodeLattice, predicate: (node: ts.Node) => boolean): NodeLattice {
    return setFilter(nodeLattice, elem => isTop(elem) || predicate(elem));
}
export function nodeLatticeMap<R>(nodeLattice: NodeLattice, convert: (node: ts.Node) => R): StructuralSet<R | Top> {
    return setMap(nodeLattice, elem => isTop(elem) ? elem : convert(elem));
}
export function nodeLatticeFlatMap<R>(nodeLattice: NodeLattice, convert: (node: ts.Node) => StructuralSet<R | Top>, rComparator: Comparator<R | Top> = structuralComparator): StructuralSet<R | Top> {
    return setFlatMap(nodeLattice, elem => isTop(elem) ? new SimpleSet<R | Top>(rComparator, elem) : convert(elem));
}
export function nodeLatticeJoinMap(lattice: NodeLattice, convert: (node: ts.Node) => AbstractValue): AbstractValue {
    if (lattice.elements.some(isTop)) {
        return topValue;
    }
    return setJoinMap(lattice as SimpleSet<ts.Node>, convert);
}
export function nodeLatticeSome(lattice: NodeLattice, predicate: (node: ts.Node) => boolean): boolean {
    return setSome(lattice, (elem) => !isTop(elem) && predicate(elem));
}

export function pretty(abstractValue: AbstractValue, printNode: (node: ts.Node) => string): any[] {
    return abstractValue.elements.map(elem => isTop(elem) ? 'ANY NODE' : printNode(elem))
}

export function unimplementedVal(message: string): AbstractValue {
    return unimplemented(message, botValue);
}
