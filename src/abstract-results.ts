import ts from 'typescript';
import { AbstractArray, AbstractObject, AbstractValue, ArrayRef, ArrayStore, arrayValue, botValue, isBottom, isTop, joinValue, LatticeKey, literalValue, nodesValue, nodeValue, ObjectLattice, ObjectStore, objectValue, prettyFlatLattice, primopValue, PromiseStore, promiseValue, resolvePromiseValue, topValue, valueBind, valueBind2 } from './abstract-values';
import { SimpleSet } from 'typescript-super-set';
import { AtomicLiteral, SimpleFunctionLikeDeclaration } from './ts-utils';
import { mergeMaps } from './util';
import { PrimopId } from './primops';

export type AbstractResult = {
    value: AbstractValue,
    objectStore: ObjectStore,
    promiseStore: PromiseStore,
    arrayStore: ArrayStore,
}

export const botResult: AbstractResult = {
    value: botValue,
    objectStore: new Map(),
    promiseStore: new Map(),
    arrayStore: new Map()
}
export const topResult: AbstractResult = {
    value: topValue,
    objectStore: new Map(),
    promiseStore: new Map(),
    arrayStore: new Map(),
}

export function nodeResult(node: ts.Node): AbstractResult {
    return {
        ...botResult,
        value: nodeValue(node),
    }
}
export function nodesResult(nodes: SimpleSet<ts.Node>): AbstractResult {
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
export function promiseResult(promiseSource: SimpleFunctionLikeDeclaration, resultToWrap: AbstractResult): AbstractResult {
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

export function result(value: AbstractValue): AbstractResult {
    return {
        ...botResult,
        value,
    };
}

export function arrayResult(node: ArrayRef, itemResult: AbstractResult): AbstractResult {
    const value = arrayValue(node);
    const store = new Map(itemResult.arrayStore);
    store.set(node, { item: itemResult.value });
    return {
        ...itemResult,
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

export function resolvePromise(promiseResult: AbstractResult): AbstractResult {
    const promiseValue = resolvePromiseValue(promiseResult.value, promiseResult.promiseStore);

    return {
        ...promiseResult,
        value: promiseValue,
    }
}

export function resultBind<T>(res: AbstractResult, key: LatticeKey, f: (item: T) => AbstractValue): AbstractResult {
    const value = res.value;
    return {
        ...res,
        value: valueBind(value, key, f),
    }
}
export function resultBind2<T>(res1: AbstractResult, res2: AbstractResult, key: LatticeKey, f: (item1: T, item2: T) => AbstractValue): AbstractResult {
    const value1 = res1.value;
    const value2 = res2.value
    return {
        ...joinStores(res1, res2),
        value: valueBind2(value1, value2, key, f),
    }
}

export function pretty(abstractResult: AbstractResult, sf: ts.SourceFile): any[] {
    return [
        ...abstractResult.value.nodes.elements.map(node => node.getText(sf)),
        ...prettyFlatLattice(abstractResult.value.strings, 'STRING'),
        ...prettyFlatLattice(abstractResult.value.numbers, 'NUMBER'),
        ...prettyFlatLattice(abstractResult.value.booleans, 'BOOLEAN'),
        ...prettyFlatLattice(abstractResult.value.objects, 'OBJECT'),
        ...prettyFlatLattice(abstractResult.value.promises, 'PROMISE'),
        ...prettyFlatLattice(abstractResult.value.arrays, 'ARRAY'),
        abstractResult.objectStore,
        abstractResult.promiseStore,
        abstractResult.arrayStore,
      ]
}
