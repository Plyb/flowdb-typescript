import { isEqual } from 'lodash';
import { AbstractValue, joinAllValues, subsumes } from './abstract-values';

type AbstractMapEntry = {
    key: AbstractValue,
    value: AbstractValue,
};

export class AbstractMap {
    entries: AbstractMapEntry[]

    constructor(entries: AbstractMapEntry[] = []) {
        this.entries = []
    }

    keys() {
        return joinAllValues(...this.entries.map(entry => entry.key));
    }

    get(key: AbstractValue) {
        const matchingValues = this.entries
            .filter(({ key: entryKey }) => subsumes(entryKey, key) || subsumes(key, entryKey))
            .map(({ value }) => value);
        return joinAllValues(...matchingValues);
    }

    set(key: AbstractValue, value: AbstractValue) {
        const indexOfExistingKey = this.entries
            .findIndex(({ key: entryKey }) => isEqual(entryKey, key));
        if (indexOfExistingKey === -1) {
            return new AbstractMap([...this.entries, { key, value }]);
        } else {
            return new AbstractMap(this.entries.splice(indexOfExistingKey, 1, { key, value }));
        }
    }
}