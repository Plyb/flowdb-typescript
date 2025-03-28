import ts from 'typescript'
import { Comparator, SimpleSet } from 'typescript-super-set'
import { empty, setFilter, setFlatMap, setMap, setSome, singleton, union } from './setUtil'
import { structuralComparator } from './comparators'
import { unimplemented, unimplementedVal } from './util';
import { getBuiltInMethod, getBuiltInValueOfBuiltInConstructor, getProtoOf, isBuiltInConstructorShaped, NodePrinter, resultOfElementAccess, resultOfPropertyAccess } from './value-constructors';
import { FixedEval, FixedTrace } from './primops';

export type AbstractValue = NodeLattice;

export type NodeLatticeElem = ts.Node | Top;
export type NodeLattice = SimpleSet<NodeLatticeElem>;

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

export function nodeLatticeFilter(nodeLattice: NodeLattice, predicate: (node: ts.Node) => boolean): NodeLattice {
    return setFilter(nodeLattice, elem => isTop(elem) || predicate(elem));
}
export function nodeLatticeMap<R>(nodeLattice: NodeLattice, convert: (node: ts.Node) => R): SimpleSet<R | Top> {
    return setMap(nodeLattice, elem => isTop(elem) ? elem : convert(elem));
}
export function nodeLatticeFlatMap<R>(nodeLattice: NodeLattice, convert: (node: ts.Node) => SimpleSet<R | Top>, rComparator: Comparator<R | Top> = structuralComparator): SimpleSet<R | Top> {
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

export function getObjectProperty(access: ts.PropertyAccessExpression, fixed_eval: FixedEval, printNodeAndPos: (node: ts.Node) => string): AbstractValue {
    const expressionResult = fixed_eval(access.expression);
    const property = access.name;
    return nodeLatticeJoinMap(expressionResult, cons => {
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

export function getElementNodesOfArrayValuedNode(node: ts.Node, { fixed_eval, fixed_trace, printNodeAndPos }: { fixed_eval: FixedEval, fixed_trace: FixedTrace, printNodeAndPos: NodePrinter }): NodeLattice {
    const conses = fixed_eval(node);
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
            return resultOfElementAccess[builtInValue](cons, { fixed_eval, fixed_trace, printNodeAndPos });
        } else {
            return unimplemented(`Unable to access element of ${printNodeAndPos(cons)}`, empty());
        }
    });
}
