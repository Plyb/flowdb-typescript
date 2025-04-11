import ts from 'typescript'
import { Comparator, SimpleSet } from 'typescript-super-set'
import { empty, setFilter, setFlatMap, setMap, setSome, singleton, union } from './setUtil'
import { structuralComparator } from './comparators'
import { unimplemented } from './util';
import { StructuralSet } from './structural-set';
import { Config, ConfigNoExtern, ConfigSet, ConfigSetNoExtern, Cursor, isConfigNoExtern, printConfig, withZeroContext } from './configuration';

export type AbstractValue = NodeLattice;

export type NodeLatticeElem = ts.Node | Extern;
export type NodeLattice = StructuralSet<NodeLatticeElem>;

export type Extern = { __externBrand: true }

export const extern: Extern = { __externBrand: true }

export const externValue: ConfigSet = singleton<Config>(withZeroContext(extern));

export function configValue(config: Config): ConfigSet {
    return singleton(config);
}

export function joinValue(a: ConfigSet, b: ConfigSet): ConfigSet {
    return union(a, b);
}
export function joinAllValues(...values: ConfigSet[]): ConfigSet {
    return values.reduce(joinValue, empty());
}

export function isExtern(lattice: any): lattice is Extern {
    return lattice === extern;
}

export function setJoinMap<T>(set: StructuralSet<T>, f: (item: T) => ConfigSet) {
    return set.elements.map(f).reduce(joinValue, empty());
}

export function nodeLatticeFilter<R extends ConfigNoExtern>(set: ConfigSet, predicate: (config: ConfigNoExtern) => config is R): StructuralSet<R | Extern>
export function nodeLatticeFilter(set: ConfigSet, predicate: (config: ConfigNoExtern) => boolean): ConfigSet
export function nodeLatticeFilter(set: ConfigSet, predicate: (config: ConfigNoExtern) => boolean): ConfigSet {
    return setFilter(set, elem => isExtern(elem.node) || predicate(elem as ConfigNoExtern)); // TODO mcfa deal with as
}
export function nodeLatticeMap<R>(set: ConfigSet, convert: (node: ts.Node) => R): StructuralSet<R | Extern> {
    return setMap(set, elem => isExtern(elem.node) ? elem.node : convert(elem.node));
}
export function nodeLatticeFlatMap<R>(nodeLattice: NodeLattice, convert: (node: ts.Node) => StructuralSet<R | Extern>, rComparator: Comparator<R | Extern> = structuralComparator): StructuralSet<R | Extern> {
    return setFlatMap(nodeLattice, elem => isExtern(elem) ? new SimpleSet<R | Extern>(rComparator, elem) : convert(elem));
}
export function configSetJoinMap<T extends Cursor>(set: StructuralSet<Config<T | Extern>>, convert: (config: Config<T>) => ConfigSet): ConfigSet { // TODO mcfa: could we merge this with flatMap?
    return setJoinMap(set, config => isConfigNoExtern(config) ? convert(config as Config<T>) : externValue);
}
export function nodeLatticeSome(lattice: NodeLattice, predicate: (node: ts.Node) => boolean): boolean {
    return setSome(lattice, (elem) => !isExtern(elem) && predicate(elem));
}

export function pretty(set: ConfigSet): string[] {
    return set.elements.map(printConfig)
}

export function unimplementedVal(message: string): ConfigSet {
    return unimplemented(message, empty());
}
