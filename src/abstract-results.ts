import ts from 'typescript';
import { AbstractObject, AbstractValue, ArrayRef, ArrayStore, arrayValue, botValue, FlatLattice, isBottom, isTop, joinValue, FlatLatticeKey, literalValue, nodesValue, nodeValue, ObjectStore, objectValue, prettyFlatLattice, primopValue, PromiseStore, promiseValue, resolvePromiseValue, topValue, top, bot, PromiseRef, MapStore, mapValue, NodeLattice } from './abstract-values';
import { SimpleSet } from 'typescript-super-set';
import { AtomicLiteral, SimpleFunctionLikeDeclaration } from './ts-utils';
import { mergeMaps, unimplementedRes } from './util';
import { FixedEval, PrimopId } from './primops';
import { AbstractMap } from './abstract-map';

export type AbstractResult = {
    value: AbstractValue,
    objectStore: ObjectStore,
    promiseStore: PromiseStore,
    arrayStore: ArrayStore,
    mapStore: MapStore,
}

export const botResult: AbstractResult = {
    value: botValue,
    objectStore: new Map(),
    promiseStore: new Map(),
    arrayStore: new Map(),
    mapStore: new Map(),
}
export const topResult: AbstractResult = {
    value: topValue,
    objectStore: new Map(),
    promiseStore: new Map(),
    arrayStore: new Map(),
    mapStore: new Map(),
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
export function objectResult(node: ts.ObjectLiteralExpression, obj: AbstractObject, existingStores: AbstractResult = botResult): AbstractResult {
    const value = objectValue(node);
    const map = new Map(existingStores.objectStore)
    map.set(node, obj);
    return {
        ...existingStores,
        value,
        objectStore: map,
    }
}
export function promiseResult(promiseSource: PromiseRef, resultToWrap: AbstractResult): AbstractResult {
    const value = promiseValue(promiseSource);
    const store = new Map(resultToWrap.promiseStore)
    store.set(promiseSource, { resolvesTo: resultToWrap.value });
    return {
        ...resultToWrap,
        value,
        promiseStore: store,
    }
}
export function primopResult(primopId: PrimopId): AbstractResult {
    return {
        ...botResult,
        value: primopValue(primopId),
    };
}
export function emptyMapResult(constructorSite: ts.NewExpression): AbstractResult {
    return {
        ...botResult,
        mapStore: new Map([[constructorSite, new AbstractMap()]]),
        value: mapValue(constructorSite),
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

export function arrayResult(node: ArrayRef, elementResult: AbstractResult): AbstractResult {
    const value = arrayValue(node);
    const store = new Map(elementResult.arrayStore);
    store.set(node, { element: elementResult.value });
    return {
        ...elementResult,
        value,
        arrayStore: store,
    }
}

export function join(a: AbstractResult, b: AbstractResult): AbstractResult {
    return {
        ...joinStores(a, b),
        value: joinValue(a.value, b.value),
    }
}

export function joinStores(a: AbstractResult, b: AbstractResult): AbstractResult {
    return {
        value: botValue,
        objectStore: mergeMaps(a.objectStore, b.objectStore),
        promiseStore: mergeMaps(a.promiseStore, b.promiseStore),
        arrayStore: mergeMaps(a.arrayStore, b.arrayStore),
        mapStore: mergeMaps(a.mapStore, b.mapStore),
    }
}

export function setJoinMap<T>(set: SimpleSet<T>, f: (item: T) => AbstractResult) {
    return set.elements.map(f).reduce(join, botResult);
}

export function joinAll(...abstractResults: AbstractResult[]): AbstractResult {
    return abstractResults.reduce(join, botResult);
}

export function getObjectProperty(from: AbstractResult, property: ts.Identifier, fixed_eval: FixedEval, printNodeAndPos: (node: ts.Node) => string): AbstractResult {
    return nodeLatticeJoinMap(from.value.nodes, node => { // todo merge this with the spot in dcfa/abstractEval/isPropertyAccessExpression
        if (ts.isObjectLiteralExpression(node)) {
            for (const prop of node.properties) {
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
            return unimplementedRes(`Unable to find object property ${property}`)
        } else if (ts.isCallExpression(node)) { // todo is primop application
            const operator = node.expression;
            if (ts.isIdentifier(operator) && operator.text === 'fetch') { // todo make this not hard coded
                return topResult;
            }
            return botResult;
        } else if (ts.isIdentifier(node)) {
            if (node.text === 'Date' && property.text === 'now') { // todo: this isn't quite right, we should be returning the property access, not the identifier
                return nodeResult(node);
            } else if (node.text === 'JSON' && property.text === 'parse') {
                return nodeResult(node);
            } else if (node.text === 'console') {
                return nodeResult(node) // todo: more specific methods
            } else if (node.text === 'Object') {
                return nodeResult(node)
            } else if (node.text === 'Array') {
                return nodeResult(node)
            } else {
                return unimplementedRes(`Unknown primitive identifier: ${printNodeAndPos(node)}`)
            }
        } else {
            return botResult;
        }
    })
}
export function getArrayElement(from: AbstractResult): AbstractResult {
    const arrayLattice = from.value.arrays;
    const arrayStore = from.arrayStore;
    if (isTop(arrayLattice)) {
        return topResult;
    } else if (isBottom(arrayLattice)) {
        return botResult;
    } else {
        const ref = arrayLattice.item;
        const arr = arrayStore.get(ref);
        if (arr === undefined) {
            throw new Error('expected arr to be in store');
        }
        return {
            ...from,
            value: arr.element,
        }
    }
}

export function resolvePromise(promiseResult: AbstractResult): AbstractResult {
    const promiseValue = resolvePromiseValue(promiseResult.value, promiseResult.promiseStore);

    return {
        ...promiseResult,
        value: promiseValue,
    }
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
            ...joinStores(result, res),
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
            ...joinStores(res1, res2),
            value: {
                ... topValue,
                [key]: top
            },
        }
    } else if (isBottom(items1) || isBottom(items2)) {
        return {
            ...joinStores(res1, res2),
            value: {
                ... botValue,
                [key]: bot
            },
        }
    } else {
        const result = f(items1.item, items2.item);
        return {
            ...joinStores(result, joinStores(res1, res2)),
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
        ...abstractResult.value.primops.elements,
        ...(abstractResult.value.null ? ['null'] : []),
        ...(abstractResult.value.undefined ? ['undefined'] : []),
        abstractResult.objectStore,
        abstractResult.promiseStore,
        abstractResult.arrayStore,
        abstractResult.mapStore,
      ]
}

export function nodeLatticeJoinMap(lattice: NodeLattice, convert: (node: ts.Node) => AbstractResult): AbstractResult {
    if (lattice.elements.some(isTop)) {
        return topResult;
    }
    return setJoinMap(lattice as SimpleSet<ts.Node>, convert);
}
