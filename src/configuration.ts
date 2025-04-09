import ts from 'typescript'
import { Extern } from './abstract-values'

export type Config = {
    cursor: Cursor,
    env: Environment,
}
export type Cursor = ts.Node | Extern;
export type Environment = Context[];
type Context =
| LimitSentinel
| Question
| {
    head: ts.CallExpression,
    tail: Context
};
type LimitSentinel = { __limitSentinelBrand: true }
type Question = { __questionBrand: true, param: ts.Identifier }

export const limit: LimitSentinel = { __limitSentinelBrand: true };