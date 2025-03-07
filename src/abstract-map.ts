import { isEqual } from 'lodash';
import { AbstractValue, joinAllValues, subsumes } from './abstract-values';

type AbstractMapEntry = {
    key: AbstractValue,
    value: AbstractValue,
};

export class AbstractMap {
    entries: AbstractMapEntry[]

    constructor() {
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
            this.entries.push({ key, value });
        } else {
            this.entries[0] = { key, value };
        }
    }
}