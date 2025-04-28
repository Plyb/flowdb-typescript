import ts from 'typescript';
import { NonEmptyArray } from './util';

export type Extern = { __externBrand: true }
export const extern: Extern = { __externBrand: true }
export type Cursor = AnalysisNode | Extern;
export function isExtern(cursor: Cursor): cursor is Extern {
    return '__externBrand' in cursor;
}

export type AnalysisNode = ts.Node | ArgumentList
type ArgumentList = {
    kind: AnalysisNodeKind.ArgumentList
    arguments: NonEmptyArray<ts.Node>
    get parent(): ts.Node
    getSourceFile(): ts.SourceFile
    get pos(): number
}

export enum AnalysisNodeKind {
    ArgumentList = 999001
}

export function isArgumentList(node: AnalysisNode): node is ArgumentList {
    return node.kind === AnalysisNodeKind.ArgumentList;
}
