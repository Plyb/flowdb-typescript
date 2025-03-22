import ts, { SyntaxKind } from 'typescript';
import { AbstractResult, botResult, nodeResult, resultBind } from './abstract-results';
import { FixedEval } from './primops';
import { ArrayRef, isTop, NodeLatticeElem, nodeLatticeFlatMap, top } from './abstract-values';
import { singleton } from './setUtil';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';

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

export function unimplementedRes(message: string): AbstractResult {
    return unimplemented(message, botResult);
}

export function getElementNodesOfArrayValuedNode(node: ts.Node, fixed_eval: FixedEval) {
    const res = fixed_eval(node);
    const arrayLiterals = resultBind<ArrayRef>(res, 'arrays', arrayRef =>
        ts.isArrayLiteralExpression(arrayRef)
            ? nodeResult(arrayRef)
            : unimplementedRes(`Expected array literal expression: ${SyntaxKind[arrayRef.kind]}`) // TODO: we need some way to deal with arrays that are constructed by primops, but I'm going to defer that until I've made a decision on whether to use nodes as the only kind of result
    ).value.nodes;

    return nodeLatticeFlatMap(arrayLiterals, arrLit => {
        if (isTop(arrLit)) {
            return singleton<NodeLatticeElem>(top);
        }

        const elements = (arrLit as ts.ArrayLiteralExpression).elements;
        return nodeLatticeFlatMap(new SimpleSet<NodeLatticeElem>(structuralComparator, ...elements), elem => {
            if (ts.isSpreadElement(elem)) {
                return getElementNodesOfArrayValuedNode(elem.expression, fixed_eval)
            }

            return singleton<NodeLatticeElem>(elem);
        });
    });
}