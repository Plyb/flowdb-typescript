import { Comparator, SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { Truthy } from 'lodash';
import { StructuralSet } from './structural-set';

export function setMap<T, R>(set: StructuralSet<T>, f: (a: T) => R, rComparator: Comparator<R> = structuralComparator): StructuralSet<R> {
  return new SimpleSet(rComparator, ...set.elements.map(f));
}
export function setFilter<T, S extends T>(set: StructuralSet<T>, predicate: (a: T) => a is S, rComparator: Comparator<S>): StructuralSet<S>; 
export function setFilter<T, S extends T>(set: StructuralSet<T>, predicate: (a: T) => a is S): StructuralSet<S>; 
export function setFilter<T>(set: StructuralSet<T>, predicate: (a: T) => boolean, rComparator: Comparator<T>): StructuralSet<T>; 
export function setFilter<T>(set: StructuralSet<T>, predicate: (a: T) => boolean): StructuralSet<T>; 
export function setFilter<T>(set: StructuralSet<T>, predicate: (a: T) => boolean, rComparator: Comparator<T> = structuralComparator): StructuralSet<T> {
  return new SimpleSet(rComparator, ...set.elements.filter(predicate));
}
export function setSift<T>(set: StructuralSet<T>): StructuralSet<Truthy<T>> {
  return setFilter(set, Boolean) as StructuralSet<Truthy<T>>
} 
export function union<T>(a: StructuralSet<T>, b: StructuralSet<T>, comparator: Comparator<T> = structuralComparator) {
  return new SimpleSet(comparator, ...a.elements, ...b.elements);
}
export function unionAll<T>(...elems: SimpleSet<T>[]) {
  return new SimpleSet(structuralComparator, ...elems.reduce((acc, curr) => union<T>(acc, curr), empty<T>()));
}
export function singleton<T>(x: T, comparator: Comparator<T> = structuralComparator): StructuralSet<T> {
  return new SimpleSet(comparator, x);
}
export function empty<T>(comparator: Comparator<T> = structuralComparator): StructuralSet<T> {
  return new SimpleSet(comparator);
}
export function setFlatMap<T, R>(set: StructuralSet<T>, f: (a: T) => StructuralSet<R>, rComparator: Comparator<R> = structuralComparator): StructuralSet<R> {
  return new SimpleSet(rComparator, ...set.elements.flatMap((elem) => f(elem).elements));
}
export function setSome<T>(set: StructuralSet<T>, predicate: (item: T) => boolean) {
  return set.elements.some(predicate);
}
export function setMinus<T>(a: StructuralSet<T>, b: StructuralSet<T>, comparator: Comparator<T> = structuralComparator): StructuralSet<T> {
  return new SimpleSet(comparator, ...a.elements.filter(elem => !b.has(elem)));
}

export function setOf<T, R>(f: (arg: T) => Iterable<R>): (arg: T) => StructuralSet<R> {
  return (arg) => new SimpleSet(structuralComparator, ...f(arg));
}
