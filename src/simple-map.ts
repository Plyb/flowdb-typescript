import { isEqual } from 'lodash';
import { Comparator, SimpleSet } from 'typescript-super-set';

export class SimpleMap<K, V> {
    private internalMap: Map<K, V> = new Map()
    private defaultValue: V;
    private keyComparator: Comparator<K>

    constructor(keyComparator: Comparator<K>, defaultValue: V) {
        this.keyComparator = keyComparator;
        this.defaultValue = defaultValue;
    }

    public get(key: K): V | undefined {
        const directValue = this.internalMap.get(key);
        if (directValue !== undefined) {
            return directValue;
        }

        for (const [existingKey, existingValue] of this.internalMap.entries()) {
            if (this.keyComparator(key, existingKey) === 0) {
                return existingValue;
            }
        }

        return this.defaultValue;
    }

    public set(key: K, value: V) {
        const trueKey = [...this.internalMap.keys()]
            .find(k => this.keyComparator(k, key) === 0)
            ?? key;

        this.internalMap.set(trueKey, value);
    }

    public has(key: K) {
        const trueKey = [...this.internalMap.keys()]
            .find(k => this.keyComparator(k, key) === 0)
            ?? key;

        return this.internalMap.has(trueKey);
    }
}