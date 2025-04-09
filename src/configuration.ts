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
    head: ts.CallExpression,
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

export function pushContext(call: ts.CallExpression, env: Environment, m: number) {
    const innermostContext = env[0];
    return truncate({ head: call, tail: innermostContext }, m);

}

function truncate(context: Context, m: number): Context {
    if (m === 0) {
        return limit;
    } else if (isQuestion(context)) {
        return context;
    } else {
        if (isLimit(context)) {
            throw new Error(`Expected context not to be a limit`);
        }
        return {
            head: context.head,
            tail: truncate(context.tail, m - 1),
        }
    }
}

function isQuestion(context: Context): context is Question {
    return '__questionBrand' in context;
}

function isLimit(context: Context): context is LimitSentinel {
    return context === limit;
}
