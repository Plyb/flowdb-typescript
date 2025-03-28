import { Comparator, SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { Truthy } from 'lodash';

export function setMap<T, R>(set: SimpleSet<T>, f: (a: T) => R, rComparator: Comparator<R> = structuralComparator): SimpleSet<R> {
  return new SimpleSet(rComparator, ...set.elements.map(f));
}
export function setFilter<T>(set: SimpleSet<T>, predicate: (a: T) => boolean, rComparator: Comparator<T> = structuralComparator): SimpleSet<T> {
  return new SimpleSet(rComparator, ...set.elements.filter(predicate));
}
export function setSift<T>(set: SimpleSet<T>): SimpleSet<Truthy<T>> {
  return setFilter(set, Boolean) as SimpleSet<Truthy<T>>
} 
export function union<T>(a: SimpleSet<T>, b: SimpleSet<T>, comparator: Comparator<T> = structuralComparator) {
  return new SimpleSet(comparator, ...a.elements, ...b.elements);
}
export function unionAll<T>(...elems: SimpleSet<T>[]) {
  return new SimpleSet(structuralComparator, ...elems.reduce((acc, curr) => union<T>(acc, curr), empty<T>()));
}
export function singleton<T>(x: T, comparator: Comparator<T> = structuralComparator) {
  return new SimpleSet(comparator, x);
}
export function empty<T>(comparator: Comparator<T> = structuralComparator) {
  return new SimpleSet(comparator);
}
export function setFlatMap<T, R>(set: SimpleSet<T>, f: (a: T) => SimpleSet<R>, rComparator: Comparator<R> = structuralComparator): SimpleSet<R> {
  return new SimpleSet(rComparator, ...set.elements.flatMap((elem) => f(elem).elements));
}
export function setSome<T>(set: SimpleSet<T>, predicate: (item: T) => boolean) {
    return set.elements.some(predicate);
}