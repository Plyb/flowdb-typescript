import ts from 'typescript';
import { AbstractValue, botValue, FlatLattice, isBottom, isTop, joinValue, FlatLatticeKey, literalValue, nodesValue, nodeValue, prettyFlatLattice, topValue, top, bot, NodeLattice } from './abstract-values';
import { SimpleSet } from 'typescript-super-set';
import { AtomicLiteral } from './ts-utils';
import { unimplementedRes } from './util';
import { FixedEval } from './primops';
import { getBuiltInMethod, getBuiltInValueOfBuiltInConstructor, getProtoOf, isBuiltInConstructorShaped, resultOfPropertyAccess } from './value-constructors';

export type AbstractResult = {
    value: AbstractValue,
}

export const botResult: AbstractResult = {
    value: botValue,
}
export const topResult: AbstractResult = {
    value: topValue,
}

export function nodeResult(node: ts.Node): AbstractResult {
    return {
        ...botResult,
        value: nodeValue(node),
    }
}
export function nodesResult(nodes: NodeLattice): AbstractResult {
    return {
        ...botResult,
        value: nodesValue(nodes),
    }
}
export function literalResult(node: AtomicLiteral): AbstractResult {
    return {
        ...botResult,
        value: literalValue(node),
    }
}

export const anyObjectResult = {
    ...botResult,
    value: { ...botValue, objects: top }
};

export function result(value: AbstractValue): AbstractResult {
    return {
        ...botResult,
        value,
    };
}

export function resultFrom<T>(construct: (item: T) => AbstractValue) {
    return (item: T) => result(construct(item));
}

export function join(a: AbstractResult, b: AbstractResult): AbstractResult {
    return {
        value: joinValue(a.value, b.value),
    }
}

export function setJoinMap<T>(set: SimpleSet<T>, f: (item: T) => AbstractResult) {
    return set.elements.map(f).reduce(join, botResult);
}

export function setSome<T>(set: SimpleSet<T>, predicate: (item: T) => boolean) {
    return set.elements.some(predicate);
}

export function joinAll(...abstractResults: AbstractResult[]): AbstractResult {
    return abstractResults.reduce(join, botResult);
}

export function getObjectProperty(access: ts.PropertyAccessExpression, fixed_eval: FixedEval, printNodeAndPos: (node: ts.Node) => string): AbstractResult {
    const expressionResult = fixed_eval(access.expression);
    const property = access.name;
    return nodeLatticeJoinMap(expressionResult.value.nodes, cons => {
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
            return unimplementedRes(`Unable to find object property ${printNodeAndPos(property)}`)
        } else if (isBuiltInConstructorShaped(cons)) {
            const builtInValue = getBuiltInValueOfBuiltInConstructor(cons, fixed_eval, printNodeAndPos);
            return resultOfPropertyAccess[builtInValue](access);
        } else {
            const proto = getProtoOf(cons, printNodeAndPos);
            if (proto === null) {
                return unimplementedRes(`No constructors found for property access ${printNodeAndPos(access)}`);
            }
            const method = getBuiltInMethod(proto, property.text);
            if (method === undefined) {
                return unimplementedRes(`${property.text} is not a property of ${printNodeAndPos(cons)}`);
            }
            return nodeResult(access);
        }
    })
}

export function resultBind<T>(res: AbstractResult, key: FlatLatticeKey, f: (item: T) => AbstractResult): AbstractResult {
    const value = res.value;
    const items = value[key] as FlatLattice<T>;

    if (isTop(items)) {
        return {
            ...res,
            value: {
                ... topValue,
                [key]: top
            },
        }
    } else if (isBottom(items)) {
        return {
            ...res,
            value: {
                ... botValue,
                [key]: bot
            },
        }
    } else {
        const result = f(items.item);
        return {
            value: result.value,
        }
    }
}
export function resultBind2<T>(res1: AbstractResult, res2: AbstractResult, key: FlatLatticeKey, f: (item1: T, item2: T) => AbstractResult): AbstractResult {
    const val1 = res1.value;
    const val2 = res2.value;
    const items1 = val1[key] as FlatLattice<T>;
    const items2 = val2[key] as FlatLattice<T>;
    if (isTop(items1) || isTop(items2)) {
        return {
            value: {
                ... topValue,
                [key]: top
            },
        }
    } else if (isBottom(items1) || isBottom(items2)) {
        return {
            value: {
                ... botValue,
                [key]: bot
            },
        }
    } else {
        const result = f(items1.item, items2.item);
        return {
            value: result.value,
        }
    }
}

export function pretty(abstractResult: AbstractResult, printNode: (node: ts.Node) => string): any[] {
    return [
        ...abstractResult.value.nodes.elements.map(elem => isTop(elem) ? 'ANY NODE' : printNode(elem)),
        ...prettyFlatLattice(abstractResult.value.strings, 'STRING'),
        ...prettyFlatLattice(abstractResult.value.numbers, 'NUMBER'),
        ...prettyFlatLattice(abstractResult.value.booleans, 'BOOLEAN'),
        ...prettyFlatLattice(abstractResult.value.dates, 'DATE'),
        ...prettyFlatLattice(abstractResult.value.regexps, 'REGEXP'),
        ...prettyFlatLattice(abstractResult.value.objects, 'OBJECT'),
        ...prettyFlatLattice(abstractResult.value.promises, 'PROMISE'),
        ...prettyFlatLattice(abstractResult.value.arrays, 'ARRAY'),
        ...prettyFlatLattice(abstractResult.value.maps, 'MAP'),
        ...(abstractResult.value.null ? ['null'] : []),
        ...(abstractResult.value.undefined ? ['undefined'] : []),
      ]
}

export function nodeLatticeJoinMap(lattice: NodeLattice, convert: (node: ts.Node) => AbstractResult): AbstractResult {
    if (lattice.elements.some(isTop)) {
        return topResult;
    }
    return setJoinMap(lattice as SimpleSet<ts.Node>, convert);
}

export function nodeLatticeSome(lattice: NodeLattice, predicate: (node: ts.Node) => boolean): boolean {
    return setSome(lattice, (elem) => !isTop(elem) && predicate(elem));
}
