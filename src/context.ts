import ts from 'typescript';
import { SimpleFunctionLikeDeclaration } from './ts-utils';

export type Context =
| LimitSentinel
| Question
| StackBottom
| ContextCons
type LimitSentinel = { __limitSentinelBrand: true }
export type Question = { __questionBrand: true, func: SimpleFunctionLikeDeclaration }
type StackBottom = { __stackBottomBrand: true }
type ContextCons = {
    head: ts.CallExpression,
    tail: Context
}

export const limit: LimitSentinel = { __limitSentinelBrand: true };
export const stackBottom: StackBottom = { __stackBottomBrand: true };

export function isQuestion(context: Context): context is Question {
    return '__questionBrand' in context;
}
export function isLimit(context: Context): context is LimitSentinel {
    return context === limit;
}
export function isStackBottom(context: Context): context is StackBottom {
    return '__stackBottomBrand' in context;
}
function isContextCons(context: Context): context is ContextCons {
    return 'head' in context;
}

export function newQuestion(func: SimpleFunctionLikeDeclaration): Question {
    return {
        __questionBrand: true,
        func,
    }
}

export function refines(a: Context, b: Context) {
    if (!isContextCons(a)) {
        return false;
    }

    if (isQuestion(b)) {
        return true;
    }

    return isContextCons(b) && a.head == b.head
        && refines(a.tail, b.tail);
}
