import ts, { SyntaxKind } from 'typescript';
import { AbstractResult, botResult, nodeLatticeJoinMap, nodeResult, nodesResult, resultBind } from './abstract-results';
import { FixedEval } from './primops';
import { ArrayRef, NodeLattice, NodeLatticeElem } from './abstract-values';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { isFunctionLikeDeclaration } from './ts-utils';

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

export function getElementNodesOfArrayValuedNode(node: ts.Node, fixed_eval: FixedEval): NodeLattice {
    const res = fixed_eval(node);
    return resultBind<ArrayRef>(res, 'arrays', arrayRef => {
        if (ts.isBinaryExpression(arrayRef)) {
            return unimplementedRes(`Expected array literal or call expression: ${SyntaxKind[arrayRef.kind]}`)
        }

        if (ts.isArrayLiteralExpression(arrayRef)) {
            const elements = arrayRef.elements;
            return nodeLatticeJoinMap(new SimpleSet<NodeLatticeElem>(structuralComparator, ...elements), elem => {
                if (ts.isSpreadElement(elem)) {
                    return nodesResult(getElementNodesOfArrayValuedNode(elem.expression, fixed_eval));
                }

                return nodeResult(elem);
            });
        }

        const primops = fixed_eval(arrayRef.expression).value.primops;
        if (primops.has('Array#map')) {
            const argFunctions = fixed_eval(arrayRef.arguments[0]).value.nodes;
            return nodeLatticeJoinMap(argFunctions, func => {
                if (!isFunctionLikeDeclaration(func)) {
                    return unimplementedRes(`Expected function value for argument to Array#map: ${SyntaxKind[func.kind]}`);
                }

                return nodeResult(func.body)
            });
        } else if (primops.has('Array#filter')) {
            if (!ts.isPropertyAccessExpression(arrayRef.expression)) {
                return unimplementedRes(`Expected Array#filter to come from a property access expression: ${SyntaxKind[arrayRef.expression.kind]}`);
            }
            return nodesResult(getElementNodesOfArrayValuedNode(arrayRef.expression.expression, fixed_eval));
        } else {
            return unimplementedRes(`Unimplemented primop for getting element nodes of array valued node: ${[...primops].join(',')}`)
        }
    }).value.nodes;
}