import ts from 'typescript';
import { FixedEval, FixedTrace } from './dcfa';
import { AbstractValue, NodeLattice, NodeLatticeElem, nodeLatticeFlatMap, nodeLatticeJoinMap, nodeLatticeMap, nodeLatticeSome, nodeValue, unimplementedVal } from './abstract-values';
import { getPropertyOfProto, getBuiltInValueOfBuiltInConstructor, getProtoOf, isBuiltInConstructorShaped, resultOfElementAccess, resultOfPropertyAccess } from './value-constructors';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { empty, setSift, singleton } from './setUtil';
import { unimplemented } from './util';
import { isAsyncKeyword, isFunctionLikeDeclaration, NodePrinter, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';


export function getObjectProperty(access: ts.PropertyAccessExpression, fixed_eval: FixedEval, targetFunction: SimpleFunctionLikeDeclaration): AbstractValue {
    const expressionConses = fixed_eval(access.expression);
    const property = access.name;
    return nodeLatticeJoinMap(expressionConses, cons => {
        if (ts.isObjectLiteralExpression(cons)) {
            for (const prop of cons.properties) {
                if (prop.name === undefined || !ts.isIdentifier(prop.name)) {
                    console.warn(`Expected identifier for property`);
                    continue;
                }

                if (prop.name.text !== property.text) {
                    continue;
                }

                if (ts.isPropertyAssignment(prop)) {
                    return fixed_eval(prop.initializer);
                } else if (ts.isShorthandPropertyAssignment(prop)) {
                    return fixed_eval(prop.name)
                } else {
                    console.warn(`Unknown object property assignment`)
                }
            }
            return unimplementedVal(`Unable to find object property ${printNodeAndPos(property)}`)
        } else if (isBuiltInConstructorShaped(cons)) {
            const builtInValue = getBuiltInValueOfBuiltInConstructor(cons, fixed_eval, printNodeAndPos, targetFunction);
            return resultOfPropertyAccess[builtInValue](access, { fixed_eval });
        } else {
            const proto = getProtoOf(cons, printNodeAndPos);
            if (proto === null) {
                return unimplementedVal(`No constructors found for property access ${printNodeAndPos(access)}`);
            }
            return getPropertyOfProto(proto, property.text, cons, access, fixed_eval);
        }
    })
}

export function getElementNodesOfArrayValuedNode(node: ts.Node, { fixed_eval, fixed_trace, printNodeAndPos, targetFunction }: { fixed_eval: FixedEval, fixed_trace: FixedTrace, printNodeAndPos: NodePrinter, targetFunction: SimpleFunctionLikeDeclaration }): NodeLattice {
    const conses = fixed_eval(node);
    return nodeLatticeFlatMap(conses, cons => {
        if (ts.isArrayLiteralExpression(cons)) {
            const elements = new SimpleSet<NodeLatticeElem>(structuralComparator, ...cons.elements);
            return nodeLatticeFlatMap(elements, element => {
                if (ts.isSpreadElement(element)) {
                    const subElements = getElementNodesOfArrayValuedNode(element.expression, { fixed_eval, fixed_trace, printNodeAndPos, targetFunction });
                    return subElements;
                }

                return singleton<NodeLatticeElem>(element);
            })
        } else if (isBuiltInConstructorShaped(cons)) {
            const builtInValue = getBuiltInValueOfBuiltInConstructor(cons, fixed_eval, printNodeAndPos, targetFunction)
            return resultOfElementAccess[builtInValue](cons, { fixed_eval, fixed_trace, printNodeAndPos, targetFunction });
        } else {
            return unimplemented(`Unable to access element of ${printNodeAndPos(cons)}`, empty());
        }
    });
}

export function resolvePromisesOfNode(node: ts.Node, fixed_eval: FixedEval): NodeLattice {
    const conses = fixed_eval(node);
    return nodeLatticeFlatMap(conses, cons => {
        if (isAsyncKeyword(cons)) { // i.e. it's a return value of an async function
            const sourceFunction = cons.parent;
            if (!isFunctionLikeDeclaration(sourceFunction)) {
                return unimplementedVal(`Expected ${printNodeAndPos(sourceFunction)} to be the source of a promise value`);
            }
            return fixed_eval(sourceFunction.body);
        } else {
            return nodeValue(cons);
        }
    })
}

export function getMapSetCalls(returnSites: NodeLattice, { fixed_eval, printNodeAndPos, targetFunction }: { fixed_eval: FixedEval, printNodeAndPos: NodePrinter, targetFunction: SimpleFunctionLikeDeclaration }): NodeLattice {
    const callSitesOrFalses = nodeLatticeMap(returnSites, site => {
        const access = site.parent;
        if (!(ts.isPropertyAccessExpression(access))) {
            return false;
        }
        const accessConses = fixed_eval(access);
        if (!nodeLatticeSome(accessConses, cons =>
                isBuiltInConstructorShaped(cons)
                && getBuiltInValueOfBuiltInConstructor(cons, fixed_eval, printNodeAndPos, targetFunction) === 'Map#set'
            )
        ) {
            return false;
        }

        const call = access.parent;
        if (!ts.isCallExpression(call)) {
            return false;
        }

        return call as ts.Node;
    });
    return setSift(callSitesOrFalses);
}
