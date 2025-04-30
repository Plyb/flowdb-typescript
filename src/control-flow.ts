import ts, { ConciseBody } from 'typescript';
import { DcfaCachePusher, FixedEval } from './dcfa';
import { Computation, FixRunFunc, makeFixpointComputer } from './fixpoint';
import { empty, setFilter, setFlatMap, setMap, singleton, union } from './setUtil';
import { findAllCalls, isFunctionLikeDeclaration, isPrismaQuery, printNodeAndPos } from './ts-utils';
import { Config, singleConfig, isBlockConfig, isFunctionLikeDeclarationConfig, printConfig, pushContext, configSetJoinMap, join, ConfigSet, envKey, envValue, unimplementedBottom, ConfigSetNoExtern } from './configuration';
import { newQuestion } from './context';
import { builtInValueBehaviors, getBuiltInValueOfBuiltInConstructor, isBuiltInConstructorShapedConfig } from './value-constructors';
import { Set } from 'immutable'

export function getReachableCallConfigs(config: Config<ConciseBody>, m: number, fixed_eval: FixedEval, push_cache: DcfaCachePusher): ConfigSet<ts.CallExpression> {
    const { valueOf } = makeFixpointComputer(
        empty<Config<ts.CallExpression>>(),
        join,
        { printArgs: printConfig as (config: Config<ConciseBody>) => string, printRet: set => setMap(set, printConfig).toString()}
    );
    return valueOf(Computation({ func: compute, args: config }))

    function compute(config: Config<ConciseBody>, fix_run: FixRunFunc<Config<ConciseBody>, ConfigSet<ts.CallExpression>>): ConfigSet<ts.CallExpression> {
        const directCallSites = Set.of(...findAllCalls(config.node));
        const directCallSiteConfigs = setMap(directCallSites, site => Config({ node: site, env: config.env}));
        const transitiveCallSiteConfigs = configSetJoinMap(
            directCallSiteConfigs,
            ({ node: site, env }) => {
                if (isPrismaQuery(site)) {
                    return empty()
                }

                const operators = fixed_eval(Config({ node: site.expression, env }));
                return configSetJoinMap(operators, (opConfig) => {
                    const { node: op, env: funcEnv } = opConfig;
                    if (isFunctionLikeDeclaration(op)) {
                        push_cache(
                            envKey(funcEnv.push(newQuestion(op))),
                            envValue(funcEnv.push(pushContext(site, env, m)))
                        );
    
                        return fix_run(compute, Config({
                            node: op.body,
                            env: funcEnv.push(pushContext(site, env, m))
                        }))

                    } else if (isBuiltInConstructorShapedConfig(opConfig)) {
                        const builtInType = getBuiltInValueOfBuiltInConstructor(opConfig, fixed_eval);
                        const higherOrderArgIndices = builtInValueBehaviors[builtInType].higherOrderArgs;
                        const higherOrderArgs = site.arguments.filter((_, i) => higherOrderArgIndices.includes(i));
                        const argSet = Set.of(...higherOrderArgs);
                        const argConses = setFlatMap(argSet, arg => fixed_eval(Config({ node: arg, env })));
                        const functionLikeArgConses = setFilter(argConses, isFunctionLikeDeclarationConfig);

                        return setFlatMap(functionLikeArgConses, ({ node: argNode, env: argEnv }) => {
                            push_cache(
                                envKey(argEnv.push(newQuestion(argNode))),
                                envValue(argEnv.push(pushContext(site, env, m)))
                            );

                            return fix_run(compute, Config({
                                node: argNode.body,
                                env: argEnv.push(pushContext(site, env, m))
                            }));
                        })
                    } else {
                        return unimplementedBottom(`Unknown kind of operator: ${printNodeAndPos(op)}`)
                    }
                });
            }
        ) as ConfigSet<ts.CallExpression>;
        return union(directCallSiteConfigs, transitiveCallSiteConfigs);
    }
}

export function getReachableBlocks(blockConfig: Config<ts.Block>, m: number, fixed_eval: FixedEval, push_cache: DcfaCachePusher): ConfigSet<ts.Block> {
    const reachableCalls = getReachableCallConfigs(blockConfig, m, fixed_eval, push_cache);
    const otherReachableBodies = configSetJoinMap(reachableCalls, callConfig => {
        if (isPrismaQuery(callConfig.node)) {
            return empty();
        }

        const operatorConfig = Config({ node: callConfig.node.expression, env: callConfig.env });
        const possibleFunctions = fixed_eval(operatorConfig);
        return setFlatMap(possibleFunctions, funcConfig => {
            if (!isFunctionLikeDeclarationConfig(funcConfig)) {
                return empty();
            }
            return singleConfig(Config({
                node: funcConfig.node.body,
                env: funcConfig.env.push(pushContext(callConfig.node, callConfig.env, m)),
            }))
        })
    }) as ConfigSetNoExtern;
    return union(singleton(blockConfig), setFilter(otherReachableBodies, isBlockConfig));
}