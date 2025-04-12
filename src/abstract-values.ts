import ts from 'typescript'
import { empty, setMap } from './setUtil'
import { unimplemented } from './util';
import { StructuralSet } from './structural-set';
import { Config, ConfigSet, Cursor, justExtern, isConfigNoExtern, printConfig, stackBottom, join } from './configuration';

export type Extern = { __externBrand: true }
export const extern: Extern = { __externBrand: true }
export function isExtern(lattice: any): lattice is Extern {
    return lattice === extern;
}

export function nodeLatticeMap<R>(set: ConfigSet, convert: (node: ts.Node) => R): StructuralSet<R | Extern> {
    return setMap(set, elem => isExtern(elem.node) ? elem.node : convert(elem.node));
}

export function pretty(set: ConfigSet): string[] {
    return set.elements.map(printConfig)
}

export function unimplementedVal(message: string): ConfigSet {
    return unimplemented(message, empty());
}
