import { Extern, isExtern } from './abstract-values'
import { setFilter, setMap, setSome } from './setUtil';
import { StructuralSet } from './structural-set';
import { findAllParameterBinders, isFunctionLikeDeclaration, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { emptyList, List, toList } from './util';
import ts from 'typescript';

export type ConfigSet = StructuralSet<Config>;

export type Config<N extends Cursor = Cursor> = {
    node: N,
    env: Environment,
}
export type Cursor = ts.Node | Extern;
export type Environment = List<Context>;
type Context =
| LimitSentinel
| Question
| {
    head: ts.CallExpression,
    tail: Context
};
type LimitSentinel = { __limitSentinelBrand: true }
type Question = { __questionBrand: true, func: SimpleFunctionLikeDeclaration }

export const limit: LimitSentinel = { __limitSentinelBrand: true };

type ConfigExtern = Config<Extern>
export type ConfigNoExtern = Config<Exclude<Cursor, Extern>>
export type ConfigSetNoExtern = StructuralSet<ConfigNoExtern>

export function withZeroContext<T extends Cursor>(node: T): Config<T> {
    if (isExtern(node)) {
        return {
            node,
            env: emptyList
        };
    }

    return {
        node,
        env: toList(findAllParameterBinders(node).map(() => limit)),
    }
}

export function printConfig(config: Config) {
    return printNodeAndPos(config.node) // TODO mcfa
} 

export function pushContext(call: ts.CallExpression, env: Environment, m: number) {
    const innermostContext = env.head;
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

export function isConfigNoExtern(config: Config): config is ConfigNoExtern {
    return !isExtern(config.node);
}export function isConfigExtern(config: Config): config is ConfigExtern {
    return isExtern(config.node);
}
export function isIdentifierConfig(config: Config): config is Config<ts.Identifier> {
    return !isExtern(config.node) && ts.isIdentifier(config.node);
}
export function isFunctionLikeDeclarationConfig(config: Config): config is Config<SimpleFunctionLikeDeclaration> {
    return isConfigNoExtern(config) && isFunctionLikeDeclaration(config.node);
}
export function isPropertyAccessConfig(config: ConfigNoExtern): config is Config<ts.PropertyAccessExpression> {
    return ts.isPropertyAccessExpression(config.node);
}
export function isCallConfig(config: ConfigNoExtern): config is Config<ts.CallExpression> {
    return ts.isCallExpression(config.node);
}export function isBlockConfig(config: ConfigNoExtern): config is Config<ts.Block> {
    return ts.isBlock(config.node);
}

export function configSetMap<T extends Cursor>(set: StructuralSet<Config<T>>, convert: (config: Config<T> & ConfigNoExtern) => Config): ConfigSet {
    return setMap(set, config => isConfigNoExtern(config) ? convert(config) : config);
}
export function configSetFilter<T extends ConfigNoExtern>(set: ConfigSet, predicate: (config: ConfigNoExtern) => config is T): StructuralSet<ConfigExtern | T>
export function configSetFilter(set: ConfigSet, predicate: (config: ConfigNoExtern) => boolean): ConfigSet
export function configSetFilter(set: ConfigSet, predicate: (config: ConfigNoExtern) => boolean): ConfigSet {
    return setFilter(set, config => !isConfigNoExtern(config) || predicate(config));
}
export function configSetSome(set: ConfigSet, predicate: (config: ConfigNoExtern) => boolean): boolean {
    return setSome(set, config => isConfigNoExtern(config) && predicate(config));
}

export function newQuestion(func: SimpleFunctionLikeDeclaration): Question {
    return {
        __questionBrand: true,
        func,
    }
}