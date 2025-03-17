import ts from 'typescript';
import { AbstractObject, AbstractValue, ArrayRef, ArrayStore, arrayValue, botValue, FlatLattice, isBottom, isTop, joinValue, FlatLatticeKey, literalValue, nodesValue, nodeValue, ObjectStore, objectValue, prettyFlatLattice, primopValue, PromiseStore, promiseValue, resolvePromiseValue, topValue, top, bot, PromiseRef, MapStore, mapValue, NodeLattice } from './abstract-values';
import { SimpleSet } from 'typescript-super-set';
import { AtomicLiteral, SimpleFunctionLikeDeclaration } from './ts-utils';
import { mergeMaps } from './util';
import { PrimopId } from './primops';
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

export function getObjectProperty(from: AbstractResult, property: ts.Identifier): AbstractResult {
    const objectLattice = from.value.objects;
    const objectStore = from.objectStore;
    if (isTop(objectLattice)) {
        return topResult;
    } else if (isBottom(objectLattice)) {
        return botResult;
    } else {
        const ref = objectLattice.item;
        const obj = objectStore.get(ref);
        if (obj === undefined) {
            throw new Error('expected obj to be in store');
        }
        return {
            ...from,
            value: obj[property.text] ?? botValue,
        };
    }
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
