import ts, { SyntaxKind } from 'typescript';
import { SimpleFunctionLikeDeclaration } from './ts-utils';
import { Record, RecordOf } from 'immutable';

export type Context =
| LimitSentinel
| Question
| StackBottom
| ContextCons
type LimitSentinel = { __limitSentinelBrand: true }
export type Question = ReturnType<typeof QuestionRecord>
type StackBottom = { __stackBottomBrand: true }
type ContextCons = RecordOf<{
    head: ts.CallExpression,
    tail: Context
}>


export const limit: LimitSentinel = { __limitSentinelBrand: true };
export const stackBottom: StackBottom = { __stackBottomBrand: true };

const dummyCall = ts.factory.createCallExpression(ts.factory.createNumericLiteral(0), [], [])
export const ContextCons = Record({
    head: dummyCall,
    tail: limit as Context
})

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

const dummyFunc = ts.factory.createArrowFunction([], [], [], undefined, ts.factory.createToken(SyntaxKind.EqualsGreaterThanToken), ts.factory.createBlock([]))
const QuestionRecord = Record({
    __questionBrand: true as true,
    func: dummyFunc as SimpleFunctionLikeDeclaration
})
export function newQuestion(func: SimpleFunctionLikeDeclaration): Question {
    return QuestionRecord({
        __questionBrand: true,
        func,
    });
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
