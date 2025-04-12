import { extern, Extern, isExtern } from './abstract-values'
import { setFilter, setMap, setSome, singleton } from './setUtil';
import { StructuralSet } from './structural-set';
import { findAllParameterBinders, getPosText, isFunctionLikeDeclaration, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { List, listReduce, toList } from './util';
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
| StackBottom
| {
    head: ts.CallExpression,
    tail: Context
};
type LimitSentinel = { __limitSentinelBrand: true }
type Question = { __questionBrand: true, func: SimpleFunctionLikeDeclaration }
type StackBottom = { __stackBottomBrand: true }

export const limit: LimitSentinel = { __limitSentinelBrand: true };
export const stackBottom: StackBottom = { __stackBottomBrand: true };

type ConfigExtern = Config<Extern>
export type ConfigNoExtern = Config<Exclude<Cursor, Extern>>
export type ConfigSetNoExtern = StructuralSet<ConfigNoExtern>

export const justExtern: ConfigSet = singleConfig({ node: extern, env: toList([stackBottom]) });

export function singleConfig(config: Config): ConfigSet {
    return singleton(config);
}

export function withUnknownContext<T extends Cursor>(node: T): Config<T> {
    if (isExtern(node)) {
        return {
            node,
            env: toList([stackBottom])
        };
    }

    return {
        node,
        env: toList([...findAllParameterBinders(node).map((func) => newQuestion(func)), stackBottom]),
    }
}

export function printConfig(config: Config) {
    return `${printNodeAndPos(config.node)}~<${listReduce(config.env, (acc, curr) => acc + ',' + printContext(curr), '')}>`
}
function printContext(context: Context) {
    if (isLimit(context)) {
        return '□';
    } else if (isQuestion(context)) {
        return `?_${getPosText(context.func)}`
    } else if (isStackBottom(context)) {
        return '()'
    }  else {
        return `${getPosText(context.head)}::${printContext(context.tail)}`
    }
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
    } else if (isStackBottom(context)) {
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
function isStackBottom(context: Context): context is StackBottom {
    return '__stackBottomBrand' in context;
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