import ts from 'typescript';
import { SimpleFunctionLikeDeclaration } from './ts-utils';

export type Context =
| LimitSentinel
| Question
| StackBottom
| {
    head: ts.CallExpression,
    tail: Context
};
type LimitSentinel = { __limitSentinelBrand: true }
export type Question = { __questionBrand: true, func: SimpleFunctionLikeDeclaration }
type StackBottom = { __stackBottomBrand: true }

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

export function newQuestion(func: SimpleFunctionLikeDeclaration): Question {
    return {
        __questionBrand: true,
        func,
    }
}
