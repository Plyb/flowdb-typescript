import { isEqual } from 'lodash';
import { Comparator, ComparatorResult, SimpleSet } from 'typescript-super-set';


export function structuralComparator<T>(a: T, b: T) {
    const eq = (a: T, b: T) => a === b || isEqual(a, b);
    if (eq(a, b)) {
        return 0;
    } else {
        return 1; // pretty sure this is okay since we're not worried about ordering in our sets
    }
}

export function lexicographic<T>(first: Comparator<T>, second: Comparator<T>) {
    return (a: T, b: T) => {
        const firstResult = first(a, b);
        if (firstResult !== 0) {
            return firstResult;
        } else {
            return second(a, b);
        }
    }
}

function toComparatorResult(num: number): ComparatorResult {
    if (num === 0) {
        return num;
    } else if (num > 0) {
        return 1;
    } else {
        return -1;
    }
}

export function stringCompare(a: string, b: string): ComparatorResult {
    return toComparatorResult(b.localeCompare(a));
}

export function simpleSetComparator<T>(elemComparator: Comparator<T>): (a: SimpleSet<T>, b: SimpleSet<T>) => ComparatorResult {
    return (a: SimpleSet<T>, b: SimpleSet<T>): ComparatorResult => {
        const aElems = a.elements;
        const bElems = b.elements;
        if (!a.hasAll(...bElems)) {
            return -1;
        } else if (!b.hasAll(...aElems)) {
            return 1;
        } else {
            return 0;
        }
    }
}
