import path from 'path';

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

export function unimplemented<T>(message: string, returnVal: T): T {
    console.warn(message);
    return returnVal;
}

export function getRootFolder(relativePath: string) {
    return path.resolve(__dirname, relativePath);
}
export function getTsConfigAppPath(rootFolder: string) {
    return path.join(rootFolder, 'tsconfig.app.json');
}
export function getTsConfigPath(rootFolder: string) {
    return path.join(rootFolder, 'tsconfig.json');
}

export type NonEmptyArray<T> = [T, ...T[]];
export function assertNonEmpty<T>(items: T[]): NonEmptyArray<T> {
    if (items[0] === undefined) {
        throw new Error('Expected a non-empty array')
    }
    return items as NonEmptyArray<T>;
}
