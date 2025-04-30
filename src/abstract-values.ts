import ts, { SyntaxKind } from 'typescript';
import { List, Record, RecordOf } from 'immutable';

export type Extern = RecordOf<{ __externBrand: true }>
export const extern: Extern = Record<{ __externBrand: true }>({ __externBrand: true })()
export type Cursor = AnalysisNode | Extern;
export function isExtern(cursor: Cursor): cursor is Extern {
    return '__externBrand' in cursor;
}

export type AnalysisNode = ts.Node | NonStandardNode
type NonStandardNode = ArgumentList | ElementPick;
type ArgumentList = ReturnType<typeof ArgumentListRecord>
export type ElementPick = RecordOf<{
    kind: AnalysisNodeKind.ElementPick
    expression: AnalysisNode
    parent: ts.Node
    sourceFile: ts.SourceFile
    pos: number
}> // can't get rid of this duplication because of a circular reference :/

export enum AnalysisNodeKind {
    ArgumentList = 999001,
    ElementPick = 999002,
}

export function isArgumentList(node: Cursor): node is ArgumentList {
    return !isExtern(node) && node.kind === AnalysisNodeKind.ArgumentList;
}
export function isElementPick(node: AnalysisNode): node is ElementPick {
    return node.kind === AnalysisNodeKind.ElementPick;
}

export function isStandard(node: AnalysisNode): node is ts.Node {
    return !isArgumentList(node) && !isElementPick(node)
}

const dummy = ts.factory.createSourceFile([], ts.factory.createToken(SyntaxKind.EndOfFileToken), 0);
const ArgumentListRecord = Record({
    kind: AnalysisNodeKind.ArgumentList as AnalysisNodeKind.ArgumentList,
    arguments: List<ts.Node>(),
    parent: dummy as ts.Node,
    sourceFile: dummy,
    pos: -1
});
export function createArgumentList(callSite: ts.CallExpression, start: number): ArgumentList {
    const args = callSite.arguments.slice(start);
    let pos: number;
    if (args[0] !== undefined) {
        pos = args[0].pos;
    } else if (callSite.arguments[start - 1] !== undefined) {
        pos = callSite.arguments[start - 1].pos
    } else {
        pos = callSite.expression.end
    }
    return ArgumentListRecord({
        kind: AnalysisNodeKind.ArgumentList,
        arguments: List.of(...args),
        parent: callSite,
        sourceFile: callSite.getSourceFile(),
        pos,
    });
}


const ElementPickRecord = Record({
    kind: AnalysisNodeKind.ElementPick as AnalysisNodeKind.ElementPick,
    expression: dummy as AnalysisNode,
    parent: dummy as ts.Node,
    sourceFile: dummy,
    pos: -1
})
export function createElementPick(expression: AnalysisNode): ElementPick {
    return ElementPickRecord({
        kind: AnalysisNodeKind.ElementPick,
        expression,
        parent: expression.parent,
        sourceFile: sourceFileOf(expression),
        pos: expression.pos,
    });
}

export const AnalysisSyntaxKind = {
    ...ts.SyntaxKind,
    ...AnalysisNodeKind,
}

export function sourceFileOf(node: AnalysisNode): ts.SourceFile {
    if (isStandard(node)) {
        return node.getSourceFile();
    }
    return node.sourceFile
}
