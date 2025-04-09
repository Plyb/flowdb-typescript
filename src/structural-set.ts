import { SimpleSet } from 'typescript-super-set';

export type StructuralSet<T> = Omit<SimpleSet<T>, "_comparator" | "add" | "clear" | "delete">