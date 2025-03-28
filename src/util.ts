import ts, { SyntaxKind } from 'typescript';
import { AbstractResult, botResult, nodeLatticeJoinMap, nodeResult, nodesResult, resultBind } from './abstract-results';
import { FixedEval, FixedTrace } from './primops';
import { ArrayRef, NodeLattice, NodeLatticeElem, nodeLatticeFlatMap } from './abstract-values';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { isFunctionLikeDeclaration } from './ts-utils';
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

export function unimplementedRes(message: string): AbstractResult {
    return unimplemented(message, botResult);
}

export function getElementNodesOfArrayValuedNode(node: ts.Node, { fixed_eval, fixed_trace, printNodeAndPos }: { fixed_eval: FixedEval, fixed_trace: FixedTrace, printNodeAndPos: NodePrinter }): NodeLattice {
    const conses = fixed_eval(node).value.nodes;
    return nodeLatticeFlatMap(conses, cons => {
        if (ts.isArrayLiteralExpression(cons)) {
            const elements = new SimpleSet<NodeLatticeElem>(structuralComparator, ...cons.elements);
            return nodeLatticeFlatMap(elements, element => {
                if (ts.isSpreadElement(element)) {
                    const subElements = getElementNodesOfArrayValuedNode(element.expression, { fixed_eval, fixed_trace, printNodeAndPos });
                    return subElements;
                }

                return singleton<NodeLatticeElem>(element);
            })
        } else if (isBuiltInConstructorShaped(cons)) {
            const builtInValue = getBuiltInValueOfBuiltInConstructor(cons, fixed_eval, printNodeAndPos)
            return resultOfElementAccess[builtInValue](cons, { fixed_eval, fixed_trace, printNodeAndPos }).value.nodes;
        } else {
            return unimplemented(`Unable to access element of ${printNodeAndPos(cons)}`, empty());
        }
    });
}