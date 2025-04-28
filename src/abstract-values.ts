import ts from 'typescript';
import { NonEmptyArray } from './util';

export type Extern = { __externBrand: true }
export const extern: Extern = { __externBrand: true }
export type Cursor = AnalysisNode | Extern;
export function isExtern(cursor: Cursor): cursor is Extern {
    return '__externBrand' in cursor;
}

export type AnalysisNode = ts.Node | NonStandardNode
type NonStandardNode = ArgumentList | ElementPick;
type ArgumentList = {
    kind: AnalysisNodeKind.ArgumentList
    arguments: ts.Node[]
    get parent(): ts.Node
    getSourceFile(): ts.SourceFile
    get pos(): number
}
export type ElementPick = {
    kind: AnalysisNodeKind.ElementPick
    expression: AnalysisNode
    get parent(): ts.Node
    getSourceFile(): ts.SourceFile
    get pos(): number
}

export enum AnalysisNodeKind {
    ArgumentList = 999001,
    ElementPick = 999002,
}

export function isArgumentList(node: AnalysisNode): node is ArgumentList {
    return node.kind === AnalysisNodeKind.ArgumentList;
}
export function isElementPick(node: AnalysisNode): node is ElementPick {
    return node.kind === AnalysisNodeKind.ElementPick;
}

export function isStandard(node: AnalysisNode): node is ts.Node {
    return !isArgumentList(node) && !isElementPick(node)
}

export function createArgumentList(callSite: ts.CallExpression, start: number): ArgumentList {
    const args = callSite.arguments.slice(start);
    return {
        kind: AnalysisNodeKind.ArgumentList,
        arguments: args,
        get parent() { return callSite },
        getSourceFile() { return callSite.getSourceFile() },
        get pos() {
            if (args[0] !== undefined) {
                return args[0].pos;
            } else if (callSite.arguments[start - 1] !== undefined) {
                return callSite.arguments[start - 1].pos
            } else {
                return callSite.expression.end
            }
        }
    }
}

export function createElementPick(expression: AnalysisNode): ElementPick {
    return {
        kind: AnalysisNodeKind.ElementPick,
        expression,
        get parent() { return expression.parent },
        getSourceFile() { return expression.getSourceFile() },
        get pos() { return expression.pos }
    }
}

export const AnalysisSyntaxKind = {
    ...ts.SyntaxKind,
    ...AnalysisNodeKind,
}
