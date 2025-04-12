import ts from 'typescript'
import { empty, setMap, setSome, singleton, union } from './setUtil'
import { toList, unimplemented } from './util';
import { StructuralSet } from './structural-set';
import { Config, ConfigSet, Cursor, isConfigNoExtern, printConfig, stackBottom } from './configuration';

export type Extern = { __externBrand: true }

export const extern: Extern = { __externBrand: true }

export const externValue: ConfigSet = singleton<Config>({ node: extern, env: toList([stackBottom]) });

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

export function nodeLatticeMap<R>(set: ConfigSet, convert: (node: ts.Node) => R): StructuralSet<R | Extern> {
    return setMap(set, elem => isExtern(elem.node) ? elem.node : convert(elem.node));
}
export function configSetJoinMap<T extends Cursor>(set: StructuralSet<Config<T | Extern>>, convert: (config: Config<T>) => ConfigSet): ConfigSet {
    return setJoinMap(set, config => isConfigNoExtern(config) ? convert(config as Config<T>) : externValue);
}

export function pretty(set: ConfigSet): string[] {
    return set.elements.map(printConfig)
}

export function unimplementedVal(message: string): ConfigSet {
    return unimplemented(message, empty());
}
