export function id<T>(x: T): T {
    return x;
}

export function mergeMaps<K, V>(a: Map<K, V>, b: Map<K, V>): Map<K, V> {
    const aClone = new Map(a);
    for (const [key, value] of b.entries()) {
        aClone.set(key, value);
    }
    return aClone;
}

function isRelativeSpecifier(moduleSpecifier: string) {
    return moduleSpecifier.startsWith('/')
        || moduleSpecifier.startsWith('./')
        || moduleSpecifier.startsWith('../')
        || moduleSpecifier.startsWith('@/');
}

function isUrl(str: string) {
    try {
        new URL(str);
        return true;
    } catch {
        return false;
    }
}

function isAbsoluteSpecifier(moduleSpecifier: string) {
    return isUrl(moduleSpecifier);
}

export function isBareSpecifier(moduleSpecifier: string) {
    return !(isRelativeSpecifier(moduleSpecifier) || isAbsoluteSpecifier(moduleSpecifier));
}

export function unimplemented<T>(message: string, returnVal: T): T {
    console.warn(message);
    return returnVal;
}

export type List<T> = {
    head: T,
    tail: List<T>
}

export const emptyList = undefined as any as List<any>;

export function toList<T>(arr: T[]): List<T> {
    return arr.reduce((acc, curr) => consList(curr, acc), emptyList);
}
export function consList<T>(item: T, list: List<T>) {
    return { head: item, tail: list };
}
