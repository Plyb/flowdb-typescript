import ts from 'typescript';
import { AbstractValue, botValue, isTop, joinValue, nodesValue, nodeValue, topValue, NodeLattice } from './abstract-values';
import { SimpleSet } from 'typescript-super-set';
import { unimplementedVal } from './util';
import { FixedEval } from './primops';
import { getBuiltInMethod, getBuiltInValueOfBuiltInConstructor, getProtoOf, isBuiltInConstructorShaped, resultOfPropertyAccess } from './value-constructors';


export function setJoinMap<T>(set: SimpleSet<T>, f: (item: T) => AbstractValue) {
    return set.elements.map(f).reduce(joinValue, botValue);
}

export function setSome<T>(set: SimpleSet<T>, predicate: (item: T) => boolean) {
    return set.elements.some(predicate);
}

export function getObjectProperty(access: ts.PropertyAccessExpression, fixed_eval: FixedEval, printNodeAndPos: (node: ts.Node) => string): AbstractValue {
    const expressionResult = fixed_eval(access.expression);
    const property = access.name;
    return nodeLatticeJoinMap(expressionResult.nodes, cons => {
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
            const builtInValue = getBuiltInValueOfBuiltInConstructor(cons, fixed_eval, printNodeAndPos);
            return resultOfPropertyAccess[builtInValue](access);
        } else {
            const proto = getProtoOf(cons, printNodeAndPos);
            if (proto === null) {
                return unimplementedVal(`No constructors found for property access ${printNodeAndPos(access)}`);
            }
            const method = getBuiltInMethod(proto, property.text);
            if (method === undefined) {
                return unimplementedVal(`${property.text} is not a property of ${printNodeAndPos(cons)}`);
            }
            return nodeValue(access);
        }
    })
}

export function pretty(abstractValue: AbstractValue, printNode: (node: ts.Node) => string): any[] {
    return abstractValue.nodes.elements.map(elem => isTop(elem) ? 'ANY NODE' : printNode(elem))
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
