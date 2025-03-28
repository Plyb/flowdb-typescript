import ts from 'typescript';
import { FixedEval, FixedTrace } from './primops';
import { AbstractValue, botValue, NodeLattice, NodeLatticeElem, nodeLatticeFlatMap } from './abstract-values';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { empty, singleton } from './setUtil';
import { getBuiltInValueOfBuiltInConstructor, isBuiltInConstructorShaped, NodePrinter, resultOfElementAccess } from './value-constructors';

export function id<T>(x: T): T {
    return x;
}

export function mergeMaps<K, V>(a: Map<K, V>, b: Map<K, V>): Map<K, V> {
    const aClone = new Map(a);
    for (const [key, value] of b.entries()) {
        aClone.set(key, value);
    }
    return aClone;
}

function isRelativeSpecifier(moduleSpecifier: string) {
    return moduleSpecifier.startsWith('/')
        || moduleSpecifier.startsWith('./')
        || moduleSpecifier.startsWith('../')
}

function isUrl(str: string) {
    try {
        new URL(str);
        return true;
    } catch {
        return false;
    }
}

function isAbsoluteSpecifier(moduleSpecifier: string) {
    return isUrl(moduleSpecifier);
}

export function isBareSpecifier(moduleSpecifier: string) {
    return !(isRelativeSpecifier(moduleSpecifier) || isAbsoluteSpecifier(moduleSpecifier));
}

export function unimplemented<T>(message: string, returnVal: T): T {
    console.warn(message);
    return returnVal;
}

export function unimplementedVal(message: string): AbstractValue {
    return unimplemented(message, botValue);
}