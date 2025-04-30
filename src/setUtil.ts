import { Comparator, SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { Truthy } from 'lodash';
import { Set } from 'immutable'

export function setMap<T, R>(set: Set<T>, f: (a: T) => R): Set<R> {
  return Set(set.toArray().map(f));
}
export function setFilter<T, S extends T>(set: Set<T>, predicate: (a: T) => a is S): Set<S>; 
export function setFilter<T>(set: Set<T>, predicate: (a: T) => boolean): Set<T>; 
export function setFilter<T>(set: Set<T>, predicate: (a: T) => boolean): Set<T> {
  return set.filter(predicate);
}
export function setSift<T>(set: Set<T>): Set<Truthy<T>> {
  return setFilter(set, Boolean) as Set<Truthy<T>>
} 
export function union<T>(a: Set<T>, b: Set<T>) {
  return a.union(b);
}
export function unionAll<T>(...elems: Set<T>[]) {
  return Set.union(elems);
}
export function singleton<T>(item: T): Set<T> {
  return Set.of(item);
}
export function empty<T>(): Set<T> {
  return Set<T>();
}
export function setFlatMap<T, R>(set: Set<T>, f: (a: T) => Set<R>): Set<R> {
  return set.flatMap(f);
}
export function setSome<T>(set: Set<T>, predicate: (item: T) => boolean) {
  return set.some(predicate);
}
export function setMinus<T>(a: Set<T>, b: Set<T>): Set<T> {
  return a.filter(elem => !b.has(elem));
}

export function setOf<T, R>(f: (arg: T) => Iterable<R>): (arg: T) => Set<R> {
  return (arg) => Set.of(...f(arg));
}
