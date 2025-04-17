import ts from 'typescript';

export type Extern = { __externBrand: true }
export const extern: Extern = { __externBrand: true }
export type Cursor = ts.Node | Extern;
export function isExtern(cursor: Cursor): cursor is Extern {
    return '__externBrand' in cursor;
}
