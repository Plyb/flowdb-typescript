import ts, { ConciseBody } from 'typescript';
import { DcfaCachePusher, FixedEval } from './dcfa';
import { FixRunFunc, makeFixpointComputer } from './fixpoint';
import { empty, setFilter, setFlatMap, setMap, singleton, union } from './setUtil';
import { findAllCalls, isFunctionLikeDeclaration, isPrismaQuery, printNodeAndPos } from './ts-utils';
import { StructuralSet } from './structural-set';
import { Config, ConfigNoExtern, singleConfig, isBlockConfig, isFunctionLikeDeclarationConfig, printConfig, pushContext, configSetJoinMap, join, ConfigSet, envKey, envValue, unimplementedBottom } from './configuration';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { consList } from './util';
import { newQuestion } from './context';
import { isExtern } from './abstract-values';
import { getBuiltInValueOfBuiltInConstructor, higherOrderArgsOf, isBuiltInConstructorShaped, isBuiltInConstructorShapedConfig } from './value-constructors';

export function getReachableCallConfigs(config: Config<ConciseBody>, m: number, fixed_eval: FixedEval, push_cache: DcfaCachePusher): ConfigSet<ts.CallExpression> {
    const { valueOf } = makeFixpointComputer(
        empty<Config<ts.CallExpression>>(),
        join,
        { printArgs: printConfig as (config: Config<ConciseBody>) => string, printRet: set => setMap(set, printConfig).toString()}
    );
    return valueOf({ func: compute, args: config })

    function compute(config: Config<ConciseBody>, fix_run: FixRunFunc<Config<ConciseBody>, ConfigSet<ts.CallExpression>>): ConfigSet<ts.CallExpression> {
        const directCallSites = new SimpleSet(structuralComparator,
            ...[...findAllCalls(config.node)]
        );
        const directCallSiteConfigs = setMap(directCallSites, site => ({ node: site, env: config.env}) as Config<ts.CallExpression>);
        const transitiveCallSiteConfigs = configSetJoinMap(
            directCallSiteConfigs,
            ({ node: site, env }) => {
                if (isPrismaQuery(site)) {
                    return empty()
                }

                const operators = fixed_eval({ node: site.expression, env });
                return configSetJoinMap(operators, (opConfig) => {
                    const { node: op, env: funcEnv } = opConfig;
                    if (isFunctionLikeDeclaration(op)) {
                        push_cache(
                            envKey(consList(newQuestion(op), funcEnv)),
                            envValue(consList(pushContext(site, env, m), funcEnv))
                        );
    
                        return fix_run(compute, {
                            node: op.body,
                            env: consList(pushContext(site, env, m), funcEnv)
                        })

                    } else if (isBuiltInConstructorShapedConfig(opConfig)) {
                        const builtInType = getBuiltInValueOfBuiltInConstructor(opConfig, fixed_eval);
                        const higherOrderArgIndices = higherOrderArgsOf[builtInType];
                        const higherOrderArgs = site.arguments.filter((_, i) => higherOrderArgIndices.includes(i));
                        const argSet = new SimpleSet(structuralComparator, ...higherOrderArgs);
                        const argConses = setFlatMap(argSet, arg => fixed_eval({ node: arg, env }));
                        const functionLikeArgConses = setFilter(argConses, isFunctionLikeDeclarationConfig);

                        return setFlatMap(functionLikeArgConses, ({ node: argNode, env: argEnv }) => {
                            push_cache(
                                envKey(consList(newQuestion(argNode), argEnv)),
                                envValue(consList(pushContext(site, env, m), argEnv))
                            );

                            return fix_run(compute, {
                                node: argNode.body,
                                env: consList(pushContext(site, env, m), argEnv)
                            });
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

export function getReachableBlocks(blockConfig: Config<ts.Block>, m: number, fixed_eval: FixedEval, push_cache: DcfaCachePusher): StructuralSet<Config<ts.Block>> {
    const reachableCalls = getReachableCallConfigs(blockConfig, m, fixed_eval, push_cache);
    const otherReachableBodies = configSetJoinMap(reachableCalls, callConfig => {
        if (isPrismaQuery(callConfig.node)) {
            return empty();
        }

        const operatorConfig = { node: callConfig.node.expression, env: callConfig.env };
        const possibleFunctions = fixed_eval(operatorConfig);
        return setFlatMap(possibleFunctions, funcConfig => {
            if (!isFunctionLikeDeclarationConfig(funcConfig)) {
                return empty();
            }
            return singleConfig({
                node: funcConfig.node.body,
                env: consList(pushContext(callConfig.node, callConfig.env, m), funcConfig.env),
            })
        })
    }) as StructuralSet<ConfigNoExtern>;
    return union(singleton(blockConfig), setFilter(otherReachableBodies, isBlockConfig));
}