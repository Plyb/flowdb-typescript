import { Comparator, SimpleSet } from 'typescript-super-set';

export class Lookup<K, V> {
    private internalMap: Map<K, SimpleSet<V>> = new Map()
    private keyComparator: Comparator<K>
    private valueComparator: Comparator<V>

    constructor(keyComparator: Comparator<K>, valueComparator: Comparator<V>) {
        this.keyComparator = keyComparator;
        this.valueComparator = valueComparator;
    }

    public get(key: K): SimpleSet<V> {
        const directValues = this.internalMap.get(key);
        if (directValues !== undefined) {
            return directValues;
        }

        for (const [existingKey, existingValues] of this.internalMap.entries()) {
            if (this.keyComparator(key, existingKey) === 0) {
                return existingValues;
            }
        }

        return new SimpleSet(this.valueComparator);
    }

    public add(key: K, value: V) {
        const directValues = this.internalMap.get(key);
        if (directValues != undefined) {
            directValues.add(value);
            return;
        }

        for (const [existingKey, existingValues] of this.internalMap.entries()) {
            if (this.keyComparator(key, existingKey) === 0) {
                existingValues.add(value);
                return
            }
        }

        this.internalMap.set(key, new SimpleSet(this.valueComparator, value));
    }

    public addAll(key: K, values: SimpleSet<V>) {
        for (const value of values) {
            this.add(key, value);
        }
    }

    public set(key: K, values: SimpleSet<V>) {
        const trueKey = [...this.internalMap.keys()]
            .find(k => this.keyComparator(k, key) === 0)
            ?? key;

        this.internalMap.set(trueKey, values);
    }
}