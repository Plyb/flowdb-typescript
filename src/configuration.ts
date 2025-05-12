import { List, Record, RecordOf, Set } from 'immutable';
import { createElementPick, Cursor, ElementPick, extern, Extern, isExtern } from './abstract-values'
import { Context, ContextCons, isLimit, isQuestion, isStackBottom, limit, newQuestion, stackBottom } from './context';
import { Computation, FixRunFunc } from './fixpoint';
import { empty, setFilter, setMap, setSome, singleton, union } from './setUtil';
import { StructuralSet } from './structural-set';
import { findAllParameterBinders, getPosText, isAssignmentExpression, isBlock, isCallExpression, isElementAccessExpression, isFunctionLikeDeclaration, isIdentifier, isObjectLiteralExpression, isPropertyAccessExpression, isSpreadAssignment, isVariableDeclaration, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { unimplemented } from './util';
import ts, { AssignmentExpression, AssignmentOperatorToken, SyntaxKind } from 'typescript';
import { BuiltInValue } from './value-constructors';

export type ConfigSet<N extends Cursor = Cursor> = Set<Config<N>>;

export type ConfigObject<N extends Cursor = Cursor> = {
    node: N,
    env: Environment,
    builtInValue?: BuiltInValue;
}
export type Config<N extends Cursor = Cursor> = RecordOf<ConfigObject<N>>
export type Environment = List<Context>;

export type BuiltInConfig = ConfigNoExtern & { builtInValue: BuiltInValue}

type ConfigExtern = Config<Extern>
export type ConfigNoExtern = Config<Exclude<Cursor, Extern>>
export type ConfigSetNoExtern = Set<ConfigNoExtern>

const configDummy = ts.factory.createToken(SyntaxKind.AsteriskToken)
const ConfigRecord = Record({
    node: configDummy as Cursor,
    env: List<Context>(),
    builtInValue: undefined as BuiltInValue | undefined,
})
export function Config<N extends Cursor>(obj: { node: N, env: Environment, builtInValue?: BuiltInValue }): Config<N> {
    return ConfigRecord(obj) as Config<N>;
}

export const justExtern: ConfigSet = singleConfig(Config({ node: extern, env: List.of(stackBottom) }));

export function singleConfig(config: Config): ConfigSet {
    return Set.of(config);
}

export function join<T extends Cursor>(a: ConfigSet<T>, b: ConfigSet<T>): ConfigSet<T> {
    return a.union(b);
}
export function joinAll(...values: ConfigSet[]): ConfigSet {
    return values.reduce(join, empty());
}
function setJoinMap<T>(set: Set<T>, f: (item: T) => ConfigSet) {
    // not using immutable.js's set map because it adds a lot of stack frames, and we call this function so often it was making debugging difficult. Also removes laziness at a critical point.
    return Set(set.toArray().map(f).reduce<ConfigSet>(join, empty()));
}
export function configSetJoinMap<T extends Cursor>(set: ConfigSet<T | Extern>, convert: (config: Config<T>) => ConfigSet): ConfigSet {
    return setJoinMap(set, config => isConfigNoExtern(config) ? convert(config as Config<T>) : justExtern);
}


export function withUnknownContext<T extends Cursor>(node: T): Config<T> {
    if (isExtern(node)) {
        return Config({
            node,
            env: List.of(stackBottom)
        });
    }

    return Config({
        node,
        env: List.of(stackBottom, ...findAllParameterBinders(node).map((func) => newQuestion(func) as Context).reverse()),
    })
}

export function printConfig(config: Config) {
    if (config.node === envDummy) {
        return 'ENV'
    }

    return `${printNodeAndPos(config.node)}~<${config.env.reduceRight((acc, curr) => acc + ',' + printContext(curr), '')}>`
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
    const innermostContext = env.last();
    return truncate(ContextCons({ head: call, tail: innermostContext }), m);
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
        return ContextCons({
            head: context.head,
            tail: truncate(context.tail, m - 1),
        })
    }
}

export function isConfigNoExtern(config: Config): config is ConfigNoExtern {
    return !isExtern(config.node);
}export function isConfigExtern(config: Config): config is ConfigExtern {
    return isExtern(config.node);
}
export function isIdentifierConfig(config: Config): config is Config<ts.Identifier> {
    return !isExtern(config.node) && isIdentifier(config.node);
}
export function isFunctionLikeDeclarationConfig(config: Config): config is Config<SimpleFunctionLikeDeclaration> {
    return isConfigNoExtern(config) && isFunctionLikeDeclaration(config.node);
}
export function isPropertyAccessConfig(config: Config): config is Config<ts.PropertyAccessExpression> {
    if (isExtern(config.node)) {
        return false;
    }

    return isPropertyAccessExpression(config.node);
}
export function isCallConfig(config: Config): config is Config<ts.CallExpression> {
    if (!isConfigNoExtern(config)) {
        return false;
    }

    return isCallExpression(config.node);
}
export function isBlockConfig(config: ConfigNoExtern): config is Config<ts.Block> {
    return isBlock(config.node);
}
export function isObjectLiteralExpressionConfig(config: Config): config is Config<ts.ObjectLiteralExpression> {
    return !isExtern(config.node) && isObjectLiteralExpression(config.node)
}
export function isElementAccessConfig(config: Config): config is Config<ts.ElementAccessExpression> {
    if (isExtern(config.node)) {
        return false;
    }

    return isElementAccessExpression(config.node);
}
export function isAssignmentExpressionConfig(config: Config): config is Config<AssignmentExpression<AssignmentOperatorToken>> {
    if (config.node === undefined || !isConfigNoExtern(config)) {
        return false;
    }

    return isAssignmentExpression(config.node);
}
export function isSpreadAssignmentConfig(config: Config): config is Config<ts.SpreadAssignment> {
    if (isExtern(config.node)) {
        return false;
    }

    return isSpreadAssignment(config.node);
}
export function isVariableDeclarationConfig(config: Config): config is Config<ts.VariableDeclaration> {
    if (isExtern(config.node)) {
        return false;
    }

    return isVariableDeclaration(config.node);
}

export function configSetMap<T extends Cursor>(set: ConfigSet<T>, convert: (config: Config<T> & ConfigNoExtern) => Config): ConfigSet {
    return set.map(config => isConfigNoExtern(config) ? convert(config) : config);
}
export function configSetFilter<T extends ConfigNoExtern>(set: ConfigSet, predicate: (config: ConfigNoExtern) => config is T): Set<ConfigExtern | T>
export function configSetFilter(set: ConfigSet, predicate: (config: ConfigNoExtern) => boolean): ConfigSet
export function configSetFilter(set: ConfigSet, predicate: (config: ConfigNoExtern) => boolean): ConfigSet {
    return set.filter(config => !isConfigNoExtern(config) || predicate(config));
}
export function configSetSome(set: ConfigSet, predicate: (config: ConfigNoExtern) => boolean): boolean {
    return set.some(config => isConfigNoExtern(config) && predicate(config));
}

export function pretty(set: ConfigSet): string[] {
    return [...set].map(printConfig)
}

export function unimplementedBottom(message: string): ConfigSet {
    return unimplemented(message, empty());
}

const envDummy = ts.factory.createVoidZero()
function envKeyFunc() { return empty<Config>() }
/**
 * in order to use environments as keys in the fixpoint, we need them to have the same
 * type as other keys, namely computations, so we can just wrap it and pair it with a dummy node
 */
export function envKey(env: Environment): Computation<Config, ConfigSet> {
    return Computation<Config, ConfigSet>({
        func: envKeyFunc,
        args: Config({
            node: envDummy,
            env,
        })
    })
}
/**
 * Similarly, for an env to be stored in the cache, it has to have the same type as other values,
 * namely, config (sets)
 */
export function envValue(env: Environment): ConfigSet {
    return singleton(Config({
        node: envDummy,
        env,
    }));
}

export function getRefinementsOf(config: Config, fix_run: FixRunFunc<Config, ConfigSet>): ConfigSet {
    const refinedEnvironments = fix_run(envKeyFunc, Config({ node: envDummy, env: config.env }));
    const directRefinedEnvs = refinedEnvironments.map(({ env }) => Config({ node: config.node, env }));

    const refinedTails: ConfigSet = config.env.size > 1
        ? getRefinementsOf(Config({ node: envDummy, env: config.env.pop()}), fix_run)
        : empty();
    const transitiveRefinedEnvs = configSetJoinMap(refinedTails, tail =>
        getRefinementsOf(Config({ node: config.node, env: tail.env.push(config.env.last()!) }), fix_run)
    );

    return directRefinedEnvs.union(transitiveRefinedEnvs);
}

export function createElementPickConfig(config: ConfigNoExtern): Config<ElementPick> {
    return Config({
        node: createElementPick(config.node),
        env: config.env,
    })
}

export function createElementPickConfigSet(config: ConfigNoExtern): ConfigSet {
    return singleConfig(createElementPickConfig(config))
}
