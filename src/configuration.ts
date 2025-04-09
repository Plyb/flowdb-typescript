import ts from 'typescript'
import { Extern, isExtern } from './abstract-values'
import { StructuralSet } from './structural-set';
import { findAllParameterBinders, printNodeAndPos } from './ts-utils';

export type ConfigSet = StructuralSet<Config>;

export type Config<N extends Cursor = Cursor> = {
    node: N,
    env: Environment,
}
export type Cursor = ts.Node | Extern;
export type Environment = Context[];
type Context =
| LimitSentinel
| Question
| {
    head: ts.CallExpression[],
    tail: Context
};
type LimitSentinel = { __limitSentinelBrand: true }
type Question = { __questionBrand: true, param: ts.Identifier }

export const limit: LimitSentinel = { __limitSentinelBrand: true };

export type ConfigNoExtern = Config<Exclude<Cursor, Extern>>
export type ConfigSetNoExtern = StructuralSet<ConfigNoExtern>

export function withZeroContext(node: Cursor): Config {
    if (isExtern(node)) {
        return {
            node,
            env: []
        };
    }

    return {
        node,
        env: findAllParameterBinders(node).map(() => limit),
    }
}

export function printConfig(config: Config) {
    return printNodeAndPos(config.node) // TODO mcfa
} 
