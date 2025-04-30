import { Map, Set } from 'immutable'

export class Lookup<K, V> {
    constructor(private internalMap: Map<K, Set<V>> = Map()) {}

    public get(key: K): Set<V> {
        return this.internalMap.get(key, Set());
    }

    public add(key: K, value: V): Lookup<K, V> {
        const oldValues = this.internalMap.get(key, Set<V>());
        const addedValues = oldValues.add(value)
        return new Lookup(this.internalMap.set(key, addedValues));
    }

    public addAll(key: K, values: Set<V>) {
        const oldValues = this.internalMap.get(key, Set<V>());
        const addedValues = oldValues.union(values);
        return new Lookup(this.internalMap.set(key, addedValues));
    }

    public set(key: K, values: Set<V>) {
        return new Lookup(this.internalMap.set(key, values));
    }
}